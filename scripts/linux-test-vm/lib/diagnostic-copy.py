#!/usr/bin/env python3
"""Internal vmctl stopped-copy implementation; not an authority issuer.

Request v1 binds operationId/ownerId, source {name, chain, stopped}, destination
{name,path}, evidenceDir, lineage, retentionUntil, authority {leaseRef,capabilityRef}
and limits {copyBytes,guestWriteBytes,evidenceBytes,rollbackBytes,retainedBytes,
timeoutSec,leaseLifetimeSec}. Each chain entry binds path/dev/ino/size/sha256,
format and virtualSize. The canonical verifier (currently absent in common.sh)
must attest the exact request digest, owner, scope, refs and validity window.

Image/process primitives are replaced only by the maintained hermetic test
harness. No command-line/environment option substitutes authority or procfs.
"""
import ctypes
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import resource
import signal
import stat
import subprocess
import sys
import tempfile
import time

PROC_ROOT = Path('/proc')
SCOPE = 'vmctl:prepare-diagnostic-copy'


class Refusal(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refusal(reason)


def keys(value, expected):
    require(isinstance(value, dict) and set(value) == set(expected.split()), 'manifest-shape')


def text(value):
    return isinstance(value, str) and bool(value) and not any(ord(c) < 32 for c in value)


def integer(value, minimum=1):
    return type(value) is int and minimum <= value <= 2**53 - 1


def canonical(value):
    require(text(value) and os.path.isabs(value) and os.path.realpath(value) == value,
            'noncanonical-path')
    return Path(value)


def read_request(filename, run_dir):
    with Path(filename).open('rb') as request:
        raw = request.read(65537)
    require(len(raw) <= 65536, 'manifest-too-large')
    m = json.loads(raw)
    keys(m, 'schemaVersion operationId ownerId source destination evidenceDir lineage retentionUntil authority limits')
    require(m['schemaVersion'] == 1 and type(m['schemaVersion']) is int, 'manifest-version')
    require(text(m['ownerId']) and isinstance(m['operationId'], str)
            and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', m['operationId']), 'manifest-identity')
    keys(m['source'], 'name chain stopped')
    keys(m['destination'], 'name path')
    for name in [m['source']['name'], m['destination']['name']]:
        require(isinstance(name, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', name), 'vm-name')
    require(m['source']['name'] != m['destination']['name'], 'protected-destination')
    root = canonical(str(run_dir))
    dest = canonical(m['destination']['path'])
    require(dest == root / m['destination']['name'] / 'overlay.qcow2', 'destination-binding')
    source = m['source']['chain']
    require(isinstance(source, list) and 1 <= len(source) <= 32, 'source-chain')
    for entry in source:
        keys(entry, 'path dev ino size sha256 format virtualSize')
        canonical(entry['path'])
        require(all(integer(entry[k], 0 if k == 'dev' else 1) for k in ['dev', 'ino', 'size', 'virtualSize']), 'source-identity')
        require(isinstance(entry['sha256'], str) and re.fullmatch('[a-f0-9]{64}', entry['sha256']), 'source-digest')
        require(entry['format'] in ['qcow2', 'raw'], 'unsupported-image-format')
        require(dest.parent not in Path(entry['path']).parents, 'destination-overlap')
    require(source[0]['path'] == str(root / m['source']['name'] / 'overlay.qcow2'), 'source-binding')
    require(len({e['path'] for e in source}) == len(source), 'duplicate-chain-path')
    require(len({(e['dev'], e['ino']) for e in source}) == len(source), 'chain-hardlink')
    keys(m['source']['stopped'], 'bootId pid startTicks')
    stopped = m['source']['stopped']
    require(text(stopped['bootId']) and integer(stopped['pid']) and integer(stopped['startTicks']), 'stopped-identity')
    keys(m['authority'], 'leaseRef capabilityRef')
    require(all(text(v) for v in m['authority'].values()), 'authority-refs')
    require(isinstance(m['lineage'], list) and 1 <= len(m['lineage']) <= 32 and all(text(v) for v in m['lineage']), 'lineage')
    keys(m['limits'], 'copyBytes guestWriteBytes evidenceBytes rollbackBytes retainedBytes timeoutSec leaseLifetimeSec')
    lim = m['limits']
    require(all(integer(v, 0 if k in ['guestWriteBytes', 'rollbackBytes', 'retainedBytes'] else 1) for k, v in lim.items()), 'limits')
    require(lim['evidenceBytes'] >= 65536 and lim['timeoutSec'] <= 3600 and lim['leaseLifetimeSec'] >= lim['timeoutSec'] + 30,
            'budget-window')
    require(integer(m['retentionUntil']) and m['retentionUntil'] >= time.time() + lim['leaseLifetimeSec'], 'retention-window')
    evidence = canonical(m['evidenceDir'])
    require(evidence != root and root not in evidence.parents and evidence not in root.parents,
            'evidence-overlap')
    require(all(evidence not in Path(e['path']).parents and Path(e['path']) not in evidence.parents for e in source), 'evidence-source-overlap')
    return m, hashlib.sha256(raw).hexdigest()


def check_authority(m, digest, raw):
    a = json.loads(raw)
    keys(a, 'schemaVersion decision verifierRef manifestSha256 ownerId scope leaseRef capabilityRef leaseOwner notBefore expiresAt')
    require(type(a['schemaVersion']) is int and a['schemaVersion'] == 1 and a['decision'] == 'allow'
            and text(a['verifierRef']), 'authority-verdict')
    require(a['manifestSha256'] == digest and a['ownerId'] == m['ownerId'] and a['scope'] == SCOPE
            and a['leaseRef'] == m['authority']['leaseRef'] and a['capabilityRef'] == m['authority']['capabilityRef'],
            'authority-binding')
    keys(a['leaseOwner'], 'bootId pid startTicks')
    require(text(a['leaseOwner']['bootId']) and integer(a['leaseOwner']['pid'])
            and integer(a['leaseOwner']['startTicks']), 'authority-owner-lifetime')
    now = time.time()
    require(integer(a['notBefore'], 0) and integer(a['expiresAt']) and a['notBefore'] <= now
            and a['expiresAt'] >= now + m['limits']['leaseLifetimeSec'], 'authority-lifetime')
    return a


def verify_authority(m, digest):
    # A trusted implementation must call the existing canonical lease/capability
    # verifier, scoped to this exact manifest. No such VM-copy interface exists
    # yet. Crucially there is NO CLI/env/file input accepting a caller's allow
    # verdict: invoking this internal helper directly cannot bypass the gate.
    raise Refusal('canonical-authority-verifier-unavailable')


def digest_fd(fd, deadline):
    h = hashlib.sha256()
    os.lseek(fd, 0, os.SEEK_SET)
    while True:
        require(time.monotonic() < deadline, 'source-hash-timeout')
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            return h.hexdigest()
        h.update(chunk)


def file_identity(st):
    return (st.st_dev, st.st_ino, st.st_size)


def stable_identity(st):
    return (*file_identity(st), st.st_mtime_ns, st.st_ctime_ns)


def assert_output_stable(output, fd, expected, deadline, digest=None, hash_bytes=True):
    def check():
        observed = output.lstat()
        held = os.fstat(fd)
        require(stat.S_ISREG(observed.st_mode) and observed.st_nlink == 1
                and file_identity(observed)[:2] == file_identity(held)[:2] == expected[:2], 'copy-identity-changed')
        require(stable_identity(observed) == stable_identity(held) == expected, 'copy-stability-changed')
    check()
    if hash_bytes:
        observed_digest = digest_fd(fd, deadline)
        require(digest is None or observed_digest == digest, 'copy-stability-changed')
        digest = observed_digest
    check()
    return digest


def assert_sources(m, fds, deadline):
    for entry, fd in zip(m['source']['chain'], fds):
        canonical(entry['path'])
        require(file_identity(os.fstat(fd)) == (entry['dev'], entry['ino'], entry['size'])
                and file_identity(os.stat(entry['path'], follow_symlinks=False)) == file_identity(os.fstat(fd)),
                'source-identity-changed')
        require(digest_fd(fd, deadline) == entry['sha256'], 'source-digest-changed')


def stopped_proof(m, fds):
    expected = m['source']['stopped']
    require((PROC_ROOT / 'sys/kernel/random/boot_id').read_text().strip() == expected['bootId'], 'source-boot-mismatch')
    pidstat = PROC_ROOT / str(expected['pid']) / 'stat'
    if pidstat.exists():
        fields = pidstat.read_text().rsplit(')', 1)[1].split()
        require(int(fields[19]) == expected['startTicks'], 'source-wrong-birth')
        raise Refusal('source-running')
    identities = {(os.fstat(fd).st_dev, os.fstat(fd).st_ino) for fd in fds}
    # Reject even other readers. Unreadable procfs is UNKNOWN, never a stopped
    # claim. Lifetime disappearance is safe; permission/visibility gaps refuse.
    inspected = 0
    for process in PROC_ROOT.iterdir():
        if not process.name.isdecimal() or int(process.name) == os.getpid():
            continue
        try:
            before = (process / 'stat').read_text().rsplit(')', 1)[1].split()[19]
            for descriptor in (process / 'fd').iterdir():
                try:
                    st = descriptor.stat()
                    require((st.st_dev, st.st_ino) not in identities, 'source-open-holder')
                except FileNotFoundError:
                    pass
            require((process / 'stat').read_text().rsplit(')', 1)[1].split()[19] == before, 'writer-lifetime-changed')
            inspected += 1
        except FileNotFoundError:
            # A vanished process cannot retain an open file description.
            require(not process.exists(), 'writer-enumeration-incomplete')
    return {'bootId': expected['bootId'], 'stopped': expected, 'processesInspected': inspected,
            'imageLocks': 'read-only whole-file flock+POSIX shared locks; native qemu image locking retained'}


def run_image(args, deadline, limit, receipt):
    argv = ['qemu-img', *args]
    entry = {'argv': argv, 'status': None}
    receipt['commands'].append(entry)
    remaining = deadline - time.monotonic()
    require(remaining > 0, 'image-timeout')
    def size_limit():
        resource.setrlimit(resource.RLIMIT_FSIZE, (limit, limit))
    child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=True, preexec_fn=size_limit)
    try:
        out, err = child.communicate(timeout=remaining)
    except BaseException:
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate()
        entry['status'] = child.returncode
        raise Refusal('image-timeout-or-interruption')
    entry.update(status=child.returncode, stdout=out[:8192].decode(errors='replace'), stderr=err[:8192].decode(errors='replace'))
    require(len(out) + len(err) <= 32768, 'image-output-budget')
    require(child.returncode == 0, 'image-command-failed')
    return out


def check_chain(m, images, output=False):
    require(isinstance(images, list), 'image-metadata')
    expected = [{'path': m['destination']['path'], 'format': 'qcow2', 'virtualSize': m['source']['chain'][0]['virtualSize']}] if output else m['source']['chain']
    require(len(images) == len(expected), 'image-chain-length')
    for index, (image, entry) in enumerate(zip(images, expected)):
        require(isinstance(image, dict), 'image-metadata')
        require(image.get('filename') == entry['path'] and image.get('format') == entry['format']
                and image.get('virtual-size') == entry['virtualSize'], 'image-metadata-binding')
        require(not image.get('encrypted') and not image.get('snapshots') and not image.get('data-file'), 'unsupported-image-metadata')
        specific = image.get('format-specific', {})
        require(isinstance(specific, dict), 'unsupported-image-metadata')
        data = specific.get('data', {})
        require(isinstance(data, dict), 'unsupported-image-metadata')
        require(not data.get('data-file') and not data.get('encrypt'), 'unsupported-image-metadata')
        backing = image.get('full-backing-filename') or image.get('backing-filename')
        require(backing == (expected[index + 1]['path'] if index + 1 < len(expected) else None), 'image-backing-mismatch')


def rename_no_replace(source, dest):
    libc = ctypes.CDLL(None, use_errno=True)
    require(hasattr(libc, 'renameat2'), 'atomic-publication-unsupported')
    if libc.renameat2(-100, os.fsencode(source), -100, os.fsencode(dest), 1) != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


def private_directory(path):
    st = path.stat()
    require(stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid() and not st.st_mode & 0o077, 'nonprivate-directory')
    return st


def materialize(m, digest, authority, reservation_file):
    receipt = {'schemaVersion': 1, 'operationId': m['operationId'], 'manifestSha256': digest,
               'ownerId': m['ownerId'], 'scope': SCOPE, 'authority': authority, 'source': m['source'],
               'destination': m['destination'], 'lineage': m['lineage'], 'retentionUntil': m['retentionUntil'],
               'status': 'failure', 'stage': 'preflight', 'commands': [], 'published': False}
    deadline = time.monotonic() + m['limits']['timeoutSec']
    fds, temp, temp_identity, evidence = [], None, None, None
    copy_fd, owned_output = None, None
    try:
        root = Path(m['destination']['path']).parent.parent
        root_identity = file_identity(root.stat())[:2]
        dest = Path(m['destination']['path']).parent
        require(root.is_dir() and not os.path.lexists(dest), 'destination-exists-or-parent-missing')
        evidence_root = Path(m['evidenceDir'])
        ev_st = private_directory(evidence_root)
        require(ev_st.st_dev == root.stat().st_dev, 'evidence-reservation-device')
        # This is the receipt already validated by the maintained shell helper,
        # not a second reservation/admission implementation.
        reservation = Path(reservation_file)
        require(reservation.is_file(), 'missing-reservation-receipt')
        reservation_bytes = reservation.read_bytes()
        require(0 < len(reservation_bytes) <= 8192, 'reservation-receipt-size')
        receipt['reservation'] = {'path': str(reservation), 'sha256': hashlib.sha256(reservation_bytes).hexdigest(),
                                  'body': reservation_bytes.decode(), 'budgetBytes': sum(m['limits'][k] for k in ['copyBytes', 'guestWriteBytes', 'evidenceBytes', 'rollbackBytes', 'retainedBytes'])}
        evidence = Path(tempfile.mkdtemp(prefix=m['operationId'] + '-', dir=evidence_root))
        receipt['evidenceDir'] = str(evidence)
        for entry in m['source']['chain']:
            fd = os.open(entry['path'], os.O_RDONLY | os.O_NOFOLLOW)
            fds.append(fd)
            st = os.fstat(fd)
            require(stat.S_ISREG(st.st_mode) and st.st_nlink == 1 and st.st_uid == os.getuid(), 'source-custody')
            fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
            fcntl.lockf(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        assert_sources(m, fds, deadline)
        receipt['stoppedProof'] = stopped_proof(m, fds)
        images = json.loads(run_image(['info', '--backing-chain', '--output=json', '--', m['source']['chain'][0]['path']], deadline, m['limits']['copyBytes'], receipt))
        check_chain(m, images)
        temp = Path(tempfile.mkdtemp(prefix='.diagnostic-copy-', dir=root))
        temp_identity = file_identity(temp.stat())[:2]
        output = temp / 'overlay.qcow2'
        receipt.update(stage='conversion', partialDirectory=str(temp))
        # Claim the inode BEFORE either utility runs, retaining its read-only FD
        # even on conversion failure. -n populates that image rather than asking
        # convert to create a new output whose ownership could not be recovered.
        copy_fd = os.open(output, os.O_RDONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        owned_output = file_identity(os.fstat(copy_fd))[:2]
        run_image(['create', '-f', 'qcow2', '--', str(output), str(m['source']['chain'][0]['virtualSize'])], deadline, m['limits']['copyBytes'], receipt)
        require(file_identity(output.lstat())[:2] == owned_output and not output.is_symlink(), 'copy-identity-changed')
        run_image(['convert', '-n', '-f', m['source']['chain'][0]['format'], '-O', 'qcow2', '--', m['source']['chain'][0]['path'], str(output)], deadline, m['limits']['copyBytes'], receipt)
        require(output.is_file() and not output.is_symlink() and output.stat().st_nlink == 1
                and output.stat().st_size <= m['limits']['copyBytes'], 'copy-output-budget-or-custody')
        require(file_identity(output.lstat())[:2] == owned_output, 'copy-identity-changed')
        fcntl.flock(copy_fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        fcntl.lockf(copy_fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        output_identity = stable_identity(os.fstat(copy_fd))
        copy_digest = assert_output_stable(output, copy_fd, output_identity, deadline)
        receipt['stage'] = 'verification'
        copied = json.loads(run_image(['info', '--backing-chain', '--output=json', '--', str(output)], deadline, m['limits']['copyBytes'], receipt))
        # Compare temporary path before publication, retaining exact metadata.
        expected = json.loads(json.dumps(m))
        expected['destination']['path'] = str(output)
        check_chain(expected, copied, output=True)
        run_image(['compare', '-f', m['source']['chain'][0]['format'], '-F', 'qcow2', '--', m['source']['chain'][0]['path'], str(output)], deadline, m['limits']['copyBytes'], receipt)
        assert_sources(m, fds, deadline)
        receipt['finalStoppedProof'] = stopped_proof(m, fds)
        check_authority(m, digest, json.dumps(verify_authority(m, digest)))
        require(time.monotonic() < deadline, 'publication-timeout')
        canonical(str(root))
        canonical(str(evidence_root))
        require(file_identity(root.stat())[:2] == root_identity
                and file_identity(evidence_root.stat())[:2] == file_identity(ev_st)[:2], 'parent-identity-changed')
        require(not temp.is_symlink() and file_identity(temp.stat())[:2] == temp_identity, 'partial-identity-changed')
        assert_output_stable(output, copy_fd, output_identity, deadline, copy_digest)
        os.fsync(copy_fd)
        receipt.update(stage='publication', logicalComparison='equal', outputMetadata=copied,
                       sourceUnchanged=True,
                       copyIdentity={'dev': output.stat().st_dev, 'ino': output.stat().st_ino,
                                     'size': output.stat().st_size, 'sha256': copy_digest})
        require(len(json.dumps(receipt).encode()) + 4096 <= m['limits']['evidenceBytes'], 'receipt-evidence-budget')
        assert_output_stable(output, copy_fd, output_identity, deadline, copy_digest, hash_bytes=False)
        rename_no_replace(temp, dest)
        temp = None
        receipt.update(status='success', stage='complete', published=True)
    except (Refusal, OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        receipt['reason'] = str(error)
    finally:
        for fd in fds:
            os.close(fd)
        if temp is not None and os.path.lexists(temp):
            # Unknown/injected contents are retained, never recursively removed.
            try:
                require(not temp.is_symlink() and file_identity(temp.stat())[:2] == temp_identity, 'partial-identity-changed')
                children = list(temp.iterdir())
                require(all(p.name == 'overlay.qcow2' and p.is_file() and not p.is_symlink() and p.stat().st_nlink == 1 for p in children), 'partial-foreign-content')
                require(all(owned_output is not None and file_identity(p.lstat())[:2] == owned_output
                            and copy_fd is not None and file_identity(os.fstat(copy_fd))[:2] == owned_output
                            for p in children), 'partial-output-not-owned')
                for p in children:
                    p.unlink()
                temp.rmdir()
                receipt['partialCleaned'] = True
            except (Refusal, OSError) as error:
                receipt['partialCleaned'] = False
                receipt['cleanupReason'] = str(error)
        if copy_fd is not None:
            os.close(copy_fd)
        if evidence is not None:
            receipt_path = evidence / 'receipt.json'
            receipt['receiptPath'] = str(receipt_path)
            try:
                with receipt_path.open('x') as target:
                    os.chmod(receipt_path, 0o600)
                    json.dump(receipt, target, sort_keys=True)
                    target.flush()
                    os.fsync(target.fileno())
            except OSError as error:
                # Publication cannot be undone or reported as absent merely
                # because writing the evidence failed after the atomic rename.
                receipt.update(status='failure', reason='evidence-receipt-write-failed: ' + str(error))
    return receipt


def main(argv):
    try:
        mode, filename = argv[:2]
        if mode == 'refusal':
            result = {'schemaVersion': 1, 'status': 'failure', 'stage': 'admission', 'reason': argv[2],
                      'manifestSha256': hashlib.sha256(Path(filename).read_bytes()).hexdigest(), 'published': False}
        else:
            run_dir = argv[-1]
            m, digest = read_request(filename, run_dir)
            if mode == 'request':
                budget = sum(m['limits'][k] for k in ['copyBytes', 'guestWriteBytes', 'evidenceBytes', 'rollbackBytes', 'retainedBytes'])
                print(str(Path(m['destination']['path']).parent.parent))
                print(math.ceil(budget / (1024**3)))
                print(m['limits']['leaseLifetimeSec'])
                return 0
            authority = check_authority(m, digest, json.dumps(verify_authority(m, digest)))
            if mode == 'authority':
                print(json.dumps(authority))
                return 0
            require(mode == 'materialize', 'unknown-mode')
            def interrupted(signum, _frame):
                raise Refusal('copy-interrupted-' + str(signum))
            signal.signal(signal.SIGTERM, interrupted)
            result = materialize(m, digest, authority, argv[2])
        print(json.dumps(result, sort_keys=True))
        return 0 if result['status'] == 'success' else 1
    except (Refusal, OSError, ValueError, TypeError, KeyError, IndexError) as error:
        print(json.dumps({'schemaVersion': 1, 'status': 'failure', 'stage': 'admission', 'reason': str(error), 'published': False}))
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

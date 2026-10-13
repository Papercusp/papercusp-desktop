#!/usr/bin/env python3
"""Launch a validated preserved VM, optionally from a compared storage trial.

Extends the existing recovery generation's launcher; captured private arguments
and source/preservation authority remain the same. Never print the private argv.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read(path):
    return json.loads(path.read_text())


def stamp(path):
    s = path.stat()
    return {'device': s.st_dev, 'inode': s.st_ino, 'size': s.st_size,
            'mtimeNs': s.st_mtime_ns}


def unit_state(unit):
    state = subprocess.check_output(['systemctl', '--user', 'show', unit,
                                    '--property=MainPID,ActiveState,Result,NRestarts'], text=True)
    return dict(line.split('=', 1) for line in state.splitlines() if '=' in line)


def process_identity(pid):
    try:
        return (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


def verified_shutdown(unit, runtime, ssh_host, ssh_port, ssh_key, timeout=240, settle=25):
    require(timeout > 0 and settle > 0, 'shutdown windows must be positive')
    before = unit_state(unit)
    pid = int((runtime / 'qemu.pid').read_text().strip())
    require(pid > 1 and before.get('MainPID') == str(pid) and
            before.get('ActiveState') == 'active' and before.get('NRestarts', '').isdigit(),
            'shutdown requires the active unit matching the runtime PID')
    identity = process_identity(pid)
    require(identity is not None, 'shutdown process identity unavailable')
    deadline = time.monotonic() + timeout
    try:
        request = subprocess.run(['ssh', '-i', str(ssh_key), '-p', str(ssh_port),
                                  '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                                  '-o', 'ConnectTimeout=10', ssh_host,
                                  'sudo -n shutdown -h now'], capture_output=True,
                                 timeout=min(30, timeout), check=False)
        ssh_code = request.returncode
    except subprocess.TimeoutExpired:
        ssh_code = None
    # SSH commonly closes before acknowledging shutdown. Its exit status is
    # request evidence, never proof of guest exit (or of failure to exit).
    while True:
        state = unit_state(unit)
        require(state.get('NRestarts') == before['NRestarts'], 'VM restarted during shutdown')
        require(state.get('MainPID') in ('0', str(pid)), 'VM process changed during shutdown')
        departed = process_identity(pid) != identity
        if departed and state.get('MainPID') == '0' and state.get('ActiveState') == 'inactive':
            require(state.get('Result') == 'success', 'VM stop did not finish successfully')
            break
        require(time.monotonic() < deadline, 'guest shutdown not verified before deadline')
        time.sleep(1)
    stable_until = time.monotonic() + settle
    while time.monotonic() < stable_until:
        time.sleep(min(1, max(0, stable_until - time.monotonic())))
        state = unit_state(unit)
        require(process_identity(pid) != identity and state.get('MainPID') == '0' and
                state.get('ActiveState') == 'inactive' and state.get('Result') == 'success' and
                state.get('NRestarts') == before['NRestarts'], 'VM did not remain stopped')
    return {'ok': True, 'sshReturnCode': ssh_code, 'processDeparted': True,
            'unitInactive': True, 'result': 'success', 'noRestartWindowSec': settle}


def stopped(unit, images, starting=False):
    values = unit_state(unit)
    require(values.get('MainPID') == '0' and values.get('ActiveState') in (('inactive', 'activating') if starting else ('inactive',)),
            'VM must be inactive with MainPID=0')
    # A stopped service alone cannot exclude an orphan holding a disk.
    identities = {(p.stat().st_dev, p.stat().st_ino) for p in images}
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if not (proc / 'comm').read_text().startswith('qemu-system'):
                continue
            for fd in (proc / 'fd').iterdir():
                try:
                    s = fd.stat()
                    require((s.st_dev, s.st_ino) not in identities,
                            'QEMU still holds a source image')
                except FileNotFoundError:
                    pass
        except (FileNotFoundError, ProcessLookupError):
            pass


def generation(backup, runtime):
    source, preserved = read(backup / 'source.json'), read(backup / 'preserved.json')
    require(preserved.get('ok') is True, 'preservation was not verified')
    require(preserved.get('sourcePid') == source['pid'] and
            preserved.get('sourceStarttime') == source['starttime'], 'preservation identity mismatch')
    data = backup / 'builddata-20260820-160g.qcow2'
    require(preserved.get('osArchive') == str(backup / 'mac_hdd_ng.img.zst') and
            preserved.get('buildData') == str(data), 'preserved paths mismatch')
    require((backup / 'mac_hdd_ng.img.zst').is_file(), 'preserved OS archive missing')
    ready = read(runtime / 'runtime-ready.json')
    require(ready.get('ok') is True and ready.get('osCompared') is True and
            ready.get('sourceStarttime') == source['starttime'], 'runtime validation mismatch')
    files = {
        './OVMF_CODE_4M.fd': runtime / 'OVMF_CODE_4M.fd',
        './OVMF_VARS-1920x1080.fd': runtime / 'OVMF_VARS-1920x1080.fd',
        './OpenCore/OpenCore.qcow2': runtime / 'OpenCore/OpenCore.qcow2',
        './mac_hdd_ng.img': runtime / 'mac_hdd_ng.img',
        './builddata-20260820-160g.qcow2': data,
    }
    booted = (runtime / 'boot-receipt.json').exists()
    if booted:
        require(read(runtime / 'boot-receipt.json').get('sourceStarttime') == source['starttime'],
                'boot receipt source mismatch')
    for p in files.values():
        require(p.is_file() and str(p) in ready['files'], 'runtime validation stamp missing')
        if not booted:
            require(p.stat().st_size == ready['files'][str(p)]['size'], 'input changed before first boot')
    return source, files


def check(image):
    subprocess.run(['qemu-img', 'check', '-f', 'qcow2', str(image)], check=True)


def prepare_trial(backup, runtime, trial, unit):
    source, originals = generation(backup, runtime)
    stopped(unit, originals.values())
    require(not trial.exists(), 'trial destination exists; inspect rather than overwrite')
    info = json.loads(subprocess.check_output(
        ['qemu-img', 'info', '--output=json', str(originals['./mac_hdd_ng.img'])], text=True))
    require(shutil.disk_usage(trial.parent).free >= info['virtual-size'] + 20 * 2**30,
            'insufficient trial capacity including reserve')
    originals_stamps = {str(p): stamp(p) for p in originals.values()}
    for name in ('./OpenCore/OpenCore.qcow2', './mac_hdd_ng.img', './builddata-20260820-160g.qcow2'):
        check(originals[name])
    trial.mkdir(mode=0o700)
    files = {name: trial / p.name for name, p in originals.items()}
    for name in ('./OVMF_CODE_4M.fd', './OVMF_VARS-1920x1080.fd', './OpenCore/OpenCore.qcow2'):
        shutil.copyfile(originals[name], files[name])
    boot = files['./mac_hdd_ng.img']
    print(json.dumps({'phase': 'convert-active-boot', 'trial': str(trial),
                      'virtualBytes': info['virtual-size'],
                      'preservedSnapshots': [s.get('name') for s in info.get('snapshots', [])]}), flush=True)
    subprocess.run(['qemu-img', 'convert', '-p', '-f', 'qcow2', '-O', 'qcow2',
                    str(originals['./mac_hdd_ng.img']), str(boot)], check=True)
    check(boot)
    subprocess.run(['qemu-img', 'compare', '-p', '-f', 'qcow2', '-F', 'qcow2',
                    str(originals['./mac_hdd_ng.img']), str(boot)], check=True)
    data = files['./builddata-20260820-160g.qcow2']
    subprocess.run(['qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b',
                    str(originals['./builddata-20260820-160g.qcow2']), str(data)], check=True)
    check(data)
    subprocess.run(['qemu-img', 'compare', '-f', 'qcow2', '-F', 'qcow2',
                    str(originals['./builddata-20260820-160g.qcow2']), str(data)], check=True)
    stopped(unit, originals.values())
    require(all(stamp(Path(p)) == s for p, s in originals_stamps.items()),
            'source changed during preparation')
    receipt = {'ok': True, 'schemaVersion': 1, 'sourceStarttime': source['starttime'],
               'runtime': str(runtime), 'bootCompared': True, 'dataCompared': True,
               'originals': originals_stamps,
               'files': {name: {'path': str(p), 'stamp': stamp(p)} for name, p in files.items()},
               'createdAt': time.time()}
    (trial / 'storage-ready.json').write_text(json.dumps(receipt))
    print(json.dumps({'phase': 'storage-ready', 'ok': True,
                      'receipt': str(trial / 'storage-ready.json')}), flush=True)


def prepare(backup, runtime, trial=None):
    source, files = generation(backup, runtime)
    receipt_path = runtime / 'boot-receipt.json'
    if trial is not None:
        receipt = read(trial / 'storage-ready.json')
        require(receipt.get('ok') is True and receipt.get('schemaVersion') == 1 and
                receipt.get('bootCompared') is True and receipt.get('dataCompared') is True and
                receipt.get('sourceStarttime') == source['starttime'] and
                receipt.get('runtime') == str(runtime), 'storage trial was not validated')
        require(set(receipt.get('originals', {})) == {str(p) for p in files.values()},
                'storage trial original set mismatch')
        require(all(stamp(Path(p)) == s for p, s in receipt['originals'].items()),
                'preserved source changed since storage trial')
        require(set(receipt.get('files', {})) == set(files), 'storage trial disk set mismatch')
        receipt_path = trial / 'boot-receipt.json'
        booted = receipt_path.exists()
        if booted:
            require(read(receipt_path).get('storageReceiptSha256') ==
                    hashlib.sha256((trial / 'storage-ready.json').read_bytes()).hexdigest(),
                    'storage boot receipt mismatch')
        for name, entry in receipt['files'].items():
            p = Path(entry['path'])
            require(p.resolve().parent == trial.resolve() and p.is_file(), 'trial input outside trial')
            require(p.resolve() != files[name].resolve(), 'trial would write original input')
            if not booted:
                require(stamp(p) == entry['stamp'], 'trial changed before first boot')
            files[name] = p
        boot_info = json.loads(subprocess.check_output(
            ['qemu-img', 'info', '--output=json', str(files['./mac_hdd_ng.img'])], text=True))
        require(not boot_info.get('backing-filename'), 'trial boot must be standalone')
        data_info = json.loads(subprocess.check_output(
            ['qemu-img', 'info', '--output=json', str(files['./builddata-20260820-160g.qcow2'])], text=True))
        require(Path(data_info.get('full-backing-filename', '')).resolve() ==
                (backup / 'builddata-20260820-160g.qcow2').resolve(), 'trial data backing mismatch')
    argv = list(source['argv'])
    argv[0] = '/usr/bin/qemu-system-x86_64'
    for index, value in enumerate(argv):
        if value == '-drive':
            parts = argv[index + 1].split(',')
            for j, part in enumerate(parts):
                if part.startswith('file='):
                    require(part[5:] in files, 'unknown captured disk input')
                    parts[j] = 'file=' + str(files[part[5:]])
            argv[index + 1] = ','.join(parts)
        elif value == '-qmp':
            argv[index + 1] = 'unix:' + str(runtime / 'qmp.sock') + ',server,nowait'
        elif value == '-pidfile':
            argv[index + 1] = str(runtime / 'qemu.pid')
    return source, files, argv, receipt_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--storage-trial', type=Path)
    parser.add_argument('--prepare-storage-trial', action='store_true')
    parser.add_argument('--unit', default='papercusp-vm-mac.service')
    parser.add_argument('--launch', action='store_true')
    parser.add_argument('--shutdown', action='store_true')
    parser.add_argument('--ssh-host', default='aviweiss@127.0.0.1')
    parser.add_argument('--ssh-port', type=int, default=2222)
    parser.add_argument('--ssh-key', type=Path, default=Path.home() / '.ssh/papercup-vm-mac')
    parser.add_argument('--shutdown-timeout', type=int, default=240)
    options = parser.parse_args()
    require(sum((options.launch, options.shutdown, options.prepare_storage_trial)) <= 1,
            'launch, shutdown and storage preparation are mutually exclusive')
    if options.shutdown:
        print(json.dumps(verified_shutdown(options.unit, options.runtime, options.ssh_host,
                                           options.ssh_port, options.ssh_key,
                                           timeout=options.shutdown_timeout)))
        return
    if options.prepare_storage_trial:
        require(options.storage_trial is not None and not options.launch, 'prepare needs trial and forbids launch')
        prepare_trial(options.backup, options.runtime, options.storage_trial, options.unit)
        return
    source, files, argv, receipt_path = prepare(options.backup, options.runtime, options.storage_trial)
    if not options.launch:
        print(json.dumps({'ok': True, 'inputs': len(files), 'storageTrial': options.storage_trial is not None}))
        return
    _, originals = generation(options.backup, options.runtime)
    stopped(options.unit, list(files.values()) + list(originals.values()), starting=True)
    pidfile = options.runtime / 'qemu.pid'
    require(not pidfile.exists() and not (options.runtime / 'qmp.sock').exists(), 'control files still exist')
    for name in ('./OpenCore/OpenCore.qcow2', './mac_hdd_ng.img', './builddata-20260820-160g.qcow2'):
        check(files[name])
    os.chdir(options.runtime)
    with (options.runtime / 'qemu-recovery.log').open('ab') as log:
        child = subprocess.Popen(argv, stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        require(child.poll() is None, 'QEMU exited; inspect private recovery log')
        if pidfile.exists() and (options.runtime / 'qmp.sock').exists():
            require(int(pidfile.read_text().strip()) == child.pid, 'QEMU pidfile mismatch')
            receipt = {'ok': True, 'sourceStarttime': source['starttime'], 'pid': child.pid, 'bootedAt': time.time()}
            if options.storage_trial:
                receipt['storageReceiptSha256'] = hashlib.sha256(
                    (options.storage_trial / 'storage-ready.json').read_bytes()).hexdigest()
            receipt_path.write_text(json.dumps(receipt))
            print(json.dumps({'ok': True, 'pid': child.pid, 'controlSocketReady': True}))
            return
        time.sleep(0.1)
    raise RuntimeError('QEMU control files not ready within ten seconds')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        print('recovered-vm: ' + str(error), file=__import__('sys').stderr)
        raise SystemExit(1)

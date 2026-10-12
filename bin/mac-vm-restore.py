#!/usr/bin/env python3
"""Restore only a completed, validated VM preservation generation."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

BACKUP = RUNTIME = TOOLS = DATA = None
UNIT = 'papercusp-vm-mac.service'
SOURCE_BYTES = None


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(pid):
    path = Path('/proc') / str(pid)
    try:
        return (path / 'stat').read_text().rsplit(')', 1)[1].split()[19]
    except FileNotFoundError:
        return None


def execute(*args):
    return subprocess.run(args, check=True)


def validate():
    source = json.loads((BACKUP / 'source.json').read_text())
    preserved = json.loads((BACKUP / 'preserved.json').read_text())
    require(preserved.get('ok') is True, 'preservation is not complete')
    require(preserved.get('sourcePid') == source['pid'], 'preserved PID mismatch')
    require(preserved.get('sourceStarttime') == source['starttime'], 'preserved identity mismatch')
    require(preserved.get('osArchive') == str(BACKUP / 'mac_hdd_ng.img.zst'), 'archive path mismatch')
    require(preserved.get('buildData') == str(DATA), 'build-data path mismatch')
    require((BACKUP / 'mac_hdd_ng.img.zst').is_file() and DATA.is_file(), 'preserved disks missing')
    if 'buildDataRawBackup' in preserved:
        require(preserved['buildDataRawBackup'] == str(BACKUP / 'builddata-raw-preserved.json'),
                'raw build-data proof path mismatch')
        raw = json.loads((BACKUP / 'builddata-raw-preserved.json').read_text())
        repair = json.loads((BACKUP / 'builddata-repair-proof.json').read_text())
        require(raw.get('ok') is True and raw.get('sourceStarttime') == source['starttime'],
                'original raw build-data preservation not verified')
        require(repair.get('ok') is True and repair.get('guestVisibleDataUnchanged') is True,
                'copied build-data repair not verified')
        offset = 0
        for part in raw['parts']:
            path = Path(part['path'])
            require(part['offset'] == offset and path.is_file() and path.stat().st_size == part['bytes'],
                    'original raw build-data segment missing or changed')
            offset += part['bytes']
        require(offset == raw['totalBytes'] and offset > 0, 'original raw build-data backup incomplete')
    for name in ('OVMF_CODE_4M.fd', 'OVMF_VARS-1920x1080.fd', 'OpenCore.qcow2'):
        require((BACKUP / name).is_file(), 'preserved firmware missing')
    require(not RUNTIME.exists(), 'runtime destination already exists; inspect before resuming')
    return source, preserved


def main():
    global BACKUP, RUNTIME, TOOLS, DATA, UNIT, SOURCE_BYTES
    parser = argparse.ArgumentParser()
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--tools', type=Path, required=True)
    parser.add_argument('--source-bytes', type=int, required=True)
    parser.add_argument('--unit', default='papercusp-vm-mac.service')
    parser.add_argument('--restore-after-verified-preservation', action='store_true')
    options = parser.parse_args()
    BACKUP, RUNTIME, TOOLS = options.backup, options.runtime, options.tools
    UNIT, SOURCE_BYTES = options.unit, options.source_bytes
    require(SOURCE_BYTES > 0, 'source byte count must be positive')
    DATA = BACKUP / 'builddata-20260820-160g.qcow2'
    source, preserved = validate()
    free = shutil.disk_usage(BACKUP).free
    retained = 0
    if identity(source['pid']) == source['starttime']:
        state = subprocess.check_output(['systemctl', '--user', 'show', UNIT,
                                         '--property=FreezerState', '--value'], text=True).strip()
        require(state == 'frozen', 'original VM is not frozen')
        original = os.stat('/proc/' + str(source['pid']) + '/fd/17')
        require(original.st_nlink == 0 and original.st_size == SOURCE_BYTES, 'original OS disk changed')
        require(original.st_dev == BACKUP.stat().st_dev,
                'original OS release would reclaim a different filesystem')
        retained = original.st_blocks * 512
    require(free + retained >= SOURCE_BYTES + 20 * 2**30, 'insufficient capacity after original OS release')
    print(json.dumps({'phase': 'preflight', 'ok': True, 'archiveBytes':
                      (BACKUP / 'mac_hdd_ng.img.zst').stat().st_size,
                      'freeBytes': free, 'reclaimableOriginalOSBytes': retained}), flush=True)
    if not options.restore_after_verified_preservation:
        return
    # preserved.json is written only after zstd checksum validation and the
    # independent build-data qcow2 check. Preserve that archive unchanged.
    # The restored OS retains internal snapshots, so no consolidation is needed.
    if identity(source['pid']) == source['starttime']:
        # systemd thaws a frozen unit as part of its stop transaction. A
        # separate thaw after stop --no-block races the pending job and fails
        # even when the original has already exited and released its disks.
        execute('systemctl', '--user', 'stop', '--no-block', UNIT)
        until = time.monotonic() + 240
        while identity(source['pid']) == source['starttime'] and time.monotonic() < until:
            time.sleep(1)
        require(identity(source['pid']) != source['starttime'], 'original QEMU did not stop; do not overwrite')
    require(shutil.disk_usage(BACKUP).free >= SOURCE_BYTES + 20 * 2**30, 'OS space did not release')
    RUNTIME.mkdir(mode=0o700)
    (RUNTIME / 'OpenCore').mkdir(mode=0o700)
    for name in ('OVMF_CODE_4M.fd', 'OVMF_VARS-1920x1080.fd'):
        shutil.copyfile(BACKUP / name, RUNTIME / name)
    shutil.copyfile(BACKUP / 'OpenCore.qcow2', RUNTIME / 'OpenCore/OpenCore.qcow2')
    image = RUNTIME / 'mac_hdd_ng.img'
    partial = RUNTIME / 'mac_hdd_ng.img.partial'
    print(json.dumps({'phase': 'restoring-full-os', 'source': str(BACKUP / 'mac_hdd_ng.img.zst')}), flush=True)
    execute('zstd', '-d', '--sparse', '--no-progress', '-o', str(partial),
            str(BACKUP / 'mac_hdd_ng.img.zst'))
    require(partial.stat().st_size == SOURCE_BYTES, 'restored OS length differs from original')
    # Compare the decoded source stream to the restored image. This preserves
    # evidence independently of qcow2 structural validation and internal snapshots.
    with subprocess.Popen(['zstd', '-d', '-c', str(BACKUP / 'mac_hdd_ng.img.zst')],
                          stdout=subprocess.PIPE) as decoded:
        compared = subprocess.run(['cmp', '-', str(partial)], stdin=decoded.stdout)
        decoded.stdout.close()
        require(decoded.wait() == 0 and compared.returncode == 0, 'restored OS byte comparison failed')
    partial.rename(image)
    for disk in (RUNTIME / 'OpenCore/OpenCore.qcow2', image, DATA):
        execute('qemu-img', 'check', '-f', 'qcow2', str(disk))
    files = [RUNTIME / 'OVMF_CODE_4M.fd', RUNTIME / 'OVMF_VARS-1920x1080.fd',
             RUNTIME / 'OpenCore/OpenCore.qcow2', image, DATA]
    ready = {'ok': True, 'sourceStarttime': source['starttime'], 'osCompared': True,
             'files': {str(path): {'size': path.stat().st_size} for path in files},
             'preservationCompletedAt': preserved['completedAt'], 'restoredAt': time.time()}
    (RUNTIME / 'runtime-ready.json').write_text(json.dumps(ready))
    shutil.copyfile(TOOLS / 'boot-sonoma-durable.sh', RUNTIME / 'boot-sonoma-durable.sh')
    (RUNTIME / 'boot-sonoma-durable.sh').chmod(0o700)
    print(json.dumps({'phase': 'runtime-restored', 'ok': True, 'ready': str(RUNTIME / 'runtime-ready.json')}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        print('restore-runtime: ' + str(error), file=__import__('sys').stderr)
        raise SystemExit(1)

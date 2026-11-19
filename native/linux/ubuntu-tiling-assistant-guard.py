#!/usr/bin/python3
"""Guard Ubuntu Tiling Assistant 46's panel drag callback (WI-6554700010053174).

GNOME's Meta.Window.get_work_area_current_monitor() aborts the whole shell if
the window no longer has a logical monitor. The Ubuntu extension calls it on
every window before checking eligibility. Patch that caller, keeping tiling.
An APT post-invoke hook reapplies the validated patch after package updates;
unknown source fails visibly without changing it. No display/session restart.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

EXTENSION = Path('/usr/share/gnome-shell/extensions/tiling-assistant@ubuntu.com/extension.js')
INSTALL = Path('/usr/local/lib/papercusp/ubuntu-tiling-assistant-guard.py')
HOOK = Path('/etc/apt/apt.conf.d/99papercusp-tiling-assistant-guard')
BACKUPS = Path('/var/lib/papercusp/tiling-assistant-guard')
UUID = 'tiling-assistant@ubuntu.com'
HOOK_CONTENT = ('// WI-6554700010053174: preserve the monitorless-window crash fix.\n'
                'DPkg::Post-Invoke { "/usr/bin/python3 ' + str(INSTALL) + ' --apply"; };\n')
MARKER = '// Papercusp WI-6554700010053174: reject monitorless windows before native calls.'
BEFORE = '''            return allWindowsByStacking.find(w => {
                const rect = w.get_frame_rect();
                const workArea = w.get_work_area_current_monitor();
                return w.is_on_primary_monitor() &&
                        w.showing_on_its_workspace() &&
                        w.get_window_type() !== Meta.WindowType.DESKTOP &&
                        (w.maximized_vertically || w.tiledRect?.y === workArea.y) &&
                        stageX > rect.x && stageX < rect.x + rect.width;
            });'''
AFTER = '''            return allWindowsByStacking.find(w => {
                ''' + MARKER + '''
                const monitor = w.get_monitor();
                if (monitor < 0 || monitor >= global.display.get_n_monitors() ||
                        !w.is_on_primary_monitor() || !w.showing_on_its_workspace() ||
                        w.get_window_type() === Meta.WindowType.DESKTOP)
                    return false;
                const rect = w.get_frame_rect();
                const workArea = w.get_work_area_current_monitor();
                return (w.maximized_vertically || w.tiledRect?.y === workArea.y) &&
                        stageX > rect.x && stageX < rect.x + rect.width;
            });'''


def patch_source(source):
    if source.count(AFTER) == 1 and source.count(MARKER) == 1 and BEFORE not in source:
        return source
    if source.count(BEFORE) != 1 or MARKER in source:
        raise ValueError('Unsupported Tiling Assistant panel callback; source left unchanged. '
                         'Review the Ubuntu package before updating the guard.')
    return source.replace(BEFORE, AFTER, 1)


def atomic_write(path, data, mode=0o644):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Refusing symlink: ' + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
            os.fchmod(output.fileno(), mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def apply_guard(extension=EXTENSION, backups=BACKUPS, check=False):
    extension, backups = Path(extension), Path(backups)
    if not extension.exists():
        return {'status': 'not-installed', 'path': str(extension)}
    if extension.is_symlink():
        raise ValueError('Refusing symlink: ' + str(extension))
    before = extension.read_bytes()
    after = patch_source(before.decode('utf-8')).encode('utf-8')
    digest = hashlib.sha256(after).hexdigest()
    if before == after:
        return {'status': 'guarded', 'path': str(extension), 'sha256': digest}
    if check:
        raise ValueError('Tiling Assistant panel callback is not guarded')
    original_digest = hashlib.sha256(before).hexdigest()
    backup = backups / (original_digest + '.js')
    if backup.exists():
        if backup.read_bytes() != before:
            raise ValueError('Original-source backup differs: ' + str(backup))
    else:
        atomic_write(backup, before)
    # Do not overwrite a concurrent package replacement with an older version.
    if extension.read_bytes() != before:
        raise ValueError('Tiling Assistant changed during patching; source left unchanged')
    atomic_write(extension, after, stat.S_IMODE(extension.stat().st_mode))
    return {'status': 'patched', 'path': str(extension), 'sha256': digest,
            'originalSha256': original_digest, 'backup': str(backup)}


def install_guard():
    if os.geteuid() != 0:
        raise PermissionError('--install requires root for the Ubuntu package and APT hook')
    if HOOK.exists() and HOOK.read_text() != HOOK_CONTENT:
        raise ValueError('Refusing to replace an unknown APT hook: ' + str(HOOK))
    result = apply_guard()
    atomic_write(INSTALL, Path(__file__).read_bytes())
    atomic_write(HOOK, HOOK_CONTENT.encode('utf-8'))
    return {**result, 'installed': str(INSTALL), 'aptHook': str(HOOK)}


def autostart_path():
    config = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))
    return config / 'autostart/papercusp-tiling-assistant-restore.desktop'


def bus_call(method, arguments=(), shell=True, run=subprocess.run):
    result = run(['gdbus', 'call', '--address', 'unix:path=/run/user/' + str(os.getuid()) + '/bus',
                  '--dest', 'org.gnome.Shell' if shell else 'org.freedesktop.DBus',
                  '--object-path', '/org/gnome/Shell' if shell else '/org/freedesktop/DBus',
                  '--method', method, *arguments], capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise ValueError(result.stderr.strip() or 'Desktop D-Bus call failed')
    return result.stdout.strip()


def current_shell_pid(run=subprocess.run):
    value = bus_call('org.freedesktop.DBus.GetConnectionUnixProcessID', ['org.gnome.Shell'], False, run)
    match = re.fullmatch(r'\(uint32 ([0-9]+),\)', value)
    if not match:
        raise ValueError('Cannot identify the current GNOME Shell: ' + value)
    return int(match[1])


def activation_desktop(previous_pid):
    return ('[Desktop Entry]\nType=Application\n'
            'Name=Restore repaired Ubuntu Tiling Assistant\nNoDisplay=true\n'
            'X-GNOME-Autostart-Phase=Applications\n'
            'Exec=/usr/bin/python3 ' + str(INSTALL) + ' --activate-on-login --previous-shell-pid=' +
            str(previous_pid) + '\n')


def defer_activation(extension=EXTENSION, autostart=None, run=subprocess.run):
    # GNOME 46's ReloadExtension is explicitly unsupported. Keep this desktop
    # alive and protected, then restore the repaired feature in a fresh shell.
    if apply_guard(extension, check=True)['status'] != 'guarded':
        raise ValueError('The repaired extension must be installed first')
    previous_pid = current_shell_pid(run)
    autostart = Path(autostart) if autostart is not None else autostart_path()
    content = activation_desktop(previous_pid)
    if autostart.exists() and autostart.read_text() != content:
        raise ValueError('Refusing to replace an unknown activation entry: ' + str(autostart))
    atomic_write(autostart, content.encode('utf-8'))
    if bus_call('org.gnome.Shell.Extensions.DisableExtension', [UUID], run=run) != '(true,)':
        raise ValueError('Could not disable the old in-memory Tiling Assistant; activation entry retained')
    return {'status': 'protected-until-next-login', 'previousShellPid': previous_pid,
            'restoreAtNextLogin': str(autostart)}


def activate_on_login(previous_pid, extension=EXTENSION, autostart=None, run=subprocess.run):
    autostart = Path(autostart) if autostart is not None else autostart_path()
    if autostart.read_text() != activation_desktop(previous_pid):
        raise ValueError('Activation entry changed; leaving it and extension settings untouched')
    if current_shell_pid(run) == previous_pid:
        raise ValueError('A fresh desktop login is required to load the repaired module')
    if apply_guard(extension, check=True)['status'] != 'guarded':
        raise ValueError('The repaired extension is not installed; activation entry retained')
    if bus_call('org.gnome.Shell.Extensions.EnableExtension', [UUID], run=run) != '(true,)':
        raise ValueError('Repaired Tiling Assistant did not enable; activation entry retained')
    autostart.unlink()
    return {'status': 'activated', 'previousShellPid': previous_pid}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--install', action='store_true')
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--defer-activation', action='store_true')
    mode.add_argument('--activate-on-login', action='store_true')
    parser.add_argument('--previous-shell-pid', type=int)
    args = parser.parse_args()
    try:
        if args.activate_on_login and not args.previous_shell_pid:
            raise ValueError('--activate-on-login requires --previous-shell-pid')
        result = (install_guard() if args.install else defer_activation() if args.defer_activation else
                  activate_on_login(args.previous_shell_pid) if args.activate_on_login else
                  apply_guard(check=args.check))
        print(json.dumps(result))
    except (OSError, ValueError) as error:
        parser.exit(1, 'Tiling Assistant crash guard: ' + str(error) + '\n')

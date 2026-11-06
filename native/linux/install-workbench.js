import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = 'workbench@papercusp.ai';
const SCHEMA = 'org.gnome.shell.extensions.papercusp-workbench';
const decode = bytes => new TextDecoder().decode(bytes).trim();
const exists = path => GLib.file_test(path, GLib.FileTest.EXISTS);

function configurePui(extension, pui) {
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
        GLib.build_filenamev([extension, 'schemas']), Gio.SettingsSchemaSource.get_default(), false);
    const preferences = new Gio.Settings({settings_schema: schemaSource.lookup(SCHEMA, false)});
    if (pui && GLib.file_test(pui, GLib.FileTest.IS_EXECUTABLE) && preferences.get_user_value('pui-path') === null)
        preferences.set_string('pui-path', pui);
}

// Called under the desktop's cross-process file lock. GNOME owns extraction
// and schema compilation; its install operation does not reset dconf choices.
export function installWorkbench(archive, {reload = reloadWorkbench, pui = null} = {}) {
    const [, bytes] = GLib.file_get_contents(archive);
    const sha256 = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, bytes);
    const data = GLib.get_user_data_dir();
    const extension = GLib.build_filenamev([data, 'gnome-shell/extensions', UUID]);
    const marker = GLib.build_filenamev([data, 'papercusp/workbench-gnome.sha256']);
    const installed = exists(GLib.build_filenamev([extension, 'schemas/gschemas.compiled']));
    if (installed && exists(marker) && decode(GLib.file_get_contents(marker)[1]) === sha256) {
        configurePui(extension, pui);
        Gio.Settings.sync();
        return {changed: false, sha256};
    }
    const firstInstall = !exists(extension) && !exists(marker);
    const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const enabled = shell.get_strv('enabled-extensions');
    const disabled = shell.get_strv('disabled-extensions');
    const child = Gio.Subprocess.new(['gnome-extensions', 'install', '--force', archive],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    const [, stdout, stderr] = child.communicate_utf8(null, null);
    if (!child.get_successful()) throw new Error(stderr.trim() || stdout.trim() || 'Workbench installation failed');
    // Shell login does not inherit the Server's sidecar/bin PATH. Record the
    // shipped executable only while this account has no explicit selection.
    configurePui(extension, pui);
    // A package upgrade never re-enables a surface the account switched off.
    if (firstInstall && !enabled.includes(UUID) && !disabled.includes(UUID))
        shell.set_strv('enabled-extensions', [...enabled, UUID]);
    Gio.Settings.sync();
    let loginRequired = false;
    let reloadError = null;
    try { reload(UUID); } catch (error) { loginRequired = true; reloadError = String(error.message || error); }
    GLib.mkdir_with_parents(GLib.path_get_dirname(marker), 0o700);
    GLib.file_set_contents(marker, sha256 + '\n');
    return {changed: true, firstInstall, sha256, loginRequired, reloadError};
}

function reloadWorkbench(uuid) {
    // Reload the installed module in the current Shell; a missing Shell bus
    // leaves the persistent registration ready for the next desktop login.
    Gio.DBus.session.call_sync('org.gnome.Shell', '/org/gnome/Shell',
        'org.gnome.Shell.Extensions', 'ReloadExtension', new GLib.Variant('(s)', [uuid]),
        null, Gio.DBusCallFlags.NONE, 5000, null);
}

if (ARGV[0] === '--install') {
    try {
        if (GLib.get_user_name() === 'root') throw new Error('Workbench must be installed by the signed-in desktop account');
        print(JSON.stringify(installWorkbench(ARGV[1], {pui: ARGV[2] || null})));
    } catch (error) { printerr(String(error.message || error)); imports.system.exit(1); }
}

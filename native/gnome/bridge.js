import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The PUI command owns discovery, IPC/HTTP, credentials and its read allowlist.
// No shell, bearer file, local server or second authorization implementation.
export function nativeRead(pui, request, cancellable = null) {
    if (typeof pui !== 'string' || !pui.trim()) return Promise.reject(new Error('PUI is not configured'));
    return new Promise((resolve, reject) => {
        let process;
        try {
            process = Gio.Subprocess.new([pui, 'native-read'],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) { reject(error); return; }
        let timedOut = false;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 22000, () => {
            timer = null; timedOut = true; process.force_exit(); return GLib.SOURCE_REMOVE;
        });
        const cancel = cancellable?.connect(() => process.force_exit());
        process.communicate_utf8_async(JSON.stringify(request), cancellable, (child, result) => {
            if (timer) GLib.source_remove(timer);
            if (cancel) cancellable.disconnect(cancel);
            try {
                const [, stdout, stderr] = child.communicate_utf8_finish(result);
                if (timedOut) throw new Error('The selected operator did not respond in time');
                if (!child.get_successful()) throw new Error(stderr.trim() || stdout.trim() || 'PUI read failed');
                const payload = JSON.parse(stdout);
                if (payload.ok === false || payload.error || !Array.isArray(payload.rows))
                    throw new Error(payload.error || 'The operator returned no row envelope');
                resolve(payload);
            } catch (error) { reject(error); }
        });
    });
}

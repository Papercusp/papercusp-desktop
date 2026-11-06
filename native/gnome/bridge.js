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

// One GTK helper per Shell extension, with correlated, asynchronous pipe IO.
// A dead helper rejects outstanding reads; the next refresh starts a new one.
export class ResidentBridge {
    constructor(helperPath) {
        this.helperPath = helperPath; this._serial = 0; this._pending = new Map();
        this._writes = Promise.resolve(); this._closed = false;
    }
    read(pui, request) {
        if (this._closed) return Promise.reject(new Error('Workbench has stopped'));
        if (this._child && this._pui !== pui) this._stop(new Error('Selected PUI connection changed'));
        if (!this._child) {
            try {
                this._pui = pui;
                this._cancel = new Gio.Cancellable();
                this._child = Gio.Subprocess.new(['gjs', '-m', this.helperPath, pui],
                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
                this._input = new Gio.DataInputStream({base_stream: this._child.get_stdout_pipe()});
                this._receive(this._child, this._cancel);
            } catch (error) { this._stop(error); return Promise.reject(error); }
        }
        const id = ++this._serial, child = this._child, cancel = this._cancel;
        return new Promise((resolve, reject) => {
            const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 24000, () => {
                this._stop(new Error('Native helper did not respond in time')); return GLib.SOURCE_REMOVE;
            });
            this._pending.set(id, {resolve, reject, timer});
            const bytes = new TextEncoder().encode(JSON.stringify({id, request}) + '\n');
            this._writes = this._writes.then(() => new Promise((done, fail) => {
                child.get_stdin_pipe().write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
                    try { stream.write_all_finish(result); done(); } catch (error) { fail(error); }
                });
            })).catch(error => { if (this._child === child) this._stop(error); });
        });
    }
    _receive(child, cancel) {
        const input = this._input;
        input.read_line_async(GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
            if (this._child !== child) return;
            try {
                const [line] = stream.read_line_finish_utf8(result);
                if (line === null) throw new Error('Native helper exited; refresh to reconnect');
                const message = JSON.parse(line), pending = this._pending.get(message.id);
                if (!pending) throw new Error('Native helper returned an unknown request');
                this._pending.delete(message.id); GLib.source_remove(pending.timer);
                if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.payload);
                this._receive(child, cancel);
            } catch (error) { this._stop(error); }
        });
    }
    _stop(error) {
        this._cancel?.cancel();
        const child = this._child;
        if (child) {
            // EOF gives the helper time to cancel/reap its PUI descendants.
            try { child.get_stdin_pipe().close(null); } catch { /* already closed */ }
            let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                timer = null; child.force_exit(); return GLib.SOURCE_REMOVE;
            });
            child.wait_async(null, (process, result) => {
                try { process.wait_finish(result); } catch { /* process already reaped */ }
                if (timer) GLib.source_remove(timer);
            });
        }
        this._child = null; this._input = null; this._cancel = null;
        this._writes = Promise.resolve();
        for (const pending of this._pending.values()) {
            GLib.source_remove(pending.timer); pending.reject(error);
        }
        this._pending.clear();
    }
    close() { this._closed = true; this._stop(new Error('Workbench has stopped')); }
}

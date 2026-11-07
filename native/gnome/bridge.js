import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The PUI command owns discovery, IPC/HTTP, credentials and its read allowlist.
// No shell, bearer file, local server or second authorization implementation.
export function nativeRead(pui, request, cancellable = null, command = 'native-read') {
    if (typeof pui !== 'string' || !pui.trim()) return Promise.reject(new Error('PUI is not configured'));
    if (!['native-read', 'native-inbox'].includes(command)) return Promise.reject(new Error('Unsupported native operation'));
    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).length > 64 * 1024) return Promise.reject(new Error('Native request exceeds its limit'));
    return new Promise((resolve, reject) => {
        let process;
        try {
            process = Gio.Subprocess.new([pui, command],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) { reject(error); return; }
        let timedOut = false;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, command === 'native-inbox' ? 65000 : 22000, () => {
            timer = null; timedOut = true; process.force_exit(); return GLib.SOURCE_REMOVE;
        });
        const cancel = cancellable?.connect(() => process.force_exit());
        process.communicate_utf8_async(body, cancellable, (child, result) => {
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

// Canonical PUI newline frames are delivered as they arrive. This is a local
// pipe lifetime only: cancelling it never claims to cancel a durable chat turn.
export async function nativeStream(pui, request, onFrame, cancellable = null, command = 'native-chat') {
    if (typeof pui !== 'string' || !pui.trim()) throw new Error('PUI is not configured');
    if (!['native-chat', 'native-cards'].includes(command) || typeof onFrame !== 'function')
        throw new Error('Unsupported native stream');
    const body = new TextEncoder().encode(JSON.stringify(request));
    if (body.length > 64 * 1024) throw new Error('Native request exceeds its limit');
    if (cancellable?.is_cancelled()) throw new Error('Native stream stopped; reconcile the saved reply');
    const child = Gio.Subprocess.new([pui, command], Gio.SubprocessFlags.STDIN_PIPE |
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
    let failure = null, stderr = '', frames = 0;
    const fail = error => { failure ||= error; child.force_exit(); };
    let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 615000, () => {
        timer = null;
        fail(new Error('Native stream deadline; reconcile the saved reply')); return GLib.SOURCE_REMOVE;
    });
    const cancel = cancellable?.connect(() => fail(new Error('Native stream stopped; reconcile the saved reply')));
    const line = input => new Promise((resolve, reject) => input.read_line_async(GLib.PRIORITY_DEFAULT, null,
        (stream, result) => { try { resolve(stream.read_line_finish_utf8(result)[0]); } catch (error) { reject(error); } }));
    const input = new Gio.DataInputStream({base_stream: child.get_stdout_pipe()});
    const errors = new Gio.DataInputStream({base_stream: child.get_stderr_pipe()});
    try {
        const outcomes = await Promise.allSettled([
            (async () => {
                for (;;) {
                    const text = await line(input); if (text === null) return;
                    if (failure) continue;
                    if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('Native stream frame exceeds its limit');
                    const frame = JSON.parse(text);
                    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
                        typeof frame.event !== 'string' || !frame.event || !frame.environment ||
                        !Object.hasOwn(frame, 'data')) throw new Error('Invalid native stream frame');
                    ++frames; onFrame(frame);
                }
            })().catch(error => { fail(error); throw error; }),
            (async () => {
                for (;;) { const text = await line(errors); if (text === null) return; stderr = (stderr + text + '\n').slice(-65536); }
            })().catch(error => { fail(error); throw error; }),
            new Promise((resolve, reject) => child.wait_async(null, (process, result) => {
                try { process.wait_finish(result); resolve(); } catch (error) { fail(error); reject(error); }
            })),
            new Promise((resolve, reject) => child.get_stdin_pipe().write_all_async(body, GLib.PRIORITY_DEFAULT, null,
                (stream, result) => {
                    try { stream.write_all_finish(result); stream.close(null); resolve(); }
                    catch (error) { fail(error); reject(error); }
                })),
        ]);
        const rejected = outcomes.find(outcome => outcome.status === 'rejected');
        if (failure || rejected) throw failure || rejected.reason;
        if (!child.get_successful()) throw new Error(stderr.trim() || 'PUI stream failed; reconcile before sending again');
        if (!frames) throw new Error('PUI stream returned no frames');
    } finally {
        // The process has been reaped before resolving or rejecting this call.
        if (timer) GLib.source_remove(timer);
        if (cancel) cancellable.disconnect(cancel);
    }
}

// One GTK helper per Shell extension, with correlated, asynchronous pipe IO.
// A dead helper rejects outstanding reads; the next refresh starts a new one.
export class ResidentBridge {
    constructor(helperPath) {
        this.helperPath = helperPath; this._serial = 0; this._pending = new Map();
        this._writes = Promise.resolve(); this._closed = false;
    }
    inbox(pui, request) { return this.read(pui, request, 'native-inbox'); }
    read(pui, request, command = 'native-read') {
        return this._request(pui, request, command).done;
    }
    stream(pui, request, onFrame, command = 'native-chat') {
        return this._request(pui, request, command, onFrame);
    }
    _request(pui, request, command, onFrame = null) {
        const refused = message => ({done: Promise.reject(new Error(message)), cancel() {}});
        if (this._closed) return refused('Workbench has stopped');
        const streaming = ['native-chat', 'native-cards'].includes(command);
        if ((!streaming && !['native-read', 'native-inbox'].includes(command)) ||
            (streaming && typeof onFrame !== 'function') || (!streaming && onFrame))
            return refused('Unsupported native operation');
        const bytes = new TextEncoder().encode(JSON.stringify({request, command}));
        if (bytes.length > 64 * 1024) return refused('Native request exceeds its limit');
        if (this._child && this._pui !== pui) this._stop(new Error('Selected PUI connection changed'));
        if (!this._child) {
            try {
                this._pui = pui;
                this._cancel = new Gio.Cancellable();
                this._child = Gio.Subprocess.new(['gjs', '-m', this.helperPath, pui],
                    Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE);
                this._input = new Gio.DataInputStream({base_stream: this._child.get_stdout_pipe()});
                this._receive(this._child, this._cancel);
            } catch (error) { this._stop(error); return {done: Promise.reject(error), cancel() {}}; }
        }
        const id = ++this._serial, child = this._child, cancel = this._cancel;
        const done = new Promise((resolve, reject) => {
            const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, streaming ? 617000 : command === 'native-inbox' ? 67000 : 24000, () => {
                this._stop(new Error('Native helper did not respond in time')); return GLib.SOURCE_REMOVE;
            });
            this._pending.set(id, {resolve, reject, timer, onFrame, streaming, failure: null});
            this._write(child, cancel, {id, request, command});
        });
        return {done, cancel: () => {
            const pending = this._pending.get(id);
            if (!pending?.streaming || pending.failure) return;
            pending.failure = new Error('Native stream stopped; reconcile the saved reply');
            this._write(child, cancel, {id, cancel: true});
        }};
    }
    _write(child, cancel, message) {
        const bytes = new TextEncoder().encode(JSON.stringify(message) + '\n');
        this._writes = this._writes.then(() => new Promise((done, fail) => {
            child.get_stdin_pipe().write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancel, (stream, result) => {
                try { stream.write_all_finish(result); done(); } catch (error) { fail(error); }
            });
        })).catch(error => { if (this._child === child) this._stop(error); });
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
                if (Object.hasOwn(message, 'frame')) {
                    if (!pending.streaming) throw new Error('Native helper returned an unexpected stream');
                    if (!pending.failure) {
                        try { pending.onFrame(message.frame); }
                        catch (error) { pending.failure = error; this._write(child, cancel, {id: message.id, cancel: true}); }
                    }
                    this._receive(child, cancel); return;
                }
                this._pending.delete(message.id); GLib.source_remove(pending.timer);
                if (pending.failure || message.error) pending.reject(pending.failure || new Error(message.error));
                else if (pending.streaming && message.done !== true) pending.reject(new Error('Native stream completion is missing'));
                else pending.resolve(message.payload);
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

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import {nativeRead} from './bridge.js';

// The Shell owns the panels. This GTK4/libadwaita process has no windows,
// credentials, server or alternate model store. Its parent owns its lifetime;
// EOF cancels outstanding PUI reads and exits, even after a Shell crash.
const application = new Adw.Application({application_id: 'ai.papercusp.Workbench.Helper',
    flags: Gio.ApplicationFlags.NON_UNIQUE});
const input = new Gio.DataInputStream({base_stream: new GioUnix.InputStream({fd: 0, close_fd: false})});
const cancellable = new Gio.Cancellable();
const pending = new Set();
const pui = ARGV[0] || 'pui';
let stopping = false;
function stop() {
    if (stopping) return;
    stopping = true; cancellable.cancel(); application.release(); application.quit();
}
function readNext() {
    input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (stream, result) => {
        try {
            const [line] = stream.read_line_finish_utf8(result);
            if (line === null) { stop(); return; }
            const message = JSON.parse(line);
            if (!Number.isSafeInteger(message.id) || message.id < 1 || pending.has(message.id) ||
                !message.request || typeof message.request !== 'object' || Array.isArray(message.request))
                throw new Error('Malformed native helper request');
            pending.add(message.id);
            nativeRead(pui, message.request, cancellable, message.command || 'native-read')
                .then(payload => { if (!stopping) print(JSON.stringify({id: message.id, payload})); })
                .catch(error => { if (!stopping) print(JSON.stringify({id: message.id, error: String(error.message || error)})); })
                .finally(() => pending.delete(message.id));
            readNext();
        } catch (error) {
            if (!stopping) printerr(String(error.message || error));
            stop();
        }
    });
}
application.connect('activate', () => { application.hold(); readNext(); });
application.run(['papercusp-workbench-helper']);

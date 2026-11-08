import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {canonicalBase64} from './panel-model.mjs';

// Devices live in the existing windowless helper. No audio, device handle or
// pipeline crosses into Shell, and each operation owns its private temp files.
// Factory injection is local to maintained device tests, never a wire argument.
export class AudioDevices {
    constructor({source = 'autoaudiosrc', sink = 'autoaudiosink', durationMs = 60000} = {}) {
        this.source = source; this.sink = sink; this.durationMs = durationMs; this.active = null;
    }
    record(cancel, onState) { return this._run('record', cancel, onState); }
    play(audio, cancel, onState) {
        if (!canonicalBase64(audio, 11_184_812)) throw new Error('Invalid or oversized playback audio');
        return this._run('play', cancel, onState, audio);
    }
    _run(kind, cancel, onState, audio = null) {
        if (this.active) throw new Error('Finish the current audio device operation first');
        const operation = {stop: () => { operation.stopRequested = true; operation.eos?.(); }};
        this.active = operation;
        operation.done = (async () => {
            let directory, file, pipeline, bus, watch = 0, timer = 0, monitor = 0, cancelId = 0;
            try {
                // Missing audio support must not stop unrelated native reads.
                const {default: Gst} = await import('gi://Gst?version=1.0'); Gst.init(null);
                if (cancel?.is_cancelled()) throw new Error('Audio stopped; your draft was preserved');
                directory = GLib.dir_make_tmp('papercusp-voice-XXXXXX');
                file = Gio.File.new_for_path(GLib.build_filenamev([directory, 'audio']));
                if (kind === 'play') file.replace_contents(GLib.base64_decode(audio), null, false,
                    Gio.FileCreateFlags.PRIVATE, null);
                else file.create(Gio.FileCreateFlags.PRIVATE, null).close(null);
                pipeline = Gst.parse_launch(kind === 'record' ?
                    this.source + ' ! audioconvert ! audioresample ! audio/x-raw,format=S16LE,rate=16000,channels=1 ! wavenc ! filesink name=audiofile' :
                    'filesrc name=audiofile ! decodebin ! audioconvert ! audioresample ! ' + this.sink);
                pipeline.get_by_name('audiofile').set_property('location', file.get_path());
                bus = pipeline.get_bus(); bus.add_signal_watch();
                await new Promise((resolve, reject) => {
                    let settled = false, ready = false, stopping = false;
                    const fail = error => { if (!settled) { settled = true; reject(error); } };
                    operation.eos = () => {
                        if (settled || stopping) return;
                        stopping = true;
                        if (kind !== 'record' || !pipeline.send_event(Gst.Event.new_eos()))
                            fail(new Error('Audio stopped; your draft was preserved'));
                        if (timer) GLib.source_remove(timer);
                        timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                            timer = 0; fail(new Error('Audio device did not finalize the recording'));
                            return GLib.SOURCE_REMOVE;
                        });
                    };
                    watch = bus.connect('message', (_bus, message) => {
                        try {
                            if (message.type === Gst.MessageType.ERROR) {
                                const [error] = message.parse_error(); fail(new Error('Audio device unavailable: ' + error.message));
                            } else if (message.type === Gst.MessageType.EOS) {
                                if (!settled) { settled = true; resolve(); }
                            } else if (message.type === Gst.MessageType.STATE_CHANGED && message.src === pipeline) {
                                const [, state] = message.parse_state_changed();
                                if (state === Gst.State.PLAYING && !ready) {
                                    ready = true; onState?.({phase: kind === 'record' ? 'recording' : 'playing'});
                                    if (operation.stopRequested) operation.eos();
                                }
                            }
                        } catch (error) { fail(error); }
                    });
                    cancelId = cancel?.connect(() => fail(new Error('Audio stopped; your draft was preserved'))) || 0;
                    // Cancellation can occur between import and signal connection.
                    if (cancel?.is_cancelled()) { fail(new Error('Audio stopped; your draft was preserved')); return; }
                    timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, kind === 'record' ? this.durationMs : 180000, () => {
                        timer = 0;
                        if (kind === 'record' && ready) operation.eos();
                        else fail(new Error('Audio device did not finish in time'));
                        return GLib.SOURCE_REMOVE;
                    });
                    monitor = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                        if (kind === 'record' && file.query_exists(null) &&
                            file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() > 1_950_000)
                            fail(new Error('Recording exceeded one minute; your draft was preserved'));
                        return GLib.SOURCE_CONTINUE;
                    });
                    if (pipeline.set_state(Gst.State.PLAYING) === Gst.StateChangeReturn.FAILURE)
                        fail(new Error('Audio device could not start'));
                });
                // NULL releases microphone/speaker handles before any completion.
                pipeline.set_state(Gst.State.NULL);
                if (kind === 'play') return {played: true};
                const [, bytes] = file.load_contents(null);
                if (bytes.length <= 44 || bytes.length > 1_950_000 ||
                    new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' ||
                    new TextDecoder().decode(bytes.slice(8, 12)) !== 'WAVE')
                    throw new Error('No usable recording; your draft was preserved');
                return {audioBase64: GLib.base64_encode(bytes)};
            } finally {
                if (timer) GLib.source_remove(timer);
                if (monitor) GLib.source_remove(monitor);
                if (cancelId) cancel.disconnect(cancelId);
                if (watch) bus.disconnect(watch);
                if (bus) bus.remove_signal_watch();
                if (pipeline) pipeline.set_state(1); // Gst.State.NULL, also if import/start failed.
                if (file?.query_exists(null)) file.delete(null);
                if (directory) Gio.File.new_for_path(directory).delete(null);
                if (this.active === operation) this.active = null;
            }
        })();
        return operation;
    }
}

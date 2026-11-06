import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ResidentBridge} from './bridge.js';
import {PanelState, SOURCES, sourceRequests, detailRequest, readRows, rebindShortcuts} from './panel-model.mjs';

function label(text, style = '') {
    const actor = new St.Label({text: String(text), style_class: style, x_expand: true});
    actor.clutter_text.set_line_wrap(true);
    return actor;
}
function button(text, callback) {
    const actor = new St.Button({label: text, can_focus: true, style_class: 'button'});
    actor.connect('clicked', callback);
    return actor;
}

// Shell-owned actors have no Dock/taskbar/Alt-Tab identity or window chrome.
// Each visible surface owns its actors, retained state and async generations.
export default class Workbench extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._states = new Map([['quick-access', new PanelState()], ['goals', new PanelState()]]);
        this._states.get('goals').scope = 'goals';
        this._views = new Map();
        this._bridge = new ResidentBridge(this.path + '/helper.js');
        this._bindings = new Map();
        this._acceleratorSignal = global.display.connect('accelerator-activated', (_display, id) => {
            const match = [...this._bindings].find(([, binding]) => binding.id === id);
            if (match && this._settings.get_boolean('enabled')) this._toggle(match[0]);
        });
        this._settingsSignal = this._settings.connect('changed', () => this._configure());
        this._focusSignal = global.display.connect('notify::focus-window', () => {
            for (const [surface, state] of this._states) {
                state.outsideFocus();
                if (!state.visible) this._hide(surface, false);
            }
        });
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._position());
        this._capture = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_PROPAGATE;
            // Native Wayland seat events can have no source actor during
            // capture. Pick at the actual pointer before judging outside focus.
            const target = event.get_source() || global.stage.get_actor_at_pos(
                Clutter.PickMode.REACTIVE, ...event.get_coords());
            for (const [surface, view] of this._views) {
                const state = this._states.get(surface);
                if (state.pinned || (target && view.panel.contains(target))) continue;
                state.outsideFocus();
                this._hide(surface, false);
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._configure();
    }
    _configure() {
        if (this._revertingSettings) return;
        if (!this._settings.get_boolean('enabled')) {
            for (const binding of this._bindings.values()) global.display.ungrab_accelerator(binding.id);
            this._bindings.clear();
            for (const surface of [...this._views.keys()]) this._hide(surface, false);
            this._bridge.close();
            this._bridge = new ResidentBridge(this.path + '/helper.js');
            return;
        }
        const desired = Object.fromEntries([...this._states.keys()]
            .map(name => [name, this._settings.get_strv(name)[0] || '']));
        try {
            this._bindings = rebindShortcuts(this._bindings, desired, {
                grab: accelerator => {
                    const id = global.display.grab_accelerator(accelerator, Meta.KeyBindingFlags.NONE);
                    if (id) Main.wm.allowKeybinding(Meta.external_binding_name_for_action(id), Shell.ActionMode.NORMAL);
                    return id;
                },
                ungrab: id => global.display.ungrab_accelerator(id),
            });
        } catch (error) {
            Main.notifyError('Workbench shortcut unchanged', String(error.message || error));
            this._revertingSettings = true;
            for (const name of this._states.keys()) {
                const previous = this._bindings.get(name)?.accelerator;
                this._settings.set_strv(name, previous ? [previous] : []);
            }
            this._revertingSettings = false;
        }
        this._position();
    }
    _toggle(surface) {
        const state = this._states.get(surface);
        if (!state) return;
        if (state.visible) { this._hide(surface, true); return; }
        for (const [other, otherState] of this._states)
            if (other !== surface && !otherState.pinned) this._hide(other, false);
        state.visible = true;
        this._build(surface);
        this._refresh(surface);
    }
    _position() {
        const monitor = Main.layoutManager.currentMonitor || Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const views = [...this._views.values()];
        const width = Math.max(240, Math.min(this._settings.get_int('panel-width'),
            Math.floor((area.width - 32) / Math.max(1, views.length)) - 12));
        views.forEach((view, index) => {
            view.panel.set_position(area.x + area.width - (index + 1) * (width + 12) - 4, area.y + 16);
            view.panel.set_size(width, Math.max(200, area.height - 32));
        });
    }
    _build(surface) {
        this._destroyActors(surface);
        const state = this._states.get(surface);
        const panel = new St.BoxLayout({vertical: true, reactive: true, can_focus: true,
            style_class: 'papercusp-panel', accessible_name: 'Papercusp native Workbench ' + surface});
        const view = {panel, priorWindow: global.display.focus_window, searchTimer: null};
        this._views.set(surface, view);
        const header = new St.BoxLayout({style_class: 'papercusp-panel-header'});
        header.add_child(label(surface === 'goals' ? 'Goals' : 'Quick Access', 'papercusp-panel-title'));
        const pin = button(state.pinned ? 'Unpin' : 'Pin', () => {
            state.pinned = !state.pinned;
            pin.label = state.pinned ? 'Unpin' : 'Pin';
        });
        header.add_child(pin);
        header.add_child(button('Refresh', () => this._refresh(surface)));
        header.add_child(button('Close', () => this._hide(surface, true)));
        panel.add_child(header);
        view.search = new St.Entry({text: state.query, hint_text: 'Search plans, agents, reports and goals',
            can_focus: true, x_expand: true, accessible_name: 'Search Workbench'});
        // Clutter.Text consumes Enter and emits activate instead of bubbling
        // key-press-event to the panel. Keep the focused search route native.
        view.search.clutter_text.connect('activate', () => {
            if (!state.detail) this._activate(surface, state.selected());
        });
        view.search.clutter_text.connect('text-changed', () => {
            state.query = view.search.get_text();
            // Invalidate old completions immediately, before the debounce.
            ++state.generation;
            state.detail = null; ++state.detailGeneration;
            this._render(surface);
            if (view.searchTimer) GLib.source_remove(view.searchTimer);
            view.searchTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 180, () => {
                view.searchTimer = null; this._refresh(surface); return GLib.SOURCE_REMOVE;
            });
        });
        panel.add_child(view.search);
        if (surface === 'quick-access') {
            const scopes = new St.BoxLayout({style_class: 'papercusp-panel-scopes'});
            for (const scope of ['all', ...Object.keys(SOURCES)])
                scopes.add_child(button(scope, () => {
                    state.scope = scope; state.detail = null; ++state.detailGeneration;
                    this._refresh(surface);
                }));
            panel.add_child(scopes);
        }
        view.status = label('', 'papercusp-panel-status'); panel.add_child(view.status);
        const scroll = new St.ScrollView({x_expand: true, y_expand: true});
        view.content = new St.BoxLayout({vertical: true, x_expand: true});
        scroll.set_child(view.content); panel.add_child(scroll);
        panel.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) this._escape(surface);
            else if (!state.detail && (key === Clutter.KEY_Down || key === Clutter.KEY_Up)) {
                state.move(key === Clutter.KEY_Down ? 1 : -1); this._render(surface);
            } else if (!state.detail && (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter))
                this._activate(surface, state.selected());
            else return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(panel, {affectsStruts: false, trackFullscreen: false});
        this._position(); this._render(surface); view.search.grab_key_focus();
    }
    _escape(surface) {
        const state = this._states.get(surface);
        ++state.detailGeneration;
        if (state.escape() === 'panel') this._hide(surface, true);
        else this._render(surface);
    }
    _refresh(surface) {
        const view = this._views.get(surface), state = this._states.get(surface);
        if (!view || !state.visible) return;
        if (view.searchTimer) { GLib.source_remove(view.searchTimer); view.searchTimer = null; }
        const requests = sourceRequests(state.query, state.scope);
        const generation = state.beginRefresh(requests.map(request => request.kind));
        this._render(surface);
        for (const {kind, name, args} of requests) {
            this._bridge.read(this._settings.get_string('pui-path'), {name, args})
                .then(payload => state.settle(kind, generation, payload))
                .catch(error => state.settle(kind, generation, null, error))
                .finally(() => { if (this._views.get(surface) === view) this._render(surface); });
        }
    }
    _render(surface) {
        const view = this._views.get(surface);
        if (!view) return;
        const state = this._states.get(surface); view.content.destroy_all_children();
        view.status.set_text(Object.entries(state.sources).map(([kind, source]) => {
            if (source.status === 'unavailable') return kind + ': unavailable — ' + source.error;
            if (source.status === 'loading') return kind + ': loading';
            return kind + ': ' + source.rows.length + (source.total == null ? '' : ' of ' + source.total) +
                (source.partial || source.unavailable ? ' (partial)' : '');
        }).join('\n'));
        if (state.detail) { this._renderDetail(surface, state.detail); return; }
        const rows = state.results(), selected = state.selected()?.key;
        if (!rows.length) {
            const complete = Object.values(state.sources).every(source => source.status === 'ready');
            view.content.add_child(label(complete ? 'No matching results' : 'Waiting for available sources'));
        }
        for (const result of rows) {
            const row = new St.Button({can_focus: true, x_expand: true,
                style_class: 'papercusp-result' + (result.key === selected ? ' selected' : ''),
                accessible_name: result.kind + ': ' + result.title});
            const body = new St.BoxLayout({vertical: true});
            body.add_child(label(result.kind, 'papercusp-result-kind'));
            body.add_child(label(result.title, 'papercusp-result-title'));
            body.add_child(label(result.subtitle, 'papercusp-result-subtitle'));
            row.set_child(body);
            row.connect('clicked', () => { state.selection = result.key; this._activate(surface, result); });
            view.content.add_child(row);
        }
        if (state.hasMoreResults()) view.content.add_child(button('Show more results', () => {
            state.showMoreResults(); this._render(surface);
        }));
    }
    async _activate(surface, result) {
        if (!result || !this._views.has(surface)) return;
        const state = this._states.get(surface);
        state.selection = result.key;
        const generation = ++state.detailGeneration;
        state.detail = {title: result.title, text: 'Loading…'}; this._render(surface);
        try {
            if (result.kind === 'agents') throw new Error(
                'Exact terminal activation is not connected in this host yet. The agent is unchanged.');
            const payload = await this._bridge.read(this._settings.get_string('pui-path'), detailRequest(result));
            const rows = readRows(payload);
            if (!rows.length) throw new Error('The selected item is unavailable or no longer authorized');
            const row = rows[0];
            if (row.ok === false || row.error) throw new Error(row.error || 'Selected item unavailable');
            const text = result.kind === 'reports' ? row.body_md : result.kind === 'plans' ?
                row.body || row.raw || row.markdown : JSON.stringify(row, null, 2);
            if (typeof text !== 'string') throw new Error('The selected item returned no readable content');
            if (generation === state.detailGeneration) state.detail = {title: result.title, text};
        } catch (error) {
            if (generation === state.detailGeneration)
                state.detail = {title: result.title, text: String(error.message || error)};
        }
        this._render(surface);
    }
    _renderDetail(surface, detail) {
        const view = this._views.get(surface);
        view.content.add_child(button('Back to results', () => {
            const state = this._states.get(surface);
            ++state.detailGeneration; state.detail = null; this._render(surface);
        }));
        view.content.add_child(label(detail.title, 'papercusp-panel-title'));
        const text = label(detail.text, 'papercusp-detail');
        text.clutter_text.set_selectable(true); text.clutter_text.set_ellipsize(0);
        view.content.add_child(text);
    }
    _destroyActors(surface) {
        const view = this._views.get(surface);
        if (!view) return;
        if (view.searchTimer) GLib.source_remove(view.searchTimer);
        Main.layoutManager.removeChrome(view.panel); view.panel.destroy();
        this._views.delete(surface);
    }
    _hide(surface, restoreFocus) {
        const view = this._views.get(surface), state = this._states.get(surface);
        if (state) { state.visible = false; ++state.generation; ++state.detailGeneration; }
        this._destroyActors(surface); this._position();
        if (restoreFocus && view?.priorWindow &&
            global.get_window_actors().some(actor => actor.meta_window === view.priorWindow))
            Main.activateWindow(view.priorWindow);
    }
    disable() {
        this._bridge?.close();
        for (const binding of this._bindings?.values() || []) global.display.ungrab_accelerator(binding.id);
        this._bindings?.clear();
        for (const surface of [...this._views.keys()]) this._hide(surface, false);
        if (this._capture) global.stage.disconnect(this._capture);
        if (this._settingsSignal) this._settings.disconnect(this._settingsSignal);
        if (this._focusSignal) global.display.disconnect(this._focusSignal);
        if (this._monitorSignal) Main.layoutManager.disconnect(this._monitorSignal);
        if (this._acceleratorSignal) global.display.disconnect(this._acceleratorSignal);
        this._settings = null; this._states = null;
    }
}

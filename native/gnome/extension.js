import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {nativeRead} from './bridge.js';
import {PanelState, SOURCES, detailRequest, readRows, rebindShortcuts} from './panel-model.mjs';

function label(text, style = '') {
    const actor = new St.Label({ text: String(text), style_class: style, x_expand: true });
    actor.clutter_text.set_line_wrap(true);
    return actor;
}
function button(text, callback) {
    const actor = new St.Button({ label: text, can_focus: true, style_class: 'button' });
    actor.connect('clicked', callback); return actor;
}

// Shell-owned actors are native controls, never application windows. They have
// no Dock/taskbar/Alt-Tab identity or window decoration on X11 or Wayland.
export default class Workbench extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._states = new Map([['quick-access', new PanelState()], ['goals', new PanelState()]]);
        this._states.get('goals').scope = 'goals';
        this._cancellable = new Gio.Cancellable();
        this._detailGeneration = 0;
        this._bindings = new Map();
        this._acceleratorSignal = global.display.connect('accelerator-activated', (_display, id) => {
            const match = [...this._bindings].find(([, binding]) => binding.id === id);
            if (match && this._settings.get_boolean('enabled')) this._toggle(match[0]);
        });
        this._settingsSignal = this._settings.connect('changed', () => this._configure());
        this._focusSignal = global.display.connect('notify::focus-window', () => {
            for (const state of this._states.values()) state.outsideFocus();
            if (this._surface && !this._state().visible) this._hide(false);
        });
        this._monitorSignal = Main.layoutManager.connect('monitors-changed', () => this._position());
        this._configure();
    }
    _state() { return this._states?.get(this._surface); }
    _configure() {
        if (!this._settings.get_boolean('enabled')) {
            for (const binding of this._bindings.values()) global.display.ungrab_accelerator(binding.id);
            this._bindings.clear();
            this._hide(false); return;
        }
        if (this._revertingSettings) return;
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
        if (this._surface === surface && state.visible) { state.visible = false; this._hide(true); return; }
        if (!this._surface) this._priorWindow = global.display.focus_window;
        // Only one overlay occupies the screen at once, but each owns retained
        // selection/draft/pin. Switching surfaces cannot pin a different one.
        if (this._surface) this._state().visible = false;
        this._surface = surface; state.visible = true;
        this._build();
        this._refresh();
    }
    _position() {
        if (!this._panel) return;
        const monitor = Main.layoutManager.currentMonitor || Main.layoutManager.primaryMonitor;
        if (!monitor) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const width = Math.min(this._settings.get_int('panel-width'), area.width - 32);
        this._panel.set_position(area.x + area.width - width - 16, area.y + 16);
        this._panel.set_size(width, Math.max(200, area.height - 32));
    }
    _build() {
        this._destroyActors();
        const state = this._state();
        this._panel = new St.BoxLayout({ vertical: true, reactive: true, can_focus: true,
            style_class: 'papercusp-panel', accessible_name: 'Papercusp native Workbench' });
        const header = new St.BoxLayout({ style_class: 'papercusp-panel-header' });
        header.add_child(label(this._surface === 'goals' ? 'Goals' : 'Quick Access', 'papercusp-panel-title'));
        const pin = button(state.pinned ? 'Unpin' : 'Pin', () => {
            state.pinned = !state.pinned; pin.label = state.pinned ? 'Unpin' : 'Pin';
        });
        header.add_child(pin);
        header.add_child(button('Refresh', () => this._refresh()));
        header.add_child(button('Close', () => { state.visible = false; this._hide(true); }));
        this._panel.add_child(header);
        this._search = new St.Entry({ text: state.query, hint_text: 'Search plans, agents, reports and goals',
            can_focus: true, x_expand: true, accessible_name: 'Search Workbench' });
        this._search.clutter_text.connect('text-changed', () => {
            state.query = this._search.get_text(); this._render();
        });
        this._panel.add_child(this._search);
        if (this._surface === 'quick-access') {
            const scopes = new St.BoxLayout({ style_class: 'papercusp-panel-scopes' });
            for (const scope of ['all', ...Object.keys(SOURCES)])
                scopes.add_child(button(scope, () => { state.scope = scope; this._render(); }));
            this._panel.add_child(scopes);
        }
        this._status = label('', 'papercusp-panel-status'); this._panel.add_child(this._status);
        const scroll = new St.ScrollView({ x_expand: true, y_expand: true });
        this._content = new St.BoxLayout({ vertical: true, x_expand: true });
        scroll.set_child(this._content); this._panel.add_child(scroll);
        this._panel.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Escape) {
                ++this._detailGeneration;
                if (state.escape() === 'panel') this._hide(true); else this._render();
            } else if (key === Clutter.KEY_Down || key === Clutter.KEY_Up) {
                state.move(key === Clutter.KEY_Down ? 1 : -1); this._render();
            } else if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter) {
                this._activate(state.selected());
            } else return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(this._panel, { affectsStruts: false, trackFullscreen: false });
        this._position(); this._render(); this._search.grab_key_focus();
        this._capture = global.stage.connect('captured-event', (_stage, event) => {
            if (event.type() !== Clutter.EventType.BUTTON_PRESS || state.pinned) return Clutter.EVENT_PROPAGATE;
            const target = event.get_source();
            if (target && this._panel?.contains(target)) return Clutter.EVENT_PROPAGATE;
            state.outsideFocus(); this._hide(false);
            return Clutter.EVENT_PROPAGATE;
        });
    }
    _refresh() {
        if (!this._surface) return;
        const state = this._state(), surface = this._surface;
        const generation = state.beginRefresh(); this._render();
        for (const [kind, name] of Object.entries(SOURCES)) {
            const args = kind === 'reports' ? { query: state.query, limit: 200 } :
                kind === 'goals' ? { query: state.query, limit: 500 } : {};
            nativeRead(this._settings.get_string('pui-path'), { name, args }, this._cancellable)
                .then(payload => state.settle(kind, generation, payload))
                .catch(error => state.settle(kind, generation, null, error))
                .finally(() => { if (this._surface === surface && this._panel) this._render(); });
        }
    }
    _render() {
        if (!this._panel) return;
        const state = this._state(); this._content.destroy_all_children();
        this._status.set_text(Object.entries(state.sources).map(([kind, source]) => {
            if (source.status === 'unavailable') return `${kind}: unavailable — ${source.error}`;
            if (source.status === 'loading') return `${kind}: loading`;
            return `${kind}: ${source.rows.length}${source.total == null ? '' : ` of ${source.total}`}` +
                (source.partial || source.unavailable ? ' (partial)' : '');
        }).join('\n'));
        if (state.detail) { this._renderDetail(state.detail); return; }
        const rows = state.results(), selected = state.selected()?.key;
        if (!rows.length) {
            const complete = Object.values(state.sources).every(source => source.status === 'ready');
            this._content.add_child(label(complete ? 'No matching results' : 'Waiting for available sources'));
        }
        for (const result of rows) {
            const row = new St.Button({ can_focus: true, x_expand: true,
                style_class: `papercusp-result${result.key === selected ? ' selected' : ''}`,
                accessible_name: `${result.kind}: ${result.title}` });
            const body = new St.BoxLayout({ vertical: true });
            body.add_child(label(result.kind, 'papercusp-result-kind'));
            body.add_child(label(result.title, 'papercusp-result-title'));
            body.add_child(label(result.subtitle, 'papercusp-result-subtitle'));
            row.set_child(body);
            row.connect('clicked', () => { state.selection = result.key; this._activate(result); });
            this._content.add_child(row);
        }
    }
    async _activate(result) {
        if (!result || !this._surface) return;
        const state = this._state();
        state.selection = result.key;
        const generation = this._detailGeneration = (this._detailGeneration || 0) + 1;
        state.detail = { title: result.title, text: 'Loading…' }; this._render();
        try {
            if (result.kind === 'agents') throw new Error(
                'Exact terminal activation is not connected in this host yet. The agent is unchanged.');
            const payload = await nativeRead(this._settings.get_string('pui-path'),
                detailRequest(result), this._cancellable);
            const rows = readRows(payload);
            if (!rows.length) throw new Error('The selected item is unavailable or no longer authorized');
            const row = rows[0];
            if (row.ok === false || row.error) throw new Error(row.error || 'Selected item unavailable');
            const text = result.kind === 'reports' ? row.body_md : result.kind === 'plans' ?
                row.body || row.raw || row.markdown : JSON.stringify(row, null, 2);
            if (typeof text !== 'string') throw new Error('The selected item returned no readable content');
            if (generation === this._detailGeneration) state.detail = { title: result.title, text };
        } catch (error) {
            if (generation === this._detailGeneration) state.detail = { title: result.title, text: String(error.message || error) };
        }
        if (this._state() === state && this._panel) this._render();
    }
    _renderDetail(detail) {
        this._content.add_child(button('Back to results', () => {
            ++this._detailGeneration; this._state().detail = null; this._render();
        }));
        this._content.add_child(label(detail.title, 'papercusp-panel-title'));
        // Plain native text is safe even for reports containing HTML. Rich
        // Markdown/code rendering is an explicit remaining acceptance step.
        const text = label(detail.text, 'papercusp-detail');
        text.clutter_text.set_selectable(true); text.clutter_text.set_ellipsize(0);
        this._content.add_child(text);
    }
    _destroyActors() {
        if (this._capture) { global.stage.disconnect(this._capture); this._capture = null; }
        if (this._panel) { Main.layoutManager.removeChrome(this._panel); this._panel.destroy(); this._panel = null; }
    }
    _hide(restoreFocus) {
        this._destroyActors(); this._surface = null;
        if (restoreFocus && this._priorWindow && global.get_window_actors().some(actor => actor.meta_window === this._priorWindow))
            Main.activateWindow(this._priorWindow);
        this._priorWindow = null;
    }
    disable() {
        this._cancellable?.cancel();
        for (const binding of this._bindings?.values() || []) global.display.ungrab_accelerator(binding.id);
        this._bindings?.clear(); this._hide(false);
        if (this._settingsSignal) this._settings.disconnect(this._settingsSignal);
        if (this._focusSignal) global.display.disconnect(this._focusSignal);
        if (this._monitorSignal) Main.layoutManager.disconnect(this._monitorSignal);
        if (this._acceleratorSignal) global.display.disconnect(this._acceleratorSignal);
        this._settings = null; this._states = null;
    }
}

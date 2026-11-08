import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ResidentBridge} from './bridge.js';
import {nativeChatBlocks, safeChatLink, NativeCardsState} from './chat-content.js';
import {PanelState, InboxState, ChatState, sameEnvironment, oneRow, SOURCES, sourceRequests, detailRequest, readRows, rebindShortcuts,
    agentFocusTarget, agentResumeTarget, resumeArgv, exactAgentWindow,
    organizerGroups, arrangeOrganizerGroup} from './panel-model.mjs';

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
        this._states = new Map(['quick-access', 'goals', 'inbox', 'organizer', 'papercup'].map(name => [name, new PanelState()]));
        this._states.get('organizer').organizerKind = 'plan';
        this._inbox = new InboxState(); this._inboxRunId = null;
        this._chat = new ChatState(); this._chatStream = null;
        this._cards = new NativeCardsState(); this._cardStream = null; this._cardDrafts = new Map();
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
                if (surface === 'organizer' && state.organizing) continue;
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
        const pui = this._settings.get_string('pui-path');
        if (this._selectedPui !== undefined && this._selectedPui !== pui) {
            this._inbox.begin(); this._inboxEnvironment = null; this._inboxRunId = null;
            this._hide('inbox', false);
            this._hide('papercup', false);
        }
        this._selectedPui = pui;
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
        header.add_child(label(surface === 'goals' ? 'Goals' : surface === 'inbox' ? 'Inbox' :
            surface === 'organizer' ? 'Organizer' : surface === 'papercup' ? 'Papercup' : 'Quick Access', 'papercusp-panel-title'));
        const pin = button(state.pinned ? 'Unpin' : 'Pin', () => {
            state.pinned = !state.pinned;
            pin.label = state.pinned ? 'Unpin' : 'Pin';
        });
        header.add_child(pin);
        header.add_child(button('Refresh', () => this._refresh(surface)));
        header.add_child(button('Close', () => this._hide(surface, true)));
        panel.add_child(header);
        if (surface === 'papercup') { this._buildChat(view); return; }
        view.search = new St.Entry({text: state.query, hint_text: surface === 'inbox' ? 'Search questions' : 'Search plans, agents, reports and goals',
            can_focus: true, x_expand: true, accessible_name: 'Search Workbench'});
        // Clutter.Text consumes Enter and emits activate instead of bubbling
        // key-press-event to the panel. Keep the focused search route native.
        view.search.clutter_text.connect('activate', () => {
            if (surface === 'inbox') {
                const row = this._inbox.results(state.query)[0]; if (row) this._loadInboxContext(row.id);
            } else if (surface !== 'organizer' && !state.detail) this._activate(surface, state.selected());
        });
        view.search.clutter_text.connect('text-changed', () => {
            state.query = view.search.get_text();
            if (surface === 'inbox') {
                this._inbox.retainVisibleSelection(state.query); view.confirmRequests = null;
                this._renderInbox(); return;
            }
            if (surface === 'organizer') { this._renderOrganizer(); return; }
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
        if (surface === 'organizer') {
            view.search.hint_text = 'Search goal, plan or fleet groups';
            const modes = new St.BoxLayout({style_class: 'papercusp-panel-scopes'});
            for (const kind of ['goal', 'plan', 'fleet']) modes.add_child(button(kind, () => {
                if (state.organizing) return;
                state.organizerKind = kind; state.organizerReceipts = null; this._renderOrganizer();
            }));
            panel.add_child(modes);
        }
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
            else if (!['inbox', 'organizer'].includes(surface) && !state.detail && (key === Clutter.KEY_Down || key === Clutter.KEY_Up)) {
                state.move(key === Clutter.KEY_Down ? 1 : -1); this._render(surface);
            } else if (!['inbox', 'organizer'].includes(surface) && !state.detail && (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter))
                this._activate(surface, state.selected());
            else return Clutter.EVENT_PROPAGATE;
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(panel, {affectsStruts: false, trackFullscreen: false});
        this._position(); this._render(surface); view.search.grab_key_focus();
    }
    _escape(surface) {
        if (surface === 'inbox') {
            const view = this._views.get(surface);
            if (view?.confirmRequests) { view.confirmRequests = null; this._renderInbox(); return; }
            if (this._inbox.dismissContext()) { this._renderInbox(); return; }
        }
        const state = this._states.get(surface);
        ++state.detailGeneration;
        if (state.escape() === 'panel') this._hide(surface, true);
        else this._render(surface);
    }
    _refresh(surface) {
        const view = this._views.get(surface), state = this._states.get(surface);
        if (!view || !state.visible) return;
        if (surface === 'inbox') { this._refreshInbox(); return; }
        if (surface === 'papercup') { this._refreshChat(); return; }
        if (surface === 'organizer' && state.organizing) return;
        if (view.searchTimer) { GLib.source_remove(view.searchTimer); view.searchTimer = null; }
        const requests = surface === 'organizer' ? [...sourceRequests('', 'agents'), ...sourceRequests('', 'goals')] :
            sourceRequests(state.query, state.scope);
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
        if (surface === 'papercup') { this._renderChat(); return; }
        if (surface === 'inbox') { this._renderInbox(); return; }
        if (surface === 'organizer') { this._renderOrganizer(); return; }
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
            if (result.kind === 'agents' && result.row.sessionState === 'ended') {
                const resume = button('Resume session', () => this._resume(surface, result));
                resume.accessible_name = 'Resume session: ' + result.title;
                view.content.add_child(resume);
            }
        }
        if (state.hasMoreResults()) view.content.add_child(button('Show more results', () => {
            state.showMoreResults(); this._render(surface);
        }));
    }
    _renderOrganizer() {
        const view = this._views.get('organizer'), state = this._states.get('organizer');
        if (!view) return;
        view.content.destroy_all_children();
        view.status.set_text(state.organizing ? 'Arranging exact terminals…' :
            state.organizerError || 'Arrange a group within each current desktop and monitor.');
        for (const [kind, source] of Object.entries(state.sources))
            if (source.status !== 'ready' || source.partial || source.unavailable)
                view.content.add_child(label(`${kind}: ${source.error || source.status}` +
                    (source.partial || source.unavailable ? ' (partial)' : '')));
        if (state.organizerReceipts) for (const receipt of state.organizerReceipts)
            view.content.add_child(label(`${receipt.host || 'Unknown host'} · desktop ${receipt.desktop ?? 'unavailable'} · ` +
                `${receipt.ownerId}: ${receipt.status}${receipt.error ? ' — ' + receipt.error : ''}`));
        const groups = organizerGroups(state.sources.agents?.rows || [], state.organizerKind,
            state.sources.goals?.rows || []);
        const query = state.query.trim().toLocaleLowerCase();
        for (const group of groups.filter(group => group.label.toLocaleLowerCase().includes(query))) {
            const control = button('Arrange ' + group.label, () => this._arrangeGroup(group));
            control.reactive = !state.organizing; control.can_focus = !state.organizing;
            view.content.add_child(control);
        }
        if (!groups.length) view.content.add_child(label('No canonical groups available'));
    }
    _desktopWindows() {
        return global.get_window_actors().map(actor => {
            const window = actor.meta_window, workspace = window.get_workspace(), monitor = window.get_monitor();
            return {window, title: window.get_title(),
                id: window.get_description().match(/^0x[0-9a-f]+/i)?.[0],
                desktop: workspace?.index(), monitor,
                area: workspace?.get_work_area_for_monitor(monitor),
                unsupported: window.is_on_all_workspaces() ? 'Terminal is pinned to all desktops' :
                    window.is_fullscreen() ? 'Leave fullscreen before arranging this terminal' : null};
        });
    }
    async _arrangeGroup(group) {
        const state = this._states.get('organizer');
        if (state.organizing || !state.visible) return;
        const generation = ++state.detailGeneration, pui = this._settings.get_string('pui-path');
        state.organizing = true; state.organizerError = null; state.organizerReceipts = null;
        this._renderOrganizer();
        const current = () => generation === state.detailGeneration && state.visible &&
            pui === this._settings.get_string('pui-path');
        try {
            const roster = await this._bridge.read(pui, {name: 'advRoster.list', args: {}});
            const goal = group.kind === 'goal' ? await this._bridge.read(pui,
                {name: 'goals.detail', args: {goalId: group.id}}) : null;
            if (!current()) return;
            const receipts = await arrangeOrganizerGroup(group, roster, GLib.get_host_name(), this._desktopWindows(),
                async (record, rect) => {
                    if (!current()) throw new Error('Arrangement cancelled; refresh the group');
                    const window = record.window;
                    if (window.get_workspace()?.index() !== record.desktop || window.get_monitor() !== record.monitor)
                        throw new Error('Terminal changed desktop or monitor; refresh the group');
                    if (window.minimized) window.unminimize();
                    window.unmaximize(Meta.MaximizeFlags.BOTH);
                    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40,
                        () => { resolve(); return GLib.SOURCE_REMOVE; }));
                    if (!current()) throw new Error('Arrangement cancelled; refresh the group');
                    window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                    return new Promise(resolve => {
                        let attempts = 0;
                        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
                            const actual = window.get_frame_rect();
                            if (++attempts < 40 && current() &&
                                !Object.keys(rect).every(key => Math.abs(actual[key] - rect[key]) <= 2))
                                return GLib.SOURCE_CONTINUE;
                            resolve({x: actual.x, y: actual.y, width: actual.width, height: actual.height,
                                desktop: window.get_workspace()?.index(), monitor: window.get_monitor()});
                            return GLib.SOURCE_REMOVE;
                        });
                    });
                }, goal);
            state.organizerReceipts = receipts;
        } catch (error) { state.organizerError = String(error.message || error); }
        finally { state.organizing = false; this._renderOrganizer(); }
    }
    _launchResume(argv) {
        // GLib quotes each argv cell, including spaces/apostrophes in an
        // installed path. GIO chooses the desktop's terminal application.
        const command = argv.map(value => GLib.shell_quote(value)).join(' ');
        const app = Gio.AppInfo.create_from_commandline(command, 'Papercusp session',
            Gio.AppInfoCreateFlags.NEEDS_TERMINAL);
        if (!app.launch([], global.create_app_launch_context(0, -1)))
            throw new Error('Could not open the selected session in a terminal');
    }
    async _resume(surface, result) {
        if (!result || !this._views.has(surface)) return;
        const state = this._states.get(surface), generation = ++state.detailGeneration;
        state.selection = result.key;
        state.detail = {title: result.title, text: 'Checking session…'}; this._render(surface);
        try {
            const pui = this._settings.get_string('pui-path');
            const roster = await this._bridge.read(pui, {name: 'advRoster.list', args: {}});
            if (generation !== state.detailGeneration || !state.visible) return;
            if (pui !== this._settings.get_string('pui-path'))
                throw new Error('Selected PUI connection changed; refresh the results');
            const target = agentResumeTarget(roster, result.row, GLib.get_host_name());
            this._launchResume(resumeArgv(pui, target));
            state.detail = null;
            this._hide(surface, false);
        } catch (error) {
            if (generation === state.detailGeneration) {
                state.detail = {title: result.title, text: String(error.message || error)};
                this._render(surface);
            }
        }
    }
    async _activate(surface, result) {
        if (!result || !this._views.has(surface)) return;
        const state = this._states.get(surface);
        state.selection = result.key;
        const generation = ++state.detailGeneration;
        const loadingDetail = {title: result.title, text: 'Loading…'};
        state.detail = loadingDetail; this._render(surface);
        try {
            if (result.kind === 'agents') {
                const roster = await this._bridge.read(this._settings.get_string('pui-path'),
                    {name: 'advRoster.list', args: {}});
                if (generation !== state.detailGeneration || !state.visible) return;
                const target = agentFocusTarget(roster, result.row, GLib.get_host_name());
                const windows = global.get_window_actors().map(actor => {
                    const window = actor.meta_window;
                    return {window, title: window.get_title(),
                        id: window.get_description().match(/^0x[0-9a-f]+/i)?.[0]};
                });
                const {window} = exactAgentWindow(target, windows);
                Main.activateWindow(window);
                await new Promise((resolve, reject) => {
                    let attempts = 0;
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 25, () => {
                        if (global.display.focus_window === window && !window.minimized) {
                            resolve(); return GLib.SOURCE_REMOVE;
                        }
                        if (++attempts === 40) {
                            reject(new Error('Could not verify focus on the selected terminal'));
                            return GLib.SOURCE_REMOVE;
                        }
                        return GLib.SOURCE_CONTINUE;
                    });
                });
                // Verified focus itself emits notify::focus-window and hides
                // an unpinned panel, which invalidates detailGeneration. Clear
                // only this activation's transient object after verification;
                // a newer selection's detail must survive that callback.
                if (state.detail === loadingDetail) state.detail = null;
                if (generation === state.detailGeneration) this._hide(surface, false);
                return;
            }
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
                state.detail = {title: result.title, text: String(error.message || error),
                    resume: result.kind === 'agents' && result.row.sessionState === 'ended' ? result : null};
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
        if (detail.resume) view.content.add_child(button('Resume session', () => this._resume(surface, detail.resume)));
        const text = label(detail.text, 'papercusp-detail');
        text.clutter_text.set_selectable(true); text.clutter_text.set_ellipsize(0);
        view.content.add_child(text);
    }
    _inboxCurrent(view, token, pui) {
        return this._views.get('inbox') === view && this._states.get('inbox').visible &&
            this._inbox.generation === token && this._settings.get_string('pui-path') === pui;
    }
    _buildChat(view) {
        const {panel} = view;
        view.status = label('', 'papercusp-panel-status'); panel.add_child(view.status);
        const controls = new St.BoxLayout({style_class: 'papercusp-panel-scopes'});
        view.earlier = button('Earlier messages', () => this._loadEarlierChat()); controls.add_child(view.earlier);
        view.reconnect = button('Reconnect reply', () => this._controlChat('reconnect')); controls.add_child(view.reconnect);
        view.cancelReply = button('Cancel reply', () => this._controlChat('cancel')); controls.add_child(view.cancelReply);
        panel.add_child(controls);
        view.referenceChoice = button('Work links: choose a plan context', () => {
            view.referenceMenu.visible = !view.referenceMenu.visible;
        });
        panel.add_child(view.referenceChoice);
        view.referenceMenu = new St.ScrollView({visible: false, height: 180, x_expand: true});
        view.referenceOptions = new St.BoxLayout({vertical: true, x_expand: true});
        view.referenceMenu.set_child(view.referenceOptions); panel.add_child(view.referenceMenu);
        view.cardStatus = label('', 'papercusp-panel-status'); panel.add_child(view.cardStatus);
        view.cardReconnect = button('Reconnect questions', () => this._connectCards()); panel.add_child(view.cardReconnect);
        view.cardScroll = new St.ScrollView({visible: false, height: 260, x_expand: true});
        view.cardsContent = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'papercusp-detail'});
        view.cardScroll.set_child(view.cardsContent); panel.add_child(view.cardScroll);
        view.scroll = new St.ScrollView({x_expand: true, y_expand: true});
        view.content = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'papercusp-detail'});
        view.scroll.set_child(view.content); panel.add_child(view.scroll);
        view.compose = new St.Entry({text: this._chat.draft, hint_text: 'Message Papercup', can_focus: true,
            x_expand: true, accessible_name: 'Message Papercup'});
        view.compose.clutter_text.connect('text-changed', () => {
            this._chat.draft = view.compose.get_text(); this._updateChatControls(view);
        });
        view.compose.clutter_text.connect('activate', () => this._sendChat());
        panel.add_child(view.compose); view.send = button('Send', () => this._sendChat()); panel.add_child(view.send);
        // Dismiss consistently from every focused descendant control.
        panel.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS || event.get_key_symbol() !== Clutter.KEY_Escape)
                return Clutter.EVENT_PROPAGATE;
            this._hide('papercup', true); return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addChrome(panel, {affectsStruts: false, trackFullscreen: false});
        this._position(); this._renderChat(); this._renderCards(); view.compose.grab_key_focus();
    }
    _updateChatControls(view) {
        const chat = this._chat, reply = chat.reply;
        // Pagination disables send, but must not drop the entry's key focus.
        view.compose.reactive = Boolean(chat.ready);
        view.send.reactive = chat.canSend; view.send.can_focus = chat.canSend;
        view.earlier.reactive = Boolean(chat.ready && !chat.loading && !reply && chat.hasMoreEarlier);
        view.reconnect.visible = Boolean(reply?.turnId && !reply.complete && !reply.connected);
        view.cancelReply.visible = Boolean(reply?.turnId && !reply.complete);
    }
    _renderChat() {
        const view = this._views.get('papercup'); if (!view) return;
        const chat = this._chat; view.content.destroy_all_children();
        view.status.set_text(chat.error || (chat.loading ? 'Loading conversation…' :
            chat.reply ? 'Reply · ' + chat.reply.phase : chat.ready ? 'Papercup · ready' : 'Conversation unavailable'));
        const context = chat.referenceContext;
        view.referenceChoice.set_label(chat.referenceError ? 'Work link contexts unavailable' :
            context.planSlug ? 'Work links: ' + context.harness + ' / ' + context.planSlug : 'Work links: choose a plan context');
        view.referenceChoice.reactive = Boolean(chat.ready && chat.referencePlans.length);
        view.referenceOptions.destroy_all_children();
        const choose = key => { chat.selectReferencePlan(key); view.referenceMenu.hide(); this._renderChat(); };
        view.referenceOptions.add_child(button('No plan context', () => choose(null)));
        for (const plan of chat.referencePlans)
            view.referenceOptions.add_child(button(plan.row.harness + ' / ' + plan.row.slug, () => choose(plan.key)));
        for (const turn of chat.turns) {
            view.content.add_child(label(turn.role === 'user' ? 'You' : turn.role === 'assistant' ? 'Papercup' : turn.role,
                'papercusp-result-title'));
            this._appendChatContent(view, turn.text);
        }
        if (chat.reply) {
            view.content.add_child(label('Papercup · ' + chat.reply.phase, 'papercusp-result-title'));
            if (chat.reply.displayText) this._appendChatContent(view, chat.reply.displayText);
            for (const activity of chat.reply.tools) view.content.add_child(label(activity, 'papercusp-panel-status'));
        }
        if (chat.ready && !chat.turns.length && !chat.reply) view.content.add_child(label('Start a conversation with Papercup.'));
        if (view.compose.get_text() !== chat.draft) view.compose.set_text(chat.draft);
        this._updateChatControls(view);
    }
    _appendChatContent(view, text) {
        for (const block of nativeChatBlocks(text, this._chat.referenceContext)) {
            if (block.kind === 'code') {
                const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'papercusp-chat-code'});
                box.add_child(label(block.language || 'Code', 'papercusp-panel-status'));
                const code = label(block.code); code.clutter_text.set_selectable(true);
                code.clutter_text.set_ellipsize(0); code.clutter_text.set_line_wrap(false);
                const codeContent = new St.BoxLayout({vertical: true, x_expand: true}); codeContent.add_child(code);
                // A scrollable Shell actor otherwise has zero minimum height.
                // Reserve space for short snippets and bound longer blocks.
                const lineCount = block.code.split('\n').length;
                const scroll = new St.ScrollView({x_expand: true, height: Math.min(320, Math.max(60, lineCount * 22 + 18))});
                scroll.set_child(codeContent); box.add_child(scroll);
                box.add_child(button('Copy code', () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, block.code)));
                view.content.add_child(box);
            } else {
                const actor = label(block.text); actor.clutter_text.set_markup(block.markup);
                actor.clutter_text.set_selectable(true); actor.clutter_text.set_ellipsize(0);
                view.content.add_child(actor);
            }
            for (const link of block.links) view.content.add_child(button(link.text, () => {
                const uri = safeChatLink(link.href); if (!uri) return;
                try { this._launchChatUri(uri); }
                catch (error) { view.status.set_text('Could not open link: ' + error.message); }
            }));
        }
    }
    _launchChatUri(uri) { Gio.AppInfo.launch_default_for_uri(uri, null); }
    _stopCards() {
        const stream = this._cardStream; this._cardStream = null; stream?.cancel();
        this._cards.begin(null, ''); this._cardDrafts.clear();
    }
    _connectCards() {
        this._stopCards();
        const view = this._views.get('papercup'), chat = this._chat;
        if (!view || !chat.ready) return;
        const state = this._cards, token = state.begin(chat.environment, chat.conversationId);
        const stream = this._bridge.stream(this._settings.get_string('pui-path'), state.subscription, frame => {
            if (state.receive(token, frame)) this._renderCards();
        }, 'native-cards');
        this._cardStream = stream; this._renderCards();
        stream.done.then(() => {
            if (this._cardStream === stream) state.failed(token, new Error('Questions disconnected; reconnect before answering'));
        }, error => { if (this._cardStream === stream) state.failed(token, error); }).finally(() => {
            if (this._cardStream === stream) { this._cardStream = null; this._renderCards(); }
        });
    }
    _renderCards() {
        const view = this._views.get('papercup'); if (!view) return;
        const state = this._cards;
        view.cardStatus.set_text(state.error || (state.pending ? 'Saving answer…' :
            state.connected ? '' : this._chat.ready ? 'Connecting questions…' : ''));
        view.cardReconnect.visible = Boolean(this._chat.ready && !state.connected && state.error);
        const cards = state.cards;
        view.cardScroll.visible = Boolean(cards.length);
        const renderKey = JSON.stringify([cards.map(card => card.raw), state.pending, state.connected]);
        if (view.cardRenderKey === renderKey) return;
        const focus = global.stage.get_key_focus();
        const replacedFocus = Boolean(focus && view.cardsContent.contains(focus));
        view.cardRenderKey = renderKey; view.cardsContent.destroy_all_children();
        for (const card of cards) {
            const box = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'papercusp-detail'});
            view.cardsContent.add_child(box);
            this._appendChatContent({content: box, status: view.cardStatus}, card.prose);
            const signature = JSON.stringify(card.raw);
            let draft = this._cardDrafts.get(card.id);
            if (!draft || draft.signature !== signature) {
                draft = {signature, picks: [], value: ''}; this._cardDrafts.set(card.id, draft);
            }
            const active = state.connected && !state.pending && !card.expired;
            const choiceButtons = [];
            for (const option of card.options) {
                const choice = new St.Button({label: option.label + (option.hint ? ' · ' + option.hint : ''),
                    can_focus: active, reactive: active, toggle_mode: true, checked: draft.picks.includes(option.id), style_class: 'button'});
                choiceButtons.push([choice, option.id]);
                choice.connect('clicked', () => {
                    if (card.kind !== 'checkbox') draft.picks = choice.checked ? [option.id] : [];
                    else draft.picks = choice.checked ? [...draft.picks.filter(id => id !== option.id), option.id] :
                        draft.picks.filter(id => id !== option.id);
                    for (const [other, id] of choiceButtons) other.checked = draft.picks.includes(id);
                });
                box.add_child(choice);
                if (option.description) box.add_child(label(option.description));
            }
            if (['text', 'date', 'slider'].includes(card.kind)) {
                const hint = card.kind === 'date' ? 'YYYY-MM-DD' : card.kind === 'slider' ?
                    String(card.presentation.min) + ' to ' + String(card.presentation.max) + ' · step ' + (card.presentation.step ?? 1) :
                    card.presentation.placeholder || 'Your answer';
                const entry = new St.Entry({text: draft.value, hint_text: hint, can_focus: active, reactive: active,
                    accessible_name: 'Answer: ' + card.raw.prompt, x_expand: true});
                if (card.presentation.sensitive) entry.clutter_text.set_password_char('•');
                if (card.presentation.multiline) { entry.clutter_text.set_single_line_mode(false); entry.clutter_text.set_line_wrap(true); }
                entry.clutter_text.connect('text-changed', () => { draft.value = entry.get_text(); }); box.add_child(entry);
            }
            const action = (title, kind) => {
                const control = button(title, () => this._answerCard(card, kind, draft));
                control.reactive = active; control.can_focus = active; box.add_child(control);
            };
            if (card.canSubmit) action('Submit answer', 'submit');
            if (card.raw.allowDecline !== false) action('Decline question', 'decline');
            action('Cancel question', 'cancel');
            const link = card.secureLink(state.environment);
            if (link) {
                const open = button('Open secure link', () => {
                    try { this._launchChatUri(link); } catch (error) { view.cardStatus.set_text(error.message); }
                });
                open.reactive = active; open.can_focus = active; box.add_child(open);
            }
            if (card.raw.details) {
                const details = label(card.raw.details); details.hide(); box.add_child(button('Show details', () => {
                    details.visible = !details.visible;
                })); box.add_child(details);
            }
            if (card.expired) box.add_child(label('This question has expired.'));
        }
        // Replacing a focused answer field drops Shell's keyboard target.
        // Keep Escape and keyboard navigation inside the stable chat panel.
        if (replacedFocus) view.compose.grab_key_focus();
    }
    async _answerCard(card, action, draft) {
        const state = this._cards, token = state.generation;
        let request;
        try { request = state.request(card, action, action === 'submit' ? card.answer(draft.picks, draft.value) : undefined); }
        catch (error) { state.error = error.message; this._renderCards(); return; }
        try {
            this._renderCards();
            const receipt = await this._bridge.read(this._settings.get_string('pui-path'), request, 'native-cards');
            if (state.responded(token, card.id, receipt)) this._cardDrafts.delete(card.id);
        } catch (error) { state.failed(token, error); }
        finally { this._renderCards(); }
    }
    _stopChatStream() {
        const stream = this._chatStream; this._chatStream = null; stream?.cancel();
    }
    async _refreshChat() {
        this._stopChatStream(); this._stopCards(); const token = this._chat.begin(), view = this._views.get('papercup');
        if (!view) return;
        const pui = this._settings.get_string('pui-path'); this._renderChat();
        const current = () => token === this._chat.generation && this._views.get('papercup') === view &&
            pui === this._settings.get_string('pui-path');
        const restoreFocus = () => {
            const focus = global.stage.get_key_focus();
            // A deactivated focused entry falls back to MetaStage on GNOME.
            if (this._chat.ready && (!focus || focus === global.stage)) view.compose.grab_key_focus();
        };
        try {
            const environment = oneRow(await this._bridge.read(pui, {name: 'operator.identity', args: {}}));
            if (!current()) return;
            const conversation = await this._bridge.read(pui, {name: 'operatorConversations.current',
                args: {workspaceId: environment.workspaceId}, environment});
            if (!current() || !this._chat.bind(token, environment, conversation)) return;
            const id = this._chat.conversationId;
            const page = await this._bridge.read(pui, {name: 'operatorTurns.page',
                args: {conversationId: id, limit: 200}, environment});
            if (current()) {
                this._chat.settle(token, environment, id, page); this._renderChat();
                this._connectCards();
                restoreFocus();
            }
            try {
                const plans = await this._bridge.read(pui, {name: 'plans.list', args: {}, environment});
                if (current()) this._chat.settleReferencePlans(token, environment, plans);
            } catch (error) { if (current()) this._chat.settleReferencePlans(token, environment, null, error); }
        } catch (error) { if (current()) this._chat.fail(token, error); }
        finally {
            if (current()) {
                this._renderChat();
                // Restore only when no other real actor owns keyboard focus.
                restoreFocus();
            }
        }
    }
    async _loadEarlierChat() {
        const chat = this._chat, token = chat.generation, environment = chat.environment, id = chat.conversationId;
        try {
            const beforeSeq = chat.beginEarlier(); this._renderChat();
            const page = await this._bridge.read(this._settings.get_string('pui-path'), {name: 'operatorTurns.page',
                args: {conversationId: id, beforeSeq, limit: 200}, environment});
            chat.settle(token, environment, id, page, beforeSeq);
        } catch (error) { chat.fail(token, error); }
        finally { this._renderChat(); }
    }
    _sendChat() {
        try { this._streamChat(this._chat.send(GLib.uuid_string_random())); }
        catch (error) { this._chat.fail(this._chat.generation, error); this._renderChat(); }
    }
    _controlChat(operation) {
        try { this._streamChat(this._chat.reply.control(operation)); }
        catch (error) { this._chat.replyFailed(this._chat.generation, error); this._renderChat(); }
    }
    _streamChat(request) {
        this._stopChatStream();
        const token = this._chat.generation, reply = this._chat.reply;
        reply.connected = true;
        const stream = this._bridge.stream(this._settings.get_string('pui-path'), request, frame => {
            if (this._chatStream !== stream || token !== this._chat.generation) return;
            this._chat.receive(token, frame); this._renderChat();
        });
        this._chatStream = stream; this._renderChat();
        stream.done.then(() => {
            if (this._chatStream === stream && !reply.complete) throw new Error('Reply ended without a saved acknowledgement; reconcile before sending again');
        }).catch(error => {
            if (this._chatStream === stream) this._chat.replyFailed(token, error);
        }).finally(() => {
            if (this._chatStream === stream) {
                this._chatStream = null;
                if (reply.complete && reply.phase === 'completed') this._refreshChat();
                else this._renderChat();
            }
        });
    }
    async _refreshInbox() {
        const view = this._views.get('inbox'); if (!view) return;
        if (view.runTimer) { GLib.source_remove(view.runTimer); view.runTimer = null; }
        view.confirmRequests = null;
        const inbox = this._inbox, token = inbox.begin(), pui = this._settings.get_string('pui-path'), runId = this._inboxRunId;
        this._inboxEnvironment = null; this._renderInbox();
        try {
            const environment = oneRow(await this._bridge.read(pui, {name: 'operator.identity', args: {}}));
            if (!sameEnvironment(environment, environment)) throw new Error('Selected environment is unavailable');
            if (!this._inboxCurrent(view, token, pui)) return;
            this._inboxEnvironment = environment;
            await Promise.all(['plans.attention', 'plans.attentionBulkRun'].map(async name => {
                try {
                    const payload = await this._bridge.read(pui, {name, environment, args: name === 'plans.attentionBulkRun' && runId ? {runId} : {}});
                    if (!this._inboxCurrent(view, token, pui)) return;
                    if (!sameEnvironment(environment, payload.environment)) throw new Error('Selected environment changed');
                    if (name === 'plans.attention') { inbox.settleList(token, payload); if (inbox.selection) this._loadInboxContext(inbox.selection); }
                    else inbox.settleBulk(token, payload, runId);
                } catch (error) {
                    if (!this._inboxCurrent(view, token, pui)) return;
                    if (name === 'plans.attention') inbox.settleList(token, null, error); else inbox.settleBulk(token, null, runId, error);
                }
                this._renderInbox();
            }));
            if (this._inboxCurrent(view, token, pui) && inbox.savedRunId) this._followInboxRun(view, token, pui, environment);
        } catch (error) {
            if (!this._inboxCurrent(view, token, pui)) return;
            inbox.settleList(token, null, error); inbox.settleBulk(token, null, runId, error); this._renderInbox();
        }
    }
    _followInboxRun(view, token, pui, environment) {
        view.runTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            view.runTimer = null;
            if (!this._inboxCurrent(view, token, pui)) return GLib.SOURCE_REMOVE;
            const runId = this._inbox.savedRunId; if (!runId) return GLib.SOURCE_REMOVE;
            const update = async () => {
                if (!this._inbox.pending) {
                    try {
                        const payload = await this._bridge.read(pui, {name: 'plans.attentionBulkRun', args: {runId}, environment});
                        if (!sameEnvironment(environment, payload.environment)) throw new Error('Selected environment changed');
                        if (this._inboxCurrent(view, token, pui)) this._inbox.settleLiveBulk(token, runId, payload);
                    } catch (error) { if (this._inboxCurrent(view, token, pui)) this._inbox.settleLiveBulk(token, runId, null, error); }
                    this._renderInbox();
                }
                if (this._inboxCurrent(view, token, pui)) this._followInboxRun(view, token, pui, environment);
            };
            update(); return GLib.SOURCE_REMOVE;
        });
    }
    async _loadInboxContext(id) {
        const view = this._views.get('inbox'), inbox = this._inbox; if (!view) return;
        view.confirmRequests = null;
        const token = inbox.select(id), generation = inbox.generation, environment = this._inboxEnvironment, pui = this._settings.get_string('pui-path');
        this._renderInbox();
        try {
            const payload = await this._bridge.read(pui, {name: 'plans.attentionItem', args: {itemId: id}, environment});
            if (!this._inboxCurrent(view, generation, pui)) return;
            if (!sameEnvironment(environment, payload.environment)) throw new Error('Selected environment changed');
            inbox.settleContext(token, id, payload);
        } catch (error) { if (this._inboxCurrent(view, generation, pui)) inbox.settleContext(token, id, null, error); }
        this._renderInbox();
    }
    _prepareInbox(operation, options = {}) {
        const view = this._views.get('inbox'), inbox = this._inbox; if (!view) return;
        try {
            const environment = this._inboxEnvironment, query = this._states.get('inbox').query;
            const requests = operation === 'apply' ? inbox.items.filter(row => inbox.selectedReviews.has(row.itemId)).map(row => inbox.request('apply', environment, {itemId: row.itemId})) :
                [inbox.request(operation, environment, {query, answer: inbox.answer, ...options})];
            if (!requests.length) throw new Error('Select recommendations first');
            view.confirmRequests = requests; view.confirmPui = this._settings.get_string('pui-path');
        } catch (error) { inbox.actionNotice = error.message; }
        this._renderInbox();
    }
    async _confirmInbox() {
        const view = this._views.get('inbox'), inbox = this._inbox, requests = view?.confirmRequests; if (!requests) return;
        view.confirmRequests = null; let token;
        try {
            if (view.confirmPui !== this._settings.get_string('pui-path') || !sameEnvironment(requests[0].environment, this._inboxEnvironment)) throw new Error('Selected environment changed; review again');
            token = inbox.beginAction(requests); this._renderInbox();
            for (const request of requests) {
                const payload = await this._bridge.inbox(view.confirmPui, request), runId = inbox.recordAction(token, request, payload);
                if (runId) this._inboxRunId = runId;
            }
            inbox.finishAction(token);
        } catch (error) { if (token) inbox.finishAction(token, error); else inbox.actionNotice = error.message; }
        if (this._views.has('inbox')) this._refreshInbox();
    }
    _renderInbox() {
        const view = this._views.get('inbox'); if (!view) return;
        const inbox = this._inbox, query = this._states.get('inbox').query; inbox.retainVisibleSelection(query);
        if (!view.inboxList) {
            for (const [operation, title] of [['start', 'Resolve visible'], ['stop', 'Stop'], ['resume', 'Resume'], ['apply', 'Apply selected']]) view.content.add_child(button(title, () => this._prepareInbox(operation)));
            view.runField = new St.Entry({text: this._inboxRunId || '', hint_text: 'Saved run ID', can_focus: true, x_expand: true, accessible_name: 'Saved Inbox run ID'});
            view.content.add_child(view.runField);
            view.content.add_child(button('Open saved run', () => { this._inboxRunId = view.runField.get_text().trim() || null; this._refreshInbox(); }));
            for (const key of ['inboxConfirm', 'inboxList', 'inboxContext', 'inboxBulk']) { view[key] = new St.BoxLayout({vertical: true, x_expand: true}); view.content.add_child(view[key]); }
            view.bulkStatus = label(''); view.content.add_child(view.bulkStatus);
        }
        const rows = inbox.results(query);
        view.status.set_text(inbox.listError ? 'Inbox unavailable — ' + inbox.listError : inbox.listReady ? rows.length + ' questions' + (inbox.listPartial ? ' · Partial list' : '') : 'Loading questions…');
        view.inboxConfirm.destroy_all_children();
        if (view.confirmRequests) {
            const requests = view.confirmRequests, first = requests[0];
            view.inboxConfirm.add_child(label('Confirm ' + first.operation + ': ' + (first.items ? first.items.length + ' visible questions' : first.expected?.id || first.runId || requests.length + ' recommendations')));
            view.inboxConfirm.add_child(button('Confirm action', () => this._confirmInbox()));
            view.inboxConfirm.add_child(button('Cancel', () => { view.confirmRequests = null; this._renderInbox(); }));
        }
        const listKey = JSON.stringify([rows, inbox.selection]);
        if (view.listKey !== listKey) {
            view.listKey = listKey; view.inboxList.destroy_all_children();
            for (const row of rows) view.inboxList.add_child(button(row.title || row.id, () => this._loadInboxContext(row.id)));
        }
        const contextKey = JSON.stringify([inbox.context, inbox.selection, inbox.contextError, inbox.pending]);
        if (view.contextKey !== contextKey) {
            view.contextKey = contextKey; view.inboxContext.destroy_all_children(); const row = inbox.context;
            view.inboxContext.add_child(label(row ? [row.title, row.body, row.contextMarkdown].filter(Boolean).join('\n') : inbox.contextError || (inbox.selection ? 'Loading selected question…' : 'Select a question to view context.')));
            if (row) {
                const answer = new St.Entry({text: inbox.answer, hint_text: 'Your answer', can_focus: true, x_expand: true, accessible_name: 'Answer selected question'}); answer.reactive = !inbox.pending;
                answer.clutter_text.connect('text-changed', () => { inbox.answer = answer.get_text(); view.confirmRequests = null; }); view.inboxContext.add_child(answer);
                for (const action of InboxState.actions(row)) { const control = button(action.label || action.id, () => this._prepareInbox('resolve', {actionId: action.id})); control.reactive = !inbox.pending; view.inboxContext.add_child(control); }
            }
        }
        const bulkKey = JSON.stringify([inbox.items, inbox.run?.phase, inbox.pending]);
        if (view.bulkKey !== bulkKey) {
            view.bulkKey = bulkKey; view.inboxBulk.destroy_all_children(); let previous;
            for (const row of inbox.items.filter(item => !['auto_resolved', 'dismissed'].includes(item.outcome))) {
                const disposition = InboxState.disposition(row); if (previous !== disposition) { view.inboxBulk.add_child(label(disposition.replaceAll('_', ' '))); previous = disposition; }
                const title = row.title || row.itemId;
                const pick = button((inbox.selectedReviews.has(row.itemId) ? '☑ ' : '☐ ') + title, () => {
                    if (!inbox.canSelect(row.itemId)) return;
                    if (inbox.selectedReviews.has(row.itemId)) inbox.selectedReviews.delete(row.itemId); else inbox.selectedReviews.add(row.itemId);
                    pick.label = (inbox.selectedReviews.has(row.itemId) ? '☑ ' : '☐ ') + title; view.confirmRequests = null;
                });
                pick.reactive = inbox.canSelect(row.itemId); view.inboxBulk.add_child(pick);
                view.inboxBulk.add_child(label([row.rationale, row.recommendation?.rationale, row.error, row.retryCondition].filter(Boolean).join('\n')));
                if (InboxState.reviewable(row) && row.actionId === 'answer') {
                    const draft = new St.Entry({text: inbox.draft(row), can_focus: true, x_expand: true, accessible_name: 'Draft answer for ' + title}); draft.reactive = !inbox.pending;
                    draft.clutter_text.connect('text-changed', () => { inbox.drafts.set(row.itemId, draft.get_text()); view.confirmRequests = null; }); view.inboxBulk.add_child(draft);
                } else if (!InboxState.reviewable(row)) view.inboxBulk.add_child(label('Manual review required; excluded from Apply.'));
            }
        }
        let status = inbox.bulkError ? 'Saved run unavailable — ' + inbox.bulkError : !inbox.bulkReady ? 'Loading saved run…' : 'No saved bulk run';
        if (inbox.bulkReady && inbox.run) { const c = InboxState.counts(inbox.run, inbox.items); status = 'Run ' + inbox.run.runId + ' · ' + inbox.run.phase + '\n' + c.decided + '/' + c.total + ' decided · ' + c.percent + '% · ' + c.resolved + ' resolved · ' + c.unresolved + ' need attention · ' + c.left + ' left'; }
        view.bulkStatus.set_text(status + (inbox.pending ? '\nApplying action…' : '') + (inbox.actionNotice ? '\n' + inbox.actionNotice : ''));
    }
    _destroyActors(surface) {
        const view = this._views.get(surface);
        if (!view) return;
        if (view.searchTimer) GLib.source_remove(view.searchTimer);
        Main.layoutManager.removeChrome(view.panel); view.panel.destroy();
        if (view.runTimer) GLib.source_remove(view.runTimer);
        this._views.delete(surface);
    }
    _hide(surface, restoreFocus) {
        const view = this._views.get(surface), state = this._states.get(surface);
        if (surface === 'inbox') { ++this._inbox.generation; this._inbox.clearContext(); }
        if (surface === 'papercup') { this._stopChatStream(); this._stopCards(); this._chat.invalidate(); }
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

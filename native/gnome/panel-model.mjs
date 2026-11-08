// Pure state shared by GNOME Shell and the maintained Node/GJS tests. All
// identities, authorization and measurements come from the selected operator.
export const SOURCES = Object.freeze({ plans: 'plans.list', agents: 'advRoster.list',
    reports: 'reports.list', goals: 'goals.list' });

export function sourceRequests(query = '', scope = 'all') {
    return Object.entries(SOURCES).filter(([kind]) => scope === 'all' || kind === scope)
        .map(([kind, name]) => ({kind, name, args: kind === 'reports' ? {query, limit: 200} :
            kind === 'goals' ? {query, limit: 500} : {}}));
}

export function readRows(payload) {
    if (!payload || payload.ok === false || payload.error || !Array.isArray(payload.rows))
        throw new Error(payload?.error || 'The operator returned no row envelope');
    return payload.rows;
}

function required(value, label) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing canonical ${label}`);
    return value;
}

export function sourceRows(source, payload) {
    const rows = readRows(payload);
    if (source === 'agents') {
        if (rows.length !== 1 || !Array.isArray(rows[0].active) || !Array.isArray(rows[0].ended))
            throw new Error('Agent roster is unavailable');
        // The canonical ended tier contains adv_sessions records, rather
        // than presence-backed RosterEntry rows. Keep the stored launch ID
        // even when that session never registered a coordination owner.
        const ended = rows[0].ended.map(row => ({...row,
            ownerId: row.coordOwnerId ?? row.ownerId ?? null,
            advSessionId: row.id ?? row.advSessionId ?? null,
            sessionState: 'ended'}));
        return [...rows[0].active, ...ended, ...(rows[0].pending || []), ...(rows[0].starting || [])];
    }
    if (source === 'goals') {
        if (rows.length !== 1 || !Array.isArray(rows[0].goals))
            throw new Error('Goal portfolio is unavailable');
        return rows[0].goals;
    }
    return rows;
}

export function resultFor(kind, row) {
    let identity, title, subtitle;
    if (kind === 'plans') {
        identity = [required(row.harness, 'plan harness'), required(row.slug, 'plan slug')];
        title = row.title || row.slug;
        subtitle = [row.status, row.harness, row.nextAction];
    } else if (kind === 'agents') {
        identity = Number.isSafeInteger(row.advSessionId) && row.advSessionId > 0 ?
            ['adv', row.advSessionId] : ['owner', required(row.ownerId, 'agent owner')];
        title = row.label || row.agent || row.ownerId || `Session ${row.advSessionId}`;
        subtitle = [row.intent || row.sessionState, row.machineLabel || row.host || row.hostname,
            row.workspaceName || row.desktop];
    } else if (kind === 'reports') {
        identity = [required(row.report_id, 'report id')]; title = row.title;
        subtitle = [row.kind, row.summary];
    } else if (kind === 'goals') {
        identity = [required(row.id, 'goal id')]; title = row.title || row.id;
        subtitle = [row.effectiveStatus || row.status, row.description || row.body];
    } else throw new Error(`Unknown Workbench source: ${kind}`);
    return { key: JSON.stringify([kind, ...identity]), kind, title: title || identity[0],
        subtitle: subtitle.filter(Boolean).join(' · '), row };
}

export function searchResults(sources, query = '', scope = 'all', perSource = 26) {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const results = [];
    for (const kind of Object.keys(SOURCES)) {
        if (scope !== 'all' && scope !== kind) continue;
        const rows = sources[kind]?.rows;
        if (!Array.isArray(rows)) continue;
        let count = 0;
        for (const row of rows) {
            const result = resultFor(kind, row);
            const text = [result.title, result.subtitle, row.slug, row.ownerId,
                row.currentPlanSlug, row.subject?.label, row.goalPackageRef]
                .filter(Boolean).join(' ').toLocaleLowerCase();
            if (!terms.every(term => text.includes(term))) continue;
            if (++count > perSource) break;
            results.push(result);
        }
    }
    return results;
}

export function detailRequest(result) {
    if (result.kind === 'plans') return { name: 'plans.get', args: {
        slug: result.row.slug, harness: result.row.harness, mode: 'full', includeRaw: true } };
    if (result.kind === 'reports') return { name: 'reports.get', args: { reportId: result.row.report_id } };
    if (result.kind === 'goals') return { name: 'goals.detail', args: { goalId: result.row.id } };
    throw new Error('Select an agent through its exact terminal route');
}

// Revalidate the selected owner immediately before a desktop action. Roster
// locality alone refers to the selected operator, which may be on another host.
export function agentFocusTarget(payload, selected, localHost) {
    if (selected?.sessionState === 'ended' || selected?.endedAt)
        throw new Error('The selected session has ended; use its saved connection to resume it');
    const ownerId = required(selected?.ownerId, 'agent owner');
    const selectedSession = Number.isSafeInteger(selected.advSessionId) && selected.advSessionId > 0 ?
        selected.advSessionId : null;
    const selectedWindow = typeof selected.windowId === 'string' && selected.windowId.trim() ? selected.windowId : null;
    if (!selectedSession && !selectedWindow) throw new Error('The selected row has no exact session identity; refresh the results');
    const owners = sourceRows('agents', payload).filter(row => row.ownerId === ownerId);
    const matches = owners.filter(row => selectedSession ? row.advSessionId === selectedSession :
        row.windowId === selectedWindow);
    if (!matches.length && owners.length)
        throw new Error('The selected session changed; refresh the results before opening it');
    if (matches.length !== 1) throw new Error('The selected agent is unavailable or ambiguous');
    const row = matches[0];
    const selectedHost = selected.host || selected.hostname;
    if ((selectedSession ? row.advSessionId !== selectedSession : row.windowId !== selectedWindow) ||
        (selectedHost && (row.host || row.hostname) !== selectedHost))
        throw new Error('The selected session changed; refresh the results before opening it');
    if (row.revoked || row.stale || !['live', 'parked'].includes(row.sessionState))
        throw new Error('The selected session is no longer live; use its saved connection to resume it');
    const host = row.host || row.hostname;
    if (!host || host !== localHost || row.isLocal === false)
        throw new Error('This session is on another machine; use its saved connection');
    const windowId = typeof row.windowId === 'string' && row.windowId.trim() ? row.windowId : null;
    const advSessionId = Number.isSafeInteger(row.advSessionId) && row.advSessionId > 0 ? row.advSessionId : null;
    if (!windowId && !advSessionId) throw new Error('No exact desktop window is recorded for this session');
    return {ownerId, windowId, advSessionId};
}

// Resume is a separate, explicit action. Re-read the selected operator before
// constructing a terminal command: numeric launch IDs belong to that host,
// and an ended search result may have become live since it was displayed.
export function agentResumeTarget(payload, selected, localHost) {
    required(localHost, 'desktop host');
    const id = selected?.advSessionId;
    if (!Number.isSafeInteger(id) || id < 1)
        throw new Error('The selected row has no exact session identity; refresh the results');
    const host = required(selected.host || selected.hostname, 'session host');
    const rows = sourceRows('agents', payload);
    const matches = rows.filter(row => row.advSessionId === id);
    if (matches.length !== 1) throw new Error('The selected session is unavailable or ambiguous');
    const row = matches[0];
    if ((row.host || row.hostname) !== host || (row.ownerId || null) !== (selected.ownerId || null))
        throw new Error('The selected session changed; refresh the results before resuming it');
    if (row.revoked || row.sessionState !== 'ended' || row.pidAlive === true ||
        rows.some(other => other !== row && row.ownerId && other.ownerId === row.ownerId &&
            ['live', 'parked', 'starting'].includes(other.sessionState)))
        throw new Error('The selected session is running or cannot be resumed; refresh the results');
    return {advSessionId: id, host, ownerId: row.ownerId || null, remote: host !== localHost};
}

export function resumeArgv(pui, target) {
    required(pui, 'PUI command');
    return [pui, 'workbench', 'resume', String(target.advSessionId), target.host, target.ownerId || ''];
}

export function exactAgentWindow(target, windows) {
    const xid = value => /^0x[0-9a-f]+$/i.test(value || '') ? BigInt(value).toString() : null;
    const recordedId = xid(target.windowId);
    const marker = target.advSessionId ? `[adv:${target.advSessionId}]` : null;
    const matches = windows.filter(window => target.windowId ?
        (recordedId ? xid(window.id) === recordedId : window.title === target.windowId) :
        (marker && window.title?.includes(marker)));
    if (matches.length !== 1) throw new Error('The exact terminal window is unavailable or ambiguous');
    // A recorded handle is authoritative: do not fall back to a different
    // window's marker, or accept a recycled handle carrying another session.
    if (marker && /\[adv:\d+\]/.test(matches[0].title || '') && !matches[0].title.includes(marker))
        throw new Error('The recorded terminal handle conflicts with the selected session');
    return matches[0];
}

// Reuse roster plan/fleet identities and goals.detail's stamped/derived plan
// rail and live holders. A project's membership in a goal is not an agent link.
const agentHarness = row => row.potSlug || row.harnessSlug || null;
export function organizerGroups(rows, kind, goals = []) {
    if (kind === 'goal') return goals.map(row => ({kind, id: row.id,
        key: JSON.stringify([kind, required(row.id, 'goal id')]), label: row.title || row.id}));
    if (!['plan', 'fleet'].includes(kind)) throw new Error('Unknown organization grouping');
    const groups = new Map();
    for (const row of rows) {
        const slug = kind === 'plan' ? row.currentPlanSlug : row.fleetSlug;
        const harness = kind === 'plan' ? agentHarness(row) : null;
        if (!slug || (kind === 'plan' && !harness)) continue;
        const key = JSON.stringify([kind, harness, slug]);
        if (!groups.has(key)) groups.set(key, {key, kind, slug, harness,
            label: kind === 'plan' ? `${harness} / ${slug}` : slug, rows: []});
        groups.get(key).rows.push(row);
    }
    return [...groups.values()];
}

export function organizerMembers(group, roster, goalPayload = null) {
    const aggregate = oneRow(roster);
    if (aggregate.partial || aggregate.truncatedByLimit ||
        (aggregate.degradedFields && Object.keys(aggregate.degradedFields).length))
        throw new Error('Canonical terminal roster is incomplete; refresh before arranging');
    const rows = sourceRows('agents', roster);
    if (group.kind === 'goal') {
        const detail = oneRow(goalPayload);
        if (detail.goal?.id !== group.id || !Array.isArray(detail.agents) || !Array.isArray(detail.plans))
            throw new Error('Canonical goal links are unavailable or changed');
        return rows.filter(row => detail.agents.some(agent => agent.ownerId === row.ownerId && agent.live === true) ||
            detail.plans.some(plan => plan.planSlug === row.currentPlanSlug &&
                plan.harnessSlug === agentHarness(row)));
    }
    return rows.filter(row => group.kind === 'plan' ?
        row.currentPlanSlug === group.slug && agentHarness(row) === group.harness :
        group.kind === 'fleet' && row.fleetSlug === group.slug);
}

// Resolve all exact windows before any mutation; one missing/offline desktop
// remains an explicit receipt while independently resolvable desktops proceed.
// The adapter owns native mutation and must verify its observed geometry.
export async function arrangeOrganizerGroup(group, roster, host, windows, place, goalPayload = null) {
    const current = organizerMembers(group, roster, goalPayload);
    const selected = group.kind === 'goal' ? current : group.rows;
    if (!Array.isArray(selected) || !selected.length) throw new Error('No canonical terminals in this group');
    const receipts = [], resolved = [];
    for (const row of selected) {
        const receipt = {ownerId: row.ownerId, advSessionId: row.advSessionId,
            host: row.host || row.hostname || null, desktop: null, status: 'failed'};
        receipts.push(receipt);
        try {
            const target = agentFocusTarget(roster, row, host);
            if (!current.some(candidate => candidate.ownerId === target.ownerId &&
                candidate.advSessionId === row.advSessionId && candidate.windowId === row.windowId))
                throw new Error('The selected terminal changed group; refresh before arranging');
            const window = exactAgentWindow(target, windows);
            receipt.desktop = window.desktop;
            receipt.monitor = window.monitor;
            if (window.unsupported) { receipt.status = 'unsupported'; throw new Error(window.unsupported); }
            const area = window.area;
            if (!Number.isInteger(window.desktop) || !Number.isInteger(window.monitor) ||
                !area || ![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
                area.width < 1 || area.height < 1)
                throw new Error('Desktop work area is unavailable');
            resolved.push({window, receipt});
        } catch (error) {
            if (receipt.host && receipt.host !== host) receipt.status = 'unsupported';
            else if (row.sessionState === 'ended' || row.stale || row.revoked) receipt.status = 'offline';
            receipt.error = String(error.message || error);
        }
    }
    const desktops = new Map();
    for (const entry of resolved) {
        if (resolved.some(other => other !== entry && other.window === entry.window)) {
            entry.receipt.error = 'Several selected sessions share this terminal window';
            continue;
        }
        const key = JSON.stringify([entry.window.desktop, entry.window.monitor]);
        if (!desktops.has(key)) desktops.set(key, []);
        desktops.get(key).push(entry);
    }
    for (const entries of desktops.values()) {
        const area = entries[0].window.area;
        const columns = Math.min(entries.length, Math.max(1,
            Math.ceil(Math.sqrt(entries.length * area.width / area.height))));
        const rows = Math.ceil(entries.length / columns), gap = 12;
        for (const [index, {window, receipt}] of entries.entries()) {
            const column = index % columns, row = Math.floor(index / columns);
            const x = Math.round(area.x + column * area.width / columns);
            const y = Math.round(area.y + row * area.height / rows);
            const rect = {x: x + gap, y: y + gap,
                width: Math.round(area.x + (column + 1) * area.width / columns) - x - 2 * gap,
                height: Math.round(area.y + (row + 1) * area.height / rows) - y - 2 * gap};
            receipt.requested = rect;
            try {
                if (rect.width < 1 || rect.height < 1) throw new Error('Too many terminals for this desktop');
                const actual = await place(window, rect);
                receipt.observed = actual;
                if (!actual || actual.desktop !== window.desktop || actual.monitor !== window.monitor ||
                    !Object.keys(rect).every(key => Number.isFinite(actual[key]) && Math.abs(actual[key] - rect[key]) <= 2))
                    throw new Error('The terminal did not reach its requested layout within its desktop');
                receipt.status = 'moved';
            } catch (error) { receipt.error = String(error.message || error); }
        }
    }
    return receipts;
}

// One instance per surface. Dismissal retains drafts and canonical selections;
// stale transport completions cannot overwrite a newer refresh or detail.
export class PanelState {
    constructor() {
        Object.assign(this, { visible: false, pinned: false, query: '', scope: 'all',
            selection: null, detail: null, sources: {}, generation: 0, detailGeneration: 0,
            resultLimit: 26, resultQuery: null });
    }
    toggle() { this.visible = !this.visible; return this.visible; }
    outsideFocus() { if (!this.pinned) this.visible = false; }
    escape() {
        if (this.detail) { this.detail = null; return 'detail'; }
        this.visible = false; return 'panel';
    }
    beginRefresh(kinds = Object.keys(SOURCES)) {
        const query = JSON.stringify([this.query, this.scope]);
        if (query !== this.resultQuery) { this.resultLimit = 26; this.resultQuery = query; }
        ++this.generation;
        this.sources = Object.fromEntries(kinds.map(kind => [kind, { status: 'loading' }]));
        return this.generation;
    }
    settle(kind, generation, payload, error = null) {
        if (generation !== this.generation) return false;
        try {
            if (error) throw error;
            const rows = sourceRows(kind, payload);
            rows.forEach(row => resultFor(kind, row));
            const aggregate = ['agents', 'goals'].includes(kind) ? payload.rows[0] : {};
            this.sources[kind] = { status: 'ready', rows, version: payload.version,
                partial: Boolean(payload.partial || aggregate.truncatedByLimit || aggregate.partial),
                unavailable: aggregate.degradedFields || aggregate.unavailable || aggregate.errors || null,
                total: aggregate.totalGoals ?? null };
        } catch (cause) {
            this.sources[kind] = { status: 'unavailable', error: String(cause.message || cause) };
        }
        return true;
    }
    results() { return searchResults(this.sources, this.query, this.scope, this.resultLimit); }
    hasMoreResults() {
        return searchResults(this.sources, this.query, this.scope, Infinity).length > this.results().length;
    }
    showMoreResults() { this.resultLimit += 26; }
    selected() {
        const rows = this.results();
        return rows.find(row => row.key === this.selection) || rows[0] || null;
    }
    move(delta) {
        const rows = this.results();
        if (!rows.length) { this.selection = null; return; }
        const current = rows.findIndex(row => row.key === this.selected()?.key);
        this.selection = rows[(current + delta + rows.length) % rows.length].key;
    }
}

// Adapter for canonical attention and persisted bulk-run state; PUI owns all
// authorization, fresh action validation and terminal effects.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) ?
    a.length === b.length && a.every((v, i) => equal(v, b[i])) :
    object(a) && object(b) && Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(key => Object.hasOwn(b, key) && equal(a[key], b[key])));
export function sameEnvironment(a, b) {
    const fields = v => [v?.endpoint, v?.workspaceId, v?.store?.id, v?.agentChat?.scope];
    const right = fields(b);
    return fields(a).every((v, i) => typeof v === 'string' && v.length > 0 && v === right[i]);
}
export function oneRow(payload) {
    const rows = readRows(payload);
    if (payload.partial || rows.length !== 1 || !object(rows[0])) throw new Error('Canonical state is incomplete');
    return rows[0];
}

const snapshot = value => JSON.parse(JSON.stringify(value));
const sequence = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const replyPhases = ['running', 'awaiting-input', 'completed', 'failed', 'cancelled', 'interrupted', 'needs-reconciliation'];
function conversationRow(payload, environment) {
    if (!sameEnvironment(environment, payload?.environment)) throw new Error('The selected conversation environment changed');
    return oneRow(payload);
}

// Projection of the canonical chat-protocol v1, shared by Node and real Shell.
// A transport disconnect is never a durable cancellation or permission to resend.
export class ChatReply {
    constructor(environment, conversationId, text, userTurnId, modality = 'text') {
        if (!sameEnvironment(environment, environment) || !conversationId || !uuid(userTurnId))
            throw new Error('Missing canonical conversation or message identity');
        if (!['text', 'voice'].includes(modality)) throw new Error('Invalid message modality');
        Object.assign(this, {environment: snapshot(environment), conversationId, text, userTurnId, modality,
            turnId: '', sequence: 0, savedUser: null, phase: 'connecting', complete: false,
            connected: true, displayText: '', raw: '', tools: [], events: new Map()});
    }
    get sendRequest() {
        return {environment: snapshot(this.environment), conversationId: this.conversationId,
            operation: 'send', text: this.text, userTurnId: this.userTurnId, modality: this.modality};
    }
    control(operation) {
        if (!['reconnect', 'cancel'].includes(operation) || !this.turnId || this.complete)
            throw new Error('The saved reply identity is unavailable; refresh before sending again');
        return {environment: snapshot(this.environment), conversationId: this.conversationId,
            operation, turnId: this.turnId, ...(operation === 'reconnect' ? {afterSequence: this.sequence} : {})};
    }
    disconnected() { this.connected = false; if (!this.complete) this.phase = 'needs-reconciliation'; }
    _matches(value) { return value?.conversationId === this.conversationId && this.turnId && value?.turnId === this.turnId; }
    _state(value) {
        const capabilities = ['connectionReplay', 'persistedHistory', 'persistedInteractionDecisions',
            'completedToolCheckpoints', 'interruptedTurnRecovery'];
        if (value?.schemaVersion !== 1 || !this._matches(value) || !sequence(value.revision) ||
            !sequence(value.lastSequence) || !replyPhases.includes(value.phase) ||
            !capabilities.every(key => typeof value.capabilities?.[key] === 'boolean'))
            throw new Error('Invalid saved reply state');
        return value.phase;
    }
    receive(frame) {
        // Refused frames cannot partially mutate text, cursor or saved identity.
        const next = Object.assign(Object.create(ChatReply.prototype), this,
            {events: new Map(this.events), tools: [...this.tools]});
        next._reduce(frame); Object.assign(this, next);
    }
    _reduce(frame) {
        if (!sameEnvironment(this.environment, frame?.environment) || this.complete)
            throw new Error('The reply belongs to a different environment or is already complete');
        const data = frame.data;
        switch (frame.event) {
        case 'user-saved': {
            const row = data?.turn;
            if (data?.conversationId !== this.conversationId || row?.conversationId !== this.conversationId ||
                row.id !== this.userTurnId || row.role !== 'user' || row.text !== this.text || !sequence(row.seq))
                throw new Error('Invalid saved message acknowledgement');
            this.savedUser = snapshot(row); break;
        }
        case 'run-meta':
            if (data?.chatProtocolVersion !== 1 || data.conversationId !== this.conversationId)
                throw new Error('Unsupported reply protocol or conversation');
            break;
        case 'turn-meta':
            if (data?.schemaVersion !== 1 || data.conversationId !== this.conversationId || !uuid(data.turnId) ||
                (this.turnId && data.turnId !== this.turnId)) throw new Error('Invalid reply identity');
            this.turnId = data.turnId; this.phase = 'running'; break;
        case 'chat-event': {
            const n = data?.sequence;
            if (data?.schemaVersion !== 1 || !this._matches(data) || !sequence(n) || n < 1 ||
                typeof data.eventId !== 'string' || !data.eventId) throw new Error('Invalid saved reply event');
            if (n <= this.sequence) {
                if (!equal(this.events.get(n), data)) throw new Error('Conflicting saved reply event');
                return;
            }
            if (n !== this.sequence + 1) throw new Error('The saved reply has a sequence gap');
            const event = data.event;
            switch (event?.type) {
            case 'delta': {
                if (typeof event.text !== 'string' || new TextEncoder().encode(this.raw + event.text).length > 8 * 1024 * 1024)
                    throw new Error('Invalid or oversized reply text');
                this.raw += event.text;
                const open = /<say>/i.exec(this.raw);
                if (open) {
                    let text = this.raw.slice(open.index + open[0].length), close = /<\/say>/i.exec(text);
                    if (close) text = text.slice(0, close.index);
                    else for (let n = Math.min(text.length, 5); n > 0; --n)
                        if (text.toLowerCase().endsWith('</say>'.slice(0, n))) { text = text.slice(0, -n); break; }
                    this.displayText = text;
                }
                break;
            }
            case 'tool_call': case 'tool_result':
                if (!event.name || !event.callId || (event.type === 'tool_result' && typeof event.ok !== 'boolean'))
                    throw new Error('Invalid tool activity');
                this.tools.push(event.name + (event.type === 'tool_call' ? ' · running' : event.ok ? ' · complete' : ' · failed'));
                break;
            case 'lifecycle':
                if (!replyPhases.includes(event.phase)) throw new Error('Invalid reply lifecycle');
                this.phase = event.phase; break;
            case 'error': throw new Error(event.message || 'Reply failed');
            case 'done': case 'session': case 'provenance': case 'result': break;
            default: throw new Error('Unsupported saved reply event');
            }
            this.sequence = n; this.events.set(n, snapshot(data));
            if (this.events.size > 5000) this.events.delete(n - 5000);
            break;
        }
        case 'turn-state': {
            const phase = this._state(data);
            if (['failed', 'cancelled', 'interrupted', 'needs-reconciliation'].includes(phase))
                throw new Error('The saved reply is ' + phase);
            this.phase = phase; break;
        }
        case 'done':
            if (!this._matches(data?.persistedTurn) || !sequence(data.persistedTurn.seq) ||
                (data.phase !== undefined && data.phase !== null && data.phase !== 'completed'))
                throw new Error('The saved reply acknowledgement was lost or does not match');
            this.complete = true; this.connected = false; this.phase = 'completed'; break;
        case 'cancelled':
            if (data?.ok !== true || this._state(data.state) !== 'cancelled') throw new Error('Reply cancellation needs reconciliation');
            this.complete = true; this.connected = false; this.phase = 'cancelled'; break;
        case 'error': throw new Error(data?.message || 'Reply failed; reconcile before sending again');
        default: throw new Error('Unsupported reply frame');
        }
    }
}

export class ChatState {
    constructor() { this.generation = 0; this.drafts = new Map(); this.draftModalities = new Map(); this.referenceContexts = new Map(); this.begin(); this.loading = false; }
    get conversationId() { return this.conversation?.id || ''; }
    get ready() { return this.loaded && this.conversationId && sameEnvironment(this.environment, this.environment); }
    get draftKey() { return this.conversationId && sameEnvironment(this.environment, this.environment) ?
        JSON.stringify([this.environment.endpoint, this.environment.workspaceId, this.environment.store.id,
            this.environment.agentChat.scope, this.conversationId]) : null; }
    get draft() { return this.drafts.get(this.draftKey) || ''; }
    set draft(text) {
        if (!this.draftKey) return;
        if (this.draft !== text) { this.cancelVoice(); this.draftModalities.set(this.draftKey, 'text'); }
        this.drafts.set(this.draftKey, text);
    }
    begin() {
        this.cancelVoice();
        ++this.generation;
        Object.assign(this, {environment: null, conversation: null, turns: [], loading: true,
            loaded: false, hasMoreEarlier: false, reply: null, error: null, referencePlans: [], referenceError: null});
        return this.generation;
    }
    invalidate() { this.begin(); this.loading = false; }
    bind(token, environment, payload) {
        if (token !== this.generation) return false;
        const row = conversationRow(payload, environment);
        if (!sameEnvironment(environment, environment) || typeof row.id !== 'string' || !row.id ||
            row.workspaceId !== environment.workspaceId || row.subjectKind !== 'global' || row.status !== 'active')
            throw new Error('The active Papercup conversation is unavailable');
        this.environment = snapshot(environment); this.conversation = snapshot(row); return true;
    }
    beginEarlier() {
        if (!this.ready || this.loading || this.reply || !this.hasMoreEarlier || !sequence(this.turns[0]?.seq))
            throw new Error('Earlier messages are unavailable');
        this.cancelVoice(); this.loading = true; this.error = null; return this.turns[0].seq;
    }
    settle(token, environment, conversationId, payload, beforeSeq = null) {
        if (token !== this.generation) return false;
        if (!this.loading || !sameEnvironment(this.environment, environment) || this.conversationId !== conversationId || !conversationId)
            throw new Error('The selected Papercup conversation changed');
        const page = conversationRow(payload, environment), ids = new Set(); let previous = -1;
        if (!Array.isArray(page.turns) || typeof page.hasMoreEarlier !== 'boolean' || (page.hasMoreEarlier && !page.turns.length))
            throw new Error('Papercup history is incomplete');
        for (const row of page.turns) {
            if (typeof row.id !== 'string' || !row.id || ids.has(row.id) || row.conversationId !== conversationId ||
                !sequence(row.seq) || row.seq <= previous || !['user', 'assistant', 'system', 'tool'].includes(row.role) ||
                typeof row.text !== 'string' || (beforeSeq !== null && row.seq >= beforeSeq))
                throw new Error('Papercup history contains an invalid or foreign message');
            ids.add(row.id); previous = row.seq;
        }
        if (beforeSeq !== null) {
            if (!this.loaded || this.turns[0]?.seq !== beforeSeq || this.turns.some(row => ids.has(row.id)))
                throw new Error('Earlier messages changed; refresh the conversation');
            this.turns = snapshot(page.turns).concat(this.turns);
        } else {
            if (this.loaded) throw new Error('History was already loaded');
            this.turns = snapshot(page.turns);
        }
        this.hasMoreEarlier = page.hasMoreEarlier; this.loading = false; this.loaded = true; this.error = null; return true;
    }
    fail(token, error) { if (token === this.generation) { this.loading = false; this.error = String(error.message || error); } }
    settleReferencePlans(token, environment, payload, error = null) {
        if (token !== this.generation || !sameEnvironment(this.environment, environment)) return false;
        try {
            if (error) throw error;
            if (!sameEnvironment(environment, payload?.environment)) throw new Error('Work link environment changed');
            const plans = sourceRows('plans', payload).map(row => resultFor('plans', row));
            if (new Set(plans.map(plan => plan.key)).size !== plans.length) throw new Error('Duplicate work link context');
            this.referencePlans = plans; this.referenceError = null;
        } catch (cause) { this.referencePlans = []; this.referenceError = String(cause.message || cause); }
        return true;
    }
    selectReferencePlan(key) {
        if (!this.ready || (key !== null && !this.referencePlans.some(plan => plan.key === key)))
            throw new Error('Choose an available work link context');
        if (key === null) this.referenceContexts.delete(this.draftKey); else this.referenceContexts.set(this.draftKey, key);
    }
    get referenceContext() {
        const plan = this.referencePlans.find(row => row.key === this.referenceContexts.get(this.draftKey));
        return plan ? {endpoint: this.environment.endpoint, harness: plan.row.harness, planSlug: plan.row.slug} : {};
    }
    get canSend() { return Boolean(this.ready && !this.loading && (!this.reply || this.reply.complete) &&
        this.draft.trim() && new TextEncoder().encode(this.draft).length <= 32 * 1024); }
    get canUseVoice() { return Boolean(this.ready && !this.loading && (!this.reply || this.reply.complete)); }
    get spokenReply() {
        return this.reply?.phase === 'completed' && this.reply.displayText ? this.reply.displayText :
            [...this.turns].reverse().find(turn => turn.role === 'assistant')?.text || '';
    }
    beginVoice(id, phase) {
        if (!uuid(id) || !this.canUseVoice || this.voice || !['permission', 'synthesizing'].includes(phase))
            throw new Error('Load the conversation and finish the current voice operation first');
        this.voice = {id, generation: this.generation, environment: snapshot(this.environment),
            conversationId: this.conversationId, draft: this.draft};
        this.voicePhase = phase; return id;
    }
    voiceCurrent(id) {
        const voice = this.voice;
        return Boolean(voice && voice.id === id && voice.generation === this.generation && this.canUseVoice &&
            sameEnvironment(voice.environment, this.environment) && voice.conversationId === this.conversationId &&
            voice.draft === this.draft);
    }
    advanceVoice(id, phase) {
        if (!this.voiceCurrent(id) || !['permission:recording', 'recording:transcribing', 'synthesizing:playing']
            .includes(this.voicePhase + ':' + phase)) return false;
        this.voicePhase = phase; return true;
    }
    cancelVoice() { this.voice = null; this.voicePhase = null; }
    transcribed(id, request, payload) {
        if (!this.voiceCurrent(id)) return false;
        if (this.voicePhase !== 'transcribing' || request.requestId !== id || request.operation !== 'transcribe' ||
            request.conversationId !== this.conversationId || !sameEnvironment(request.environment, this.environment))
            throw new Error('The voice conversation changed; your draft was preserved');
        const row = nativeVoiceResult(request, payload);
        this.drafts.set(this.draftKey, row.text); this.draftModalities.set(this.draftKey, 'voice');
        this.cancelVoice(); return true;
    }
    send(userTurnId) {
        if (!this.canSend) throw new Error('Load the conversation and enter a bounded message first');
        this.cancelVoice();
        this.reply = new ChatReply(this.environment, this.conversationId, this.draft, userTurnId,
            this.draftModalities.get(this.draftKey) || 'text');
        this.error = null; return this.reply.sendRequest;
    }
    receive(token, frame) {
        if (token !== this.generation) return false;
        if (!this.reply) throw new Error('No reply is active');
        this.reply.receive(frame);
        const row = this.reply.savedUser;
        if (row && !this.turns.some(turn => turn.id === row.id)) {
            this.turns.push(snapshot(row)); if (this.draft === this.reply.text) this.draft = '';
        }
        this.error = null; return true;
    }
    replyFailed(token, error) {
        if (token !== this.generation) return;
        this.reply?.disconnected(); this.error = String(error.message || error);
    }
}
// Reuse the existing PUI VoiceRequest and canonical receipt. Devices stay local;
// neither an unacknowledged transcript nor a foreign audio result can be applied.
export function nativeVoiceRequest(request) {
    if (!sameEnvironment(request?.environment, request?.environment) || !uuid(request?.conversationId) ||
        !uuid(request?.requestId) || !['transcribe', 'speak'].includes(request?.operation))
        throw new Error('Select an exact voice conversation and request');
    const bounded = (text, max) => typeof text === 'string' && text.trim() && new TextEncoder().encode(text).length <= max;
    if (request.operation === 'speak' ? (!bounded(request.text, 32 * 1024) || request.audioBase64 !== undefined) :
        (request.text !== undefined || !canonicalBase64(request.audioBase64, 2_600_000)))
        throw new Error('Invalid or oversized native voice request');
    return snapshot(request);
}
function canonicalBase64(text, limit) {
    if (typeof text !== 'string' || !text.length || text.length > limit || text.length % 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return false;
    // A flat character class stays bounded for a full minute of audio. Check
    // the padding bits too so alternate encodings cannot alias one receipt.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    return text.endsWith('==') ? (alphabet.indexOf(text.at(-3)) & 15) === 0 :
        !text.endsWith('=') || (alphabet.indexOf(text.at(-2)) & 3) === 0;
}
export function nativeVoiceResult(request, payload) {
    const rows = readRows(payload), row = rows[0];
    if (!sameEnvironment(request.environment, payload.environment) || rows.length !== 1 ||
        row?.conversationId !== request.conversationId || row?.requestId !== request.requestId ||
        row?.operation !== request.operation || !['transcribe', 'speak'].includes(request.operation))
        throw new Error('Voice receipt belongs to a different environment, conversation or request');
    if (request.operation === 'transcribe' ? (typeof row.text !== 'string' || !row.text.trim() ||
        new TextEncoder().encode(row.text).length > 32 * 1024) : !canonicalBase64(row.audioBase64, 11_184_812))
        throw new Error('No usable voice result; your draft was preserved');
    return snapshot(row);
}
export class InboxState {
    constructor() {
        Object.assign(this, {generation: 0, contextGeneration: 0, actionGeneration: 0,
            rows: [], items: [], run: null, savedRunId: null, context: null, selection: null,
            listReady: false, bulkReady: false, listPartial: false, pending: false,
            listError: null, bulkError: null, contextError: null, actionNotice: null,
            selectedReviews: new Set(), applied: new Set(), drafts: new Map(), answer: ''});
    }
    clearContext() { ++this.contextGeneration; this.context = null; this.contextError = null; }
    begin() {
        ++this.generation; this.rows = []; this.items = []; this.run = null;
        this.listReady = false; this.bulkReady = false; this.listPartial = false;
        this.listError = null; this.bulkError = null; this.clearContext(); return this.generation;
    }
    settleList(token, payload, error = null) {
        if (token !== this.generation) return false;
        try {
            if (error) throw error;
            const seen = new Map(); let partial = Boolean(payload?.partial);
            for (const group of readRows(payload)) {
                if (!Array.isArray(group.items)) throw new Error('Inbox group is unavailable');
                partial ||= Boolean(group._meta?.hasMore);
                for (const row of group.items) {
                    required(row.id, 'item id'); required(row.kind, 'item kind');
                    if (!object(row.ref)) throw new Error('Missing canonical item reference');
                    if (seen.has(row.id) && !equal(seen.get(row.id), row)) throw new Error('Conflicting Inbox identities');
                    seen.set(row.id, row);
                }
            }
            const selected = this.rows.find(row => row.id === this.selection), next = seen.get(this.selection);
            if (!next || (selected && (!equal(selected.ref, next.ref) || selected.kind !== next.kind))) this.clearContext();
            this.rows = [...seen.values()]; this.listPartial = partial; this.listReady = true; this.listError = null;
            if (!next) this.selection = null;
        } catch (cause) { this.rows = []; this.listReady = false; this.listError = cause.message; this.clearContext(); }
        return true;
    }
    results(query = '') {
        const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
        return this.rows.filter(row => {
            const text = ['id', 'title', 'body', 'kind', 'harnessSlug', 'planSlug'].map(key => row[key] || '').join(' ').toLocaleLowerCase();
            return terms.every(term => text.includes(term));
        });
    }
    retainVisibleSelection(query) { if (this.selection && !this.results(query).some(row => row.id === this.selection)) this.dismissContext(); }
    dismissContext() { if (!this.selection) return false; this.selection = null; this.clearContext(); return true; }
    select(id) {
        if (!this.listReady || !this.rows.some(row => row.id === id)) throw new Error('Select a current Inbox item');
        if (this.selection !== id) this.answer = '';
        this.selection = id; this.clearContext(); return this.contextGeneration;
    }
    settleContext(token, id, payload, error = null) {
        if (token !== this.contextGeneration || this.selection !== id) return false;
        try {
            if (error) throw error;
            const detail = oneRow(payload), selected = this.rows.find(row => row.id === id);
            if (!selected || detail.id !== id || detail.kind !== selected.kind || !equal(detail.ref, selected.ref)) throw new Error('The selected question changed; refresh its context');
            this.context = detail; this.contextError = null;
        } catch (cause) { this.context = null; this.contextError = cause.message; }
        return true;
    }
    settleBulk(token, payload, runId = null, error = null) {
        if (token !== this.generation) return false;
        try {
            if (error) throw error;
            const row = oneRow(payload);
            if (!Array.isArray(row.items)) throw new Error('Saved run items are unavailable');
            if (row.run === null) {
                if (row.items.length || runId) throw new Error('The selected saved run is unavailable');
            } else {
                required(row.run?.runId, 'run id');
                if ((runId && row.run.runId !== runId) || !['pending', 'running', 'review', 'complete', 'failed'].includes(row.run.phase)) throw new Error('Saved run identity or phase changed');
                InboxState.counts(row.run, row.items);
            }
            if (this.savedRunId !== row.run?.runId) { this.selectedReviews.clear(); this.drafts.clear(); }
            this.savedRunId = row.run?.runId || null; this.run = row.run; this.items = row.items;
            this.bulkReady = true; this.bulkError = null;
            const allowed = new Set(this.items.filter(InboxState.reviewable).map(item => item.itemId));
            for (const id of this.selectedReviews) if (!allowed.has(id)) this.selectedReviews.delete(id);
        } catch (cause) { this.run = null; this.items = []; this.bulkReady = false; this.bulkError = cause.message; }
        return true;
    }
    settleLiveBulk(token, runId, payload, error = null) {
        if (this.pending || runId !== this.savedRunId) return false;
        return this.settleBulk(token, payload, runId, error);
    }
    static disposition(row) { return row.outcome === 'recommended' && row.recommendation?.kind || row.disposition || row.outcome; }
    static reviewable(row) { return row.outcome === 'recommended' && InboxState.disposition(row) === 'recommended'; }
    static retryable(row) { return ['pending', 'failed'].includes(row.outcome) || row.outcome === 'skipped' && ['', 'retry_needed'].includes(row.disposition || ''); }
    static actions(row) {
        return (row.actions || []).flatMap(action => {
            if (row.ref?.kind !== 'coord-escalation' || !['resolve', 'mark-done'].includes(action.id)) return [action];
            const options = (row.ref.options || []).filter(option => typeof option.id === 'string' && option.id.trim());
            return options.length ? options : row.ref.conversationId?.trim() ? [{id: 'answer', label: 'Answer'}] : [action];
        }).filter(action => action.id && !['chat', 'discuss', 'view-log', 'open', 'message-owner'].includes(action.id));
    }
    canSelect(id) { return !this.pending && !this.applied.has(id) && this.run?.phase === 'review' && this.items.some(row => row.itemId === id && InboxState.reviewable(row)); }
    draft(row) { return this.drafts.get(row.itemId) ?? row.draftAnswer ?? ''; }
    request(operation, environment, {query = '', itemId, actionId, answer} = {}) {
        if (this.pending || !sameEnvironment(environment, environment)) throw new Error('Wait for the current action and select an environment');
        const body = {environment, operation, confirmed: true}, active = ['pending', 'running'].includes(this.run?.phase);
        if (operation === 'start') {
            const visible = this.results(query);
            if (!this.listReady || !this.bulkReady || active || this.run?.phase === 'review' || !visible.length || visible.length > 2000) throw new Error('Load a visible batch and finish the current run first');
            body.items = visible.map(row => ({itemId: row.id, kind: row.kind, title: row.title, ref: row.ref, ownerAgentId: row.ownerAgentId ?? null}));
            body.filter = {tier: null, kinds: [], query, shownCount: visible.length};
        } else if (['stop', 'resume'].includes(operation)) {
            if (!this.bulkReady || !this.run?.runId || (operation === 'stop' ? !active : active)) throw new Error('Load a saved run in the appropriate phase');
            body.runId = this.run.runId;
            if (operation === 'resume') {
                body.itemIds = this.items.filter(InboxState.retryable).map(row => row.itemId);
                if (!body.itemIds.length) throw new Error('No retryable items remain');
            }
        } else if (operation === 'apply' || operation === 'resolve') {
            const row = operation === 'apply' ? this.items.find(item => item.itemId === itemId) : this.context;
            const id = operation === 'apply' ? row?.itemId : row?.id;
            if (!row || this.applied.has(id)) throw new Error('Select a current question');
            if (operation === 'apply') {
                if (!this.bulkReady || !this.canSelect(id) || !this.selectedReviews.has(id) || !row.actionId) throw new Error('Select a current recommendation');
                body.runId = this.run.runId; actionId = row.actionId; answer = this.draft(row);
            } else if (id !== this.selection || !InboxState.actions(row).some(action => action.id === actionId)) throw new Error('Select an offered action');
            body.expected = {id, kind: row.kind, ref: row.ref}; body.actionId = actionId;
            if (actionId === 'answer') body.answer = required(answer?.trim(), 'answer');
        } else throw new Error('Unknown Inbox operation');
        return JSON.parse(JSON.stringify(body));
    }
    beginAction(requests) {
        if (this.pending || !requests.length) throw new Error('An Inbox action is already pending');
        this.pending = true; this.actionNotice = null; return ++this.actionGeneration;
    }
    recordAction(token, request, payload) {
        if (!this.pending || token !== this.actionGeneration || !sameEnvironment(request.environment, payload?.environment)) throw new Error('Action environment changed; refresh before retrying');
        const receipt = oneRow(payload);
        if (receipt.ok !== true) throw new Error('Action was not confirmed; refresh before retrying');
        if (['apply', 'resolve'].includes(request.operation)) {
            if (receipt.resolved !== true || receipt.itemId !== request.expected.id) throw new Error('Question resolution was not confirmed');
            this.applied.add(receipt.itemId); this.selectedReviews.delete(receipt.itemId);
        }
        if (receipt.recorded === false) throw new Error('Action succeeded; bookkeeping is unconfirmed. Refresh and reconcile; do not repeat the action.');
        if (request.operation === 'start') return required(receipt.runId, 'admitted run id');
        return null;
    }
    finishAction(token, error = null) {
        if (token !== this.actionGeneration) return;
        this.pending = false; this.actionNotice = error?.message || 'Action confirmed. Refreshing saved state…';
    }
    static counts(run, items) {
        if (!Number.isSafeInteger(run.totalItems) || run.totalItems < 0 || items.length > run.totalItems) throw new Error('Invalid bulk total');
        const counts = Object.fromEntries(['resolved', 'forReview', 'pending', 'failed', 'skipped', 'dismissed', 'decided', 'ownerAction', 'cleanupCandidate', 'retryNeeded', 'routed', 'investigate'].map(key => [key, 0]));
        const seen = new Set();
        for (const item of items) {
            if (!item.itemId || seen.has(item.itemId) || item.runId !== run.runId || !['pending', 'auto_resolved', 'recommended', 'skipped', 'failed', 'dismissed'].includes(item.outcome)) throw new Error('Invalid bulk item identity or outcome');
            seen.add(item.itemId);
            const bucket = {auto_resolved: 'resolved', pending: 'pending', failed: 'failed', skipped: 'skipped', dismissed: 'dismissed'}[item.outcome];
            if (bucket) ++counts[bucket];
            if (item.outcome !== 'pending') ++counts.decided;
            if (InboxState.reviewable(item)) ++counts.forReview;
            const disposition = {owner_action: 'ownerAction', cleanup_candidate: 'cleanupCandidate', retry_needed: 'retryNeeded', routed: 'routed', investigate: 'investigate'}[InboxState.disposition(item)];
            if (disposition) ++counts[disposition];
        }
        return {...counts, total: run.totalItems, left: run.totalItems - counts.decided,
            percent: run.totalItems ? Math.round(counts.decided / run.totalItems * 100) : 0,
            unresolved: ['forReview', 'pending', 'failed', 'ownerAction', 'cleanupCandidate', 'retryNeeded', 'routed', 'investigate'].reduce((n, key) => n + counts[key], 0)};
    }
}

// Acquire every replacement before releasing an existing shortcut. The caller
// persists a failed edit back to the prior values; runtime bindings never go
// dark during validation, including collisions with another application.
export function rebindShortcuts(current, desired, adapter) {
    const acquired = [];
    try {
        const requested = Object.entries(desired).filter(([, accelerator]) => accelerator);
        if (new Set(requested.map(([, accelerator]) => accelerator)).size !== requested.length)
            throw new Error('Each Workbench panel needs a different shortcut');
        const existing = new Map([...current.values()].map(binding => [binding.accelerator, binding.id]));
        const next = new Map();
        for (const [surface, accelerator] of requested) {
            let id = existing.get(accelerator);
            if (id == null) {
                id = adapter.grab(accelerator);
                if (!id) throw new Error(`Shortcut is unavailable: ${accelerator}`);
                acquired.push(id);
            }
            next.set(surface, { accelerator, id });
        }
        const retained = new Set([...next.values()].map(binding => binding.id));
        for (const binding of current.values()) if (!retained.has(binding.id)) adapter.ungrab(binding.id);
        return next;
    } catch (error) {
        for (const id of acquired) adapter.ungrab(id);
        throw error;
    }
}

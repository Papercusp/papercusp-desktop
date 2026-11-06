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
        return [...rows[0].active, ...rows[0].ended, ...(rows[0].pending || []), ...(rows[0].starting || [])];
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
        identity = [required(row.ownerId, 'agent owner')];
        title = row.label || row.ownerId;
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

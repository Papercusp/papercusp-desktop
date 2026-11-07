// Bundled at package time: Shell loads no node_modules and no webview.
import {marked} from 'marked';
import {parseWorkRefs} from '../../../packages/operator-ui/src/papercup-chat/parse-work-refs.ts';
import {workRefPopupTarget} from '../../../packages/operator-ui/src/papercup-chat/chat-ref-popup-params.ts';
import {decodeCardOptions, parseReportBlock} from '../../../libs/generic/chat-protocol/src/index.ts';
import {sameEnvironment, readRows} from './panel-model.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function safeChatLink(value) {
    return typeof value === 'string' && /^(https?:\/\/|mailto:)/i.test(value) && !/[\s\u0000-\u001f\u007f]/.test(value) ? value : null;
}
export function nativeWorkRefLinks(text, context = {}) {
    const origin = typeof context.endpoint === 'string' && context.endpoint.match(/^(https?:\/\/[^\s/?#@]+)(?:[/?#]|$)/)?.[1];
    if (!origin) return [];
    return parseWorkRefs(text).flatMap(ref => {
        const target = workRefPopupTarget({...ref, planSlug: context.planSlug}, context.harness);
        return target ? [{text: ref.id, href: origin + '/?' + target.param + '=' + encodeURIComponent(target.value),
            kind: ref.kind}] : [];
    });
}

// Marked owns Markdown parsing; this projection emits only native text styles,
// inert literal HTML, copyable code and explicitly activated links.
export function nativeChatBlocks(source, context = {}) {
    const blocks = [];
    function inline(tokens, links) {
        return (tokens || []).map(token => {
            switch (token.type) {
            case 'strong': return '<b>' + inline(token.tokens, links) + '</b>';
            case 'em': return '<i>' + inline(token.tokens, links) + '</i>';
            case 'del': return '<s>' + inline(token.tokens, links) + '</s>';
            case 'codespan': return '<tt>' + escape(token.text) + '</tt>';
            case 'br': return '\n';
            case 'link': {
                const href = safeChatLink(token.href);
                if (href) links.push({text: token.text || token.href, href, kind: 'link'});
                return inline(token.tokens, []);
            }
            case 'image': return escape(token.text || 'Image');
            case 'text': return token.tokens ? inline(token.tokens, links) : escape(token.text);
            default: return escape(token.raw || token.text || '');
            }
        }).join('');
    }
    function textBlock(token, prefix = '', kind = 'text') {
        const links = nativeWorkRefLinks(token.raw || token.text || '', context);
        let markup = escape(prefix) + inline(token.tokens || marked.Lexer.lexInline(token.text || ''), links);
        if (token.type === 'heading') markup = '<b>' + markup + '</b>';
        blocks.push({kind, text: prefix + (token.text || ''), markup, links});
    }
    function walk(tokens, prefix = '') {
        for (const token of tokens) {
            switch (token.type) {
            case 'space': case 'def': break;
            case 'code': blocks.push({kind: 'code', code: token.text, language: token.lang || '', links: []}); break;
            case 'hr': blocks.push({kind: 'rule', text: '────────', markup: '────────', links: []}); break;
            case 'blockquote': walk(token.tokens, prefix + '│ '); break;
            case 'list':
                token.items.forEach((item, index) => walk(item.tokens, prefix +
                    (token.ordered ? String(token.start + index) + '. ' : '• ') +
                    (item.task ? item.checked ? '☑ ' : '☐ ' : ''))); break;
            case 'table':
                for (const row of [token.header, ...token.rows]) {
                    const links = [], markup = row.map(cell => inline(cell.tokens, links)).join('  │  ');
                    blocks.push({kind: 'text', text: row.map(cell => cell.text).join('  │  '), markup,
                        links: [...links, ...nativeWorkRefLinks(row.map(cell => cell.text).join(' '), context)]});
                }
                break;
            case 'html': blocks.push({kind: 'text', text: token.raw, markup: escape(token.raw), links: []}); break;
            default: textBlock(token, prefix);
            }
        }
    }
    walk(marked.lexer(String(source || ''), {gfm: true}));
    return blocks;
}

// Native projection of the existing canonical card snapshot/response contract.
// The server owns validation and approval; local state only gates stale input.
export class NativeCard {
    constructor(runId, raw) {
        this.runId = runId; this.raw = raw; this.id = raw.correlationId;
        this.presentation = raw.presentation || {}; this.kind = this.presentation.kind;
        this.options = decodeCardOptions(this.presentation.options) || [];
        if (['radio', 'checkbox', 'select'].includes(this.kind) && (!this.options.length ||
            this.options.some(option => !option || typeof option.id !== 'string' || !option.id ||
                typeof option.label !== 'string' || !option.label) ||
            new Set(this.options.map(option => option.id)).size !== this.options.length))
            throw new Error('Card choices are incomplete');
        if (raw.report && !parseReportBlock(raw.report)) throw new Error('Card report is invalid');
    }
    get canSubmit() { return ['radio', 'checkbox', 'select', 'text', 'date', 'slider'].includes(this.kind); }
    get expired() { return Number.isFinite(this.raw.timeoutMs) && this.raw.timeoutMs > 0 &&
        Date.now() >= this.raw.createdAt + this.raw.timeoutMs; }
    get prose() {
        const report = parseReportBlock(this.raw.report);
        return [this.raw.prompt, this.raw.approval?.title, ...(this.raw.approval?.body || []),
            this.raw.approval?.question, report?.title, ...(report?.plans || []).flatMap(plan =>
                [plan.title || plan.slug, plan.status, plan.summary, ...(plan.items || []).map(item =>
                    [item.id, item.text, item.status, item.ref].filter(Boolean).join(' · '))])].filter(Boolean).join('\n\n');
    }
    secureLink(environment) {
        const path = '/api/ui/cards/' + encodeURIComponent(this.id) + '/link';
        const origin = environment?.endpoint?.match(/^(https?:\/\/[^\s/?#@]+)(?:[/?#]|$)/)?.[1];
        return origin && this.presentation.link === path ? origin + path : null;
    }
    answer(picks = [], value = '') {
        const p = this.presentation;
        if (['radio', 'checkbox', 'select'].includes(this.kind)) {
            if (!Array.isArray(picks) || new Set(picks).size !== picks.length ||
                picks.length < (p.allowEmpty ? 0 : 1) || picks.length > (this.kind === 'checkbox' ? this.options.length : 1) ||
                picks.some(id => !this.options.some(option => option.id === id))) throw new Error('Choose the available answers');
            return {picks};
        }
        if (this.kind === 'text') {
            if (typeof value !== 'string' || (!p.allowEmpty && !value.trim()) ||
                new TextEncoder().encode(value).length > 32 * 1024) throw new Error('Enter a bounded answer');
            return {value};
        }
        if (this.kind === 'date') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
                new Date(value).toISOString().slice(0, 10) !== value ||
                (p.min && value < p.min) || (p.max && value > p.max)) throw new Error('Choose a valid date in the displayed range');
            return {value};
        }
        if (this.kind === 'slider') {
            const number = typeof value === 'string' && value.trim() ? Number(value) : NaN, step = p.step ?? 1;
            if (!Number.isFinite(number) || !Number.isFinite(p.min) || !Number.isFinite(p.max) ||
                !Number.isFinite(step) || step <= 0 || number < p.min || number > p.max ||
                Math.abs((number - p.min) / step - Math.round((number - p.min) / step)) > 0.000001)
                throw new Error('Choose a value on the displayed range and steps');
            return {value: number};
        }
        throw new Error('This card requires another supported surface');
    }
}
export class NativeCardsState {
    constructor() { this.generation = 0; this.begin(null, ''); }
    begin(environment, conversationId) {
        ++this.generation; Object.assign(this, {environment, conversationId, connected: false, error: null, pending: null,
            runs: new Map(), snapshots: new Map(), acknowledged: new Set()});
        return this.generation;
    }
    get cards() { return [...this.runs.values()].flat().filter(card => !this.acknowledged.has(card.id))
        .sort((a, b) => a.raw.createdAt - b.raw.createdAt || a.id.localeCompare(b.id)); }
    get subscription() { return {environment: this.environment, conversationId: this.conversationId, operation: 'subscribe'}; }
    receive(token, frame) {
        if (token !== this.generation) return false;
        const data = frame?.data;
        if (!this.conversationId || !sameEnvironment(this.environment, frame?.environment) ||
            data?.workspaceId !== this.environment.workspaceId) throw new Error('The card environment changed');
        if (frame.event === 'reset') { this.runs.clear(); this.snapshots.clear(); this.connected = true; return true; }
        if (frame.event !== 'snapshot' || typeof data.runId !== 'string' || !data.runId ||
            !Number.isSafeInteger(data.version) || data.version < 0 || !Array.isArray(data.snapshot?.openCards))
            throw new Error('The card snapshot is unavailable');
        const before = this.snapshots.get(data.runId);
        if (before && before.version >= data.version) {
            if (before.version === data.version && JSON.stringify(before) !== JSON.stringify(data))
                throw new Error('Conflicting card snapshot');
            return false;
        }
        const ids = new Set(), next = data.snapshot.openCards.map(raw => {
            if (!raw || raw.conversationId !== this.conversationId || typeof raw.correlationId !== 'string' ||
                !raw.correlationId || ids.has(raw.correlationId) || typeof raw.prompt !== 'string' || !raw.prompt ||
                !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0) throw new Error('A card has an invalid or foreign identity');
            ids.add(raw.correlationId); return new NativeCard(data.runId, raw);
        });
        if ([...this.runs].some(([run, cards]) => run !== data.runId && cards.some(card => ids.has(card.id))))
            throw new Error('A card belongs to multiple runs');
        this.runs.set(data.runId, next); this.snapshots.set(data.runId, data); this.connected = true; this.error = null; return true;
    }
    request(card, action, payload) {
        if (!this.connected || this.pending || !this.cards.includes(card) || card.expired ||
            !['submit', 'decline', 'cancel'].includes(action) || (action === 'submit' && !card.canSubmit) ||
            (action === 'decline' && card.raw.allowDecline === false)) throw new Error('This card changed; reconnect before answering');
        this.pending = card.id; this.error = null;
        return {...this.subscription, operation: 'respond', correlationId: card.id, action,
            ...(action === 'submit' ? {payload} : {})};
    }
    responded(token, id, receipt) {
        if (token !== this.generation) return false;
        const rows = readRows(receipt), row = rows[0];
        if (this.pending !== id || !sameEnvironment(this.environment, receipt.environment) || rows.length !== 1 ||
            row?.responded !== true || row.conversationId !== this.conversationId || row.correlationId !== id)
            throw new Error('The card response needs reconciliation');
        this.acknowledged.add(id); this.pending = null; this.error = null; return true;
    }
    failed(token, error) {
        if (token !== this.generation) return;
        this.pending = null; this.connected = false; this.error = String(error.message || error);
    }
}

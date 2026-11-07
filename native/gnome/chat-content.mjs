// Bundled at package time: Shell loads no node_modules and no webview.
import {marked} from 'marked';
import {parseWorkRefs} from '../../../packages/operator-ui/src/papercup-chat/parse-work-refs.ts';
import {workRefPopupTarget} from '../../../packages/operator-ui/src/papercup-chat/chat-ref-popup-params.ts';

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

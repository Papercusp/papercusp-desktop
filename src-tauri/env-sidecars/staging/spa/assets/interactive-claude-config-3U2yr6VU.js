import{n as e,o as t}from"./chunk-CMxvf4Kt.js";import{t as n}from"./__vite-browser-external-CM3Eme-n.js";import{a as r,i,r as a}from"./session-launch-dirs-B6qZOuj4.js";import{t as o}from"./src-DiYBo7B9.js";import{i as s,r as c,t as l}from"./agent-auth-detect-IN3IMrcr.js";function u(e){return(0,v.join)(e,`.claude`,`.credentials.json`)}function d(e,t){let n=e.claudeAiOauth;if(!n||typeof n!=`object`)return null;let r=n;return typeof r.accessToken!=`string`||!r.accessToken.startsWith(`sk-ant-`)||typeof r.refreshToken!=`string`||r.refreshToken.length===0||typeof r.expiresAt!=`number`||!Number.isFinite(r.expiresAt)||r.expiresAt>t+y?null:r}function f(e,t,n){let r={};try{let t=JSON.parse((0,g.readFileSync)(e,`utf8`));t&&typeof t==`object`&&!Array.isArray(t)&&(r=t)}catch{}return{path:e,json:r,bundle:d(r,n),isGlobal:t}}function p(e){try{return(0,g.lstatSync)(e).isFile()}catch{return!1}}function m(e,t){let n={...e.json,claudeAiOauth:t},r=(0,v.join)((0,v.dirname)(e.path),`.credentials.json.credsync-${process.pid}-${Math.floor(Math.random()*1e9)}`);(0,g.writeFileSync)(r,JSON.stringify(n,null,2),{mode:384}),(0,g.renameSync)(r,e.path)}function h(e={}){let t=e.home??(0,_.homedir)(),n=e.sessionRoot??r(),i=e.now??Date.now(),a=e.platform??process.platform,o=[],l=u(t);p(l)&&o.push(f(l,!0,i));let h=[];try{h=(0,g.readdirSync)(n)}catch{}for(let e of h){let t=(0,v.join)(n,e,`.credentials.json`);p(t)&&o.push(f(t,!1,i))}let y=null;if(a===`darwin`){let e=c(a);if(e){let t=e.bundle;y={path:`keychain:${e.service}`,json:t,bundle:d(t,i),isGlobal:!1,readOnly:!0,keychainService:e.service},y.bundle&&o.push(y)}}let b=null;for(let e of o)e.bundle&&(!b||e.bundle.expiresAt>b.bundle.expiresAt||e.bundle.expiresAt===b.bundle.expiresAt&&(e.isGlobal||!b.isGlobal&&e.path<b.path))&&(b=e);if(!b)return{scanned:o.length,updated:[],winner:null};let x=[],S=b.bundle;!p(l)&&!(0,g.existsSync)(l)&&(0,g.existsSync)((0,v.dirname)(l))&&o.push({path:l,json:{},bundle:null,isGlobal:!0});for(let e of o)if(e!==b&&!e.readOnly&&!(e.bundle&&e.bundle.expiresAt>=S.expiresAt))try{m(e,S),x.push(e.path)}catch(t){console.warn(`[claude-cred-sync]   ! ${e.path}: ${t?.message??t}`)}let C=null;if(a===`darwin`&&y?.bundle&&b!==y&&S.expiresAt>y.bundle.expiresAt)try{let t=e.keychainAccount??(0,_.userInfo)().username,n={...y.json,claudeAiOauth:S};s(y.keychainService,t,JSON.stringify(n),a)&&(C={service:y.keychainService,expiresAt:S.expiresAt})}catch{}return{scanned:o.length,updated:x,winner:{path:b.path,expiresAt:S.expiresAt},keychainWriteBack:C}}var g,_,v,y,b=e((()=>{g=t(n(),1),_=t(n(),1),o(),v=t(n(),1),a(),l(),y=720*60*60*1e3}));function x(e,t){try{(0,j.writeFileSync)((0,N.join)(e,R),V,{mode:448})}catch{}if(t?.playbookPath)try{let n=(0,j.readFileSync)(t.playbookPath,`utf8`);(0,j.writeFileSync)((0,N.join)(e,z),n,{mode:384}),(0,j.writeFileSync)((0,N.join)(e,B),JSON.stringify({sid:t.sid??null,nativeSessionId:t.nativeSessionId??null,playbookPath:t.playbookPath,writtenAt:new Date().toISOString()},null,2),{mode:384})}catch{}}function S(e){let t=(0,N.join)(e,`.claude.json`);try{if(!(0,j.existsSync)(t))return(0,j.writeFileSync)(t,JSON.stringify({hasCompletedOnboarding:!0},null,2),{mode:384}),!0;let e=JSON.parse((0,j.readFileSync)(t,`utf8`));if(!e||typeof e!=`object`||e.hasCompletedOnboarding===!0)return!1;e.hasCompletedOnboarding=!0;let n=`${t}.psu-onboarding.${process.pid}.tmp`;return(0,j.writeFileSync)(n,JSON.stringify(e,null,2),{mode:384}),(0,j.renameSync)(n,t),!0}catch{return!1}}function C(e){try{return(0,j.lstatSync)(e),!0}catch{return!1}}function w(e,t){if(!C(t))try{(0,j.symlinkSync)(e,t)}catch{}}function T(e){let t=e.home??(0,M.homedir)(),n=i(e.sid);if((0,j.mkdirSync)(n,{recursive:!0}),!{}.VITEST){try{(0,j.mkdirSync)((0,N.join)(t,`.claude`),{recursive:!0}),h({home:t})}catch{}S(t)}let r=(0,N.join)(t,`.claude`),a=[];try{a=(0,j.readdirSync)(r)}catch{}for(let t of a)if(t!==P&&!F.has(t)){if(e.prunePlugins&&t===`plugins`){k((0,N.join)(r,t),(0,N.join)(n,t));continue}if(t===`settings.json`){O((0,N.join)(r,t),(0,N.join)(n,t));continue}w((0,N.join)(r,t),(0,N.join)(n,t))}a.includes(`settings.json`)||O(null,(0,N.join)(n,`settings.json`)),x(n,{...e.recovery,sid:e.sid}),(0,j.mkdirSync)((0,N.join)(n,P),{recursive:!0});let o=(0,N.join)(t,`.claude.json`);return(0,j.existsSync)(o)&&(e.prunePlugins?A(o,(0,N.join)(n,`.claude.json`)):w(o,(0,N.join)(n,`.claude.json`))),{configDir:n}}function E(e){try{let t=(0,N.join)(e,`.claude.json`),n=(0,j.lstatSync)(t),r=JSON.parse((0,j.readFileSync)(t,`utf8`));return!r||typeof r!=`object`?!1:n.isSymbolicLink()||r.mcpServers!=null}catch{return!1}}function D(e){let t=i(e.sid);if(E(t))return{configDir:t,repaired:!1};try{return(0,j.rmSync)((0,N.join)(t,`.claude.json`),{force:!0}),T({sid:e.sid,home:e.home}),{configDir:t,repaired:!0}}catch{return{configDir:t,repaired:!1}}}function O(e,t){let n={};if(e)try{n=JSON.parse((0,j.readFileSync)(e,`utf8`))}catch{}let r={...n.permissions,defaultMode:`bypassPermissions`},i={...n.hooks},a=Array.isArray(i.SessionStart)?[...i.SessionStart]:[];a.push({hooks:[{type:`command`,command:`${JSON.stringify(process.execPath)} ${JSON.stringify((0,N.join)((0,N.dirname)(t),R))}`,timeout:30}]}),i.SessionStart=a;try{C(t)&&(0,j.lstatSync)(t).isSymbolicLink()&&(0,j.rmSync)(t),(0,j.writeFileSync)(t,JSON.stringify({...n,permissions:r,hooks:i,skipDangerousModePermissionPrompt:!0},null,2))}catch{}}function k(e,t){if(!C(t))try{(0,j.mkdirSync)(t,{recursive:!0});for(let n of(0,j.readdirSync)(e))n!==`installed_plugins.json`&&w((0,N.join)(e,n),(0,N.join)(t,n));let n=(0,N.join)(e,`installed_plugins.json`);if((0,j.existsSync)(n)){let e=JSON.parse((0,j.readFileSync)(n,`utf8`));e.plugins&&typeof e.plugins==`object`&&(e.plugins=Object.fromEntries(Object.entries(e.plugins).filter(([e])=>{let t=e.split(`@`)[0]??e;return!I.has(t)}))),(0,j.writeFileSync)((0,N.join)(t,`installed_plugins.json`),JSON.stringify(e,null,1))}}catch{try{(0,j.rmSync)(t,{recursive:!0,force:!0})}catch{}w(e,t)}}function A(e,t){if(!C(t))try{let n=JSON.parse((0,j.readFileSync)(e,`utf8`));n.mcpServers&&typeof n.mcpServers==`object`&&(n.mcpServers=Object.fromEntries(Object.entries(n.mcpServers).filter(([e])=>!L.has(e)))),(0,j.writeFileSync)(t,JSON.stringify(n,null,1))}catch{w(e,t)}}var j,M,N,P,F,I,L,R,z,B,V;e((()=>{j=t(n(),1),M=t(n(),1),N=t(n(),1),a(),b(),P=`projects`,F=new Set([`CLAUDE.md`,`CLAUDE.local.md`,`AGENTS.md`]),I=new Set([`github`,`cloudflare`,`firecrawl`]),L=new Set([`playwright`]),R=`session-recover-hook.mjs`,z=`launch-playbook.md`,B=`launch-intent.json`,V=`#!/usr/bin/env node
// session-recover-hook.mjs — WI-3280 argv-proof playbook delivery + P-004
// post-compaction continuity anchor + P-007 identity rebind (generated by
// interactive-claude-config.ts on every session materialize; do not edit).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK = join(dir, ${JSON.stringify(z)});
const INTENT = join(dir, ${JSON.stringify(B)});
const FLAGS = ['--system-prompt-file', '--append-system-prompt-file'];

function cmdlineOf(pid) {
  try {
    const argv = readFileSync('/proc/' + pid + '/cmdline', 'utf8').split('\\u0000').filter(Boolean);
    if (argv.length) return argv;
  } catch {}
  try {
    // macOS (no /proc). Whitespace-split degrades paths with spaces, but flag
    // TOKENS are whitespace-delimited either way, which is all we test for.
    const line = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    if (line) return line.split(/\\s+/);
  } catch {}
  return null;
}

function ppidOf(pid) {
  try {
    const m = /^PPid:\\s*(\\d+)/m.exec(readFileSync('/proc/' + pid + '/status', 'utf8'));
    if (m) return Number(m[1]);
  } catch {}
  try {
    const n = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    if (Number.isFinite(n)) return n;
  } catch {}
  return 0;
}

function argvIntact() {
  const chain = [];
  if (process.env.PSU_RECOVER_TEST_CHAIN) {
    try { chain.push(...JSON.parse(process.env.PSU_RECOVER_TEST_CHAIN)); } catch {}
  } else {
    let pid = process.ppid;
    for (let hop = 0; hop < 10 && pid > 1; hop++) {
      const argv = cmdlineOf(pid);
      if (argv) chain.push(argv);
      pid = ppidOf(pid);
    }
  }
  const isClaude = (argv) => (argv[0] ?? '').toLowerCase().includes('claude');
  const hasFlag = (argv) => argv.some((a) => FLAGS.some((f) => a === f || a.startsWith(f + '=')));
  // The nearest claude ancestor decides; if none is identifiable (unusual
  // argv[0], e.g. a bare versioned binary), fall back to any-flag-anywhere.
  const claude = chain.find(isClaude);
  return claude ? hasFlag(claude) : chain.some(hasFlag);
}

// The claude hook input JSON ({ session_id, source, ... }) arrives on stdin.
// Raced against a short timer so a never-closing stdin can't stall the start.
async function readStdinJson() {
  try {
    if (process.stdin.isTTY) return {};
    const read = (async () => {
      let data = '';
      process.stdin.setEncoding('utf8');
      for await (const chunk of process.stdin) data += chunk;
      return data;
    })();
    const data = await Promise.race([read, new Promise((r) => setTimeout(r, 3000, ''))]);
    return data && data.trim() ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

// WI-3280: the argv-drop playbook recovery — returns the injection text, or
// null when argv is intact / no playbook was parked (the silent no-op).
function playbookRecovery(intent) {
  if (!existsSync(PLAYBOOK)) return null;
  if (argvIntact()) return null;
  const playbook = readFileSync(PLAYBOOK, 'utf8');
  const banner = [
    '⚠ SESSION RECOVERED — your launch system prompt was lost; it is re-delivered below.',
    'This claude process self-relaunched (an internal claude re-exec: TUI fullscreen switch or',
    'update relaunch) and claude rebuilds argv on relaunch WITHOUT the original launch flags:',
    'the --system-prompt-file playbook, --permission-mode, --session-id and any --disallowedTools',
    'were dropped. Permissions were separately restored via this session settings.json. Notes:',
    intent.sid ? '- Your papercusp identity is ' + intent.sid + ' (env PAPERCUSP_SID) — coord/MCP identity is unaffected.' : '- Your coord/MCP identity (env PAPERCUSP_SID) is unaffected.',
    intent.nativeSessionId ? '- Your native claude session id may differ from the recorded one (' + intent.nativeSessionId + ') — psu resume/tracking of this conversation may be degraded; disclose this if coordination looks off.' : '- psu resume/tracking of this conversation may be degraded; disclose this if coordination looks off.',
    '- If the playbook below denies tools (subagents, native schedulers), honor it even though the CLI deny flags were lost.',
    '- The document below IS your operating playbook / system prompt. Follow it in full.',
  ].join('\\n');
  return banner + '\\n\\n' + playbook;
}

// P-004: fetch the session's carry brief (P-003 renderCarryBriefText) from the
// local operator. Fail-soft: null on any failure — the static anchor still lands.
async function fetchCarryBrief(intent) {
  const owner = process.env.PAPERCUSP_SID || intent.sid;
  if (!owner) return null;
  const base = (process.env.PAPERCUSP_OPERATOR_URL || 'http://localhost:3070').replace(/\\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4500);
  try {
    const res = await fetch(base + '/api/agent-mcp/session-recovery-brief?owner=' + encodeURIComponent(owner), { signal: ctl.signal });
    if (!res.ok) return null;
    const body = await res.json();
    const text = body && typeof body.text === 'string' ? body.text.trim() : '';
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// P-007: identity durability across relaunch. When the LIVE PAPERCUSP_SID
// differs from the sid recorded at launch, every ownerId-keyed surface (armed
// loop, loop carry-note + walls, claims, claim-spec, standing awaits, fleet
// membership, open held work-items, owner facts) is stranded under the dead
// predecessor id. Auto-rebind via the local operator (idempotent server-side);
// on refusal/failure surface the one-call manual instruction instead. Returns
// { rebound, to, text } or null when identities agree / either id is unknown.
async function rebindIdentityIfChanged(intent) {
  const live = (process.env.PAPERCUSP_SID || '').trim();
  const recorded = ((intent && intent.sid) || '').trim();
  if (!live || !recorded || live === recorded) return null;
  const head = '⚠ IDENTITY CHANGED ACROSS RELAUNCH — recorded PAPERCUSP_SID ' + recorded + ' → live ' + live + '. Your armed loop, loop carry-note (+walls), claims, claim-spec, standing awaits, fleet membership and open held work-items were keyed under the OLD id.';
  const manual = 'Run coord:rebind-identity { from: \\'' + recorded + '\\', to: \\'' + live + '\\' } NOW (add force:true only after coord:presence confirms the old id is dead), then coord:orient { afterCompaction: true }.';
  const base = (process.env.PAPERCUSP_OPERATOR_URL || 'http://localhost:3070').replace(/\\/+$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4500);
  try {
    const res = await fetch(base + '/api/agent-mcp/rebind-identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: recorded, to: live }),
      signal: ctl.signal,
    });
    const body = res.ok ? await res.json() : null;
    if (body && body.ok) {
      const counts = (body.surfaces || [])
        .map((s) => ({ surface: s.surface, n: (s.moved || 0) + (s.dropped || 0) + (s.cancelled || 0) + (s.appended || 0) }))
        .filter((s) => s.n > 0)
        .map((s) => s.surface + ':' + s.n)
        .join(', ');
      return {
        rebound: true,
        to: live,
        text: head + ' AUTO-REBOUND to the live id just now: ' + (counts || 'nothing was keyed under the old id') + '. Verify with coord:orient { afterCompaction: true }.',
      };
    }
    if (body && body.refused === 'from_appears_live') {
      return { rebound: false, to: live, text: head + ' AUTO-REBIND REFUSED — the old id still shows a LIVE presence heartbeat (another session may hold it). If you are certain it is dead: ' + manual };
    }
    return { rebound: false, to: live, text: head + ' Auto-rebind did not complete. ' + manual };
  } catch {
    return { rebound: false, to: live, text: head + ' The operator was unreachable for auto-rebind. ' + manual };
  } finally {
    clearTimeout(timer);
  }
}

// P-004: the post-compaction continuity anchor. The mandate + volatile-claims
// checklist are static (deliver even with the operator down); the carry brief
// is the live part.
async function compactAnchor(intent) {
  const anchor = [
    '⚠ POST-COMPACTION CONTINUITY ANCHOR — injected by the SessionStart[source=compact] hook. Live reads below, not summary prose.',
    // turn-provenance-owner-vs-agent-2026-07-11 P-004: a NATIVE auto-compaction
    // continuation cannot be pre-tagged by any injector (Claude generates it
    // internally), so the compact-source hook is the one place that can stamp it.
    '⟦turn-provenance⟧ MACHINE-GENERATED CONTINUATION — this post-compaction turn (the summary above it and any continuation prompt) was produced by the compaction machinery, NOT typed by the human owner. Never attribute its text to the owner; owner directives must trace to a turn stamped OWNER (interactive) or to the pre-compaction verbatim transcript (sessions:search).',
    // EI-10942: the MCP tool schemas a Claude session loads are DEFERRED and do NOT
    // survive a compaction — so a post-compaction turn starts blind and re-discovers
    // the SAME core su tools one failed call at a time (measured: 11 ToolSearch calls in
    // one session, the same 5 core tools re-selected 4-5× each). Hand the successor the
    // exact single batched select up front so the whole core loads in ONE round-trip.
    // Deliberately the SHORT post-compaction-resume subset (not the full ~40-tool OMP
    // spine) — enough to orient, resume held items, reply, file, and batch, without
    // burning anchor context on tools this turn is unlikely to touch.
    'TOOL PRELOAD (do this FIRST — deferred MCP schemas were dropped by the compaction; re-load the core su set in ONE ToolSearch instead of rediscovering them call-by-call): ToolSearch { query: "select:mcp__papercusp-su__coord_orient,mcp__papercusp-su__work_items_get,mcp__papercusp-su__work_items_checkpoint,mcp__papercusp-su__work_items_complete,mcp__papercusp-su__improvements_capture,mcp__papercusp-su__coord_send,mcp__papercusp-su__code_run" }',
    'FIRST ACTION (after the preload): run coord:orient { afterCompaction: true } — its recovery block re-delivers your held work-items\\u2019 checkpoints, armed-loop status, staleness warnings (what changed AFTER your summary was written), and the self-recall pointer.',
    'VOLATILE-CLAIMS CHECKLIST — your compaction summary is a STALE SNAPSHOT of a live system. Treat these summary statements as HYPOTHESES to re-verify, never facts:',
    '- liveness / fleet counts ("N members alive/working") — re-read via coord:presence + fleet:status;',
    '- service up/down states (deploys, ports, restarts, wedged/fixed) — re-probe before acting on them;',
    '- quantities and totals (queue depths, item counts, test counts) — re-measure before repeating them.',
    "Anything the summary dropped is recoverable verbatim: sessions:search { session:'self', mode:'verbatim', query:'<what you remember>' }.",
  ].join('\\n');
  const brief = await fetchCarryBrief(intent);
  return brief
    ? anchor + '\\n\\nYour carry brief (read live from the carry surfaces just now):\\n\\n' + brief
    : anchor;
}

// WI-4275-adjacent (2026-07-12): SELF-HEAL the psu-managed settings.json keys.
// Claude Code's own settings-save (e.g. /model, /effort persisting defaults)
// can REWRITE the session settings.json with only its in-memory keys — wiping
// the statusLine (fleet title goes permanently stale: the "windows desktop
// leader" frozen-title incident), the bypassPermissions grant, AND this very
// hook's SessionStart registration. Re-assert all three, non-destructively
// (merge; never touch foreign values), on every session start. Fail-open: a
// repair hiccup never blocks the start.
function selfHealSettings() {
  try {
    const path = join(dir, 'settings.json');
    if (!existsSync(path)) return null;
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    if (!cfg || typeof cfg !== 'object') return null;
    const fixed = [];
    // (a) statusLine — copy from the global settings when ours is absent and
    // the global one is the papercusp fleet statusline (never install a
    // foreign/personal statusLine on the user's behalf).
    if (!cfg.statusLine) {
      try {
        const home = process.env.HOME || '';
        const g = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
        if (g && g.statusLine && String(g.statusLine.command || '').includes('statusline-fleet.sh')) {
          cfg.statusLine = g.statusLine;
          fixed.push('statusLine');
        }
      } catch {}
    }
    // (b) the bypassPermissions grant this session type was materialized with.
    const perms = cfg.permissions && typeof cfg.permissions === 'object' ? cfg.permissions : {};
    if (perms.defaultMode !== 'bypassPermissions') {
      cfg.permissions = Object.assign({}, perms, { defaultMode: 'bypassPermissions' });
      fixed.push('permissions.defaultMode');
    }
    // (b2) EI-12086: the claude 2.1.209+ skip-the-bypass-accept-prompt grant —
    // same settings-rewrite-damage class. A settings-save that drops it re-wedges
    // a headless member on the "Yes, I accept" prompt after a self-re-exec.
    if (cfg.skipDangerousModePermissionPrompt !== true) {
      cfg.skipDangerousModePermissionPrompt = true;
      fixed.push('skipDangerousModePermissionPrompt');
    }
    // (c) this hook's own SessionStart registration (without it, the next
    // relaunch loses playbook recovery AND this self-heal).
    const hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};
    const groups = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];
    const registered = JSON.stringify(groups).includes('session-recover-hook.mjs');
    if (!registered) {
      groups.push({
        hooks: [
          {
            type: 'command',
            command: JSON.stringify(process.execPath) + ' ' + JSON.stringify(join(dir, 'session-recover-hook.mjs')),
            timeout: 30,
          },
        ],
      });
      hooks.SessionStart = groups;
      cfg.hooks = hooks;
      fixed.push('hooks.SessionStart');
    }
    if (!fixed.length) return null;
    writeFileSync(path, JSON.stringify(cfg, null, 2));
    return fixed;
  } catch {
    return null;
  }
}

// Same rewrite-damage class, second victim: claude's .claude.json rewrites can
// drop the session's papercusp-su MCP server definition — the session then runs
// with NO coordination tools until someone notices (2026-07-12: hours of
// checkpoints/completions queued behind a "disconnected MCP" that was really a
// missing config entry). Re-assert it from the global ~/.claude.json when the
// session copy lacks it. Non-destructive; fail-open.
function selfHealMcpConfig() {
  try {
    const path = join(dir, '.claude.json');
    if (!existsSync(path)) return null;
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    if (!cfg || typeof cfg !== 'object') return null;
    const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
    if (servers['papercusp-su']) return null;
    const home = process.env.HOME || '';
    const g = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8'));
    const src = g && g.mcpServers ? g.mcpServers['papercusp-su'] : null;
    if (!src) return null;
    servers['papercusp-su'] = src;
    cfg.mcpServers = servers;
    writeFileSync(path, JSON.stringify(cfg, null, 2));
    return ['mcpServers.papercusp-su'];
  } catch {
    return null;
  }
}

try {
  const input = await readStdinJson();
  let intent = {};
  try { intent = JSON.parse(readFileSync(INTENT, 'utf8')); } catch {}
  const parts = [];
  try { selfHealSettings(); } catch {}
  try { selfHealMcpConfig(); } catch {}
  try {
    const p = playbookRecovery(intent);
    if (p) parts.push(p);
  } catch {}
  try {
    const rb = await rebindIdentityIfChanged(intent);
    if (rb) {
      parts.push(rb.text);
      // A successful rebind retires the old sid: rewrite the parked intent so
      // subsequent SessionStarts don't re-fire (the rebind itself is idempotent).
      if (rb.rebound) {
        try { writeFileSync(INTENT, JSON.stringify({ ...intent, sid: rb.to }, null, 2), { mode: 0o600 }); } catch {}
      }
    }
  } catch {}
  if ((input.source || '') === 'compact') {
    try {
      const a = await compactAnchor(intent);
      if (a) parts.push(a);
    } catch {}
  }
  if (parts.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: parts.join('\\n\\n'),
      },
    }));
  }
  process.exit(0);
} catch {
  process.exit(0); // never block a session start
}
`}))();export{D as ensureInteractiveClaudeConfig};
import{n as P,o as m}from"./chunk-ChpBd9eV.js";import{t as y}from"./__vite-browser-external-56mrcCg8.js";import{t as Y}from"./src-CynoHxv9.js";import{a as B,i as T,r as R}from"./session-launch-dirs-Bt0E5Mbt.js";import{a as $,o as W,r as V}from"./agent-auth-detect-C704Jdts.js";function G(t){return(0,S.join)(t,".claude",".credentials.json")}function x(t,e){const n=t.claudeAiOauth;if(!n||typeof n!="object")return null;const r=n;return typeof r.accessToken!="string"||!r.accessToken.startsWith("sk-ant-")||typeof r.refreshToken!="string"||r.refreshToken.length===0||typeof r.expiresAt!="number"||!Number.isFinite(r.expiresAt)||r.expiresAt>e+F?null:r}function I(t,e,n){let r={};try{const i=JSON.parse((0,h.readFileSync)(t,"utf8"));i&&typeof i=="object"&&!Array.isArray(i)&&(r=i)}catch{}return{path:t,json:r,bundle:x(r,n),isGlobal:e}}function w(t){try{return(0,h.lstatSync)(t).isFile()}catch{return!1}}function K(t,e){const n={...t.json,claudeAiOauth:e},r=(0,S.join)((0,S.dirname)(t.path),`.credentials.json.credsync-${process.pid}-${Math.floor(Math.random()*1e9)}`);(0,h.writeFileSync)(r,JSON.stringify(n,null,2),{mode:384}),(0,h.renameSync)(r,t.path)}function z(t={}){const e=t.home??(0,_.homedir)(),n=t.sessionRoot??B(),r=t.now??Date.now(),i=t.platform??process.platform,a=[],c=G(e);w(c)&&a.push(I(c,!0,r));let g=[];try{g=(0,h.readdirSync)(n)}catch{}for(const l of g){const u=(0,S.join)(n,l,".credentials.json");w(u)&&a.push(I(u,!1,r))}let p=null;if(i==="darwin"){const l=$(i);if(l){const u=l.bundle;p={path:`keychain:${l.service}`,json:u,bundle:x(u,r),isGlobal:!1,readOnly:!0,keychainService:l.service},p.bundle&&a.push(p)}}let d=null;for(const l of a)l.bundle&&(!d||l.bundle.expiresAt>d.bundle.expiresAt||l.bundle.expiresAt===d.bundle.expiresAt&&(l.isGlobal||!d.isGlobal&&l.path<d.path))&&(d=l);if(!d)return{scanned:a.length,updated:[],winner:null};const N=[],f=d.bundle;!w(c)&&!(0,h.existsSync)(c)&&(0,h.existsSync)((0,S.dirname)(c))&&a.push({path:c,json:{},bundle:null,isGlobal:!0});for(const l of a)if(l!==d&&!l.readOnly&&!(l.bundle&&l.bundle.expiresAt>=f.expiresAt))try{K(l,f),N.push(l.path)}catch(u){console.warn(`[claude-cred-sync]   ! ${l.path}: ${u?.message??u}`)}let A=null;if(i==="darwin"&&p?.bundle&&d!==p&&f.expiresAt>p.bundle.expiresAt)try{const l=t.keychainAccount??(0,_.userInfo)().username,u={...p.json,claudeAiOauth:f};W(p.keychainService,l,JSON.stringify(u),i)&&(A={service:p.keychainService,expiresAt:f.expiresAt})}catch{}return{scanned:a.length,updated:N,winner:{path:d.path,expiresAt:f.expiresAt},keychainWriteBack:A}}var h,_,S,F,q=P((()=>{h=m(y(),1),_=m(y(),1),Y(),S=m(y(),1),R(),V(),F=720*60*60*1e3}));function X(t,e){try{(0,s.writeFileSync)((0,o.join)(t,j),H,{mode:448})}catch{}if(e?.playbookPath)try{const n=(0,s.readFileSync)(e.playbookPath,"utf8");(0,s.writeFileSync)((0,o.join)(t,E),n,{mode:384}),(0,s.writeFileSync)((0,o.join)(t,k),JSON.stringify({sid:e.sid??null,nativeSessionId:e.nativeSessionId??null,playbookPath:e.playbookPath,writtenAt:new Date().toISOString()},null,2),{mode:384})}catch{}}function Z(t){const e=(0,o.join)(t,".claude.json");try{if(!(0,s.existsSync)(e))return(0,s.writeFileSync)(e,JSON.stringify({hasCompletedOnboarding:!0},null,2),{mode:384}),!0;const n=JSON.parse((0,s.readFileSync)(e,"utf8"));if(!n||typeof n!="object"||n.hasCompletedOnboarding===!0)return!1;n.hasCompletedOnboarding=!0;const r=`${e}.psu-onboarding.${process.pid}.tmp`;return(0,s.writeFileSync)(r,JSON.stringify(n,null,2),{mode:384}),(0,s.renameSync)(r,e),!0}catch{return!1}}function Q(t,e){const n=(0,o.join)(t,".claude.json"),r={hasTrustDialogAccepted:!0,hasClaudeMdExternalIncludesApproved:!0,hasClaudeMdExternalIncludesWarningShown:!0,hasCompletedProjectOnboarding:!0};try{if(!(0,s.existsSync)(n))return(0,s.writeFileSync)(n,JSON.stringify({hasCompletedOnboarding:!0,projects:{[e]:{...r}}},null,2),{mode:384}),!0;const i=JSON.parse((0,s.readFileSync)(n,"utf8"));if(!i||typeof i!="object")return!1;const a=i.projects&&typeof i.projects=="object"?i.projects:{},c=a[e]&&typeof a[e]=="object"?a[e]:{};if(c.hasTrustDialogAccepted===!0&&c.hasClaudeMdExternalIncludesApproved===!0&&c.hasClaudeMdExternalIncludesWarningShown===!0&&c.hasCompletedProjectOnboarding===!0)return!1;a[e]={...c,...r},i.projects=a;const g=`${n}.psu-project-trust.${process.pid}.tmp`;return(0,s.writeFileSync)(g,JSON.stringify(i,null,2),{mode:384}),(0,s.renameSync)(g,n),!0}catch{return!1}}function v(t){try{return(0,s.lstatSync)(t),!0}catch{return!1}}function b(t,e){if(!v(e))try{(0,s.symlinkSync)(t,e)}catch{}}function ee(t){const e=t.home??(0,L.homedir)(),n=T(t.sid);if((0,s.mkdirSync)(n,{recursive:!0}),!{}.VITEST){try{(0,s.mkdirSync)((0,o.join)(e,".claude"),{recursive:!0}),z({home:e})}catch{}Z(e),t.cwd&&Q(e,t.cwd)}const r=(0,o.join)(e,".claude");let i=[];try{i=(0,s.readdirSync)(r)}catch{}for(const c of i)if(c!==O&&!D.has(c)){if(t.prunePlugins&&c==="plugins"){ne((0,o.join)(r,c),(0,o.join)(n,c));continue}if(c==="settings.json"){C((0,o.join)(r,c),(0,o.join)(n,c));continue}b((0,o.join)(r,c),(0,o.join)(n,c))}i.includes("settings.json")||C(null,(0,o.join)(n,"settings.json")),X(n,{...t.recovery,sid:t.sid}),(0,s.mkdirSync)((0,o.join)(n,O),{recursive:!0});const a=(0,o.join)(e,".claude.json");return(0,s.existsSync)(a)&&(t.prunePlugins?re(a,(0,o.join)(n,".claude.json")):b(a,(0,o.join)(n,".claude.json"))),{configDir:n}}function te(t){try{const e=(0,o.join)(t,".claude.json"),n=(0,s.lstatSync)(e),r=JSON.parse((0,s.readFileSync)(e,"utf8"));return!r||typeof r!="object"?!1:n.isSymbolicLink()||r.mcpServers!=null}catch{return!1}}function de(t){const e=T(t.sid);if(te(e))return{configDir:e,repaired:!1};try{return(0,s.rmSync)((0,o.join)(e,".claude.json"),{force:!0}),ee({sid:t.sid,home:t.home}),{configDir:e,repaired:!0}}catch{return{configDir:e,repaired:!1}}}function C(t,e){let n={};if(t)try{n=JSON.parse((0,s.readFileSync)(t,"utf8"))}catch{}const r={...n.permissions,defaultMode:"bypassPermissions"},i={...n.hooks},a=Array.isArray(i.SessionStart)?[...i.SessionStart]:[];a.push({hooks:[{type:"command",command:`${JSON.stringify(process.execPath)} ${JSON.stringify((0,o.join)((0,o.dirname)(e),j))}`,timeout:30}]}),i.SessionStart=a;try{v(e)&&(0,s.lstatSync)(e).isSymbolicLink()&&(0,s.rmSync)(e),(0,s.writeFileSync)(e,JSON.stringify({...n,...J,permissions:r,hooks:i,skipDangerousModePermissionPrompt:!0},null,2))}catch{}}function ne(t,e){if(!v(e))try{(0,s.mkdirSync)(e,{recursive:!0});for(const r of(0,s.readdirSync)(t))r!=="installed_plugins.json"&&b((0,o.join)(t,r),(0,o.join)(e,r));const n=(0,o.join)(t,"installed_plugins.json");if((0,s.existsSync)(n)){const r=JSON.parse((0,s.readFileSync)(n,"utf8"));r.plugins&&typeof r.plugins=="object"&&(r.plugins=Object.fromEntries(Object.entries(r.plugins).filter(([i])=>{const a=i.split("@")[0]??i;return!M.has(a)}))),(0,s.writeFileSync)((0,o.join)(e,"installed_plugins.json"),JSON.stringify(r,null,1))}}catch{try{(0,s.rmSync)(e,{recursive:!0,force:!0})}catch{}b(t,e)}}function re(t,e){if(!v(e))try{const n=JSON.parse((0,s.readFileSync)(t,"utf8"));n.mcpServers&&typeof n.mcpServers=="object"&&(n.mcpServers=Object.fromEntries(Object.entries(n.mcpServers).filter(([r])=>!U.has(r)))),(0,s.writeFileSync)(e,JSON.stringify(n,null,1))}catch{b(t,e)}}var s,L,o,O,D,M,U,J,j,E,k,H,se=P((()=>{s=m(y(),1),L=m(y(),1),o=m(y(),1),R(),q(),O="projects",D=new Set(["CLAUDE.md","CLAUDE.local.md","AGENTS.md"]),M=new Set(["github","cloudflare","firecrawl"]),U=new Set(["playwright"]),J=Object.freeze({includeGitInstructions:!1,showThinkingSummaries:!0,fileCheckpointingEnabled:!1}),j="session-recover-hook.mjs",E="launch-playbook.md",k="launch-intent.json",H=`#!/usr/bin/env node
// session-recover-hook.mjs — WI-3280 argv-proof playbook delivery + P-004
// post-compaction continuity anchor + P-007 identity rebind (generated by
// interactive-claude-config.ts on every session materialize; do not edit).
import { readFileSync, writeFileSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const dir = dirname(fileURLToPath(import.meta.url));
const PLAYBOOK = join(dir, ${JSON.stringify(E)});
const INTENT = join(dir, ${JSON.stringify(k)});
const FLAGS = ['--system-prompt-file', '--append-system-prompt-file'];
// EI-13477: same layout psu-pty-host.mjs's appendHostEvent / sanitizeKey use —
// MUST match byte-for-byte so latestRespawnNativeId (psu-pty-discovery.ts)
// finds this event under the same per-owner log it already reads.
const PSU_PTY_DIR = join(homedir(), '.papercusp', 'psu-pty');
const RESPAWN_EVENT_LOG_MAX_BYTES = 2 * 1024 * 1024;
function sanitizeOwnerKey(ownerId) {
  return String(ownerId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
}

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

// EI-20273348458054257: the recovery banner used to assert, unconditionally,
// "coord/MCP identity is unaffected" — a claim about a thing it had not
// checked. A self-relaunch CAN fork the coord identity (measured: recorded
// su-9cf35961… → live su-c6e0a56f…, 12 ownerId-keyed surfaces stranded), and an
// agent told its identity is intact has no reason to look. rebindIdentityIfChanged()
// below detects the fork, but it is a separate async path this SYNC banner never
// consulted, so the two could — and did — disagree.
//
// The rule this encodes: report what was VERIFIED (the recorded sid vs the live
// env sid), never the reassuring conclusion. When they diverge, lead with the
// divergence and the one call that repairs it; when they agree, say only that
// they agree and name the read that would settle it authoritatively.
function identityLine(intent) {
  const recorded = ((intent && intent.sid) || '').trim();
  const live = (process.env.PAPERCUSP_SID || '').trim();
  if (recorded && live && recorded !== live) {
    return (
      '- ⚠ YOUR PAPERCUSP IDENTITY CHANGED ACROSS THIS RELAUNCH: recorded ' +
      recorded +
      ' → live ' +
      live +
      '. Every ownerId-keyed surface (armed loop, loop carry-note + walls, plan/work claims, claim-spec, standing awaits, fleet membership + leadership, owner facts, held file locks) is still keyed to the OLD id. Run coord:rebind-identity { from: "' +
      recorded +
      '" } NOW, then coord:orient { afterCompaction: true }.'
    );
  }
  if (recorded) {
    return (
      '- Your papercusp identity is ' +
      recorded +
      ' (env PAPERCUSP_SID), which MATCHES the live env value — but that is the only thing checked here, not proof the coord/MCP session resolved to it. Confirm with coord:orient and compare self.ownerId; if it differs, coord:rebind-identity { from: "' +
      recorded +
      '" }.'
    );
  }
  return '- No recorded PAPERCUSP_SID to compare against — verify your identity with coord:orient (self.ownerId) before trusting any ownerId-keyed state.';
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
    identityLine(intent),
    intent.nativeSessionId ? '- Your native claude session id may differ from the recorded one (' + intent.nativeSessionId + ') — psu resume/tracking of this conversation may be degraded; disclose this if coordination looks off.' : '- psu resume/tracking of this conversation may be degraded; disclose this if coordination looks off.',
    '- If the playbook below denies tools (subagents, native schedulers), honor it even though the CLI deny flags were lost.',
    '- The document below IS your operating playbook / system prompt. Follow it in full.',
  ].join('\\n');
  return banner + '\\n\\n' + playbook;
}

// EI-13477: report a same-pid self-relaunch's NEW native session id the same
// way a psu-host carry-respawn already does, so the SERVER-side context-gauge
// re-anchors instead of freezing on the dead pre-relaunch transcript forever.
//
// playbookRecovery() firing is the reliable signal that THIS SessionStart is a
// genuine self-relaunch (argv lost its -system-prompt-file flag, which only
// happens on claude's internal TUI-switch/update re-exec — never on a normal
// resume/clear/compact start). The claude hook input's own 'session_id' IS the
// freshly re-exec'd process's native id — psu never has to guess it.
//
// Rather than teach the compaction reader a SECOND reconciliation source, this
// appends the SAME 'respawned' event shape psu-pty-host.mjs's appendHostEvent
// writes for a wrapper-driven carry-respawn, into the SAME per-owner log file
// latestRespawnNativeId (psu-pty-discovery.ts) already reads — a live host's
// discovery file need not even exist for this to work, since a same-pid
// relaunch never restarts the pty host. Best-effort / fail-open: a write
// failure here must never block the session start.
function reportSelfRelaunchNativeId(ownerId, nativeId) {
  if (!ownerId || !nativeId) return;
  try {
    const p = join(PSU_PTY_DIR, sanitizeOwnerKey(ownerId) + '.events.jsonl');
    try {
      if (statSync(p).size > RESPAWN_EVENT_LOG_MAX_BYTES) {
        const tail = readFileSync(p, 'utf8');
        writeFileSync(p, tail.slice(Math.floor(tail.length / 2)).replace(/^[^\\n]*\\n/, ''), { mode: 0o600 });
      }
    } catch {}
    const row = JSON.stringify({ ts: new Date().toISOString(), kind: 'respawned', mode: 'self-relaunch', nativeId });
    appendFileSync(p, row + '\\n', { mode: 0o600 });
  } catch {
    /* fail-open — the banner still discloses the mismatch to the agent even if this write fails */
  }
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
  const manual = 'Run coord:rebind-identity { from: \\'' + recorded + '\\', to: \\'' + live + '\\' } NOW (it needs NO force for an ended predecessor, even one whose heartbeat is still warm; add force:true only if it refuses with a live sessionState AND coord:presence confirms the old id is dead), then coord:orient { afterCompaction: true }.';
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
      const st = body.fromSessionState ? ' as sessionState=' + body.fromSessionState : '';
      return { rebound: false, to: live, text: head + ' AUTO-REBIND REFUSED — the old id still resolves' + st + ' through the liveness oracle, so a DIFFERENT live session may hold it. Note this is NOT the ordinary warm-heartbeat case (an ended predecessor rebinds automatically). Confirm with coord:presence, and only if it really is dead: ' + manual };
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
    if (p && input.session_id) {
      reportSelfRelaunchNativeId(process.env.PAPERCUSP_SID || intent.sid, input.session_id);
    }
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
`}));se();export{de as ensureInteractiveClaudeConfig};

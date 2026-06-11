/**
 * Papercusp coordination hook for OMP — one module, six handlers
 * (per agent-coordination-architecture-v2 §7.3 + §12.1 +
 * file-locking-improvements #2):
 *
 *   session_start    → mint the per-process coordination owner id;
 *                      probe the operator (attached/detached) +
 *                      declare presence (coord:declare-intent over
 *                      MCP, attached only — presence is PG-backed).
 *   turn_start       → assemble + inject the system-reminder payload
 *                      (held locks, unread inbox, changed plans).
 *   turn_end         → persist the watermark pointers consumed.
 *   tool_call        → L2 file-lock enforcement — extract paths,
 *                      locks:acquire, block on busy.
 *   tool_result      → release the lock for that toolCallId, AND inject any
 *                      coord messages that arrived since the last tool call
 *                      (mid-turn delivery via pi.sendMessage steer — parity
 *                      with the Claude/Codex PostToolUse coord hook).
 *   session_shutdown → defensive release of any locks still held.
 *
 * Runtime: the hook is loaded BY OMP, inside the OMP child process,
 * NOT in the operator. It MUST be self-contained (no operator imports)
 * and talks back to the operator over HTTP.
 *
 * Env (set by buildConsoleEnvelope when mode='omp' per the OMP-bundle
 * plan §4.4, omp-power-user-bundle-brief §3):
 *   PAPERCUSP_AUTH_SESSION_ID     — agent canonical id (pus-<uuid>)
 *   PAPERCUSP_BUNDLE_URL          — bundle URL (operator origin = prefix)
 *   PAPERCUSP_BUNDLE_ACCESS_TOKEN — bearer for MCP calls
 *
 * Best-effort: every handler swallows its errors — a hook failure must
 * never crash the OMP session. See the omp-bundle plan §4.3.1.
 *
 * OMP HookAPI shape — VERIFY AT DEPLOY: this file assumes a standard
 * `default (pi: HookAPI) => void` registration where `pi.on(event,
 * handler)` wires a handler whose return value can carry an injection
 * (turn_start) or a block decision (tool_call). The exact OMP types
 * are in node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/.
 * The adapter at the bottom is documented and trivial to reshape.
 *
 * Attached vs detached: the extension probes the operator at session
 * start. Attached → the MCP path below. Detached (operator unreachable)
 * → coord state is ALL PG-backed now — channels, watermarks, presence,
 * and locks (coord-channels-pg-port D-001, P-010) — so there is no
 * filesystem fallback: the turn-start coord injection is skipped for the
 * turn (lock enforcement separately fails open with its own notice). The
 * operator + PG are required for any coord surface.
 */

import { promises as fsp, existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

// ── Pure helpers (unit-tested) ───────────────────────────────────────

export interface InboxEntry {
  ts: string;
  msg_id: string;
  from: string;
  kind: string;
  summary?: string;
  plan_slug?: string;
  related_msg_id?: string;
  severity?: string;
  /** Present on plan_event entries — created / promoted / etc. */
  event?: string;
  /** Subscribe→inject fan-out fields (coordination-substrate Phase 2). `subject`
   *  groups digest coalescing (e.g. 'feature:F-1'); `digest` flags a digest-mode
   *  notice the inbox coalesces; `notify_kind` is the change sub-type. */
  subject?: string;
  notify_kind?: string;
  digest?: boolean;
}

export interface HeldLock {
  path: string;
  acquired_ts?: string;
  expires_ts?: string;
}

export interface PlanEventSummary {
  plan_slug: string;
  events: string[];
}

export interface ReminderInput {
  ownerId: string;
  inbox: InboxEntry[];
  heldLocks: HeldLock[];
  changedPlans: PlanEventSummary[];
}

/**
 * Format the turn-start reminder shown to the model. Compact,
 * skimmable — does NOT dump full bodies; those are one tool call away.
 * Returns "" when there is nothing to surface (no reminder injected) —
 * which is also what a detached (operator-unreachable) turn produces,
 * since coord state is all PG-backed now with no filesystem fallback.
 */
/**
 * Coalesce digest-mode subscribe→inject notifies by `subject` (D-006 — the noise
 * control). Full-mode notifies pass through untouched; same-subject digest
 * notifies collapse into ONE line carrying the count + the latest summary. Other
 * kinds pass through unchanged, preserving input order. Pure + unit-tested.
 */
export function collapseDigestNotifies(entries: InboxEntry[]): InboxEntry[] {
  const out: InboxEntry[] = [];
  const groups = new Map<string, InboxEntry & { _count: number }>();
  for (const e of entries) {
    if (e.kind === 'notify' && e.digest) {
      const key = e.subject ?? e.summary ?? '?';
      const g = groups.get(key);
      if (!g) {
        const ne: InboxEntry & { _count: number } = { ...e, _count: 1 };
        groups.set(key, ne);
        out.push(ne);
      } else {
        g._count += 1;
        if (e.ts > g.ts) {
          g.ts = e.ts;
          g.summary = e.summary;
        }
      }
    } else {
      out.push(e);
    }
  }
  for (const g of groups.values()) {
    if (g._count > 1) {
      const subj = g.subject ?? '';
      g.summary = `${subj ? `${subj} ` : ''}×${g._count} — latest: ${g.summary ?? ''}`;
    }
  }
  return out;
}

export function formatTurnStartReminder(input: ReminderInput): string {
  const out: string[] = [];

  if (input.heldLocks.length > 0) {
    out.push(`You (${input.ownerId}) currently hold ${input.heldLocks.length} lock${input.heldLocks.length === 1 ? '' : 's'}:`);
    for (const l of input.heldLocks.slice(0, 5)) {
      out.push(`  • ${l.path}`);
    }
    if (input.heldLocks.length > 5) {
      out.push(`  • … and ${input.heldLocks.length - 5} more (locks:queue { owner })`);
    }
  }

  // Escalations first within the inbox — they earn the right to interrupt.
  const escalations = input.inbox.filter((e) => e.kind === 'escalation');
  const messages = input.inbox.filter((e) => e.kind === 'message' || e.kind === 'ack');
  const notifies = collapseDigestNotifies(input.inbox.filter((e) => e.kind === 'notify'));
  const handoffs = input.inbox.filter((e) => e.kind === 'handoff' || e.kind === 'handoff_accepted');

  if (input.inbox.length > 0) {
    out.push(`Inbox — ${input.inbox.length} unread:`);
    for (const e of escalations.slice(0, 3)) {
      out.push(`  • [escalation${e.severity ? `:${e.severity}` : ''}] ${e.summary ?? '(no summary)'} (id ${e.msg_id})`);
    }
    for (const e of handoffs.slice(0, 3)) {
      out.push(`  • [${e.kind} from ${e.from}] ${e.summary ?? ''}${e.plan_slug ? ` → ${e.plan_slug}` : ''}`);
    }
    for (const e of messages.slice(0, 5)) {
      out.push(`  • [${e.kind} from ${e.from}] ${e.summary ?? ''}`);
    }
    for (const e of notifies.slice(0, 5)) {
      out.push(`  • [notify] ${e.summary ?? ''}`);
    }
  }

  if (input.changedPlans.length > 0) {
    out.push(`Plans changed since you last read (${input.changedPlans.length}):`);
    for (const p of input.changedPlans.slice(0, 5)) {
      out.push(`  • ${p.plan_slug} — ${p.events.join(', ')}`);
    }
  }

  if (out.length === 0) return '';

  return `<system-reminder type="coord">\n${out.join('\n')}\n</system-reminder>`;
}

/**
 * Format the MID-TURN delta reminder — the coord messages that arrived since
 * the last tool call (parity with the Claude/Codex PostToolUse coord hook).
 * Compact, newest-capped (the most recent matter most; older are summarized as
 * a count), wrapped in the same `<system-reminder type="coord">` envelope as
 * the turn-start reminder. Returns '' for an empty list (nothing injected).
 */
export function formatInboxDelta(injection: string): string {
  // DUMB PIPE (token-efficient-coord-injection D-003/P-009): the positional
  // `[coord+N]` block — capping, digest + latest-per-peer intent collapse, the
  // glyph key, and the relocated footer — all live SERVER-SIDE now, in
  // coord:inbox's `injection` (coord-schema.renderInjection). This hook only
  // wraps it in the OMP coord envelope + (in pollInboxDelta) keeps the cursor.
  // One server-side edit re-tunes every client. Empty injection → no reminder.
  const body = (injection ?? '').trim();
  if (!body) return '';
  return `<system-reminder type="coord">\n${body}\n</system-reminder>`;
}

/** Aggregate raw plan_event lines into one summary per plan_slug. */
export function summarisePlanEvents(events: InboxEntry[]): PlanEventSummary[] {
  const by = new Map<string, string[]>();
  for (const e of events) {
    if (e.kind !== 'plan_event') continue;
    const slug = e.plan_slug ?? '<unknown>';
    const ev = (e as { event?: string }).event ?? 'event';
    if (!by.has(slug)) by.set(slug, []);
    by.get(slug)!.push(ev);
  }
  return [...by.entries()].map(([plan_slug, events]) => ({ plan_slug, events }));
}

// ── HTTP plumbing (operator MCP transport) ───────────────────────────

interface JsonRpcResp {
  result?: { content?: Array<{ type: string; text?: string }> };
  error?: { code: number; message: string };
}

/**
 * Call an MCP tool on the operator. Returns the parsed JSON of the
 * tool's text content (the coord:* tools all JSON-stringify into a
 * single text element). Returns null on any failure — best-effort.
 */
/**
 * Per-PROCESS coordination owner id (file-locking #2). Minted once,
 * cached for the process lifetime.
 *
 * This is the structural fix for OMP per-session identity: the hook
 * OWNS its identity rather than inheriting it from whatever the MCP
 * transport's `Mcp-Session-Id` / bundle token happens to carry. Two
 * OMP shells on one machine ALWAYS get distinct owners because
 * `process.pid` differs — the lock store can never collapse them.
 *
 * Format `omp-<session>-<pid>`: the session part is
 * PAPERCUSP_AUTH_SESSION_ID when the bundle env supplies it (already
 * unique per desktop launch), else a random hex (covers the
 * standalone-install path where no bundle session id exists). The
 * `<pid>` makes it unconditional regardless. callMcpTool passes this
 * via `?client=` — the operator's power-user route branch honors it
 * (see _mcp-handler.ts).
 */
let _hookOwnerId: string | null = null;
type AdvSessionLinkState = 'pending' | 'linked' | 'conflict';
let _advSessionLinkState: AdvSessionLinkState = 'pending';
export function hookOwnerId(): string {
  if (_hookOwnerId === null) {
    const session =
      process.env.PAPERCUSP_AUTH_SESSION_ID &&
      process.env.PAPERCUSP_AUTH_SESSION_ID.length > 0
        ? process.env.PAPERCUSP_AUTH_SESSION_ID
        : Math.random().toString(36).slice(2, 10);
    _hookOwnerId = `omp-${session}-${process.pid}`;
  }
  return _hookOwnerId;
}

/** Test-only: reset memoised state between cases. */
export function _resetHookOwnerIdForTests(): void {
  _hookOwnerId = null;
  _advSessionLinkState = 'pending';
  _mode = 'attached';
  _lastProbeAtMs = 0;
}

export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  env: { mcpUrl?: string; bearer?: string; sessionId?: string } = {},
): Promise<unknown | null> {
  // Append the per-process coordination owner as `?client=` so the
  // operator attributes every coord/locks call to THIS process, not
  // to a shared bundle-token identity (file-locking #2).
  const clientParam = `client=${encodeURIComponent(hookOwnerId())}`;
  const withClient = (base: string): string =>
    base.includes('?') ? `${base}&${clientParam}` : `${base}?${clientParam}`;
  const mcpUrl =
    env.mcpUrl ??
    (process.env.PAPERCUSP_BUNDLE_URL
      ? withClient(
          new URL('/api/mcp?power_user=1', process.env.PAPERCUSP_BUNDLE_URL).toString(),
        )
      : (process.env.PAPERCUSP_OPERATOR_URL || process.env.PAPERCUSP_API_BASE)
      ? withClient(
          new URL(
            '/api/mcp?superuser=1',
            process.env.PAPERCUSP_OPERATOR_URL || process.env.PAPERCUSP_API_BASE!,
          ).toString(),
        )
      : null);
  if (!mcpUrl) return null;
  let bearer =
    env.bearer ??
    process.env.PAPERCUSP_BUNDLE_ACCESS_TOKEN ??
    process.env.PAPERCUSP_SUPERUSER_TOKEN ??
    '';
  if (!bearer && !process.env.PAPERCUSP_BUNDLE_URL) {
    try {
      bearer = (
        await fsp.readFile(join(process.env.HOME ?? homedir(), '.papercusp', 'superuser-token'), 'utf8')
      ).trim();
    } catch {
      bearer = '';
    }
  }
  const sessionId = env.sessionId ?? process.env.PAPERCUSP_AUTH_SESSION_ID ?? '';
  try {
    const res = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // The Streamable HTTP MCP transport may return either application/json
    // or text/event-stream framed. A correctly framed SSE response from
    // the current @modelcontextprotocol/sdk leads with `event: message\n`
    // BEFORE the `data: <json>` line — the older check only handled the
    // case where `data:` was the first byte, which silently broke every
    // coord call (regression: see plans/coord-hook-sse-event-prefix-*).
    // Always scan for a `data:` line first; fall back to raw text.
    const dataLine = text.split('\n').find((l) => l.startsWith('data:'));
    const payload = dataLine !== undefined ? dataLine.slice(5).trim() : text;
    const parsed = JSON.parse(payload) as JsonRpcResp;
    if (parsed.error) return null;
    const content = parsed.result?.content?.[0]?.text;
    if (typeof content !== 'string') return null;
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// ── Mode detection: attached vs detached (§10) ───────────────────────

export type CoordMode = 'attached' | 'detached';

/**
 * Current coordination mode. Defaults to 'attached' (optimistic) — the
 * first turn self-corrects if the operator turns out unreachable, so a
 * missing session_start probe is not fatal.
 */
let _mode: CoordMode = 'attached';

/** Epoch ms of the last probe — drives the detached-mode re-probe
 *  throttle so a recovered operator is picked up without paying a
 *  probe (a 2s timeout when still down) on every detached turn. */
let _lastProbeAtMs = 0;

/** How stale a detached-mode probe may get before onTurnStart re-probes
 *  (audit NB-1 — detached→attached recovery). */
const DETACHED_REPROBE_MS = 120_000;

/** The operator's base origin from env, or null if none is configured. */
function operatorBaseUrl(): string | null {
  for (const v of [process.env.PAPERCUSP_BUNDLE_URL, process.env.PAPERCUSP_OPERATOR_URL]) {
    if (v) {
      try {
        return new URL(v).origin;
      } catch {
        /* malformed — try the next */
      }
    }
  }
  return null;
}

/**
 * Probe GET <operator>/api/health. True iff the operator answers 200
 * within `timeoutMs`. Any error (no operator configured, refused,
 * timeout, non-200) → false. See agent-coordination-architecture-v2
 * Q-5: /api/health is the dedicated liveness route.
 */
export async function probeOperator(timeoutMs = 2000): Promise<boolean> {
  const base = operatorBaseUrl();
  if (!base) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/api/health`, { signal: ctrl.signal });
      return res.ok;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return false;
  }
}

/** Probe and update `_mode` + the probe timestamp. Returns the mode. */
export async function refreshMode(): Promise<CoordMode> {
  _mode = (await probeOperator()) ? 'attached' : 'detached';
  _lastProbeAtMs = Date.now();
  return _mode;
}

// ── Watermark staging type ───────────────────────────────────────────

/** Last-read pointers the hook tracks — a subset of the operator's
 *  Watermark (messages + plan-events; escalations/subscriptions are
 *  not consumed by the turn-start reminder). */
export interface HookWatermark {
  messages?: string;
  plan_events?: string;
}

// ── Handlers ─────────────────────────────────────────────────────────

interface HookSessionLinkContext {
  cwd?: string;
  sessionManager?: {
    getSessionId?: () => string;
    getSessionFile?: () => string | undefined;
    getCwd?: () => string;
  };
}

function currentSessionLinkFromContext(ctx: unknown): {
  advSessionId: number;
  sessionId: string;
  filePath?: string;
  cwd?: string;
} | null {
  const rawAdvSessionId = process.env.PAPERCUSP_ADV_SESSION_ID;
  if (!rawAdvSessionId) return null;
  const advSessionId = Number(rawAdvSessionId);
  if (!Number.isFinite(advSessionId) || advSessionId <= 0) return null;

  const c = ctx as HookSessionLinkContext | undefined;
  const sessionId = c?.sessionManager?.getSessionId?.()?.trim();
  if (!sessionId) return null;

  const filePath = c?.sessionManager?.getSessionFile?.();
  const cwd = c?.cwd ?? c?.sessionManager?.getCwd?.();
  return {
    advSessionId,
    sessionId,
    ...(filePath ? { filePath } : {}),
    ...(cwd ? { cwd } : {}),
  };
}

export async function linkAdvSessionFromContext(ctx: unknown): Promise<boolean> {
  if (_advSessionLinkState === 'linked') return true;
  if (_advSessionLinkState === 'conflict') return false;
  const link = currentSessionLinkFromContext(ctx);
  if (!link) return false;
  const result = await callMcpTool('omp:sessions', { op: 'link', ...link }) as
    | { ok?: boolean; result?: string }
    | null;
  if (result?.result === 'conflict') {
    _advSessionLinkState = 'conflict';
    return false;
  }
  const linked = result?.ok === true &&
    (result.result === 'linked' || result.result === 'already_linked');
  if (linked) _advSessionLinkState = 'linked';
  return linked;
}

/** Fired once per OMP session start. Probes the operator to choose
 *  attached/detached mode, then links the ADV sessions row to the OMP
 *  session id when the launcher passed PAPERCUSP_ADV_SESSION_ID. It then
 *  declares presence (attached only — presence is PG-backed and unavailable
 *  detached). */
export async function onSessionStart(ctx?: unknown): Promise<void> {
  // Mint the per-process coordination owner id up front (file-locking
  // #2). Every subsequent callMcpTool carries it via `?client=`, so a
  // lock or coordination message authored by this process is always
  // attributed to THIS process — never collapsed with a sibling OMP
  // shell that happens to share a bundle token.
  hookOwnerId();
  await refreshMode();
  if (_mode === 'attached') {
    await linkAdvSessionFromContext(ctx);
    await callMcpTool('coord:declare-intent', { intent: 'OMP session started' });
    // Activity bridge: a "worker appeared" lifecycle marker for the fleet view.
    void reportLifecycle('start');
  }
}

/**
 * Fired on process exit (SIGINT/SIGTERM). Defensive lock cleanup
 * (file-locking #2 step 4): release every lock this owner still
 * holds. In the normal path onToolResult already released each lock
 * as its tool finished, so this is a backstop for a session that
 * ends mid-edit (turn aborted between tool_call and tool_result).
 *
 * Uses `all_mine: true` — one call that releases everything the
 * `?client=` owner holds, rather than iterating the local cache
 * (which could be stale if a tool_result was missed). Best-effort:
 * a failure here is covered by the lock TTL.
 */
export async function onSessionShutdown(): Promise<void> {
  acquiredLocks.clear();
  // Activity bridge: a "worker left" lifecycle marker, then the lock backstop.
  await reportLifecycle('shutdown');
  await callMcpTool('locks:release', { all_mine: true });
}

/**
 * Watermark carried between turn_start and turn_end. onTurnStart records
 * the newest ts it surfaced on each surface (messages + plan-events);
 * onTurnEnd persists them. Conservative by design (plan §7.2): an
 * aborted turn never reaches turn_end, so the next turn re-sees the
 * same notifications — a missed notification is worse than a repeated
 * one.
 */
let _pendingWatermark: HookWatermark = {};

/** Mid-turn delivery cursor — the newest message ts already surfaced this
 *  turn (by turn_start or a prior tool_result). The tool_result poll fetches
 *  coord:inbox SINCE this, so a message that arrives mid-turn reaches the
 *  agent before its next step instead of only at the next turn_start. Seeded
 *  each attached turn_start; undefined detached/pre-seed (→ no mid-turn poll,
 *  so we never dump history on a missing baseline). */
let _midTurnCursor: string | undefined;

/** Test seam — reset the mid-turn cursor between cases. */
export function _resetMidTurnCursorForTests(v?: string): void {
  _midTurnCursor = v;
}

/** Largest ISO ts in a list of inbox entries, or '' if empty. */
function maxTs(entries: InboxEntry[]): string {
  let max = '';
  for (const e of entries) {
    if (e.ts > max) max = e.ts;
  }
  return max;
}

/** Result of a turn-start assembly. `degraded` is true when ATTACHED
 *  but the core operator call (coord:inbox) failed transiently.
 *  `mode` reports attached/detached — detached is a supported mode,
 *  not a failure. The adapter surfaces both (plan §7.4 / §10). */
export interface TurnStartResult {
  reminder: string;
  degraded: boolean;
  mode: CoordMode;
}

/** Attached turn-start: assemble the reminder over the MCP tool path. */
async function onTurnStartAttached(ownerId: string): Promise<TurnStartResult> {
  // Read the watermark first — its two pointers scope the inbox and the
  // plan-events feed respectively.
  const wmResult = await callMcpTool('coord:watermark', {});
  const wm = (() => {
    const r = wmResult as {
      watermark?: { messages_since_ts?: string; plan_events_since_ts?: string };
    } | null;
    const m = r?.watermark?.messages_since_ts;
    const p = r?.watermark?.plan_events_since_ts;
    return {
      messages: typeof m === 'string' && m.length > 0 ? m : undefined,
      planEvents: typeof p === 'string' && p.length > 0 ? p : undefined,
    };
  })();

  // The heartbeat (declare-intent) runs concurrently with the inbox
  // fetch — it does not gate the reminder — but is AWAITED as part of
  // the batch. A bare `void callMcpTool(...)` could accumulate unbounded
  // pending promises against a hung operator (audit B4); batching it
  // bounds the in-flight count to one per turn. coord:plan-events is in
  // the same batch — plan_event lines live in coord/plan-events-*.jsonl,
  // NOT coord/messages/, so coord:inbox never surfaces them (audit NB-2).
  const [inboxResult, locksResult, , planEventsResult] = await Promise.all([
    callMcpTool('coord:inbox', wm.messages ? { since_ts: wm.messages } : {}),
    callMcpTool('locks:queue', { owner: ownerId }).catch(() => null),
    callMcpTool('coord:declare-intent', {
      intent: '(active — see coord:presence for current work)',
    }),
    callMcpTool(
      'coord:plan-events',
      wm.planEvents ? { since_ts: wm.planEvents } : {},
    ).catch(() => null),
  ]);

  // coord:inbox returning null means the operator call FAILED (an empty
  // inbox returns { entries: [] }, which is truthy). That is the
  // degraded signal — the turn-start context is incomplete.
  const degraded = inboxResult === null;

  const inbox: InboxEntry[] = (() => {
    const r = inboxResult as { entries?: InboxEntry[] } | null;
    return r?.entries ?? [];
  })();
  const heldLocks: HeldLock[] = (() => {
    const r = locksResult as { active_locks?: HeldLock[] } | null;
    return r?.active_locks ?? [];
  })();
  const planEvents: InboxEntry[] = (() => {
    const r = planEventsResult as { events?: InboxEntry[] } | null;
    return r?.events ?? [];
  })();
  const changedPlans = summarisePlanEvents(planEvents);

  const inboxMax = maxTs(inbox);
  const planEventsMax = maxTs(planEvents);
  _pendingWatermark = degraded
    ? {}
    : {
        ...(inboxMax.length > 0 ? { messages: inboxMax } : {}),
        ...(planEventsMax.length > 0 ? { plan_events: planEventsMax } : {}),
      };

  // Seed the mid-turn cursor at the newest position surfaced this turn, so the
  // tool_result poll only injects messages that arrive AFTER turn start (no
  // overlap with the reminder just built, no history dump on a fresh inbox).
  _midTurnCursor = degraded
    ? undefined
    : inboxMax.length > 0
      ? inboxMax
      : (wm.messages ?? new Date().toISOString());

  return {
    reminder: formatTurnStartReminder({
      ownerId,
      inbox,
      heldLocks,
      changedPlans,
    }),
    degraded,
    mode: 'attached',
  };
}

/** Detached turn-start: the operator is unreachable, so coord state —
 *  inbox, plan-events, watermarks, presence, locks — is ALL PG-backed and
 *  cannot be read (no filesystem fallback; coord-channels-pg-port P-010 /
 *  D-001). Inject nothing (a lone notice every turn risks an OMP
 *  auto-continue loop — see formatTurnStartReminder) and stage no
 *  watermark. The agent's lock hook separately fails open with its own
 *  stderr notice. */
function onTurnStartDetached(): TurnStartResult {
  _pendingWatermark = {};
  _midTurnCursor = undefined; // no baseline → tool_result poll is a no-op
  return { reminder: '', degraded: false, mode: 'detached' };
}

/** Fired once per turn start. Dispatches by mode. Recovery is
 *  bidirectional (audit NB-1): an attached call that comes back
 *  degraded re-probes (operator may have gone away); a detached turn
 *  re-probes on a throttle (operator may have come back). */
export async function onTurnStart(ctx?: unknown): Promise<TurnStartResult> {
  const ownerId = process.env.PAPERCUSP_AUTH_SESSION_ID ?? 'unknown';

  if (_mode === 'detached') {
    // Throttled re-probe — a recovered operator is picked up without
    // paying a probe (a 2s timeout while still down) every turn.
    const needsImmediateAdvLinkProbe =
      _advSessionLinkState === 'pending' && !!process.env.PAPERCUSP_ADV_SESSION_ID;
    if (needsImmediateAdvLinkProbe || Date.now() - _lastProbeAtMs > DETACHED_REPROBE_MS) {
      await refreshMode();
    }
    if (_mode === 'detached') {
      return onTurnStartDetached();
    }
    // Operator came back — fall through to the attached path.
  }

  await linkAdvSessionFromContext(ctx);
  const attached = await onTurnStartAttached(ownerId);
  if (!attached.degraded) return attached;
  // Attached call failed — was it a transient blip or did the operator
  // go away? Re-probe; if it is truly gone, fall through to detached so
  // this turn is still useful.
  // Use refreshMode()'s return value, not the module-level `_mode`:
  // TS's control-flow analysis over-narrows `_mode` to 'attached' here
  // (it was narrowed by the block above and TS doesn't track that
  // refreshMode() reassigns it), which makes `_mode === 'detached'`
  // look like dead code. The returned value is correctly typed.
  const reprobed = await refreshMode();
  if (reprobed === 'detached') {
    return onTurnStartDetached();
  }
  await linkAdvSessionFromContext(ctx);
  return attached; // operator is up — a genuine transient failure
}

/** Fired once per turn end. Persists the watermark pointers staged by
 *  onTurnStart via coord:watermark-set (attached only — a detached turn
 *  stages nothing). No-op when nothing was surfaced. */
export async function onTurnEnd(): Promise<void> {
  const wm = _pendingWatermark;
  _pendingWatermark = {};
  if (wm.messages === undefined && wm.plan_events === undefined) return;
  // Detached stages no watermark (onTurnStartDetached clears it), so reaching
  // here means attached — persist via the operator. No filesystem fallback
  // any more (coord-channels-pg-port P-010).
  await callMcpTool('coord:watermark-set', {
    ...(wm.messages !== undefined ? { messages_since_ts: wm.messages } : {}),
    ...(wm.plan_events !== undefined ? { plan_events_since_ts: wm.plan_events } : {}),
  });
}

/**
 * Mid-turn coord delivery (parity with the Claude/Codex PostToolUse coord
 * hook): on each tool_result, poll coord:inbox for messages that arrived since
 * the last position surfaced this turn, and return a compact reminder for any
 * new ones. Advances both the mid-turn cursor (so a message is never injected
 * twice) and the staged watermark (so turn_end persists the progress).
 *
 * Attached-only + best-effort: returns '' when there's no baseline (detached
 * or pre-seed — never dump history on a missing cursor) or on any transient
 * failure (the next tool_result re-checks). The adapter injects the reminder
 * via pi.sendMessage(deliverAs:'steer') so it lands in the running turn.
 */
export async function pollInboxDelta(): Promise<{ reminder: string }> {
  const since = _midTurnCursor;
  if (!since) return { reminder: '' };
  const inboxResult = await callMcpTool('coord:inbox', { since_ts: since });
  if (inboxResult === null) return { reminder: '' }; // transient failure — skip
  const r = inboxResult as
    | { entries?: InboxEntry[]; injection?: string; summary?: { newest_ts?: string | null } }
    | null;
  const inbox = r?.entries ?? [];
  if (inbox.length === 0) return { reminder: '' };
  // Advance the cursor past every returned entry (server's max-ts, else compute).
  const serverMax = typeof r?.summary?.newest_ts === 'string' ? r.summary.newest_ts : '';
  const newMax = serverMax || maxTs(inbox);
  if (newMax.length > 0) {
    _midTurnCursor = newMax;
    _pendingWatermark = { ..._pendingWatermark, messages: newMax };
  }
  // Echo the server-rendered positional injection (dumb pipe).
  return { reminder: formatInboxDelta(r?.injection ?? '') };
}

/**
 * Tool-call enforcement (file-locking-improvements #2). Matches OMP's
 * `ToolCallEvent` from @oh-my-pi/pi-coding-agent/src/extensibility/
 * hooks/types.ts: discriminated `type: "tool_call"` envelope with
 * toolName / toolCallId / input. Return shape matches
 * `ToolCallEventResult` ({ block?, reason? }).
 *
 * Strategy (mirrors the now-deleted Claude Code PreToolUse/PostToolUse
 * shell hooks, with the same fail-open precedent):
 *   1. Extract repo-relative paths from the tool input (skip if the
 *      tool isn't a file-edit, or the path is outside the repo).
 *   2. Call locks:acquire with wait={max_sec:0} (no queueing on
 *      the hook — block immediately so the agent can replan).
 *   3. On ok → cache lock_id by toolCallId for onToolResult to release.
 *   4. On busy → return { block: true, reason: <formatted refusal> }.
 *   5. On operator-unreachable → log + return {} (fail open;
 *      cooperative discipline only works when the system is up).
 */
/**
 * Persistent OS schedulers, matched at COMMAND POSITION (start of command,
 * after a `;`/`&`/`|`/newline separator, or behind `sudo`) — never mid-word
 * or in prose args, so `cat`, `atuin`, or `echo "look at this"` can't trip
 * it (native-scheduler-lockout-2026-06-09 P-010 / OQ-3: the unambiguous set
 * only; widen only on observed escapes). Exported for unit tests.
 */
export const OS_SCHEDULER_CMD_RE = /(?:^|[;&|\n]\s*|\bsudo\s+)(?:crontab|at|batch|systemd-run)\b/;

export interface ToolCallEvent {
  type: 'tool_call';
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: 'tool_result';
  toolCallId: string;
  toolName?: string;
}

/**
 * In-process toolCallId → lock_id cache. Same OMP process handles
 * both tool_call and tool_result, so an in-memory Map is sufficient
 * — no FS cache (the CC hooks needed one because each Pre/Post fired
 * as a separate subprocess). Cleared on tool_result.
 */
const acquiredLocks = new Map<string, string>();

// ── Fail-open health marker (file-locking #3) ────────────────────────

/**
 * Directory the hook writes its two health markers into. Operator
 * reads them via GET /api/su-locks/hook-health so the /coord UI can
 * surface "enforcement is offline" when the last error is newer than
 * the last success. Located OUTSIDE the repo so multiple checkouts
 * share one marker set per host user.
 *
 * Two files, per the plan contract:
 *   - last-error.json   — written ONLY on a hook error (fail-open)
 *   - last-success.json — written on every successful hook call
 */
function locksCacheDir(): string {
  const override = process.env.PAPERCUSP_LOCKS_CACHE_DIR;
  if (override) return override;
  const home = process.env.HOME ?? '/tmp';
  return resolve(home, '.papercusp/locks-cache');
}

/** Error record — shape per file-locking plan §3 step 1. */
export interface HookErrorRecord {
  /** ISO timestamp of the failure. */
  ts: string;
  /** Which hook handler hit the error. */
  handler: 'tool_call' | 'tool_result';
  /** Coarse phase of the failure. */
  phase: 'connect' | 'http' | 'parse';
  /** One-line human-readable context. */
  detail: string;
  /** Operator URL the hook was trying to reach. */
  operator_url: string;
}

/** Success record — the "track this similarly" half of plan §3 step 2. */
export interface HookSuccessRecord {
  ts: string;
}

/**
 * Atomic-ish JSON write — temp file + rename. The hook never throws
 * on marker write failure (a filesystem error must not crash the
 * agent's tool call); errors are silently swallowed.
 */
async function writeMarker(path: string, value: unknown): Promise<void> {
  try {
    await fsp.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = path + '.tmp-' + process.pid;
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(tmp, path);
  } catch {
    // Best-effort. A failed marker write must never break the hook.
  }
}

/** Record a successful hook call (operator reachable + answered). */
export async function recordHookSuccess(): Promise<void> {
  const rec: HookSuccessRecord = { ts: new Date().toISOString() };
  await writeMarker(resolve(locksCacheDir(), 'last-success.json'), rec);
}

/** Record a hook error (fail-open path). */
export async function recordHookError(
  input: { handler: HookErrorRecord['handler']; phase: HookErrorRecord['phase']; detail: string },
): Promise<void> {
  const rec: HookErrorRecord = {
    ts: new Date().toISOString(),
    handler: input.handler,
    phase: input.phase,
    detail: input.detail,
    operator_url:
      process.env.PAPERCUSP_BUNDLE_URL ??
      process.env.PAPERCUSP_OPERATOR_URL ??
      '(unset)',
  };
  await writeMarker(resolve(locksCacheDir(), 'last-error.json'), rec);
}

/** The workspace whose direct-child worktrees this hook coordinates.
 *  Mirrors the cc hook's WORKSPACE_ROOT — override with
 *  PAPERCUSP_WORKSPACE_ROOT; default ~/papercupai-workspace. Realpath'd
 *  so the dirname comparison in extractLockTargets is symlink-stable. */
function workspaceRoot(): string {
  const raw =
    process.env.PAPERCUSP_WORKSPACE_ROOT ??
    resolve(process.env.HOME ?? '/tmp', 'papercupai-workspace');
  try {
    return realpathSync(raw);
  } catch {
    return raw;
  }
}

/** Walk up from a path (or its nearest existing parent) to the dir
 *  holding a `.git` entry — file (worktree) or dir. Mirrors the cc
 *  hook's find_repo_root so OMP and cc key locks identically across the
 *  many worktrees in this workspace; a single hardcoded root mis-keys in
 *  every checkout but one. Returns the repo root, or null if none. */
function findRepoRoot(absPath: string): string | null {
  let d = absPath;
  let isDir = false;
  try {
    isDir = statSync(d).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) d = dirname(d);
  while (d && d !== dirname(d)) {
    if (existsSync(join(d, '.git'))) return d;
    d = dirname(d);
  }
  return null;
}

/** A file the hook will claim: its worktree `root` plus the lock key
 *  `rel` (path relative to that root). */
export interface LockTarget {
  root: string;
  rel: string;
}

/**
 * Pull the files a tool will edit and resolve each to its worktree root
 * + repo-relative lock key. Anything outside a coordinated worktree, any
 * wildcard/glob, or any backslash path is silently dropped (the lock
 * store is workspace-scoped; non-repo paths are not coordinated, globs
 * would over-claim).
 *
 * Worktree resolution MIRRORS the cc hook
 * (`pretooluse-locks-acquire.sh` `find_repo_root` + workspace gate):
 * walk up from each path to the dir holding `.git`, and keep it only
 * when that root is a direct child of `workspaceRoot()`. The key is
 * RELATIVE TO that worktree root, so the same logical file collides
 * across sibling worktrees AND with a cc edit (which keys the same
 * way) — that's the cross-client / cross-worktree contention this buys.
 * The old single fixed `papercupRoot()` silently dropped every
 * sibling-worktree edit (it only matched the canonical checkout).
 *
 * Tool-name coverage matches OMP's file-edit surface:
 *   - write       → input.path
 *   - edit        → input.path | file_path | filePath  (extension)
 *   - ast_edit    → input.paths[]  (skip entries containing * ? [ )
 *   - multi_edit  → input.paths[]  (legacy / future)
 *
 * Path normalization mirrors the server's rules in
 * `apps/operator/lib/agent-tools/locks/path-normalize.ts` — that file
 * is the source of truth. The hook MUST duplicate them rather than
 * import the module because it ships as a single self-contained file
 * copied into `~/.papercusp/`. `node:path.resolve()` already collapses
 * `.`, `..`, `//` and trailing `/`; the explicit backslash skip below
 * covers the one rule resolve() does NOT enforce on POSIX (a `\` is a
 * literal filename char there, but the server rejects it).
 * `coord-hook.test.ts` asserts this stays consistent with
 * `normalizePaths()`.
 */
export function extractLockTargets(
  toolName: string,
  input: Record<string, unknown>,
): LockTarget[] {
  const raw: string[] = [];
  if (toolName === 'write' || toolName === 'edit') {
    for (const k of ['path', 'file_path', 'filePath'] as const) {
      const v = input[k];
      if (typeof v === 'string' && v.length > 0) raw.push(v);
    }
  } else if (toolName === 'ast_edit' || toolName === 'multi_edit') {
    const ps = input.paths;
    if (Array.isArray(ps)) {
      for (const p of ps) {
        if (typeof p === 'string' && p.length > 0 && !/[*?[\]]/.test(p)) {
          raw.push(p);
        }
      }
    }
  }
  const ws = workspaceRoot();
  const out: LockTarget[] = [];
  for (const p of raw) {
    // Backslash: the server's validatePath rejects it outright. Skip
    // here so the hook never asks the operator to claim a path the
    // operator would refuse (consistency with path-normalize.ts).
    if (p.includes('\\')) continue;
    const abs = resolve(p);
    const root = findRepoRoot(abs);
    if (root === null) continue; // outside any git repo — not coordinated
    if (abs === root) continue; // never claim the repo root itself
    // Coordinate only worktrees that are direct children of the
    // papercup workspace (papercup, papercup-<topic>, …). A git repo
    // elsewhere (a plain session editing an unrelated project) is left
    // unguarded so we never lock foreign repos into papercusp_su.
    let parent: string;
    try {
      parent = realpathSync(dirname(root));
    } catch {
      parent = dirname(root);
    }
    if (parent !== ws) continue;
    const rel = relative(root, abs);
    if (rel === '' || rel.startsWith('..')) continue;
    out.push({ root, rel });
  }
  return out;
}

/**
 * Repo-relative lock keys for a tool's edits — the `rel` of each
 * {@link LockTarget}. Kept as the simple projection for callers/tests
 * that only need the keys; the worktree roots (needed for symlink
 * detection) come from {@link extractLockTargets}.
 */
export function extractPathsFromToolInput(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  return extractLockTargets(toolName, input).map((t) => t.rel);
}

/**
 * Symlink refusal (file-locking-improvements #1). The lock store keys
 * on the path STRING — `apps/foo.ts` and a symlink `apps/link.ts`
 * pointing at it are two different keys, so two agents editing "the
 * same file" through different names would BOTH acquire. The operator
 * can't catch this (it doesn't share the agent's filesystem); the hook
 * runs ON that filesystem, so it can.
 *
 * The hook REFUSES rather than silently rewriting the claim to the
 * canonical path: rewriting would hide the aliasing from the agent,
 * and the plan (#1) deliberately scoped resolution out — the caller
 * owns resolving symlinks before it claims.
 *
 * Detection: canonicalize both the repo root and each candidate with
 * realpathSync, then compare repo-relative forms. Equal ⇒ no symlink.
 * Differ ⇒ a symlink sits somewhere in the path (or it escapes the
 * repo entirely). A not-yet-existent leaf (a `write` creating a new
 * file) is not itself a symlink — realpath its PARENT dir instead, so
 * a symlinked directory component is still caught. Anything realpath
 * can't resolve at all (broken link, EACCES, missing parent, or a root
 * that isn't a real dir — e.g. unit tests with PAPERCUSP_REPO_ROOT set
 * to a fake path) is left to the server: fail-open, consistent with
 * every other hook failure path.
 */
export function detectSymlinkedPaths(
  relPaths: string[],
  root: string,
): Array<{ given: string; real: string }> {
  let canonRoot: string;
  try {
    canonRoot = realpathSync(root);
  } catch {
    return []; // root not a real directory — fail open
  }
  const hits: Array<{ given: string; real: string }> = [];
  for (const rel of relPaths) {
    const abs = join(root, rel);
    let canon: string | null = null;
    try {
      canon = realpathSync(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        // Leaf missing (new file via `write`). A symlink can still
        // hide in a directory component — resolve the parent.
        try {
          canon = join(realpathSync(dirname(abs)), basename(abs));
        } catch {
          canon = null; // parent unresolvable — leave it to the server
        }
      }
      // EACCES / ELOOP / etc. — canon stays null, fail open.
    }
    if (canon === null) continue;
    const canonRel =
      canon === canonRoot
        ? ''
        : canon.startsWith(canonRoot + '/')
          ? canon.slice(canonRoot.length + 1)
          : null;
    // canonRel === null ⇒ the real path escaped the repo (a symlink
    // pointing outside): also a refusal — the claim string would look
    // in-repo while the edit lands elsewhere.
    if (canonRel !== rel) {
      hits.push({ given: rel, real: canonRel ?? canon });
    }
  }
  return hits;
}

/** Format the refusal when a tool targets a symlinked path (#1). */
export function formatSymlinkRefusal(
  hits: Array<{ given: string; real: string }>,
): string {
  const lines = [
    'locks: refused — symlinked path(s). Edit the real file directly:',
  ];
  for (const h of hits.slice(0, 5)) {
    lines.push(`  - ${h.given} → ${h.real || '(repo root)'}`);
  }
  if (hits.length > 5) lines.push(`  ... and ${hits.length - 5} more`);
  lines.push('');
  lines.push(
    'The lock store keys on the path string, so a symlink and its target',
  );
  lines.push(
    'are two separate claims — editing through the symlink would let',
  );
  lines.push('another agent hold the same underlying file at the same time.');
  return lines.join('\n');
}

/** Busy-array entry as returned by locks:acquire. */
interface BusyEntry {
  path: string;
  owner?: string;
  owner_label?: string | null;
  intent?: string;
  expires_ts?: string;
}

/** Format the human/agent-readable refusal when paths are contested. */
export function formatBusyRefusal(busy: BusyEntry[]): string {
  const lines: string[] = [
    'locks: refused — file(s) held by another SU agent:',
  ];
  for (const b of busy.slice(0, 5)) {
    const who = b.owner_label || b.owner || 'unknown';
    const intent = b.intent ? JSON.stringify(b.intent) : "'unknown'";
    lines.push(
      `  - ${b.path}: held by ${who} for ${intent} (expires ${b.expires_ts ?? '?'})`,
    );
  }
  if (busy.length > 5) lines.push(`  ... and ${busy.length - 5} more`);
  lines.push('');
  lines.push('Options: (1) wait and retry, (2) work on something else,');
  lines.push('(3) call locks:acquire with wait={max_sec:300} to queue.');
  return lines.join('\n');
}

// ── Activity bridge: the OMP in-process port (papercusp-worker-integration-2026-06-04,
//    D-002/D-003) ─────────────────────────────────────────────────────
//
// The cross-CLI counterpart of the shared `posttooluse-activity-report.sh` shell
// hook (Claude+Codex). OMP has no PostToolUse shell contract, so its activity report
// rides this in-process tool_call hook and calls the SAME `activity:report` MCP tool.
// Reports at tool_call (phase 'pre') — the OMP tool_result event carries no input, but
// tool_call has toolName + input, which is what the server needs. The display summary
// is derived SERVER-SIDE (one shared formatter), so this forwards RAW fields.

/** Cap a worker's native tool input so a giant Write `content` / patch body never
 *  bloats the report (mirrors the shell hook's cap). */
const ACTIVITY_STR_CAP = 500;
function capActivityInput(input: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input ?? {})) {
    if (typeof v === 'string') out[k] = v.length > ACTIVITY_STR_CAP ? v.slice(0, ACTIVITY_STR_CAP) + '…' : v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else if (v && typeof v === 'object') out[k] = '[object]';
    else out[k] = v;
  }
  return out;
}

const ACTIVITY_TODO_TOOLS = new Set(['todo_write', 'todowrite', 'taskcreate', 'taskupdate']);

/**
 * Build the `activity:report` args from an OMP tool_call event. A todo tool forwards
 * its list (uncapped, sliced) so the server summarises it as kind=todos; every other
 * tool forwards a string-capped input. Pure — exported for tests.
 */
export function buildActivityArgs(event: ToolCallEvent): Record<string, unknown> {
  const lower = event.toolName.toLowerCase();
  const args: Record<string, unknown> = {
    owner: hookOwnerId(),
    agent: 'omp',
    phase: 'pre',
    tool_name: event.toolName,
    tool_use_id: event.toolCallId,
  };
  const todos = (event.input as Record<string, unknown> | undefined)?.todos;
  if (ACTIVITY_TODO_TOOLS.has(lower) && Array.isArray(todos)) {
    args.todos = todos.slice(0, 100);
  } else {
    args.tool_input = capActivityInput(event.input);
  }
  return args;
}

/**
 * Fire-and-forget activity report. Never blocks or throws — callMcpTool swallows all
 * errors + returns null, so a `void reportActivity(event)` is safe (no unhandled
 * rejection) and adds no latency to the tool call.
 */
export async function reportActivity(event: ToolCallEvent): Promise<void> {
  await callMcpTool('activity:report', buildActivityArgs(event));
}

/**
 * Report a session LIFECYCLE transition (kind='lifecycle') into the activity bridge —
 * the OMP counterpart of the Claude/Codex SessionStart/Stop lifecycle hook. Gives the
 * fleet view a crisp "worker appeared / left" marker rather than inferring it from
 * activity silence. Fire-and-forget; callMcpTool fails open when detached.
 */
export async function reportLifecycle(phase: 'start' | 'shutdown'): Promise<void> {
  await callMcpTool('activity:report', {
    owner: hookOwnerId(),
    agent: 'omp',
    kind: 'lifecycle',
    summary: phase === 'start' ? '▶ session started' : '■ session ended',
  });
}

export async function onToolCall(
  event: ToolCallEvent,
): Promise<{ block?: boolean; reason?: string }> {
  const blockedTaskTools = new Set(['task', 'taskcreate', 'taskupdate', 'taskget', 'tasklist']);
  if (blockedTaskTools.has(event.toolName.toLowerCase())) {
    return {
      block: true,
      reason:
        'Do not use Claude task-panel or subagent Task tools in OMP. Use todo_write for task tracking instead.',
    };
  }

  // Native-scheduler lockout (native-scheduler-lockout-2026-06-09 P-010): an
  // AGENT session must schedule wakes ONLY via the harness routines table
  // (hive:declare-wake) — never a persistent OS scheduler, which outlives the
  // hive as a zombie that Pause/`hive:status`/the liveness backstop can't see.
  // omp has no first-class scheduler tool (toolset audit 2026-06-09), so its
  // whole exposure is the shell — deny at command position (start / after
  // ;&|/newline / sudo) so prose args ("look at this") never false-positive.
  // Gated on the agent-session marker env: the owner's own sessions never set
  // it (D-003) and stay fully unrestricted. Local decision, no operator call.
  if (
    process.env.PAPERCUSP_AGENT_SESSION === '1' &&
    event.toolName.toLowerCase().startsWith('bash')
  ) {
    const cmd = typeof event.input?.command === 'string' ? (event.input.command as string) : '';
    if (OS_SCHEDULER_CMD_RE.test(cmd)) {
      return {
        block: true,
        reason:
          'native-scheduler lockout: agent sessions must not create OS schedules ' +
          '(crontab / at / batch / systemd-run). Declare your wake via ' +
          'hive:declare-wake instead — the routines table is the only scheduler ' +
          'the hive’s pause/status/liveness machinery can see.',
      };
    }
  }

  // Mirror this non-blocked tool call into the cross-CLI activity bridge (the pui
  // fleet view + curator). Fire-and-forget so it never delays the edit/lock path.
  void reportActivity(event);

  const targets = extractLockTargets(event.toolName, event.input);
  if (targets.length === 0) return {};

  // Symlink refusal (file-locking #1) — runs BEFORE the acquire. The
  // operator keys locks on the path string and cannot see that two
  // strings alias one file; the hook, running on the agent's
  // filesystem, can. Detection is grouped by worktree root: a key is
  // relative to its own root, so realpath-ing it needs that root (a
  // single tool call may, in principle, span more than one worktree).
  // A local decision: no operator round-trip, so no health marker (like
  // the targets.length === 0 short-circuit above).
  const byRoot = new Map<string, string[]>();
  for (const t of targets) {
    const rels = byRoot.get(t.root);
    if (rels) rels.push(t.rel);
    else byRoot.set(t.root, [t.rel]);
  }
  const symlinked: Array<{ given: string; real: string }> = [];
  for (const [root, rels] of byRoot) {
    symlinked.push(...detectSymlinkedPaths(rels, root));
  }
  if (symlinked.length > 0) {
    return { block: true, reason: formatSymlinkRefusal(symlinked) };
  }

  // Lock keys are worktree-relative, so the same file claimed through
  // two worktrees collapses to one key — dedupe, preserving order.
  const seen = new Set<string>();
  const paths = targets
    .map((t) => t.rel)
    .filter((x) => !(seen.has(x) || seen.add(x)));

  const result = await callMcpTool('locks:acquire', {
    paths,
    intent: `tool_call:${event.toolName}`,
    ttl_sec: 1200,
    wait: { max_sec: 0 },
  });

  if (result == null) {
    // Operator unreachable or call errored — fail open. Cooperative
    // discipline only works when the system is up; blocking edits
    // would wedge the agent. The persisted marker (file-locking #3)
    // lets the operator UI surface "enforcement offline."
    console.error(
      '[su-locks] locks:acquire unreachable; allowing tool_call (fail-open)',
    );
    await recordHookError({
      handler: 'tool_call',
      phase: 'connect',
      detail: 'locks:acquire returned null (operator unreachable)',
    });
    return {};
  }

  const r = result as {
    ok?: boolean;
    lock_id?: string;
    busy?: BusyEntry[];
    reason?: string;
  };
  // Reaching here means the operator answered — a successful hook
  // call, whether the answer was ok or busy.
  if (r.ok === true && typeof r.lock_id === 'string') {
    acquiredLocks.set(event.toolCallId, r.lock_id);
    await recordHookSuccess();
    return {};
  }
  await recordHookSuccess();
  const reason =
    r.busy && r.busy.length > 0
      ? formatBusyRefusal(r.busy)
      : r.reason ?? 'locks: refused (unknown reason)';
  return { block: true, reason };
}

export async function onToolResult(event: ToolResultEvent): Promise<void> {
  const lockId = acquiredLocks.get(event.toolCallId);
  if (lockId === undefined) return;
  acquiredLocks.delete(event.toolCallId);
  // Best-effort release. Missed releases are covered by the lock's
  // TTL (1200s) so a network blip does NOT leak a lock permanently.
  await callMcpTool('locks:release', { lock_id: lockId });
}

/** Test-only: reset the in-memory lock cache between cases. */
export function _resetToolCallCacheForTests(): void {
  acquiredLocks.clear();
}

// ── OMP adapter (registration) ───────────────────────────────────────

/**
 * Best-effort wrapper that swallows handler errors. A hook handler
 * must never crash the OMP session.
 */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/**
 * Narrow shape of the OMP HookAPI we depend on. The real interface
 * lives at `@oh-my-pi/pi-coding-agent/src/extensibility/hooks/types.ts`
 * (HookAPI). We don't import it because this file ships standalone
 * to OMP — it has no dev-dependency on @oh-my-pi/pi-coding-agent.
 *
 * Verified 2026-05-20 against the installed version: turn_start
 * handlers receive `TurnStartEvent` and their return value is
 * DISCARDED — to inject context, call `pi.sendMessage()` from inside
 * the handler. tool_call handlers may return ToolCallEventResult
 * ({ block?, reason? }) to block. session_start handlers' return
 * values are also discarded.
 */
type SessionStartHandler = (event: { type: 'session_start' }, ctx: unknown) => unknown;
type SessionShutdownHandler = (event: { type: 'session_shutdown' }, ctx: unknown) => unknown;
type TurnStartHandler = (event: { type: 'turn_start'; turnIndex: number; timestamp: number }, ctx: unknown) => unknown;
type TurnEndHandler = (event: { type: 'turn_end' }, ctx: unknown) => unknown;
type ToolCallHandler = (
  event: ToolCallEvent,
  ctx: unknown,
) => Promise<{ block?: boolean; reason?: string } | void> | { block?: boolean; reason?: string } | void;
type ToolResultHandler = (
  event: ToolResultEvent,
  ctx: unknown,
) => Promise<void> | void;

interface HookApi {
  on(event: 'session_start', handler: SessionStartHandler): void;
  on(event: 'session_shutdown', handler: SessionShutdownHandler): void;
  on(event: 'turn_start', handler: TurnStartHandler): void;
  on(event: 'turn_end', handler: TurnEndHandler): void;
  on(event: 'tool_call', handler: ToolCallHandler): void;
  on(event: 'tool_result', handler: ToolResultHandler): void;
  sendMessage(
    message: {
      customType: string;
      content: string | Array<{ type: 'text'; text: string }>;
      display?: boolean;
      attribution?: 'user' | 'agent';
    },
    options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' },
  ): void;
}

export default function register(pi: HookApi): void {
  pi.on('session_start', async (_event, ctx) => {
    await safe(() => onSessionStart(ctx), undefined);
  });

  pi.on('turn_start', async (_event, ctx) => {
    const { reminder, degraded } = await safe(() => onTurnStart(ctx), {
      reminder: '',
      degraded: true,
      mode: 'attached' as CoordMode,
    });
    if (reminder.length > 0) {
      // OMP `turn_start` discards the handler's return value, so we
      // inject via sendMessage. attribution='agent' so the message is
      // not billed to the user; display=false because the reminder is
      // for the model, not the human (the /coord UI surfaces it for
      // humans).
      pi.sendMessage({
        customType: 'coord-reminder',
        content: reminder,
        display: false,
        attribution: 'agent',
      });
    }
    if (degraded) {
      // Silent-failure surfacing (plan §7.4). `degraded` is the
      // TRANSIENT case — the operator probe succeeded (it is reachable)
      // but a specific coordination call errored this turn. A truly
      // unreachable operator is the separate DETACHED path, whose
      // header the reminder already carries. Two markers:
      //  1. To the model — a reliable sendMessage note.
      //  2. To the human — a best-effort OMP TUI notification. The ctx
      //     shape is accessed defensively; if the API differs the
      //     marker simply no-ops (consistent with the hook's
      //     never-crash-the-session philosophy).
      pi.sendMessage({
        customType: 'coord-reminder',
        content:
          '<system-reminder type="coord">A coordination call failed this turn (operator reachable, but the call errored). Held locks, inbox, and changed-plans may be stale — re-check before relying on them.</system-reminder>',
        display: false,
        attribution: 'agent',
      });
      const c = ctx as
        | { hasUI?: boolean; ui?: { notify?: (m: string, t?: string) => void } }
        | undefined;
      if (c?.hasUI && typeof c.ui?.notify === 'function') {
        c.ui.notify(
          'Papercusp coordination call failed this turn (will retry next turn)',
          'warning',
        );
      }
    }
  });

  pi.on('turn_end', async () => {
    await safe(() => onTurnEnd(), undefined);
  });

  pi.on('tool_call', async (event) => {
    return safe(() => onToolCall(event), {});
  });

  pi.on('tool_result', async (event) => {
    // 1. Release the lock acquired for this tool (existing behavior).
    await safe(() => onToolResult(event), undefined);
    // 2. Mid-turn coord delivery — surface messages that arrived since turn
    //    start / the last tool call. `deliverAs: 'steer'` injects into the
    //    running turn (vs only at the next turn_start). Parity with the
    //    Claude/Codex PostToolUse coord hook.
    const { reminder } = await safe(() => pollInboxDelta(), { reminder: '' });
    if (reminder.length > 0) {
      pi.sendMessage(
        { customType: 'coord-reminder', content: reminder, display: false, attribution: 'agent' },
        { deliverAs: 'steer' },
      );
    }
  });

  pi.on('session_shutdown', async () => {
    await safe(() => onSessionShutdown(), undefined);
  });
}

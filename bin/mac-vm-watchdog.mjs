#!/usr/bin/env node
/**
 * mac-vm-watchdog.mjs — tower-side health watchdog for the rig macOS VM
 * (papercusp-vm-mac.service), with a guarded COLD-restart remedy.
 * WI-10002582 / EI-24019740313758959.
 *
 * Why this exists: at 2026-09-23 02:49Z the guest panicked into a firmware
 * reset loop (QMP RESET about once a second). mac-vm-health.sh classified that
 * state as `booting` (QMP answered, SSH did not) and exited 0, so nothing
 * noticed for 10+ minutes while the P-203 fold sat dead.
 *
 * Signals (one run takes ~10s):
 *   - systemd: ActiveState, a pending Job, time since activation (boot grace).
 *   - QMP: query-status plus a count of events over a short window
 *     (qmp-command.py status-events). >= resetLoopMin RESETs = reset loop.
 *   - guest liveness: ping, then the neighbour (ARP) state of the guest IP on
 *     the bridge. NOT ssh :2222: that is a slirp hostfwd, which accepts TCP
 *     even while the guest is dead.
 *   - optional fold-cursor staleness (ssh into the guest). Alert-only.
 *
 * Remedy: alert first. On a sustained restart-class verdict, a COLD restart:
 *   QMP `quit`, wait for qemu to exit, `systemctl --user start <unit>`.
 *   Never QMP system_reset: a warm reset re-enters the firmware loop.
 *
 * Guards: at most one cold restart per hour (a floor, not configurable below);
 *   a hold file for rig operations in flight (`hold` / `release` below); a
 *   pending systemd job or a contended QMP slot means another actor is
 *   operating the VM, so the run is skipped outright.
 *
 * CLI:
 *   mac-vm-watchdog.mjs [--dry-run] [--json]   one check, remedy unless --dry-run
 *   mac-vm-watchdog.mjs hold --for SEC --by WHO --reason TEXT
 *   mac-vm-watchdog.mjs release
 *   mac-vm-watchdog.mjs status
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const RESTART_MIN_INTERVAL_FLOOR_SEC = 3600;
export const MAX_HOLD_SEC = 24 * 3600;
/** QMP run states that cannot recover on their own; `paused` and friends are usually deliberate. */
export const FATAL_RUN_STATES = new Set(['internal-error', 'guest-panicked', 'io-error', 'shutdown']);
const ACTIONS_LOG_MAX_BYTES = 5 * 1024 * 1024;
const RUN_LOCK_STALE_SEC = 900;
// HARNESS_ADMIN_DATABASE_URL is the key the tower operator (papercup-dev-api) actually carries;
// measured 2026-09-23 — without it the /proc fallback resolved nothing and every alert was skipped.
const DB_URL_KEYS = [
  'HARNESS_ADMIN_DATABASE_URL',
  'PAPERCUSP_DATABASE_URL',
  'DATABASE_URL',
  'HARNESS_ADMIN_URL',
  'PAPERCUSP_HARNESS_ADMIN_URL',
];

function numEnv(env, key, dflt, min = 0) {
  const raw = env[key];
  if (raw === undefined || raw === '') return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`${key} must be a number >= ${min} (got ${JSON.stringify(raw)})`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const home = env.HOME || os.homedir();
  const qmpSock = env.MAC_VM_QMP_SOCK || path.join(home, 'macos-vm/OSX-KVM/qmp.sock');
  const stateDir = env.MAC_VM_WATCHDOG_STATE_DIR || path.join(home, '.papercusp/mac-vm-watchdog');
  const sshHost = env.MAC_VM_SSH_HOST || 'aviweiss@127.0.0.1';
  const sshPort = String(env.MAC_VM_SSH_PORT || '2222');
  const remedy = env.MAC_VM_WATCHDOG_REMEDY || 'cold-restart';
  if (remedy !== 'cold-restart' && remedy !== 'alert-only') {
    throw new Error(`MAC_VM_WATCHDOG_REMEDY must be cold-restart or alert-only (got ${JSON.stringify(remedy)})`);
  }
  return {
    unit: env.MAC_VM_WATCHDOG_UNIT || 'papercusp-vm-mac.service',
    qmpSock,
    qmpHelper: env.MAC_VM_QMP_HELPER || path.join(HERE, 'qmp-command.py'),
    qemuPidfile: env.MAC_VM_QEMU_PIDFILE || path.join(path.dirname(qmpSock), 'qemu.pid'),
    guestIp: env.MAC_VM_WATCHDOG_GUEST_IP || '172.31.44.2',
    guestDev: env.MAC_VM_WATCHDOG_GUEST_DEV || 'macbr0',
    eventWindowSec: numEnv(env, 'MAC_VM_WATCHDOG_EVENT_WINDOW_SEC', 5, 1),
    resetLoopMin: numEnv(env, 'MAC_VM_WATCHDOG_RESET_LOOP_MIN', 3, 1),
    resetStreak: numEnv(env, 'MAC_VM_WATCHDOG_RESET_STREAK', 2, 1),
    unreachableStreak: numEnv(env, 'MAC_VM_WATCHDOG_UNREACHABLE_STREAK', 3, 1),
    bootGraceSec: numEnv(env, 'MAC_VM_WATCHDOG_BOOT_GRACE_SEC', 600),
    // The brief's hard guard: at most one cold restart per hour. Env may only raise it.
    restartMinIntervalSec: Math.max(
      RESTART_MIN_INTERVAL_FLOOR_SEC,
      numEnv(env, 'MAC_VM_WATCHDOG_RESTART_MIN_INTERVAL_SEC', RESTART_MIN_INTERVAL_FLOOR_SEC),
    ),
    alertRepeatSec: numEnv(env, 'MAC_VM_WATCHDOG_ALERT_REPEAT_SEC', 1800, 60),
    quitWaitSec: numEnv(env, 'MAC_VM_WATCHDOG_QUIT_WAIT_SEC', 30, 1),
    remedy,
    stateDir,
    holdFile: env.MAC_VM_WATCHDOG_HOLD_FILE || path.join(stateDir, 'hold.json'),
    leaseResource: env.MAC_VM_WATCHDOG_LEASE_RESOURCE || `mac-test-vm:${sshHost}:${sshPort}`,
    cursorPrefix: env.MAC_VM_WATCHDOG_CURSOR_PREFIX || '',
    cursorStaleSec: numEnv(env, 'MAC_VM_WATCHDOG_CURSOR_STALE_SEC', 1800, 60),
    cursorRemoteCmd: env.MAC_VM_WATCHDOG_CURSOR_REMOTE_CMD
      || '"/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node" ~/.papercusp/vm-rig/p203-cursec.mjs',
    sshHost,
    sshPort,
    sshKey: env.MAC_VM_SSH_KEY || path.join(home, '.ssh/papercup-vm-mac'),
    alertTo: (env.MAC_VM_WATCHDOG_ALERT_TO || '*').split(',').map((s) => s.trim()).filter(Boolean),
    workspace: env.MAC_VM_WATCHDOG_WORKSPACE || 'papercusp-workspace',
    dbUrl: env.MAC_VM_WATCHDOG_DB_URL || DB_URL_KEYS.map((k) => env[k]).find(Boolean) || '',
    operatorUnit: env.MAC_VM_WATCHDOG_OPERATOR_UNIT || 'papercup-dev-api.service',
    host: env.MAC_VM_WATCHDOG_HOST_LABEL || os.hostname(),
  };
}

// ── pure parsers ──────────────────────────────────────────────────────────

export function parseSystemdShow(text) {
  const out = {};
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

export function parseNeighStates(jsonText) {
  try {
    const rows = JSON.parse(jsonText || '[]');
    return Array.isArray(rows) ? rows.flatMap((r) => (Array.isArray(r?.state) ? r.state : [])) : [];
  } catch {
    return [];
  }
}

/** Parse p203-cursec.mjs output: `<nowISO> <harness> <key> position=N updated=<ISO> ...`. */
export function parseCursorProbe(text) {
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^(\S+)\s+\S+\s+\S+\s+position=(\d+)\s+updated=(\S+)/);
    if (m) {
      const probeNow = Date.parse(m[1]);
      const updated = Date.parse(m[3]);
      if (Number.isFinite(probeNow) && Number.isFinite(updated)) {
        // Both timestamps come from the guest, so clock skew with the tower cannot fake staleness.
        return { ok: true, position: Number(m[2]), ageSec: Math.max(0, Math.round((probeNow - updated) / 1000)) };
      }
    }
    const none = line.match(/^\S+\s+NO ROW for\s+(\S+)/);
    if (none) return { ok: false, error: `no cursor row for ${none[1]}` };
  }
  return { ok: false, error: 'unparseable cursor probe output' };
}

export function activeHold(hold, nowSec) {
  if (!hold || typeof hold.until !== 'number' || hold.until <= nowSec) return null;
  return hold;
}

const iso = (sec) => new Date(sec * 1000).toISOString();
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const tail = (s, n = 300) => String(s || '').trim().slice(-n);

// ── classification (pure) ─────────────────────────────────────────────────
// kind: ok | grace | skip | alert | restart. Only `restart` can lead to a cold
// restart, and only after `streakNeeded` consecutive checks.

export function classify(s, cfg) {
  const resets = s.qmp?.events?.RESET ?? 0;
  if (s.service.job) {
    return { verdict: 'op-in-flight', kind: 'skip', detail: `systemd job ${s.service.job} is pending on ${cfg.unit}` };
  }
  if (!s.service.active) {
    return {
      verdict: 'service-inactive',
      kind: 'alert',
      detail: `${cfg.unit} is ${s.service.activeState}; not starting a unit someone stopped (systemd Restart= owns crash restarts)`,
    };
  }
  if (s.qmp.contended) {
    return { verdict: 'op-in-flight', kind: 'skip', detail: 'another client holds the single-client QMP slot' };
  }
  if (!s.qmp.ok) {
    return {
      verdict: 'qmp-unresponsive',
      kind: 'alert',
      detail: `QMP probe failed (${tail(s.qmp.error, 160)}); a cold restart needs QMP quit, so this needs a human`,
    };
  }
  if (resets >= cfg.resetLoopMin) {
    return {
      verdict: 'reset-loop',
      kind: 'restart',
      streakNeeded: cfg.resetStreak,
      detail: `${resets} QMP RESET events in ${s.qmp.windowSec ?? cfg.eventWindowSec}s: firmware reset loop`,
    };
  }
  if (FATAL_RUN_STATES.has(s.qmp.status)) {
    return {
      verdict: 'vm-fatal-state',
      kind: 'restart',
      streakNeeded: cfg.resetStreak,
      detail: `QMP run state is ${s.qmp.status}`,
    };
  }
  if (!s.qmp.running) {
    return {
      verdict: 'vm-not-running',
      kind: 'alert',
      detail: `QMP run state is ${s.qmp.status}; not restarting, a paused VM is usually deliberate`,
    };
  }
  if (!s.guest.alive) {
    const age = s.service.activeAgeSec;
    if (age !== null && age !== undefined && age < cfg.bootGraceSec) {
      return {
        verdict: 'booting',
        kind: 'grace',
        detail: `guest ${cfg.guestIp} not answering yet; unit active ${age}s (< boot grace ${cfg.bootGraceSec}s)`,
      };
    }
    return {
      verdict: 'guest-unreachable',
      kind: 'restart',
      streakNeeded: cfg.unreachableStreak,
      detail: `guest ${cfg.guestIp} on ${cfg.guestDev} answers neither ping nor ARP (neigh ${s.guest.neighStates.join('/') || 'none'}) while QMP reports running`,
    };
  }
  if (s.cursor?.ok && s.cursor.ageSec > cfg.cursorStaleSec) {
    return {
      verdict: 'cursor-stale',
      kind: 'alert',
      detail: `fold cursor ${cfg.cursorPrefix} has not advanced for ${s.cursor.ageSec}s (> ${cfg.cursorStaleSec}s) at position ${s.cursor.position}; the VM itself is up, so alert only`,
    };
  }
  const cursorNote = s.cursor && !s.cursor.ok && !s.cursor.skipped ? `; cursor probe failed: ${tail(s.cursor.error, 120)}` : '';
  return { verdict: 'healthy', kind: 'ok', detail: `QMP running, ${resets} RESETs in window, guest answers${cursorNote}` };
}

// ── decision (pure) ───────────────────────────────────────────────────────

export function decide(cls, prev, cfg, nowSec, hold) {
  const state = { ...prev, lastCheckAt: nowSec, lastVerdict: cls.verdict };
  const actions = [];
  // Another actor is operating the VM, or it is booting: record the check and nothing else.
  if (cls.kind === 'skip' || cls.kind === 'grace') return { actions, state };

  if (cls.kind === 'ok') {
    if (prev.condition) {
      actions.push({
        type: 'alert',
        category: 'severe-event-resolved',
        summary: `recovered: ${cls.detail} (was ${prev.condition} since ${iso(prev.conditionSince ?? nowSec)})`,
      });
    }
    Object.assign(state, { condition: null, streak: 0, conditionSince: null, lastAlertAt: null, blocked: null });
    return { actions, state };
  }

  const same = prev.condition === cls.verdict;
  state.condition = cls.verdict;
  state.streak = same ? (prev.streak || 0) + 1 : 1;
  state.conditionSince = same && prev.conditionSince ? prev.conditionSince : nowSec;

  let blocked = null;
  let restart = false;
  if (cls.kind === 'restart' && state.streak >= cls.streakNeeded) {
    if (cfg.remedy !== 'cold-restart') {
      blocked = { kind: 'alert-only', text: 'the remedy is set to alert-only (MAC_VM_WATCHDOG_REMEDY)' };
    } else if (hold) {
      blocked = {
        kind: hold.kind || 'hold',
        text: hold.text || `a rig operation holds the VM: ${hold.by} until ${iso(hold.until)} (${hold.reason})`,
      };
    } else if (prev.lastRestartAt && nowSec - prev.lastRestartAt < cfg.restartMinIntervalSec) {
      blocked = {
        kind: 'rate-limit',
        text: `the last cold restart was ${nowSec - prev.lastRestartAt}s ago and at most one runs per ${cfg.restartMinIntervalSec}s, so this needs a human`,
      };
    } else {
      restart = true;
    }
  }

  const alertDue = !same
    || !prev.lastAlertAt
    || nowSec - prev.lastAlertAt >= cfg.alertRepeatSec
    || (blocked?.kind ?? null) !== (prev.blocked ?? null);

  if (restart) {
    actions.push({
      type: 'alert',
      category: 'severe-event',
      summary: `${cls.verdict}: ${cls.detail}. Cold-restarting ${cfg.unit} now (QMP quit, then systemctl start; never system_reset).`,
    });
    actions.push({ type: 'cold-restart', verdict: cls.verdict });
    state.lastRestartAt = nowSec;
    state.lastAlertAt = nowSec;
  } else if (alertDue) {
    let next;
    if (cls.kind !== 'restart') next = 'No automatic remedy for this verdict';
    else if (blocked) next = `Cold restart withheld: ${blocked.text}`;
    else next = `A cold restart follows after ${cls.streakNeeded} consecutive failing checks (now ${state.streak})`;
    actions.push({ type: 'alert', category: 'severe-event', summary: `${cls.verdict}: ${cls.detail}. ${next}.` });
    state.lastAlertAt = nowSec;
  }
  state.blocked = blocked?.kind ?? null;
  return { actions, state };
}

// ── side effects (injected deps) ──────────────────────────────────────────

export async function collectSignals(cfg, deps) {
  const show = await deps.exec('systemctl', [
    '--user', 'show', cfg.unit,
    '-p', 'ActiveState', '-p', 'SubState', '-p', 'Job', '-p', 'MainPID', '-p', 'ActiveEnterTimestampMonotonic',
  ], { timeoutMs: 10_000 });
  const props = parseSystemdShow(show.stdout);
  const enteredUs = Number(props.ActiveEnterTimestampMonotonic || 0);
  const nowUs = deps.monotonicUs();
  const service = {
    activeState: props.ActiveState || 'unknown',
    active: props.ActiveState === 'active',
    job: props.Job && props.Job !== '0' ? props.Job : '',
    mainPid: Number(props.MainPID || 0) || 0,
    // systemd's *Monotonic stamps are CLOCK_MONOTONIC microseconds, the same clock as process.hrtime.
    activeAgeSec: enteredUs > 0 && nowUs >= enteredUs ? Math.round((nowUs - enteredUs) / 1e6) : null,
    probeError: show.code === 0 ? null : tail(show.stderr || `systemctl exit ${show.code}`),
  };

  let qmp = { ok: false, skipped: true, error: 'service is not active' };
  if (service.active && !service.job) {
    const r = await deps.exec('python3', [cfg.qmpHelper, cfg.qmpSock, 'status-events', String(cfg.eventWindowSec)], {
      timeoutMs: (cfg.eventWindowSec + 15) * 1000,
    });
    if (r.code === 0) {
      try {
        const j = JSON.parse(String(r.stdout).trim().split('\n').pop());
        qmp = { ok: true, status: j.status, running: j.running === true, events: j.events || {}, windowSec: j.window_sec };
      } catch (e) {
        qmp = { ok: false, error: `unparseable status-events output: ${e.message}` };
      }
    } else if (r.code === 75) {
      qmp = { ok: false, contended: true, error: tail(r.stderr) };
    } else {
      qmp = { ok: false, error: tail(r.stderr || `qmp-command exit ${r.code}`) };
    }
  }

  const ping = await deps.exec('ping', ['-c', '2', '-W', '1', '-q', cfg.guestIp], { timeoutMs: 8_000 });
  const neigh = await deps.exec('ip', ['-j', 'neigh', 'show', cfg.guestIp, 'dev', cfg.guestDev], { timeoutMs: 5_000 });
  const neighStates = parseNeighStates(neigh.stdout);
  const guest = { pingOk: ping.code === 0, neighStates, alive: ping.code === 0 || neighStates.includes('REACHABLE') };

  let cursor = { skipped: true };
  if (cfg.cursorPrefix && guest.alive && qmp.ok && qmp.running) {
    const r = await deps.exec('ssh', [
      '-i', cfg.sshKey, '-p', cfg.sshPort,
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=5',
      cfg.sshHost, `${cfg.cursorRemoteCmd} ${shellQuote(cfg.cursorPrefix)}`,
    ], { timeoutMs: 45_000 });
    cursor = r.code === 0 ? parseCursorProbe(r.stdout) : { ok: false, error: tail(r.stderr || `ssh exit ${r.code}`) };
  }
  return { service, qmp, guest, cursor };
}

async function waitUntil(deps, seconds, predicate) {
  const deadline = deps.nowMs() + seconds * 1000;
  for (;;) {
    if (await predicate()) return true;
    if (deps.nowMs() >= deadline) return false;
    await deps.sleep(1000);
  }
}

function readPidfile(file) {
  try {
    const pid = Number(fs.readFileSync(file, 'utf8').trim().split('\n')[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

/** QMP quit, wait for qemu to exit, then systemctl start. Never system_reset. */
export async function coldRestart(cfg, deps, signals) {
  const nowSec = Math.floor(deps.nowMs() / 1000);
  const manualHold = activeHold(readJson(cfg.holdFile), nowSec);
  if (manualHold) {
    return {
      ok: false,
      blocked: true,
      blockKind: 'hold',
      step: 'hold-check',
      detail: `a rig operation holds the VM: ${manualHold.by} until ${iso(manualHold.until)} (${manualHold.reason})`,
    };
  }

  const resourceLease = await readExclusiveVmLease(cfg, deps);
  const leaseHold = leaseHoldForDecision(resourceLease, cfg);
  if (leaseHold) {
    return {
      ok: false,
      blocked: true,
      blockKind: leaseHold.kind || 'hold',
      step: 'lease-check',
      detail: leaseHold.text || `exclusive resource lock ${cfg.leaseResource} is held by ${resourceLease.owner} until ${iso(resourceLease.expiresAtSec)} (${resourceLease.reason || 'no reason supplied'})`,
      resourceLease,
    };
  }

  const steps = [];
  const oldPid = signals.service.mainPid || readPidfile(cfg.qemuPidfile);
  const quit = await deps.exec('python3', [cfg.qmpHelper, cfg.qmpSock, 'quit'], { timeoutMs: 15_000 });
  steps.push({ step: 'qmp-quit', code: quit.code });
  if (quit.code !== 0) return { ok: false, step: 'qmp-quit', detail: tail(quit.stderr), steps };

  if (oldPid > 0) {
    const exited = await waitUntil(deps, cfg.quitWaitSec, () => !deps.pidAlive(oldPid));
    steps.push({ step: 'wait-qemu-exit', pid: oldPid, exited });
    if (!exited) {
      return { ok: false, step: 'wait-qemu-exit', detail: `qemu pid ${oldPid} still alive ${cfg.quitWaitSec}s after QMP quit`, steps };
    }
  }

  // Let systemd finish the stop transition (ExecStop fails fast once the socket is gone).
  let after = {};
  const settled = await waitUntil(deps, 60, async () => {
    const r = await deps.exec('systemctl', ['--user', 'show', cfg.unit, '-p', 'ActiveState', '-p', 'MainPID'], { timeoutMs: 10_000 });
    after = parseSystemdShow(r.stdout);
    return after.ActiveState !== 'deactivating' && !(after.ActiveState === 'active' && Number(after.MainPID) === oldPid);
  });
  steps.push({ step: 'settle', activeState: after.ActiveState ?? 'unknown', settled });

  const start = await deps.exec('systemctl', ['--user', 'start', cfg.unit], { timeoutMs: 180_000 });
  steps.push({ step: 'systemctl-start', code: start.code });
  if (start.code !== 0) return { ok: false, step: 'systemctl-start', detail: tail(start.stderr), steps };
  return { ok: true, steps };
}

export async function resolveDbUrl(cfg, deps) {
  if (cfg.dbUrl) return cfg.dbUrl;
  const r = await deps.exec('systemctl', ['--user', 'show', cfg.operatorUnit, '-p', 'MainPID', '--value'], { timeoutMs: 10_000 });
  const pid = Number(String(r.stdout).trim());
  if (!Number.isInteger(pid) || pid <= 0) return '';
  const envText = deps.readProcEnviron(pid);
  for (const key of DB_URL_KEYS) {
    const hit = envText.split('\0').find((kv) => kv.startsWith(`${key}=`));
    if (hit) return hit.slice(key.length + 1);
  }
  return '';
}

/** Match @papercusp/locks' suUrl(): named-resource leases live in the
 * papercusp_su side-database, while coord alerts use the main admin database. */
export async function resolveSuDbUrl(cfg, deps) {
  const main = await resolveDbUrl(cfg, deps);
  return main ? main.replace(/\/[^/?]+(\?|$)/, '/papercusp_su$1') : '';
}

/** Read the live exclusive Mac VM lease. This daemon runs outside MCP, so it
 * uses the same PostgreSQL connection as its direct coord-alert path. Scan all
 * coordination domains: locks:list does the same because a resource can be
 * held from different operator checkout domains. */
export async function readExclusiveVmLease(cfg, deps) {
  const url = await resolveSuDbUrl(cfg, deps);
  if (!url) return { status: 'unknown', reason: 'no database URL resolvable' };

  const sql = `
SELECT json_build_object(
  'owner', COALESCE(owner_label, owner),
  'reason', reason,
  'expiresAtSec', ceil(extract(epoch FROM expires_ts))::bigint
)::text
  FROM agent_resource_locks
 WHERE resource = :'resource'
   AND mode = 'exclusive'
   AND status IN ('held', 'draining')
   AND expires_ts > clock_timestamp()
 ORDER BY expires_ts DESC
 LIMIT 1
`;
  let result;
  try {
    result = await deps.exec('psql', [
      url, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', `resource=${cfg.leaseResource}`, '-f', '-',
    ], { stdin: sql, timeoutMs: 10_000 });
  } catch (error) {
    return { status: 'unknown', reason: tail(error?.message || error, 200) };
  }
  if (result.code !== 0) {
    return { status: 'unknown', reason: tail(result.stderr || `psql exit ${result.code}`, 200) };
  }

  const output = String(result.stdout || '').trim();
  if (!output) return { status: 'clear' };
  try {
    const row = JSON.parse(output.split(/\r?\n/, 1)[0]);
    const expiresAtSec = Number(row?.expiresAtSec);
    if (!row || typeof row.owner !== 'string' || !Number.isFinite(expiresAtSec)) {
      return { status: 'unknown', reason: 'resource lock query returned an invalid row' };
    }
    return {
      status: 'held',
      owner: row.owner,
      reason: typeof row.reason === 'string' ? row.reason : '',
      expiresAtSec,
    };
  } catch {
    return { status: 'unknown', reason: 'resource lock query returned invalid JSON' };
  }
}

function leaseHoldForDecision(lease, cfg) {
  if (lease.status === 'held') {
    return {
      by: lease.owner,
      until: lease.expiresAtSec,
      reason: `exclusive ${cfg.leaseResource} lease${lease.reason ? `: ${lease.reason}` : ''}`,
    };
  }
  if (lease.status === 'unknown') {
    return {
      kind: 'lease-check-failed',
      text: `cannot verify whether ${cfg.leaseResource} has an active exclusive lease: ${lease.reason}`,
    };
  }
  return null;
}

/** Coord alert via a direct coord_event_log insert (the bghost-watchdog pattern): works with the operator down. */
export async function sendAlert(cfg, deps, action) {
  const url = await resolveDbUrl(cfg, deps);
  if (!url) {
    deps.log('mac-vm-watchdog: alert SKIPPED, no database URL resolvable');
    return false;
  }
  const condition = `mac-vm:${cfg.host}:${cfg.unit}`;
  const msgId = `mac-vm-watchdog-${deps.nowMs()}-${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify({
    ts: new Date(deps.nowMs()).toISOString(),
    msg_id: msgId,
    from: 'mac-vm-watchdog',
    to: cfg.alertTo,
    audience: cfg.alertTo,
    kind: 'message',
    expects: 'none',
    auto: true,
    category: action.category,
    summary: `[mac-vm-watchdog ${cfg.host}] ${action.summary}`,
    condition_key: condition,
    ...(action.category === 'severe-event-resolved' ? { resolves_condition: condition } : {}),
    refs: ['EI-24019740313758959', 'WI-10002582'],
  });
  // SQL via stdin: psql does not interpolate -v variables inside -c (EI-9419).
  const sql = "INSERT INTO harness_shared.coord_event_log (id, workspace_id, surface, writer_key, msg_id, body) "
    + "VALUES (nextval('harness_shared.coord_event_log_id_seq'), :'ws', 'messages', 'mac-vm-watchdog', :'msgid', :'jsonbody'::jsonb)";
  const r = await deps.exec('psql', [
    url, '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-v', `ws=${cfg.workspace}`, '-v', `msgid=${msgId}`, '-v', `jsonbody=${body}`, '-f', '-',
  ], { stdin: sql, timeoutMs: 15_000 });
  if (r.code !== 0) {
    deps.log(`mac-vm-watchdog: alert FAILED (${tail(r.stderr, 200)})`);
    return false;
  }
  return true;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function appendActionLog(cfg, record) {
  const file = path.join(cfg.stateDir, 'actions.jsonl');
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  try {
    if (fs.statSync(file).size > ACTIONS_LOG_MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch { /* first write */ }
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
}

function takeRunLock(cfg, nowSec) {
  const file = path.join(cfg.stateDir, 'run.lock');
  fs.mkdirSync(cfg.stateDir, { recursive: true });
  try {
    fs.writeFileSync(file, `${process.pid} ${nowSec}\n`, { flag: 'wx' });
    return () => fs.rmSync(file, { force: true });
  } catch {
    const age = nowSec - Math.floor(fs.statSync(file).mtimeMs / 1000);
    if (age < RUN_LOCK_STALE_SEC) return null;
    fs.writeFileSync(file, `${process.pid} ${nowSec}\n`);
    return () => fs.rmSync(file, { force: true });
  }
}

export async function runOnce(cfg, deps, { dryRun = false } = {}) {
  const nowSec = Math.floor(deps.nowMs() / 1000);
  const statePath = path.join(cfg.stateDir, 'state.json');
  const release = dryRun ? () => {} : takeRunLock(cfg, nowSec);
  if (!release) return { skipped: 'another watchdog run holds run.lock' };
  try {
    const prev = readJson(statePath) || {};
    const hold = activeHold(readJson(cfg.holdFile), nowSec);
    const signals = await collectSignals(cfg, deps);
    const classification = classify(signals, cfg);
    const resourceLease = classification.kind === 'restart'
      ? await readExclusiveVmLease(cfg, deps)
      : { status: 'not-checked' };
    const resourceHold = leaseHoldForDecision(resourceLease, cfg);
    const { actions, state } = decide(classification, prev, cfg, nowSec, hold || resourceHold);
    const record = {
      at: iso(nowSec),
      verdict: classification.verdict,
      kind: classification.kind,
      detail: classification.detail,
      streak: state.streak ?? 0,
      hold: hold ? { by: hold.by, until: iso(hold.until), reason: hold.reason } : null,
      resourceLease,
      planned: actions.map((a) => a.type),
      dryRun,
    };
    if (dryRun) return { signals, classification, actions, state, record };

    // Persist BEFORE acting: a crash or timeout mid-restart still counts against the hourly limit.
    writeJsonAtomic(statePath, state);
    const results = [];
    for (const action of actions) {
      if (action.type === 'alert') {
        results.push({ type: 'alert', ok: await sendAlert(cfg, deps, action) });
      } else if (action.type === 'cold-restart') {
        const outcome = await coldRestart(cfg, deps, signals);
        results.push({ type: 'cold-restart', ...outcome });
        if (outcome.blocked) {
          state.lastRestartAt = prev.lastRestartAt;
          state.blocked = outcome.blockKind || 'hold';
          if (outcome.resourceLease) record.resourceLease = outcome.resourceLease;
          writeJsonAtomic(statePath, state);
        }
        const summary = outcome.blocked
          ? `cold restart of ${cfg.unit} withheld at ${outcome.step}: ${outcome.detail}`
          : outcome.ok
          ? `cold restart of ${cfg.unit} done (${action.verdict}); the guest is booting, next checks confirm recovery`
          : `cold restart of ${cfg.unit} FAILED at ${outcome.step}: ${outcome.detail}. Needs a human`;
        results.push({ type: 'alert', ok: await sendAlert(cfg, deps, { category: 'severe-event', summary }) });
      }
    }
    record.results = results;
    if (actions.length > 0 || prev.lastVerdict !== classification.verdict) appendActionLog(cfg, record);
    deps.log(`mac-vm-watchdog: ${JSON.stringify(record)}`);
    return { signals, classification, actions, state, record };
  } finally {
    release();
  }
}

export function realDeps() {
  return {
    exec: (cmd, args, { timeoutMs = 30_000, stdin } = {}) => new Promise((resolve) => {
      const child = execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
        let code = 0;
        if (err) code = typeof err.code === 'number' ? err.code : err.killed ? 124 : 127;
        resolve({ code, stdout: stdout || '', stderr: stderr || (err && typeof err.code !== 'number' ? String(err.message) : '') });
      });
      if (stdin !== undefined) child.stdin.end(stdin);
    }),
    nowMs: () => Date.now(),
    monotonicUs: () => Number(process.hrtime.bigint() / 1000n),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    pidAlive: (pid) => {
      try {
        return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('qemu-system');
      } catch {
        return false;
      }
    },
    readProcEnviron: (pid) => {
      try {
        return fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
      } catch {
        return '';
      }
    },
    log: (line) => console.log(line),
  };
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const cfg = loadConfig(env);
  const deps = realDeps();
  const nowSec = Math.floor(Date.now() / 1000);
  const [cmd] = argv;

  if (cmd === 'hold') {
    const forSec = Number(flagValue(argv, '--for'));
    const by = flagValue(argv, '--by');
    const reason = flagValue(argv, '--reason');
    if (!Number.isFinite(forSec) || forSec <= 0 || forSec > MAX_HOLD_SEC || !by || !reason) {
      console.error(`usage: mac-vm-watchdog.mjs hold --for SEC(1..${MAX_HOLD_SEC}) --by WHO --reason TEXT`);
      return 2;
    }
    const hold = { until: nowSec + Math.round(forSec), by, reason, setAt: nowSec };
    writeJsonAtomic(cfg.holdFile, hold);
    console.log(`mac-vm-watchdog: cold restarts held until ${iso(hold.until)} by ${by} (${reason})`);
    return 0;
  }
  if (cmd === 'release') {
    fs.rmSync(cfg.holdFile, { force: true });
    console.log('mac-vm-watchdog: hold released');
    return 0;
  }
  if (cmd === 'status') {
    console.log(JSON.stringify({
      state: readJson(path.join(cfg.stateDir, 'state.json')),
      hold: activeHold(readJson(cfg.holdFile), nowSec),
    }, null, 2));
    return 0;
  }

  const known = new Set(['--dry-run', '--json']);
  const unknown = argv.filter((a) => !known.has(a));
  if (unknown.length > 0) {
    console.error(`mac-vm-watchdog: unknown argument(s) ${unknown.join(' ')}`);
    return 2;
  }
  const out = await runOnce(cfg, deps, { dryRun: argv.includes('--dry-run') });
  if (argv.includes('--json')) console.log(JSON.stringify(out));
  else if (out.record) console.log(`mac-vm-watchdog: ${out.record.verdict} — ${out.record.detail} (planned: ${out.record.planned.join(',') || 'none'}${out.record.dryRun ? ', dry-run' : ''})`);
  else console.log(`mac-vm-watchdog: ${out.skipped}`);
  // A detected fault is a recorded verdict, not a watchdog failure: exit 0 keeps the timer unit green.
  return 0;
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (err) => {
    console.error(`mac-vm-watchdog: internal error: ${err?.stack || err}`);
    process.exitCode = 3;
  });
}

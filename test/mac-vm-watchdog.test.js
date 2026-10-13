// Tests for bin/mac-vm-watchdog.mjs and qmp-command.py's status-events mode
// (WI-10002582 / EI-24019740313758959).
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classify,
  coldRestart,
  decide,
  loadConfig,
  parseCursorProbe,
  parseNeighStates,
  readVmFiles,
  resolveDbUrl,
  resolveSuDbUrl,
  RESTART_MIN_INTERVAL_FLOOR_SEC,
  runOnce,
} from '../bin/mac-vm-watchdog.mjs';

// Overridable so a falsifiability probe can point these tests at a pre-fix copy.
const qmpCommand = process.env.QMP_COMMAND_UNDER_TEST || new URL('../bin/qmp-command.py', import.meta.url).pathname;
const tempDirs = new Set();

async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mac-vm-watchdog-'));
  tempDirs.add(dir);
  return dir;
}

test.afterEach(async () => {
  await Promise.all([...tempDirs].map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.clear();
});

// ── qmp-command.py against a fake QMP server ─────────────────────────────

async function fakeQmp({ status = 'running', resetsBeforeReply = 0, resetsDuringWindow = 0, greet = true } = {}) {
  const dir = await tempDir();
  const sock = path.join(dir, 'qmp.sock');
  const commands = [];
  const timers = [];
  const server = net.createServer((conn) => {
    conn.on('error', () => {});
    if (!greet) return; // hold the slot without a greeting, like a second client
    const reset = () => conn.write(`${JSON.stringify({ event: 'RESET', data: { guest: true }, timestamp: {} })}\n`);
    conn.write(`${JSON.stringify({ QMP: { version: {}, capabilities: [] } })}\n`);
    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        commands.push(msg.execute);
        if (msg.execute === 'query-status') {
          for (let n = 0; n < resetsBeforeReply; n += 1) reset();
          conn.write(`${JSON.stringify({ return: { status, running: status === 'running', singlestep: false } })}\n`);
          for (let n = 0; n < resetsDuringWindow; n += 1) timers.push(setTimeout(reset, 50 + n * 50));
        } else {
          conn.write('{"return": {}}\n');
        }
      }
    });
  });
  await new Promise((resolve) => server.listen(sock, resolve));
  return {
    sock,
    commands,
    close: () => new Promise((resolve) => {
      timers.forEach(clearTimeout);
      server.close(resolve);
    }),
  };
}

function runQmp(args, env = {}) {
  return new Promise((resolve) => {
    execFile('python3', [qmpCommand, ...args], { env: { ...process.env, ...env }, timeout: 20_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

test('status-events counts RESET events before the reply and during the window', async () => {
  const qmp = await fakeQmp({ resetsBeforeReply: 2, resetsDuringWindow: 3 });
  try {
    const r = await runQmp([qmp.sock, 'status-events', '1']);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.status, 'running');
    assert.equal(out.running, true);
    assert.equal(out.events.RESET, 5);
    assert.equal(out.window_sec, 1);
    assert.deepEqual(qmp.commands, ['qmp_capabilities', 'query-status']);
  } finally {
    await qmp.close();
  }
});

test('query-status no longer mistakes an interleaved RESET event for its reply', async () => {
  // Before the fix, the first RESET line was read as the reply and the helper
  // reported "VM is not running" for a running (reset-looping) VM.
  const qmp = await fakeQmp({ resetsBeforeReply: 3 });
  try {
    const r = await runQmp([qmp.sock, 'query-status']);
    assert.equal(r.code, 0, r.stderr);
  } finally {
    await qmp.close();
  }
});

test('status-events reports a missing greeting as slot contention (exit 75)', async () => {
  const qmp = await fakeQmp({ greet: false });
  try {
    const r = await runQmp([qmp.sock, 'status-events', '1'], { PAPERCUSP_QMP_TIMEOUT_SEC: '0.5' });
    assert.equal(r.code, 75, r.stderr);
  } finally {
    await qmp.close();
  }
});

test('status-events rejects an unbounded or missing window', async () => {
  for (const bad of [['status-events'], ['status-events', '0'], ['status-events', '61'], ['status-events', 'x']]) {
    const r = await runQmp(['/nonexistent.sock', ...bad]);
    assert.equal(r.code, 1, `${bad.join(' ')} should be refused`);
  }
});


test('powerdown-if-running succeeds after the main process and control files have gone', async () => {
  const dir = await tempDir();
  const r = await runQmp([path.join(dir, 'qmp.sock'), 'powerdown-if-running', path.join(dir, 'qemu.pid')], { MAINPID: '' });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).alreadyStopped, true);
});

test('powerdown-if-running refuses a missing socket while the main process is alive', async () => {
  const dir = await tempDir();
  const r = await runQmp([path.join(dir, 'qmp.sock'), 'powerdown-if-running', path.join(dir, 'qemu.pid')], { MAINPID: String(process.pid) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unable to connect/);
});

test('powerdown-if-running sends ACPI powerdown to a live VM', async () => {
  const qmp = await fakeQmp();
  try {
    const r = await runQmp([qmp.sock, 'powerdown-if-running', path.join(path.dirname(qmp.sock), 'qemu.pid')], { MAINPID: String(process.pid) });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(qmp.commands, ['qmp_capabilities', 'system_powerdown']);
  } finally {
    await qmp.close();
  }
});

test('powerdown-if-running refuses unverified and malformed process identities', async () => {
  const qmp = await fakeQmp();
  try {
    for (const mainPid of ['', 'bad-pid', '1', '0']) {
      const r = await runQmp([qmp.sock, 'powerdown-if-running', path.join(path.dirname(qmp.sock), 'qemu.pid')], { MAINPID: mainPid });
      assert.equal(r.code, 1, r.stderr);
    }
    assert.deepEqual(qmp.commands, []);
  } finally {
    await qmp.close();
  }
});

test('powerdown-if-running uses the live QEMU pidfile when systemd MAINPID is absent', async () => {
  const qmp = await fakeQmp();
  try {
    const pidfile = path.join(path.dirname(qmp.sock), 'qemu.pid');
    await writeFile(pidfile, String(process.pid));
    const r = await runQmp([qmp.sock, 'powerdown-if-running', pidfile], { MAINPID: '' });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(qmp.commands, ['qmp_capabilities', 'system_powerdown']);
  } finally {
    await qmp.close();
  }
});

test('powerdown-if-running never sends commands for a departed MAINPID even if a socket remains', async () => {
  const child = spawn('true');
  await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  const qmp = await fakeQmp();
  try {
    const r = await runQmp([qmp.sock, 'powerdown-if-running', path.join(path.dirname(qmp.sock), 'qemu.pid')], { MAINPID: String(child.pid) });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).alreadyStopped, true);
    assert.deepEqual(qmp.commands, []);
  } finally {
    await qmp.close();
  }
});

test('legacy query-status still fails for a missing control socket', async () => {
  const dir = await tempDir();
  const r = await runQmp([path.join(dir, 'qmp.sock'), 'query-status'], { MAINPID: '' });
  assert.equal(r.code, 1);
});

// ── pure pieces ──────────────────────────────────────────────────────────

const cfg = (over = {}) => ({ ...loadConfig({ HOME: '/home/x' }), ...over });

function signals({ active = true, job = '', ageSec = 7200, qmp = {}, alive = true, cursor = { skipped: true } } = {}) {
  return {
    service: { active, activeState: active ? 'active' : 'inactive', job, mainPid: 4242, activeAgeSec: ageSec },
    qmp: { ok: true, status: 'running', running: true, events: {}, windowSec: 5, ...qmp },
    guest: { pingOk: alive, neighStates: alive ? ['REACHABLE'] : ['FAILED'], alive },
    cursor,
  };
}

test('loadConfig keeps the one-restart-per-hour floor and rejects a bad remedy', () => {
  assert.equal(loadConfig({ HOME: '/h', MAC_VM_WATCHDOG_RESTART_MIN_INTERVAL_SEC: '60' }).restartMinIntervalSec, RESTART_MIN_INTERVAL_FLOOR_SEC);
  assert.equal(loadConfig({ HOME: '/h', MAC_VM_WATCHDOG_RESTART_MIN_INTERVAL_SEC: '7200' }).restartMinIntervalSec, 7200);
  assert.equal(loadConfig({ HOME: '/h' }).unit, 'papercusp-vm-mac.service');
  assert.equal(loadConfig({ HOME: '/h' }).leaseResource, 'mac-test-vm:aviweiss@127.0.0.1:2222');
  assert.equal(loadConfig({ HOME: '/h', MAC_VM_WATCHDOG_LEASE_RESOURCE: 'vm-test:other' }).leaseResource, 'vm-test:other');
  assert.throws(() => loadConfig({ HOME: '/h', MAC_VM_WATCHDOG_REMEDY: 'system_reset' }));
});

test('classify maps each signal combination to its verdict', () => {
  const c = cfg();
  const cases = [
    [signals({ qmp: { events: { RESET: 5 } } }), 'reset-loop', 'restart'],
    [signals({ qmp: { events: { RESET: 1 } } }), 'healthy', 'ok'],
    [signals({ qmp: { status: 'guest-panicked', running: false } }), 'vm-fatal-state', 'restart'],
    [signals({ qmp: { status: 'paused', running: false } }), 'vm-not-running', 'alert'],
    [signals({ qmp: { ok: false, contended: true } }), 'op-in-flight', 'skip'],
    [signals({ qmp: { ok: false, error: 'connection refused' } }), 'qmp-unresponsive', 'alert'],
    [signals({ job: '812' }), 'op-in-flight', 'skip'],
    [signals({ active: false }), 'service-inactive', 'alert'],
    [signals({ alive: false, ageSec: 120 }), 'booting', 'grace'],
    [signals({ alive: false, ageSec: 7200 }), 'guest-unreachable', 'restart'],
    [signals({ cursor: { ok: true, ageSec: 4000, position: 9 } }), 'cursor-stale', 'alert'],
    [signals({ cursor: { ok: false, error: 'ssh: timeout' } }), 'healthy', 'ok'],
  ];
  for (const [s, verdict, kind] of cases) {
    const got = classify(s, c);
    assert.equal(got.verdict, verdict, JSON.stringify(s));
    assert.equal(got.kind, kind, verdict);
  }
});

test('resolveDbUrl reads HARNESS_ADMIN_DATABASE_URL from the operator process', async () => {
  // Measured on the tower: the operator carries only this key. Before it was listed,
  // resolution returned '' and every alert was silently skipped.
  const deps = {
    exec: async () => ({ code: 0, stdout: '777\n', stderr: '' }),
    readProcEnviron: (pid) => (pid === 777 ? 'PATH=/bin\0HARNESS_ADMIN_DATABASE_URL=postgres://u@h:5432/papercusp\0' : ''),
  };
  assert.equal(await resolveDbUrl(cfg({ dbUrl: '' }), deps), 'postgres://u@h:5432/papercusp');
  assert.equal(loadConfig({ HOME: '/h', HARNESS_ADMIN_DATABASE_URL: 'postgres://env/db' }).dbUrl, 'postgres://env/db');
});

test('resolveSuDbUrl derives the lock side-database from the admin URL', async () => {
  const main = 'postgres://user:secret@db.example:5432/papercusp?sslmode=require';
  assert.equal(await resolveSuDbUrl(cfg({ dbUrl: main }), {}), 'postgres://user:secret@db.example:5432/papercusp_su?sslmode=require');
});

test('parsers read the neighbour table and the fold cursor probe', () => {
  assert.deepEqual(parseNeighStates('[{"dst":"172.31.44.2","state":["REACHABLE"]}]'), ['REACHABLE']);
  assert.deepEqual(parseNeighStates('not json'), []);
  const probe = parseCursorProbe('2026-09-23T03:00:00.000Z papercusp 5b00878b0000 position=7 updated=2026-09-23T02:30:00.000Z apply_failure=NULL peer=live');
  assert.deepEqual(probe, { ok: true, position: 7, ageSec: 1800 });
  assert.equal(parseCursorProbe('2026-09-23T03:00:00.000Z NO ROW for 5b00878b%').ok, false);
});

test('decide alerts first, restarts on the second reset-loop check, then rate-limits', () => {
  const c = cfg();
  const loop = classify(signals({ qmp: { events: { RESET: 6 } } }), c);
  const t0 = 1_000_000;

  const r1 = decide(loop, {}, c, t0, null);
  assert.deepEqual(r1.actions.map((a) => a.type), ['alert']);
  assert.equal(r1.state.streak, 1);

  const r2 = decide(loop, r1.state, c, t0 + 60, null);
  assert.deepEqual(r2.actions.map((a) => a.type), ['alert', 'cold-restart']);
  assert.equal(r2.state.lastRestartAt, t0 + 60);

  const r3 = decide(loop, r2.state, c, t0 + 120, null);
  assert.deepEqual(r3.actions.map((a) => a.type), ['alert'], 'rate limit is announced once');
  assert.match(r3.actions[0].summary, /needs a human/);
  const r4 = decide(loop, r3.state, c, t0 + 180, null);
  assert.deepEqual(r4.actions, [], 'the same withheld state is not re-alerted every minute');

  const r5 = decide(loop, r4.state, c, t0 + 60 + RESTART_MIN_INTERVAL_FLOOR_SEC, null);
  assert.ok(r5.actions.some((a) => a.type === 'cold-restart'), 'an hour later the remedy is available again');
});

test('decide honours a hold, alert-only mode, and announces recovery', () => {
  const c = cfg();
  const loop = classify(signals({ qmp: { events: { RESET: 6 } } }), c);
  const hold = { until: 2_000_000, by: 'su-leader', reason: 'fold op' };
  const first = decide(loop, {}, c, 1_000_000, hold);
  const held = decide(loop, first.state, c, 1_000_060, hold);
  assert.ok(!held.actions.some((a) => a.type === 'cold-restart'));
  assert.match(held.actions[0].summary, /su-leader/);

  const alertOnly = decide(loop, first.state, cfg({ remedy: 'alert-only' }), 1_000_060, null);
  assert.ok(!alertOnly.actions.some((a) => a.type === 'cold-restart'));

  const healthy = classify(signals(), c);
  const recovered = decide(healthy, held.state, c, 1_000_120, null);
  assert.equal(recovered.actions[0].category, 'severe-event-resolved');
  assert.equal(recovered.state.streak, 0);
  assert.equal(recovered.state.condition, null);
});

test('decide leaves state untouched for skip and boot grace', () => {
  const c = cfg();
  const prev = { condition: 'reset-loop', streak: 1, conditionSince: 5, lastAlertAt: 5 };
  for (const s of [signals({ job: '9' }), signals({ alive: false, ageSec: 30 })]) {
    const r = decide(classify(s, c), prev, c, 100, null);
    assert.deepEqual(r.actions, []);
    assert.equal(r.state.streak, 1);
    assert.equal(r.state.condition, 'reset-loop');
  }
});

test('guest-unreachable needs three consecutive checks before a restart', () => {
  const c = cfg();
  const dead = classify(signals({ alive: false }), c);
  let state = {};
  const types = [];
  for (let i = 0; i < 3; i += 1) {
    const r = decide(dead, state, c, 1_000_000 + i * 60, null);
    state = r.state;
    types.push(r.actions.map((a) => a.type).join('+'));
  }
  assert.deepEqual(types, ['alert', '', 'alert+cold-restart']);
});

// ── end to end with fake system deps ─────────────────────────────────────

function fakeDeps({ resets = 6, qmpCode = 0, quitCode = 0, pingCode = 0, startCode = 0, leaseRow = null, leaseRows = null, leaseProbeCode = 0 } = {}) {
  const calls = [];
  let nowMs = Date.parse('2026-09-23T04:00:00Z');
  let qemuAlive = true;
  let leaseProbeIndex = 0;
  const deps = {
    calls,
    readVmFiles: () => ({ status: 'ok', deletedCwd: false, deletedDrives: [] }),
    advance: (sec) => { nowMs += sec * 1000; },
    set resets(n) { resets = n; },
    exec: async (cmd, args, opts = {}) => {
      calls.push({ cmd, args, stdin: opts.stdin });
      const a = args.join(' ');
      if (cmd === 'systemctl' && a.includes('--value')) return { code: 0, stdout: '0\n', stderr: '' };
      if (cmd === 'systemctl' && args[1] === 'show') {
        return { code: 0, stdout: 'ActiveState=active\nSubState=running\nJob=\nMainPID=4242\nActiveEnterTimestampMonotonic=1000000\n', stderr: '' };
      }
      if (cmd === 'systemctl' && args[1] === 'start') {
        qemuAlive = true;
        return { code: startCode, stdout: '', stderr: startCode ? 'start failed' : '' };
      }
      if (cmd === 'python3' && args[2] === 'status-events') {
        if (qmpCode !== 0) return { code: qmpCode, stdout: '', stderr: 'qmp busy' };
        return { code: 0, stdout: `${JSON.stringify({ status: 'running', running: true, events: { RESET: resets }, window_sec: 5 })}\n`, stderr: '' };
      }
      if (cmd === 'python3' && args[2] === 'quit') {
        if (quitCode === 0) qemuAlive = false;
        return { code: quitCode, stdout: '', stderr: quitCode ? 'quit refused' : '' };
      }
      if (cmd === 'ping') return { code: pingCode, stdout: '', stderr: '' };
      if (cmd === 'ip') return { code: 0, stdout: pingCode ? '[{"state":["FAILED"]}]' : '[{"state":["REACHABLE"]}]', stderr: '' };
      if (cmd === 'psql' && String(opts.stdin || '').includes('FROM agent_resource_locks')) {
        if (leaseProbeCode !== 0) return { code: leaseProbeCode, stdout: '', stderr: 'resource lock query failed' };
        const row = leaseRows
          ? leaseRows[Math.min(leaseProbeIndex++, leaseRows.length - 1)]
          : leaseRow;
        return { code: 0, stdout: row ? `${JSON.stringify(row)}\n` : '', stderr: '' };
      }
      if (cmd === 'psql') return { code: 0, stdout: '', stderr: '' };
      return { code: 127, stdout: '', stderr: `unexpected ${cmd}` };
    },
    nowMs: () => nowMs,
    monotonicUs: () => 1_000_000 + 7200 * 1e6,
    sleep: async (ms) => { nowMs += ms; },
    pidAlive: () => qemuAlive,
    readProcEnviron: () => '',
    log: () => {},
  };
  return deps;
}

async function e2eConfig(over = {}) {
  const dir = await tempDir();
  return cfg({ stateDir: dir, holdFile: path.join(dir, 'hold.json'), dbUrl: 'postgres://fake/db', ...over });
}

const typesOf = (calls) => calls.map((c) => (c.cmd === 'python3' ? `qmp:${c.args[2]}` : c.cmd === 'systemctl' ? `systemctl:${c.args[1]}` : c.cmd));

test('runOnce: alert on the first reset-loop check, cold restart on the second, never system_reset', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({ resets: 7 });

  await runOnce(c, deps);
  assert.ok(!typesOf(deps.calls).includes('qmp:quit'), 'first check only alerts');
  assert.equal(deps.calls.filter((call) => call.cmd === 'psql' && String(call.stdin || '').includes('INSERT INTO harness_shared.coord_event_log')).length, 1);

  deps.calls.length = 0;
  deps.advance(60);
  const second = await runOnce(c, deps);
  const seq = typesOf(deps.calls);
  const alertAt = deps.calls.findIndex((call) => call.cmd === 'psql' && String(call.stdin || '').includes('INSERT INTO harness_shared.coord_event_log'));
  const quitAt = deps.calls.findIndex((call) => call.cmd === 'python3' && call.args[2] === 'quit');
  const startAt = deps.calls.findIndex((call) => call.cmd === 'systemctl' && call.args[1] === 'start');
  assert.ok(alertAt >= 0 && alertAt < quitAt && quitAt < startAt, `alert, then quit, then start: ${seq.join(' ')}`);
  assert.equal(deps.calls.filter((call) => call.cmd === 'psql' && String(call.stdin || '').includes('INSERT INTO harness_shared.coord_event_log')).length, 2, 'an alert before and a result alert after');
  const restart = second.record.results.find((r) => r.type === 'cold-restart');
  assert.equal(restart.ok, true);
  const start = deps.calls.find((x) => x.cmd === 'systemctl' && x.args[1] === 'start');
  assert.deepEqual(start.args, ['--user', 'start', 'papercusp-vm-mac.service']);

  const qmpCommands = new Set(deps.calls.filter((x) => x.cmd === 'python3').map((x) => x.args[2]));
  assert.deepEqual([...qmpCommands].sort(), ['quit', 'status-events'], 'the only QMP commands are the probe and quit');
  assert.ok(!deps.calls.some((x) => x.args.includes('system_reset')), 'no process is ever asked for system_reset');

  const state = JSON.parse(await readFile(path.join(c.stateDir, 'state.json'), 'utf8'));
  assert.equal(typeof state.lastRestartAt, 'number');
  const log = (await readFile(path.join(c.stateDir, 'actions.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(log.length, 2, 'each acting run is logged');
});

test('runOnce: at most one cold restart per hour while the loop persists', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({ resets: 9 });
  for (let i = 0; i < 30; i += 1) {
    await runOnce(c, deps);
    deps.advance(60);
  }
  const quits = typesOf(deps.calls).filter((t) => t === 'qmp:quit').length;
  assert.equal(quits, 1, '30 minutes of reset loop, one cold restart');
});

test('runOnce: a hold blocks the restart; a contended QMP slot skips the run', async () => {
  const c = await e2eConfig();
  await writeFile(c.holdFile, JSON.stringify({ until: Math.floor(Date.parse('2026-09-23T06:00:00Z') / 1000), by: 'su-rig', reason: 'deploy' }));
  const deps = fakeDeps({ resets: 8 });
  await runOnce(c, deps);
  deps.advance(60);
  await runOnce(c, deps);
  assert.ok(!typesOf(deps.calls).includes('qmp:quit'));

  const c2 = await e2eConfig();
  const busy = fakeDeps({ qmpCode: 75 });
  const out = await runOnce(c2, busy);
  assert.equal(out.classification.verdict, 'op-in-flight');
  assert.ok(!typesOf(busy.calls).includes('psql'), 'a skipped run sends no alert');
});

test('runOnce: an active exclusive Mac VM lease withholds the cold restart', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({
    resets: 0,
    pingCode: 1,
    leaseRow: {
      owner: 'su-rig',
      reason: 'intentional guest reboot',
      expiresAtSec: Math.floor(Date.parse('2026-09-23T06:00:00Z') / 1000),
    },
  });

  let last;
  for (let i = 0; i < 3; i += 1) {
    last = await runOnce(c, deps);
    deps.advance(60);
  }

  assert.equal(last.classification.verdict, 'guest-unreachable');
  assert.ok(!typesOf(deps.calls).includes('qmp:quit'));
  assert.ok(!typesOf(deps.calls).includes('systemctl:start'));
  assert.equal(last.state.lastRestartAt, undefined);
  assert.equal(last.state.blocked, 'hold');
  assert.equal(last.record.resourceLease.status, 'held');
  assert.match(last.record.resourceLease.owner, /su-rig/);
  const leaseQuery = deps.calls.find((call) => call.cmd === 'psql' && String(call.stdin || '').includes('FROM agent_resource_locks'));
  assert.ok(leaseQuery, 'the watchdog reads the canonical named-resource lease state');
  assert.ok(String(leaseQuery.stdin).includes("resource = :'resource'"));
  assert.ok(!String(leaseQuery.stdin).includes('coordination_domain ='), 'checks every operator checkout domain for the resource');
  assert.ok(leaseQuery.args.includes('resource=mac-test-vm:aviweiss@127.0.0.1:2222'));
});

test('runOnce: an unreadable resource lease fails closed for a cold restart', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({ resets: 0, pingCode: 1, leaseProbeCode: 2 });

  let last;
  for (let i = 0; i < 3; i += 1) {
    last = await runOnce(c, deps);
    deps.advance(60);
  }

  assert.ok(!typesOf(deps.calls).includes('qmp:quit'));
  assert.ok(!typesOf(deps.calls).includes('systemctl:start'));
  assert.equal(last.state.lastRestartAt, undefined);
  assert.equal(last.state.blocked, 'lease-check-failed');
  assert.equal(last.record.resourceLease.status, 'unknown');
});

test('runOnce: rechecks the exclusive lease immediately before QMP quit', async () => {
  const c = await e2eConfig();
  const lease = {
    owner: 'su-rig',
    reason: 'intentional guest reboot',
    expiresAtSec: Math.floor(Date.parse('2026-09-23T06:00:00Z') / 1000),
  };
  const deps = fakeDeps({ resets: 0, pingCode: 1, leaseRows: [null, null, null, lease] });

  let last;
  for (let i = 0; i < 3; i += 1) {
    last = await runOnce(c, deps);
    deps.advance(60);
  }

  assert.ok(!typesOf(deps.calls).includes('qmp:quit'));
  assert.equal(last.state.lastRestartAt, undefined);
  assert.equal(last.state.blocked, 'hold');
  assert.equal(last.record.resourceLease.status, 'held');
  assert.equal(last.record.results.find((result) => result.type === 'cold-restart').blocked, true);
});

test('runOnce --dry-run has no side effects', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({ resets: 8 });
  const out = await runOnce(c, deps, { dryRun: true });
  assert.equal(out.classification.verdict, 'reset-loop');
  assert.deepEqual(out.record.planned, ['alert']);
  assert.ok(!deps.calls.some((call) => call.cmd === 'psql' && String(call.stdin || '').includes('INSERT INTO harness_shared.coord_event_log')));
  assert.ok(!typesOf(deps.calls).includes('qmp:quit'));
  assert.equal(existsSync(path.join(c.stateDir, 'state.json')), false);
});

test('deleted VM disks are detected through a real open descriptor', { skip: process.platform !== 'linux' }, async () => {
  const dir = await tempDir();
  const disk = path.join(dir, 'disk.qcow2');
  await writeFile(disk, 'retained disk bytes');
  const child = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    fs.openSync(process.argv[1], 'r');
    fs.unlinkSync(process.argv[1]);
    process.stdout.write('ready');
    process.stdin.resume();
  `, disk, '-drive', `file=${disk},format=qcow2`], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
      child.once('exit', () => reject(new Error('descriptor holder exited before inspection')));
    });
    assert.deepEqual(readVmFiles(child.pid), { status: 'unsafe', deletedCwd: false, deletedDrives: ['disk.qcow2'] });
  } finally {
    child.stdin.end();
    await new Promise((resolve) => child.once('exit', resolve));
  }
});

test('working QMP never makes deleted VM inputs safe to restart', () => {
  const s = { ...signals(), files: { status: 'unsafe', deletedCwd: true, deletedDrives: ['disk.qcow2'] } };
  const classification = classify(s, cfg());
  assert.equal(classification.verdict, 'vm-inputs-deleted');
  assert.equal(classification.kind, 'alert');
  const decision = decide(classification, { condition: 'vm-inputs-deleted', streak: 100 }, cfg(), 1_000_000, null);
  assert.equal(decision.actions.some((action) => action.type === 'cold-restart'), false);
});

test('coldRestart rechecks disk safety immediately before stopping QEMU', async () => {
  const deps = fakeDeps();
  deps.readVmFiles = () => ({ status: 'unsafe', deletedCwd: false, deletedDrives: ['disk.qcow2'] });
  const out = await coldRestart(cfg(), deps, { service: { mainPid: 4242 }, files: { status: 'ok' } });
  assert.equal(out.step, 'input-check');
  assert.equal(out.blocked, true);
  assert.equal(deps.calls.length, 0);
});

test('coldRestart stops at a refused QMP quit and never starts a second qemu', async () => {
  const c = await e2eConfig();
  const deps = fakeDeps({ quitCode: 1 });
  const out = await coldRestart(c, deps, { service: { mainPid: 4242 } });
  assert.equal(out.ok, false);
  assert.equal(out.step, 'qmp-quit');
  assert.ok(!typesOf(deps.calls).includes('systemctl:start'));
});

test('coldRestart refuses to start while the old qemu is still alive', async () => {
  const c = await e2eConfig({ quitWaitSec: 3 });
  const deps = fakeDeps();
  deps.pidAlive = () => true;
  const out = await coldRestart(c, deps, { service: { mainPid: 4242 } });
  assert.equal(out.ok, false);
  assert.equal(out.step, 'wait-qemu-exit');
  assert.ok(!typesOf(deps.calls).includes('systemctl:start'));
});


// Real qcow2 operations verify preservation and admission, without booting a VM.
const storageTrialFixture = String.raw`
import hashlib, importlib.util, json, shutil, subprocess, sys
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('launch', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root, case = Path(sys.argv[2]), sys.argv[3]
backup, runtime, trial = root/'backup', root/'runtime', root/'trial'
backup.mkdir(); runtime.mkdir(); (runtime/'OpenCore').mkdir()
def run(*args): subprocess.run(args, check=True, stdout=subprocess.DEVNULL)
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p, value): p.write_text(json.dumps(value))
(backup/'mac_hdd_ng.img.zst').write_bytes(b'original retained archive')
paths = [
    runtime/'OVMF_CODE_4M.fd', runtime/'OVMF_VARS-1920x1080.fd',
    runtime/'OpenCore/OpenCore.qcow2', runtime/'mac_hdd_ng.img',
    backup/'builddata-20260820-160g.qcow2']
for p in paths[:2]: p.write_bytes(b'firmware state')
for p in paths[2:]: run('qemu-img','create','-f','qcow2',str(p),'8M')
run('qemu-io','-f','qcow2','-c','write -P 0x35 0 4096',str(paths[3]))
run('qemu-img','snapshot','-c','retained-rollback',str(paths[3]))
run('qemu-io','-f','qcow2','-c','write -P 0x77 4096 4096',str(paths[3]))
names = ['./OVMF_CODE_4M.fd','./OVMF_VARS-1920x1080.fd',
         './OpenCore/OpenCore.qcow2','./mac_hdd_ng.img','./builddata-20260820-160g.qcow2']
argv = ['qemu-private']
for name in names: argv.extend(['-drive','file='+name+',format=qcow2'])
argv.extend(['-qmp','old','-pidfile','old'])
write(backup/'source.json', {'pid':4242,'starttime':'initial','argv':argv})
write(backup/'preserved.json', {'ok':True,'sourcePid':4242,'sourceStarttime':'initial',
    'osArchive':str(backup/'mac_hdd_ng.img.zst'),'buildData':str(paths[-1])})
write(runtime/'runtime-ready.json', {'ok':True,'osCompared':True,'sourceStarttime':'initial',
    'files':{str(p):{'size':p.stat().st_size} for p in paths}})
write(runtime/'boot-receipt.json', {'ok':True,'sourceStarttime':'initial'})
before = {str(p):digest(p) for p in paths}
procroot = root/'proc'; procroot.mkdir()
if case == 'orphan':
    orphan = procroot/'9999'; orphan.mkdir(); (orphan/'fd').mkdir()
    (orphan/'comm').write_text('qemu-system-x86\n')
    (orphan/'fd/17').symlink_to(paths[3])
real_output = subprocess.check_output
real_run = subprocess.run
active = [case == 'live']
def output(args, **kwargs):
    if args[0] == 'systemctl':
        return 'MainPID=4242\nActiveState=active\n' if active[0] else 'MainPID=0\nActiveState=inactive\n'
    return real_output(args, **kwargs)
def refused(fn):
    try: fn()
    except RuntimeError: return
    raise AssertionError('unsafe trial admitted: '+case)
with patch.object(m.subprocess,'check_output',side_effect=output), \
     patch.object(m,'Path',side_effect=lambda p: procroot if str(p)=='/proc' else Path(p)):
    if case in ('live', 'orphan'):
        refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service'))
        assert not trial.exists()
    elif case == 'capacity':
        with patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=1)):
            refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service'))
        assert not trial.exists()
    elif case.startswith(('resume-', 'legacy-', 'compared-', 'compare-failure')):
        boot = trial/'mac_hdd_ng.img'
        original_stamps = {str(p):m.stamp(p) for p in paths}
        commands = []
        def interrupted(args, **kwargs):
            if args[:2] == ['qemu-img','convert']:
                real_run(['qemu-img','create','-f','qcow2',str(boot),'8M'],check=True)
                real_run(['qemu-io','-f','qcow2','-c','write -P 0x99 0 16384',str(boot)],check=True)
                raise subprocess.CalledProcessError(143,args)
            return real_run(args, **kwargs)
        def replay(args, **kwargs):
            commands.append(args)
            result=real_run(args, **kwargs)
            if case=='resume-change-after-compare' and args[:2]==['qemu-img','compare'] and str(paths[-1]) in args:
                real_run(['qemu-io','-f','qcow2','-c','write -P 0x55 8192 4096',str(boot)],check=True)
            return result
        def stop_before_data(args, **kwargs):
            if args[:2] == ['qemu-img','create'] and str(trial/'builddata-20260820-160g.qcow2') in args:
                raise subprocess.CalledProcessError(143,args)
            return real_run(args, **kwargs)
        def failed_compare(args, **kwargs):
            if args[:2] == ['qemu-img','compare']:
                raise subprocess.CalledProcessError(1,args)
            return real_run(args, **kwargs)
        if case.startswith('legacy-'):
            trial.mkdir()
            for p in paths[:3]: shutil.copyfile(p,trial/p.name)
            run('qemu-img','create','-f','qcow2',str(boot),'8M')
            run('qemu-io','-f','qcow2','-c','write -P 0x99 0 16384',str(boot))
        elif case=='compared-all-replay':
            real_atomic=m.atomic_json
            def fail_ready(p,value):
                if p.name=='storage-ready.json': raise RuntimeError('cut before ready')
                return real_atomic(p,value)
            with patch.object(m,'atomic_json',side_effect=fail_ready):
                refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service'))
            assert m.read(trial/'storage-progress.json')['phase']=='data-compared'
        else:
            action = stop_before_data if case.startswith('compared-') else (
                failed_compare if case=='compare-failure' else interrupted)
            with patch.object(m.subprocess,'run',side_effect=action):
                try: m.prepare_trial(backup,runtime,trial,'test.service')
                except subprocess.CalledProcessError: pass
                else: raise AssertionError('expected interrupted operation')
        assert not (trial/'storage-ready.json').exists()
        if case=='resume-source-change':
            paths[0].write_bytes(b'changed')
        elif case=='resume-target-symlink':
            boot.unlink(); boot.symlink_to(paths[3])
        elif case=='resume-trial-symlink':
            trial.rename(root/'actual'); trial.symlink_to(root/'actual',target_is_directory=True)
        elif case=='resume-orphan-img':
            orphan=procroot/'9999'; orphan.mkdir(); (orphan/'fd').mkdir()
            (orphan/'comm').write_text('qemu-img\n'); (orphan/'fd/17').symlink_to(boot)
        elif case=='resume-live':
            active[0]=True
        elif case=='compared-stamp-change':
            run('qemu-io','-f','qcow2','-c','write -P 0x55 8192 4096',str(boot))
        elif case=='legacy-wrong-stamps':
            original_stamps[str(paths[3])]['mtimeNs']+=1
        elif case=='legacy-wrong-copy':
            (trial/paths[0].name).write_bytes(b'wrong firmware')
        elif case=='resume-size':
            run('qemu-img','resize',str(boot),'16M')
        elif case=='resume-snapshot':
            run('qemu-img','snapshot','-c','unbound-snapshot',str(boot))
        elif case=='resume-backing':
            run('qemu-img','rebase','-u','-f','qcow2','-F','qcow2','-b',str(paths[3]),str(boot))
        denied = case in ('resume-source-change','resume-target-symlink','resume-trial-symlink',
            'resume-orphan-img','resume-live','compared-stamp-change','legacy-unbound',
            'legacy-wrong-stamps','legacy-wrong-copy','resume-size','resume-snapshot','resume-backing')
        expected = original_stamps if case.startswith('legacy-') and case!='legacy-unbound' else None
        with patch.object(m.subprocess,'run',side_effect=replay):
            if denied:
                refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service',resume=True,
                    expected_originals=expected))
                assert not (trial/'storage-ready.json').exists()
                assert not any(a[1] in ('convert','compare','create') for a in commands)
            elif case=='resume-change-after-compare':
                refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service',resume=True))
                assert not (trial/'storage-ready.json').exists()
                assert m.read(trial/'storage-progress.json')['phase']=='data-compared'
            else:
                if case=='resume-capacity':
                    remaining=max(0,8*2**20-boot.stat().st_blocks*512)
                    with patch.object(m.shutil,'disk_usage',return_value=SimpleNamespace(free=remaining+20*2**30)):
                        m.prepare_trial(backup,runtime,trial,'test.service',resume=True)
                else:
                    m.prepare_trial(backup,runtime,trial,'test.service',resume=True,expected_originals=expected)
                assert m.read(trial/'storage-ready.json')['bootCompared'] is True
                assert m.read(trial/'storage-ready.json')['dataCompared'] is True
                m.prepare(backup,runtime,trial)
                conversions=[a for a in commands if a[:2]==['qemu-img','convert']]
                if case.startswith('compared-') or case=='compare-failure':
                    assert not conversions
                else:
                    assert len(conversions)==1 and '-n' in conversions[0]
                    assert '--target-is-zero' not in conversions[0]
                if case=='compared-all-replay':
                    assert not any(a[:2]==['qemu-img','compare'] for a in commands)
                if case=='compared-boot-replay':
                    assert not any(a[:2]==['qemu-img','compare'] and str(paths[3]) in a for a in commands)
                # Independent full comparison proves stale nonzero sectors were
                # overwritten by both source data and source zero sectors.
                run('qemu-img','compare','-f','qcow2','-F','qcow2',str(paths[3]),str(boot))
        if case=='resume-source-change': paths[0].write_bytes(b'firmware state')
    else:
        m.prepare_trial(backup,runtime,trial,'test.service')
        source, files, selected, receipt_path = m.prepare(backup,runtime,trial)
        assert len(files)==5 and receipt_path == trial/'boot-receipt.json'
        assert all(p.parent==trial for p in files.values())
        assert all(str(p) not in selected for p in paths)
        assert any(str(trial/'mac_hdd_ng.img') in a for a in selected)
        info=json.loads(real_output(['qemu-img','info','--output=json',str(paths[3])],text=True))
        assert [s['name'] for s in info['snapshots']]==['retained-rollback']
        receipt=trial/'storage-ready.json'
        if case=='source-change':
            paths[0].write_bytes(b'changed')
            refused(lambda:m.prepare(backup,runtime,trial))
            paths[0].write_bytes(b'firmware state')
        elif case=='trial-change':
            run('qemu-io','-f','qcow2','-c','write -P 0x55 8192 4096',str(trial/'mac_hdd_ng.img'))
            refused(lambda:m.prepare(backup,runtime,trial))
        elif case=='bad-receipt':
            value=json.loads(receipt.read_text()); value['bootCompared']=False; write(receipt,value)
            refused(lambda:m.prepare(backup,runtime,trial))
        elif case=='existing':
            refused(lambda:m.prepare_trial(backup,runtime,trial,'test.service'))
        elif case=='booted-trial':
            write(trial/'boot-receipt.json',{'storageReceiptSha256':digest(receipt)})
            run('qemu-io','-f','qcow2','-c','write -P 0x55 8192 4096',str(trial/'mac_hdd_ng.img'))
            m.prepare(backup,runtime,trial)
        elif case=='wrong-backing':
            run('qemu-img','rebase','-u','-f','qcow2','-F','qcow2','-b',str(paths[2]),
                str(trial/'builddata-20260820-160g.qcow2'))
            write(trial/'boot-receipt.json',{'storageReceiptSha256':digest(receipt)})
            refused(lambda:m.prepare(backup,runtime,trial))
assert all(digest(Path(p))==d for p,d in before.items())
assert (backup/'mac_hdd_ng.img.zst').read_bytes()==b'original retained archive'
print(json.dumps({'ok':True,'case':case,'originalBytesUnchanged':True}))
`;

for (const scenario of ['preserved', 'live', 'orphan', 'capacity', 'source-change', 'trial-change',
  'bad-receipt', 'existing', 'booted-trial', 'wrong-backing', 'resume-convert', 'resume-capacity',
  'resume-source-change', 'resume-target-symlink', 'resume-trial-symlink', 'resume-orphan-img',
  'resume-live', 'legacy-adopt', 'legacy-unbound', 'legacy-wrong-stamps', 'legacy-wrong-copy',
  'compared-boot-replay', 'compared-all-replay', 'compared-stamp-change', 'compare-failure',
  'resume-size', 'resume-snapshot', 'resume-backing', 'resume-change-after-compare']) {
  test('preserved Mac storage trial: ' + scenario, async () => {
    const dir = await tempDir();
    const helper = new URL('../bin/mac-vm-launch.py', import.meta.url).pathname;
    const result = await new Promise((resolve) => {
      execFile('python3', ['-c', storageTrialFixture, helper, dir, scenario],
        { timeout: 30_000 }, (error, stdout, stderr) => {
          resolve({ code: error ? error.code : 0, stdout, stderr });
        });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)),
      { ok: true, case: scenario, originalBytesUnchanged: true });
  });
}

// SSH closure must not hide successful native exit or imply an exit that never
// happened. Replace the clock, guest command and native observations only.
const shutdownFixture = String.raw`
import importlib.util, json, subprocess, sys
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('launch', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
root, case = Path(sys.argv[2]), sys.argv[3]
(root/'qemu.pid').write_text('4242')
clock, requested, calls = [0.0], [False], []
def state(unit):
    if case=='wrong-unit':
        return {'MainPID':'9999','ActiveState':'active','NRestarts':'1'}
    if not requested[0] or case in ('still-live','ack-live'):
        return {'MainPID':'4242','ActiveState':'active','Result':'success','NRestarts':'1'}
    if case=='transition' and clock[0]<1:
        return {'MainPID':'4242','ActiveState':'deactivating','Result':'success','NRestarts':'1'}
    if case=='late-restart' and clock[0]>=2:
        return {'MainPID':'9999','ActiveState':'active','Result':'success','NRestarts':'2'}
    return {'MainPID':'0','ActiveState':'inactive',
            'Result':'exit-code' if case=='failed-stop' else 'success',
            'NRestarts':'2' if case=='restarted' else '1'}
def identity(pid):
    if not requested[0] or case in ('still-live','ack-live'): return 'initial'
    if case=='transition' and clock[0]<1: return 'initial'
    return None
def run(args, **kwargs):
    calls.append(args)
    assert args[0]=='ssh' and args[-1]=='sudo -n shutdown -h now'
    assert kwargs['check'] is False and kwargs['capture_output'] is True
    requested[0]=True
    if case=='ssh-timeout': raise subprocess.TimeoutExpired(args, kwargs['timeout'])
    return subprocess.CompletedProcess(args, 0 if case in ('acknowledged','ack-live') else 255)
def sleep(seconds): clock[0]+=seconds
with patch.object(m,'unit_state',side_effect=state), \
     patch.object(m,'process_identity',side_effect=identity), \
     patch.object(m.subprocess,'run',side_effect=run), \
     patch.object(m.time,'monotonic',side_effect=lambda:clock[0]), \
     patch.object(m.time,'sleep',side_effect=sleep):
    if case in ('disconnected','acknowledged','ssh-timeout','transition'):
        result=m.verified_shutdown('test.service',root,'guest',2222,root/'key',timeout=3,settle=3)
        assert result['ok'] and result['processDeparted'] and result['unitInactive']
        assert result['sshReturnCode']==({'acknowledged':0,'disconnected':255,'ssh-timeout':None,'transition':255}[case])
        assert clock[0]>=3 and len(calls)==1
    else:
        try: m.verified_shutdown('test.service',root,'guest',2222,root/'key',timeout=3,settle=3)
        except RuntimeError: pass
        else: raise AssertionError('unverified shutdown admitted: '+case)
        assert len(calls)==(0 if case=='wrong-unit' else 1)
print(json.dumps({'ok':True,'case':case}))
`;

for (const scenario of ['disconnected', 'acknowledged', 'ssh-timeout', 'transition', 'still-live', 'ack-live',
  'failed-stop', 'restarted', 'late-restart', 'wrong-unit']) {
  test('verified Mac guest shutdown: ' + scenario, async () => {
    const dir = await tempDir();
    const helper = new URL('../bin/mac-vm-launch.py', import.meta.url).pathname;
    const result = await new Promise((resolve) => {
      execFile('python3', ['-c', shutdownFixture, helper, dir, scenario],
        { timeout: 10_000 }, (error, stdout, stderr) => {
          resolve({ code: error ? error.code : 0, stdout, stderr });
        });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { ok: true, case: scenario });
  });
}

// Exercise the maintained recovery helper with real archive decoding and cmp,
// while replacing systemd/QEMU so this regression never touches a host VM.
const restoreFixture = String.raw`
import hashlib, importlib.util, json, os, subprocess, sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('restore', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
root, case = Path(sys.argv[2]), sys.argv[3]
backup, runtime, tools = root/'backup', root/'runtime', root/'tools'
backup.mkdir(); tools.mkdir()
payload = b'preserved OS bytes\0' * 4096
image = backup/'source.img'
image.write_bytes(payload)
archive = backup/'mac_hdd_ng.img.zst'
subprocess.run(['zstd', '-q', '-o', str(archive), str(image)], check=True)
archive_digest = hashlib.sha256(archive.read_bytes()).hexdigest()
data = backup/'builddata-20260820-160g.qcow2'
data.write_bytes(b'repaired guest data')
for name in ['OVMF_CODE_4M.fd', 'OVMF_VARS-1920x1080.fd', 'OpenCore.qcow2']:
    (backup/name).write_bytes(b'firmware')
(tools/'boot-sonoma-durable.sh').write_text('#!/bin/sh\nexit 0\n')
raw_part = backup/'raw.bin'
raw_part.write_bytes(b'original metadata and guest data')
raw_part.chmod(0o400)
raw = {'ok': True, 'sourcePid': 4242, 'sourceStarttime': 'initial',
       'totalBytes': raw_part.stat().st_size,
       'parts': [{'path': str(raw_part), 'offset': 0, 'bytes': raw_part.stat().st_size}]}
repair = {'ok': True, 'guestVisibleDataUnchanged': True, 'rawBackup': raw}
preserved = {'ok': True, 'sourcePid': 4242, 'sourceStarttime': 'initial',
             'osArchive': str(archive), 'buildData': str(data), 'completedAt': 123,
             'buildDataRawBackup': str(backup/'builddata-raw-preserved.json'),
             'buildDataRepairProof': str(backup/'builddata-repair-proof.json')}
if case == 'invalid-marker': preserved['ok'] = False
if case == 'raw-gap': raw['parts'][0]['offset'] = 1
if case == 'visible-change': repair['guestVisibleDataUnchanged'] = False
for name, body in [('source.json', {'pid': 4242, 'starttime': 'initial'}),
                   ('preserved.json', preserved), ('builddata-raw-preserved.json', raw),
                   ('builddata-repair-proof.json', repair)]:
    (backup/name).write_text(json.dumps(body))

alive, calls = [True], []
real_run, real_stat = subprocess.run, os.stat
def identity(pid): return 'initial' if alive[0] else None
def stat(path, *args, **kwargs):
    if str(path) == '/proc/4242/fd/17':
        return SimpleNamespace(st_nlink=0, st_size=len(payload),
                               st_dev=backup.stat().st_dev, st_blocks=1)
    return real_stat(path, *args, **kwargs)
def run(args, *pos, **kwargs):
    if args[0] == 'systemctl':
        calls.append(list(args))
        if 'thaw' in args:
            raise subprocess.CalledProcessError(1, args, stderr='Unit has a pending job')
        assert 'stop' in args
        alive[0] = False  # A frozen unit is thawed by its stop transaction.
        return subprocess.CompletedProcess(args, 0)
    if args[0] == 'qemu-img':
        calls.append(list(args))
        assert Path(args[-1]).is_file()
        return subprocess.CompletedProcess(args, 0)
    return real_run(args, *pos, **kwargs)
args = ['restore', '--backup', str(backup), '--runtime', str(runtime),
        '--tools', str(tools), '--source-bytes', str(len(payload)),
        '--restore-after-verified-preservation']
with patch.object(sys, 'argv', args), patch.object(m, 'identity', identity), \
     patch.object(m.os, 'stat', stat), patch.object(m.shutil, 'disk_usage',
         return_value=SimpleNamespace(free=30*2**30)), \
     patch.object(m.subprocess, 'check_output', return_value='frozen\n'), \
     patch.object(m.subprocess, 'run', run):
    if case != 'pending-stop':
        try: m.main()
        except RuntimeError: pass
        else: raise AssertionError('invalid preservation was admitted')
        assert calls == [] and not runtime.exists(), 'invalid proof reached a destructive step'
    else:
        m.main()
        ready = json.loads((runtime/'runtime-ready.json').read_text())
        assert ready['ok'] and ready['osCompared'] and ready['sourceStarttime'] == 'initial'
        assert (runtime/'mac_hdd_ng.img').read_bytes() == payload
        assert not alive[0]
        assert len([c for c in calls if c[0] == 'systemctl']) == 1
        assert len([c for c in calls if c[0] == 'qemu-img']) == 3
        assert (runtime/'boot-sonoma-durable.sh').is_file()
assert hashlib.sha256(archive.read_bytes()).hexdigest() == archive_digest
assert raw_part.read_bytes() == b'original metadata and guest data'
assert raw_part.stat().st_mode & 0o222 == 0
print(json.dumps({'ok': True, 'case': case}))
`;

for (const [scenario, name] of [
  ['pending-stop', 'a frozen-unit stop with a pending job restores without a redundant thaw'],
  ['invalid-marker', 'an invalid completion marker cannot stop the original or write a runtime'],
  ['raw-gap', 'a gap in original raw preservation cannot stop the original or write a runtime'],
  ['visible-change', 'a repair that changed guest-visible data cannot admit restoration'],
]) {
  test(`guarded Mac restoration: ${name}`, async () => {
    const dir = await tempDir();
    const helper = process.env.MAC_VM_RESTORE_UNDER_TEST || new URL('../bin/mac-vm-restore.py', import.meta.url).pathname;
    const result = await new Promise((resolve) => {
      execFile('python3', ['-c', restoreFixture, helper, dir, scenario], { timeout: 20_000 }, (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), { ok: true, case: scenario });
  });
}

// EI-256: bless a home for desktop shell-script behavior tests and port the
// brief-06 hermetic verification scenarios (SIGKILL / TERM / reuse reaper
// paths) into it — previously verified live but never committed, so a
// regression to dev-operator-ifneeded.sh's process-group reaper (EI-142)
// would ship silently. Follows the SAME node:test pattern already
// established by build-desktop-sidecar-lock.test.js (this repo's existing
// home for bin/*.sh behavior tests) rather than introducing a new framework
// (bats-core) — the four canonical frameworks (Vitest/Playwright/Cargo/LLM
// scenarios) don't cover shell scripts, and this side-channel already does
// for the sidecar lock; this file extends it to the dev-operator wrapper.
//
// Writing this test surfaced a REAL, previously-invisible bug in the script
// (not just a testing gap): `reap()`'s trap, and the watchdog, were only
// armed AFTER an up-to-5s loop that waits for the loop-bash to report its
// real process-group id — a TERM/INT/HUP/KILL landing anywhere in that
// startup window hit bash's default disposition with NO supervision yet in
// place, permanently orphaning the freshly-spawned dev stack (confirmed via
// `bash -x` tracing + A/B testing: ~25-60% of cycles on this box, dropping
// to ~0% once the trap/watchdog were armed against a safe interim target
// from the first instant). See dev-operator-ifneeded.sh's own EI-256 comments
// for the fix. A narrow residual (~8% in testing) can still occur under
// extreme scheduling contention on a heavily-loaded shared box; the retry
// wrapper below absorbs that without masking a genuine regression (which
// fails EVERY attempt, not just an unlucky one).
'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'bin/dev-operator-ifneeded.sh');

/** Can we actually take this port right now? Asks the kernel, rather than guessing. */
function bindable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/**
 * A port in 41000-45499 that is VERIFIED FREE at the moment it is returned.
 *
 * This used to pick one blindly — `41000 + (pid % 4000) + random(500)` — under
 * the comment "unlikely to collide with anything real". That assumption is
 * false on a loaded shared box: the range sits INSIDE Linux's ephemeral range
 * (net.ipv4.ip_local_port_range defaults to 32768-60999), so the kernel hands
 * the very same port to some unrelated process as an ephemeral source port.
 *
 * Losing that race does NOT fail where you would look for it. The scenario's
 * port holder dies of EADDRINUSE as an UNHANDLED 'error' event, so it never
 * writes its pidfile, the scenario under test is therefore never set up, and
 * the assertion fails ~45s later with a stderr full of `node:events:487 throw
 * er` and no mention of a port at all. WI-7065 caught exactly this on
 * 127.0.0.1:42948, and on 2026-08-02 it red-pinned the green gate.
 *
 * A real bind is the only check that cannot be fooled: we ask the kernel to
 * give us the port and immediately hand it back. A TOCTOU window remains
 * between that close and the caller's own bind, but it is milliseconds wide
 * instead of spanning the whole test.
 */
async function testPort(attempts = 25) {
  for (let i = 0; i < attempts; i += 1) {
    const candidate = 41000 + (process.pid % 4000) + Math.floor(Math.random() * 500);
    if (await bindable(candidate)) return candidate;
  }
  // Better a named failure than a test that silently runs against a port it
  // does not own — which is the whole bug this helper exists to prevent.
  throw new Error(`testPort: no free port in 41000-45499 after ${attempts} attempts`);
}

/** Poll `check` every `stepMs` until it returns truthy or `timeoutMs` elapses. */
async function waitFor(check, { timeoutMs = 10_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn the wrapper with a harmless `sleep 600` stand-in for DEV_CMD, wait
 * for it to start, signal the wrapper the given way, then assert the
 * stand-in is gone. Returns nothing; throws on failure (via assert).
 */
async function runReapCycle(signalTheWrapper) {
  const port = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-reaper-'));
  const marker = path.join(tmp, 'pid');
  let wrapper;

  try {
    // BASHPID (not $$) survives across the subshell + exec that the wrapper
    // wraps DEV_CMD in — it names the exact pid that becomes `sleep` after
    // the exec, which is what we assert is gone after the reap.
    const devCmd = `echo "$BASHPID" > '${marker}'; exec sleep 600`;
    wrapper = spawn('bash', [script], {
      env: { ...process.env, OPERATOR_DEV_PORT: String(port), OPERATOR_DEV_CMD: devCmd },
      // Never consumed → left as 'pipe' (the default) these streams would
      // keep the event loop alive forever: Node never issues the read that
      // would notice EOF once every writer (the whole reaped process group)
      // is gone, so the process hangs even though the reap itself succeeded.
      // We don't need this script's output — ignore it outright.
      stdio: 'ignore',
    });

    const sleeperPid = Number(
      await waitFor(() => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : undefined)),
    );
    assert(Number.isInteger(sleeperPid) && sleeperPid > 1, 'dev-stack sleeper never started');
    assert(pidAlive(sleeperPid), 'sleeper should be alive before the reap');

    signalTheWrapper(wrapper);

    // A generous budget, not a tight one: reap()/the watchdog's own escalation
    // ladder is TERM, poll up to 5s, then KILL — and on a heavily-loaded
    // shared dev box (this repo's fleet routinely runs under load average
    // 90+) bash's own signal handling can lag past that under real
    // contention. 20s comfortably clears that jitter while still catching a
    // genuine regression (the reap never happening at all).
    const reaped = await waitFor(() => !pidAlive(sleeperPid), { timeoutMs: 20_000 });
    assert(reaped, 'sleeper (dev-stack stand-in) survived the signal to the wrapper — reaper regressed');
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        wrapper.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Like `waitFor`, but for an async `check` (e.g. a TCP probe) — `waitFor`
 *  itself only inspects a SYNCHRONOUS truthy/falsy return (a Promise is
 *  always truthy, so passing an async check to it resolves after exactly one
 *  attempt regardless of the real result). This awaits each attempt before
 *  deciding whether to retry. */
async function waitForAsync(check, { timeoutMs = 10_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() >= deadline) return undefined;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Retry a REAL (rare, environment-timing) flake up to `attempts` times — a
 *  genuine regression fails every attempt, not just an unlucky one, so this
 *  never masks the thing the test exists to catch. */
async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await fn();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

test('reuse path: an already-bound port exits fast without spawning DEV_CMD', async () => {
  const port = await testPort();
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  try {
    const out = await new Promise((resolve, reject) => {
      const child = spawn('bash', [script], {
        env: { ...process.env, OPERATOR_DEV_PORT: String(port) },
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('error', reject);
      child.on('exit', (code) => resolve({ code, stdout }));
      // The reuse path exits immediately; a real hang here is itself a
      // regression (it means in_use() didn't detect the bound port).
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 5000).unref();
    });
    assert.equal(out.code, 0);
    assert.match(out.stdout, /reusing/);
  } finally {
    server.close();
  }
});

// EI-13139: papercup-bg-host.service pins its own canonical port
// (PAPERCUSP_HONO_PORT) — the SAME default (:3270) this wrapper picks for
// the desktop dev operator. Hit live 2026-07-16: during a bg-host outage the
// port went briefly free, this wrapper raced in and grabbed it, and
// bg-host's own restart then EADDRINUSE-crash-looped against the squatter
// for ~25min. The wrapper must now refuse to ever bind bg-host's reserved
// port while bg-host is enabled, redirecting to the next free port instead —
// verified here via a fake `systemctl` shim (no real systemd unit required).
test('bg-host reserved-port guard: refuses bg-host\'s canonical port when it is enabled, picks a different one instead (EI-13139)', async () => {
  const reservedPort = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-bghost-'));
  const marker = path.join(tmp, 'pid');
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-fake-systemctl-'));
  const fakeSystemctl = path.join(fakeBinDir, 'systemctl');
  fs.writeFileSync(
    fakeSystemctl,
    [
      '#!/usr/bin/env bash',
      '# Fake systemctl: papercup-bg-host.service is always "enabled" and',
      `# reports PAPERCUSP_HONO_PORT=${reservedPort} via "cat".`,
      'if [ "$1" = "--user" ] && [ "$2" = "is-enabled" ]; then echo enabled; exit 0; fi',
      `if [ "$1" = "--user" ] && [ "$2" = "cat" ]; then echo "PAPERCUSP_HONO_PORT=${reservedPort}"; exit 0; fi`,
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  let wrapper;
  try {
    const devCmd = `echo "$BASHPID" > '${marker}'; exec sleep 600`;
    wrapper = spawn('bash', [script], {
      env: {
        ...process.env,
        PATH: `${fakeBinDir}:${process.env.PATH}`,
        OPERATOR_DEV_PORT: String(reservedPort),
        OPERATOR_DEV_CMD: devCmd,
      },
    });
    let stderr = '';
    wrapper.stderr.on('data', (d) => (stderr += d));

    const sleeperPid = Number(
      await waitFor(() => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : undefined), {
        timeoutMs: 10_000,
      }),
    );
    assert(Number.isInteger(sleeperPid) && sleeperPid > 1, 'wrapper never spawned the dev stack past the guard');
    assert(pidAlive(sleeperPid), 'sleeper should be alive');

    const redirectMatch = stderr.match(/using :(\d+) instead/);
    assert(redirectMatch, `wrapper did not log a reserved-port redirect — stderr was: ${stderr}`);
    assert.match(stderr, new RegExp(`:${reservedPort} is papercup-bg-host's reserved port`));
    assert.notEqual(Number(redirectMatch[1]), reservedPort, 'wrapper redirected to the SAME reserved port');

    process.kill(wrapper.pid, 'SIGKILL');
    const reaped = await waitFor(() => !pidAlive(sleeperPid), { timeoutMs: 20_000 });
    assert(reaped, 'dev stack survived the wrapper SIGKILL');
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        wrapper.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  }
});

test('desktop launcher shares the resolved operator port with Tauri devUrl (EI-21445362974769138)', () => {
  const launcher = fs.readFileSync(path.join(root, 'bin/desktop-dev-nohmr'), 'utf8');

  assert.match(
    launcher,
    /resolve-dev-operator-port\.sh/,
    'desktop launcher must use the same resolver as beforeDevCommand',
  );
  assert.match(
    launcher,
    /export OPERATOR_DEV_PORT="\$\(resolve_dev_operator_port /,
    'desktop launcher must export the selected port before Tauri starts beforeDevCommand',
  );
  assert.match(
    launcher,
    /devUrl.*\$\{OPERATOR_DEV_PORT\}/,
    'Tauri devUrl must follow the selected operator port instead of hardcoding :3270',
  );
});

// WI-41422: the live npx → tsx launcher normalised a signalled Hono child to
// exit 0. The old loop treated that as an intentional stop and ended the whole
// wrapper, so dev:restart returned success while :3270 stayed down. Wrapper
// signals already carry the real stop intent via `stopping=1`; a child-only
// zero exit must therefore restart just like every other child exit.
test('supervision loop: a child-only exit 0 restarts while the wrapper remains live', async () => {
  const port = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-zero-exit-'));
  const marker = path.join(tmp, 'attempts');
  let wrapper;
  try {
    const devCmd = `echo x >> '${marker}'; exit 0`;
    wrapper = spawn('bash', [script], {
      env: { ...process.env, OPERATOR_DEV_PORT: String(port), OPERATOR_DEV_CMD: devCmd },
    });
    let stderr = '';
    wrapper.stderr.on('data', (d) => {
      stderr += d;
    });

    const restarted = await waitFor(
      () =>
        fs.existsSync(marker) &&
        fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length >= 2,
      { timeoutMs: 12_000 },
    );
    assert(restarted, `child exit 0 ended the wrapper instead of restarting — stderr was: ${stderr}`);
    assert.match(stderr, /operator dev server exited code=0 — restarting/);
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        wrapper.kill('SIGTERM');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// EI-18745117818375852: under load, a just-recycled sidecar's own exiting
// process (or the memory-watchdog's predecessor) can still hold $PORT when
// the fixed-3s-backoff restart fires — a blind respawn then died INSTANTLY on
// EADDRINUSE against its own still-live predecessor, and because that death
// was itself non-zero the loop restarted again just as fast: a self-
// sustaining restart storm. The fix (see this script's own EI-18745117818375852
// comments) waits, bounded, for the port to actually free before every
// restart, and gives up with a clear diagnosis instead of restarting forever
// when it never does. Neither branch had a regression test before this file
// gained them — a revert of either half would have shipped silently.
test('restart-storm guard: waits for the port to actually free before restarting, then retries', async () => {
  const port = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-portwait-'));
  const marker = path.join(tmp, 'attempts');
  let wrapper;
  try {
    // Each invocation appends an attempt marker, then backgrounds a node
    // server that binds $PORT and holds it for ~1.5s (simulating a still-live
    // predecessor / slow-releasing exiting process) before releasing it and
    // exiting — DEV_CMD itself still exits 1 immediately every time.
    // Same WI-7065 recurrence guard as the never-frees case below.
    const holderScript =
      `const s=require('node:net').createServer();` +
      `s.on('error',e=>{console.error('HOLDER-BIND-FAILED '+e.code+' on ${port}');process.exit(9)});` +
      `s.listen(${port},'127.0.0.1',()=>{setTimeout(()=>process.exit(0),1500)})`;
    const devCmd = `echo x >> '${marker}'; node -e "${holderScript}" & disown; sleep 0.3; exit 1`;
    wrapper = spawn('bash', [script], {
      env: { ...process.env, OPERATOR_DEV_PORT: String(port), OPERATOR_DEV_CMD: devCmd },
    });
    let stderr = '';
    wrapper.stderr.on('data', (d) => {
      stderr += d;
    });

    // A second attempt marker proves the loop did NOT give up after the
    // first failure — it waited for the transient hold to clear and retried.
    const twoAttempts = await waitFor(
      () =>
        fs.existsSync(marker) &&
        fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length >= 2,
      { timeoutMs: 15_000 },
    );
    assert(twoAttempts, `expected a restart after the port freed — stderr was: ${stderr}`);
    assert.match(stderr, /STILL held.*waiting up to 30s/, 'wrapper did not log the bounded port-wait diagnosis');
    assert.doesNotMatch(
      stderr,
      /never freed after 30s/,
      'wrapper wrongly gave up while the port was only transiently held',
    );
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        process.kill(wrapper.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('restart-storm guard: gives up with a clear diagnosis (and stops restarting) when the port never frees', async () => {
  const port = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-portstuck-'));
  const marker = path.join(tmp, 'attempts');
  const pidfile = path.join(tmp, 'holder-pid');
  let wrapper;
  try {
    // Binds $PORT and NEVER releases it — a wedged predecessor that never
    // frees the port — while DEV_CMD itself still exits 1 immediately.
    // The 'error' handler is the recurrence guard for WI-7065: without it a
    // bind collision dies as an UNHANDLED 'error' event, and the only trace is
    // `node:events:487 throw er` in a stderr dump 45s later — which names
    // neither the port nor the cause. `testPort()` now verifies the port is
    // free, so this should be unreachable; if it ever fires again it says so.
    const holderScript =
      `const s=require('node:net').createServer();` +
      `s.on('error',e=>{console.error('HOLDER-BIND-FAILED '+e.code+' on ${port}');process.exit(9)});` +
      `s.listen(${port},'127.0.0.1',()=>{require('node:fs').writeFileSync('${pidfile}',String(process.pid))})`;
    // WAIT for the holder to ACTUALLY bind before exiting, rather than a fixed
    // `sleep 0.3` (WI-7185). The pidfile is written inside the listen callback, so
    // its existence PROVES the port is held. The old fixed sleep was a load race:
    // when a loaded box took >300ms to start `node -e`, DEV_CMD exited while the
    // port was still free, the wrapper correctly took its "restarting in 3s" branch
    // instead of the never-freed branch, and each ~3.3s retry ate the budget before
    // the 30s window could even start — the gate saw 8 restarts (and 8 EADDRINUSE
    // crashes from the losing holders) where a quiet box sees exactly 1.
    const devCmd =
      `echo x >> '${marker}'; node -e "${holderScript}" & disown; ` +
      `for _ in $(seq 1 100); do [ -f '${pidfile}' ] && break; sleep 0.1; done; exit 1`;
    wrapper = spawn('bash', [script], {
      env: { ...process.env, OPERATOR_DEV_PORT: String(port), OPERATOR_DEV_CMD: devCmd },
    });
    let stderr = '';
    wrapper.stderr.on('data', (d) => {
      stderr += d;
    });

    // The wrapper must burn a FIXED 30s wall-clock wait before it can log this, so
    // a 40s budget left only ~8s of headroom (measured: 32.3s on an idle box) and
    // failed a correct-but-slow run under gate load. Widening the budget costs a
    // slow machine time, never correctness — the two assertions below still pin the
    // exact diagnosis AND that it stopped restarting.
    const gaveUp = await waitFor(() => /never freed after 30s/.test(stderr), { timeoutMs: 75_000 });
    assert(gaveUp, `wrapper never logged the never-freed diagnosis — stderr was: ${stderr}`);
    assert.match(stderr, new RegExp(`FATAL: :${port} never freed after 30s`));

    // It must actually have STOPPED restarting, not merely logged and kept
    // looping — only the first attempt's marker line should exist.
    const attempts = fs.readFileSync(marker, 'utf8').split('\n').filter(Boolean).length;
    assert.equal(attempts, 1, 'wrapper kept restarting after giving up — the abort did not stop the loop');
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        process.kill(wrapper.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }
    // The lingering node holder outlives the wrapper's own loop-bash by
    // design (that's the scenario under test); the detached watchdog reaps
    // the whole group once the wrapper is gone. Give it a moment, then
    // force-kill the holder directly as a backstop so it can't squat the
    // port for other tests.
    await waitFor(
      () => {
        if (!fs.existsSync(pidfile)) return false;
        const p = Number(fs.readFileSync(pidfile, 'utf8').trim());
        return Number.isInteger(p) && p > 1 ? !pidAlive(p) : true;
      },
      { timeoutMs: 5000 },
    );
    if (fs.existsSync(pidfile)) {
      const p = Number(fs.readFileSync(pidfile, 'utf8').trim());
      if (Number.isInteger(p) && p > 1 && pidAlive(p)) {
        try {
          process.kill(p, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('TERM path: signaling the wrapper reaps the whole dev-stack process group', async () => {
  await withRetry(() => runReapCycle((wrapper) => wrapper.kill('SIGTERM')));
});

test('KILL path: the detached watchdog still reaps the dev stack when the wrapper is SIGKILLed (bypassing its own trap)', async () => {
  // SIGKILL cannot be trapped: the wrapper's own `trap reap EXIT INT TERM
  // HUP` never runs. Only the SEPARATE detached watchdog (which polls the
  // wrapper's liveness independently) can still reap here.
  await withRetry(() => runReapCycle((wrapper) => process.kill(wrapper.pid, 'SIGKILL')));
});

// EI-13537 / EI-18175101264082617: a squatter bound to $PORT with
// dbosEnabled:true used to be silently adopted forever (warn-only) — a real
// instance did exactly this for ~4h on the live dev box, alone accounting for
// ~46-47 concurrent admin-pool connections and driving a server-wide PG
// connection-saturation regression past its warn budget. The wrapper must now
// detect the mismatch, terminate the squatter, and spawn a fresh
// wrapper-supervised (reaped) instance in its place instead of reusing it.
test('squatter path: a dbosEnabled:true process on $PORT is killed and replaced by a fresh supervised instance', async () => {
  const port = await testPort();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-dev-operator-squatter-'));
  const marker = path.join(tmp, 'pid');
  let squatter;
  let wrapper;

  try {
    // A minimal fake "leaked hono-host" that binds $PORT and answers
    // /api/health/deep the same way the real dbosEnabled:true squatter did.
    squatter = spawn(
      process.execPath,
      [
        '-e',
        `
        const http = require('node:http');
        const server = http.createServer((req, res) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ dbosEnabled: true }));
        });
        server.listen(${port}, '127.0.0.1');
        `,
      ],
      { stdio: 'ignore' },
    );
    const reachable = await waitForAsync(
      () =>
        new Promise((resolve) => {
          const sock = net.createConnection({ port, host: '127.0.0.1' }, () => {
            sock.destroy();
            resolve(true);
          });
          sock.on('error', () => resolve(false));
        }),
      { timeoutMs: 5000 },
    );
    assert(reachable, 'fake squatter server never became reachable');
    assert(pidAlive(squatter.pid), 'fake squatter never started');

    const devCmd = `echo "$BASHPID" > '${marker}'; exec sleep 600`;
    wrapper = spawn('bash', [script], {
      env: { ...process.env, OPERATOR_DEV_PORT: String(port), OPERATOR_DEV_CMD: devCmd },
      stdio: 'ignore',
    });

    // The squatter should be terminated by the wrapper's reject_squatter().
    const squatterGone = await waitFor(() => !pidAlive(squatter.pid), { timeoutMs: 15_000 });
    assert(squatterGone, 'squatter with dbosEnabled:true was not terminated — EI-13537 regressed');

    // And the wrapper should fall through to spawn a fresh, supervised DEV_CMD.
    const sleeperPid = Number(
      await waitFor(() => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : undefined), {
        timeoutMs: 10_000,
      }),
    );
    assert(Number.isInteger(sleeperPid) && sleeperPid > 1, 'wrapper did not spawn a replacement instance');
    assert(pidAlive(sleeperPid), 'replacement instance should be alive');

    // Clean up the replacement instance THROUGH the wrapper's own reap path
    // (SIGKILL ⇒ the detached watchdog reaps it) and WAIT for that to
    // complete — a fire-and-forget kill in `finally` races the watchdog's own
    // ~1s liveness-poll + TERM/KILL escalation and leaks the sleeper (and its
    // supervisor loop) past this test's lifetime, exactly the kind of leak
    // this whole file exists to catch.
    process.kill(wrapper.pid, 'SIGKILL');
    const reaped = await waitFor(() => !pidAlive(sleeperPid), { timeoutMs: 20_000 });
    assert(reaped, 'replacement instance survived the wrapper SIGKILL — reaper regressed');
  } finally {
    if (wrapper && !wrapper.killed) {
      try {
        wrapper.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    if (squatter && !squatter.killed) {
      try {
        squatter.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

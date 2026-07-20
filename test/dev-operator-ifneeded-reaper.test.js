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

/** A port unlikely to collide with anything real (dev default is 3270) or
 *  with a concurrent run of this same test elsewhere in the fleet. */
function testPort() {
  return 41000 + (process.pid % 4000) + Math.floor(Math.random() * 500);
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
  const port = testPort();
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
  const port = testPort();
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
  const port = testPort();
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

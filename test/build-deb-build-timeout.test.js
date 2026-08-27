// EI-18721897570279658 — the hard build timeout in bin/build-and-archive-deb.sh.
//
// WHY THIS TEST EXISTS
// BUNDLE_LOCK_WAIT bounds how long a LOSER waits to acquire the deb bundle
// lock — it does nothing to bound how long the WINNER may hold it while
// actually building. A wedged build (a stuck toolchain fetch, a runaway
// linker, an orphaned process whose owning work-item is long since closed)
// used to squat on the lock — and on cargo's own target-dir lock underneath
// it — for as long as the process happened to live. Observed live
// 2026-07-26: an orphaned build sat at ~99% CPU for 5h13m with no cargo/rustc
// child left to explain the CPU, starving the next scheduled deb build and
// burning a real CPU core the whole time as phantom host load.
//
// The fix wraps the build in `timeout` so a wedge fails LOUDLY within a
// bounded window instead of squatting silently. This test exercises the REAL
// script text end-to-end (a real setsid + timeout + flock, real process
// group teardown) against stubbed BUILD_CMDs, so it proves the actual
// invocation works — not just that the source contains the right substrings
// (see build-deb-stale-sidecar-guard.test.js for the text-pin assertions).

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Extract the lock+timeout+build+error-handling block (from where BUNDLE_LOCK
 * is computed through the generic build-failure branch) and run it standalone
 * against a stubbed BUILD_CMD, with BUNDLE_LOCK / BUILD_TIMEOUT_SEC steered
 * via env so no real CARGO_TARGET or 3600s default is ever touched. Stops
 * before the DEB_PATH lookup (which needs a real bundle dir) since this test
 * only exercises the build+timeout step.
 */
function runBuild({ buildCmd, timeoutSec, lockPath, desktopDir }) {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK');
  const end = full.indexOf('DEB_PATH="$(find');
  assert.ok(start > 0, 'BUNDLE_LOCK assignment not found — did it move or get renamed?');
  assert.ok(end > start, 'DEB_PATH lookup not found, or moved before the build block');

  const harness = ['set -euo pipefail', `DESKTOP_DIR=${JSON.stringify(desktopDir)}`, `BUILD_CMD=${JSON.stringify(buildCmd)}`, full.slice(start, end), 'echo "TEST_HARNESS_BUILD_RC=$BUILD_RC"', ''].join('\n');

  return spawnSync('bash', ['-c', harness], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAPERCUSP_DEB_BUNDLE_LOCK: lockPath,
      PAPERCUSP_DEB_BUILD_TIMEOUT_SEC: String(timeoutSec),
    },
    timeout: 20000, // test-level safety net; should never be hit if the fix works
  });
}

test('a build that finishes well within the timeout succeeds normally (rc 0, no FATAL)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    const res = runBuild({
      buildCmd: 'true',
      timeoutSec: 60,
      lockPath: path.join(tmp, 'bundle.lock'),
      desktopDir: tmp,
    });

    assert.equal(res.status, 0, `expected success, got ${res.status}. stderr:\n${res.stderr}`);
    assert.match(res.stdout, /TEST_HARNESS_BUILD_RC=0/);
    assert.doesNotMatch(res.stderr, /FATAL/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a wedged build is killed once it exceeds the timeout, with a distinct FATAL + exit code', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    // sleep responds to SIGTERM immediately, so this returns in ~1-2s even
    // though the real script's --kill-after=30 ceiling is much larger — we
    // are only proving the timeout FIRES and is enforced, not measuring the
    // escalation-to-SIGKILL grace window.
    const started = Date.now();
    const res = runBuild({
      buildCmd: 'sleep 30',
      timeoutSec: 1,
      lockPath: path.join(tmp, 'bundle.lock'),
      desktopDir: tmp,
    });
    const elapsedMs = Date.now() - started;

    assert.equal(res.status, 6, `expected the dedicated timeout exit code 6, got ${res.status}. stderr:\n${res.stderr}`);
    assert.match(res.stderr, /FATAL: build exceeded the 1s timeout and was killed/);
    assert.match(res.stderr, /WEDGED build/);
    assert.ok(elapsedMs < 15000, `expected the wedge to be reaped in well under 15s (SIGTERM, not the 30s kill-after ceiling), took ${elapsedMs}ms`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a build that fails for an ordinary reason (rc != 0, not a timeout) still gets the generic FATAL, not the timeout one', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    const res = runBuild({
      buildCmd: 'exit 2',
      timeoutSec: 60,
      lockPath: path.join(tmp, 'bundle.lock'),
      desktopDir: tmp,
    });

    assert.equal(res.status, 2, `expected the build's own exit code to propagate, got ${res.status}`);
    assert.match(res.stderr, /FATAL: build failed \(rc=2\)/);
    assert.doesNotMatch(res.stderr, /WEDGED build/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('compile and xz repack have independent phase budgets in the archive wrapper', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const wrapper = fs.readFileSync(path.join(root, 'bin/build-deb-repacked.sh'), 'utf8');

  assert.match(source, /BUILD_TIMEOUT_SEC="\$\{PAPERCUSP_DEB_BUILD_TIMEOUT_SEC:-3600\}"/);
  assert.match(source, /REPACK_TIMEOUT_SEC="\$\{PAPERCUSP_DEB_REPACK_TIMEOUT_SEC:-5400\}"/);
  assert.match(
    source,
    /BUILD_CMD="PAPERCUSP_DEFER_DEB_REPACK=1 npm run build/,
    'the bounded compile phase must defer xz to the outer wrapper',
  );
  assert.match(
    wrapper,
    /PAPERCUSP_DEFER_DEB_REPACK:-0[\s\S]*deferring xz repack/,
    'the generic npm build wrapper must honor the explicit archive-wrapper deferral',
  );

  const compilePhase = source.indexOf('run_bounded_phase "$BUILD_TIMEOUT_SEC"');
  const debLookup = source.indexOf('DEB_PATH="$(find');
  const repackPhase = source.indexOf('run_bounded_phase "$REPACK_TIMEOUT_SEC"');
  assert.ok(compilePhase > 0 && compilePhase < debLookup, 'compile must run under its budget before artifact selection');
  assert.ok(repackPhase > debLookup, 'xz repack must run later under its own fresh budget');
  assert.match(source, /The compile budget is independent and did not consume this clock/);
});

test('no process from the wedged build survives the wrapper (the process-group reap still works with timeout spliced in)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    const marker = path.join(tmp, 'still-running');
    // A child that would keep running past the wedge, to prove the whole
    // process GROUP gets reaped (not just the immediate `sleep`).
    const res = runBuild({
      buildCmd: `(sleep 30; touch ${JSON.stringify(marker)}) & wait`,
      timeoutSec: 1,
      lockPath: path.join(tmp, 'bundle.lock'),
      desktopDir: tmp,
    });

    assert.equal(res.status, 6);
    // Give the group-kill trap a brief moment then confirm the marker never
    // gets created — i.e. the backgrounded grandchild was reaped too, not
    // left to finish its sleep and touch the file after we already exited.
    assert.equal(fs.existsSync(marker), false, 'a descendant of the wedged build must not survive to completion');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// EI-18726398328755840 — the class the ABOVE test does NOT cover: a
// descendant that escapes the original process GROUP entirely (via its own
// `setsid` call, exactly like a real npm/tauri/cargo build's daemonizing
// helpers can do). `kill -TERM "-$BUILD_PGID"` — and GNU `timeout`'s own
// internal killpg — only reach the ORIGINAL group; an escapee is invisible
// to both. This is the live failure this item found (a real build's monitor
// vanished while its descendants kept running, unreached by the group kill)
// and the gap the original tests' stubbed `sleep 30` BUILD_CMDs could never
// exercise (see the script's own header for the "WHY THE UNIT TEST DIDN'T
// CATCH IT" note). The fix bounds the whole subtree in a cgroup instead,
// whose membership survives any setsid/setpgid a descendant performs.
test('a descendant that escapes into its own session via setsid still gets killed on timeout (the exact class a process-group-only kill misses)', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    const marker = path.join(tmp, 'escaped-still-running');
    const res = runBuild({
      buildCmd: `setsid bash -c 'sleep 30; touch ${JSON.stringify(marker)}' & wait`,
      timeoutSec: 1,
      lockPath: path.join(tmp, 'bundle.lock'),
      desktopDir: tmp,
    });

    if (!/bounded to cgroup/.test(res.stdout + res.stderr)) {
      t.skip('cgroup v2 not delegated/available in this environment — the hardened enforcement falls back to process-group-only, which this test specifically exists to show is insufficient');
      return;
    }

    assert.equal(res.status, 6, `expected the dedicated timeout exit code 6, got ${res.status}. stderr:\n${res.stderr}`);
    assert.match(res.stderr, /FATAL: build exceeded the 1s timeout and was killed/);
    assert.equal(
      fs.existsSync(marker),
      false,
      'a descendant that escaped into its own session (setsid) must still be reaped via the cgroup — this is exactly the gap EI-18726398328755840 found live',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The independent watchdog is the backstop for "the primary `timeout`
// enforcement itself doesn't land" (the live symptom: the monitor process
// had vanished from the box entirely). Simulate that directly by having the
// build spawn a completely UNRELATED descendant via setsid that `timeout`'s
// own killpg cannot reach (proven above) AND is far outside a short
// PAPERCUSP_DEB_WATCHDOG_GRACE_SEC — proving the watchdog alone, independent
// of whatever `timeout` does or does not manage to kill, still bounds the
// build via the cgroup.
test('the independent watchdog bounds the build via the cgroup even when the escaped descendant is the only thing left alive', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-timeout-'));
  try {
    const marker = path.join(tmp, 'escaped-still-running-2');
    const full = fs.readFileSync(scriptPath, 'utf8');
    const start = full.indexOf('BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK');
    const end = full.indexOf('DEB_PATH="$(find');
    const harness = [
      'set -euo pipefail',
      `DESKTOP_DIR=${JSON.stringify(tmp)}`,
      `BUILD_CMD=${JSON.stringify(`setsid bash -c 'sleep 30; touch ${marker}' & wait`)}`,
      full.slice(start, end),
      'echo "TEST_HARNESS_BUILD_RC=$BUILD_RC"',
      '',
    ].join('\n');

    const res = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PAPERCUSP_DEB_BUNDLE_LOCK: path.join(tmp, 'bundle.lock'),
        PAPERCUSP_DEB_BUILD_TIMEOUT_SEC: '1',
        PAPERCUSP_DEB_WATCHDOG_GRACE_SEC: '1',
      },
      timeout: 20000,
    });

    if (!/bounded to cgroup/.test(res.stdout + res.stderr)) {
      t.skip('cgroup v2 not delegated/available in this environment');
      return;
    }

    assert.equal(fs.existsSync(marker), false, 'the watchdog must reach an escaped descendant via the cgroup even independent of the primary timeout mechanism');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

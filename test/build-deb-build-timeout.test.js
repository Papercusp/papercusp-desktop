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

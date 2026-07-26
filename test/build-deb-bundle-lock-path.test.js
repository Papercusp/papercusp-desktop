// EI-18721802836296042 — the deb bundle lock's default path must track
// CARGO_TARGET_DIR, not a single fixed /tmp path.
//
// WHY THIS TEST EXISTS
// bin/build-and-archive-deb.sh serializes concurrent `tauri build` runs against
// the shared $CARGO_TARGET/<profile>/bundle/deb staging directory with a flock.
// That's correct for the common case (CARGO_TARGET_DIR unset, everyone sharing
// $HOME/.cargo-target). But an agent who deliberately isolates CARGO_TARGET_DIR
// (the documented workaround for this exact collision class) has a provably
// disjoint bundle dir — yet, before this fix, still contended the SAME global
// /tmp lock as every other build on the box. Hit live 2026-07-26: an
// isolated-target build queued 11+ minutes behind an unrelated peer's ~5h-old
// build on the shared default target dir, nearly hitting the 3600s lock
// timeout on a critical-path deb.
//
// The fix derives the default lock path from CARGO_TARGET so an isolated
// target dir automatically gets an isolated lock too, with no extra env var to
// remember. This test pins that behavior against the REAL script text (not a
// copy that can drift) without running an actual tauri build.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Extract just the CARGO_TARGET + BUNDLE_LOCK computation (through the
 * mkdir -p that ensures its parent dir exists) from the real script and run
 * it standalone, printing both values. Stops well before the flock
 * acquisition / build invocation so this never contends a real lock or
 * spawns a build.
 */
function computeLockPath({ cargoTargetDir, explicitLock } = {}) {
  const full = fs.readFileSync(scriptPath, 'utf8');

  const targetLineStart = full.indexOf('CARGO_TARGET="');
  assert.ok(targetLineStart > 0, 'CARGO_TARGET assignment not found — did it move or get renamed?');
  const targetLineEnd = full.indexOf('\n', targetLineStart);

  const bundleStart = full.indexOf('BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK');
  assert.ok(bundleStart > 0, 'BUNDLE_LOCK assignment not found — did it move or get renamed?');
  const mkdirLine = 'mkdir -p "$(dirname "$BUNDLE_LOCK")"';
  const mkdirAt = full.indexOf(mkdirLine, bundleStart);
  assert.ok(mkdirAt > bundleStart, 'expected the lock-dir mkdir right after BUNDLE_LOCK is computed');
  const bundleEnd = mkdirAt + mkdirLine.length;

  const harness = [
    'set -euo pipefail',
    full.slice(targetLineStart, targetLineEnd),
    full.slice(bundleStart, bundleEnd),
    'printf \'%s\\n%s\\n\' "$CARGO_TARGET" "$BUNDLE_LOCK"',
    '',
  ].join('\n');

  const env = { ...process.env };
  if (cargoTargetDir === undefined) delete env.CARGO_TARGET_DIR;
  else env.CARGO_TARGET_DIR = cargoTargetDir;
  if (explicitLock === undefined) delete env.PAPERCUSP_DEB_BUNDLE_LOCK;
  else env.PAPERCUSP_DEB_BUNDLE_LOCK = explicitLock;

  const res = spawnSync('bash', ['-c', harness], { encoding: 'utf8', env });
  assert.equal(res.status, 0, `harness failed: ${res.stderr}`);
  const [cargoTarget, bundleLock] = res.stdout.trim().split('\n');
  return { cargoTarget, bundleLock };
}

test('default lock path lives UNDER CARGO_TARGET, not a fixed /tmp path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-lock-path-'));
  try {
    const isolatedTarget = path.join(tmp, 'cargo-target-isolated-A');
    const { cargoTarget, bundleLock } = computeLockPath({ cargoTargetDir: isolatedTarget });

    assert.equal(cargoTarget, isolatedTarget);
    assert.equal(bundleLock, path.join(isolatedTarget, '.deb-bundle.lock'));
    assert.doesNotMatch(bundleLock, /^\/tmp\/papercusp-deb-bundle\.lock$/, 'must not fall back to the old fixed /tmp path');
    assert.ok(fs.existsSync(isolatedTarget), 'mkdir -p must have created the isolated target dir');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('two different CARGO_TARGET_DIR values get two different lock paths (no cross-contention)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-lock-path-'));
  try {
    const a = computeLockPath({ cargoTargetDir: path.join(tmp, 'cargo-target-A') });
    const b = computeLockPath({ cargoTargetDir: path.join(tmp, 'cargo-target-B') });

    assert.notEqual(a.bundleLock, b.bundleLock);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unset CARGO_TARGET_DIR still serializes the common case under $HOME/.cargo-target', () => {
  const { bundleLock } = computeLockPath({});
  const expectedHome = process.env.HOME || os.homedir();

  assert.equal(bundleLock, path.join(expectedHome, '.cargo-target', '.deb-bundle.lock'));
});

test('an explicit PAPERCUSP_DEB_BUNDLE_LOCK still overrides the derived default', () => {
  const { bundleLock } = computeLockPath({
    cargoTargetDir: '/home/x/.cargo-target-isolated-A',
    explicitLock: '/tmp/my-custom-lock',
  });

  assert.equal(bundleLock, '/tmp/my-custom-lock');
});

test('the lock parent directory is created before the flock is opened against it', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const bundleAt = full.indexOf('BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK');
  const mkdirAt = full.indexOf('mkdir -p "$(dirname "$BUNDLE_LOCK")"');
  const execAt = full.indexOf('exec 9>"$BUNDLE_LOCK"');

  assert.ok(bundleAt > 0 && mkdirAt > bundleAt, 'mkdir must come after BUNDLE_LOCK is assigned');
  assert.ok(execAt > mkdirAt, 'the lock fd must only be opened after its parent dir is ensured to exist');
});

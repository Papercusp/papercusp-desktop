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
// Overridable ONLY so scripts/mutation-probe.sh can point this guard at a
// frozen copy (historical / copy-out mode) without touching the shared tree.
const scriptPath = process.env.PAPERCUSP_BUILD_DEB_SCRIPT || path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Extract just the CARGO_TARGET + BUNDLE_LOCK computation (through the
 * mkdir -p that ensures its parent dir exists) from the real script and run
 * it standalone, printing both values. Stops well before the flock
 * acquisition / build invocation so this never contends a real lock or
 * spawns a build.
 */
/**
 * WI-10003499: CARGO_TARGET now comes from Cargo itself
 * (bin/lib/cargo-target-root.sh), so the harness runs against a HERMETIC Cargo
 * fixture. That is a throwaway crate plus a private CARGO_HOME whose config.toml
 * pins `build.target-dir`. The host's real ~/.cargo/config.toml can then never
 * decide the verdict. The real resolver is symlinked into the fixture, so the
 * code under test is the checked-in file.
 */
const RUSTUP_HOME = process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup');

function makeCargoFixture(configuredTarget) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-cargo-fixture-'));
  fs.mkdirSync(path.join(dir, 'src-tauri', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'),
    '[package]\nname = "deb-lock-fixture"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(dir, 'src-tauri', 'src', 'lib.rs'), '');
  fs.mkdirSync(path.join(dir, 'bin', 'lib'), { recursive: true });
  fs.symlinkSync(path.join(root, 'bin', 'lib', 'cargo-target-root.sh'),
    path.join(dir, 'bin', 'lib', 'cargo-target-root.sh'));
  fs.mkdirSync(path.join(dir, 'cargo-home'));
  fs.writeFileSync(path.join(dir, 'cargo-home', 'config.toml'),
    `[build]\ntarget-dir = ${JSON.stringify(configuredTarget || path.join(dir, 'configured-target'))}\n`);
  return dir;
}

function computeLockPath({ cargoTargetDir, explicitLock, configuredTarget } = {}) {
  const full = fs.readFileSync(scriptPath, 'utf8');

  const sourceLine = 'source "$LIVE_DESKTOP_DIR/bin/lib/cargo-target-root.sh"';
  const targetLineStart = full.indexOf(sourceLine);
  assert.ok(targetLineStart > 0, 'the shared Cargo target resolver is no longer sourced — did CARGO_TARGET regress to a hard-coded default?');
  const assignAt = full.indexOf('CARGO_TARGET="', targetLineStart);
  assert.ok(assignAt > targetLineStart, 'CARGO_TARGET assignment not found — did it move or get renamed?');
  const targetLineEnd = full.indexOf('\n', assignAt);
  const fixture = makeCargoFixture(configuredTarget);

  const bundleStart = full.indexOf('BUNDLE_LOCK="${PAPERCUSP_DEB_BUNDLE_LOCK');
  assert.ok(bundleStart > 0, 'BUNDLE_LOCK assignment not found — did it move or get renamed?');
  const mkdirLine = 'mkdir -p "$(dirname "$BUNDLE_LOCK")"';
  const mkdirAt = full.indexOf(mkdirLine, bundleStart);
  assert.ok(mkdirAt > bundleStart, 'expected the lock-dir mkdir right after BUNDLE_LOCK is computed');
  const bundleEnd = mkdirAt + mkdirLine.length;

  const harness = [
    'set -euo pipefail',
    `LIVE_DESKTOP_DIR=${JSON.stringify(fixture)}`,
    full.slice(targetLineStart, targetLineEnd),
    full.slice(bundleStart, bundleEnd),
    'printf \'%s\\n%s\\n\' "$CARGO_TARGET" "$BUNDLE_LOCK"',
    '',
  ].join('\n');

  const env = {
    ...process.env,
    CARGO_HOME: path.join(fixture, 'cargo-home'),
    RUSTUP_HOME,
  };
  delete env.CARGO_BUILD_TARGET_DIR;
  if (cargoTargetDir === undefined) delete env.CARGO_TARGET_DIR;
  else env.CARGO_TARGET_DIR = cargoTargetDir;
  if (explicitLock === undefined) delete env.PAPERCUSP_DEB_BUNDLE_LOCK;
  else env.PAPERCUSP_DEB_BUNDLE_LOCK = explicitLock;

  try {
    const res = spawnSync('bash', ['-c', harness], { encoding: 'utf8', env });
    assert.equal(res.status, 0, `harness failed: ${res.stderr}`);
    const [cargoTarget, bundleLock] = res.stdout.trim().split('\n');
    return { cargoTarget, bundleLock, fixture };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
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

test('unset CARGO_TARGET_DIR follows the target Cargo is CONFIGURED to use, never $HOME/.cargo-target', () => {
  // WI-10003499: this test used to pin `$HOME/.cargo-target`. Once the box
  // moved `build.target-dir` to the data disk (2026-09-03), that pin kept the
  // script looking where Cargo no longer writes, and a successful build
  // FATAL'd with "emitted no fresh .deb". The common case still serializes on
  // ONE shared lock, now under the configured target.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-lock-path-'));
  try {
    const relocated = path.join(tmp, 'data disk', 'cargo-target');
    const { cargoTarget, bundleLock } = computeLockPath({ configuredTarget: relocated });
    const expectedHome = process.env.HOME || os.homedir();

    assert.equal(cargoTarget, relocated);
    assert.equal(bundleLock, path.join(relocated, '.deb-bundle.lock'));
    assert.notEqual(cargoTarget, path.join(expectedHome, '.cargo-target'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('an exported EMPTY CARGO_TARGET_DIR does not hide the configured target', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-lock-path-'));
  try {
    const relocated = path.join(tmp, 'relocated-target');
    const { cargoTarget } = computeLockPath({ cargoTargetDir: '', configuredTarget: relocated });
    assert.equal(cargoTarget, relocated);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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

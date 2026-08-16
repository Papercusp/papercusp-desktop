/**
 * WI-39358 — when @tauri-apps/cli is missing, tauri-guarded must say so, and say the fix.
 *
 * THE FAILURE THIS PINS. Every branch of bin/tauri-guarded ends in a bare `tauri` (the two
 * `exec tauri` sites, plus bin/build-deb-repacked.sh:65 for Debian-producing commands). With
 * the CLI uninstalled, bash rendered that as:
 *
 *     bin/tauri-guarded: line 100: exec: tauri: not found
 *
 * Measured 2026-08-15: after the WI-39347 `rm -rf /home` incident the tree was re-cloned and
 * the ROOT `npm install` re-run — which structurally cannot install papercusp-desktop, a git
 * submodule with its own package-lock.json that is not a root npm workspace. The owner hit
 * that message and reasonably read it as a recurrence of the deletion incident rather than a
 * one-command missing install. The message, not the missing package, is what cost the time.
 *
 * WHY THESE TESTS ARE SHAPED THIS WAY. They drive the real script end-to-end with a PATH that
 * genuinely lacks `tauri`, rather than grepping the source for the guard. A grep passes if
 * someone moves the check below the target-dir claim, or wraps it in a condition that never
 * fires; running it does not. The negative case (a stub `tauri` on PATH) is what proves the
 * guard is not simply refusing everything — a check that always fires would pass every
 * assertion about the failure and quietly break every real invocation.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const { mkdtempSync, rmSync, writeFileSync, chmodSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const DESKTOP_DIR = join(__dirname, '..');
// Overridable so falsifiability can be proven against a COPY outside the tree
// (scripts/mutation-probe.sh). git-sync commits the whole working tree every few minutes,
// so mutating the real file in place risks committing the mutant.
const GUARD = process.env.PROBE_SCRIPT || join(DESKTOP_DIR, 'bin', 'tauri-guarded');

/**
 * Run the guard with a PATH we fully control. `tauriOnPath: false` reproduces an
 * uninstalled submodule without touching the real node_modules.
 */
function runGuard(args, { tauriOnPath }) {
  const home = mkdtempSync(join(tmpdir(), 'wi39358-home-'));
  const binDir = mkdtempSync(join(tmpdir(), 'wi39358-bin-'));
  try {
    if (tauriOnPath) {
      const shim = join(binDir, 'tauri');
      writeFileSync(shim, '#!/usr/bin/env bash\necho "STUB_TAURI_RAN $*"\n');
      chmodSync(shim, 0o755);
    }
    // A minimal PATH containing only our shim dir plus the system dirs the script itself
    // needs (bash builtins, flock, mkdir). Inheriting process.env.PATH would drag in a
    // real `tauri` from a hoisted .bin and make the negative case untestable.
    return spawnSync('bash', [GUARD, ...args], {
      env: { ...process.env, HOME: home, CARGO_TARGET_DIR: '', PATH: `${binDir}:/usr/bin:/bin` },
      encoding: 'utf8',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
}

test('missing tauri CLI exits 127 rather than falling through to a bare exec failure', () => {
  const result = runGuard(['dev'], { tauriOnPath: false });
  assert.strictEqual(
    result.status,
    127,
    `expected exit 127 (command not found), got ${result.status}. stderr:\n${result.stderr}`,
  );
});

test('the diagnostic names the cause, the fix command, and the doctor check', () => {
  const { stderr } = runGuard(['dev'], { tauriOnPath: false });

  assert.match(stderr, /@tauri-apps\/cli is not installed/, 'must name the missing package');
  assert.match(stderr, /submodule/i, 'must explain WHY a root install did not cover it');
  assert.match(
    stderr,
    /npm run install:safe -- --repo-root papercusp-desktop/,
    'must print the exact repair command, not merely describe it',
  );
  assert.match(stderr, /npm run doctor/, 'must point at the check that catches this earlier');

  // The generic bash message is precisely what this guard exists to replace.
  assert.doesNotMatch(
    stderr,
    /exec: tauri: not found/,
    'the bare bash failure must no longer be how this surfaces',
  );
});

test('the check fires BEFORE any lock or target-dir claim is taken', () => {
  // Ordering is load-bearing: a missing CLI must not leave a claimed target-dir slot or a
  // held sidecar read lock behind. Those paths announce themselves on stderr, so their
  // ABSENCE is the observable.
  const { stderr } = runGuard(['dev'], { tauriOnPath: false });

  assert.doesNotMatch(stderr, /target dir/i, 'must not claim a target-dir slot before failing');
  assert.doesNotMatch(
    stderr,
    /sidecar\.lock|yielded/i,
    'must not acquire (or report yielding) the sidecar read lock before failing',
  );
});

test('CONTROL: with tauri on PATH the guard does not fire and the CLI is reached', () => {
  // Without this, every assertion above would also pass for a guard that rejects
  // unconditionally — i.e. one that breaks every real invocation.
  const result = runGuard(['--version'], { tauriOnPath: true });

  assert.match(
    result.stdout,
    /STUB_TAURI_RAN/,
    `the real CLI must still be exec'd when present. stderr:\n${result.stderr}`,
  );
  assert.doesNotMatch(result.stderr, /@tauri-apps\/cli is not installed/);
  assert.strictEqual(result.status, 0);
});

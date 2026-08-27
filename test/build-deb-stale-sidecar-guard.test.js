// EI-18683847182779973 — the stale-sidecar guard in bin/build-and-archive-deb.sh.
//
// WHY THIS TEST EXISTS
// `tauri build` does not rebuild the sidecar, and src-tauri/sidecar/serve.mjs is
// an esbuild bundle that INLINES its vendored deps. So a patch applied to
// node_modules (patches/*.patch) can be fully present at the source level while
// the artifact the rig executes still carries the pre-patch copy.
//
// The failure mode is not a crash. Instrumentation added by a diagnostic patch
// reads back `undefined` — the FALSY value — which in a diagnostic context is
// usually the "nothing unusual happened" reading. So a stale bundle produces a
// clean CONFIRMATION of whatever hypothesis predicted the falsy value. It
// manufactures agreement rather than failing loudly, which is why this is
// guarded at build time and not left to reviewer discipline.
//
// This class has now nearly cost three investigation runs, so the guard must
// FAIL the build (exit 4), not warn.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

/**
 * Build a throwaway tree shaped like the real one, with a controllable skew
 * between the sidecar stamp and the newest patch file, then run ONLY the guard
 * portion of the script (everything up to the build invocation) against it.
 *
 * We stub `npm run build` so a PASS is observable without a 3GB tauri build:
 * the stub writes a marker file, so "guard allowed the build" is a positive
 * assertion rather than merely "did not exit non-zero".
 */
function runGuard({ stampEpoch, patchEpoch, allowStale = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-stale-sidecar-'));
  try {
    const desktopDir = path.join(tmp, 'papercusp-desktop');
    const sidecarDir = path.join(desktopDir, 'src-tauri/sidecar');
    const patchesDir = path.join(tmp, 'patches');
    fs.mkdirSync(sidecarDir, { recursive: true });
    fs.mkdirSync(patchesDir, { recursive: true });

    fs.writeFileSync(
      path.join(sidecarDir, '.sidecar-build-stamp'),
      JSON.stringify({ serveSha256: 'deadbeef', builtAtUtc: 'x', epochSec: stampEpoch }, null, 2),
    );
    fs.writeFileSync(path.join(sidecarDir, 'serve.mjs'), '// bundle\n');

    const patchFile = path.join(patchesDir, 'hyperdht+6.32.0.patch');
    fs.writeFileSync(patchFile, 'diff --git a/x b/x\n');
    fs.utimesSync(patchFile, patchEpoch, patchEpoch);

    // Extract the guard block plus enough scaffolding to execute it standalone,
    // so the test exercises the REAL script text rather than a copy that can drift.
    const full = fs.readFileSync(scriptPath, 'utf8');
    const start = full.indexOf('# --- STALE-SIDECAR GUARD');
    // End at the bundle-mutex block, NOT at the build echo: everything after this
    // marker acquires a real flock (with a 1h wait) and installs signal traps, so
    // slicing past it would make this unit test contend for the live build lock
    // and potentially hang. Keep the extraction to the guard itself.
    const end = full.indexOf('# --- BUNDLE MUTEX');
    assert.ok(start > 0, 'stale-sidecar guard block not found — did it get renamed or removed?');
    assert.ok(end > start, 'guard must sit before the bundle-mutex block and the build');

    const marker = path.join(tmp, 'build-ran');
    const harness = [
      'set -euo pipefail',
      `DESKTOP_DIR=${JSON.stringify(desktopDir)}`,
      `REPO_DIR=${JSON.stringify(tmp)}`,
      full.slice(start, end),
      `touch ${JSON.stringify(marker)}`,
      '',
    ].join('\n');

    const res = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: { ...process.env, PAPERCUSP_ALLOW_STALE_SIDECAR: allowStale ? '1' : '0' },
    });

    return { ...res, buildRan: fs.existsSync(marker) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('FAILS the build when a patch is newer than the sidecar bundle', () => {
  const res = runGuard({ stampEpoch: 1785055439, patchEpoch: 1785056900 });

  assert.equal(res.status, 4, `expected exit 4, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, false, 'the expensive build must NOT run when the sidecar is stale');
  assert.match(res.stderr, /STALE SIDECAR/);
  // The remediation must name the actual fix command — a guard that only says
  // "stale" sends the next agent hunting through the build graph.
  assert.match(res.stderr, /build-desktop-sidecar\.sh/);
  // And it must tell them to verify the ARTIFACT, since checking node_modules
  // or the .patch file is precisely what fails to catch this.
  assert.match(res.stderr, /serve\.mjs/);
});

test('ALLOWS the build when the sidecar postdates every patch', () => {
  const res = runGuard({ stampEpoch: 1785056900, patchEpoch: 1785055439 });

  assert.equal(res.status, 0, `expected clean pass, got ${res.status}. stderr:\n${res.stderr}`);
  assert.equal(res.buildRan, true, 'a fresh sidecar must not be blocked');
  assert.doesNotMatch(res.stderr, /STALE SIDECAR/);
});

test('PAPERCUSP_ALLOW_STALE_SIDECAR=1 is a working escape hatch', () => {
  const res = runGuard({ stampEpoch: 1785055439, patchEpoch: 1785056900, allowStale: true });

  assert.equal(res.status, 0, `escape hatch should permit the build, got ${res.status}`);
  assert.equal(res.buildRan, true);
});

test('guard sits BEFORE the mutex and the build, so it cannot burn a full tauri build first', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const guardAt = full.indexOf('# --- STALE-SIDECAR GUARD');
  const mutexAt = full.indexOf('# --- BUNDLE MUTEX');
  const buildAt = full.indexOf('setsid timeout');

  assert.ok(guardAt > 0, 'guard block missing');
  assert.ok(mutexAt > 0, 'bundle mutex block missing');
  assert.ok(buildAt > 0, 'build invocation missing');
  assert.ok(guardAt < mutexAt, 'check staleness before taking the lock — do not hold it to fail');
  assert.ok(mutexAt < buildAt, 'the lock must be held before the build starts');
});

// EI-21575353881676545 — the canonical local sidecar+deb flow used to read the
// shared checkout at two different times. A busy Vite build could change dist
// after sidecar verification and make every honest packaging attempt fail.
test('the deb build pins the sidecar provenance commit and packages a private desktop worktree', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');

  assert.match(
    full,
    /SIDECAR_PROVENANCE="\$LIVE_DESKTOP_DIR\/src-tauri\/sidecar\/build-provenance\.json"/,
    'the source boundary must begin with the sidecar writer\'s own provenance',
  );
  assert.match(
    full,
    /git -C "\$LIVE_REPO_DIR" ls-tree "\$DEB_SOURCE_SNAPSHOT_COMMIT" papercusp-desktop/,
    'the root commit must resolve the exact desktop submodule commit it names',
  );
  assert.match(
    full,
    /git -C "\$LIVE_DESKTOP_DIR" worktree add --detach/,
    'packaging must compile a private immutable desktop worktree, not the moving live tree',
  );
  assert.match(
    full,
    /DESKTOP_DIR="\$DEB_SOURCE_SNAPSHOT_DESKTOP"\nREPO_DIR="\$DEB_SOURCE_SNAPSHOT_ROOT"/,
    'all later guards and npm/tauri work must switch to the snapshot paths',
  );
});

test('the immutable source boundary carries the exact sidecar SPA instead of consulting live dist', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const sidecarCopyAt = full.indexOf('snapshot_copy_tree "$LIVE_DESKTOP_DIR/src-tauri/sidecar"');
  const spaCopyAt = full.indexOf('snapshot_copy_tree "$DEB_SOURCE_SNAPSHOT_DESKTOP/src-tauri/sidecar/spa"');
  const switchAt = full.indexOf('DESKTOP_DIR="$DEB_SOURCE_SNAPSHOT_DESKTOP"');
  const buildAt = full.indexOf('run_bounded_phase "$BUILD_TIMEOUT_SEC"');

  assert.ok(sidecarCopyAt > 0, 'the built sidecar must be copied under its reader lock');
  assert.ok(spaCopyAt > sidecarCopyAt, 'the SPA reference must come from the copied sidecar snapshot');
  assert.ok(switchAt > spaCopyAt, 'do not expose the snapshot root until every generated input is present');
  assert.ok(buildAt > switchAt, 'the expensive build must consume only the completed snapshot');
  assert.match(full, /flock -s 8[\s\S]*snapshot_copy_tree "\$LIVE_DESKTOP_DIR\/src-tauri\/sidecar"[\s\S]*flock -u 8/);
});

test('snapshot placement stays on the workspace filesystem and has an EXDEV-safe fallback', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');

  assert.match(
    full,
    /PAPERCUSP_DEB_SNAPSHOT_PARENT:-\$\(dirname "\$LIVE_REPO_DIR"\)\/\.papercusp-build-snapshots/,
    'the multi-GB hardlink snapshot must not default to a potentially separate /tmp mount',
  );
  assert.match(full, /source_dev="\$\(stat -c '%d' "\$source"\)"/);
  assert.match(full, /dest_dev="\$\(stat -c '%d' "\$\(dirname "\$dest"\)"\)"/);
  assert.match(full, /cp -al -- "\$source" "\$dest"/);
  assert.match(full, /cp -a --reflink=auto -- "\$source" "\$dest"/);
});

test('snapshot provenance cannot be bypassed by live patch mtimes and cleanup is part of the existing exit trap', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');

  assert.match(full, /PINNED_SIDECAR_HEAD[\s\S]*DEB_SOURCE_SNAPSHOT_COMMIT/);
  assert.match(full, /cleanup_deb_source_snapshot\n}\ntrap stop_build_group EXIT INT TERM/);
  assert.match(
    full,
    /GIT_SHA="\$\{DEB_SOURCE_SNAPSHOT_COMMIT:0:10\}"/,
    'archive identity must name the pinned boundary, not a later live HEAD',
  );
});

// EI-18698595682442781 — the bundle mutex + process-group ownership.
// These are load-bearing against a SHARED $CARGO_TARGET staging dir; each
// property below corresponds to a way the original code corrupted a peer.

test('the build runs with the lock fd CLOSED so a daemonizing child cannot retain it', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  // Same hazard build-desktop-sidecar-lock.test.js pins for the sidecar build:
  // sccache/node can daemonize and inherit fd 8/9, holding either the sidecar
  // reader or bundle flock after we exit.
  // The reusable bounded-phase runner owns setsid+timeout, while each caller
  // supplies the fd-closing bash command. Pin the build caller specifically;
  // the repack caller closes the same fd independently.
  assert.match(full, /run_bounded_phase "\$BUILD_TIMEOUT_SEC" bash -c 'exec 8>&- 9>&-;/);
});

// EI-18721897570279658 — the hard build timeout.
// BUNDLE_LOCK_WAIT only bounds how long a LOSER waits to acquire the lock; it
// does nothing to bound how long the WINNER may hold it. A wedged build used to
// squat on the lock (and cargo's own target-dir lock) indefinitely — observed
// live as a 5h13m orphaned build burning a full CPU core with nothing to reap
// it. `timeout` now bounds the build's own execution and fails loudly instead.

test('the build is wrapped in a bounded `timeout`, not left to run unbounded', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  assert.match(full, /exec setsid timeout --signal=TERM --kill-after=30 "\$phase_timeout_sec" "\$@"/);
  assert.match(full, /run_bounded_phase "\$BUILD_TIMEOUT_SEC" bash -c/);
});

test('the build timeout has a generous but real default, overridable via env', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  assert.match(full, /BUILD_TIMEOUT_SEC="\$\{PAPERCUSP_DEB_BUILD_TIMEOUT_SEC:-3600\}"/);
});

test('a timeout-killed build (rc 124/137) gets its own clear FATAL message and exit code, distinct from a generic build failure', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const timeoutBlockAt = full.indexOf('BUILD_RC" -eq 124');
  const genericBlockAt = full.indexOf('FATAL: build failed (rc=$BUILD_RC)');

  assert.ok(timeoutBlockAt > 0, 'expected a dedicated rc==124/137 branch');
  assert.ok(genericBlockAt > timeoutBlockAt, 'the timeout-specific branch must be checked BEFORE the generic failure branch');
  assert.match(full, /WEDGED build/);
  assert.match(full, /exit 6/);
});

test('the build runs in its OWN process group with a trap that reaps it', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');

  assert.match(full, /setsid /, 'build must get its own process group');
  assert.match(full, /trap stop_build_group EXIT INT TERM/, 'trap must cover normal + signal exit');
  // Must signal the GROUP (negative pid), not just the direct child — orphaned
  // `npm run build` -> `tauri build` -> node kept writing for ~10 minutes.
  assert.match(full, /kill -TERM "-\$BUILD_PGID"/);
  assert.match(full, /kill -KILL "-\$BUILD_PGID"/);
});

test('lock acquisition is bounded and fails loudly rather than hanging forever', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');

  assert.match(full, /flock -w "\$BUNDLE_LOCK_WAIT" 9/, 'must use a bounded wait, never a blocking flock');
  assert.match(full, /exit 5/, 'a lock timeout needs its own distinct exit code');
  // The diagnostic must point at the real cause; "md5sums" sent the last
  // investigator hunting for filesystem debris instead of for a peer.
  assert.match(full, /pgrep -af 'tauri build'/);
});

test('a build failure explains the concurrent-build cause instead of only echoing rc', () => {
  const full = fs.readFileSync(scriptPath, 'utf8');
  assert.match(full, /md5sums/, 'the failure path should name the misleading symptom');
});

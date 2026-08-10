const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

// The guard is PROPERTY-based, not SHAPE-based, and that is a deliberate
// rewrite (2026-08-10). It used to match a literal `( exec 9>&-; cd <x>&& cargo
// build ` and compare two counts. That shape silently went stale the moment a
// `RUSTFLAGS="..."` (and `PATH=`/`SDKROOT=` on the cross line) was inserted
// between the `&&` and the `cargo`: every build was STILL correctly wrapped in
// the fd-closing subshell, but the pattern matched 0 of them, so the guard
// reported `0 !== 2` — a FALSE RED against a script that had not regressed.
//
// A guard that fails when the code is fine is worse than no guard: it costs a
// real diagnosis every time, and it trains the next reader to assume its red is
// spurious — which is exactly when it stops catching the real thing. So assert
// the PROPERTY (every real cargo invocation sits inside the fd-closing
// subshell) per-occurrence, and report WHICH line is unprotected rather than a
// bare count mismatch.
//
// `cargo zigbuild` (the darwin-cross pui build) is now covered too — it spawns
// the same daemon-capable rustc wrapper and was never counted by the old
// `cargo build ` match. Mentions inside comments and `echo` strings are
// excluded: the script legitimately talks ABOUT bare `cargo build` in several
// places, and matching prose is the spelling-vs-property error one level up.
const CARGO_INVOCATION = /cargo (?:build|zigbuild) /;
const FD_CLOSING_SUBSHELL = /\( exec 9>&-;/;

const cargoInvocationLines = builder
  .split('\n')
  .map((line, i) => ({ line, lineNo: i + 1 }))
  .filter(({ line }) => CARGO_INVOCATION.test(line) && !/^\s*(?:#|echo\b)/.test(line));

test('every cargo build closes the sidecar flock fd before sccache can daemonize', () => {
  const unprotected = cargoInvocationLines
    .filter(({ line }) => !FD_CLOSING_SUBSHELL.test(line))
    .map(({ lineNo, line }) => `${lineNo}: ${line.trim()}`);

  assert.deepEqual(
    unprotected,
    [],
    'each of these cargo invocations runs WITHOUT `( exec 9>&-; …)`, so RUSTC_WRAPPER (sccache) ' +
      'can daemonize holding the inherited sidecar flock fd 9 and wedge every later build',
  );

  // Tripwire, kept from the original guard: a NEW cargo invocation should make
  // someone re-read this file rather than silently inherit its coverage.
  assert.equal(
    cargoInvocationLines.length,
    3,
    `update this guard when another cargo build is added (found ${cargoInvocationLines.length}: ` +
      `${cargoInvocationLines.map(({ lineNo }) => lineNo).join(', ')})`,
  );
});

// The falsifiability proof the old guard never had — asserted against SYNTHETIC
// source, never by mutating the real script (this tree is swept into commits
// every few minutes, so a briefly-mutated file gets committed even when nothing
// goes wrong).
test('the guard actually catches an unprotected cargo build', () => {
  const unprotectedSample = 'cd "$REPO/apps/tui" && RUSTFLAGS="-x" cargo build --release';
  const protectedSample = '( exec 9>&-; cd "$REPO/apps/tui" && RUSTFLAGS="-x" cargo build --release )';
  const proseSample = '# it does NOT protect a plain `cargo build`/`cargo check` under src-tauri';
  const echoSample = 'echo "    → cross: cargo zigbuild pui for ${_pui_triple}"';

  const isCounted = (l) => CARGO_INVOCATION.test(l) && !/^\s*(?:#|echo\b)/.test(l);

  assert.equal(isCounted(unprotectedSample) && !FD_CLOSING_SUBSHELL.test(unprotectedSample), true);
  assert.equal(isCounted(protectedSample) && FD_CLOSING_SUBSHELL.test(protectedSample), true);
  // The two exclusions, pinned: prose and log strings must NOT read as invocations.
  assert.equal(isCounted(proseSample), false);
  assert.equal(isCounted(echoSample), false);
});

test('a daemon-capable child with fd 9 closed cannot retain the parent flock', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-lock-'));
  const lock = path.join(tmp, 'sidecar.lock');
  let sleeper = 0;

  try {
    sleeper = Number(
      execFileSync(
        'bash',
        [
          '-c',
          'exec 9>"$1"; flock 9; ( exec 9>&-; exec sleep 30 ) >/dev/null 2>&1 & echo $!',
          'bash',
          lock,
        ],
        { encoding: 'utf8' },
      ).trim(),
    );
    assert(Number.isInteger(sleeper) && sleeper > 1);
    assert.equal(spawnSync('flock', ['-n', lock, '-c', 'true']).status, 0);
  } finally {
    if (sleeper > 1) {
      try {
        process.kill(sleeper, 'SIGTERM');
      } catch {}
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// WI-6557: the outgoing sidecar tree (OLD_DIR — the `mv "$SIDECAR_FINAL_DIR"
// "$OLD_DIR"` swap just before publish) used to be reaped ONLY on the
// explicit success path (`rm -rf "$OLD_DIR"` right after the publish rename).
// Any failure between the swap and that line (a `set -e` death, an explicit
// `exit 1` guard) permanently stranded the whole outgoing tree — 11 orphaned
// `sidecar.old.<pid>` dirs, one of them 2.5G, were found stranded on one box
// from exactly this gap. The fix folds OLD_DIR into the same EXIT trap that
// already reaps SIDECAR_TMP_DIR/SIDECAR_LOCKDIR.
test('EI-18775478513129278 sibling / WI-6557: the EXIT trap also reaps OLD_DIR, not just SIDECAR_TMP_DIR/SIDECAR_LOCKDIR', () => {
  const trapLines = builder.match(/^trap '[^\n]*' EXIT$/gm) || [];
  assert.equal(trapLines.length, 1, 'expected exactly one top-level EXIT trap in the script');
  assert.match(
    trapLines[0],
    /\$\{OLD_DIR:\+"\$OLD_DIR"\}/,
    'the EXIT trap must also reap $OLD_DIR (the outgoing sidecar tree) or a mid-publish failure strands it permanently',
  );
});

// Behavioral counterpart of the guard above: actually RUNS the exact trap
// line extracted from the real script (never a hand-copied duplicate that
// could silently drift from what ships) in a sandbox that mimics the real
// variable lifecycle — OLD_DIR assigned partway through, THEN the process
// dies before its own explicit cleanup runs — and asserts the directory is
// gone afterward. A static text match alone cannot prove the trap syntax is
// correct bash (e.g. that `${OLD_DIR:+...}` really is safe under this
// script's `set -u` before OLD_DIR is ever assigned).
test('WI-6557: the real EXIT trap line removes OLD_DIR on a mid-publish failure (behavioral)', () => {
  const trapLine = (builder.match(/^trap '[^\n]*' EXIT$/m) || [])[0];
  assert(trapLine, 'could not locate the EXIT trap line in build-desktop-sidecar.sh');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-sidecar-olddir-'));
  try {
    const sidecarTmpDir = path.join(tmp, 'sidecar.tmp.1234');
    const oldDir = path.join(tmp, 'sidecar.old.1234');
    fs.mkdirSync(sidecarTmpDir);
    fs.mkdirSync(oldDir);
    fs.writeFileSync(path.join(oldDir, 'a-real-2.5g-build-would-have-files-like-this'), 'x');

    const script = [
      'set -euo pipefail',
      `SIDECAR_TMP_DIR=${JSON.stringify(sidecarTmpDir)}`,
      'SIDECAR_LOCKDIR=""',
      trapLine, // the ACTUAL line from the shipped script
      `OLD_DIR=${JSON.stringify(oldDir)}`, // mimics the real script's later assignment
      'exit 1', // simulate a failure AFTER the swap but BEFORE the explicit success-path rm -rf
    ].join('\n');

    const result = spawnSync('bash', ['-c', script]);
    assert.equal(result.status, 1, 'the sandbox script should still exit 1 (the trap must not swallow the failure)');
    assert.equal(fs.existsSync(oldDir), false, 'OLD_DIR must be reaped by the EXIT trap on a mid-publish failure');
    assert.equal(fs.existsSync(sidecarTmpDir), false, 'SIDECAR_TMP_DIR must still be reaped too (pre-existing behavior)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

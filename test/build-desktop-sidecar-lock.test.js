const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

test('every cargo build closes the sidecar flock fd before sccache can daemonize', () => {
  const cargoBuilds = builder.match(/cargo build /g) || [];
  const protectedBuilds = builder.match(/\( exec 9>&-; cd [^\n]+&& cargo build /g) || [];

  assert.equal(cargoBuilds.length, 2, 'update this guard when another cargo build is added');
  assert.equal(protectedBuilds.length, cargoBuilds.length);
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

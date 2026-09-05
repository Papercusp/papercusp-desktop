'use strict';

// EI-20082207759701826, second half. Building the detector is not closing the
// gap — a detector nothing CALLS is the same gap with more code in it. Leg 5 of
// bin/linux-fresh-install-e2e.sh is the call site, so this file exercises that
// leg's REAL text with the surrounding script's helpers stubbed, in the style of
// appimage-runtime-isolation.test.js (extract the real block, drive it with a
// fake collaborator that records how it was invoked).
//
// What is asserted here is the leg's DISPOSITION under each condition, because
// the failure this whole item is about is a verification run that reports PASS
// while the check silently did not happen:
//
//   detector present + usable docker   -> PASS, invoked with --appdir <payload>
//   detector missing                   -> VOID  (never a quiet PASS)
//   opted out with PC_L_PRISTINE=0     -> SKIP + an explicit NOT PROVEN line
//   no extracted payload               -> SKIP
//   detector exits non-zero            -> FAIL
//
// The real container run is proven separately against real packed artifacts;
// this file is about the branching, so the detector is faked and no docker is
// needed. That is deliberate: a unit guard that needs docker gets skipped in CI,
// which is how a call site rots unnoticed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const E2E = path.join(ROOT, 'bin', 'linux-fresh-install-e2e.sh');

/** The real leg-5 block, lifted verbatim from the shipped script. */
function legFive() {
  const src = fs.readFileSync(E2E, 'utf8');
  const start = src.indexOf('echo "=== 5. pristine-box runtime proof');
  assert.notEqual(
    start,
    -1,
    'linux-fresh-install-e2e.sh no longer contains the pristine-box leg — the AppImage would go back to ' +
      'being verified only on hosts that supply system WebKitGTK (EI-20075266271803900)',
  );
  const end = src.indexOf('emit_verdict', start);
  assert.notEqual(end, -1, 'leg 5 must sit before emit_verdict, or it never runs');
  return src.slice(start, end);
}

/**
 * Run the real leg with stub helpers. `detector` is either null (absent) or the
 * shell body of a fake verify-appimage-pristine.sh.
 */
function runLeg({ detector, extracted = true, env = {} }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pristine-leg-'));
  const bin = path.join(dir, 'bin');
  const run = path.join(dir, 'run');
  const payload = path.join(dir, 'squashfs-root');
  fs.mkdirSync(bin);
  fs.mkdirSync(run);
  fs.mkdirSync(payload);
  const report = path.join(dir, 'invoked');

  if (detector !== null) {
    fs.writeFileSync(path.join(bin, 'verify-appimage-pristine.sh'), detector, { mode: 0o755 });
  }

  const harness = [
    '#!/usr/bin/env bash',
    'pass() { printf "PASS|%s\\n" "$1"; }',
    'fail() { printf "FAIL|%s\\n" "$1"; }',
    'void() { printf "VOID|%s\\n" "$1"; }',
    'skip() { printf "SKIP|%s\\n" "$1"; }',
    'note() { printf "NOTE|%s\\n" "$1"; }',
    `HERE=${JSON.stringify(bin)}`,
    `RUN_DIR=${JSON.stringify(run)}`,
    extracted ? `EXTRACT_ROOT=${JSON.stringify(payload)}` : 'EXTRACT_ROOT=""',
    legFive(),
    '',
  ].join('\n');
  const script = path.join(dir, 'harness.sh');
  fs.writeFileSync(script, harness, { mode: 0o755 });

  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    env: { ...process.env, PC_PRISTINE_INVOKED_REPORT: report, ...env },
  });
  return {
    out: `${r.stdout || ''}${r.stderr || ''}`,
    invoked: fs.existsSync(report) ? fs.readFileSync(report, 'utf8').trim() : null,
    payload,
  };
}

/** A fake detector that records its argv and exits with $PC_PRISTINE_FAKE_RC. */
const FAKE_DETECTOR = [
  '#!/usr/bin/env bash',
  'printf "%s\\n" "$*" > "$PC_PRISTINE_INVOKED_REPORT"',
  'echo "    leg A PASS: 0 unresolved libraries across 333 ELF objects"',
  'echo "    [webkit-render] applied 1/1 feature(s) of 486 available"',
  'exit "${PC_PRISTINE_FAKE_RC:-0}"',
  '',
].join('\n');

test('the detector is INVOKED against the payload section 4 already extracted', () => {
  const r = runLeg({ detector: FAKE_DETECTOR });
  assert.match(r.out, /^PASS\|AppImage runs on a host with NO system WebKitGTK$/m, r.out);
  assert.equal(
    r.invoked,
    `--appdir ${r.payload}`,
    'leg 5 must hand the detector the already-extracted payload, not re-extract 6+ GB',
  );
  // The evidence lines are surfaced, not swallowed — a PASS with no numbers is
  // indistinguishable from a PASS that measured nothing.
  assert.match(r.out, /NOTE\|leg A PASS: 0 unresolved libraries across 333 ELF objects/);
  assert.match(r.out, /NOTE\|\[webkit-render\] applied/);
});

test('a detector that FAILS makes the leg FAIL, naming the class', () => {
  const r = runLeg({ detector: FAKE_DETECTOR, env: { PC_PRISTINE_FAKE_RC: '1' } });
  assert.match(r.out, /^FAIL\|AppImage does NOT survive a pristine \(webkit-free\) host/m, r.out);
  assert.match(r.out, /EI-20075266271803900/);
});

test('a MISSING detector is VOID, never a quiet PASS', () => {
  // The whole item is a verification run that passed while nothing checked. If
  // the detector is gone, the run must be unquotable, not green.
  const r = runLeg({ detector: null });
  assert.match(r.out, /^VOID\|verify-appimage-pristine\.sh is missing or not executable/m, r.out);
  assert.doesNotMatch(r.out, /^PASS\|/m);
});

test('PC_L_PRISTINE=0 skips LOUDLY — the run says what it did not prove', () => {
  const r = runLeg({ detector: FAKE_DETECTOR, env: { PC_L_PRISTINE: '0' } });
  assert.match(r.out, /^SKIP\|pristine-box runtime proof \(disabled by PC_L_PRISTINE=0\)$/m, r.out);
  assert.match(r.out, /NOTE\|NOT PROVEN: that the artifact runs without system WebKitGTK/);
  assert.equal(r.invoked, null, 'the opt-out must not run the detector');
});

test('no extracted payload skips instead of invoking the detector on nothing', () => {
  const r = runLeg({ detector: FAKE_DETECTOR, extracted: false });
  assert.match(r.out, /^SKIP\|pristine-box runtime proof \(section 4 produced no extracted payload\)$/m, r.out);
  assert.equal(r.invoked, null);
});

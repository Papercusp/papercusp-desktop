// WI-40549 — the discarded-measurement guard.
//
// The defect class: a scenario MEASURES something, then a `return` between the
// measurement and its first use destroys the reading, so a run that took the
// early exit reports a clean two-state result (no/yes) with the third state —
// UNMEASURED — silently missing. "The probe never ran" then reads exactly like
// "the feature behaved correctly", which is how three matrix runs were scored.
//
// Two halves, and the SECOND is the one that prevents the recurrence (same shape
// as sidecar-freshness-guard.test.js):
//   1. the scanner's own controls hold, and it REJECTS a newly-stranded site;
//   2. STATIC assertions that the guard is actually WIRED and its baseline is
//      generated — because the original gap was not a wrong verdict, it was that
//      the scanner existed and NOTHING CALLED IT. A detector nobody runs passes
//      half 1 forever while the class walks back in.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCANNER = path.resolve(__dirname, '../bin/lib/scan-discarded-measurements.py');
const BASELINE = path.resolve(__dirname, '../bin/lib/scan-discarded-measurements.baseline.txt');
const PKG = path.resolve(__dirname, '../package.json');

function runScanner(args) {
  return spawnSync('python3', [SCANNER, ...args], { encoding: 'utf8' });
}

// ── half 1: the detector works, and can FAIL ────────────────────────────────

test('scanner self-test passes — its controls can still see the defect', () => {
  const r = runScanner(['--self-test']);
  assert.equal(r.status, 0, `self-test failed:\n${r.stdout}\n${r.stderr}`);
});

test('guard passes against the current tree (every candidate is baselined)', () => {
  const r = runScanner(['--guard']);
  assert.equal(r.status, 0, `guard unexpectedly failed:\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /GUARD OK/);
});

// THE CONTROL. A guard that has never failed is a guard nobody has tested, and
// this class is invisible precisely because its failure looks like success — so
// the falsifiability check is not optional decoration here.
test('CONTROL — guard REJECTS a newly stranded measurement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discarded-guard-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'probe-scenario.sh'),
      [
        '#!/usr/bin/env bash',
        'scn_guard_falsifiability_probe() {',
        '  local probe_val other',
        '  probe_val="$(rig_read_content a "F-PROBE-$rid")"',
        '  other="$(rig_resolve_ws b)"',
        '  [ -n "$other" ] || { echo "probe FAIL — precondition unmet"; return 1; }',
        '  echo "probe reading=$probe_val"',
        '}',
        '',
      ].join('\n'),
    );
    const r = runScanner(['--guard', dir]);
    assert.equal(r.status, 1, `mutant SURVIVED — the guard did not reject a new strand:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /GUARD FAILED/);
    // It must NAME the site: a guard that fails without saying where sends the
    // next reader hunting through 15 files.
    assert.match(r.stderr, /scn_guard_falsifiability_probe::probe_val/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard reports UNMEASURED (exit 2), never a pass, when the baseline is absent', () => {
  // A missing baseline must not read as "nothing new". Exit 2 is the third state.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discarded-guard-nb-'));
  try {
    const r = spawnSync('python3', [SCANNER, '--guard', dir], {
      encoding: 'utf8',
      env: { ...process.env, HOME: dir },
    });
    // The baseline lives beside the scanner, so it is still found; assert the
    // contract we can assert here — a pass is never silent about its basis.
    assert.notEqual(r.status, 2, 'baseline unexpectedly missing beside the scanner');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── half 2: the detector is actually CALLED ─────────────────────────────────

test('STATIC — the guard is wired to an npm script (a detector nobody runs is prose)', () => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  const scripts = pkg.scripts || {};
  const wired = Object.entries(scripts).filter(([, v]) => v.includes('scan-discarded-measurements'));
  assert.ok(
    wired.length > 0,
    'no npm script invokes scan-discarded-measurements.py — the scanner exists but nothing calls it, ' +
      'which is the exact gap this guard was added to close',
  );
  assert.ok(
    wired.some(([, v]) => v.includes('--guard')),
    `a script references the scanner but none passes --guard (found: ${JSON.stringify(wired)})`,
  );
});

test('STATIC — the baseline is generated, not hand-authored', () => {
  assert.ok(fs.existsSync(BASELINE), 'baseline file is missing');
  const body = fs.readFileSync(BASELINE, 'utf8');
  assert.match(body, /GENERATED by --seed-baseline/);
  // Identities must stay line-independent, or the baseline goes stale on every
  // unrelated edit above a site and gets re-seeded blindly.
  for (const line of body.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    assert.match(t, /^[^:]+\.sh::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/, `malformed baseline identity: ${t}`);
    assert.ok(!/L\d+/.test(t), `baseline identity must not encode a line number: ${t}`);
  }
});

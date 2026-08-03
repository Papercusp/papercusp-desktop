// EI-19446480107603858 — the prebuilt-sidecar freshness guard.
//
// Two halves, and the SECOND is the one that actually prevents the recurrence:
//   1. unit tests of the pure verdict function (bin/lib/sidecar-freshness.js);
//   2. STATIC assertions that the consuming build scripts still call the check and
//      that the sidecar builder still records provenance — because the original bug
//      was not a wrong verdict, it was that NO check existed at the consuming site.
//      A verdict function nobody calls would pass half 1 and ship the same bug.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  inspectSidecarFreshness,
  blocksBuild,
  describe,
  formatAge,
  parseProvenance,
} = require('../bin/lib/sidecar-freshness.js');

const BIN = path.resolve(__dirname, '../bin');

/** A provenance document in the shared emitter's exact shape. */
function prov(overrides = {}) {
  return JSON.stringify({
    version: '0.0.13',
    buildSha: 'b5f11ff9',
    reused: false,
    gitHead: 'ebb8505aa5562d50844d5891228757c3b2fd6cd4',
    gitDirty: false,
    builtAtUtc: '2026-08-03T02:53:00Z',
    artifacts: [],
    ...overrides,
  });
}

// ── the pure verdicts ────────────────────────────────────────────────────────

test('no sidecar at all is reported, and does not block (the build fails more clearly)', () => {
  const r = inspectSidecarFreshness({ sidecarPresent: false });
  assert.equal(r.verdict, 'no-sidecar');
  assert.equal(blocksBuild(r.verdict), false);
});

test('a sidecar with NO provenance is undecidable, not a pass — and does not block', () => {
  const r = inspectSidecarFreshness({ sidecarPresent: true, provenanceText: null });
  assert.equal(r.verdict, 'no-provenance');
  assert.equal(blocksBuild(r.verdict), false);
  // The wording must not read as a clean bill of health.
  assert.match(describe(r), /cannot be judged|declines to guess/);
});

test('unparseable provenance is distinguished from an absent one', () => {
  const r = inspectSidecarFreshness({ sidecarPresent: true, provenanceText: '{not json' });
  assert.equal(r.verdict, 'unreadable');
  assert.equal(blocksBuild(r.verdict), false);
});

test('provenance without a gitHead cannot answer the blocking question', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov({ gitHead: '' }),
  });
  assert.equal(r.verdict, 'unreadable');
});

test('with no assertion the verdict is match, and the banner still names age + gitHead', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    headSha: 'deadbeef',
    nowMs: Date.parse('2026-08-03T12:05:00Z'),
  });
  assert.equal(r.verdict, 'match');
  assert.equal(blocksBuild(r.verdict), false);
  const msg = describe(r);
  // The banner IS the fix for the silent case — it must always carry these.
  assert.match(msg, /ebb8505aa5562d50844d5891228757c3b2fd6cd4/);
  assert.match(msg, /9h 12m ago/);
  assert.match(msg, /repo HEAD is now deadbeef/);
});

test('an assertion that HOLDS passes', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    requireContains: '62b9524a',
    containsVerdict: true,
  });
  assert.equal(r.verdict, 'match');
  assert.equal(blocksBuild(r.verdict), false);
});

test('an assertion the sidecar does NOT satisfy is a blocking skew', () => {
  // This is the WI-3307 case: a sidecar baked 9h before the fix commit.
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    requireContains: '62b9524a',
    containsVerdict: false,
  });
  assert.equal(r.verdict, 'skew');
  assert.equal(blocksBuild(r.verdict), true);
  const msg = describe(r);
  assert.match(msg, /STALE SIDECAR/);
  assert.match(msg, /62b9524a/);
  assert.match(msg, /PAPERCUSP_ALLOW_STALE_SIDECAR=1/);
});

test('an assertion that cannot be resolved BLOCKS — an unverifiable claim is not a pass', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    requireContains: 'not-a-real-sha',
    containsVerdict: null,
  });
  assert.equal(r.verdict, 'contains-unverifiable');
  assert.equal(blocksBuild(r.verdict), true);
});

test('mere staleness NEVER blocks — no gitHead-vs-HEAD failure (the cry-wolf design)', () => {
  // The guard people learn to bypass is the one that fires on every build. On this
  // shared checkout HEAD moves every few minutes, so a differing HEAD must be
  // INFORMATION, never a refusal.
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    headSha: '0000000000000000000000000000000000000000',
    nowMs: Date.parse('2026-09-03T02:53:00Z'), // a MONTH stale
  });
  assert.equal(r.verdict, 'match');
  assert.equal(blocksBuild(r.verdict), false);
});

test('formatAge / parseProvenance edges are total (never throw, never NaN-print)', () => {
  assert.equal(formatAge(null), null);
  assert.equal(formatAge(-1), null);
  assert.equal(formatAge(90 * 60 * 1000), '1h 30m');
  assert.equal(formatAge(50 * 60 * 60 * 1000), '2d 2h');
  assert.equal(parseProvenance(null), null);
  assert.equal(parseProvenance('   '), null);
  assert.equal(parseProvenance('[1,2]').length, 2);
});

// ── the CLI ──────────────────────────────────────────────────────────────────

function runCli(sidecarDir, env = {}) {
  return spawnSync(
    process.execPath,
    [path.join(BIN, 'check-sidecar-freshness.js'), '--sidecar', sidecarDir],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
}

test('CLI: exits 0 and prints the banner when nothing is asserted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), prov());
  const r = runCli(dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /ebb8505aa5562d50844d5891228757c3b2fd6cd4/);
});

test('CLI: exits 4 when an asserted commit cannot be shown to be present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), prov());
  const r = runCli(dir, { PAPERCUSP_REQUIRE_SIDECAR_CONTAINS: 'ffffffffffffffffffffffff' });
  assert.equal(r.status, 4);
});

test('CLI: the documented override turns a refusal back into exit 0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), prov());
  const r = runCli(dir, {
    PAPERCUSP_REQUIRE_SIDECAR_CONTAINS: 'ffffffffffffffffffffffff',
    PAPERCUSP_ALLOW_STALE_SIDECAR: '1',
  });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /OVERRIDDEN/);
});

test('CLI: a sidecar dir that does not exist is reported, not crashed on', () => {
  const r = runCli(path.join(os.tmpdir(), 'definitely-not-a-sidecar-' + Date.now()));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no prebuilt sidecar/);
});

// ── the wiring (the half that actually prevents the recurrence) ───────────────

test('build-desktop-sidecar.sh RECORDS provenance into the published sidecar', () => {
  const src = fs.readFileSync(path.join(BIN, 'build-desktop-sidecar.sh'), 'utf8');
  assert.match(
    src,
    /emit-build-provenance\.sh/,
    'the sidecar builder must emit build-provenance.json — without it, staleness downstream is not merely unguarded, it is unknowable',
  );
});

for (const script of ['build-mac-cross.sh', 'build-windows-cross.sh']) {
  test(`${script} CONSULTS the freshness check, not just existence`, () => {
    const src = fs.readFileSync(path.join(BIN, script), 'utf8');
    assert.match(
      src,
      /check-sidecar-freshness\.js/,
      `${script} consumes a sidecar it did not build; its existence/arch asserts are silent on staleness, which is how a 9-hour-old operator shipped in WI-3307`,
    );
  });
}

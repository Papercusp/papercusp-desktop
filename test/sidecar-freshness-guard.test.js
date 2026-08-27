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
const { createHash } = require('node:crypto');
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

test('an explicit serve assertion still fails closed when provenance is absent', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: null,
    expectedServeSha: 'a'.repeat(64),
    serveSha: null,
  });
  assert.equal(r.verdict, 'serve-unverifiable');
  assert.equal(blocksBuild(r.verdict), true);
});

test('an explicit cut-time assertion still fails closed when provenance is absent', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: null,
    minEpochSec: 200,
    stampEpochSec: null,
  });
  assert.equal(r.verdict, 'stamp-unverifiable');
  assert.equal(blocksBuild(r.verdict), true);
});

test('a required release audit fails closed without a successful sidecar attestation', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    requireReleaseAudit: true,
    releaseAuditPassed: false,
  });
  assert.equal(r.verdict, 'release-audit-unattested');
  assert.equal(blocksBuild(r.verdict), true);
  assert.match(describe(r), /UNAUDITED SIDECAR/);
  assert.match(describe(r), /PAPERCUSP_RELEASE_AUDIT=1/);
});

test('a required release audit passes only with the final-scan attestation', () => {
  const r = inspectSidecarFreshness({
    sidecarPresent: true,
    provenanceText: prov(),
    requireReleaseAudit: true,
    releaseAuditPassed: true,
  });
  assert.equal(r.verdict, 'match');
  assert.equal(blocksBuild(r.verdict), false);
  assert.match(describe(r), /release identity audit attested/);
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
  const childEnv = { ...process.env };
  delete childEnv.PAPERCUSP_EXPECTED_SERVE_SHA;
  delete childEnv.PAPERCUSP_SIDECAR_MIN_EPOCH_SEC;
  delete childEnv.PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT;
  return spawnSync(
    process.execPath,
    [path.join(BIN, 'check-sidecar-freshness.js'), '--sidecar', sidecarDir],
    { encoding: 'utf8', env: { ...childEnv, ...env } },
  );
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function writeStampedSidecar(
  dir,
  { serveText = 'sidecar bytes\n', epochSec = 200, releaseAuditPassed = false } = {},
) {
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), prov());
  fs.writeFileSync(path.join(dir, 'serve.mjs'), serveText);
  const stamp = { serveSha256: sha256(serveText), epochSec };
  if (releaseAuditPassed) {
    stamp.releaseIdentityAudit = {
      schemaVersion: 1,
      passed: true,
      scanner: 'audit-release-bundle.py --scan-dir',
    };
  }
  fs.writeFileSync(
    path.join(dir, '.sidecar-build-stamp'),
    JSON.stringify(stamp),
  );
  return sha256(serveText);
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

test('CLI: release-cut hash and minimum-epoch assertions pass for matching sidecar bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  const expectedSha = writeStampedSidecar(dir, { serveText: 'release sidecar bytes\n', epochSec: 250 });
  const r = runCli(dir, {
    PAPERCUSP_EXPECTED_SERVE_SHA: expectedSha,
    PAPERCUSP_SIDECAR_MIN_EPOCH_SEC: '200',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(`serve\\.mjs sha ${expectedSha}`));
  assert.match(r.stdout, /stamp epoch 250/);
});

test('CLI: release-cut hash assertion rejects different packed serve.mjs bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  const actualSha = writeStampedSidecar(dir, { serveText: 'stale sidecar bytes\n', epochSec: 250 });
  const expectedSha = sha256('fresh sidecar bytes\n');
  assert.notEqual(expectedSha, actualSha);
  const r = runCli(dir, { PAPERCUSP_EXPECTED_SERVE_SHA: expectedSha });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /serve\.mjs does not match/);
  assert.match(r.stderr, new RegExp(`expected sha256 ${expectedSha}`));
  assert.match(r.stderr, new RegExp(`actual   sha256 ${actualSha}`));
});

test('CLI: minimum-epoch assertion rejects a sidecar stamped before the release cut', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  const serveText = 'sidecar from an earlier cut\n';
  writeStampedSidecar(dir, { serveText, epochSec: 100 });
  const r = runCli(dir, { PAPERCUSP_SIDECAR_MIN_EPOCH_SEC: '200' });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /build stamp predates this release cut/);
  assert.match(r.stderr, /sidecar stamp epoch 100/);
  assert.match(r.stderr, /required cut epoch 200/);
});

test('CLI: an asserted cut with missing or malformed stamp fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  fs.writeFileSync(path.join(dir, 'build-provenance.json'), prov());
  fs.writeFileSync(path.join(dir, 'serve.mjs'), 'sidecar bytes\n');
  fs.writeFileSync(path.join(dir, '.sidecar-build-stamp'), '{not json');
  const r = runCli(dir, { PAPERCUSP_SIDECAR_MIN_EPOCH_SEC: '200' });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /could not verify that the sidecar was built during this release cut/);
});

test('CLI: release cross-build assertion rejects an ordinary dev sidecar before compilation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  writeStampedSidecar(dir);
  const r = runCli(dir, {
    PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT: '1',
    PAPERCUSP_ALLOW_STALE_SIDECAR: '1',
  });
  assert.equal(r.status, 4, 'ALLOW_STALE must not bypass a missing privacy attestation');
  assert.match(r.stderr, /UNAUDITED SIDECAR/);
  assert.match(r.stderr, /does not\s+bypass a missing privacy attestation/);
});

test('CLI: release cross-build assertion accepts a successfully audited sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-fresh-'));
  writeStampedSidecar(dir, { releaseAuditPassed: true });
  const r = runCli(dir, { PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT: '1' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /release identity audit attested/);
});

// ── the wiring (the half that actually prevents the recurrence) ───────────────

test('build-desktop-sidecar.sh RECORDS provenance into the published sidecar', () => {
  const src = fs.readFileSync(path.join(BIN, 'build-desktop-sidecar.sh'), 'utf8');
  assert.match(
    src,
    /emit-build-provenance\.sh/,
    'the sidecar builder must emit build-provenance.json — without it, staleness downstream is not merely unguarded, it is unknowable',
  );
  const scan = src.lastIndexOf('audit-release-bundle.py" --scan-dir "$SIDECAR_DIR"');
  const attestation = src.indexOf('stamp.releaseIdentityAudit = {');
  assert.ok(scan > 0, 'the final assembled-sidecar identity scan must exist');
  assert.ok(attestation > scan,
    'the release audit attestation must be recorded only AFTER the final scan succeeds');
});

for (const script of ['build-mac-cross.sh', 'build-windows-cross.sh', 'build-and-archive-deb.sh']) {
  test(`${script} CONSULTS the freshness check, not just existence`, () => {
    const src = fs.readFileSync(path.join(BIN, script), 'utf8');
    assert.match(
      src,
      /check-sidecar-freshness\.js/,
      `${script} consumes a sidecar it did not build; its existence/arch asserts are silent on staleness, which is how a 9-hour-old operator shipped in WI-3307`,
    );
    assert.match(
      src,
      /PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT=1/,
      `${script} must reject a dev/unaudited sidecar before its expensive compiler leg`,
    );
  });
}

test('build-mac-cross.sh is executable for direct producer invocation', () => {
  const script = path.join(BIN, 'build-mac-cross.sh');
  assert.ok(
    fs.statSync(script).mode & 0o111,
    'the documented direct mac cross-build producer must retain an executable mode',
  );
});

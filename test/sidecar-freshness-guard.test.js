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
  inspectSidecarSourceCoherence,
  sourceCoherenceBlocksBuild,
  describeSourceCoherence,
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
  // EI-22084619262074810: the FATAL text used to name only the env var, not WHERE
  // to get its value — a caller who already knows they need PAPERCUSP_RELEASE_AUDIT=1
  // still has to go find PAPERCUSP_RELEASE_OWNER_NAME's canonical source by hand.
  assert.match(describe(r), /~\/\.papercusp\/release-identity\.env/);
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

function runCli(sidecarDir, env = {}, { repoRoot } = {}) {
  const childEnv = { ...process.env };
  delete childEnv.PAPERCUSP_EXPECTED_SERVE_SHA;
  delete childEnv.PAPERCUSP_SIDECAR_MIN_EPOCH_SEC;
  delete childEnv.PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT;
  delete childEnv.PAPERCUSP_REQUIRE_SOURCE_COHERENCE;
  const args = [path.join(BIN, 'check-sidecar-freshness.js'), '--sidecar', sidecarDir];
  if (repoRoot) args.push('--repo-root', repoRoot);
  return spawnSync(
    process.execPath,
    args,
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

// ── preserved source/runtime/provenance coherence ───────────────────────────

function sourceEntries(names, contents = {}) {
  return names.map((name) => ({ name, sha256: sha256(contents[name] ?? `-- ${name}\n`) }));
}

test('source coherence: clean provenance plus identical names and bytes passes', () => {
  const names = ['001-one.sql', '002-two.sql'];
  const r = inspectSidecarSourceCoherence({
    required: true,
    provenanceHead: 'a'.repeat(40),
    provenanceDirty: false,
    sourceArchivePresent: true,
    sourceEntries: sourceEntries(names),
    shippedEntries: sourceEntries(names),
    provenanceEntries: names,
  });
  assert.equal(r.verdict, 'coherent');
  assert.equal(sourceCoherenceBlocksBuild(r.verdict), false);
  assert.match(describeSourceCoherence(r), /source coherence OK/);
});

test('source coherence: stale names, same-name byte skew, missing source, and dirty provenance fail closed', () => {
  const full = ['001-one.sql', '002-two.sql'];
  const base = {
    required: true,
    provenanceHead: 'a'.repeat(40),
    provenanceDirty: false,
    sourceArchivePresent: true,
    sourceEntries: sourceEntries(full),
    shippedEntries: sourceEntries(full),
    provenanceEntries: full,
  };

  const stale = inspectSidecarSourceCoherence({
    ...base,
    sourceEntries: sourceEntries(['001-one.sql']),
  });
  assert.equal(stale.verdict, 'migration-set-skew');
  assert.match(describeSourceCoherence(stale), /name different migration sets/);

  const byteSkew = inspectSidecarSourceCoherence({
    ...base,
    shippedEntries: sourceEntries(full, { '002-two.sql': '-- changed\n' }),
  });
  assert.equal(byteSkew.verdict, 'source-runtime-byte-skew');
  assert.deepEqual(byteSkew.hashMismatches, ['002-two.sql']);

  const missing = inspectSidecarSourceCoherence({ ...base, sourceArchivePresent: false });
  assert.equal(missing.verdict, 'source-missing');
  assert.equal(sourceCoherenceBlocksBuild(missing.verdict), true);

  const dirty = inspectSidecarSourceCoherence({ ...base, provenanceDirty: true });
  assert.equal(dirty.verdict, 'provenance-dirty');
  assert.match(describeSourceCoherence(dirty), /dirty source state/);
});

test('source coherence accepts release-scrubbed shipped bytes against a clean raw Git manifest', () => {
  const names = ['630-owner-header.sql', '631-owner-header.sql'];
  const scrubbed = {
    '630-owner-header.sql': '-- [owner:redacted]\nSELECT 1;\n',
    '631-owner-header.sql': '-- /home/redacted\nSELECT 2;\n',
  };
  const r = inspectSidecarSourceCoherence({
    required: true,
    provenanceHead: 'a'.repeat(40),
    provenanceDirty: false,
    sourceArchivePresent: true,
    sourceEntries: sourceEntries(names, scrubbed),
    shippedEntries: sourceEntries(names, scrubbed),
    provenanceEntries: names,
  });
  assert.equal(r.verdict, 'coherent');
  assert.equal(sourceCoherenceBlocksBuild(r.verdict), false);
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function makeCoherenceFixture({ archiveFiles, shippedFiles, provenanceFiles, omitArchive = false }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-source-coherence-'));
  const papercuspRepo = path.join(tmp, 'papercusp-lib');
  const repoRoot = path.join(tmp, 'repo');
  const sidecarDir = path.join(tmp, 'sidecar');
  fs.mkdirSync(papercuspRepo, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(path.join(sidecarDir, 'db-sql'), { recursive: true });

  for (const repo of [papercuspRepo, repoRoot]) {
    runGit(repo, ['init', '-q', '-b', 'main']);
    runGit(repo, ['config', 'user.email', 'coherence@test.invalid']);
    runGit(repo, ['config', 'user.name', 'Coherence Test']);
    runGit(repo, ['config', 'commit.gpgsign', 'false']);
  }

  const dbDir = path.join(papercuspRepo, 'libs/db/sql');
  fs.mkdirSync(dbDir, { recursive: true });
  for (const [name, contents] of Object.entries(provenanceFiles)) {
    fs.writeFileSync(path.join(dbDir, name), contents);
  }
  runGit(papercuspRepo, ['add', '.']);
  runGit(papercuspRepo, ['commit', '-qm', 'migrations']);

  fs.writeFileSync(path.join(repoRoot, 'root.txt'), 'root\n');
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'root']);
  runGit(repoRoot, [
    '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', papercuspRepo, 'libs/papercusp',
  ]);
  runGit(repoRoot, ['commit', '-qm', 'pin papercusp']);
  const provenanceHead = runGit(repoRoot, ['rev-parse', 'HEAD']);

  fs.writeFileSync(path.join(sidecarDir, 'serve.mjs'), '// fixture\n');
  fs.writeFileSync(
    path.join(sidecarDir, 'build-provenance.json'),
    prov({ gitHead: provenanceHead, gitDirty: false }),
  );
  for (const [name, contents] of Object.entries(shippedFiles)) {
    fs.writeFileSync(path.join(sidecarDir, 'db-sql', name), contents);
  }

  if (!omitArchive) {
    const archiveRoot = path.join(tmp, 'archive-root');
    const archiveDb = path.join(archiveRoot, 'libs/papercusp/libs/db/sql');
    fs.mkdirSync(archiveDb, { recursive: true });
    for (const [name, contents] of Object.entries(archiveFiles)) {
      fs.writeFileSync(path.join(archiveDb, name), contents);
    }
    const tarPath = path.join(tmp, 'source.tar');
    const tarResult = spawnSync('tar', ['-C', archiveRoot, '-cf', tarPath, '.'], { encoding: 'utf8' });
    assert.equal(tarResult.status, 0, tarResult.stderr);
    const zstdResult = spawnSync(
      'zstd', ['-q', '-f', tarPath, '-o', path.join(sidecarDir, 'source.tar.zst')],
      { encoding: 'utf8' },
    );
    assert.equal(zstdResult.status, 0, zstdResult.stderr);
  }

  return { tmp, repoRoot, sidecarDir };
}

test('CLI: hermetic coherent archive/runtime/provenance fixture passes', (t) => {
  const files = { '001-one.sql': '-- one\n', '002-two.sql': '-- two\n' };
  const fixture = makeCoherenceFixture({
    archiveFiles: files,
    shippedFiles: files,
    provenanceFiles: files,
  });
  t.after(() => fs.rmSync(fixture.tmp, { recursive: true, force: true }));

  const r = runCli(
    fixture.sidecarDir,
    { PAPERCUSP_REQUIRE_SOURCE_COHERENCE: '1' },
    { repoRoot: fixture.repoRoot },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /source coherence OK/);
});

test('CLI: hermetic stale, same-name byte-skew, and missing archives all refuse', (t) => {
  const complete = { '001-one.sql': '-- one\n', '002-two.sql': '-- two\n' };
  const cases = [
    {
      archiveFiles: { '001-one.sql': '-- one\n' },
      shippedFiles: complete,
      provenanceFiles: complete,
      expected: /name different migration sets/,
    },
    {
      archiveFiles: complete,
      shippedFiles: { ...complete, '002-two.sql': '-- changed\n' },
      provenanceFiles: complete,
      expected: /different SQL bytes for: 002-two\.sql/,
    },
    {
      archiveFiles: complete,
      shippedFiles: complete,
      provenanceFiles: complete,
      omitArchive: true,
      expected: /source\.tar\.zst is missing/,
    },
  ];

  for (const fixtureArgs of cases) {
    const fixture = makeCoherenceFixture(fixtureArgs);
    t.after(() => fs.rmSync(fixture.tmp, { recursive: true, force: true }));
    const r = runCli(
      fixture.sidecarDir,
      { PAPERCUSP_REQUIRE_SOURCE_COHERENCE: '1', PAPERCUSP_ALLOW_STALE_SIDECAR: '1' },
      { repoRoot: fixture.repoRoot },
    );
    assert.equal(r.status, 4, `expected refusal; stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /INCOHERENT SIDECAR SOURCE/);
    assert.match(r.stderr, fixtureArgs.expected);
    assert.match(r.stderr, /does not bypass source coherence/);
  }
});

test('CLI: a legacy stale override cannot bypass a failing source-coherence assertion', (t) => {
  const complete = { '001-one.sql': '-- one\n', '002-two.sql': '-- two\n' };
  const fixture = makeCoherenceFixture({
    archiveFiles: { '001-one.sql': '-- one\n' },
    shippedFiles: complete,
    provenanceFiles: complete,
  });
  t.after(() => fs.rmSync(fixture.tmp, { recursive: true, force: true }));

  const r = runCli(
    fixture.sidecarDir,
    {
      PAPERCUSP_REQUIRE_SOURCE_COHERENCE: '1',
      PAPERCUSP_REQUIRE_SIDECAR_CONTAINS: 'f'.repeat(40),
      PAPERCUSP_ALLOW_STALE_SIDECAR: '1',
    },
    { repoRoot: fixture.repoRoot },
  );
  assert.equal(r.status, 4, `override bypassed coherence; stdout=${r.stdout}\nstderr=${r.stderr}`);
  assert.match(r.stderr, /OVERRIDDEN by PAPERCUSP_ALLOW_STALE_SIDECAR=1/);
  assert.match(r.stderr, /INCOHERENT SIDECAR SOURCE/);
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

test('build-desktop-sidecar.sh WARNS upfront when building without a release identity audit', () => {
  // EI-22084619262074810: a clean-clone sidecar built WITHOUT PAPERCUSP_RELEASE_AUDIT=1
  // completed successfully and only got refused ~35 minutes later, downstream, by
  // build-mac-cross.sh's sidecar-freshness gate. The fix is fail-EARLY information, not
  // a behavior change — an unaudited dev/dogfood sidecar must still succeed here.
  const src = fs.readFileSync(path.join(BIN, 'build-desktop-sidecar.sh'), 'utf8');
  const ownerNameCheckAt = src.indexOf('PAPERCUSP_RELEASE_AUDIT=1 requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME');
  const advisoryAt = src.indexOf('building WITHOUT a release identity audit');
  const firstExpensiveWorkAt = src.indexOf('emit-build-provenance.sh');
  assert.ok(ownerNameCheckAt > 0, 'the existing AUDIT=1-requires-owner-name refusal must still exist');
  assert.ok(advisoryAt > 0, 'an unaudited build must print an upfront advisory that downstream consumers will refuse it');
  assert.ok(
    advisoryAt < firstExpensiveWorkAt,
    'the advisory must print before the first expensive/toolchain work, not after — that is the whole point',
  );
  assert.match(src, /build-mac-cross\.sh/, 'the advisory must name the actual downstream consumer that will refuse this sidecar');
  assert.match(src, /~\/\.papercusp\/release-identity\.env/, 'the advisory must point at the canonical identity source, not just the env var name');
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

test('the Debian release producer requires source coherence before its expensive build lock', () => {
  const src = fs.readFileSync(path.join(BIN, 'build-and-archive-deb.sh'), 'utf8');
  const assertionAt = src.indexOf('PAPERCUSP_REQUIRE_SOURCE_COHERENCE=1');
  const mutexAt = src.indexOf('# --- BUNDLE MUTEX');
  assert.ok(assertionAt > 0, 'the Debian producer must opt into the fail-closed coherence assertion');
  assert.ok(assertionAt < mutexAt, 'coherence must fail before the expensive build mutex/compiler leg');
});

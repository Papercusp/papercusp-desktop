// WI-10003499 — bin/build-and-archive-deb.sh --test-artifact.
//
// WHY THIS TEST EXISTS
// The deb builder requires a release-audited sidecar, and a release-audited sidecar
// build refuses any dirty source tree. The shared canonical tree is never clean, so a
// drill that needs a CURRENT Server .deb (P-505 hive-git-drill, its migration
// freshness check) had no producer at all. --test-artifact is the one sanctioned
// relaxation. It is safe ONLY because of two properties, and this file pins both by
// executing the real script text rather than a copy of it:
//   1. The relaxation never leaks into the default (release-shaped) path: without the
//      flag, both the release identity audit and source coherence are still required.
//   2. A test artifact never lands where a consumer scavenges: it is archived under
//      <target>/.papercusp-deb-archive/<profile>/test-artifacts/ (WI-10006749) with a
//      TEST-ARTIFACT name, and the live
//      bundle/deb/Papercusp*_amd64.deb copy is removed after the archived pair is
//      published.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');
const full = fs.readFileSync(scriptPath, 'utf8');

function slice(startMarker, endMarker) {
  const start = full.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = full.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return full.slice(start, end);
}

function runBash(script, args = []) {
  return spawnSync('bash', ['-c', script, 'build-and-archive-deb', ...args], { encoding: 'utf8' });
}

test('the parser maps --test-artifact to TEST_ARTIFACT=1 and defaults it to 0', () => {
  const parser = slice('DEBUG=0', '# --- UPDATER SIGNING KEY');
  for (const [args, expected] of [
    [[], 'TEST_ARTIFACT=0'],
    [['--test-artifact'], 'TEST_ARTIFACT=1'],
    [['--keep', '2', '--test-artifact'], 'TEST_ARTIFACT=1'],
  ]) {
    const res = runBash(
      ['set -euo pipefail', parser, 'printf "TEST_ARTIFACT=%s\\n" "$TEST_ARTIFACT"'].join('\n'),
      args,
    );
    assert.equal(res.status, 0, `parser failed for ${JSON.stringify(args)}: ${res.stderr}`);
    assert.equal(res.stdout.trim(), expected);
  }
});

// Run the REAL freshness block against a stub check-sidecar-freshness.js that reports
// which proofs the caller demanded. The stub is the only substitution.
function runFreshness(testArtifact) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-test-artifact-'));
  try {
    fs.mkdirSync(path.join(tmp, 'bin'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'bin/check-sidecar-freshness.js'),
      [
        "const label = process.argv[process.argv.indexOf('--label') + 1];",
        'console.log(JSON.stringify({',
        "  audit: process.env.PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT || '',",
        "  coherence: process.env.PAPERCUSP_REQUIRE_SOURCE_COHERENCE || '',",
        '  label,',
        '}));',
        '',
      ].join('\n'),
    );
    const block = slice('if [[ "$TEST_ARTIFACT" == "1" ]]; then\n  echo "==> TEST ARTIFACT MODE', '# --- SEED OVERLAY');
    const res = runBash(
      [
        'set -euo pipefail',
        `TEST_ARTIFACT=${testArtifact}`,
        `LIVE_DESKTOP_DIR=${JSON.stringify(tmp)}`,
        `DESKTOP_DIR=${JSON.stringify(tmp)}`,
        `LIVE_REPO_DIR=${JSON.stringify(tmp)}`,
        block,
      ].join('\n'),
    );
    assert.equal(res.status, 0, `freshness block failed: ${res.stderr}`);
    return { verdict: JSON.parse(res.stdout.trim().split('\n').pop()), stderr: res.stderr };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('the default build still REQUIRES the release identity audit and source coherence', () => {
  const { verdict } = runFreshness(0);
  assert.deepEqual(verdict, { audit: '1', coherence: '1', label: 'build-and-archive-deb' });
});

test('--test-artifact relaxes only those two proofs, under a distinct label and a loud banner', () => {
  const { verdict, stderr } = runFreshness(1);
  assert.deepEqual(verdict, { audit: '', coherence: '', label: 'build-and-archive-deb:test-artifact' });
  assert.match(stderr, /TEST ARTIFACT MODE \(WI-10003499\)/);
});

test('a test artifact is archived under test-artifacts/ with a TEST-ARTIFACT file name', () => {
  const block = slice('DEB_DIR="$CARGO_TARGET/$PROFILE_DIR/bundle/deb"', '# WI-3287');
  // WI-10006749: both archives sit under <target>/.papercusp-deb-archive, never under
  // <target>/<profile>, which the Cargo reclaimer deletes as a whole under disk pressure.
  for (const [flag, dir, label] of [
    [0, '/t/.papercusp-deb-archive/release/archive', ''],
    [1, '/t/.papercusp-deb-archive/release/test-artifacts', 'TEST-ARTIFACT-'],
  ]) {
    const res = runBash(
      [
        'set -euo pipefail',
        `TEST_ARTIFACT=${flag}`,
        'CARGO_TARGET=/t',
        'PROFILE_DIR=release',
        block,
        'printf "%s|%s\\n" "$ARCHIVE_DIR" "$ARCHIVE_LABEL"',
      ].join('\n'),
    );
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), `${dir}|${label}`);
    for (const reclaimable of ['/t/release/', '/t/debug/']) {
      assert.ok(!`${dir}/`.startsWith(reclaimable), `${dir} must not sit under the reclaimable profile ${reclaimable}`);
    }
  }
  assert.match(
    full,
    /ARCHIVED_PATH="\$ARCHIVE_DIR\/\$\{STAMP\}-\$\{GIT_SHA\}-\$\{ARCHIVE_LABEL\}\$\{BASENAME\}\.deb"/,
    'the archived file name must carry the TEST-ARTIFACT label',
  );
});

// Execute the REAL retention + finish tail: in test mode it must remove the live
// scavenged copy (and only after the archived pair exists); by default it must not.
function runTail(testArtifact) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-test-artifact-tail-'));
  try {
    const debDir = path.join(tmp, 'bundle/deb');
    const archiveDir = path.join(debDir, testArtifact ? 'test-artifacts' : 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    const debPath = path.join(debDir, 'Papercusp Server_0.0.21_amd64.deb');
    const archived = path.join(archiveDir, `20260927T000000Z-abc-${testArtifact ? 'TEST-ARTIFACT-' : ''}x.deb`);
    for (const f of [debPath, `${debPath}.sig`, archived, `${archived}.sig`]) fs.writeFileSync(f, 'x');
    const tail = full.slice(full.indexOf('ARCHIVED_LIST=""'));
    assert.ok(tail.length > 0 && tail.startsWith('ARCHIVED_LIST=""'), 'retention tail not found');
    const res = runBash(
      [
        'set -euo pipefail',
        `TEST_ARTIFACT=${testArtifact}`,
        'KEEP=10',
        `ARCHIVE_DIR=${JSON.stringify(archiveDir)}`,
        `DEB_PATH=${JSON.stringify(debPath)}`,
        `LIVE_SIG_PATH=${JSON.stringify(`${debPath}.sig`)}`,
        `ARCHIVED_PATH=${JSON.stringify(archived)}`,
        tail,
      ].join('\n'),
    );
    return {
      ...res,
      liveDeb: fs.existsSync(debPath),
      liveSig: fs.existsSync(`${debPath}.sig`),
      archived: fs.existsSync(archived) && fs.existsSync(`${archived}.sig`),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('--test-artifact removes the live bundle/deb copy that consumers scavenge, keeping the archived pair', () => {
  const r = runTail(1);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.liveDeb, false, 'live .deb must be gone so no scavenger can pick an unaudited package');
  assert.equal(r.liveSig, false, 'live .sig must be gone with it');
  assert.equal(r.archived, true, 'the test-artifact pair itself must survive');
  assert.match(r.stdout, /^TEST_ARTIFACT_DEB=.*TEST-ARTIFACT-x\.deb$/m);
});

test('the default build keeps its live bundle/deb artifact (release behaviour unchanged)', () => {
  const r = runTail(0);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.liveDeb, true);
  assert.equal(r.liveSig, true);
  assert.equal(r.archived, true);
  assert.doesNotMatch(r.stdout, /TEST_ARTIFACT_DEB=/);
});

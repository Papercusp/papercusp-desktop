'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin', 'release-local.sh');
const source = fs.readFileSync(scriptPath, 'utf8');

function sliceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert(from >= 0, `release-local.sh is missing start marker: ${start}`);
  assert(to > from, `release-local.sh is missing end marker after ${start}: ${end}`);
  return source.slice(from, to);
}

// Run the REAL provenance helper and Linux reuse branch, stopping before the
// independent Android branch. This is deliberately not a rewritten model of
// the shell logic: if the production branch changes, the behavior under test
// changes with it.
const linuxReuseHarness = sliceBetween('_prov_version()', '# ── Mobile');
const cutStartHarness = sliceBetween(
  '# EI-20551860898590077: bind every artifact',
  'echo "==> bumping version in manifests"',
);

function runCutStart({ linux = 0, windows = 0, mac = 0 } = {}) {
  const command = [
    'set -euo pipefail',
    'TAG=desktop-v0.0.18-alpha',
    `PAPERCUSP_REUSE_LINUX=${linux}`,
    `PAPERCUSP_REUSE_WIN=${windows}`,
    `PAPERCUSP_REUSE_MAC=${mac}`,
    "release_artifacts_cut_start_write() { printf 'WRITE\\n' >&2; printf '222\\n'; }",
    "release_artifacts_cut_start_ensure() { printf 'ENSURE\\n' >&2; printf '111\\n'; }",
    cutStartHarness,
    "printf 'CUT_START=%s\\n' \"$PAPERCUSP_RELEASE_CUT_START_NS\"",
  ].join('\n');
  return spawnSync('bash', ['-c', command], { encoding: 'utf8' });
}

function runReuse({
  priorVersion = '0.0.18',
  priorBuildSha = 'built-source-sha',
  priorGitHead = 'a'.repeat(40),
  priorGitDirty = false,
  includeArtifact = true,
  includeProvenance = true,
  extraArtifact = false,
} = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-reuse-'));
  const bundle = path.join(temp, 'target', 'release', 'bundle');
  const appimageDir = path.join(bundle, 'appimage');
  fs.mkdirSync(appimageDir, { recursive: true });
  if (includeArtifact) {
    const artifact = path.join(appimageDir, 'Papercusp_GUI_0.0.18_amd64.AppImage');
    fs.writeFileSync(artifact, 'finished-linux-bytes');
    fs.writeFileSync(`${artifact}.sig`, 'finished-linux-signature');
  }
  if (extraArtifact) {
    const stale = path.join(appimageDir, 'Papercusp GUI_0.0.18_amd64.AppImage');
    fs.writeFileSync(stale, 'failed-pre-repair-bytes');
    fs.writeFileSync(`${stale}.sig`, 'failed-pre-repair-signature');
  }
  if (includeProvenance) {
    const provenance = { version: priorVersion, gitHead: priorGitHead, gitDirty: priorGitDirty };
    if (priorBuildSha !== null) provenance.buildSha = priorBuildSha;
    fs.writeFileSync(path.join(bundle, 'build-provenance.json'), JSON.stringify(provenance));
  }

  const command = [
    'set -euo pipefail',
    `ROOT=${JSON.stringify(temp)}`,
    `CARGO_TARGET_ROOT=${JSON.stringify(path.join(temp, 'target'))}`,
    'VERSION=0.0.18',
    'BUILD_SHA=exact-source-sha',
    'TAG=desktop-v0.0.18-alpha',
    "PAPERCUSP_BUILD_ROLES='gui server'",
    'PAPERCUSP_REUSE_LINUX=1',
    linuxReuseHarness,
    "printf 'HARNESS LINUX_REUSE=%s LINUX_PID=%s PRIOR_SHA=%s PRIOR_HEAD=%s PRIOR_DIRTY=%s\\n' \"$LINUX_REUSE\" \"$LINUX_PID\" \"$LINUX_REUSE_BUILD_SHA\" \"$LINUX_REUSE_GIT_HEAD\" \"$LINUX_REUSE_GIT_DIRTY\"",
  ].join('\n');
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  fs.rmSync(temp, { recursive: true, force: true });
  return result;
}

test('same-version Linux salvage skips the build and enters the canonical collector', () => {
  const result = runReuse();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /PAPERCUSP_REUSE_LINUX=1 — skipping linux build/);
  assert.match(result.stdout, /REUSE_linux provenance verified: salvaged version 0\.0\.18 == cut 0\.0\.18/);
  assert.match(result.stdout, /HARNESS LINUX_REUSE=1 LINUX_PID= PRIOR_SHA=built-source-sha PRIOR_HEAD=a{40} PRIOR_DIRTY=false$/m);
  assert.doesNotMatch(result.stdout, /launching Linux x86_64 build/);
});

test('Linux salvage refuses provenance that cannot identify the bytes it reuses', () => {
  const result = runReuse({ priorBuildSha: null });
  assert.notEqual(result.status, 0, 'reuse without prior build identity unexpectedly passed');
  assert.match(result.stdout + result.stderr, /lacks buildSha\/gitHead\/gitDirty/);
});

test('Linux salvage refuses to relabel a different version', () => {
  const result = runReuse({ priorVersion: '0.0.17' });
  assert.notEqual(result.status, 0, 'mismatched provenance unexpectedly passed');
  assert.match(result.stdout + result.stderr, /salvaged artifacts are version '0\.0\.17' but this cut is '0\.0\.18'/);
});

test('Linux salvage refuses an empty bundle before claiming reuse', () => {
  const result = runReuse({ includeArtifact: false });
  assert.notEqual(result.status, 0, 'empty Linux bundle unexpectedly passed');
  assert.match(result.stdout + result.stderr, /no 0\.0\.18 linux artifacts/);
});

test('Linux salvage refuses two same-version AppImages instead of picking by iteration order', () => {
  const result = runReuse({ extraArtifact: true });
  assert.notEqual(result.status, 0, 'ambiguous Linux AppImage set unexpectedly passed');
  assert.match(result.stdout + result.stderr, /bundle is ambiguous\/incomplete/);
  assert.match(result.stdout + result.stderr, /found appimages=2 signatures=2/);
});

test('Linux reuse stays on the shared provenance and collection surfaces', () => {
  const branch = sliceBetween('LINUX_LEG_LOG=', '# ── Mobile');
  const collection = sliceBetween('ARTIFACTS=()', 'if [[ "$WITH_ARM64" == "1" ]]');

  assert.match(branch, /PAPERCUSP_REUSE_LINUX/);
  assert.match(branch, /assert_reused_provenance "\$LINUX_BUNDLE" linux/);
  assert.match(branch, /assert_linux_artifact_cardinality "\$LINUX_BUNDLE"/);
  assert.match(branch, /LINUX_REUSE=1/);
  assert.match(collection, /linux_found=1/);
  assert.match(collection, /assert_linux_artifact_cardinality "\$LINUX_BUNDLE"/);
  assert.match(collection, /"\$LINUX_REUSE" == "1"/);
  assert.match(collection, /emit-build-provenance\.sh/);
});

test('an all-fresh cut writes a new freshness boundary', () => {
  const result = runCutStart();
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stderr, /^WRITE$/m);
  assert.doesNotMatch(result.stderr, /^ENSURE$/m);
  assert.match(result.stdout, /CUT_START=222/);
});

for (const [leg, reuse] of [
  ['linux', { linux: 1 }],
  ['windows', { windows: 1 }],
  ['mac', { mac: 1 }],
]) {
  test(`${leg} reuse preserves and validates the original freshness boundary`, () => {
    const result = runCutStart(reuse);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /^ENSURE$/m);
    assert.doesNotMatch(result.stderr, /^WRITE$/m);
    assert.match(result.stdout, /CUT_START=111/);
    assert.match(result.stdout, /preserving original cut-start/);
  });
}

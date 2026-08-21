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

function runReuse({ priorVersion = '0.0.18', includeArtifact = true, includeProvenance = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-linux-reuse-'));
  const bundle = path.join(temp, 'target', 'release', 'bundle');
  const appimageDir = path.join(bundle, 'appimage');
  fs.mkdirSync(appimageDir, { recursive: true });
  if (includeArtifact) {
    fs.writeFileSync(path.join(appimageDir, 'Papercusp_GUI_0.0.18_amd64.AppImage'), 'finished-linux-bytes');
  }
  if (includeProvenance) {
    fs.writeFileSync(path.join(bundle, 'build-provenance.json'), JSON.stringify({ version: priorVersion }));
  }

  const command = [
    'set -euo pipefail',
    `ROOT=${JSON.stringify(temp)}`,
    `CARGO_TARGET_ROOT=${JSON.stringify(path.join(temp, 'target'))}`,
    'VERSION=0.0.18',
    'BUILD_SHA=exact-source-sha',
    'TAG=desktop-v0.0.18-alpha',
    'PAPERCUSP_REUSE_LINUX=1',
    linuxReuseHarness,
    "printf 'HARNESS LINUX_REUSE=%s LINUX_PID=%s\\n' \"$LINUX_REUSE\" \"$LINUX_PID\"",
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
  assert.match(result.stdout, /HARNESS LINUX_REUSE=1 LINUX_PID=$/m);
  assert.doesNotMatch(result.stdout, /launching Linux x86_64 build/);
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

test('Linux reuse stays on the shared provenance and collection surfaces', () => {
  const branch = sliceBetween('LINUX_LEG_LOG=', '# ── Mobile');
  const collection = sliceBetween('ARTIFACTS=()', 'if [[ "$WITH_ARM64" == "1" ]]');

  assert.match(branch, /PAPERCUSP_REUSE_LINUX/);
  assert.match(branch, /assert_reused_provenance "\$LINUX_BUNDLE" linux/);
  assert.match(branch, /LINUX_REUSE=1/);
  assert.match(collection, /linux_found=1/);
  assert.match(collection, /"\$LINUX_REUSE" == "1"/);
  assert.match(collection, /emit-build-provenance\.sh/);
});

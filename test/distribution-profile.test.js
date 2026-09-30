// open-source-release-2026-09-29 D-005 / P-019: a build of the PUBLIC source cut must
// default to the `public` distribution profile (every Claude.ai subscription relay off),
// derived from the MANIFEST.json the public export writes at the repo root. The private
// monorepo has no such manifest and must keep its historical `dogfood` default.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HELPER = path.join(__dirname, '..', 'bin', 'lib', 'distribution-profile.sh');

function resolveIn(manifest) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-profile-'));
  const desktop = path.join(repo, 'papercusp-desktop');
  fs.mkdirSync(desktop);
  if (manifest !== null) fs.writeFileSync(path.join(repo, 'MANIFEST.json'), manifest);
  try {
    const r = spawnSync('bash', ['-c', '. "$1"; default_distribution_profile "$2"', '_', HELPER, desktop], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('a public source cut defaults to the public profile', () => {
  assert.equal(resolveIn('{\n  "schema": 1,\n  "target": "public"\n}\n'), 'public');
});

test('no manifest (the private monorepo) keeps dogfood', () => {
  assert.equal(resolveIn(null), 'dogfood');
});

test('a preview-target manifest is not public', () => {
  assert.equal(resolveIn('{"target": "preview"}'), 'dogfood');
});

test('both build entrypoints accept the public profile and export it for cargo', () => {
  for (const script of ['build-linux-local.sh', 'build-desktop-sidecar.sh']) {
    const body = fs.readFileSync(path.join(__dirname, '..', 'bin', script), 'utf8');
    assert.match(body, /default_distribution_profile "\$ROOT"/, `${script} must derive its default from the tree`);
    assert.match(body, /export PAPERCUSP_DISTRIBUTION_PROFILE="\$DISTRIBUTION_PROFILE"/, `${script} must export the profile`);
    assert.match(body, /dogfood\|public/, `${script} must accept the public profile`);
  }
});

// P-008 — the VM rig must never select an empty or foreign seed directory.
// Exercise the real shell helper through bash so macOS/WSL/current/dev-source
// launchers share one tested manifest-admission contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const helper = path.join(import.meta.dirname, '..', 'bin', 'vm-rig', 'seed-resource-root.sh');
const stageEnvSidecars = path.join(import.meta.dirname, '..', 'bin', 'stage-env-sidecars.sh');
const currentComposer = path.join(import.meta.dirname, '..', 'bin', 'vm-rig', 'compose-rig-sidecar-current.sh');
const currentLauncher = path.join(import.meta.dirname, '..', 'bin', 'vm-rig', 'boot-headless-current.sh');

function fixtureManifest(potId = 'papercusp') {
  return JSON.stringify({
    seedFormatVersion: 1,
    potId,
    stores: [{ kind: 'corestore' }],
  });
}

function resolveSeed(sidecar, roots = [], env = {}) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'set -u; source "$1"; shift; resolve_seed_resource_dir "$@"',
      'seed-resource-root-test',
      helper,
      sidecar,
      ...roots,
    ],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
  return { ...result, stdout: result.stdout.trim() };
}

test('helper self-test passes through the real executable entrypoint', () => {
  const result = spawnSync('bash', [helper, '--self-test'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /manifest-checked resource-root resolution/);
});

test('a stale explicit path is only a hint; the manifest-checked sibling wins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-seed-root-'));
  try {
    const sidecar = path.join(root, 'app', 'sidecar');
    const seed = path.join(root, 'app', 'seed');
    const stale = path.join(root, 'wrong');
    fs.mkdirSync(sidecar, { recursive: true });
    fs.mkdirSync(seed, { recursive: true });
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(seed, 'manifest.json'), fixtureManifest());
    fs.writeFileSync(path.join(stale, 'manifest.json'), fixtureManifest('foreign-pot'));

    const result = resolveSeed(sidecar, [], { PAPERCUSP_SEED_DIR: stale });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, seed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('foreign, malformed, and empty manifests are rejected fail-closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-seed-root-invalid-'));
  try {
    const sidecar = path.join(root, 'sidecar');
    const foreign = path.join(root, 'foreign');
    const malformed = path.join(root, 'malformed');
    const empty = path.join(root, 'empty');
    for (const dir of [sidecar, foreign, malformed, empty]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(foreign, 'manifest.json'), fixtureManifest('other-pot'));
    fs.writeFileSync(path.join(malformed, 'manifest.json'), '{not-json');

    const result = resolveSeed(sidecar, [foreign, malformed, empty]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('additional sidecar/resource roots support the composed current layout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-seed-root-composed-'));
  try {
    const current = path.join(root, 'rig-sidecar-current');
    const resourceRoot = path.join(root, 'server-resources');
    const seed = path.join(resourceRoot, 'seed');
    fs.mkdirSync(current, { recursive: true });
    fs.mkdirSync(seed, { recursive: true });
    fs.writeFileSync(path.join(seed, 'manifest.json'), fixtureManifest());

    const result = resolveSeed(current, [resourceRoot]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, seed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('all four rig launchers source the shared resolver and leave the seed unset on miss', () => {
  for (const name of [
    'boot-headless.sh',
    'boot-headless-current.sh',
    'boot-headless-wsl.sh',
    'boot-headless-devsource.sh',
  ]) {
    const source = fs.readFileSync(path.join(path.dirname(helper), name), 'utf8');
    assert.match(source, /source \"\$HERE\/seed-resource-root\.sh\"/);
    assert.match(source, /resolve_seed_resource_dir/);
    assert.match(source, /unset PAPERCUSP_SEED_DIR/);
  }
});

test('current-payload composer deploys the launcher dependency and launcher fails closed when absent', () => {
  const composer = fs.readFileSync(currentComposer, 'utf8');
  const launcher = fs.readFileSync(currentLauncher, 'utf8');
  assert.match(composer, /\[ -r "\$HERE\/seed-resource-root\.sh" \]/);
  assert.match(
    composer,
    /rsync -a --chmod=F755 "\$HERE\/seed-resource-root\.sh" "\$VM:\$REMOTE_LAUNCHER_DIR\/seed-resource-root\.sh"/,
  );
  assert.match(
    launcher,
    /if \[\[ ! -r "\$HERE\/seed-resource-root\.sh" \]\]; then[\s\S]*?exit 1[\s\S]*?fi\nsource "\$HERE\/seed-resource-root\.sh"/,
  );
});

test('env-sidecar staging carries the primary provenance formats beside the exact bundle copy', () => {
  const source = fs.readFileSync(stageEnvSidecars, 'utf8');
  assert.match(source, /cp -al "\$SIDECAR\/serve\.mjs" "\$ENV_SC\/serve\.mjs"/);
  assert.match(source, /cp -a "\$SIDECAR\/build-provenance\.json" "\$ENV_SC\/build-provenance\.json"/);
  assert.match(source, /cp -a "\$SIDECAR\/\.sidecar-build-stamp" "\$ENV_SC\/\.sidecar-build-stamp"/);
});

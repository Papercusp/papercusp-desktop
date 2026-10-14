'use strict';

// WI-6554700010012218: release-seed-guard.sh's verdict must reach build-provenance.json.
// The D-224 candidate (2026-10-13) nominated a seedless Mac Server; the guard's
// SEED_GUARD line existed only in the build LOG, so the candidate binding
// (deriveCandidateProvenance) could not see it until P-521 J8 failed offline-restore.
// These tests run the REAL guard and the REAL emitter in one shell, the way every
// producer (build-mac-cross / build-linux-local / release-local) does.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');

const BIN = path.join(__dirname, '..', 'bin');
const EMITTER = path.join(BIN, 'emit-build-provenance.sh');
// Overridable so a mutation probe can point the suite at a mutated COPY.
const GUARD = process.env.PAPERCUSP_RELEASE_SEED_GUARD_PATH || path.join(BIN, 'lib', 'release-seed-guard.sh');

const MANIFEST = '{"hive":"papercusp","cutAtEpoch":1}\n';

/**
 * Run `<prelude>; bash emit-build-provenance.sh …` in ONE bash and return the record.
 * `prelude` is a bash snippet run first in the same shell (the guard call, or nothing).
 */
function emit({ prelude = '', seeded = false, env = {} } = {}) {
  const dir = makeDesktopTestScratchDirSync('prov-seed-');
  const out = path.join(dir, 'out');
  const seed = path.join(dir, 'seed');
  fs.mkdirSync(out, { recursive: true });
  if (seeded) {
    fs.mkdirSync(seed);
    fs.writeFileSync(path.join(seed, 'manifest.json'), MANIFEST);
  }
  const artifact = path.join(out, 'Papercusp Server_0.0.0_amd64.deb');
  fs.writeFileSync(artifact, 'fixture');

  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('PROVENANCE_SEED_') || k.startsWith('PAPERCUSP_ALLOW_SEEDLESS')) delete clean[k];
  delete clean.PAPERCUSP_RELEASE_AUDIT;

  const script = `set -e; source "$1"; SEED="$2"; ${prelude}
bash "$3" "$4" 0.0.0 testsha false "$5" >/dev/null`;
  const r = spawnSync('bash', ['-c', script, 'x', GUARD, seed, EMITTER, out, artifact], {
    encoding: 'utf8',
    env: { ...clean, PROVENANCE_GIT_ROOT: path.join(BIN, '..'), ...env },
  });
  assert.equal(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(out, 'build-provenance.json'), 'utf8'));
}

test('a present seed reaches the record with the manifest sha256 the guard printed', () => {
  const prov = emit({
    seeded: true,
    prelude: 'release_seed_guard "gui server" dogfood "$SEED"',
    env: { PAPERCUSP_RELEASE_AUDIT: '1' },
  });
  assert.deepEqual(prov.seed, {
    status: 'present',
    profile: 'dogfood',
    manifestSha256: crypto.createHash('sha256').update(MANIFEST).digest('hex'),
    reason: null,
  });
});

test('no guard in the producer shell records seed: null (key present, so not a pre-field emitter)', () => {
  const prov = emit();
  assert.ok('seed' in prov, 'the seed key must always be present');
  assert.equal(prov.seed, null);
});

test('a non-audit seedless Server records absent-unaudited, the status the candidate check FAILS', () => {
  const prov = emit({ prelude: 'release_seed_guard "server" public "$SEED" 2>/dev/null' });
  assert.equal(prov.seed.status, 'absent-unaudited');
  assert.equal(prov.seed.profile, 'public');
  assert.equal(prov.seed.manifestSha256, null);
});

test('an allowed seedless Server keeps its reason verbatim, even with quotes and backslashes', () => {
  const reason = 'D-999 "vm" build \\ no seed';
  const prov = emit({
    prelude: 'release_seed_guard "server" dogfood "$SEED"',
    env: { PAPERCUSP_RELEASE_AUDIT: '1', PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '1', PAPERCUSP_ALLOW_SEEDLESS_REASON: reason },
  });
  assert.equal(prov.seed.status, 'absent-allowed');
  assert.equal(prov.seed.reason, reason);
});

test('a GUI-only guard call overrides an inherited Server verdict instead of inheriting it', () => {
  const prov = emit({
    prelude: 'release_seed_guard "gui" dogfood "$SEED"',
    env: { PROVENANCE_SEED_STATUS: 'present', PROVENANCE_SEED_MANIFEST_SHA256: 'a'.repeat(64) },
  });
  assert.equal(prov.seed.status, 'not-applicable');
  assert.equal(prov.seed.manifestSha256, null);
});

test('vm-release records excluded-by-profile', () => {
  const prov = emit({ prelude: 'release_seed_guard "gui server" vm-release "$SEED"', env: { PAPERCUSP_RELEASE_AUDIT: '1' } });
  assert.equal(prov.seed.status, 'excluded-by-profile');
  assert.equal(prov.seed.profile, 'vm-release');
});

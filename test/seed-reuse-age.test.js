'use strict';

// WI-10004593: one stale-seed-reuse age guard (bin/lib/seed-reuse-age.sh) shared by
// every corestore-reuse site. WI-10004429 put it inline in release-local.sh only;
// mac-vm-build.sh and ensure-release-seed.sh kept auto-reusing a corestore of ANY age.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable so a mutation probe can point the suite at a mutated COPY.
const helper = process.env.PAPERCUSP_SEED_REUSE_AGE_PATH
  || path.join(root, 'bin', 'lib', 'seed-reuse-age.sh');

function check(cutTs, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-reuse-age-'));
  try {
    const manifest = path.join(dir, 'manifest.json');
    fs.writeFileSync(manifest, JSON.stringify(cutTs === undefined ? {} : { cutTs }));
    return spawnSync('bash', ['-c', `source "$1"; seed_reuse_age_check "$2"`, 'x', helper, manifest], {
      encoding: 'utf8',
      env: { ...process.env, PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS: '72', ...env },
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HOUR = 3_600_000;

test('a fresh reused corestore passes and reports its age', () => {
  // Mid-hour on purpose (EI-24759293506933965): the helper floors `date +%s` to whole seconds
  // while Date.now() carries milliseconds, so a fixture exactly 2h old measures a few hundred
  // ms short of 2h whenever both clocks read the same second, and the integer hour floors to 1.
  const r = check(Date.now() - 2 * HOUR - HOUR / 2);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reused corestore age 2h \(max 72h\)/);
});

test('a corestore older than the max is refused', () => {
  const r = check(Date.now() - 8 * 24 * HOUR);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cut 19\dh ago .*PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS=72/);
});

test('a manifest without cutTs is refused (age unknown)', () => {
  const r = check(undefined);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no readable cutTs/);
});

test('max age 0 accepts any age; a non-numeric max is refused', () => {
  assert.equal(check(Date.now() - 30 * 24 * HOUR, { PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS: '0' }).status, 0);
  const bad = check(Date.now(), { PAPERCUSP_SEED_REUSE_MAX_AGE_HOURS: 'abc' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /must be a whole number/);
});

// Every site that passes --reuse-corestore must source the helper and run the guard
// BEFORE the reuse arg is added — the drift WI-10004593 closed.
for (const script of ['release-local.sh', 'mac-vm-build.sh', 'ensure-release-seed.sh']) {
  test(`${script} sources the shared guard and checks age before every --reuse-corestore`, () => {
    const src = fs.readFileSync(path.join(root, 'bin', script), 'utf8');
    assert.match(src, /source "\$[A-Z_]+\/lib\/seed-reuse-age\.sh"/);
    const lines = src.split('\n');
    const reuseLines = lines
      .map((l, i) => [l, i])
      .filter(([l]) => /--reuse-corestore "\$/.test(l) && !/^\s*#/.test(l));
    assert.ok(reuseLines.length > 0, `${script} has no --reuse-corestore site`);
    for (const [, i] of reuseLines) {
      const window = lines.slice(Math.max(0, i - 8), i + 1).join('\n');
      assert.match(window, /seed_reuse_age_check|refuse_stale_reuse/, `${script}:${i + 1} reuses without the age guard`);
    }
  });
}

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

test('D166 shared seed policy preserves argument boundaries and refuses stale, partial or skipped plans', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uuid-seed-mode-'));
  try {
    const plan = path.join(dir, "private plan's.json"); const store = path.join(dir, 'frozen original');
    const census = path.join(dir, "census config's.json");
    fs.mkdirSync(store); fs.writeFileSync(census, JSON.stringify({ reviewRef: 'p2p-public-release-endgame-2026-09-01#D-166' }), { mode: 0o600 });
    const censusDigest = require('node:crypto').createHash('sha256').update(fs.readFileSync(census)).digest('hex');
    fs.writeFileSync(plan, JSON.stringify({ privateSourceBindings: { configSha256: censusDigest } }), { mode: 0o600 });
    const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(plan)).digest('hex');
    const base = { ...process.env, PAPERCUSP_SEED_UUID_PLAN_PATH: plan, PAPERCUSP_SEED_UUID_PLAN_SHA256: digest,
      PAPERCUSP_SEED_UUID_CENSUS_PATH: census, PAPERCUSP_SEED_UUID_CENSUS_SHA256: censusDigest,
      PAPERCUSP_SEED_STORE_DIR: store, PAPERCUSP_SEED_FORCE: '1', PAPERCUSP_SEED_CORESTORE: '1',
      PAPERCUSP_SEED_REUSE_CORESTORE: '0', PAPERCUSP_SEED_SPARSE: '0', PAPERCUSP_SKIP_SEED_CUT: '0', PAPERCUSP_FAST_ITER: '0' };
    const run = env => spawnSync('bash', ['-c', 'source "$1"; seed_uuid_row_drop_prepare || exit $?; printf "%s\\n" "$SEED_UUID_ROW_DROP_ACTIVE" "${SEED_UUID_ROW_DROP_ARGS[@]}"', 'x', helper],
      { encoding: 'utf8', env: { ...base, ...env } });
    const valid = run({}); assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(valid.stdout.trim().split('\n'), ['1', '--skip-corestore-refresh', '--uuid-idempotency-drop-plans', plan, '--uuid-idempotency-drop-plans-sha256', digest]);
    for (const bad of [{ PAPERCUSP_SEED_UUID_PLAN_SHA256: 'b'.repeat(64) }, { PAPERCUSP_SEED_UUID_PLAN_PATH: '' },
      { PAPERCUSP_SEED_STORE_DIR: '' }, { PAPERCUSP_SKIP_SEED_CUT: '1' }, { PAPERCUSP_FAST_ITER: '1' },
      { PAPERCUSP_SEED_UUID_CENSUS_PATH: '' }, { PAPERCUSP_SEED_UUID_CENSUS_SHA256: 'bad' },
      { PAPERCUSP_SEED_UUID_CENSUS_SHA256: 'b'.repeat(64) },
      { PAPERCUSP_SEED_REUSE_CORESTORE: 'auto' }, { PAPERCUSP_SEED_CORESTORE: '0' }, { PAPERCUSP_SEED_SPARSE: '1' }, { PAPERCUSP_SEED_FORCE: '0' }]) {
      assert.equal(run(bad).status, 1, JSON.stringify(bad));
    }
    fs.writeFileSync(plan, JSON.stringify({ privateSourceBindings: { configSha256: 'c'.repeat(64) } }));
    const reboundDigest = require('node:crypto').createHash('sha256').update(fs.readFileSync(plan)).digest('hex');
    assert.equal(run({ PAPERCUSP_SEED_UUID_PLAN_SHA256: reboundDigest }).status, 1, 'plan cannot bind a different private census');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const release of [false, true]) {
  test(`D166 ${release ? 'release-local' : 'ensure-release-seed'} forwards the frozen plan and fails closed on cut errors`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uuid-seed-wrapper-'));
    try {
      const desktop = path.join(dir, 'papercusp-desktop'); const bin = path.join(desktop, 'bin');
      const fake = path.join(dir, 'fake-bin'); const store = path.join(dir, 'frozen-store');
      fs.mkdirSync(path.join(bin, 'lib'), { recursive: true }); fs.mkdirSync(path.join(dir, 'apps', 'operator'), { recursive: true });
      fs.mkdirSync(fake); fs.mkdirSync(store); fs.mkdirSync(path.join(desktop, 'src-tauri', 'seed'), { recursive: true });
      fs.copyFileSync(helper, path.join(bin, 'lib', 'seed-reuse-age.sh'));
      const census = path.join(dir, 'census.json'); fs.writeFileSync(census, JSON.stringify({ reviewRef: 'p2p-public-release-endgame-2026-09-01#D-166' }), { mode: 0o600 });
      const censusDigest = require('node:crypto').createHash('sha256').update(fs.readFileSync(census)).digest('hex');
      const plan = path.join(dir, 'plan.json'); fs.writeFileSync(plan, JSON.stringify({ privateSourceBindings: { configSha256: censusDigest } }), { mode: 0o600 });
      const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(plan)).digest('hex');
      const argsPath = path.join(dir, 'args.json');
      fs.writeFileSync(path.join(fake, 'npx'), '#!/usr/bin/env node\nconst fs=require("node:fs"),p=require("node:path");const a=process.argv.slice(2);fs.writeFileSync(process.env.UUID_TEST_ARGS_OUT,JSON.stringify(a));if(process.env.UUID_TEST_FAIL==="1")process.exit(7);const out=a[a.indexOf("--out")+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,"manifest.json"),"{}");fs.writeFileSync(p.join(out,"epoch-keys.json"),"{}");\n', { mode: 0o755 });
      const env = { ...process.env, PATH: `${fake}:${process.env.PATH}`, UUID_TEST_ARGS_OUT: argsPath,
        PAPERCUSP_SEED_UUID_PLAN_PATH: plan, PAPERCUSP_SEED_UUID_PLAN_SHA256: digest, PAPERCUSP_SEED_STORE_DIR: store,
        PAPERCUSP_SEED_UUID_CENSUS_PATH: census, PAPERCUSP_SEED_UUID_CENSUS_SHA256: censusDigest,
        PAPERCUSP_SEED_FORCE: '1', PAPERCUSP_SEED_REUSE_CORESTORE: '0', PAPERCUSP_SEED_CORESTORE: '1',
        PAPERCUSP_SEED_SPARSE: '0', PAPERCUSP_SKIP_SEED_CUT: '0', PAPERCUSP_FAST_ITER: '0', PAPERCUSP_SEED_SNAPSHOT_DIR: '',
        PAPERCUSP_SEED_EMIT_EPOCH_KEY: '1', PAPERCUSP_SEED_DEPTH: '' };
      const script = path.join(root, 'bin', release ? 'release-local.sh' : 'ensure-release-seed.sh');
      let command;
      if (release) {
        const definition = fs.readFileSync(script, 'utf8').match(/^cut_release_seed\(\) \{\n[\s\S]*?^\}/m)?.[0];
        assert(definition);
        command = `set -uo pipefail; source "$1/lib/seed-reuse-age.sh"; ORCHESTRATOR_HERE="$1"; ROOT="$2"; MONOREPO="$3"; release_seed_cut_is_quiesced(){ exit 69; }; release_seed_sparse_refused(){ return 1; }; ${definition}\ncut_release_seed || exit $?\ntest -n "$PAPERCUSP_SEED_UUID_CENSUS_PATH" && test -n "$PAPERCUSP_SEED_UUID_CENSUS_SHA256" || exit 72\nexport PAPERCUSP_SKIP_SEED_CUT=1; seed_uuid_row_drop_prepare`;
      } else {
        fs.copyFileSync(script, path.join(bin, 'ensure-release-seed.sh'));
      }
      const run = extra => spawnSync('bash', release ? ['-c', command, 'x', bin, desktop, dir] : [path.join(bin, 'ensure-release-seed.sh')],
        { encoding: 'utf8', env: { ...env, ...extra }, timeout: 10000 });
      const valid = run({}); assert.equal(valid.status, 0, valid.stderr + valid.stdout);
      const args = JSON.parse(fs.readFileSync(argsPath));
      assert(args.includes('--skip-corestore-refresh')); assert(!args.includes('--reuse-corestore')); assert(!args.includes('--sparse'));
      assert.equal(args[args.indexOf('--store-dir') + 1], store);
      assert.equal(args[args.indexOf('--uuid-idempotency-drop-plans') + 1], plan);
      assert.equal(args[args.indexOf('--uuid-idempotency-drop-plans-sha256') + 1], digest);
      const manifest = path.join(desktop, 'src-tauri', 'seed', 'manifest.json'); fs.writeFileSync(manifest, 'prior-output-sentinel');
      const failed = run({ UUID_TEST_FAIL: '1' }); assert.notEqual(failed.status, 0, failed.stdout);
      assert.equal(fs.readFileSync(manifest, 'utf8'), 'prior-output-sentinel');
      fs.rmSync(argsPath); const changed = run({ PAPERCUSP_SEED_UUID_PLAN_SHA256: 'b'.repeat(64) });
      assert.notEqual(changed.status, 0); assert(!fs.existsSync(argsPath), 'changed plan invoked the cutter');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

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

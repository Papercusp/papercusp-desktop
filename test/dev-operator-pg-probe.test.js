// `npm run dev` on a fresh clone (no developer database) must boot the embedded
// Postgres path (bin/serve.ts) instead of hono-host, which assumes a reachable
// database (open-source-release-2026-09-29 R-18). The probe mirrors the
// operator's own admin-URL resolution order.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROBE = path.join(__dirname, '..', 'bin', 'dev-operator-pg-probe.mjs');
const LAUNCHER = path.join(__dirname, '..', 'bin', 'dev-operator-ifneeded.sh');
const REPO_ROOT = path.join(__dirname, '..', '..');
const VERIFIER = path.join(REPO_ROOT, 'scripts', 'verify-tauri-headless.sh');

function migrationFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-schema-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sqlDir = path.join(root, 'sql');
  fs.mkdirSync(sqlDir);
  for (const name of ['374-old.sql', '1003-new.sql', '040-plugin-configs-backfill.sql', '001-per-harness-template.sql', 'README.md']) {
    fs.writeFileSync(path.join(sqlDir, name), '-- fixture\n');
  }
  return { root, sqlDir };
}

function fakePostgres(rows, failure) {
  const calls = [];
  let options;
  let target;
  let closed = false;
  const client = {
    unsafe(query) {
      calls.push(query);
      return failure ? Promise.reject(failure) : Promise.resolve(rows);
    },
    async end() { closed = true; },
  };
  return {
    factory(url, opts) { target = url; options = opts; return client; },
    client, calls,
    get options() { return options; },
    get target() { return target; },
    get closed() { return closed; },
  };
}

test('schema readiness uses runner eligibility/numeric order and reports pending without DDL', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { sqlDir } = migrationFixture(t);
  const pg = fakePostgres([]);
  const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory: pg.factory });
  assert.equal(result.status, 'pending');
  assert.deepEqual(result.pendingFiles, ['374-old.sql', '1003-new.sql']);
  assert.equal(result.pendingCount, 2);
  assert.equal(result.totalKnown, 2);
  assert.deepEqual(pg.calls, ['SELECT filename FROM harness_shared.schema_migrations']);
  assert.equal(pg.options.connection.default_transaction_read_only, 'on');
  assert.equal(pg.options.connection.statement_timeout, 3000);
  assert.equal(pg.closed, true);
});

test('schema readiness requires all eligible filenames, tolerating ledger entries from newer trees', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { sqlDir } = migrationFixture(t);
  const pg = fakePostgres([{ filename: '374-old.sql' }, { filename: '1003-new.sql' }, { filename: '9999-future.sql' }]);
  const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory: pg.factory });
  assert.equal(result.status, 'ready');
  assert.equal(result.pendingCount, 0);
  assert.deepEqual(result.pendingFiles, []);
});

test('schema readiness binds the exact resolved URL without exposing credentials', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { sqlDir } = migrationFixture(t);
  const url = 'postgresql://fixture:do-not-print@127.0.0.1:5532/selected';
  const pg = fakePostgres([]);
  const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { HARNESS_ADMIN_DATABASE_URL: url, DATABASE_URL: 'postgresql://wrong/db', PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory: pg.factory });
  assert.equal(pg.target, url);
  assert.equal(result.source, 'env:HARNESS_ADMIN_DATABASE_URL');
  assert.equal(result.targetFingerprint, require('node:crypto').createHash('sha256').update(url).digest('hex'));
  assert.equal(JSON.stringify(result).includes('do-not-print'), false);
});

test('a missing ledger or failed DB query is unavailable, never ready', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { sqlDir } = migrationFixture(t);
  for (const code of ['42P01', '57014', 'ECONNREFUSED']) {
    const pg = fakePostgres([], Object.assign(new Error('secret URL must not escape'), { code }));
    const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory: pg.factory });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.errorCode, code);
    assert.equal(JSON.stringify(result).includes('secret URL'), false);
    assert.equal(pg.closed, true);
  }
});

test('missing/empty migration corpus cannot establish readiness or connect to a fallback DB', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { root } = migrationFixture(t);
  for (const sqlDir of [path.join(root, 'missing'), path.join(root, 'empty')]) {
    if (sqlDir.endsWith('empty')) fs.mkdirSync(sqlDir);
    const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory() { assert.fail('must not connect'); } });
    assert.equal(result.status, 'unavailable');
  }
});

test('a nonsettling ledger query is bounded and its client is closed', async (t) => {
  const { probeDevPg } = await import(PROBE);
  const { sqlDir } = migrationFixture(t);
  const pg = fakePostgres([]);
  pg.client.unsafe = () => new Promise(() => {});
  const result = await probeDevPg({ repoRoot: REPO_ROOT, env: { PAPERCUSP_PG_SQL_DIR: sqlDir }, requireAppliedSchema: true, postgresFactory: pg.factory, timeoutMs: 25 });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'probe-deadline');
  assert.equal(pg.closed, true);
});

test('default reachability mode remains independent of the migration ledger', async () => {
  const { probeDevPg } = await import(PROBE);
  const pg = fakePostgres([{ '?column?': 1 }]);
  const result = await probeDevPg({ repoRoot: REPO_ROOT, env: {}, postgresFactory: pg.factory });
  assert.equal(result.status, 'reachable');
  assert.deepEqual(pg.calls, ['SELECT 1']);
});

test('verifier readiness runs before source/dependency snapshots, and skips only isolated DB mode', () => {
  const src = fs.readFileSync(VERIFIER, 'utf8');
  const call = src.indexOf('shared_schema_readiness_preflight || exit $?');
  assert.ok(call >= 0);
  assert.ok(call < src.indexOf('OPERATOR_SNAPSHOT_PARENT="$(select_verifier_snapshot_root)"'));
  assert.ok(call < src.indexOf('WORK="$(mktemp -d'));
  assert.match(src, /shared_schema_readiness_preflight\(\) \{[\s\S]*?VERIFY_TAURI_ISOLATED_DB:-0[\s\S]*?return 0/);
  assert.match(src, /dev-operator-pg-probe\.mjs" --repo-root "\$REPO_DIR" --require-applied-schema/);
});

function cliFixture(t) {
  const fixture = migrationFixture(t);
  fs.writeFileSync(path.join(fixture.root, 'package.json'), '{}');
  const pgDir = path.join(fixture.root, 'node_modules', 'postgres');
  fs.mkdirSync(pgDir, { recursive: true });
  fs.writeFileSync(path.join(pgDir, 'index.js'), `
    module.exports = (url, options) => ({
      unsafe: async (query) => {
        require('node:fs').writeFileSync(process.env.TEST_PROBE_RECEIPT, JSON.stringify({ url, options, query }));
        if (process.env.TEST_PROBE_FAILURE) throw Object.assign(new Error('private failure'), { code: process.env.TEST_PROBE_FAILURE });
        return JSON.parse(process.env.TEST_PROBE_APPLIED || '[]').map(filename => ({ filename }));
      },
      end: async () => {},
    });
  `);
  const runnerDir = path.join(fixture.root, 'node_modules', '@papercusp', 'embedded-postgres-server', 'src');
  fs.mkdirSync(runnerDir, { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'libs', 'papercusp', 'packages', 'embedded-postgres-server', 'src', 'migration-runner.js'), path.join(runnerDir, 'migration-runner.js'));
  fs.mkdirSync(path.join(fixture.root, 'apps', 'operator'), { recursive: true });
  return { ...fixture, receipt: path.join(fixture.root, 'receipt.json') };
}

test('real probe CLI reports ready/pending/unavailable exits with the selected schema ledger', (t) => {
  const f = cliFixture(t);
  for (const [applied, failure, expectedStatus, expectedExit] of [
    [['374-old.sql', '1003-new.sql'], '', 'ready', 0],
    [['374-old.sql'], '', 'pending', 75],
    [[], '42P01', 'unavailable', 74],
  ]) {
    const r = spawnSync(process.execPath, [PROBE, '--repo-root', f.root, '--require-applied-schema'], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, HARNESS_ADMIN_DATABASE_URL: 'postgresql://fixture:secret@selected/db', PAPERCUSP_PG_SQL_DIR: f.sqlDir, TEST_PROBE_RECEIPT: f.receipt, TEST_PROBE_APPLIED: JSON.stringify(applied), TEST_PROBE_FAILURE: failure },
    });
    assert.equal(r.status, expectedExit, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, expectedStatus);
    assert.equal(r.stdout.includes('secret'), false);
    assert.equal(JSON.parse(fs.readFileSync(f.receipt)).query, 'SELECT filename FROM harness_shared.schema_migrations');
  }
});

test('real verifier preflight binds sourced .env.local, propagates refusal, and leaves isolated DB alone', (t) => {
  const f = cliFixture(t);
  const src = fs.readFileSync(VERIFIER, 'utf8');
  const fn = src.slice(src.indexOf('shared_schema_readiness_preflight() {'), src.indexOf('shared_schema_readiness_preflight || exit $?'));
  fs.writeFileSync(path.join(f.root, 'apps', 'operator', '.env.local'), 'HARNESS_ADMIN_DATABASE_URL=postgresql://fixture:sourced@selected/db\n');
  const env = {
    ...process.env, REPO_DIR: f.root, DESKTOP_DIR: path.join(REPO_ROOT, 'papercusp-desktop'),
    HARNESS_ADMIN_DATABASE_URL: 'postgresql://fixture:ambient@wrong/db', PAPERCUSP_PG_SQL_DIR: f.sqlDir,
    TEST_PROBE_RECEIPT: f.receipt, TEST_PROBE_APPLIED: '[]', TEST_PROBE_FAILURE: '', VERIFY_TAURI_ISOLATED_DB: '0',
  };
  const run = (overrides = {}) => spawnSync('bash', ['-c', `${fn}\nshared_schema_readiness_preflight`], { encoding: 'utf8', timeout: 10000, env: { ...env, ...overrides } });
  const pending = run();
  assert.equal(pending.status, 75, pending.stderr);
  assert.match(pending.stderr, /VERIFY_TAURI_SHARED_SCHEMA_NOT_READY/);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).url, 'postgresql://fixture:sourced@selected/db');
  const ready = run({ TEST_PROBE_APPLIED: '["374-old.sql","1003-new.sql"]' });
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(JSON.parse(ready.stdout).status, 'ready');
  fs.unlinkSync(f.receipt);
  const isolated = run({ VERIFY_TAURI_ISOLATED_DB: '1' });
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(isolated.stdout, '');
  assert.equal(fs.existsSync(f.receipt), false);
  fs.writeFileSync(path.join(f.root, 'apps', 'operator', '.env.local'), 'return 1\n');
  const invalidEnv = run();
  assert.equal(invalidEnv.status, 74);
  assert.equal(fs.existsSync(f.receipt), false);
});

test('resolution order: env var, then discovery file, then native fallback', async () => {
  const { resolveDevPgUrl } = await import(PROBE);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-probe-home-'));
  assert.deepEqual(resolveDevPgUrl({}, home), {
    url: 'postgresql://harness_admin:harness_admin_pwd@localhost:5432/papercusp',
    source: 'native-fallback',
  });
  assert.equal(resolveDevPgUrl({ PAPERCUSP_PG_PORT: '5999' }, home).url, 'postgresql://harness_admin:harness_admin_pwd@localhost:5999/papercusp');
  fs.mkdirSync(path.join(home, '.papercusp'));
  fs.writeFileSync(path.join(home, '.papercusp', 'embedded-pg.json'), JSON.stringify({ url: 'postgresql://d@localhost:5532/papercusp' }));
  assert.deepEqual(resolveDevPgUrl({}, home), { url: 'postgresql://d@localhost:5532/papercusp', source: 'discovery' });
  assert.equal(resolveDevPgUrl({ PAPERCUSP_SKIP_PG_DISCOVERY: '1' }, home).source, 'native-fallback');
  assert.deepEqual(resolveDevPgUrl({ DATABASE_URL: 'postgresql://x@h/db', HARNESS_ADMIN_DATABASE_URL: 'postgresql://a@h/db' }, home), {
    url: 'postgresql://a@h/db',
    source: 'env:HARNESS_ADMIN_DATABASE_URL',
  });
});

test('ordinary dev launch preserves an unavailable configured DB and only falls back for an unconfigured clone', (t) => {
  const f = cliFixture(t);
  const launcher = fs.readFileSync(LAUNCHER, 'utf8');
  const selection = launcher.slice(
    launcher.indexOf('DEV_OPERATOR_MODE=external-pg'),
    launcher.indexOf('if [ "$DEV_OPERATOR_MODE" = embedded-pg ]; then'),
  );
  assert.ok(selection.includes('dev-operator-pg-probe.mjs'));
  const clean = { ...process.env };
  for (const name of ['HARNESS_ADMIN_DATABASE_URL', 'DATABASE_URL', 'PAPERCUSP_PG_URL', 'PAPERCUSP_PG_PORT', 'OPERATOR_DEV_CMD']) delete clean[name];
  const discoveryHome = path.join(f.root, 'discovery');
  fs.mkdirSync(discoveryHome);
  fs.writeFileSync(path.join(discoveryHome, 'embedded-pg.json'), JSON.stringify({ url: 'postgresql://fixture:secret@selected/db' }));
  for (const [config, failure, expectedExit, expectedMode] of [
    [{ DATABASE_URL: 'postgresql://fixture:secret@selected/db' }, 'ECONNREFUSED', 2, 'external-pg'],
    [{ DATABASE_URL: 'postgresql://fixture:secret@selected/db' }, '28P01', 2, 'external-pg'],
    [{ PAPERCUSP_HOME: discoveryHome, PAPERCUSP_SKIP_PG_DISCOVERY: '0' }, 'ECONNREFUSED', 2, 'external-pg'],
    [{ DATABASE_URL: 'postgresql://fixture:secret@selected/db' }, '', 0, 'external-pg'],
    [{}, 'ECONNREFUSED', 1, 'embedded-pg'],
  ]) {
    const env = { ...clean, PAPERCUSP_SKIP_PG_DISCOVERY: '1', TEST_PROBE_RECEIPT: f.receipt, TEST_PROBE_FAILURE: failure, SCRIPT_DIR: path.dirname(PROBE), DEV_OPERATOR_DIR: path.join(f.root, 'apps', 'operator'), DEV_SOURCE_ROOT: f.root, DEV_HOST_ENTRY: '', ...config };
    const probe = spawnSync(process.execPath, [PROBE, '--repo-root', f.root], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, expectedExit, probe.stderr);
    assert.equal(probe.stdout.includes('secret'), false);
    const selected = spawnSync('bash', ['-c', `set -euo pipefail\n${selection}\nprintf '%s\\n' "$DEV_OPERATOR_MODE"`], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(selected.stdout.trim().split('\n').at(-1), expectedMode);
    assert.equal(selected.stdout.includes('secret'), false);
    assert.equal(JSON.parse(fs.readFileSync(f.receipt)).query, 'SELECT 1');
  }
});

test('launcher falls back to bin/serve.ts only when the probe fails and nothing overrides it', () => {
  const src = fs.readFileSync(LAUNCHER, 'utf8');
  assert.match(src, /dev-operator-pg-probe\.mjs/);
  assert.match(src, /\[ -z "\$DEV_HOST_ENTRY" \] && \[ -z "\$\{OPERATOR_DEV_CMD:-\}" \]/);
  assert.match(src, /DEV_OPERATOR_MODE=embedded-pg/);
  assert.match(src, /npx tsx bin\/serve\.ts --ui/);
  const r = spawnSync('bash', ['-n', LAUNCHER]);
  assert.equal(r.status, 0, String(r.stderr));
});

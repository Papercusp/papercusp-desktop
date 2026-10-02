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

test('an unreachable database exits 1 (so the launcher picks embedded Postgres)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-probe-home-'));
  const r = spawnSync(process.execPath, [PROBE, '--repo-root', REPO_ROOT], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home, HARNESS_ADMIN_DATABASE_URL: 'postgresql://nobody:x@127.0.0.1:1/none', DATABASE_URL: '', PAPERCUSP_PG_URL: '' },
    timeout: 20000,
  });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /^unreachable env:HARNESS_ADMIN_DATABASE_URL/);
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

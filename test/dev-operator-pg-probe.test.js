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

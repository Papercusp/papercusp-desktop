#!/usr/bin/env node
// Can the dev operator reach the database hono-host would use?
//
// `npm run dev` starts apps/operator/bin/hono-host.ts, which ASSUMES Postgres is
// already up: it resolves the admin URL exactly as getHarnessAdminUrl() does
// (packages/operator-core/lib/embedded-pg-discovery.ts) — env vars, then the
// embedded-pg.json discovery file, then native localhost:5432 as harness_admin.
// A developer box has one of those. A fresh clone has none, so hono-host
// crash-looped on "password authentication failed for user harness_admin"
// (open-source-release-2026-09-29 R-18 fresh-VM build). dev-operator-ifneeded.sh
// uses this probe to fall back to bin/serve.ts, which starts its own embedded
// Postgres — what the public README promises.
//
// Exit 0: reachable. Exit 1: unconfigured native fallback is unavailable, so
// a fresh clone may boot embedded PG. Exit 2: the configured/discovered DB is
// unavailable; preserve that database and let the dev supervisor retry it.
// --require-applied-schema additionally compares the runner's eligible files
// with the read-only migration ledger. It never applies a migration. Native
// verification uses this before copying/building a private host; ordinary dev
// launches keep the existing reachability-only fallback.
// --source-ref selects the committed migration corpus, including its gitlinks,
// without exporting/building that source or consulting newer working-tree SQL.
// Usage: node dev-operator-pg-probe.mjs [--repo-root <dir>] [--require-applied-schema] [--source-ref <commit>]

import { existsSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ENV_VARS = ['HARNESS_ADMIN_DATABASE_URL', 'DATABASE_URL', 'PAPERCUSP_PG_URL'];
const NATIVE_FALLBACK = 'postgresql://harness_admin:harness_admin_pwd@localhost:5432/papercusp';

/** Same order as getHarnessAdminUrlWithSource(); kept pure for tests. */
export function resolveDevPgUrl(env = process.env, home = homedir()) {
  for (const name of ENV_VARS) {
    if (env[name]) return { url: env[name], source: `env:${name}` };
  }
  if (env.PAPERCUSP_SKIP_PG_DISCOVERY !== '1') {
    const rel = env.PAPERCUSP_HOME ? join(env.PAPERCUSP_HOME, 'embedded-pg.json') : '.papercusp/embedded-pg.json';
    const file = isAbsolute(rel) ? rel : join(home, rel);
    if (existsSync(file)) {
      try {
        const doc = JSON.parse(readFileSync(file, 'utf8'));
        if (typeof doc.url === 'string' && doc.url) return { url: doc.url, source: 'discovery' };
      } catch {
        /* unreadable discovery file: fall through, as the resolver does */
      }
    }
  }
  const port = Number(env.PAPERCUSP_PG_PORT);
  if (Number.isInteger(port) && port > 0 && port <= 65_535) {
    return { url: `postgresql://harness_admin:harness_admin_pwd@localhost:${port}/papercusp`, source: 'native-fallback' };
  }
  return { url: NATIVE_FALLBACK, source: 'native-fallback' };
}

function committedMigrationFiles(repoRoot, sqlDir, sourceRef, timeoutMs) {
  const rel = relative(repoRoot, sqlDir);
  if (!sourceRef || !rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Committed migration corpus must be inside the selected source');
  }
  const gitEnv = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete gitEnv[key];
  const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8', env: gitEnv, timeout: Math.min(timeoutMs, 3000), maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rootCommit = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${sourceRef}^{commit}`]).trim();
  let checkout = repoRoot, commit = rootCommit, parts = rel.split(sep);
  // A gitlink's commit, rather than the nested checkout's HEAD, defines the
  // selected corpus. Flattened release-source repositories work the same way.
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join('/');
    const entry = git(checkout, ['ls-tree', '-z', commit, '--', prefix]);
    const link = /^160000 commit ([0-9a-f]{40,64})\t/.exec(entry);
    if (link) {
      checkout = join(checkout, prefix);
      commit = link[1];
      parts = parts.slice(i + 1);
      i = -1;
    }
  }
  const files = git(checkout, ['ls-tree', '-z', '--name-only', `${commit}:${parts.join('/')}`])
    .split('\0').filter(Boolean);
  return { files, sourceRef: rootCommit, schemaSourceRef: commit };
}

export async function probeDevPg({ repoRoot, env = process.env, home = homedir(), requireAppliedSchema = false, sourceRef, postgresFactory, timeoutMs = 5000 }) {
  const { url, source } = resolveDevPgUrl(env, home);
  const identity = { source, targetFingerprint: createHash('sha256').update(url).digest('hex') };
  const require = createRequire(pathToFileURL(join(repoRoot, 'package.json')));
  let sql;
  let deadline;
  let expired = false;
  try {
    const inspect = async () => {
      let files;
      let sqlDir;
      let committedSource = {};
      if (requireAppliedSchema) {
        // Import the pure runner subpath, never its embedded-binary barrel.
        const { defaultSkipFile, compareMigrationFilenames } = await import(pathToFileURL(
          require.resolve('@papercusp/embedded-postgres-server/src/migration-runner.js'),
        ).href);
        if (expired) return { ...identity, status: 'unavailable', reason: 'probe-deadline' };
        sqlDir = env.PAPERCUSP_PG_SQL_DIR
          ? resolve(env.PAPERCUSP_PG_SQL_DIR)
          : join(repoRoot, 'libs', 'papercusp', 'libs', 'db', 'sql');
        const corpus = sourceRef === undefined ? { files: readdirSync(sqlDir) }
          : committedMigrationFiles(repoRoot, sqlDir, sourceRef, timeoutMs);
        files = corpus.files.filter((f) => f.endsWith('.sql') && !defaultSkipFile(f)).sort(compareMigrationFilenames);
        if (sourceRef !== undefined) committedSource = { sourceRef: corpus.sourceRef, schemaSourceRef: corpus.schemaSourceRef };
        if (files.length === 0) return { ...identity, status: 'unavailable', reason: 'empty-migration-corpus', sqlDir };
      }
      const postgres = postgresFactory ?? require('postgres');
      sql = postgres(url, {
        max: 1, connect_timeout: 3, idle_timeout: 1, onnotice: () => {},
        connection: { default_transaction_read_only: 'on', statement_timeout: 3000, application_name: 'papercusp-dev-pg-probe' },
      });
      if (!requireAppliedSchema) {
        await sql.unsafe('SELECT 1');
        return { ...identity, status: 'reachable' };
      }
      const rows = await sql.unsafe('SELECT filename FROM harness_shared.schema_migrations');
      const applied = new Set(rows.map((row) => row.filename));
      const pending = files.filter((f) => !applied.has(f));
      return { ...identity, ...committedSource, status: pending.length ? 'pending' : 'ready', sqlDir, totalKnown: files.length, pendingCount: pending.length, pendingFiles: pending.slice(0, 5) };
    };
    return await Promise.race([
      inspect(),
      new Promise((resolveDeadline) => {
        deadline = setTimeout(() => {
          expired = true;
          resolveDeadline({ ...identity, status: 'unavailable', reason: 'probe-deadline' });
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    // Postgres errors can include credentials/query text. Expose only codes.
    return { ...identity, status: 'unavailable', reason: 'probe-failed', ...(typeof error?.code === 'string' ? { errorCode: error.code } : {}) };
  } finally {
    clearTimeout(deadline);
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function main(argv) {
  const i = argv.indexOf('--repo-root');
  const repoRoot = resolve(i >= 0 ? argv[i + 1] : join(fileURLToPath(new URL('.', import.meta.url)), '..', '..'));
  const requireAppliedSchema = argv.includes('--require-applied-schema');
  const sourceIndex = argv.indexOf('--source-ref');
  const sourceRef = sourceIndex >= 0 ? (argv[sourceIndex + 1] ?? '') : undefined;
  const result = await probeDevPg({ repoRoot, requireAppliedSchema, sourceRef });
  if (requireAppliedSchema) {
    console.log(JSON.stringify(result));
    return result.status === 'ready' ? 0 : result.status === 'pending' ? 75 : 74;
  }
  const reachable = result.status === 'reachable';
  console.log(`${reachable ? 'reachable' : 'unreachable'} ${result.source}`);
  return reachable ? 0 : result.source === 'native-fallback' ? 1 : 2;
}

// realpath both sides: node realpaths import.meta.url but keeps argv[1] as invoked.
const self = realpathSync(fileURLToPath(import.meta.url));
// Stdin uses '-' and importers may supply a non-file entrypoint. Neither runs
// this CLI; avoid turning a successful library import into a filesystem error.
let entryPoint;
if (process.argv[1] && process.argv[1] !== '-') {
  try {
    entryPoint = realpathSync(resolve(process.argv[1]));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
  }
}
if (entryPoint === self) {
  main(process.argv.slice(2)).then((c) => process.exit(c), () => process.exit(1));
}

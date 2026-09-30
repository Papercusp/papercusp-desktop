// WI-10004350 — the sidecar's bundled embedded-postgres-server runtime deps
// must install from the package's COMMITTED lock. The builder used to copy only
// package.json and run a lockless `npm install`, so each cut shipped whatever pg
// patch release was newest at build time (0.0.26: pg 8.23.0 in one build, 8.23.1
// in a repro of the same source) while the lock the tree tests pins pg 8.20.0.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const builder = fs.readFileSync(path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'), 'utf8');

/** Extract a top-level shell helper from the real builder for behavioral tests. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert(start >= 0, `${name}() is missing from build-desktop-sidecar.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const HELPERS = `${extractFunction('install_locked_runtime_deps')}\n${extractFunction('assert_lock_exact_install')}`;
const BASH = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));

function runHelpers(script, env = {}) {
  assert.ok(BASH, 'a bash interpreter is required to exercise the builder helpers');
  return childProcess.spawnSync(BASH, ['-c', `set -euo pipefail\n${HELPERS}\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-10004350-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const LOCK = {
  name: 'fixture',
  lockfileVersion: 3,
  packages: {
    '': { name: 'fixture', dependencies: { pg: '^8.20.0' } },
    'node_modules/pg': { version: '8.20.0' },
    'node_modules/pg-protocol': { version: '1.13.0' },
    'node_modules/@embedded-postgres/darwin-arm64': { version: '18.3.0-beta.17', optional: true },
    'node_modules/devonly': { version: '1.0.0', dev: true },
  },
};

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function installed(dir, name, version) {
  writeJson(path.join(dir, 'node_modules', name, 'package.json'), { name, version });
}

test('the embedded-postgres-server bundle installs through the lock-exact helper, never a lockless npm install', () => {
  const start = builder.indexOf('# Bundle the embedded-postgres-server package');
  const end = builder.indexOf('# WI-5651: cross-swap the embedded-postgres binary pkg');
  assert(start >= 0 && end > start, 'embedded-postgres-server bundling block not found');
  // Commands only: the block's comments legitimately name the retired `npm install`.
  const block = builder
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.match(block, /install_locked_runtime_deps "\$EMBEDDED_PG_SRC" "\$EMBEDDED_PG_DST" embedded-postgres-server/);
  assert.doesNotMatch(block, /\bnpm install\b/, 'a lockless npm install is back in the embedded-postgres-server block');
});

test('the darwin cross-swap takes its @embedded-postgres version from the committed lock', () => {
  const start = builder.indexOf('# WI-5651: cross-swap the embedded-postgres binary pkg');
  const end = builder.indexOf('fetch_cross_npm_pkg "@embedded-postgres/darwin-', start);
  assert(start >= 0 && end > start, 'darwin cross-swap block not found');
  const block = builder.slice(start, end);
  assert.match(block, /_epg_ver="\$\(node -e "const l=require\('\$EMBEDDED_PG_DST\/package-lock\.json'\)/);
  assert.match(block, /node_modules\/@embedded-postgres\/darwin-\$\{TARGET_ARCH\}/);
});

test('the source package this builder bundles really commits the lock it installs from', () => {
  const lockPath = path.join(repoRoot, 'libs/papercusp/packages/embedded-postgres-server/package-lock.json');
  assert.ok(fs.existsSync(lockPath), 'embedded-postgres-server/package-lock.json is missing; the build now refuses to bundle');
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.ok(lock.packages?.['node_modules/pg']?.version, 'the lock pins no pg version');
  assert.ok(lock.packages?.['node_modules/@embedded-postgres/darwin-arm64']?.version, 'the lock pins no darwin-arm64 binary package');
});

test('assert_lock_exact_install passes a lock-exact tree and skips optional/dev entries that are absent', (t) => {
  const dir = tmpDir(t);
  writeJson(path.join(dir, 'package-lock.json'), LOCK);
  installed(dir, 'pg', '8.20.0');
  installed(dir, 'pg-protocol', '1.13.0');
  const result = runHelpers(`assert_lock_exact_install "${dir}" fixture`);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /lock-exact \(2 installed packages/);
});

test('assert_lock_exact_install fails on a drifted version and names the package', (t) => {
  const dir = tmpDir(t);
  writeJson(path.join(dir, 'package-lock.json'), LOCK);
  installed(dir, 'pg', '8.23.1');
  installed(dir, 'pg-protocol', '1.13.0');
  const result = runHelpers(`assert_lock_exact_install "${dir}" fixture`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules\/pg: installed 8\.23\.1 != locked 8\.20\.0/);
});

test('assert_lock_exact_install fails when a required locked package is missing', (t) => {
  const dir = tmpDir(t);
  writeJson(path.join(dir, 'package-lock.json'), LOCK);
  installed(dir, 'pg', '8.20.0');
  const result = runHelpers(`assert_lock_exact_install "${dir}" fixture`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /node_modules\/pg-protocol: locked 1\.13\.0 but not installed/);
});

test('assert_lock_exact_install refuses a vacuous pass when nothing is installed', (t) => {
  const dir = tmpDir(t);
  writeJson(path.join(dir, 'package-lock.json'), { lockfileVersion: 3, packages: { '': {}, 'node_modules/x': { version: '1.0.0', optional: true } } });
  const result = runHelpers(`assert_lock_exact_install "${dir}" fixture`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /zero locked packages are installed/);
});

function npmShim(t) {
  const shimDir = tmpDir(t);
  const log = path.join(shimDir, 'npm.log');
  // Records its argv, then materializes node_modules exactly as the lock in cwd says.
  fs.writeFileSync(
    path.join(shimDir, 'npm'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${log}"\nnode -e '
const fs=require("fs"),path=require("path");
const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));
for (const [k,e] of Object.entries(lock.packages)) {
  if (!k.startsWith("node_modules/") || e.optional || e.dev) continue;
  fs.mkdirSync(k,{recursive:true});
  fs.writeFileSync(path.join(k,"package.json"),JSON.stringify({version:e.version}));
}'\n`,
    { mode: 0o755 },
  );
  return { shimDir, log };
}

test('install_locked_runtime_deps copies the committed lock, runs npm ci with the flags, and verifies', (t) => {
  const src = tmpDir(t);
  const dst = tmpDir(t);
  writeJson(path.join(src, 'package-lock.json'), LOCK);
  const { shimDir, log } = npmShim(t);
  const result = runHelpers(
    `install_locked_runtime_deps "${src}" "${dst}" fixture --omit=dev --no-workspaces`,
    { PATH: `${shimDir}:${process.env.PATH}` },
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(log, 'utf8').trim(), 'ci --omit=dev --no-workspaces');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dst, 'package-lock.json'), 'utf8')), LOCK);
  assert.match(result.stdout, /fixture runtime deps are lock-exact/);
});

test('install_locked_runtime_deps refuses a package with no committed lock and never runs npm', (t) => {
  const src = tmpDir(t);
  const dst = tmpDir(t);
  const { shimDir, log } = npmShim(t);
  const result = runHelpers(`install_locked_runtime_deps "${src}" "${dst}" fixture --omit=dev`, {
    PATH: `${shimDir}:${process.env.PATH}`,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /WI-10004350: fixture has no committed package-lock\.json/);
  assert.equal(fs.existsSync(log), false, 'npm ran even though the lock was missing');
});

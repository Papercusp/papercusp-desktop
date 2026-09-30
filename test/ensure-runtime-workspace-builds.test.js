// A fresh clone must be able to start the dev operator: any workspace whose
// runtime entry (main/bin/require/default) is a missing dist/ file is found and
// built before launch (open-source-release-2026-09-29 R-18: @papercusp/sse).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'ensure-runtime-workspace-builds.mjs');
const LAUNCHER = path.join(__dirname, '..', 'bin', 'dev-operator-ifneeded.sh');

function makeRoot(pkgs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-builds-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'root', private: true }));
  fs.mkdirSync(path.join(root, 'node_modules', '@papercusp'), { recursive: true });
  for (const [dirName, pkg, files = []] of pkgs) {
    const dir = path.join(root, 'libs', dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), '');
    }
    fs.symlinkSync(path.join('..', '..', 'libs', dirName), path.join(root, 'node_modules', '@papercusp', dirName));
  }
  return root;
}

const SSE_SHAPE = {
  name: '@papercusp/sse',
  main: 'dist/index.js',
  types: 'src/index.ts',
  exports: {
    '.': { types: './src/index.ts', import: './src/index.ts', require: './dist/index.js', default: './dist/index.js' },
  },
  scripts: { build: 'x' },
};

test('finds a workspace whose require/default entry is a missing dist file', async () => {
  const { findMissingRuntimeBuilds } = await import(SCRIPT);
  const root = makeRoot([
    ['sse', SSE_SHAPE],
    ['src-only', { name: '@papercusp/src-only', exports: { '.': { import: './src/index.ts', types: './src/index.ts' } } }],
    ['built', { ...SSE_SHAPE, name: '@papercusp/built' }, ['dist/index.js']],
  ]);
  const missing = findMissingRuntimeBuilds(root);
  assert.deepEqual(missing.map((m) => m.name), ['@papercusp/sse']);
  assert.deepEqual(missing[0].absent, ['dist/index.js']);
  assert.equal(missing[0].buildable, true);
});

test('types/import-only dist targets are not runtime entries', async () => {
  const { runtimeTargets } = await import(SCRIPT);
  assert.deepEqual(
    runtimeTargets({ exports: { '.': { types: './dist/x.d.ts', import: './src/x.ts' } } }),
    [],
  );
  assert.deepEqual(runtimeTargets({ bin: { a: './dist/cli.js' } }), ['dist/cli.js']);
});

test('--check exits 1 when a runtime build is missing and 0 once it exists', () => {
  const root = makeRoot([['sse', SSE_SHAPE]]);
  const r1 = spawnSync(process.execPath, [SCRIPT, root, '--check'], { encoding: 'utf8' });
  assert.equal(r1.status, 1, r1.stderr);
  assert.match(r1.stderr, /@papercusp\/sse .* is missing dist\/index\.js/);
  fs.mkdirSync(path.join(root, 'libs', 'sse', 'dist'));
  fs.writeFileSync(path.join(root, 'libs', 'sse', 'dist', 'index.js'), '');
  const r2 = spawnSync(process.execPath, [SCRIPT, root, '--check'], { encoding: 'utf8' });
  assert.equal(r2.status, 0, r2.stderr);
});

test('a missing target with no build script fails closed', () => {
  const { scripts, ...noBuild } = SSE_SHAPE;
  void scripts;
  const root = makeRoot([['sse', noBuild]]);
  const r = spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /has no build script/);
});

test('the dev launcher runs the preflight before spawning the operator', () => {
  const src = fs.readFileSync(LAUNCHER, 'utf8');
  const pre = src.indexOf('ensure-runtime-workspace-builds.mjs');
  const spawn = src.indexOf('echo "[tauri] starting operator dev server');
  assert.ok(pre > 0, 'launcher must invoke ensure-runtime-workspace-builds.mjs');
  assert.ok(pre < spawn, 'preflight must run before the operator spawn');
});

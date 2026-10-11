// Guards pg_textsearch (BM25 lexical search) packaging in the desktop sidecar — plan
// bm25-lexical-search-evoke-adoption-2026-10-10, P-002 / R-5.
//
// Three properties, each falsifiable:
//   1. the Linux host-tool preflight refuses a build host missing any pg_textsearch input;
//   2. the bundle block copies the library, control, SQL and licence notice into every
//      embedded-postgres tree (both layouts), fails a Linux build that cannot, and skips
//      darwin/Windows with a warning instead of shipping a broken tree;
//   3. embedded-postgres-server preloads pg_textsearch exactly when the binary tree holds
//      the library — a missing library in shared_preload_libraries would stop the
//      postmaster from starting at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const script = path.join(root, 'bin/build-desktop-sidecar.sh');
const source = fs.readFileSync(script, 'utf8');

function block(begin, end) {
  const parts = source.split(`# ${begin}\n`);
  assert.equal(parts.length, 2, `${begin} marker must appear exactly once`);
  const tail = parts[1].split(`# ${end}`);
  assert.equal(tail.length, 2, `${end} marker must appear exactly once`);
  return tail[0];
}

function fakeHostInstall(scratch) {
  const lib = path.join(scratch, 'lib');
  const extension = path.join(scratch, 'extension');
  const doc = path.join(scratch, 'doc');
  for (const d of [lib, extension, doc]) fs.mkdirSync(d, { recursive: true });
  const files = {
    so: path.join(lib, 'pg_textsearch.so'),
    control: path.join(extension, 'pg_textsearch.control'),
    sql: path.join(extension, 'pg_textsearch--1.5.1.sql'),
    licence: path.join(doc, 'copyright'),
  };
  const reset = () => Object.values(files).forEach((f) => fs.writeFileSync(f, `fixture ${path.basename(f)}`));
  const rewrite = (text) => text
    .replaceAll('/usr/lib/postgresql/18/lib', lib)
    .replaceAll('/usr/share/postgresql/18/extension', extension)
    .replaceAll('/usr/share/doc/postgresql-18-pg-textsearch', doc);
  return { files, reset, rewrite };
}

test('Linux preflight fails early for each missing or empty pg_textsearch input', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgts-preflight-'));
  try {
    const host = fakeHostInstall(scratch);
    const pre = host.rewrite(block('LINUX_PG_TEXTSEARCH_PREFLIGHT_BEGIN', 'LINUX_PG_TEXTSEARCH_PREFLIGHT_END'));
    const run = (target, profile) => spawnSync('bash', ['-euo', 'pipefail', '-c',
      '_missing_host_tools=();\n' + pre +
      '\nif (( ${#_missing_host_tools[@]} )); then printf "%s\\n" "${_missing_host_tools[@]}"; exit 1; fi'], {
      encoding: 'utf8', env: { ...process.env, TARGET_OS: target, DISTRIBUTION_PROFILE: profile },
    });
    host.reset();
    assert.equal(run('linux', 'dogfood').status, 0);
    for (const file of [host.files.so, host.files.control, host.files.sql]) {
      for (const state of ['missing', 'empty']) {
        host.reset();
        if (state === 'missing') fs.unlinkSync(file); else fs.writeFileSync(file, '');
        const r = run('linux', 'dogfood');
        assert.equal(r.status, 1, `${file} ${state}: ${r.stderr}`);
        assert.match(r.stdout, /PostgreSQL 18 pg_textsearch library, control and SQL files/);
        assert.match(r.stdout, /apt install postgresql-18-pg-textsearch/);
        assert.equal(run('linux', 'vm-release').status, 0, 'vm-release prepares its own PostgreSQL closure');
        assert.equal(run('darwin', 'dogfood').status, 0);
        assert.equal(run('windows', 'dogfood').status, 0);
      }
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

function runBundle(scratch, host, target, profile = 'dogfood') {
  const dst = path.join(scratch, 'pgdst');
  fs.rmSync(dst, { recursive: true, force: true });
  // Debian layout (upstream npm binaries) and the relocatable prefix (pinned source build).
  const debian = path.join(dst, 'node_modules/@embedded-postgres/linux-x64/native');
  const relocatable = path.join(dst, 'node_modules/@embedded-postgres/linux-arm64/native');
  fs.mkdirSync(path.join(debian, 'lib/postgresql'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'share/extension'), { recursive: true });
  fs.writeFileSync(path.join(relocatable, 'lib/pgcrypto.so'), 'x');
  const body = host.rewrite(block('PG_TEXTSEARCH_BUNDLE_BEGIN', 'PG_TEXTSEARCH_BUNDLE_END'));
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', body], {
    encoding: 'utf8',
    env: { ...process.env, TARGET_OS: target, DISTRIBUTION_PROFILE: profile, EMBEDDED_PG_DST: dst },
  });
  return { r, debian, relocatable };
}

test('bundle block copies library, control, SQL and licence into both runtime layouts', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgts-bundle-'));
  try {
    const host = fakeHostInstall(scratch);
    host.reset();
    const { r, debian, relocatable } = runBundle(scratch, host, 'linux');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /pg_textsearch copied into 2 embedded-postgres tree\(s\)/);
    for (const [libDir, extDir] of [
      [path.join(debian, 'lib/postgresql'), path.join(debian, 'share/postgresql/extension')],
      [path.join(relocatable, 'lib'), path.join(relocatable, 'share/extension')],
    ]) {
      assert.ok(fs.existsSync(path.join(libDir, 'pg_textsearch.so')), `${libDir}/pg_textsearch.so`);
      for (const f of ['pg_textsearch.control', 'pg_textsearch--1.5.1.sql', 'pg_textsearch.LICENSE']) {
        assert.ok(fs.existsSync(path.join(extDir, f)), `${extDir}/${f}`);
      }
      assert.equal(fs.readFileSync(path.join(extDir, 'pg_textsearch.LICENSE'), 'utf8'), 'fixture copyright');
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('bundle block fails a Linux build without pg_textsearch or its licence, and skips darwin/Windows', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgts-bundle-'));
  try {
    const host = fakeHostInstall(scratch);
    host.reset();
    fs.unlinkSync(host.files.so);
    let { r } = runBundle(scratch, host, 'linux');
    assert.equal(r.status, 1, 'a Linux bundle without pg_textsearch must not build');
    assert.match(r.stdout, /ERROR: pg_textsearch not found/);
    ({ r } = runBundle(scratch, host, 'linux', 'vm-release'));
    assert.equal(r.status, 0, 'vm-release warns rather than failing');
    assert.match(r.stdout, /not found .* for vm-release/);

    host.reset();
    fs.unlinkSync(host.files.licence);
    ({ r } = runBundle(scratch, host, 'linux'));
    assert.equal(r.status, 1, 'the PostgreSQL licence notice must ship with every copy');
    assert.match(r.stdout, /licence notice missing/);

    host.reset();
    for (const target of ['darwin', 'windows']) {
      const out = runBundle(scratch, host, target);
      assert.equal(out.r.status, 0, out.r.stdout + out.r.stderr);
      assert.match(out.r.stdout, new RegExp(`pg_textsearch not bundled for ${target}`));
      assert.ok(!fs.existsSync(path.join(out.debian, 'lib/postgresql/pg_textsearch.so')), `${target} copies nothing`);
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test('embedded-postgres-server preloads pg_textsearch only when the binary tree has the library', async () => {
  const mod = await import(pathToFileURL(path.join(repoRoot,
    'libs/papercusp/packages/embedded-postgres-server/src/index.js')).href);
  assert.deepEqual([...mod.OPTIONAL_PRELOAD_LIBRARIES], ['pg_textsearch']);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'embedded-pg-preload-'));
  try {
    const bin = path.join(scratch, 'native/bin/postgres');
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    assert.deepEqual(mod.presentPreloadLibraries(bin), [], 'no library, no preload');
    assert.deepEqual(mod.preloadFlags([]), []);
    for (const rel of ['lib/postgresql/pg_textsearch.so', 'lib/pg_textsearch.dylib', 'lib/pg_textsearch.dll']) {
      fs.rmSync(path.join(scratch, 'native/lib'), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(path.join(scratch, 'native', rel)), { recursive: true });
      fs.writeFileSync(path.join(scratch, 'native', rel), 'x');
      assert.deepEqual(mod.presentPreloadLibraries(bin), ['pg_textsearch'], rel);
    }
    assert.deepEqual(mod.preloadFlags(['pg_textsearch']), ['-c', 'shared_preload_libraries=pg_textsearch']);
    assert.deepEqual(mod.presentPreloadLibraries(null), []);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

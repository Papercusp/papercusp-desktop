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
//      postmaster from starting at all;
//   4. the ABI gate refuses a library that imports a symbol the embedded server does not
//      export (D-014: pg_textsearch built for PG 18.4 needs palloc_mul, absent from 18.3),
//      because a preloaded library the server cannot load stops it just as hard.
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
  const tsearchData = path.join(scratch, 'tsearch_data');
  for (const d of [lib, extension, doc, tsearchData]) fs.mkdirSync(d, { recursive: true });
  const files = {
    so: path.join(lib, 'pg_textsearch.so'),
    dictSnowball: path.join(lib, 'dict_snowball.so'),
    control: path.join(extension, 'pg_textsearch.control'),
    sql: path.join(extension, 'pg_textsearch--1.5.1.sql'),
    licence: path.join(doc, 'copyright'),
    englishStop: path.join(tsearchData, 'english.stop'),
  };
  const reset = () => Object.values(files).forEach((f) => fs.writeFileSync(f, `fixture ${path.basename(f)}`));
  const rewrite = (text) => text
    .replaceAll('/usr/lib/postgresql/18/lib', lib)
    .replaceAll('/usr/share/postgresql/18/extension', extension)
    .replaceAll('/usr/share/postgresql/18/tsearch_data', tsearchData)
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

test('Linux preflight requires dict_snowball and english.stop before building', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-snowball-preflight-'));
  try {
    const host = fakeHostInstall(scratch);
    const pre = host.rewrite(block('LINUX_PG_SNOWBALL_PREFLIGHT_BEGIN', 'LINUX_PG_SNOWBALL_PREFLIGHT_END'));
    const run = (target, profile) => spawnSync('bash', ['-euo', 'pipefail', '-c',
      '_missing_host_tools=();\n' + pre +
      '\nif (( ${#_missing_host_tools[@]} )); then printf "%s\\n" "${_missing_host_tools[@]}"; exit 1; fi'], {
      encoding: 'utf8', env: { ...process.env, TARGET_OS: target, DISTRIBUTION_PROFILE: profile },
    });
    host.reset();
    assert.equal(run('linux', 'dogfood').status, 0);
    for (const file of [host.files.dictSnowball, host.files.englishStop]) {
      for (const state of ['missing', 'empty']) {
        host.reset();
        if (state === 'missing') fs.unlinkSync(file); else fs.writeFileSync(file, '');
        const r = run('linux', 'dogfood');
        assert.equal(r.status, 1, `${file} ${state}: ${r.stderr}`);
        assert.match(r.stdout, /dict_snowball library and english\.stop data/);
        assert.match(r.stdout, /apt install postgresql-18/);
        assert.equal(run('linux', 'vm-release').status, 0, 'vm-release builds its own PostgreSQL closure');
        assert.equal(run('darwin', 'dogfood').status, 0);
        assert.equal(run('windows', 'dogfood').status, 0);
      }
    }
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

// The bundle block calls pg_library_abi_gaps (its own marked block, exercised against
// real ELF files in the last test). The fixtures here are text files, so the copy tests
// stub it: '' reports a loadable library, a symbol list reports what the server lacks.
function runBundle(scratch, host, target, profile = 'dogfood', gaps = '') {
  const dst = path.join(scratch, 'pgdst');
  fs.rmSync(dst, { recursive: true, force: true });
  // Debian layout (upstream npm binaries) and the relocatable prefix (pinned source build).
  const debian = path.join(dst, 'node_modules/@embedded-postgres/linux-x64/native');
  const relocatable = path.join(dst, 'node_modules/@embedded-postgres/linux-arm64/native');
  fs.mkdirSync(path.join(debian, 'lib/postgresql'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'share/extension'), { recursive: true });
  fs.writeFileSync(path.join(relocatable, 'lib/pgcrypto.so'), 'x');
  assert.ok(!gaps.includes("'"), 'stub gaps must not contain a single quote');
  const body = `pg_library_abi_gaps() { printf '%s' '${gaps}'; }\n` +
    host.rewrite(block('PG_TEXTSEARCH_BUNDLE_BEGIN', 'PG_TEXTSEARCH_BUNDLE_END'));
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', body], {
    encoding: 'utf8',
    env: { ...process.env, TARGET_OS: target, DISTRIBUTION_PROFILE: profile, EMBEDDED_PG_DST: dst },
  });
  return { r, debian, relocatable };
}

function runSnowballBundle(scratch, host, profile = 'dogfood', gaps = '') {
  const dst = path.join(scratch, 'snowball-pgdst');
  fs.rmSync(dst, { recursive: true, force: true });
  const debian = path.join(dst, 'node_modules/@embedded-postgres/linux-x64/native');
  const relocatable = path.join(dst, 'node_modules/@embedded-postgres/linux-arm64/native');
  fs.mkdirSync(path.join(debian, 'lib/postgresql'), { recursive: true });
  fs.mkdirSync(path.join(debian, 'share/postgresql/tsearch_data'), { recursive: true });
  fs.mkdirSync(path.join(debian, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(debian, 'bin/postgres'), 'postgres fixture');
  fs.mkdirSync(path.join(relocatable, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'share/extension'), { recursive: true });
  fs.mkdirSync(path.join(relocatable, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(relocatable, 'lib/pgcrypto.so'), 'x');
  fs.writeFileSync(path.join(relocatable, 'bin/postgres'), 'postgres fixture');
  assert.ok(!gaps.includes("'"), 'stub gaps must not contain a single quote');
  const body = `pg_library_abi_gaps() { printf '%s' '${gaps}'; }\n` +
    host.rewrite(block('PG_SNOWBALL_BUNDLE_BEGIN', 'PG_SNOWBALL_BUNDLE_END'));
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', body], {
    encoding: 'utf8',
    env: { ...process.env, TARGET_OS: 'linux', DISTRIBUTION_PROFILE: profile, EMBEDDED_PG_DST: dst },
  });
  return { r, debian, relocatable };
}

test('snowball bundle repairs both runtime layouts and refuses an ABI-incompatible module', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-snowball-bundle-'));
  try {
    const host = fakeHostInstall(scratch);
    host.reset();
    let { r, debian, relocatable } = runSnowballBundle(scratch, host);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /dict_snowball and english\.stop verified in 2 embedded-postgres tree\(s\)/);
    for (const [libDir, dataDir] of [
      [path.join(debian, 'lib/postgresql'), path.join(debian, 'share/postgresql/tsearch_data')],
      [path.join(relocatable, 'lib'), path.join(relocatable, 'share/tsearch_data')],
    ]) {
      assert.equal(fs.readFileSync(path.join(libDir, 'dict_snowball.so'), 'utf8'), 'fixture dict_snowball.so');
      assert.equal(fs.readFileSync(path.join(dataDir, 'english.stop'), 'utf8'), 'fixture english.stop');
    }

    host.reset();
    ({ r, debian } = runSnowballBundle(scratch, host, 'dogfood', 'palloc_mul'));
    assert.equal(r.status, 1, 'a Linux bundle must not ship a dictionary module its server cannot load');
    assert.match(r.stdout, /cannot load in the embedded server .*missing: palloc_mul/);
    assert.ok(!fs.existsSync(path.join(debian, 'lib/postgresql/dict_snowball.so')), 'incompatible source is not copied');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

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

test('bundle block refuses a library the embedded server cannot load (D-014)', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgts-bundle-'));
  try {
    const host = fakeHostInstall(scratch);
    host.reset();
    let { r, debian } = runBundle(scratch, host, 'linux', 'dogfood', 'palloc_mul');
    assert.equal(r.status, 1, 'a Linux bundle must not ship a library its server cannot load');
    assert.match(r.stdout, /cannot load in the embedded server .*\(missing: palloc_mul\)/);
    assert.match(r.stdout, /Bump embedded-postgres to at least that minor \(D-014\)/);
    assert.ok(!fs.existsSync(path.join(debian, 'lib/postgresql/pg_textsearch.so')), 'nothing copied');

    ({ r, debian } = runBundle(scratch, host, 'linux', 'vm-release', '<unmeasured>'));
    assert.equal(r.status, 0, 'vm-release skips the tree with a warning');
    assert.match(r.stdout, /its server cannot load it \(missing: <unmeasured>\)/);
    assert.match(r.stdout, /pg_textsearch copied into 0 embedded-postgres tree\(s\)/);
    assert.ok(!fs.existsSync(path.join(debian, 'lib/postgresql/pg_textsearch.so')), 'vm-release copies nothing');
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

const hasCc = spawnSync('cc', ['--version'], { encoding: 'utf8' }).status === 0
  && spawnSync('nm', ['--version'], { encoding: 'utf8' }).status === 0;

test('ABI gate measures the extension\'s imports against the server and the libraries it links', {
  skip: (process.platform !== 'linux' || !hasCc) && 'needs Linux with cc and nm',
}, () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgts-abi-'));
  try {
    const cc = (args) => {
      const r = spawnSync('cc', ['-fno-builtin', ...args], { encoding: 'utf8', cwd: scratch });
      assert.equal(r.status, 0, r.stderr);
    };
    // An extension importing palloc and palloc_mul (from the server) and log (from libm,
    // which the extension does not link; the real pg_textsearch.so has the same shape).
    fs.writeFileSync(path.join(scratch, 'ext.c'), [
      'extern void *palloc(unsigned long);',
      'extern void *palloc_mul(unsigned long, unsigned long);',
      'extern double log(double);',
      'void *ext(unsigned long n) { return log((double) n) > 0 ? palloc_mul(n, 2) : palloc(n); }',
    ].join('\n'));
    cc(['-shared', '-fPIC', '-o', 'ext.so', 'ext.c']);
    // Two "servers" exporting palloc and linking libm; only the newer exports palloc_mul.
    fs.writeFileSync(path.join(scratch, 'server.c'), [
      '#include <stdlib.h>',
      'extern double log(double);',
      'void *palloc(unsigned long n) { return malloc(n); }',
      '#ifdef NEWER',
      'void *palloc_mul(unsigned long a, unsigned long b) { return malloc(a * b); }',
      '#endif',
      'int main(int argc, char **argv) { (void) argv; return (int) log((double) argc); }',
    ].join('\n'));
    for (const [name, defs] of [['newer', ['-DNEWER']], ['older', []]]) {
      fs.mkdirSync(path.join(scratch, name, 'bin'), { recursive: true });
      cc([...defs, '-rdynamic', '-o', path.join(name, 'bin/postgres'), 'server.c', '-lm']);
    }
    const gate = block('PG_TEXTSEARCH_ABI_GATE_BEGIN', 'PG_TEXTSEARCH_ABI_GATE_END');
    const gaps = (lib, bin) => {
      const r = spawnSync('bash', ['-euo', 'pipefail', '-c', `${gate}\npg_library_abi_gaps "$1" "$2"`, 'gate', lib, bin], {
        encoding: 'utf8', cwd: scratch,
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const ext = path.join(scratch, 'ext.so');
    assert.equal(gaps(ext, path.join(scratch, 'newer/bin/postgres')), '', 'log resolves through the server\'s libm');
    assert.equal(gaps(ext, path.join(scratch, 'older/bin/postgres')), 'palloc_mul');
    // A measurement that read nothing must never pass as compatible.
    fs.writeFileSync(path.join(scratch, 'text.so'), 'not an ELF file');
    assert.equal(gaps(path.join(scratch, 'text.so'), path.join(scratch, 'newer/bin/postgres')), '<unmeasured>');
    assert.equal(gaps(ext, path.join(scratch, 'absent/bin/postgres')), '<unmeasured>');
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

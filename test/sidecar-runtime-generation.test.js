// WI-10003673 — the Windows Server's hot-runtime generation is computed at
// package time (bin/lib/sidecar-runtime-generation.js) and shipped bound to the
// stamp, instead of the launcher SHA-256ing ~5 GB on every boot.
//
// The launcher side (read + stamp binding + walk fallback) is pinned by the
// Rust tests in src-tauri/src/sidecar_runtime_identity.rs and main.rs; the two
// halves share test/fixtures/sidecar-runtime-generation/ as their contract.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const packer = require('../bin/lib/sidecar-runtime-generation.js');
const iss = fs.readFileSync(path.join(root, 'src-tauri/windows/inno/papercusp.iss'), 'utf8');
const crossBuild = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');

function tree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-packed-generation-'));
  const sidecar = path.join(dir, 'sidecar');
  const env = path.join(dir, 'env-sidecars');
  fs.mkdirSync(path.join(sidecar, 'spa'), { recursive: true });
  fs.mkdirSync(path.join(env, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(sidecar, 'serve.mjs'), '#!/usr/bin/env node\n');
  fs.writeFileSync(path.join(sidecar, '.sidecar-build-stamp'), '{"serveSha256":"x"}\n');
  fs.writeFileSync(path.join(sidecar, 'spa', 'index.html'), '<html>');
  fs.writeFileSync(path.join(env, 'staging', 'serve.mjs'), 'env serve');
  return { dir, sidecar, env, mounts: { 'env-sidecars': env } };
}

test('the key changes with any installed hot file, including the env-sidecars overlay', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const key = () => packer.computePackedGeneration({ sidecarDir: f.sidecar, mounts: f.mounts }).generation;
  const clean = key();
  assert.match(clean, /^[0-9a-f]{64}$/);
  assert.equal(key(), clean, 'deterministic');

  fs.writeFileSync(path.join(f.sidecar, 'spa', 'index.html'), '<html>new');
  const spa = key();
  assert.notEqual(spa, clean, 'a non-serve SPA edit must change the key');
  fs.writeFileSync(path.join(f.env, 'staging', 'serve.mjs'), 'env serve v2');
  assert.notEqual(key(), spa, 'the overlay installs under {app}\\sidecar\\env-sidecars and must be keyed');
  assert.notEqual(
    key(),
    packer.computePackedGeneration({ sidecarDir: f.sidecar }).generation,
    'an overlay-less computation must not match: the overlay is part of the installed tree',
  );
});

test('the overlay wins over a same-path file in sidecar\\env-sidecars, as the later [Files] entry does', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(f.sidecar, 'env-sidecars', 'staging'), { recursive: true });
  fs.writeFileSync(path.join(f.sidecar, 'env-sidecars', 'staging', 'serve.mjs'), 'shadowed');
  const key = () => packer.computePackedGeneration({ sidecarDir: f.sidecar, mounts: f.mounts }).generation;
  const before = key();
  fs.writeFileSync(path.join(f.sidecar, 'env-sidecars', 'staging', 'serve.mjs'), 'still shadowed');
  assert.equal(key(), before, 'a file the overlay overwrites is not what gets installed');
});

test('cold inputs, the marker and the record itself are excluded at the root only', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const key = () => packer.computePackedGeneration({ sidecarDir: f.sidecar, mounts: f.mounts }).generation;
  const before = key();
  for (const name of ['source.tar.zst', 'db-seed.dump', 'db-seed.tar.gz', '.papercusp-runtime-complete', packer.GENERATION_FILE]) {
    fs.writeFileSync(path.join(f.sidecar, name), 'not hot payload');
  }
  assert.equal(key(), before);
  fs.writeFileSync(path.join(f.sidecar, 'spa', 'source.tar.zst'), 'nested files are hot');
  assert.notEqual(key(), before);
});

test('symlinks are keyed by the bytes Wine packs, not by the link', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.sidecar, 'libpq.so.5.18'), 'v1');
  fs.symlinkSync('libpq.so.5.18', path.join(f.sidecar, 'libpq.so'));
  const key = () => packer.computePackedGeneration({ sidecarDir: f.sidecar }).generation;
  const linked = key();
  fs.rmSync(path.join(f.sidecar, 'libpq.so'));
  fs.copyFileSync(path.join(f.sidecar, 'libpq.so.5.18'), path.join(f.sidecar, 'libpq.so'));
  assert.equal(key(), linked, 'a link installs as a copy of its target');
  fs.symlinkSync('missing', path.join(f.sidecar, 'dangling'));
  assert.throws(key, /dangling symlink/);
});

test('the installer script is part of the key', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const script = path.join(f.dir, 'papercusp.iss');
  fs.writeFileSync(script, '[Files]\n');
  const a = packer.computePackedGeneration({ sidecarDir: f.sidecar, installerScript: script }).generation;
  fs.writeFileSync(script, '[Files]\n; changed\n');
  assert.notEqual(packer.computePackedGeneration({ sidecarDir: f.sidecar, installerScript: script }).generation, a);
});

test('the CLI writes the record the launcher parses, bound to the stamp bytes', (t) => {
  const f = tree();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const out = path.join(f.dir, packer.GENERATION_FILE);
  const run = spawnSync(process.execPath, [
    path.join(root, 'bin/lib/sidecar-runtime-generation.js'),
    '--sidecar', f.sidecar, '--mount', `env-sidecars=${f.env}`, '--out', out,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const record = JSON.parse(fs.readFileSync(out, 'utf8'));
  const stamp = fs.readFileSync(path.join(f.sidecar, '.sidecar-build-stamp'));
  assert.deepEqual(record, {
    schema: 'papercusp-sidecar-runtime-generation/v1',
    generation: packer.computePackedGeneration({ sidecarDir: f.sidecar, mounts: f.mounts }).generation,
    stampSha256: crypto.createHash('sha256').update(stamp).digest('hex'),
  });
  const missing = spawnSync(process.execPath, [path.join(root, 'bin/lib/sidecar-runtime-generation.js'), '--out', out], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'no --sidecar must fail, never write a record');
});

test('the writer matches the shared cross-language fixture byte for byte', () => {
  const dir = path.join(root, 'test/fixtures/sidecar-runtime-generation');
  const expected = fs.readFileSync(path.join(dir, 'record.json'), 'utf8');
  const { generation } = JSON.parse(expected);
  assert.equal(
    packer.formatGenerationRecord({ generation, stampBytes: fs.readFileSync(path.join(dir, 'stamp.json')) }),
    expected,
  );
});

test('papercusp.iss ships the record as the LAST Server file, mandatory, and keeps it out of the wildcard', () => {
  const server = iss.slice(iss.indexOf('#if AppId == "com.papercusp.server"'));
  const block = server.slice(0, server.indexOf('#endif'));
  const sources = block.split('\n').filter((line) => line.startsWith('Source:'));
  const last = sources[sources.length - 1];
  assert.match(last, /^Source: "\{#BuildRoot\}\\\.sidecar-runtime-generation"; DestDir: "\{app\}\\sidecar"/);
  assert.doesNotMatch(last, /skipifsourcedoesntexist/, 'a Server without the record must not compile');
  const wildcard = sources.find((line) => line.startsWith('Source: "{#BuildRoot}\\sidecar\\*"'));
  assert.match(wildcard, /Excludes: "[^"]*\.sidecar-runtime-generation/);
});

test('build-windows-cross.sh computes the record over the pinned snapshot before any ISCC run', () => {
  const call = crossBuild.indexOf('bin/lib/sidecar-runtime-generation.js');
  assert.ok(call > 0, 'the cross build must invoke the packer');
  assert.ok(call > crossBuild.indexOf('SRC_TAURI="$ROOT/src-tauri"'), 'hash the immutable snapshot, not the shared tree');
  assert.ok(call < crossBuild.indexOf('for role in $ROLES; do'), 'the record must exist before the first ISCC');
  assert.match(crossBuild.slice(call, call + 400), /--out "\$STAGE\/\.sidecar-runtime-generation"/);
});

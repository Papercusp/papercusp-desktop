const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');

test('production staging executes archive, corruption, failure and timeout controls', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-sidecar-staging-'));
  try {
    const binary = path.join(temp, 'staging-tests');
    const compile = spawnSync(process.env.RUSTC || 'rustc', [
      '--edition=2021', '--test',
      path.join(root, 'src-tauri/src/wsl_sidecar_staging.rs'), '-o', binary,
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compile.status, 0, String(compile.error || compile.stderr));
    const run = spawnSync(binary, ['--nocapture'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, String(run.error || run.stderr || run.stdout));
    assert.match(run.stdout, /22 passed; 0 failed; 0 ignored/);
    // The native fixture imports the real module, so compile it on the host too:
    // a changed protocol must not leave the only Windows witness using old APIs.
    const fixture = spawnSync(process.env.RUSTC || 'rustc', [
      '--edition=2021', path.join(root, 'test/fixtures/wsl-sidecar-staging-native.rs'),
      '-o', path.join(temp, 'native-fixture'),
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(fixture.status, 0, String(fixture.error || fixture.stderr));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Windows startup uses native NTFS archive, single-file extraction, then gated publication', () => {
  const staging = source.slice(source.indexOf('fn prepare_wsl_sidecar_runtime('),
    source.indexOf('/// Unified operator discovery'));
  assert.match(staging, /Command::new\("tar\.exe"\)/);
  assert.match(staging, /arg\(sidecar_dir\)/);
  assert.match(staging, /wsl_sidecar_staging::EXTRACT_SCRIPT/);
  assert.match(staging, /stage_archive\([\s\S]*?\)\?;[\s\S]*?PUBLISH_SCRIPT/);
  assert.match(staging, /stage_archive\(&mut producer, \|_remaining\| \{[\s\S]*?wsl_command\(\)/);
  assert.match(staging, /windows_path_to_wsl\(archive\.path\(\)\)/);
  assert.doesNotMatch(staging, /windows_path_to_wsl\(sidecar_dir\)|source_wsl|tar -C "\$source_dir"/);
  const bounded = source.slice(source.indexOf('fn run_wsl_exec_with_timeout('),
    source.indexOf('/// Materialize the hot Windows sidecar tree'));
  assert.match(bounded, /wsl_sidecar_staging::run_wsl_bounded/);
  assert.match(bounded, /WSL_STARTUP_TIMEOUT \+ timeout/);
  assert.doesNotMatch(bounded, /terminate_distro/);
});

test('independent native audit rejects corrupt, missing, extra, linked and incorrectly executable files', () => {
  const { snapshot, verify, portableLinkTarget } = require('./fixtures/wsl-sidecar-staging-audit.cjs');
  assert.equal(portableLinkTarget('..\\lib\\claude.exe', 'win32'), '../lib/claude.exe');
  assert.equal(portableLinkTarget('..\\lib\\claude.exe', 'linux'), '..\\lib\\claude.exe');
  assert.notEqual(portableLinkTarget('..\\other\\claude.exe', 'win32'), '../lib/claude.exe');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-staging-audit-'));
  const sourceDir = path.join(temp, 'source');
  const target = path.join(temp, 'target');
  fs.mkdirSync(sourceDir);
  fs.mkdirSync(target);
  const payload = {
    'serve.mjs': Buffer.from('#!/usr/bin/env node\n'),
    'sidecar-preload.js': Buffer.from('module.exports = {};\n'),
    'binary with spaces': Buffer.from([127, 69, 76, 70, 0, 255, 128]),
    'plain.bin': Buffer.from([0, 255, 128]),
  };
  try {
    for (const [name, bytes] of Object.entries(payload)) {
      fs.writeFileSync(path.join(sourceDir, name), bytes, { mode: 0o644 });
      fs.writeFileSync(path.join(target, name), bytes, { mode: 0o644 });
    }
    fs.mkdirSync(path.join(sourceDir, 'empty'));
    fs.mkdirSync(path.join(target, 'empty'));
    fs.symlinkSync('plain.bin', path.join(sourceDir, 'link'));
    fs.symlinkSync('plain.bin', path.join(target, 'link'));
    fs.writeFileSync(path.join(sourceDir, 'source.tar.zst'), 'excluded archive');
    fs.chmodSync(path.join(target, 'serve.mjs'), 0o744);
    fs.chmodSync(path.join(target, 'binary with spaces'), 0o744);
    const manifest = snapshot(sourceDir);
    assert.equal(manifest.entries.some(e => e.path === 'source.tar.zst'), false);
    assert.equal(manifest.entries.find(e => e.path === 'plain.bin').sha256,
      require('node:crypto').createHash('sha256').update(payload['plain.bin']).digest('hex'));
    assert.equal(verify(target, manifest).files, 4);
    fs.writeFileSync(path.join(target, 'plain.bin'), Buffer.from([0, 254, 128]));
    assert.throws(() => verify(target, manifest), /changed: plain.bin/);
    fs.writeFileSync(path.join(target, 'plain.bin'), payload['plain.bin']);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o744);
    assert.throws(() => verify(target, manifest), /changed: plain.bin/);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o644);
    fs.chmodSync(path.join(target, 'binary with spaces'), 0o644);
    assert.throws(() => verify(target, manifest), /changed: binary with spaces/);
    fs.chmodSync(path.join(target, 'binary with spaces'), 0o744);
    fs.unlinkSync(path.join(target, 'link'));
    fs.symlinkSync('serve.mjs', path.join(target, 'link'));
    assert.throws(() => verify(target, manifest), /changed: link/);
    fs.unlinkSync(path.join(target, 'link'));
    fs.symlinkSync('plain.bin', path.join(target, 'link'));
    fs.writeFileSync(path.join(target, 'source.tar.zst'), 'unexpected extraction');
    assert.throws(() => verify(target, manifest), /extra: source.tar.zst/);
    fs.unlinkSync(path.join(target, 'source.tar.zst'));
    fs.unlinkSync(path.join(target, 'plain.bin'));
    assert.throws(() => verify(target, manifest), /missing: plain.bin/);
    assert.throws(() => verify(target, { ...manifest, entries: [...manifest.entries, manifest.entries[0]] }),
      /duplicate path/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

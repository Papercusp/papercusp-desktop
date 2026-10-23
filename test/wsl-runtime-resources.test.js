const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/wsl_setup.rs'), 'utf8');

test('the production Server-owned WSL resolver passes its Rust filesystem controls', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-runtime-resources-'));
  try {
    const binary = path.join(temp, process.platform === 'win32' ? 'resolver.exe' : 'resolver');
    const compile = spawnSync(process.env.RUSTC || 'rustc', [
      '--edition=2021', '--test',
      path.join(root, 'src-tauri/src/wsl_runtime_resources.rs'), '-o', binary,
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compile.status, 0, String(compile.error || compile.stderr || compile.stdout));
    const run = spawnSync(binary, ['--nocapture'], { encoding: 'utf8', timeout: 30000 });
    assert.equal(run.status, 0, String(run.error || run.stderr || run.stdout));
    assert.match(run.stdout, /5 passed; 0 failed; 0 ignored/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('detect, bootstrap installation and import consume the same runtime resolver', () => {
  assert.match(source, /runtime_resource\(app, super::ROOTFS_RECIPE_FILENAME\)\?/);
  assert.match(source, /runtime_resource\(app, super::ROOTFS_BOOTSTRAP_FILENAME\)\?/);
  assert.match(source, /runtime_resource\(app, super::ROOTFS_BUN_HELPER_FILENAME\)\?/);
  assert.match(source, /runtime_resource\(app, super::ROOTFS_BUN_ARCHIVE_FILENAME\)\?/);
  assert.match(source, /imp::runtime_resource\(&_app, ROOTFS_FILENAME\)\?/);
  assert.match(source, /let shipped = match shipped_rootfs_recipe\(app\)/);
  assert.match(source, /state: WslState::Error \{ message \}/);
  assert.match(source, /let recipe = shipped_rootfs_recipe\(app\)\?;\s*install_shipped_bootstrap\(app\)\?;/);
  assert.match(source, /st\.rootfs_recipe = Some\(recipe\)/);
  assert.doesNotMatch(source, /running the distro's existing bootstrap/);
});

test('guest resource replacement is atomic, handles spaces, and refuses empty or failed input', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl resource install '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const match = source.match(/const INSTALL_BOOTSTRAP_RESOURCE_SCRIPT: &str = r#"([\s\S]*?)"#;/);
  assert.ok(match, 'exercise the exact shell used by WSL resource installation');
  const destination = path.join(temp, 'space dir', 'bootstrap');
  const install = (input, extraEnv = {}) => spawnSync('bash', ['-c', match[1], 'install-resource', destination], {
    encoding: 'utf8', timeout: 15000, input, env: { ...process.env, ...extraEnv },
  });
  const first = install('first generation\n');
  assert.equal(first.status, 0, first.stderr);
  const fd = fs.openSync(destination, 'r');
  t.after(() => fs.closeSync(fd));
  assert.equal(install('new generation\n').status, 0);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new generation\n');
  assert.equal(fs.readFileSync(fd, 'utf8'), 'first generation\n', 'existing readers retain the previous inode');
  assert.notEqual(install('').status, 0);
  const tools = path.join(temp, 'tools');
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, 'cat'), '#!/bin/sh\nprintf partial\nexit 32\n', { mode: 0o755 });
  const failed = install('incomplete', { PATH: tools + ':' + process.env.PATH });
  assert.equal(failed.status, 32, failed.stderr);
  assert.equal(fs.readFileSync(destination, 'utf8'), 'new generation\n');
  assert.deepEqual(fs.readdirSync(path.dirname(destination)), ['bootstrap']);
  assert.equal(fs.statSync(destination).mode & 0o777, 0o755);
  const zipBytes = Buffer.from([0x50, 0x4b, 3, 4, 0, 0xff, 0x80, 0x0a, 0]);
  assert.equal(install(zipBytes).status, 0);
  assert.deepEqual(fs.readFileSync(destination), zipBytes, 'the WSL stdin handoff preserves binary ZIP bytes');
});

test('filesystem controls reject restoring the thin-GUI-own-resource mistake', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-runtime-resources-mutant-'));
  try {
    const original = fs.readFileSync(
      path.join(root, 'src-tauri/src/wsl_runtime_resources.rs'), 'utf8',
    );
    const mutant = original.replace('let root = if installed_gui {', 'let root = if false {');
    assert.notEqual(mutant, original, 'negative control must change the actual selection branch');
    const mutantSource = path.join(temp, 'mutant.rs');
    const binary = path.join(temp, process.platform === 'win32' ? 'mutant.exe' : 'mutant');
    fs.writeFileSync(mutantSource, mutant);
    const compile = spawnSync(process.env.RUSTC || 'rustc', [
      '--edition=2021', '--test', mutantSource, '-o', binary,
    ], { encoding: 'utf8', timeout: 60000 });
    assert.equal(compile.status, 0, String(compile.error || compile.stderr));
    const run = spawnSync(binary, ['--nocapture'], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(run.status, 0, 'the original wrong resource root must fail');
    assert.equal(run.error, undefined);
    assert.match(run.stdout, /thin_gui_uses_the_server_for_all_three_runtime_inputs.*FAILED/);
    assert.match(run.stdout, /absent_server_never_falls_back_to_old_gui_recipe.*FAILED/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

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
  assert.match(source, /imp::runtime_resource\(&_app, ROOTFS_FILENAME\)\?/);
  assert.match(source, /let shipped = match shipped_rootfs_recipe\(app\)/);
  assert.match(source, /state: WslState::Error \{ message \}/);
  assert.match(source, /let recipe = shipped_rootfs_recipe\(app\)\?;\s*install_shipped_bootstrap\(app\)\?;/);
  assert.match(source, /st\.rootfs_recipe = Some\(recipe\)/);
  assert.doesNotMatch(source, /running the distro's existing bootstrap/);
});

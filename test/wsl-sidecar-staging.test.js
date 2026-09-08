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
    assert.match(run.stdout, /21 passed; 0 failed; 0 ignored/);
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

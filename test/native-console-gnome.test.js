const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/native_console.rs'), 'utf8');
function functionSource(name) {
  const start = source.indexOf(`fn ${name}(`);
  const indent = source.slice(source.lastIndexOf('\n', start) + 1, start);
  const end = source.indexOf('\n' + indent + '}', start);
  assert.ok(start >= 0 && end > start, `production ${name} missing`);
  return source.slice(start, end + indent.length + 2);
}
function structSource(name) {
  const start = source.indexOf(`pub struct ${name} {`);
  const end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end > start, `production ${name} missing`);
  return source.slice(start, end + 2).replace(/^\s*#\[serde[^\n]*\]\n/gm, '');
}

test('production native GNOME preparation and both entrypoints preserve preferences and fail before spawn',
  { skip: process.platform !== 'linux', timeout: 120000 }, () => {
    // Reuse the desktop's lightweight production-helper Cargo fixture pattern.
    // The production bodies and their production tests are compiled verbatim.
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-console-gnome-'));
    try {
      const policyImport = source.match(/const GNOME_TERMINAL_POLICY: &str = include_str!\("([^"]+)"\);/);
      assert.ok(policyImport, 'native policy is not compiled into the installed shell');
      const policyPath = path.resolve(root, 'src-tauri/src', policyImport[1]);
      assert.equal(policyPath, path.resolve(root, '../packages/operator-core/lib/gnome-terminal-policy.json'));
      const contextStart = source.indexOf('const TERMINAL_CONTEXT_ENV_KEYS:');
      const contextEnd = source.indexOf('\n];', contextStart);
      assert.ok(contextStart >= 0 && contextEnd > contextStart);
      const fixtureStart = source.indexOf('    #[cfg(target_os = "linux")]\n    struct TerminalFixture');
      const fixtureEnd = source.indexOf('    fn envelope(', fixtureStart);
      assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart, 'production native GNOME regression tests missing');
      const driver = path.join(temp, 'native.rs');
      fs.writeFileSync(driver, [
        'use std::collections::HashMap; use std::path::PathBuf;',
        `#[path=${JSON.stringify(path.join(root, 'src-tauri/src/wsl_sidecar_staging.rs'))}] mod wsl_sidecar_staging;`,
        structSource('ConsoleEnvelope'), structSource('ExternalConsoleSpec'),
        source.slice(contextStart, contextEnd + 3),
        `const GNOME_TERMINAL_POLICY: &str = include_str!(${JSON.stringify(policyPath)});`,
        ...['is_valid_env_name', 'strip_terminal_context_env', 'prepare_linux_terminal_args',
          'gnome_preparation_error', 'spawn_linux_with', 'spawn_external_with'].map(functionSource),
        '#[cfg(test)] mod tests { use super::*;',
        source.slice(fixtureStart, fixtureEnd), functionSource('envelope'), '}',
      ].join('\n'));
      const manifest = path.join(temp, 'Cargo.toml');
      fs.writeFileSync(manifest, [
        '[package]', 'name="native-console-gnome-regression"', 'version="0.0.0"', 'edition="2021"',
        '[workspace]', '[lib]', `path=${JSON.stringify(driver)}`, '[dependencies]',
        'serde_json="1"', 'uuid={version="1",features=["v4"]}', 'libc="0.2"',
      ].join('\n'));
      const run = spawnSync(process.env.CARGO || 'cargo', ['test', '--offline', '--manifest-path', manifest, '--', 'tests::'],
        { encoding: 'utf8', timeout: 110000, env: { ...process.env, CARGO_TARGET_DIR: path.join(temp, 'target') } });
      const diagnostics = run.stderr.split('\n').filter((line) => /error|--> |^\s*\d+\s*\||^\s*\|/.test(line)).join('\n');
      assert.equal(run.status, 0, String(run.error || diagnostics || run.stderr.slice(-3000) || run.stdout));
      for (const name of ['gnome_preparation_preserves_explicit_profiles_and_other_emulators',
        'gnome_preparation_verifies_default_and_finite_history_receipts',
        'both_native_gnome_entrypoints_prepare_before_spawn_and_refuse_dependency_failures']) {
        assert.ok(run.stdout.includes(`tests::${name} ... ok`), run.stdout);
      }
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });

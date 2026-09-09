const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');

test('complete hot-payload identity changes for non-serve repairs and removed files', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsl-runtime-identity-'));
  try {
    const manifest = path.join(temp, 'Cargo.toml');
    const start = source.indexOf('fn sidecar_runtime_generation(');
    const end = source.indexOf('\n}\n', start);
    assert.ok(start >= 0 && end > start, 'production generation function missing');
    const driver = path.join(temp, 'identity.rs');
    fs.writeFileSync(driver, [
      `#[path = ${JSON.stringify(path.join(root, 'src-tauri/src/sidecar_runtime_identity.rs'))}]`,
      'mod sidecar_runtime_identity;',
      source.slice(start, end + 3),
      '#[test]', 'fn actual_stamp_gate_and_non_serve_change() {',
      'let dir = std::env::temp_dir().join(format!("pc-stamp-wiring-{}", std::process::id()));',
      'std::fs::create_dir(&dir).unwrap();',
      'assert!(sidecar_runtime_generation(&dir).is_err());',
      'let stamp = dir.join(".sidecar-build-stamp");',
      'std::fs::write(&stamp, "{}").unwrap();',
      'assert!(sidecar_runtime_generation(&dir).is_err());',
      String.raw`std::fs::write(&stamp, format!(r#"{{"serveSha256":"{}"}}"#, "a".repeat(64))).unwrap();`,
      'let original = sidecar_runtime_generation(&dir).unwrap();',
      'std::fs::write(dir.join("repaired-preload.js"), "new dependency").unwrap();',
      'assert_ne!(original, sidecar_runtime_generation(&dir).unwrap());',
      'std::fs::remove_dir_all(&dir).unwrap();',
      '}',
    ].join('\n'));
    fs.writeFileSync(manifest, [
      '[package]', 'name = "runtime-identity-regression"', 'version = "0.0.0"', 'edition = "2021"',
      '[workspace]', '[lib]', `path = ${JSON.stringify(driver)}`,
      '[dependencies]', 'sha2 = "=0.10.9"', 'serde_json = "1"',
    ].join('\n'));
    const result = spawnSync(process.env.CARGO || 'cargo', [
      'test', '--offline', '--manifest-path', manifest,
    ], { encoding: 'utf8', timeout: 120000,
      env: { ...process.env, CARGO_TARGET_DIR: path.join(temp, 'target') } });
    assert.equal(result.status, 0, String(result.error || result.stderr || result.stdout));
    assert.ok(result.stdout.includes(`${process.platform === 'win32' ? 4 : 5} passed; 0 failed; 0 ignored`),
      result.stdout);
    const generation = source.slice(source.indexOf('fn sidecar_runtime_generation('),
      source.indexOf('fn wsl_runtime_sidecar_path('));
    assert.match(generation, /sidecar_runtime_identity::generation\(sidecar_dir\)/);
    const prepare = source.slice(source.indexOf('fn prepare_wsl_sidecar_runtime('),
      source.indexOf('/// Unified operator discovery'));
    assert.match(prepare, /windows_path_to_wsl\(&marker\)/,
      'native Windows PathBuf::join must not leak backslashes into a WSL marker probe');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

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
    assert.match(run.stdout, /28 passed; 0 failed; 0 ignored/);
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

test('Windows startup uses native binary streaming and production readiness before gated publication', () => {
  const staging = source.slice(source.indexOf('fn prepare_wsl_sidecar_runtime('),
    source.indexOf('/// Unified operator discovery'));
  assert.match(staging, /Command::new\("tar\.exe"\)/);
  assert.match(staging, /arg\(sidecar_dir\)/);
  assert.match(staging, /wsl_sidecar_staging::EXTRACT_SCRIPT/);
  assert.match(staging, /stage_archive\([\s\S]*?\)\?;[\s\S]*?PUBLISH_SCRIPT/);
  assert.match(staging, /wsl_command\(\)[\s\S]*?stage_archive\(producer, consumer, Duration::from_secs\(1_200\)\)/);
  assert.match(staging, /\.args\(\["-b", "2048", "-cf", "-", "\."\]\)/);
  assert.match(staging, /\.arg\("-"\)\.arg\(&temporary\)/);
  assert.doesNotMatch(staging, /TemporaryArchive|windows_path_to_wsl\(archive|windows_path_to_wsl\(sidecar_dir\)|source_wsl|tar -C "\$source_dir"/);
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
    fs.chmodSync(path.join(target, 'empty'), 0o755);
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
    assert.equal(verify(target, manifest, { fullModes: true }).fullModes, true);
    for (const [name, mode, restored] of [
      ['plain.bin', 0o666, 0o644],
      ['plain.bin', 0o4644, 0o644],
      ['empty', 0o777, 0o755],
      ['binary with spaces', 0o700, 0o744],
    ]) {
      fs.chmodSync(path.join(target, name), mode);
      assert.throws(() => verify(target, manifest, { fullModes: true }), /permissions:/);
      fs.chmodSync(path.join(target, name), restored);
    }
    fs.writeFileSync(path.join(target, 'plain.bin'), Buffer.from([0, 254, 128]));
    assert.throws(() => verify(target, manifest), /changed: plain.bin/);
    fs.writeFileSync(path.join(target, 'plain.bin'), payload['plain.bin']);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o744);
    assert.throws(() => verify(target, manifest), /changed: plain.bin/);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o644);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o655);
    assert.throws(() => verify(target, manifest), /changed: plain.bin/);
    fs.chmodSync(path.join(target, 'plain.bin'), 0o644);
    fs.chmodSync(path.join(target, 'binary with spaces'), 0o755);
    assert.throws(() => verify(target, manifest), /changed: binary with spaces/);
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

test('post-start policy is phase-explicit, immutable and pinned to both exact payload files', () => {
  const { postStartManifest, POST_START_POSTGRES: pins, verifyPostStart } =
    require('./fixtures/wsl-sidecar-staging-audit.cjs');
  // These are inventory-row controls, not a claim to possess native binaries.
  // Actual-byte verification is separately exercised on the installed payload.
  const manifest = { schema: 'wsl-staging-byte-mode-v2', entries: [
    { ...pins.binary, type: 'file', executable: true, executeBits: 0o100 },
    { ...pins.writer, type: 'file', executable: false, executeBits: 0 },
    { path: 'other-postgres', type: 'file', bytes: pins.binary.bytes,
      sha256: pins.binary.sha256, executable: true, executeBits: 0o100 },
  ] };
  const before = JSON.stringify(manifest);
  const adjusted = postStartManifest(manifest);
  assert.equal(JSON.stringify(manifest), before);
  assert.equal(adjusted.entries[0].executeBits, 0o111);
  assert.deepEqual(adjusted.entries.slice(1), manifest.entries.slice(1));
  assert.deepEqual({ ...adjusted.entries[0], executeBits: 0o100 }, manifest.entries[0]);
  assert.throws(() => postStartManifest(adjusted), /binary pin mismatch/);
  for (const index of [0, 1]) {
    for (const change of [
      { path: 'other/path/postgres' }, { type: 'link' }, { bytes: 1 },
      { sha256: '0'.repeat(64) }, { executeBits: 0o111 },
      { executable: !manifest.entries[index].executable },
    ]) {
      const changed = structuredClone(manifest);
      Object.assign(changed.entries[index], change);
      assert.throws(() => postStartManifest(changed), /pin mismatch/);
    }
    const missing = structuredClone(manifest);
    missing.entries.splice(index, 1);
    assert.throws(() => postStartManifest(missing), /pin mismatch/);
    const duplicate = structuredClone(manifest);
    duplicate.entries.push({ ...duplicate.entries[index] });
    assert.throws(() => postStartManifest(duplicate), /pin mismatch/);
  }
  assert.throws(() => postStartManifest({ ...manifest, schema: 'unknown' }), /Invalid source manifest/);
  assert.throws(() => verifyPostStart('/not-used', { schema: manifest.schema, entries: [] }),
    /binary pin mismatch/);
});

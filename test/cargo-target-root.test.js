// WI-10003499 — bin/lib/cargo-target-root.sh is the ONE answer to "where does
// Cargo write build output?", and no script may re-hard-code the old answer.
//
// WHY THIS TEST EXISTS
// ~/.cargo/config.toml moved `build.target-dir` from ~/.cargo-target to
// /mnt/data/cargo-target on 2026-09-03 (WI-212675). bin/build-and-archive-deb.sh
// still defaulted `${CARGO_TARGET_DIR:-$HOME/.cargo-target}`. tauri built and
// signed the .deb under the configured target, and the script then FATAL'd with
// "emitted no fresh .deb under $HOME/.cargo-target/...". That cost
// a full ~10 minute build on the P-204 critical path. EI-22589688521091797 fixed
// the same defect in claim-target-dir.sh a fortnight earlier, so this is a CLASS:
// the resolver is now shared, and the scan below keeps the literal from growing
// back anywhere.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'bin', 'lib', 'cargo-target-root.sh');

test('native dev capacity policy distinguishes a cold slot from a warm cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-cargo-budget-'));
  const need = () => spawnSync('bash', ['-c',
    '. "$1"; papercusp_native_dev_cargo_need_gb "$2"', 'budget', helper, dir],
  { encoding: 'utf8' });
  try {
    const cold = need();
    assert.equal(cold.status, 0, cold.stderr);
    assert.equal(cold.stdout, '65');
    fs.mkdirSync(path.join(dir, 'debug', 'deps'), { recursive: true });
    const warm = need();
    assert.equal(warm.status, 0, warm.stderr);
    assert.equal(warm.stdout, '12');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
const RUSTUP_HOME = process.env.RUSTUP_HOME || path.join(os.homedir(), '.rustup');

function fixture(configToml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cargo-target-root-'));
  fs.mkdirSync(path.join(dir, 'crate', 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'crate', 'Cargo.toml'),
    '[package]\nname = "cargo-target-root-fixture"\nversion = "0.1.0"\nedition = "2021"\n');
  fs.writeFileSync(path.join(dir, 'crate', 'src', 'lib.rs'), '');
  fs.mkdirSync(path.join(dir, 'cargo-home'));
  if (configToml !== undefined) fs.writeFileSync(path.join(dir, 'cargo-home', 'config.toml'), configToml);
  return dir;
}

function resolve(dir, { fn = 'papercusp_cargo_target_root', cargoTargetDir, pathPrefix } = {}) {
  const env = { ...process.env, CARGO_HOME: path.join(dir, 'cargo-home'), RUSTUP_HOME, HOME: dir };
  delete env.CARGO_BUILD_TARGET_DIR;
  if (cargoTargetDir === undefined) delete env.CARGO_TARGET_DIR;
  else env.CARGO_TARGET_DIR = cargoTargetDir;
  if (pathPrefix) env.PATH = [pathPrefix, env.PATH || ''].filter(Boolean).join(path.delimiter);
  return spawnSync('bash', ['-c', `set -euo pipefail; source "$1"; ${fn} "$2"`, 'x', helper, path.join(dir, 'crate')],
    { encoding: 'utf8', env });
}

test('a relocated build.target-dir is what the resolver reports (not $HOME/.cargo-target)', () => {
  const dir = fixture();
  try {
    const relocated = path.join(dir, 'data disk', 'cargo-target');
    fs.writeFileSync(path.join(dir, 'cargo-home', 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(relocated)}\n`);
    fs.mkdirSync(path.join(dir, '.cargo-target')); // the stale name EXISTS, and must still lose
    const res = resolve(dir);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, relocated);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-empty exported CARGO_TARGET_DIR wins, exactly as Cargo itself honours it', () => {
  const dir = fixture('[build]\ntarget-dir = "/nonexistent/configured"\n');
  try {
    const res = resolve(dir, { cargoTargetDir: '/tmp/explicit-override' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, '/tmp/explicit-override');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an exported EMPTY CARGO_TARGET_DIR does not hide the configured target', () => {
  const dir = fixture();
  try {
    const relocated = path.join(dir, 'relocated');
    fs.writeFileSync(path.join(dir, 'cargo-home', 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(relocated)}\n`);
    const res = resolve(dir, { cargoTargetDir: '' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, relocated);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the metadata-only reader IGNORES an exported override (claim-target-dir contract)', () => {
  const dir = fixture();
  try {
    const relocated = path.join(dir, 'relocated');
    fs.writeFileSync(path.join(dir, 'cargo-home', 'config.toml'), `[build]\ntarget-dir = ${JSON.stringify(relocated)}\n`);
    const res = resolve(dir, { fn: 'papercusp_cargo_metadata_target_dir', cargoTargetDir: '/tmp/explicit-override' });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, relocated);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable Cargo config FAILS LOUDLY instead of guessing a directory', () => {
  const dir = fixture('[build\ntarget-dir =');
  try {
    const res = resolve(dir);
    assert.notEqual(res.status, 0, `expected a refusal, got stdout=${JSON.stringify(res.stdout)}`);
    assert.equal(res.stdout, '', 'a failed resolution must print no path at all');
    assert.match(res.stderr, /cannot resolve Cargo target directory/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unavailable Cargo command fails loudly instead of guessing a directory', (t) => {
  if (process.platform === 'win32') return t.skip('the Cargo resolver contract runs under POSIX Bash');
  const dir = fixture();
  try {
    const fakeBin = path.join(dir, 'no-cargo-bin');
    fs.mkdirSync(fakeBin);
    const fakeCargo = path.join(fakeBin, 'cargo');
    fs.writeFileSync(fakeCargo, '#!/bin/sh\necho "cargo: command not found" >&2\nexit 127\n', { mode: 0o755 });
    const res = resolve(dir, { pathPrefix: fakeBin });
    assert.notEqual(res.status, 0);
    assert.equal(res.stdout, '', 'a failed resolution must print no guessed path');
    assert.match(res.stderr, /cannot resolve Cargo target directory/);
    assert.match(res.stderr, /cargo: command not found/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('relocated Cargo permission metadata is rebuilt through Cargo before its consumer runs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cargo-generated-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'workspace');
  const producer = path.join(workspace, 'producer');
  const consumer = path.join(workspace, 'consumer');
  fs.mkdirSync(path.join(producer, 'src'), { recursive: true });
  fs.mkdirSync(path.join(consumer, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'Cargo.toml'),
    '[workspace]\nmembers=["producer", "consumer"]\nresolver="2"\n');
  fs.writeFileSync(path.join(producer, 'Cargo.toml'),
    '[package]\nname="permission-producer-fixture"\nversion="0.1.0"\nedition="2021"\n');
  fs.writeFileSync(path.join(producer, 'build.rs'), `
fn main() {
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let permission = out.join("permission-files.json");
    std::fs::write(&permission, "generated permission").unwrap();
    println!("cargo:PERMISSION_FILES_PATH={}", permission.display());
    println!("cargo:rustc-env=FIXTURE_PERMISSION_PATH={}", permission.display());
}
`);
  fs.writeFileSync(path.join(producer, 'src/lib.rs'),
    'pub const PERMISSION_PATH: &str = env!("FIXTURE_PERMISSION_PATH");\n');
  fs.writeFileSync(path.join(consumer, 'Cargo.toml'),
    '[package]\nname="permission-consumer-fixture"\nversion="0.1.0"\nedition="2021"\n[dependencies]\npermission-producer-fixture={path="../producer"}\n');
  fs.writeFileSync(path.join(consumer, 'src/main.rs'),
    'fn main(){print!("{}",std::fs::read_to_string(permission_producer_fixture::PERMISSION_PATH).unwrap());}\n');
  const oldTarget = path.join(dir, 'old-target');
  const movedTarget = path.join(dir, 'moved-target');
  const env = { ...process.env, CARGO_HOME: path.join(dir, 'cargo-home'), RUSTUP_HOME };
  const cargo = target => spawnSync('cargo', ['build', '--offline', '--quiet',
    '--manifest-path', path.join(workspace, 'Cargo.toml'), '--target-dir', target],
  { encoding: 'utf8', env, timeout: 30_000 });
  const initial = cargo(oldTarget);
  assert.equal(initial.status, 0, initial.stderr);
  fs.renameSync(oldTarget, movedTarget);
  const movedBuild = cargo(movedTarget);
  assert.equal(movedBuild.status, 0, movedBuild.stderr);
  const binary = path.join(movedTarget, 'debug/permission-consumer-fixture');
  const broken = spawnSync(binary, [], { encoding: 'utf8' });
  assert.notEqual(broken.status, 0, 'a relocated cached constant must reproduce the old-path failure');
  const sentinel = path.join(movedTarget, 'release/bundle/deb/preserved.deb');
  fs.mkdirSync(path.dirname(sentinel), { recursive: true });
  fs.writeFileSync(sentinel, 'preserved artifact');
  const preflight = spawnSync('bash', ['-c',
    'source "$1"; papercusp_prepare_cargo_generated_paths "$2"', '_', helper, workspace],
  { encoding: 'utf8', env: { ...env, CARGO_TARGET_DIR: movedTarget }, timeout: 30_000 });
  assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
  assert.match(preflight.stdout, /invalidated 1 current dependency package/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserved artifact');
  const rebuilt = cargo(movedTarget);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  const fixed = spawnSync(binary, [], { encoding: 'utf8' });
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.equal(fixed.stdout, 'generated permission');
  const stable = spawnSync('bash', ['-c',
    'source "$1"; papercusp_prepare_cargo_generated_paths "$2"', '_', helper, workspace],
  { encoding: 'utf8', env: { ...env, CARGO_TARGET_DIR: movedTarget }, timeout: 30_000 });
  assert.equal(stable.status, 0, stable.stderr);
  assert.equal(stable.stdout, '', 'current-root metadata must not trigger repeated invalidation');
});

// ── CLASS GUARD: no executable line may re-hard-code the pre-relocation default ──
// The pattern matches `${CARGO_TARGET_DIR:-$HOME/.cargo-target}` and the
// `${HOME}` spelling. Comment lines are skipped because history may be
// DESCRIBED; the rule is only that executable code may not act on it.
const STALE_DEFAULT = /\$\{CARGO_TARGET_DIR:-\$\{?HOME\}?\/\.cargo-target\}/;

// SHRINK-ONLY. These are consumers that LOCATE an existing .deb, never the
// producer. live-federation-gate.sh only reaches its entry after `cargo
// metadata` has already failed. Migrating them onto the shared resolver is
// tracked as a follow-up on WI-10003499. Remove an entry when you migrate it.
// The test fails if an entry is stale or if a new file appears.
const ALLOWLIST = new Set([
  'bin/two-instance-content-matrix-smoke.sh',
  'bin/live-federation-gate.sh',
  'bin/vm-federation.sh',
  'scripts/linux-test-vm/lib/common.sh',
]);

const RELEASE_TARGET_ROOT_ENTRYPOINTS = [
  'bin/publish-platform-incremental.sh',
  'bin/build-appimage.sh',
  'bin/build-linux-local.sh',
  'bin/build-mac-cross.sh',
  'bin/build-windows-cross.sh',
  'bin/release-local.sh',
];

function scriptFiles() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__pycache__') continue;
      const childRel = path.posix.join(rel, entry.name);
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile()) {
        const text = fs.readFileSync(path.join(root, childRel), 'utf8');
        if (entry.name.endsWith('.sh') || text.startsWith('#!/usr/bin/env bash') || text.startsWith('#!/bin/bash')) {
          out.push({ rel: childRel, text });
        }
      }
    }
  };
  walk('bin');
  walk('scripts');
  return out;
}

function offenders() {
  const hits = new Map();
  for (const { rel, text } of scriptFiles()) {
    text.split('\n').forEach((line, i) => {
      if (line.trimStart().startsWith('#')) return;
      if (STALE_DEFAULT.test(line)) hits.set(rel, [...(hits.get(rel) || []), i + 1]);
    });
  }
  return hits;
}

test('positive control: the detector recognises both spellings of the stale default', () => {
  assert.match('CARGO_TARGET="${CARGO_TARGET_DIR:-$HOME/.cargo-target}"', STALE_DEFAULT);
  assert.match('x="${CARGO_TARGET_DIR:-${HOME}/.cargo-target}/release"', STALE_DEFAULT);
  assert.doesNotMatch('x="$(papercusp_cargo_target_root "$D/src-tauri")"', STALE_DEFAULT);
  assert.ok(scriptFiles().length > 50, 'the scan found implausibly few scripts — the walker is broken, not the tree clean');
});

test('no NEW script hard-codes ${CARGO_TARGET_DIR:-$HOME/.cargo-target}', () => {
  const unexpected = [...offenders()].filter(([rel]) => !ALLOWLIST.has(rel));
  assert.deepEqual(unexpected, [],
    'source bin/lib/cargo-target-root.sh and call papercusp_cargo_target_root <crate-dir> instead');
});

test('the producer (build-and-archive-deb.sh) is fixed and must stay fixed', () => {
  assert.equal(offenders().has('bin/build-and-archive-deb.sh'), false);
  const text = fs.readFileSync(path.join(root, 'bin', 'build-and-archive-deb.sh'), 'utf8');
  assert.match(text, /CARGO_TARGET="\$\(papercusp_cargo_target_root /);
});

test('allowlist is shrink-only: every entry must still be a real offender', () => {
  const hits = offenders();
  const stale = [...ALLOWLIST].filter((rel) => !hits.has(rel));
  assert.deepEqual(stale, [], 'these were migrated — delete them from ALLOWLIST');
});

test('all six release target-root callers use the shared fail-closed resolver', () => {
  for (const rel of RELEASE_TARGET_ROOT_ENTRYPOINTS) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const executable = text.split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const sourceIndex = Math.max(
      executable.indexOf('lib/cargo-target-root.sh'),
      executable.indexOf('lib/claim-target-dir.sh'),
    );
    const resolverIndex = executable.indexOf('papercusp_cargo_target_root');
    assert.ok(sourceIndex >= 0, `${rel} must source the cargo target resolver or claim-target wrapper`);
    assert.ok(resolverIndex > sourceIndex, `${rel} must source the resolver before using it`);
    assert.doesNotMatch(executable, /cargo metadata/,
      `${rel} must not restore an inline metadata probe whose failure can bypass its fallback`);
  }
});

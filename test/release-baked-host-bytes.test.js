'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = path.join(root, 'bin', 'lib', 'release-artifacts.sh');
const upload = path.join(root, 'bin', 'upload-release.sh');
const base = 'https://download-test.example.invalid/secret-prefix';

function debHostFixture(t, { configured = true, mismatch = false, profile = 'public' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-host-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const product = path.join(dir, 'product');
  const target = path.join(dir, 'cargo');
  const record = path.join(dir, 'tauri-env.json');
  const hostFile = path.join(dir, 'release-host.env');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(product, 'src-tauri'), { recursive: true });
  if (configured) fs.writeFileSync(hostFile, `PAPERCUSP_RELEASE_HOST=${base}\n`);
  fs.writeFileSync(path.join(bin, 'cargo'),
    '#!/bin/sh\nprintf \'{"target_directory":"%s"}\\n\' "$FIXTURE_TARGET"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'tauri'), `#!/usr/bin/env node
const fs = require('node:fs');
const p = require('node:path');
const e = process.env;
const release = p.join(e.FIXTURE_TARGET, 'release');
fs.mkdirSync(p.join(release, 'bundle/deb'), { recursive: true });
fs.writeFileSync(e.FIXTURE_RECORD, JSON.stringify({host: e.PAPERCUSP_RELEASE_HOST, rustflags: e.RUSTFLAGS}));
fs.writeFileSync(p.join(release, 'papercusp-desktop'), e.FIXTURE_HOST_MISMATCH === '1' ? 'hostless-binary' : (e.PAPERCUSP_RELEASE_HOST || 'hostless-binary'));
fs.writeFileSync(p.join(release, 'bundle/deb/fixture.deb'), 'fixture-deb');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    PAPERCUSP_DESKTOP_TARGET_ROOT: product, PAPERCUSP_RELEASE_HOST_ENV: hostFile,
    PAPERCUSP_DISTRIBUTION_PROFILE: profile, PAPERCUSP_DEFER_DEB_REPACK: '1',
    PAPERCUSP_BUILD_SHA: '1234567', FIXTURE_TARGET: target, FIXTURE_RECORD: record,
    FIXTURE_HOST_MISMATCH: mismatch ? '1' : '0' };
  for (const key of ['PAPERCUSP_RELEASE_HOST', 'PAPERCUSP_UPDATE_BASE_URL',
    'PAPERCUSP_ALLOW_HOSTLESS_RELEASE', 'PAPERCUSP_RELEASE_TAG', '__PAPERCUSP_RELEASE_HOST_LIB']) delete env[key];
  delete env.CARGO_ENCODED_RUSTFLAGS;
  env.RUSTFLAGS = '-C debuginfo=0';
  const run = () => spawnSync('bash', [path.join(root, 'bin/build-deb-repacked.sh')],
    { encoding: 'utf8', env, timeout: 10_000 });
  return { dir, target, record, env, run };
}

test('public Debian producer loads the configured updater host into its actual Tauri child', t => {
  const f = debHostFixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(f.record, 'utf8')).host, base);
  const flags = JSON.parse(fs.readFileSync(f.record, 'utf8')).rustflags;
  assert.ok(flags.includes(`--remap-path-prefix=${os.homedir()}=/build-home`));
  assert.ok(flags.includes('-C debuginfo=0'), 'unrelated caller flags are retained');
  assert.ok(flags.includes('-C link-arg=-fuse-ld=lld'), 'native linker policy survives RUSTFLAGS override');
  assert.match(result.stdout, /release host is BAKED/);
  assert.ok(!result.stdout.includes('secret-prefix'), 'producer must not log the host path');
});

test('public Debian producer refuses missing updater configuration before compiling', t => {
  const f = debHostFixture(t, { configured: false });
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /REFUSING TO CUT/);
  assert.equal(fs.existsSync(f.record), false);
});

test('public Debian producer rejects a child binary which omitted the exported host', t => {
  const f = debHostFixture(t, { mismatch: true });
  const result = f.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /RELEASE HOST NOT BAKED/);
  assert.equal(fs.existsSync(path.join(f.target, 'release/build-provenance.json')), false);
});

test('public byte assertion resolves configured host when its caller omitted the export', t => {
  const f = debHostFixture(t);
  const binary = writeRawFixture(f.dir, 'hostless.bin', 'hostless-binary');
  const result = spawnSync('bash', [path.join(root, 'bin/assert-release-host-baked.sh'), binary],
    { encoding: 'utf8', env: f.env, timeout: 10_000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /RELEASE HOST NOT BAKED/);
});

test('public byte assertion refuses absent configuration instead of reporting success', t => {
  const f = debHostFixture(t, { configured: false });
  const binary = writeRawFixture(f.dir, 'hostless.bin', 'hostless-binary');
  const result = spawnSync('bash', [path.join(root, 'bin/assert-release-host-baked.sh'), binary],
    { encoding: 'utf8', env: f.env, timeout: 10_000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /REFUSING TO CUT/);
});

test('maintained Rust remap removes the real build-home prefix from Cargo binary bytes', t => {
  const cache = path.join(os.homedir(), '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const dir = fs.mkdtempSync(path.join(cache, 'papercusp-rust-remap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'Cargo.toml'),
    '[package]\nname="rust-remap-byte-fixture"\nversion="0.1.0"\nedition="2021"\n');
  const included = path.join(dir, 'included.rs');
  fs.writeFileSync(included, 'pub fn source_path() -> &\'static str { file!() }\n');
  fs.writeFileSync(path.join(dir, 'src/main.rs'),
    `#[path=${JSON.stringify(included)}] mod included;\nfn main(){print!("{}",included::source_path());}\n`);
  const target = path.join(dir, 'target');
  const env = { ...process.env, CARGO_TARGET_DIR: target };
  delete env.RUSTFLAGS;
  delete env.CARGO_ENCODED_RUSTFLAGS;
  const buildArgs = ['build', '--release', '--offline', '--quiet', '--manifest-path', path.join(dir, 'Cargo.toml')];
  const unguarded = spawnSync('cargo', buildArgs, { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(unguarded.status, 0, unguarded.stderr);
  const binary = path.join(target, 'release/rust-remap-byte-fixture');
  assert.ok(fs.readFileSync(binary).includes(Buffer.from(os.homedir())), 'unguarded binary reproduces the identity leak');
  const guarded = spawnSync('bash', ['-c',
    'source "$1"; papercusp_export_rust_path_remap; shift; cargo "$@"', '_',
    path.join(root, 'bin/lib/rust-path-remap.sh'), ...buildArgs],
  { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(guarded.status, 0, guarded.stderr);
  const bytes = fs.readFileSync(binary);
  assert.equal(bytes.includes(Buffer.from(os.homedir())), false);
  assert.ok(bytes.includes(Buffer.from('/build-home')));
});

function runProof(files, proofBase = base) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'source "$1"; shift; release_artifacts_assert_baked_host_from_bytes "$@"',
      '_',
      helper,
      proofBase,
      ...files,
    ],
    { encoding: 'utf8' },
  );
  return {
    ...result,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

function summary(output) {
  const line = output
    .split('\n')
    .find((candidate) => candidate.startsWith('release-host-bytes: checked='));
  assert.ok(line, `byte-proof summary missing from output:\n${output}`);
  const match = line.match(
    /checked=(\d+) mismatched=(\d+) unverified=(\d+) skipped-signatures=(\d+)/,
  );
  assert.ok(match, `byte-proof summary malformed:\n${output}`);
  return Object.fromEntries(
    ['checked', 'mismatched', 'unverified', 'skippedSignatures'].map((key, index) => [
      key,
      Number(match[index + 1]),
    ]),
  );
}

function writeRawFixture(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

function buildDebFixture(dir, body) {
  const packageRoot = path.join(dir, 'deb-root');
  const payload = path.join(packageRoot, 'usr', 'share', 'papercusp');
  fs.mkdirSync(path.join(packageRoot, 'DEBIAN'), { recursive: true });
  fs.mkdirSync(payload, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, 'DEBIAN', 'control'),
    [
      'Package: papercusp-byte-proof-fixture',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: WI-37746 byte-proof fixture',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(payload, 'latest.json'), body);

  const deb = path.join(dir, 'fixture.deb');
  const result = spawnSync('dpkg-deb', ['-Zgzip', '-b', packageRoot, deb], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `dpkg-deb fixture build failed: ${result.stderr}`);
  return deb;
}

test('raw artifact bytes carrying the expected release host pass', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-raw-'));
  try {
    const artifact = writeRawFixture(dir, 'raw.bin', `prefix ${base}/latest.json suffix\n`);
    const result = runProof([artifact]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 1,
      mismatched: 0,
      unverified: 0,
      skippedSignatures: 0,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('expected host followed by adjacent Rust string-table bytes passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-adjacent-'));
  try {
    const artifact = writeRawFixture(dir, 'raw.bin', `${base}USERPROFILEcould\0`);
    const result = runProof([artifact]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 1,
      mismatched: 0,
      unverified: 0,
      skippedSignatures: 0,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('raw artifact bytes carrying a foreign release host fail closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-foreign-'));
  try {
    const artifact = writeRawFixture(
      dir,
      'foreign.bin',
      'https://foreign-artifacts.r2.dev/other-secret/latest.json\n',
    );
    const result = runProof([artifact]);

    assert.equal(result.status, 1, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 0,
      mismatched: 1,
      unverified: 0,
      skippedSignatures: 0,
    });
    assert.match(result.output, /foreign\/mixed host fingerprint/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('foreign path on the expected release authority still fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-foreign-path-'));
  try {
    const artifact = writeRawFixture(
      dir,
      'foreign-path.bin',
      'https://download-test.example.invalid/different-secret/latest.json\n',
    );
    const result = runProof([artifact]);

    assert.equal(result.status, 1, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 0,
      mismatched: 1,
      unverified: 0,
      skippedSignatures: 0,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('compressed deb payloads are scanned for the expected release host', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-deb-'));
  try {
    const deb = buildDebFixture(dir, `${base}/latest.json\n`);
    const result = runProof([deb]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 1,
      mismatched: 0,
      unverified: 0,
      skippedSignatures: 0,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('signature companions are skipped while payload proof remains decisive', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-byte-proof-signature-'));
  try {
    const artifact = writeRawFixture(dir, 'artifact.bin', `${base}/latest.json\n`);
    const signature = writeRawFixture(
      dir,
      'artifact.bin.sig',
      'https://foreign-artifacts.r2.dev/other-secret/latest.json\n',
    );
    const result = runProof([artifact, signature]);

    assert.equal(result.status, 0, result.output);
    assert.deepEqual(summary(result.output), {
      checked: 1,
      mismatched: 0,
      unverified: 0,
      skippedSignatures: 1,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('upload runs byte proof as guard leg 3 and audits override gaps', () => {
  const source = fs.readFileSync(upload, 'utf8');
  const provenance = source.indexOf('GUARD leg 2 (WI-37746)');
  const byteProof = source.indexOf('GUARD leg 3 (WI-37746)');

  assert.ok(provenance >= 0, 'provenance guard leg 2 must remain present');
  assert.ok(byteProof > provenance, 'byte-derived proof must be upload guard leg 3');
  assert.match(
    source,
    /ALLOW_HOST_MISMATCH=1[^\n]*byte-proof gaps=\$\{byte_unverified\}/,
    'the override audit must name byte-proof gaps and skipped signatures',
  );
  assert.match(
    source,
    /release_artifacts_assert_baked_host_from_bytes "\$BASE" "\$\{ARTIFACTS\[@\]\}"/,
    'upload must invoke the shared byte-derived proof helper',
  );
});

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

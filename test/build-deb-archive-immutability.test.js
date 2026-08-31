// EI-20951841751487606 — archived debs must not share an inode with the
// fixed-path live bundle that a later Tauri/dpkg build may rewrite in place.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, generateKeyPairSync, sign } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.join(root, 'bin/build-and-archive-deb.sh');

function parseArchiveArgs(args) {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('DEBUG=0');
  const end = full.indexOf('# --- UPDATER SIGNING KEY', start);
  assert.ok(start > 0, 'archive argument parser not found — did it move or get renamed?');
  assert.ok(end > start, 'archive argument parser end not found');
  const harness = [
    'set -euo pipefail',
    full.slice(start, end),
    'printf "DEBUG=%s KEEP=%s\\n" "$DEBUG" "$KEEP"',
    '',
  ].join('\n');
  return spawnSync('bash', ['-c', harness, 'build-and-archive-deb', ...args], {
    encoding: 'utf8',
  });
}

test('archive argument parser accepts only positive integer retention counts', () => {
  for (const [label, args, expected] of [
    ['default', [], 'DEBUG=0 KEEP=10'],
    ['explicit', ['--keep', '3'], 'DEBUG=0 KEEP=3'],
  ]) {
    const result = parseArchiveArgs(args);
    assert.equal(result.status, 0, `${label} parser failed: ${result.stderr}`);
    assert.match(result.stdout.trim(), new RegExp(`^${expected.replace(' ', '\\s')}$`));
  }

  for (const value of ['0', '-1', 'nope', '1.5', '']) {
    const result = parseArchiveArgs(['--keep', value]);
    assert.equal(result.status, 2, `invalid --keep ${JSON.stringify(value)} unexpectedly passed`);
    assert.match(result.stderr, /--keep must be a positive integer/);
    assert.doesNotMatch(result.stderr, /updater signing key|building|pruning/);
  }
});

function signArtifact(artifact) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicDer = publicKey.export({ format: 'der', type: 'spki' });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const keyId = Buffer.from('0102030405060708', 'hex');
  const publicBlock = Buffer.concat([Buffer.from('Ed'), keyId, rawPublicKey]);
  const publicFile = [
    'untrusted comment: minisign public key',
    publicBlock.toString('base64'),
    '',
  ].join('\n');

  const digest = createHash('blake2b512').update(fs.readFileSync(artifact)).digest();
  const artifactSignature = sign(null, digest, privateKey);
  const signatureBlock = Buffer.concat([Buffer.from('ED'), keyId, artifactSignature]);
  const signatureFile = [
    'untrusted comment: signature from test key',
    signatureBlock.toString('base64'),
    '',
  ].join('\n');
  fs.writeFileSync(`${artifact}.sig`, Buffer.from(signatureFile).toString('base64'));
  return Buffer.from(publicFile).toString('base64');
}

function runRealArchiveBlock(source, archive, { pubkey, keep = 10 } = {}) {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('ARCHIVED_SIG_PATH="${ARCHIVED_PATH}.sig"');
  const end = full.indexOf('echo "=== done:', start);
  assert.ok(start > 0, 'archive block start not found — did it move or get renamed?');
  assert.ok(end > start, 'archive block end not found — did it move or get renamed?');

  const fixtureDesktop = path.join(path.dirname(source), 'desktop-fixture');
  fs.mkdirSync(path.join(fixtureDesktop, 'src-tauri'), { recursive: true });
  fs.writeFileSync(
    path.join(fixtureDesktop, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ plugins: { updater: { pubkey: pubkey || '' } } }),
  );

  const harness = [
    'set -euo pipefail',
    `DEB_PATH=${JSON.stringify(source)}`,
    `ARCHIVED_PATH=${JSON.stringify(archive)}`,
    `ARCHIVE_DIR=${JSON.stringify(path.dirname(archive))}`,
    `LIVE_DESKTOP_DIR=${JSON.stringify(root)}`,
    `DESKTOP_DIR=${JSON.stringify(fixtureDesktop)}`,
    `KEEP=${JSON.stringify(keep)}`,
    'ARCHIVE_TMP=""',
    'ARCHIVE_SIG_TMP=""',
    'ARCHIVE_SIG_PUBLISHED=""',
    full.slice(start, end),
    '',
  ].join('\n');

  return spawnSync('bash', ['-c', harness], { encoding: 'utf8' });
}

function runRetentionBlock({ archiveDir, keep = 1, findFailure = false } = {}) {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('# Prune to the last $KEEP archived builds');
  const end = full.indexOf('echo "=== done:', start);
  assert.ok(start > 0, 'retention block start not found — did it move or get renamed?');
  assert.ok(end > start, 'retention block end not found — did it move or get renamed?');

  const harness = [
    'set -euo pipefail',
    `ARCHIVE_DIR=${JSON.stringify(archiveDir)}`,
    `KEEP=${JSON.stringify(keep)}`,
    findFailure ? 'find() { return 42; }' : '',
    full.slice(start, end),
    'echo RETENTION_BLOCK_SURVIVED',
    '',
  ].join('\n');

  return spawnSync('bash', ['-c', harness], { encoding: 'utf8' });
}

test('archive block creates byte-identical content on a distinct inode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'build-one');
    const pubkey = signArtifact(source);

    const res = runRealArchiveBlock(source, archive, { pubkey });
    assert.equal(res.status, 0, `archive block failed: ${res.stderr}`);
    assert.equal(fs.readFileSync(archive, 'utf8'), 'build-one');
    assert.equal(fs.readFileSync(`${archive}.sig`, 'utf8'), fs.readFileSync(`${source}.sig`, 'utf8'));
    assert.notEqual(
      fs.statSync(source).ino,
      fs.statSync(archive).ino,
      'the archive must never hardlink the mutable fixed-path live deb',
    );
    assert.notEqual(
      fs.statSync(`${source}.sig`).ino,
      fs.statSync(`${archive}.sig`).ino,
      'the archive must never hardlink the mutable fixed-path live signature',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rewriting the live deb after archival cannot mutate the pinned archive', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'build-one');
    const pubkey = signArtifact(source);

    const res = runRealArchiveBlock(source, archive, { pubkey });
    assert.equal(res.status, 0, `archive block failed: ${res.stderr}`);
    const archivedSignature = fs.readFileSync(`${archive}.sig`, 'utf8');

    fs.writeFileSync(source, 'build-two-written-in-place');
    fs.writeFileSync(`${source}.sig`, 'replacement-signature');
    assert.equal(fs.readFileSync(archive, 'utf8'), 'build-one');
    assert.equal(fs.readFileSync(`${archive}.sig`, 'utf8'), archivedSignature);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('refuses to publish a deb when its updater signature is missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'unsigned-build');

    const res = runRealArchiveBlock(source, archive, { pubkey: 'unused' });
    assert.equal(res.status, 9);
    assert.match(res.stderr, /has no non-empty updater signature/);
    assert.equal(fs.existsSync(archive), false);
    assert.equal(fs.existsSync(`${archive}.sig`), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('refuses to publish either final path when the staged signature is invalid', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archive = path.join(tmp, 'archive', 'pinned.deb');
    fs.writeFileSync(source, 'signed-build');
    const pubkey = signArtifact(source);
    fs.writeFileSync(`${source}.sig`, 'not-a-valid-tauri-signature');

    const res = runRealArchiveBlock(source, archive, { pubkey });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /signature INVALID/);
    assert.equal(fs.existsSync(archive), false, 'the .deb commit marker must not publish');
    assert.equal(fs.existsSync(`${archive}.sig`), false, 'the unverified signature must not publish');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retention pruning removes each old signature with its archived deb', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-archive-'));
  try {
    const source = path.join(tmp, 'live.deb');
    const archiveDir = path.join(tmp, 'archive');
    const archive = path.join(archiveDir, 'new.deb');
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const name of ['old-one.deb', 'old-two.deb']) {
      fs.writeFileSync(path.join(archiveDir, name), name);
      fs.writeFileSync(path.join(archiveDir, `${name}.sig`), `${name}-signature`);
      fs.utimesSync(path.join(archiveDir, name), 1, 1);
    }
    fs.writeFileSync(source, 'new-build');
    const pubkey = signArtifact(source);

    const res = runRealArchiveBlock(source, archive, { pubkey, keep: 1 });
    assert.equal(res.status, 0, res.stderr);
    for (const name of ['old-one.deb', 'old-two.deb']) {
      assert.equal(fs.existsSync(path.join(archiveDir, name)), false);
      assert.equal(fs.existsSync(path.join(archiveDir, `${name}.sig`)), false);
    }
    assert.equal(fs.existsSync(archive), true);
    assert.equal(fs.existsSync(`${archive}.sig`), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retention census failure is a hard error, not a successful no-op', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-retention-'));
  try {
    const result = runRetentionBlock({ archiveDir: path.join(tmp, 'archive'), findFailure: true });
    assert.equal(result.status, 9, `expected retention failure, got ${result.status}: ${result.stderr}`);
    assert.match(result.stderr, /could not enumerate archived Debian packages for retention/);
    assert.doesNotMatch(result.stdout, /RETENTION_BLOCK_SURVIVED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

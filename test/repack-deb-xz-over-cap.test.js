// WI-6554700010012467: an ar member header holds its size in 10 decimal digits, so a
// .deb member is capped at 9,999,999,999 bytes. Tauri wrote a seeded Server's
// data.tar.gz (11,962,260,753 bytes) with an 11-digit size anyway; the shifted header
// made dpkg call the package "corrupt - bad archive header magic", and
// repack-deb-xz.sh died with a misleading "could not inspect" (exit 8).
//
// These fixtures reproduce that header shape without 10 GB of disk: the data member is
// a real data.tar.gz followed by a sparse zero tail (gzip ignores trailing zeros).
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const helper = process.env.PAPERCUSP_REPACK_HELPER_UNDER_TEST || path.join(root, 'bin', 'repack-deb-xz.sh');
const audit = process.env.PAPERCUSP_AR_AUDIT_UNDER_TEST || path.join(root, 'bin', 'ar-member-audit.py');
const OVER_CAP_SIZE = 10_000_000_001; // 11 digits: one past the field, odd so a pad byte follows

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(res.status, 0, `${cmd} ${args.join(' ')} failed (${res.status}): ${res.stderr}`);
  return res.stdout;
}

function buildSmallDeb(dir) {
  const pkg = path.join(dir, 'pkg');
  fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
    'Package: papercusp-over-cap-test',
    'Version: 1.0.0',
    'Architecture: all',
    'Maintainer: Papercusp <test@example.invalid>',
    'Description: ar member cap fixture',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'seed bytes stand-in\n');
  const deb = path.join(dir, 'small.deb');
  run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
  return deb;
}

function arMember(deb, name) {
  const res = spawnSync('ar', ['p', deb, name]);
  assert.equal(res.status, 0, `ar p ${name}: ${res.stderr}`);
  return res.stdout;
}

function arHeader(name, size) {
  // Written the way Tauri's writer did: the size is printed at full width even when it
  // is longer than the 10-character field, which shifts the trailing magic.
  const s = `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(size).padEnd(10)}\`\n`;
  return Buffer.from(s, 'latin1');
}

/** Write an ar archive; a member whose `size` exceeds its bytes gets a sparse zero tail. */
function writeArchive(file, members, { truncateBy = 0 } = {}) {
  const fd = fs.openSync(file, 'w');
  try {
    let off = 0;
    const put = (buf) => { fs.writeSync(fd, buf, 0, buf.length, off); off += buf.length; };
    put(Buffer.from('!<arch>\n', 'latin1'));
    for (const { name, bytes, size = bytes.length } of members) {
      put(arHeader(name, size));
      put(bytes);
      off += size - bytes.length;
      if (size & 1) put(Buffer.from('\n', 'latin1'));
    }
    fs.ftruncateSync(fd, off - truncateBy);
  } finally {
    fs.closeSync(fd);
  }
}

function overCapFixture(dir, opts) {
  const small = buildSmallDeb(dir);
  const deb = path.join(dir, 'over-cap.deb');
  writeArchive(deb, [
    { name: 'debian-binary', bytes: arMember(small, 'debian-binary') },
    { name: 'control.tar.gz', bytes: arMember(small, 'control.tar.gz') },
    { name: 'data.tar.gz', bytes: arMember(small, 'data.tar.gz'), size: OVER_CAP_SIZE },
  ], opts);
  return deb;
}

function withTmp(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-over-cap-'));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function repack(deb, env = {}) {
  const clean = { ...process.env };
  delete clean.TAURI_SIGNING_PRIVATE_KEY;
  delete clean.TAURI_SIGNING_PRIVATE_KEY_PATH;
  return spawnSync('bash', [helper, deb], {
    encoding: 'utf8',
    env: { ...clean, PAPERCUSP_XZ_THREADS: '2', PAPERCUSP_XZ_MEMORY_LIMIT: '512MiB', ...env },
  });
}

test('audit reads a well-formed package as three in-cap members', () => withTmp((tmp) => {
  const res = spawnSync('python3', [audit, 'audit', buildSmallDeb(tmp)], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /name=debian-binary size=4 .*status=ok/);
  assert.match(lines[2], /name=data\.tar\.gz .*status=ok cap=9999999999/);
}));

test('the fixture reproduces the defect: dpkg calls the over-cap package corrupt', () => withTmp((tmp) => {
  // --info reads only the control member, which still parses; the payload read is what breaks.
  const res = spawnSync('dpkg-deb', ['--contents', overCapFixture(tmp)], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /bad archive header magic|corrupt/);
}));

test('audit names the over-cap member, its real size and its offset (exit 3)', () => withTmp((tmp) => {
  const deb = overCapFixture(tmp);
  const res = spawnSync('python3', [audit, 'audit', deb], { encoding: 'utf8' });
  assert.equal(res.status, 3, res.stderr);
  assert.match(res.stdout, new RegExp(`name=data\\.tar\\.gz size=${OVER_CAP_SIZE} offset=\\d+ status=over-cap`));
  const names = spawnSync('python3', [audit, 'names', deb], { encoding: 'utf8' });
  assert.equal(names.status, 0, names.stderr);
  assert.deepEqual(names.stdout.trim().split('\n'), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
}));

test('audit extracts the in-cap members of an over-cap package byte-for-byte', () => withTmp((tmp) => {
  const deb = overCapFixture(tmp);
  const small = path.join(tmp, 'small.deb');
  const res = spawnSync('python3', [audit, 'extract', deb, 'control.tar.gz']);
  assert.equal(res.status, 0, String(res.stderr));
  assert.deepEqual(res.stdout, arMember(small, 'control.tar.gz'));
}));

test('audit refuses an over-cap archive that is shorter than its header claims (exit 2)', () => withTmp((tmp) => {
  const deb = overCapFixture(tmp, { truncateBy: 4096 });
  const res = spawnSync('python3', [audit, 'audit', deb], { encoding: 'utf8' });
  assert.equal(res.status, 2);
  assert.match(res.stderr, /AR_AUDIT_CORRUPT .*claims 10000000001 bytes but the file ends/);
}));

test('repack recovers an over-cap gzip package into a readable xz package', () => withTmp((tmp) => {
  const deb = overCapFixture(tmp);
  const res = repack(deb);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /above the 9,999,999,999-byte member cap/);
  assert.match(res.stdout, /repacked data member as xz -9/);
  assert.deepEqual(run('ar', ['t', deb]).trim().split('\n'), ['debian-binary', 'control.tar.gz', 'data.tar.xz']);
  assert.match(run('dpkg-deb', ['--contents', deb]), /\.\/opt\/fixture\/payload/);
  assert.ok(fs.statSync(deb).size < 1_000_000, 'the zero tail compresses away; the repacked deb is small');
}));

test('guard-only refuses an over-cap package instead of passing it through (exit 11)', () => withTmp((tmp) => {
  const deb = overCapFixture(tmp);
  const before = fs.statSync(deb).size;
  const res = repack(deb, { PAPERCUSP_DEB_REPACK_GUARD_ONLY: '1' });
  assert.equal(res.status, 11, res.stderr);
  assert.match(res.stderr, /above the ar member cap and this mode cannot shrink it/);
  assert.equal(fs.statSync(deb).size, before);
}));

test('repack refuses an xz member above the cap and leaves the original untouched (exit 12)', () => withTmp((tmp) => {
  const deb = buildSmallDeb(tmp);
  const original = fs.readFileSync(deb);
  const res = repack(deb, { PAPERCUSP_DEB_MEMBER_CAP_BYTES: '64' });
  assert.equal(res.status, 12, res.stderr);
  assert.match(res.stderr, /the xz data member is \d+ bytes, above the ar member cap of 64 bytes/);
  assert.deepEqual(fs.readFileSync(deb), original);
}));

test('a malformed cap override is refused before any work (exit 7)', () => withTmp((tmp) => {
  for (const bad of ['0', '-5', '12345678901', 'ten']) {
    const res = repack(buildSmallDeb(fs.mkdtempSync(path.join(tmp, 'c-'))), { PAPERCUSP_DEB_MEMBER_CAP_BYTES: bad });
    assert.equal(res.status, 7, `${bad}: ${res.stderr}`);
  }
}));

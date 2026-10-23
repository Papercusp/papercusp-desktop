// WI-6554700010012560 / p2p-public-release-endgame-2026-09-01#D-236: the seeded dogfood
// Server's data member is above the 9,999,999,999-byte ar member cap even under xz -9, so
// bin/split-server-seed-deb.py moves `usr/lib/Papercusp Server/seed/**` into a companion
// `papercusp-server-seed` package. These tests pin the contract the release relies on:
// the two outputs partition the original exactly, dpkg's strict install walker accepts
// both and reproduces the original tree, the seed can take over files from an older
// seeded Server whichever package is unpacked first, and every refusal is named.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const splitter = process.env.PAPERCUSP_SEED_SPLIT_UNDER_TEST || path.join(root, 'bin', 'split-server-seed-deb.py');
const repack = path.join(root, 'bin', 'repack-deb-xz.sh');
const SEED_ROOT = 'usr/lib/Papercusp Server/seed';
const VERSION = '1.2.3';

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(res.status, 0, `${cmd} ${args.join(' ')} failed (${res.status}): ${res.stderr}`);
  return res.stdout;
}

function md5(bytes) {
  return crypto.createHash('md5').update(bytes).digest('hex');
}

function withTmp(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-seed-split-'));
  try {
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** A small Server .deb shaped like the real one: seed subtree, sidecar, binary, postinst. */
function buildServerDeb(dir, { seed = true, crossLink = false, badMd5 = false, seedBytes = 3000, packageName = 'papercusp-server', recommends } = {}) {
  const pkg = path.join(dir, 'pkg');
  const files = new Map([
    ['usr/bin/papercusp-server', { bytes: Buffer.from('#!/bin/sh\necho server\n'), mode: 0o755 }],
    ['usr/lib/Papercusp Server/sidecar/serve.js', { bytes: Buffer.from('console.log("serve")\n'), mode: 0o644 }],
    ['usr/share/doc/papercusp-server/copyright', { bytes: Buffer.from('copyright\n'), mode: 0o644 }],
  ]);
  if (seed) {
    files.set(`${SEED_ROOT}/git/objects/pack/pack-1.pack`, { bytes: crypto.randomBytes(seedBytes), mode: 0o644 });
    files.set(`${SEED_ROOT}/corestore/db/0001`, { bytes: crypto.randomBytes(1500), mode: 0o644 });
    files.set(`${SEED_ROOT}/manifest.json`, { bytes: Buffer.from('{"seed":true}\n'), mode: 0o644 });
  }
  for (const [rel, { bytes, mode }] of files) {
    fs.mkdirSync(path.dirname(path.join(pkg, rel)), { recursive: true });
    fs.writeFileSync(path.join(pkg, rel), bytes, { mode });
  }
  if (seed) fs.symlinkSync('git', path.join(pkg, SEED_ROOT, 'current'));
  if (crossLink) {
    // 'seed' sorts before 'sidecar', so tar stores the seed file and links the sidecar copy to it.
    fs.linkSync(path.join(pkg, SEED_ROOT, 'corestore/db/0001'), path.join(pkg, 'usr/lib/Papercusp Server/sidecar/dup.bin'));
    files.set('usr/lib/Papercusp Server/sidecar/dup.bin', files.get(`${SEED_ROOT}/corestore/db/0001`));
  }
  fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
    `Package: ${packageName}`,
    `Version: ${VERSION}`,
    'Architecture: amd64',
    'Maintainer: Papercusp <test@example.invalid>',
    'Installed-Size: 400',
    'Depends: bubblewrap',
    ...(recommends ? [`Recommends: ${recommends}`] : []),
    'Section: utils',
    'Priority: optional',
    'Description: Papercusp Server fixture',
    ' A small stand-in for the seeded dogfood Server package.',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'postinst'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const md5sums = [...files].map(([rel, { bytes }]) => {
    const digest = badMd5 && rel === `${SEED_ROOT}/manifest.json` ? '0'.repeat(32) : md5(bytes);
    return `${digest}  ${rel}\n`;
  });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'md5sums'), md5sums.join(''));
  const deb = path.join(dir, `Papercusp Server_${VERSION}_amd64.deb`);
  run('dpkg-deb', ['--root-owner-group', '-Zgzip', '-b', pkg, deb]);
  return deb;
}

function split(deb, outDir, env = {}) {
  return spawnSync('python3', ['-I', splitter, 'split', deb, '--out-dir', outDir], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function splitOk(deb, outDir) {
  const res = split(deb, outDir);
  assert.equal(res.status, 0, `split failed (${res.status}): ${res.stderr}`);
  const out = Object.fromEntries(res.stdout.trim().split('\n').map((line) => line.split('\t')));
  return { server: out.server, seed: out.seed, stderr: res.stderr };
}

/** { dirs, others } of the data tar, names normalized like md5sums ('' is the root). */
function entries(deb) {
  const listing = run('bash', ['-c', 'dpkg-deb --fsys-tarfile "$1" | tar -t', '_', deb]);
  const dirs = new Set();
  const others = new Set();
  for (const raw of listing.split('\n').filter(Boolean)) {
    const isDir = raw.endsWith('/');
    const name = raw.replace(/^\.\/?/, '').replace(/\/$/, '');
    (isDir ? dirs : others).add(name);
  }
  return { dirs, others };
}

function controlFile(deb, member) {
  return run('bash', ['-c', 'dpkg-deb --ctrl-tarfile "$1" | tar -xO "./$2"', '_', deb, member]);
}

function newDpkgRoot(dir) {
  const admin = path.join(dir, 'var', 'lib', 'dpkg');
  for (const sub of ['updates', 'info', 'triggers']) fs.mkdirSync(path.join(admin, sub), { recursive: true });
  fs.writeFileSync(path.join(admin, 'status'), '');
  return dir;
}

function dpkgUnpack(dpkgRoot, deb) {
  return spawnSync('dpkg', [
    `--root=${dpkgRoot}`,
    `--instdir=${dpkgRoot}`,
    `--admindir=${path.join(dpkgRoot, 'var', 'lib', 'dpkg')}`,
    '--force-not-root',
    '--no-triggers',
    '--unpack',
    deb,
  ], { encoding: 'utf8' });
}

/** path -> 'dir' | 'link:<target>' | '<mode>:<md5>' for every entry outside dpkg's admindir. */
function tree(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      const child = rel ? `${rel}/${name}` : name;
      if (child === 'var') continue;
      const full = path.join(dir, child);
      const st = fs.lstatSync(full);
      if (st.isSymbolicLink()) out.set(child, `link:${fs.readlinkSync(full)}`);
      else if (st.isDirectory()) { out.set(child, 'dir'); walk(child); }
      else out.set(child, `${(st.mode & 0o777).toString(8)}:${md5(fs.readFileSync(full))}`);
    }
  };
  walk('');
  return out;
}

const underSeed = (name) => name === SEED_ROOT || name.startsWith(`${SEED_ROOT}/`);

test('disk refusal preserves the input and signature before writing split archives', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const original = fs.readFileSync(deb);
  fs.writeFileSync(`${deb}.sig`, 'original signature');
  const out = path.join(tmp, 'out');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(out);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'df'), '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 100 100 0 100%% /\\n"\n', { mode: 0o755 });
  const res = split(deb, out, {
    PATH: `${bin}:${process.env.PATH}`,
    PAPERCUSP_DISK_RESERVATION_DIR: path.join(tmp, 'reservations'),
  });
  assert.equal(res.status, 28, res.stderr);
  assert.match(res.stderr, /insufficient disk for Linux seed split/);
  assert.deepEqual(fs.readdirSync(out), [], 'admission must precede even the temporary work directory');
  assert.deepEqual(fs.readFileSync(deb), original);
  assert.equal(fs.readFileSync(`${deb}.sig`, 'utf8'), 'original signature');
}));

test('split holds a live disk reservation while streaming and releases it on failure', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const out = path.join(tmp, 'out');
  const ledger = path.join(tmp, 'reservations');
  fs.mkdirSync(out);
  const probe = String.raw`
import importlib.util, os, pathlib, sys
spec = importlib.util.spec_from_file_location('splitter', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
def inspect(pkg, router):
    claims = []
    for p in pathlib.Path(os.environ['PAPERCUSP_DISK_RESERVATION_DIR']).rglob('*'):
        if p.is_file():
            fields = dict(line.split('=', 1) for line in p.read_text().splitlines() if '=' in line)
            if fields.get('label') == 'Linux seed split':
                os.kill(int(fields['pid']), 0)
                assert int(fields['gb']) >= 1
                claims.append(p)
    assert len(claims) == 1, claims
    raise m.SplitError(19, 'RESERVATION_OBSERVED')
m.stream_data = inspect
try:
    m.split(sys.argv[2], sys.argv[3], False, m.DEFAULT_SEED_ROOT)
except m.SplitError as e:
    print(e, file=sys.stderr)
    sys.exit(e.code)
`;
  const res = spawnSync('python3', ['-I', '-c', probe, splitter, deb, out], {
    encoding: 'utf8', env: { ...process.env, PAPERCUSP_DISK_RESERVATION_DIR: ledger },
  });
  assert.equal(res.status, 19, res.stderr);
  assert.match(res.stderr, /RESERVATION_OBSERVED/);
  assert.deepEqual(fs.readdirSync(out), [], 'failed streaming must leave no partial output');
  const claims = fs.readdirSync(ledger, { recursive: true }).filter((name) => {
    const full = path.join(ledger, name);
    return fs.statSync(full).isFile() && /label=Linux seed split/.test(fs.readFileSync(full, 'utf8'));
  });
  assert.deepEqual(claims, [], 'a finished split must release its reservation');
}));

test('the two outputs partition the original payload exactly', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const { server, seed, stderr } = splitOk(deb, out);
  assert.equal(path.basename(server), path.basename(deb));
  assert.equal(path.basename(seed), `papercusp-server-seed_${VERSION}_all.deb`);
  assert.match(stderr, /SEED_SPLIT_RESULT .*seed_files=3 /);

  const original = entries(deb);
  const s = entries(server);
  const d = entries(seed);
  for (const name of s.others) assert.ok(!d.others.has(name), `${name} is in both packages`);
  assert.deepEqual(new Set([...s.others, ...d.others]), original.others, 'non-directory entries must partition the original');
  assert.ok([...d.others].every(underSeed), 'the seed package carries only seed entries');
  assert.ok(![...s.others].some(underSeed) && ![...s.dirs].some(underSeed), 'the Server package carries no seed entry');
  const ancestors = ['', 'usr', 'usr/lib', 'usr/lib/Papercusp Server'];
  assert.ok([...d.dirs].every((n) => underSeed(n) || ancestors.includes(n)), `seed dirs: ${[...d.dirs]}`);
  for (const a of ancestors) assert.ok(d.dirs.has(a), `the seed package must carry its parent dir ${a || '.'}`);
  assert.deepEqual(new Set([...s.dirs, ...d.dirs]), original.dirs, 'directory entries must cover the original');
}));

test('control metadata: Server Recommends the seed, seed Replaces older Servers, md5sums split', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const { server, seed } = splitOk(deb, out);
  const field = (pkg, name) => run('dpkg-deb', ['-f', pkg, name]).trim();

  assert.equal(field(server, 'Package'), 'papercusp-server');
  assert.equal(field(server, 'Version'), VERSION);
  assert.equal(field(server, 'Depends'), 'bubblewrap');
  assert.equal(field(server, 'Recommends'), 'papercusp-server-seed');
  const seedKib = Number(field(seed, 'Installed-Size'));
  assert.ok(seedKib >= 5, `seed Installed-Size ${seedKib}`);
  assert.equal(Number(field(server, 'Installed-Size')), 400 - seedKib);

  assert.equal(field(seed, 'Package'), 'papercusp-server-seed');
  assert.equal(field(seed, 'Version'), VERSION);
  assert.equal(field(seed, 'Architecture'), 'all');
  assert.equal(field(seed, 'Replaces'), `papercusp-server (<= ${VERSION})`);
  assert.equal(field(seed, 'Enhances'), 'papercusp-server');
  assert.match(run('python3', ['-I', splitter, 'verify-control', server, seed]), /D236_SPLIT_CONTROL_OK/);

  assert.equal(controlFile(server, 'postinst'), '#!/bin/sh\nexit 0\n', 'the Server keeps its maintainer scripts');
  const seedControl = run('bash', ['-c', 'dpkg-deb --ctrl-tarfile "$1" | tar -t', '_', seed]);
  assert.doesNotMatch(seedControl, /postinst|prerm|postrm|preinst/, 'the seed package has no maintainer scripts');

  const serverSums = controlFile(server, 'md5sums').trim().split('\n');
  const seedSums = controlFile(seed, 'md5sums').trim().split('\n');
  const originalSums = controlFile(deb, 'md5sums').trim().split('\n');
  assert.ok(serverSums.every((l) => !underSeed(l.slice(34))), 'Server md5sums lists no seed file');
  assert.ok(seedSums.every((l) => underSeed(l.slice(34))), 'seed md5sums lists only seed files');
  assert.deepEqual(new Set([...serverSums, ...seedSums]), new Set(originalSums));
}));

test('D-236 control guard rejects a versioned seed relation before publishing a split pair', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp, { recommends: `papercusp-server-seed (= ${VERSION})` });
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const res = split(deb, out);
  assert.equal(res.status, 17, res.stderr);
  assert.match(res.stderr, /one unversioned Recommends: papercusp-server-seed/);
  assert.deepEqual(fs.readdirSync(out), [], 'contract failure must publish neither package');
}));

test('control-only successor corrects a versioned relation while preserving the exact data member', () => withTmp((tmp) => {
  const seeded = buildServerDeb(tmp);
  const splitDir = path.join(tmp, 'split');
  fs.mkdirSync(splitDir);
  const { seed } = splitOk(seeded, splitDir);
  const sourceDir = path.join(tmp, 'source');
  fs.mkdirSync(sourceDir);
  const source = buildServerDeb(sourceDir, { seed: false, recommends: `papercusp-server-seed (= ${VERSION})` });
  const successor = path.join(tmp, 'successor.deb');
  const originalSha = md5(fs.readFileSync(source));
  const originalData = spawnSync('ar', ['p', source, 'data.tar.gz']).stdout;
  assert.match(run('python3', ['-I', splitter, 'rewrite-control', source, seed, successor]), /D236_CONTROL_REWRITE_OK/);
  assert.equal(md5(fs.readFileSync(source)), originalSha, 'source package must remain untouched');
  assert.deepEqual(spawnSync('ar', ['p', successor, 'data.tar.gz']).stdout, originalData);
  assert.equal(run('dpkg-deb', ['-f', successor, 'Recommends']).trim(), 'papercusp-server-seed');
  assert.equal(controlFile(successor, 'md5sums'), controlFile(source, 'md5sums'));
  assert.match(run('python3', ['-I', splitter, 'verify-control', successor, seed]), /D236_SPLIT_CONTROL_OK/);
  const refused = spawnSync('python3', ['-I', splitter, 'rewrite-control', successor, seed, path.join(tmp, 'again.deb')], { encoding: 'utf8' });
  assert.equal(refused.status, 17, refused.stderr);
  assert.ok(!fs.existsSync(path.join(tmp, 'again.deb')));
}));

test('dpkg --unpack of both outputs reproduces the original tree', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const { server, seed } = splitOk(deb, out);

  const before = newDpkgRoot(path.join(tmp, 'root-original'));
  let res = dpkgUnpack(before, deb);
  assert.equal(res.status, 0, res.stderr);
  const after = newDpkgRoot(path.join(tmp, 'root-split'));
  for (const pkg of [server, seed]) {
    res = dpkgUnpack(after, pkg);
    assert.equal(res.status, 0, `dpkg --unpack ${path.basename(pkg)}: ${res.stderr}`);
  }
  assert.deepEqual(tree(after), tree(before));
  assert.equal(fs.readlinkSync(path.join(after, SEED_ROOT, 'current')), 'git');
}));

for (const order of ['seed-first', 'server-first']) {
  test(`upgrading an installed seeded Server keeps the seed files (${order})`, () => withTmp((tmp) => {
    const deb = buildServerDeb(tmp);
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    const { server, seed } = splitOk(deb, out);
    const dpkgRoot = newDpkgRoot(path.join(tmp, 'root'));
    let res = dpkgUnpack(dpkgRoot, deb);
    assert.equal(res.status, 0, res.stderr);
    const seeded = tree(dpkgRoot);
    for (const pkg of order === 'seed-first' ? [seed, server] : [server, seed]) {
      res = dpkgUnpack(dpkgRoot, pkg);
      assert.equal(res.status, 0, `dpkg --unpack ${path.basename(pkg)} (${order}): ${res.stderr}`);
    }
    assert.deepEqual(tree(dpkgRoot), seeded, 'the seed files must survive the upgrade');
  }));
}

test('the outputs go through repack-deb-xz.sh unchanged in content', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const out = path.join(tmp, 'out');
  fs.mkdirSync(out);
  const { server, seed } = splitOk(deb, out);
  const before = [entries(server), entries(seed)];
  const env = { ...process.env, PAPERCUSP_XZ_THREADS: '1', PAPERCUSP_XZ_MEMORY_LIMIT: '256MiB' };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  for (const pkg of [server, seed]) {
    run('bash', [repack, pkg], { env });
    assert.equal(run('ar', ['t', pkg]).trim().split('\n')[2], 'data.tar.xz');
  }
  assert.deepEqual([entries(server), entries(seed)], before);
}));

test('--in-place replaces the input, drops its stale .sig and writes the seed beside it', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  fs.writeFileSync(`${deb}.sig`, 'stale signature');
  const res = spawnSync('python3', ['-I', splitter, 'split', deb, '--in-place'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.existsSync(`${deb}.sig`), false, 'a signature over the old bytes must not survive');
  const seed = path.join(tmp, `papercusp-server-seed_${VERSION}_all.deb`);
  assert.ok(fs.existsSync(seed));
  assert.ok(![...entries(deb).others].some(underSeed), 'the input now carries no seed');
  assert.deepEqual(fs.readdirSync(tmp).filter((n) => n.startsWith('.seed-split.')), [], 'no work dir is left behind');
}));

test('info reads the identity of an over-cap package that dpkg cannot open', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const member = (name) => spawnSync('ar', ['p', deb, name]).stdout;
  const header = (name, size) => Buffer.from(
    `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(size).padEnd(10)}\`\n`,
    'latin1',
  );
  const overCap = path.join(tmp, 'over-cap.deb');
  const fd = fs.openSync(overCap, 'w');
  let off = 0;
  const put = (buf) => { fs.writeSync(fd, buf, 0, buf.length, off); off += buf.length; };
  put(Buffer.from('!<arch>\n', 'latin1'));
  for (const [name, bytes, size = bytes.length] of [
    ['debian-binary', member('debian-binary')],
    ['control.tar.gz', member('control.tar.gz')],
    ['data.tar.gz', member('data.tar.gz'), 10_000_000_001],
  ]) {
    put(header(name, size));
    put(bytes);
    off += size - bytes.length;
    if (size & 1) put(Buffer.from('\n', 'latin1'));
  }
  fs.ftruncateSync(fd, off);
  fs.closeSync(fd);
  // dpkg-deb -f stops at the control member, before the broken header; the payload is what dpkg cannot reach.
  assert.notEqual(spawnSync('dpkg-deb', ['--contents', overCap]).status, 0, 'precondition: dpkg cannot read the payload');
  const res = spawnSync('python3', ['-I', splitter, 'info', overCap], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, `papercusp-server\t${VERSION}\tamd64\t3\n`, 'SeedFiles counts the md5sums entries under the seed root');
}));

// The producers (build-linux-local.sh, release-local.sh) repack every Linux .deb through
// bin/lib/repack-linux-deb.sh; these drive that function exactly as they do.
const producerLib = path.join(root, 'bin', 'lib', 'repack-linux-deb.sh');
function produce(deb) {
  const env = { ...process.env, PAPERCUSP_XZ_THREADS: '1', PAPERCUSP_XZ_MEMORY_LIMIT: '256MiB' };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  return spawnSync('bash', ['-c', 'set -euo pipefail; source "$1"; papercusp_repack_linux_deb "$2" "$3"', '_', producerLib, deb, repack], {
    encoding: 'utf8',
    env,
  });
}

test('producer: a seeded Server leaves the repack as two xz packages', () => withTmp((tmp) => {
  const deb = buildServerDeb(tmp);
  const original = entries(deb);
  const res = produce(deb);
  assert.equal(res.status, 0, res.stderr);
  const seed = path.join(tmp, `papercusp-server-seed_${VERSION}_all.deb`);
  assert.ok(fs.existsSync(seed), 'the companion seed package must sit beside the Server package');
  for (const pkg of [deb, seed]) assert.equal(run('ar', ['t', pkg]).trim().split('\n')[2], 'data.tar.xz');
  assert.ok(![...entries(deb).others].some(underSeed), 'the Server package no longer carries the seed');
  assert.deepEqual(new Set([...entries(deb).others, ...entries(seed).others]), original.others);
}));

test('producer: a Server without seed files, or any other package, is repacked unsplit', () => withTmp((tmp) => {
  for (const [label, opts] of [['seedless Server', { seed: false }], ['seeded non-Server', { packageName: 'papercusp-gui' }]]) {
    const dir = fs.mkdtempSync(path.join(tmp, 'case-'));
    const deb = buildServerDeb(dir, opts);
    const before = entries(deb);
    const res = produce(deb);
    assert.equal(res.status, 0, `${label}: ${res.stderr}`);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.deb')), [path.basename(deb)], `${label}: no seed package`);
    assert.equal(run('ar', ['t', deb]).trim().split('\n')[2], 'data.tar.xz', `${label}: still repacked`);
    assert.deepEqual(entries(deb), before, `${label}: content unchanged`);
  }
}));

test('refusals are named and leave nothing behind', async (t) => {
  const refuse = (opts, env, code, pattern) => withTmp((tmp) => {
    const deb = buildServerDeb(tmp, opts);
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    const res = split(deb, out, env);
    assert.equal(res.status, code, `expected exit ${code}, got ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, pattern);
    assert.deepEqual(fs.readdirSync(out), [], 'a refused split publishes nothing');
  });
  await t.test('no seed subtree (exit 10)', () => refuse({ seed: false }, {}, 10, /nothing to split/));
  await t.test('an output member above the ar cap (exit 13)', () =>
    refuse({ seedBytes: 20_000 }, { PAPERCUSP_DEB_MEMBER_CAP_BYTES: '9000' }, 13, /above the ar member cap of 9000/));
  await t.test('a hardlink across the seed boundary (exit 14)', () => refuse({ crossLink: true }, {}, 14, /crosses the seed boundary/));
  await t.test('payload bytes that do not match md5sums (exit 15)', () => refuse({ badMd5: true }, {}, 15, /does not match md5sums/));
  await t.test('a malformed cap override (exit 7)', () =>
    refuse({}, { PAPERCUSP_DEB_MEMBER_CAP_BYTES: '12345678901' }, 7, /at most 10 digits/));
});

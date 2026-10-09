const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const producer = fs.readFileSync(path.join(root, 'scripts/build-rootfs.sh'), 'utf8');
const shipped = fs.readFileSync(path.join(root, 'src-tauri/resources/papercup-bootstrap.sh'), 'utf8');
const voiceE2e = fs.readFileSync(
  path.join(root, '..', 'apps/tui/scripts/live-operator-voice-e2e.mjs'),
  'utf8',
);
const section = text => text.slice(text.indexOf('NODE_TARBALL='), text.indexOf('\n# pnpm'));
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8', timeout: 15000, ...options,
});

function fixture(t, { invalidNpm = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap node '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prefix = path.join(dir, 'prefix');
  const upstream = path.join(dir, 'node-v24.18.1-linux-x64');
  const write = (base, relative, content, mode) => {
    const p = path.join(base, relative);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, { mode });
    return p;
  };
  const npm = 'lib/node_modules/npm';
  write(prefix, `${npm}/node_modules/minipass-flush/node_modules/minipass/index.js`, 'module.exports = class OldMinipass {};\n');
  write(prefix, `${npm}/old-only.txt`, 'stale');
  write(prefix, 'lib/node_modules/user-tool/keep.txt', 'user-owned');
  write(prefix, 'bin/node', 'original runtime');
  write(upstream, 'bin/node', `#!/bin/sh\nexec ${quote(process.execPath)} "$@"\n`, 0o755);
  write(upstream, `${npm}/node_modules/minipass/index.js`, 'exports.Minipass = class Minipass {};\n');
  write(upstream, `${npm}/node_modules/minipass-flush/index.js`, "const { Minipass } = require('minipass'); module.exports = class Flush extends Minipass {};\n");
  write(upstream, `${npm}/bin/npm-cli.js`, invalidNpm ? 'throw new Error("broken upstream npm");\n' : "require('../node_modules/minipass-flush'); console.log('npm fixture healthy');\n");
  fs.symlinkSync('../lib/node_modules/npm/bin/npm-cli.js', path.join(upstream, 'bin/npm'));
  const archive = path.join(dir, 'node.tar.xz');
  const packed = run('tar', ['-cJf', archive, '-C', dir, path.basename(upstream)]);
  assert.equal(packed.status, 0, packed.stderr);
  const fakebin = path.join(dir, 'tools');
  write(fakebin, 'curl', '#!/bin/sh\nif [ "${CURL_FAIL:-0}" = 1 ]; then exit 22; fi\ncat "$NODE_FIXTURE_ARCHIVE"\n', 0o755);
  const script = path.join(dir, 'install.sh');
  const body = section(shipped);
  assert.ok(body.includes('install_node_runtime /usr/local'), 'exercise the production invocation');
  fs.writeFileSync(script, 'set -euo pipefail\nNODE_VERSION=24.18.1\n' + body.replace('install_node_runtime /usr/local', 'install_node_runtime "$TEST_NODE_PREFIX"'));
  const env = { ...process.env, PATH: `${fakebin}:${process.env.PATH}`, NODE_FIXTURE_ARCHIVE: archive, TEST_NODE_PREFIX: prefix };
  return { dir, prefix, archive, npm, env, install: extra => run('bash', [script], { env: { ...env, ...extra } }),
    probe: () => run(process.execPath, [path.join(prefix, npm, 'bin/npm-cli.js')]),
    stageDirs: () => fs.readdirSync(prefix).filter(n => n.startsWith('.papercusp-node.')) };
}

test('rootfs producer fingerprints the complete shipped bootstrap, including network preflight', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs recipe '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'src-tauri/resources'), { recursive: true });
  const build = path.join(dir, 'scripts/build-rootfs.sh');
  const resource = path.join(dir, 'src-tauri/resources/papercup-bootstrap.sh');
  const artifact = path.join(dir, 'src-tauri/resources/papercup-runtime.tar.gz');
  fs.writeFileSync(build, producer);
  fs.writeFileSync(resource, shipped);
  fs.writeFileSync(artifact, 'existing rootfs must survive a read');
  const env = { ...process.env, UBUNTU_IMAGE: 'ubuntu:24.04', NODE_VERSION: '24.18.1', PNPM_VERSION: '9.15.0', PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64' };
  const fingerprint = () => run('bash', [build, '--print-recipe-fingerprint'], { env });
  const expected = text => createHash('sha256').update(`ubuntu:24.04\n24.18.1\n9.15.0\n${text.replace(/\n+$/, '')}\nlinux/amd64\n`).digest('hex');
  assert.match(shipped, /preflight_unreachable/);
  const first = fingerprint();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), expected(shipped));
  const changed = shipped.replace('preflight_unreachable=()', 'preflight_unreachable=() # changed guard');
  fs.writeFileSync(resource, changed);
  const second = fingerprint();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout.trim(), expected(changed));
  assert.notEqual(first.stdout, second.stdout);
  assert.equal(fs.readFileSync(artifact, 'utf8'), 'existing rootfs must survive a read');
  const arm = run('bash', [build, '--print-recipe-fingerprint'], {
    env: { ...env, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' },
  });
  assert.equal(arm.status, 0, arm.stderr);
  assert.notEqual(arm.stdout, second.stdout, 'the CPU architecture is part of the rootfs recipe');
  const invalid = run('bash', [build, '--print-recipe-fingerprint'], {
    env: { ...env, PAPERCUSP_RUNTIME_PLATFORM: 'windows/amd64' },
  });
  assert.notEqual(invalid.status, 0, 'an unsupported runtime platform must fail before building');
  fs.unlinkSync(resource);
  assert.notEqual(fingerprint().status, 0, 'a missing source must not fingerprint an empty recipe');
});

test('rootfs host execution preflight preserves a valid archive when emulation is unavailable', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs execution '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'docker-calls');
  fs.mkdirSync(tools);
  fs.mkdirSync(output);
  const artifact = path.join(output, 'papercup-runtime.tar.gz');
  fs.writeFileSync(artifact, 'previous verified generation');
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = run ]; then exit 1; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' } });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /cannot execute linux\/arm64.*QEMU/);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['pull', 'run']);
  assert.equal(fs.readFileSync(artifact, 'utf8'), 'previous verified generation');
  assert.deepEqual(fs.readdirSync(output), ['papercup-runtime.tar.gz']);
});

test('an executable platform reaches bootstrap/export and writes an archive-bound architecture receipt', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs export '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'docker-calls');
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = export ]; then printf "runtime fixture"; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' } });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.deepEqual(commands, ['pull', 'run', 'create', 'start', 'export', 'rm']);
  const stamp = JSON.parse(fs.readFileSync(path.join(output, '.rootfs-build-stamp'), 'utf8'));
  assert.equal(stamp.platform, 'linux/arm64');
  assert.equal(stamp.rootfsSha256, createHash('sha256').update(fs.readFileSync(path.join(output, 'papercup-runtime.tar.gz'))).digest('hex'));
});

test('voice live E2E dependencies are provisioned and preflighted before host discovery', () => {
  const marker = 'apt-get install -y --no-install-recommends \\\n';
  const start = shipped.indexOf(marker);
  assert.notEqual(start, -1, 'shipped bootstrap base-package install block is required');
  const packageBlock = shipped.slice(start + marker.length).split('\n\n', 1)[0];
  for (const packageName of ['espeak-ng', 'ffmpeg']) {
    assert.ok(
      packageBlock.split('\n').some(line => line.trim().replace(/\\$/, '').trim() === packageName),
      packageName + ' must be installed in the shipped WSL runtime',
    );
    assert.ok(
      voiceE2e.includes("command: '" + packageName + "'"),
      packageName + ' must be declared by the live E2E preflight',
    );
  }
  assert.match(voiceE2e, /preflightHostDependencies\(\);/);
  assert.match(voiceE2e, /sudo apt-get update && sudo apt-get install -y/);
  assert.ok(
    voiceE2e.indexOf('preflightHostDependencies();') < voiceE2e.indexOf('VOICE_SOCK'),
    'dependency preflight must run before socket discovery',
  );
});

test('upgrade eliminates obsolete nested npm dependencies, keeps other tools, and is idempotent', t => {
  const f = fixture(t);
  // The old overlay genuinely reproduces the native require-resolution crash.
  assert.equal(run('tar', ['-xJf', f.archive, '-C', f.prefix, '--strip-components=1']).status, 0);
  const broken = f.probe();
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /Class extends value undefined/);
  // Hold the original inode like a running process does, so an inode-number
  // reuse on a later install cannot make this assertion flaky.
  const oldNode = fs.openSync(path.join(f.prefix, 'bin/node'), 'r');
  t.after(() => fs.closeSync(oldNode));
  const oldNodeInode = fs.fstatSync(oldNode).ino;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.install();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(f.probe().status, 0);
    assert.equal(fs.existsSync(path.join(f.prefix, f.npm, 'node_modules/minipass-flush/node_modules/minipass')), false);
    assert.equal(fs.existsSync(path.join(f.prefix, f.npm, 'old-only.txt')), false);
    assert.equal(fs.readFileSync(path.join(f.prefix, 'lib/node_modules/user-tool/keep.txt'), 'utf8'), 'user-owned');
    assert.deepEqual(f.stageDirs(), []);
  }
  assert.notEqual(fs.statSync(path.join(f.prefix, 'bin/node')).ino, oldNodeInode);
});

test('private install staging never changes the shared prefix permissions', t => {
  const f = fixture(t);
  // The real bootstrap runs as root, but node is used by papercup. Copying
  // mktemp's 0700 directory metadata to /usr/local locks that user out even
  // though every root-run node/npm validation remains green.
  fs.chmodSync(f.prefix, 0o755);
  const before = fs.statSync(f.prefix);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = f.install();
    assert.equal(result.status, 0, result.stderr);
    const after = fs.statSync(f.prefix);
    assert.equal(after.mode & 0o7777, before.mode & 0o7777,
      'the prefix must not inherit the private staging directory mode');
    assert.equal(after.uid, before.uid);
    assert.equal(after.gid, before.gid);
    assert.equal(after.ino, before.ino);
    assert.equal(fs.statSync(path.join(f.prefix, 'bin/node')).mode & 0o111, 0o111);
    assert.deepEqual(f.stageDirs(), []);
  }
});

test('upgrade repairs a prefix made private by the old bootstrap', t => {
  const f = fixture(t);
  fs.chmodSync(f.prefix, 0o700);
  const result = f.install();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.statSync(f.prefix).mode & 0o7777, 0o755);
  assert.equal(f.probe().status, 0);
  assert.deepEqual(f.stageDirs(), []);
});

for (const failure of ['download', 'corrupt archive', 'invalid npm']) {
  test(`${failure} leaves the installed runtime intact`, t => {
    const f = fixture(t, { invalidNpm: failure === 'invalid npm' });
    if (failure === 'corrupt archive') fs.writeFileSync(f.archive, 'not an xz archive');
    const result = f.install(failure === 'download' ? { CURL_FAIL: '1' } : {});
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(f.prefix, 'bin/node'), 'utf8'), 'original runtime');
    assert.equal(fs.readFileSync(path.join(f.prefix, f.npm, 'old-only.txt'), 'utf8'), 'stale');
    assert.equal(fs.readFileSync(path.join(f.prefix, 'lib/node_modules/user-tool/keep.txt'), 'utf8'), 'user-owned');
    assert.deepEqual(f.stageDirs(), []);
  });
}

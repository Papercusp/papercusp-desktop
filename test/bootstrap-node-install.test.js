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
const bunHelper = fs.readFileSync(path.join(root, 'src-tauri/resources/papercup-bun-runtime.py'), 'utf8');
const voiceE2e = fs.readFileSync(
  path.join(root, '..', 'apps/tui/scripts/live-operator-voice-e2e.mjs'),
  'utf8',
);
const section = text => text.slice(text.indexOf('NODE_TARBALL='), text.indexOf('\n# The candidate stays'));
const architecture = shipped.slice(shipped.indexOf('# Runtime architecture'), shipped.indexOf('# ── network preflight'));
const overmind = shipped.slice(shipped.indexOf('# overmind is not'), shipped.indexOf('# kopia —'));
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
  write(fakebin, 'dpkg', '#!/bin/sh\nprintf "%s\\n" "${TEST_RUNTIME_ARCH:-amd64}"\n', 0o755);
  write(fakebin, 'curl', '#!/bin/sh\nif [ "${CURL_FAIL:-0}" = 1 ]; then exit 22; fi\nprintf "%s\\n" "$2" >> "$RUNTIME_DOWNLOAD_LOG"\ncat "$NODE_FIXTURE_ARCHIVE"\n', 0o755);
  const script = path.join(dir, 'install.sh');
  const body = section(shipped);
  assert.ok(body.includes('install_node_runtime /usr/local'), 'exercise the production invocation');
  fs.writeFileSync(script, 'set -euo pipefail\nNODE_VERSION=24.18.1\n' + architecture + body.replace('install_node_runtime /usr/local', 'install_node_runtime "$TEST_NODE_PREFIX"'));
  const env = { ...process.env, PATH: `${fakebin}:${process.env.PATH}`, NODE_FIXTURE_ARCHIVE: archive, TEST_NODE_PREFIX: prefix,
    RUNTIME_DOWNLOAD_LOG: path.join(dir, 'downloads') };
  return { dir, prefix, archive, npm, env, install: extra => run('bash', [script], { env: { ...env, ...extra } }),
    probe: () => run(process.execPath, [path.join(prefix, npm, 'bin/npm-cli.js')]),
    stageDirs: () => fs.readdirSync(prefix).filter(n => n.startsWith('.papercusp-node.')) };
}

for (const [guestArch, nodeArch] of [['amd64', 'x64'], ['arm64', 'arm64']]) {
  test(`guest ${guestArch} selects matching Node and Overmind downloads`, t => {
    const f = fixture(t);
    const env = { ...f.env, TEST_RUNTIME_ARCH: guestArch };
    const installed = f.install({ TEST_RUNTIME_ARCH: guestArch });
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(f.probe().status, 0);
    const binary = path.join(f.dir, 'overmind');
    const compressed = run('gzip', ['-c'], { input: '#!/bin/sh\necho overmind fixture\n', encoding: null });
    assert.equal(compressed.status, 0, compressed.stderr);
    const archive = path.join(f.dir, 'overmind.gz');
    fs.writeFileSync(archive, compressed.stdout);
    // Exercise the production URL and invocation with a local executable;
    // the caller's host architecture never participates in artifact selection.
    const result = run('bash', ['-c', 'set -euo pipefail\n' + architecture +
      overmind.replaceAll('/usr/local/bin/overmind', quote(binary)).replace('\novermind --version', '\n' + quote(binary) + ' --version')],
    { env: { ...env, NODE_FIXTURE_ARCHIVE: archive }, encoding: null });
    assert.equal(result.status, 0, String(result.stderr));
    assert.deepEqual(fs.readFileSync(env.RUNTIME_DOWNLOAD_LOG, 'utf8').trim().split('\n'), [
      `https://nodejs.org/dist/v24.18.1/node-v24.18.1-linux-${nodeArch}.tar.xz`,
      `https://github.com/DarthSim/overmind/releases/download/v2.5.1/overmind-v2.5.1-linux-${guestArch}.gz`,
    ]);
  });
}

test('unsupported guest architecture refuses before downloading or replacing Node', t => {
  const f = fixture(t);
  const result = f.install({ TEST_RUNTIME_ARCH: 'riscv64' });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /unsupported runtime architecture/);
  assert.equal(fs.existsSync(f.env.RUNTIME_DOWNLOAD_LOG), false);
  assert.equal(fs.readFileSync(path.join(f.prefix, 'bin/node'), 'utf8'), 'original runtime');
});

test('rootfs producer fingerprints the complete shipped bootstrap, including network preflight', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs recipe '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'src-tauri/resources'), { recursive: true });
  const build = path.join(dir, 'scripts/build-rootfs.sh');
  const resource = path.join(dir, 'src-tauri/resources/papercup-bootstrap.sh');
  const helperResource = path.join(dir, 'src-tauri/resources/papercup-bun-runtime.py');
  const artifact = path.join(dir, 'src-tauri/resources/papercup-runtime.tar.gz');
  fs.writeFileSync(build, producer);
  fs.writeFileSync(resource, shipped);
  fs.writeFileSync(helperResource, bunHelper);
  fs.writeFileSync(artifact, 'existing rootfs must survive a read');
  const env = { ...process.env, UBUNTU_IMAGE: 'ubuntu:24.04', NODE_VERSION: '24.18.1', PNPM_VERSION: '9.15.0', PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64' };
  const fingerprint = () => run('bash', [build, '--print-recipe-fingerprint'], { env });
  const expected = (text, helper = bunHelper) => createHash('sha256').update(`ubuntu:24.04\n24.18.1\n9.15.0\n${text.replace(/\n+$/, '')}\nlinux/amd64\n${helper.replace(/\n+$/, '')}\n`).digest('hex');
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
  const changedHelper = bunHelper.replace('VERSION = "1.3.14"', 'VERSION = "1.3.15"');
  assert.notEqual(changedHelper, bunHelper);
  fs.writeFileSync(helperResource, changedHelper);
  const helperFingerprint = fingerprint();
  assert.equal(helperFingerprint.status, 0, helperFingerprint.stderr);
  assert.equal(helperFingerprint.stdout.trim(), expected(changed, changedHelper));
  assert.notEqual(helperFingerprint.stdout, second.stdout, 'Bun input pin changes must force reprovisioning');
  fs.unlinkSync(helperResource);
  assert.notEqual(fingerprint().status, 0, 'missing Bun helper must fail closed');
  fs.writeFileSync(helperResource, bunHelper);
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
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' } });
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
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = cp ]; then\n  if [[ "$2" == *:* ]]; then printf "verified Linux ZIP fixture" > "$3"; else cp "$2" "$ROOTFS_HELPER_COPY"; fi\nfi\nif [ "$1" = create ]; then printf "%s\\n" "$@" > "$ROOTFS_CREATE_ARGS"; fi\nif [ "$1" = export ]; then printf "runtime fixture"; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    ROOTFS_HELPER_COPY: path.join(dir, 'copied-helper'), ROOTFS_CREATE_ARGS: path.join(dir, 'create-args'),
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' } });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.deepEqual(commands, ['pull', 'run', 'create', 'cp', 'start', 'cp', 'export', 'rm']);
  assert.equal(fs.readFileSync(path.join(dir, 'copied-helper'), 'utf8'), bunHelper);
  assert.match(fs.readFileSync(path.join(dir, 'create-args'), 'utf8'), /mv \/tmp\/papercup-bun-runtime\.py \/opt\/papercup\/papercup-bun-runtime\.py &&/);
  assert.match(fs.readFileSync(path.join(dir, 'create-args'), 'utf8'), /PAPERCUSP_ROOTFS_BUILD=1/);
  assert.equal(fs.readFileSync(path.join(output, 'papercup-bun-linux.zip'), 'utf8'), 'verified Linux ZIP fixture');
  const stamp = JSON.parse(fs.readFileSync(path.join(output, '.rootfs-build-stamp'), 'utf8'));
  assert.equal(stamp.platform, 'linux/arm64');
  assert.equal(stamp.rootfsSha256, createHash('sha256').update(fs.readFileSync(path.join(output, 'papercup-runtime.tar.gz'))).digest('hex'));
});

test('a failed Bun helper transfer cannot export or stamp a rootfs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs helper failure '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'docker-calls');
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = cp ]; then exit 45; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64' } });
  assert.equal(result.status, 45, result.stderr);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['pull', 'run', 'create', 'cp', 'rm']);
  assert.deepEqual(fs.readdirSync(output), []);
});

for (const [guestArch, bunArch] of [['amd64', 'x64'], ['arm64', 'arm64']]) {
  test(`WSL ${guestArch} stages and verifies a Linux Bun alongside retained Node`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap bun '));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const helper = path.join(dir, 'helper.py');
    const prefix = path.join(dir, 'prefix');
    const cache = path.join(dir, 'cache');
    const archive = path.join(dir, 'shipped Linux.zip');
    const log = path.join(dir, 'calls');
    fs.mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(prefix, 'bin/node'), 'retained Node');
    fs.writeFileSync(helper, `import json, os, pathlib, sys
args = sys.argv[1:]
with open(os.environ['BUN_FIXTURE_LOG'], 'a') as out: out.write(json.dumps(args) + '\\n')
if args[0] == os.environ.get('BUN_FIXTURE_FAIL'): sys.exit(42)
if args[0] == 'stage':
    pathlib.Path(args[args.index('--output-dir') + 1], 'bun').write_text('Linux candidate')
else:
    assert pathlib.Path(args[args.index('--binary') + 1]).read_text() == 'Linux candidate'
`);
    const bunSection = shipped.slice(shipped.indexOf('install_bun_runtime()'), shipped.indexOf('\n# pnpm'));
    const invocation = 'install_bun_runtime /opt/papercup/papercup-bun-runtime.py /usr/local /root/.cache/papercusp-bun /opt/papercup/papercup-bun-linux.zip';
    assert.ok(bunSection.includes(invocation), 'exercise production invocation');
    const script = 'set -euo pipefail\nNODE_ARCH=' + bunArch + '\n' + bunSection.replace(invocation,
      `install_bun_runtime ${quote(helper)} ${quote(prefix)} ${quote(cache)} ${quote(archive)}`);
    const env = { ...process.env, BUN_FIXTURE_LOG: log, PAPERCUSP_ROOTFS_BUILD: '0' };
    const result = run('bash', ['-c', script], { env });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls, [
      ['stage', '--target-os', 'linux', '--target-arch', bunArch, '--cache-dir', cache, '--output-dir', path.join(prefix, 'bin'), '--archive', archive],
      ['verify', '--target-os', 'linux', '--target-arch', bunArch, '--binary', path.join(prefix, 'bin/bun'), '--execute'],
    ]);
    fs.writeFileSync(log, '');
    const producerResult = run('bash', ['-c', script], { env: { ...env, PAPERCUSP_ROOTFS_BUILD: '1' } });
    assert.equal(producerResult.status, 0, producerResult.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]),
      ['stage', '--target-os', 'linux', '--target-arch', bunArch, '--cache-dir', cache, '--output-dir', path.join(prefix, 'bin'), '--archive-output', archive]);
    for (const failure of ['stage', 'verify']) {
      fs.writeFileSync(log, '');
      const rejected = run('bash', ['-c', script + '\nprintf unexpected-success'], { env: { ...env, BUN_FIXTURE_FAIL: failure } });
      assert.equal(rejected.status, 42, rejected.stderr);
      assert.doesNotMatch(rejected.stdout, /unexpected-success/);
      assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, failure === 'stage' ? 1 : 2);
    }
    assert.equal(fs.readFileSync(path.join(prefix, 'bin/node'), 'utf8'), 'retained Node');
  });
}

test('a failed Linux archive transfer cannot export a rootfs or advance the shipped input', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs archive failure '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'docker-calls');
  fs.mkdirSync(tools);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'papercup-bun-linux.zip'), 'previous shipped input');
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [[ "$1" == cp && "$2" == *:* ]]; then printf partial > "$3"; exit 46; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64' } });
  assert.equal(result.status, 46, result.stderr);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['pull', 'run', 'create', 'cp', 'start', 'cp', 'rm']);
  assert.deepEqual(fs.readdirSync(output), ['papercup-bun-linux.zip']);
  assert.equal(fs.readFileSync(path.join(output, 'papercup-bun-linux.zip'), 'utf8'), 'previous shipped input');
});

test('coalesced rootfs builds declare every environment input before Docker or output mutation', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs coalesce inputs '));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'docker-calls');
  fs.mkdirSync(tools);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'papercup-runtime.tar.gz'), 'previous verified archive');
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/sh\necho "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = run ]; then exit 1; fi\n', { mode: 0o755 });
  const keys = ['UBUNTU_IMAGE', 'NODE_VERSION', 'PNPM_VERSION', 'PAPERCUSP_RUNTIME_PLATFORM', 'PAPERCUSP_ROOTFS_OUT_DIR'];
  const env = { ...process.env, PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PC_HEAVY_ADMISSION_ID: 'fixture-rootfs-admission', PC_HEAVY_COALESCE: '1',
    PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64', PAPERCUSP_ROOTFS_OUT_DIR: output };
  const invoke = keyEnv => run('bash', [path.join(root, 'scripts/build-rootfs.sh')], {
    env: { ...env, PC_HEAVY_KEY_ENV: keyEnv },
  });
  for (const missing of keys) {
    const result = invoke(keys.filter(key => key !== missing).join(','));
    assert.equal(result.status, 2, result.stderr);
    assert.ok(result.stderr.includes(`requires ${missing} in PC_HEAVY_KEY_ENV`), result.stderr);
    assert.equal(fs.existsSync(calls), false, 'reject before contacting Docker');
    assert.equal(fs.readFileSync(path.join(output, 'papercup-runtime.tar.gz'), 'utf8'), 'previous verified archive');
  }
  const declared = invoke(keys.join(' '));
  assert.equal(declared.status, 2, declared.stderr);
  assert.match(declared.stderr, /Docker cannot execute linux\/amd64/);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['pull', 'run']);
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

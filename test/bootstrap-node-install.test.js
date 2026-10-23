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
const architecture = shipped.slice(shipped.indexOf('# Runtime architecture'), shipped.indexOf('\nNODE_VERSION='));
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
  write(fakebin, 'curl', '#!/bin/sh\nif [ "${CURL_FAIL:-0}" = 1 ]; then exit 22; fi\nprintf "%s\\n" "$2" >> "$RUNTIME_DOWNLOAD_LOG"\nif [ "${3:-}" = -o ]; then cp "$NODE_FIXTURE_ARCHIVE" "$4"; else cat "$NODE_FIXTURE_ARCHIVE"; fi\n', 0o755);
  const script = path.join(dir, 'install.sh');
  const inputs = path.join(dir, 'inputs');
  fs.mkdirSync(inputs);
  const body = section(shipped);
  assert.ok(body.includes('install_node_runtime /usr/local'), 'exercise the production invocation');
  fs.writeFileSync(script, 'set -euo pipefail\nNODE_VERSION=24.18.1\n' + architecture + body.replace('install_node_runtime /usr/local', 'install_node_runtime "$TEST_NODE_PREFIX"'));
  const env = { ...process.env, PATH: `${fakebin}:${process.env.PATH}`, NODE_FIXTURE_ARCHIVE: archive, TEST_NODE_PREFIX: prefix,
    PAPERCUSP_ROOTFS_BUILD: '1', OFFLINE_INPUTS: inputs,
    RUNTIME_DOWNLOAD_LOG: path.join(dir, 'downloads') };
  return { dir, prefix, archive, npm, env, install: extra => run('bash', [script], { env: { ...env, ...extra } }),
    probe: () => run(process.execPath, [path.join(prefix, npm, 'bin/npm-cli.js')]),
    stageDirs: () => fs.readdirSync(prefix).filter(n => n.startsWith('.papercusp-node.')) };
}

// Run the complete shipped script against a sandbox filesystem. Package
// mutation and Bun staging are explicit stand-ins; shell/extraction/checksums,
// Node/npm replacement and retained home files are real. Network commands fail.
function offlineFixture(t, existing = true) {
  const f = fixture(t);
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-offline-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const inputs = path.join(sandbox, 'opt/papercup/offline-inputs');
  const tools = path.join(f.dir, 'offline-tools');
  const log = path.join(f.dir, 'offline-calls');
  const write = (relative, text, mode) => {
    const p = path.join(sandbox, relative);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, { mode });
  };
  fs.mkdirSync(path.join(inputs, 'debs'), { recursive: true });
  fs.mkdirSync(tools);
  fs.mkdirSync(path.join(sandbox, 'usr/local'), { recursive: true });
  fs.cpSync(f.prefix, path.join(sandbox, 'usr/local'), { recursive: true });
  fs.copyFileSync(f.archive, path.join(inputs, 'node.tar.xz'));
  const gz = run('gzip', ['-c'], { input: '#!/bin/sh\necho overmind fixture\n', encoding: null });
  assert.equal(gz.status, 0, String(gz.stderr));
  fs.writeFileSync(path.join(inputs, 'overmind.gz'), gz.stdout);
  fs.writeFileSync(path.join(inputs, 'pnpm.tgz'), 'npm package fixture');
  fs.writeFileSync(path.join(inputs, 'manifest'), 'ubuntu=24.04\narch=amd64\nnode=24.18.1\npnpm=9.15.0\n');
  // A genuine Debian archive exercises dpkg-deb's pre-mutation validation.
  const deb = path.join(f.dir, 'deb/DEBIAN');
  fs.mkdirSync(deb, { recursive: true });
  fs.writeFileSync(path.join(deb, 'control'), 'Package: offline-fixture\nVersion: 1.0\nArchitecture: all\nMaintainer: Test <test@example.invalid>\nDescription: Offline fixture\n');
  const packed = run('dpkg-deb', ['--build', path.dirname(deb), path.join(inputs, 'debs/offline-fixture_1.0_all.deb')]);
  assert.equal(packed.status, 0, packed.stderr);
  const seal = () => {
    const files = fs.readdirSync(inputs).filter(n => n !== 'SHA256SUMS' && n !== 'debs')
      .concat(fs.readdirSync(path.join(inputs, 'debs')).map(n => 'debs/' + n)).sort();
    fs.writeFileSync(path.join(inputs, 'SHA256SUMS'), files.map(n =>
      createHash('sha256').update(fs.readFileSync(path.join(inputs, n))).digest('hex') + '  ' + n + '\n').join(''));
  };
  seal();
  write('etc/os-release', 'ID=ubuntu\nVERSION_ID=24.04\n');
  if (existing) write('home/papercup/papercup/workspace/data', 'user work must survive');
  const exe = (name, body) => fs.writeFileSync(path.join(tools, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o755 });
  exe('dpkg', 'echo amd64\n');
  exe('id', existing ? 'exit 0\n' : 'test -f "$OFFLINE_TEST_USER"\n');
  exe('useradd', 'echo useradd >> "$OFFLINE_TEST_LOG"\ntouch "$OFFLINE_TEST_USER"\n');
  exe('chown', 'echo "chown $*" >> "$OFFLINE_TEST_LOG"\n');
  exe('apt-get', 'echo "apt-get $*" >> "$OFFLINE_TEST_LOG"\nif [[ "$1" != clean ]]; then\n [[ " $* " == *" --no-download "* && " $* " == *" --no-remove "* ]] || exit 91\n [[ "${OFFLINE_TEST_APT_FAIL:-0}" != 1 ]] || exit 92\nfi\n');
  exe('curl', 'echo UNEXPECTED_NETWORK >> "$OFFLINE_TEST_LOG"\nexit 93\n');
  exe('npm', 'echo "npm $*" >> "$OFFLINE_TEST_LOG"\nif [[ "$1" == install ]]; then [[ " $* " == *" --offline "* ]] || exit 94; fi\n');
  exe('pnpm', 'echo 9.15.0\n');
  exe('kopia', 'echo kopia fixture\n');
  exe('python3', 'echo "BUN_STAGING_STAND_IN $*" >> "$OFFLINE_TEST_LOG"\n');
  let body = shipped;
  for (const absolute of ['/opt/papercup', '/usr/local', '/home/', '/etc/', '/usr/share/', '/root/', '/var/lib/apt/', '/tmp/node-compile-cache']) {
    body = body.replaceAll(absolute, sandbox + absolute);
  }
  const script = path.join(f.dir, 'offline-bootstrap.sh');
  fs.writeFileSync(script, body);
  const env = { ...process.env, PATH: `${tools}:${sandbox}/usr/local/bin:${process.env.PATH}`,
    PAPERCUSP_ROOTFS_BUILD: '0', OFFLINE_TEST_LOG: log, OFFLINE_TEST_USER: path.join(f.dir, 'user-created') };
  return { sandbox, inputs, log, seal, run: (args = [], extra = {}) => run('bash', [script, ...args], { env: { ...env, ...extra } }) };
}

for (const existing of [false, true]) {
  test(`complete offline bootstrap ${existing ? 'upgrades an existing distro and retains workspace data' : 'configures a fresh distro'}`, t => {
    const f = offlineFixture(t, existing);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /papercup bootstrap complete/);
    const log = fs.readFileSync(f.log, 'utf8');
    assert.doesNotMatch(log, /UNEXPECTED_NETWORK|apt-get update|npm pack/);
    assert.match(log, /apt-get --simulate --no-download --no-remove install .*offline-fixture_1.0_all.deb/);
    assert.match(log, /apt-get --no-download --no-remove -y .*install /);
    assert.match(log, /npm install --offline --ignore-scripts --no-audit --no-fund -g /);
    assert.match(log, /BUN_STAGING_STAND_IN .*--archive .*papercup-bun-linux.zip/);
    assert.doesNotMatch(log, /chown -R/);
    assert.equal(fs.readFileSync(path.join(f.sandbox, 'usr/local/lib/node_modules/user-tool/keep.txt'), 'utf8'), 'user-owned');
    assert.equal(fs.existsSync(path.join(f.sandbox, 'usr/local/lib/node_modules/npm/old-only.txt')), false);
    if (existing) assert.equal(fs.readFileSync(path.join(f.sandbox, 'home/papercup/papercup/workspace/data'), 'utf8'), 'user work must survive');
    const repeated = f.run();
    assert.equal(repeated.status, 0, 'the full offline bootstrap is idempotent: ' + repeated.stderr);
  });
}

for (const damage of ['missing', 'changed', 'unlisted', 'wrong-arch', 'wrong-os', 'symlink', 'resolver']) {
  test(`offline ${damage} input refuses before distro configuration`, t => {
    const f = offlineFixture(t);
    if (damage === 'missing') fs.unlinkSync(path.join(f.inputs, 'node.tar.xz'));
    if (damage === 'changed') fs.appendFileSync(path.join(f.inputs, 'pnpm.tgz'), 'bad');
    if (damage === 'unlisted') fs.writeFileSync(path.join(f.inputs, 'unexpected'), 'bad');
    if (damage === 'wrong-arch') {
      fs.writeFileSync(path.join(f.inputs, 'manifest'), 'ubuntu=24.04\narch=arm64\nnode=24.18.1\npnpm=9.15.0\n'); f.seal();
    }
    if (damage === 'wrong-os') fs.writeFileSync(path.join(f.sandbox, 'etc/os-release'), 'ID=ubuntu\nVERSION_ID=22.04\n');
    if (damage === 'symlink') {
      fs.renameSync(path.join(f.inputs, 'pnpm.tgz'), path.join(f.sandbox, 'external'));
      fs.symlinkSync(path.join(f.sandbox, 'external'), path.join(f.inputs, 'pnpm.tgz'));
    }
    const result = f.run([], damage === 'resolver' ? { OFFLINE_TEST_APT_FAIL: '1' } : {});
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    const log = fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8') : '';
    assert.doesNotMatch(log, /UNEXPECTED_NETWORK|useradd|chown|npm |BUN_STAGING|apt-get --no-download/);
    assert.equal(fs.existsSync(path.join(f.sandbox, 'etc/wsl.conf')), false);
    assert.equal(fs.readFileSync(path.join(f.sandbox, 'usr/local/bin/node'), 'utf8'), 'original runtime');
    assert.equal(fs.readFileSync(path.join(f.sandbox, 'home/papercup/papercup/workspace/data'), 'utf8'), 'user work must survive');
  });
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
      overmind.replaceAll('/usr/local/bin/.overmind.XXXXXX', path.join(f.dir, '.overmind.XXXXXX'))
        .replaceAll('/usr/local/bin/overmind', quote(binary)).replace('\novermind --version', '\n' + quote(binary) + ' --version')],
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
  // Only the published checksum is substituted. Run the real producer and
  // helper against deterministic input bytes without Docker or network access.
  const archive = 'verified Linux ZIP fixture';
  const archiveSha = createHash('sha256').update(archive).digest('hex');
  const resources = path.join(dir, 'src-tauri/resources');
  const script = path.join(dir, 'scripts/build-rootfs.sh');
  fs.mkdirSync(resources, { recursive: true });
  fs.mkdirSync(path.dirname(script));
  fs.mkdirSync(path.join(dir, 'bin/lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'bin/lib/portable-sha256.sh'), path.join(dir, 'bin/lib/portable-sha256.sh'));
  fs.writeFileSync(script, producer);
  fs.writeFileSync(path.join(resources, 'papercup-bootstrap.sh'), shipped);
  fs.writeFileSync(path.join(resources, 'papercup-bun-runtime.py'), bunHelper.replace(
    'a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b', archiveSha));
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nprintf "%s\\n" "$1" >> "$DOCKER_PREFLIGHT_LOG"\nif [ "$1" = cp ]; then\n  if [[ "$2" == *:* ]]; then printf "%s" "$ROOTFS_TEST_ARCHIVE" > "$3"; else cp "$2" "$ROOTFS_HELPER_COPY"; fi\nfi\nif [ "$1" = create ]; then printf "%s\\n" "$@" > "$ROOTFS_CREATE_ARGS"; fi\nif [ "$1" = export ]; then printf "runtime fixture"; fi\n', { mode: 0o755 });
  const env = { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    ROOTFS_HELPER_COPY: path.join(dir, 'copied-helper'), ROOTFS_CREATE_ARGS: path.join(dir, 'create-args'),
    ROOTFS_TEST_ARCHIVE: archive,
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/arm64' };
  const result = run('bash', [script], { env });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(calls, 'utf8').trim().split('\n');
  assert.deepEqual(commands, ['pull', 'run', 'create', 'cp', 'start', 'commit', 'run', 'cp', 'export', 'rm', 'image']);
  assert.equal(fs.readFileSync(path.join(dir, 'copied-helper'), 'utf8'), bunHelper.replace(
    'a27ffb63a8310375836e0d6f668ae17fa8d8d18b88c37c821c65331973a19a3b', archiveSha));
  assert.match(fs.readFileSync(path.join(dir, 'create-args'), 'utf8'), /mv \/tmp\/papercup-bun-runtime\.py \/opt\/papercup\/papercup-bun-runtime\.py &&/);
  assert.match(fs.readFileSync(path.join(dir, 'create-args'), 'utf8'), /PAPERCUSP_ROOTFS_BUILD=1/);
  assert.equal(fs.readFileSync(path.join(output, 'papercup-bun-linux.zip'), 'utf8'), 'verified Linux ZIP fixture');
  const stamp = JSON.parse(fs.readFileSync(path.join(output, '.rootfs-build-stamp'), 'utf8'));
  assert.equal(stamp.platform, 'linux/arm64');
  assert.equal(stamp.rootfsSha256, createHash('sha256').update(fs.readFileSync(path.join(output, 'papercup-runtime.tar.gz'))).digest('hex'));
  assert.equal(stamp.bunArchiveSha256, archiveSha);
  const before = fs.readFileSync(calls, 'utf8');
  const verified = run('bash', [script, '--verify-artifacts'], { env });
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).bunArchiveSha256, archiveSha);
  assert.equal(fs.readFileSync(calls, 'utf8'), before, 'read-only verification never calls Docker');
  const zip = path.join(output, 'papercup-bun-linux.zip');
  fs.writeFileSync(zip, 'changed input');
  const rejected = run('bash', [script, '--verify-artifacts'], { env });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /checksum/);
  fs.writeFileSync(zip, archive);
  const failedBuild = run('bash', [script], { env: { ...env, ROOTFS_TEST_ARCHIVE: 'changed input' } });
  assert.notEqual(failedBuild.status, 0);
  assert.match(failedBuild.stderr, /checksum/);
  assert.equal(fs.readFileSync(zip, 'utf8'), archive, 'a changed Docker export never replaces the previous shipped input');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, '.rootfs-build-stamp'), 'utf8')), stamp);
  assert.equal(fs.existsSync(path.join(output, 'papercup-runtime.tar.gz')), false, 'a failed generation cannot leave an accepted rootfs');
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
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n'), ['pull', 'run', 'create', 'cp', 'start', 'commit', 'run', 'cp', 'rm', 'image']);
  assert.deepEqual(fs.readdirSync(output), ['papercup-bun-linux.zip']);
  assert.equal(fs.readFileSync(path.join(output, 'papercup-bun-linux.zip'), 'utf8'), 'previous shipped input');
});

test('a failed network-disabled full bootstrap prevents rootfs export and recipe publication', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rootfs-offline-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const tools = path.join(dir, 'tools');
  const output = path.join(dir, 'output');
  const calls = path.join(dir, 'calls');
  fs.mkdirSync(tools);
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'papercup-rootfs-recipe'), 'previous recipe');
  fs.writeFileSync(path.join(tools, 'docker'), '#!/bin/bash\nset -eu\nif [[ "$1" == create ]]; then echo create >> "$DOCKER_PREFLIGHT_LOG"; else printf "%s\\n" "$*" >> "$DOCKER_PREFLIGHT_LOG"; fi\nif [[ " $* " == *" --network none "* ]]; then exit 47; fi\n', { mode: 0o755 });
  const result = run('bash', [path.join(root, 'scripts/build-rootfs.sh')], { env: { ...process.env,
    PATH: tools + ':' + process.env.PATH, DOCKER_PREFLIGHT_LOG: calls,
    PC_HEAVY_COALESCE: '0', PAPERCUSP_ROOTFS_OUT_DIR: output, PAPERCUSP_RUNTIME_PLATFORM: 'linux/amd64' } });
  assert.equal(result.status, 47, result.stderr);
  const log = fs.readFileSync(calls, 'utf8');
  assert.match(log, /run --rm --network none --platform linux\/amd64 .*env -u PAPERCUSP_ROOTFS_BUILD bash \/opt\/papercup\/bootstrap/);
  assert.doesNotMatch(log, /^export /m);
  assert.match(log, /^image rm -f papercup-runtime-offline-smoke:/m);
  assert.deepEqual(fs.readdirSync(output), ['papercup-rootfs-recipe']);
  assert.equal(fs.readFileSync(path.join(output, 'papercup-rootfs-recipe'), 'utf8'), 'previous recipe');
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

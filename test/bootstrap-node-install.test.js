const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const producer = fs.readFileSync(path.join(root, 'scripts/build-rootfs.sh'), 'utf8');
const shipped = fs.readFileSync(path.join(root, 'src-tauri/resources/papercup-bootstrap.sh'), 'utf8');
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

test('rootfs producer and shipped bootstrap use the same Node installation logic', () => {
  assert.equal(section(producer), section(shipped));
});

test('upgrade eliminates obsolete nested npm dependencies, keeps other tools, and is idempotent', t => {
  const f = fixture(t);
  // The old overlay genuinely reproduces the native require-resolution crash.
  assert.equal(run('tar', ['-xJf', f.archive, '-C', f.prefix, '--strip-components=1']).status, 0);
  const broken = f.probe();
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /Class extends value undefined/);
  const oldNodeInode = fs.statSync(path.join(f.prefix, 'bin/node')).ino;
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

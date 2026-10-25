// Independent P537 helper oracle. These synthetic packages prove closure and
// donor isolation, not native ABI, PRIMARY startup, or release readiness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const repo = path.dirname(desktop);
const closure = path.join(desktop, 'bin/lib/host-runtime-closure.sh');
const common = path.join(repo, 'apps/operator/bin/bundle-host-common.sh');
const builder = path.join(desktop, 'bin/build-private-host.sh');
let fixtureMembers = 0;
let fixtureBytes = 0;

function inventory(root) {
  const rows = [];
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    const mode = stat.mode & 0o777;
    if (stat.isSymbolicLink()) rows.push([relative, mode, 'link', fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      rows.push([relative, mode, 'dir']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), path.join(relative, name));
    } else {
      assert.ok(stat.isFile(), `unexpected fixture member: ${relative}`);
      rows.push([relative, mode, 'file', stat.size,
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    }
  }
  visit(root, '.');
  return rows;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p537-independent-'));
  const donor = path.join(root, 'donor');
  const output = path.join(root, 'output');
  fs.mkdirSync(path.join(donor, 'apps/operator'), { recursive: true });
  fs.mkdirSync(path.join(output, 'node_modules'), { recursive: true });
  t.after(() => {
    try {
      const rows = inventory(root);
      fixtureMembers += rows.length;
      fixtureBytes += rows.reduce((n, row) => n + (row[2] === 'file' ? row[3] : 0), 0);
      assert.ok(fixtureMembers <= 256, 'oracle fixtures exceeded 256 total members');
      assert.ok(fixtureBytes <= 10 * 1024 * 1024, 'oracle fixtures exceeded 10 MiB total');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  return { root, donor, output };
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function packageAt(root, name, manifest, source) {
  const dir = path.join(root, 'node_modules', name);
  write(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...manifest }));
  write(path.join(dir, 'index.js'), source || 'module.exports = true;');
  return dir;
}

function child(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024,
    ...options,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', ...options.env },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.signal, null, `child signalled: ${result.signal}`);
  return result;
}

function run(f, program) {
  return child('bash', ['-c', [
    'set -euo pipefail', 'source "$ORACLE_CLOSURE"',
    'REPO_ROOT="$ORACLE_DONOR"; WEB_DIR="$REPO_ROOT/apps/operator"; ROOT="$REPO_ROOT/papercusp-desktop"',
    'SIDECAR_DIR="$ORACLE_OUTPUT"; TARGET_OS=linux; TARGET_ARCH=x64',
    '_bare_node_platform=linux; _bare_node_arch=x64; nat_copied=0; nat_missing=0; _seen="|"',
    'HOST_CLOSURE_INPUT_LOG="$SIDECAR_DIR/copied-inputs.tsv"', program,
  ].join('\n')], { env: { ORACLE_CLOSURE: closure, ORACLE_DONOR: f.donor, ORACLE_OUTPUT: f.output } });
}

function succeeded(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function loadWithoutDonor(f, name) {
  fs.renameSync(f.donor, path.join(f.root, 'unavailable-donor'));
  const loaded = child(process.execPath, ['-e', 'console.log(JSON.stringify(require(process.argv[1])))',
    './node_modules/' + name], { cwd: f.output });
  succeeded(loaded);
  return JSON.parse(loaded.stdout);
}

test('P537 independent: nested requester traversal copies its hoisted leaf and preserves both versions', t => {
  const f = fixture(t);
  packageAt(f.donor, 'worker', { version: '9.0.0' }, "module.exports = 'outer';");
  const entry = packageAt(f.donor, 'entry', { dependencies: { worker: '*' } },
    "module.exports = require('worker');");
  packageAt(entry, 'worker', { version: '2.0.0', dependencies: { '@oracle/leaf': '*' } },
    "module.exports = 'inner:' + require('@oracle/leaf');");
  packageAt(f.donor, '@oracle/leaf', {}, "module.exports = 'leaf';");
  const before = inventory(f.donor);
  succeeded(run(f, 'copy_pkg_closure worker\ncopy_pkg_closure entry'));
  assert.deepEqual(inventory(f.donor), before, 'closure copier changed donor bytes, topology, or permissions');
  assert.ok(fs.existsSync(path.join(f.output, 'node_modules/@oracle/leaf/index.js')),
    'nested requester dependency must be traversed even when its package was copied with its parent');
  for (const [relative, version] of [['worker', '9.0.0'], ['entry/node_modules/worker', '2.0.0']]) {
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.output, 'node_modules', relative, 'package.json'))).version, version);
  }
  succeeded(run(f, 'assert_runtime_dependency_closure "$SIDECAR_DIR"'));
  const copied = fs.readFileSync(path.join(f.output, 'copied-inputs.tsv'), 'utf8');
  assert.ok(copied.split('\n').some(line => line.endsWith('/node_modules/@oracle/leaf')));
  assert.equal(loadWithoutDonor(f, 'entry'), 'inner:leaf');
});

test('P537 independent: present optional native payload survives, foreign payload is pruned, absent optional stays optional', t => {
  const f = fixture(t);
  packageAt(f.donor, 'consumer', { optionalDependencies: { 'oracle-native': '*', 'oracle-absent-platform': '*' } },
    "module.exports = require('oracle-native');");
  const addon = packageAt(f.donor, 'oracle-native', {},
    "module.exports = require('node:fs').readFileSync(require('node:path').join(__dirname, 'prebuilds/linux-x64/payload.node'), 'utf8');");
  write(path.join(addon, 'prebuilds/linux-x64/payload.node'), 'target-payload-sentinel');
  write(path.join(addon, 'prebuilds/darwin-arm64/payload.node'), 'foreign-payload-sentinel');
  const before = inventory(f.donor);
  succeeded(run(f, 'copy_pkg_closure consumer\n(( nat_missing == 0 ))'));
  assert.deepEqual(inventory(f.donor), before, 'optional/native copy or pruning changed donor');
  const target = path.join(f.output, 'node_modules/oracle-native/prebuilds');
  assert.ok(fs.existsSync(path.join(target, 'linux-x64/payload.node')),
    'present optional native package must be traversed and copied');
  assert.equal(fs.readFileSync(path.join(target, 'linux-x64/payload.node'), 'utf8'), 'target-payload-sentinel');
  assert.equal(fs.existsSync(path.join(target, 'darwin-arm64')), false);
  assert.equal(fs.existsSync(path.join(f.output, 'node_modules/oracle-absent-platform')), false);
  succeeded(run(f, 'assert_runtime_dependency_closure "$SIDECAR_DIR"'));
  assert.equal(loadWithoutDonor(f, 'consumer'), 'target-payload-sentinel');
});

test('P537 independent: missing required and malformed packages fail the assembled closure audit', t => {
  const f = fixture(t);
  packageAt(f.donor, 'required-root', { dependencies: { 'oracle-required-missing': '*' } });
  let result = run(f, 'copy_pkg_closure required-root\nassert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required-root@1\.0\.0 -> oracle-required-missing/);
  fs.rmSync(path.join(f.output, 'node_modules/required-root'), { recursive: true });
  const malformed = packageAt(f.donor, 'malformed-root', {});
  write(path.join(malformed, 'package.json'), '{invalid json');
  result = run(f, 'copy_pkg_closure malformed-root\nassert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed-root -> invalid package\.json/);
});

test('P537 independent: assembled audit rejects package and dependency symlinks escaping to donor', t => {
  const f = fixture(t);
  const outside = packageAt(f.donor, 'outside', {});
  const before = inventory(f.donor);
  fs.symlinkSync(outside, path.join(f.output, 'node_modules/escape'), 'dir');
  let result = run(f, 'assert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package symlink escapes assembled root/);
  fs.rmSync(path.join(f.output, 'node_modules/escape'));
  const owner = packageAt(f.output, 'owner', { dependencies: { outside: '*' } });
  fs.mkdirSync(path.join(owner, 'node_modules'));
  fs.symlinkSync(outside, path.join(owner, 'node_modules/outside'), 'dir');
  result = run(f, 'assert_runtime_dependency_closure "$SIDECAR_DIR"');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dependency symlink escapes assembled root/);
  assert.deepEqual(inventory(f.donor), before);
});

test('P537 independent: private builder refuses existing, donor-contained, and aliased output before allocating', t => {
  const f = fixture(t);
  const alias = path.join(f.root, 'donor-alias');
  fs.symlinkSync(f.donor, alias, 'dir');
  const before = inventory(f.donor);
  for (const output of [f.output, path.join(f.donor, 'forbidden-run'), path.join(alias, 'alias-run')]) {
    const result = child('bash', [builder, f.donor, output]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fresh with canonical parent|private run overlaps donor/);
  }
  assert.deepEqual(inventory(f.donor), before);
});

test('P537 independent: graph classification keeps optional peers separate and mandatory occurrences win', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.donor, 'node_modules'), { recursive: true });
  fs.symlinkSync(path.join(repo, 'node_modules/typescript'), path.join(f.donor, 'node_modules/typescript'), 'dir');
  const plugin = packageAt(f.donor, 'plugin', {
    peerDependencies: { 'oracle-optional': '*' }, peerDependenciesMeta: { 'oracle-optional': { optional: true } },
  }, "require('oracle-optional'); require('@oracle/required/subpath');");
  write(path.join(f.donor, 'entry.js'), "require('oracle-optional');");
  const runRoot = path.join(f.root, 'graph');
  fs.mkdirSync(path.join(runRoot, 'artifact'), { recursive: true });
  const edge = value => ({ path: value, external: true, kind: 'require-call' });
  const inputs = { 'node_modules/plugin/index.js': { imports: [edge('oracle-optional'), edge('@oracle/required/subpath'), edge('node:fs')] } };
  const meta = path.join(runRoot, 'artifact/serve.mjs.meta.json');
  const census = () => {
    write(meta, JSON.stringify({ inputs, outputs: { 'serve.mjs': { imports: [] } } }));
    const result = run(f, 'write_host_graph_dependency_census ' + JSON.stringify(runRoot));
    succeeded(result);
    return result.stdout;
  };
  const before = inventory(f.donor);
  assert.match(census(), /^optional\toracle-optional$/m);
  assert.match(census(), /^required\t@oracle\/required$/m);
  inputs['entry.js'] = { imports: [edge('oracle-optional')] };
  assert.match(census(), /^required\toracle-optional$/m);
  assert.doesNotMatch(census(), /node:fs/);
  assert.deepEqual(inventory(f.donor), before);
  assert.ok(fs.existsSync(path.join(plugin, 'index.js')));
});

test('P537 independent: production and private callers share executable compiler and closure boundaries', t => {
  const f = fixture(t);
  const record = path.join(f.root, 'compiler-args');
  const result = child('bash', ['-c', [
    'set -euo pipefail', 'source "$ORACLE_COMMON"',
    // Compiler stand-in records recipe arguments only; it is not runtime proof.
    'bundle_host_esbuild() { printf "%s\\n" "$*" >> "$ORACLE_RECORD"; for arg in "$@"; do case "$arg" in --outfile=*) printf "export {};\\n" > "${arg#--outfile=}";; esac; done; }',
    'node() { :; }',
    'bundle_host_primary "$ORACLE_DONOR" "$ORACLE_OUTPUT" --define:__PAPERCUSP_BUNDLED_SIDECAR__=true',
    'bundle_host_launcher "$ORACLE_DONOR" "$ORACLE_OUTPUT/psu.mjs" psu-launcher',
  ].join('\n')], { env: { ORACLE_COMMON: common, ORACLE_DONOR: f.donor, ORACLE_OUTPUT: f.output, ORACLE_RECORD: record } });
  succeeded(result);
  const [primary, launcher] = fs.readFileSync(record, 'utf8').trim().split('\n');
  assert.ok(primary.includes('/apps/operator/bin/serve.ts'));
  assert.ok(primary.includes('--define:__PAPERCUSP_BUNDLED_SIDECAR__=true'));
  assert.ok(primary.includes('--banner:js='));
  assert.ok(launcher.includes('/apps/operator/scripts/psu-launcher.mjs'));
  assert.ok(launcher.includes('--external:@lydell/*'));
  assert.ok(!launcher.includes('--define:__PAPERCUSP_BUNDLED_SIDECAR__=true'));
  for (const caller of ['build-private-host.sh', 'build-desktop-sidecar.sh']) {
    const source = fs.readFileSync(path.join(desktop, 'bin', caller), 'utf8');
    assert.match(source, /^source "\$HERE\/lib\/host-runtime-closure\.sh"$/m);
    assert.match(source, /^bundle_host_primary "\$REPO_ROOT" "\$SIDECAR_DIR"/m);
    assert.match(source, /^\s*bundle_host_launcher "\$REPO_ROOT"/m);
    assert.match(source, /^\s*assert_runtime_dependency_closure "\$SIDECAR_DIR"/m);
  }
});

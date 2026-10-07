'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const desktop = path.resolve(__dirname, '..');
const source = fs.readFileSync(process.env.BUILD_LINUX_FINALIZATION_SCRIPT
  || path.join(desktop, 'bin/build-linux-local.sh'), 'utf8');
function shellFunction(name) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `missing ${name}`);
  return source.slice(start, end + 3);
}
const start = source.indexOf('if [[ "${1:-}" == --finalize-deb ]]');
const end = source.indexOf('\ncase "${PAPERCUSP_REUSE_SIDECAR', start);
assert.ok(start >= 0 && end > start);
const dispatch = source.slice(start, end);
const functions = [shellFunction('assert_vm_release_deb_runtime_only'),
  shellFunction('finalize_existing_vm_release_deb')].join('\n');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function fixture(t, { role = 'papercusp-server', version = '0.0.26', forbidden = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-finalize-'));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const tree = path.join(root, 'payload');
  const tauri = path.join(root, 'src-tauri');
  const sidecar = path.join(tauri, 'sidecar');
  const here = path.join(root, 'helpers');
  for (const dir of [path.join(tree, 'DEBIAN'), path.join(tree, 'usr/bin'), sidecar, here]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(tree, 'DEBIAN/control'),
    `Package: ${role}\nVersion: ${version}\nArchitecture: amd64\nMaintainer: fixture <fixture@example.invalid>\nDescription: fixture\n`);
  fs.writeFileSync(path.join(tree, 'usr/bin/server'), 'fixture-runtime');
  if (forbidden) {
    fs.mkdirSync(path.join(tree, 'usr/share/papercusp/seed'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'usr/share/papercusp/seed/private'), 'fixture');
  }
  const deb = path.join(root, 'server.deb');
  const built = spawnSync('dpkg-deb', ['--build', tree, deb], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  // Real ED (prehashed Ed25519) Tauri signature; only the expensive repack and
  // external privacy/license/provenance subprocesses are fixtures below.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const rawPublic = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const keyId = Buffer.from('12345678');
  const block = Buffer.concat([Buffer.from('ED'), keyId, rawPublic]);
  const pubkey = Buffer.from(`untrusted comment: minisign public key\n${block.toString('base64')}\n`).toString('base64');
  const digest = crypto.createHash('blake2b512').update(fs.readFileSync(deb)).digest();
  const signed = Buffer.concat([Buffer.from('ED'), keyId, crypto.sign(null, digest, privateKey)]);
  fs.writeFileSync(`${deb}.sig`, Buffer.from(`untrusted comment: signature\n${signed.toString('base64')}\n`).toString('base64'));
  fs.writeFileSync(path.join(tauri, 'tauri.conf.json'), JSON.stringify({ plugins: { updater: { pubkey } } }));
  const sourceSha = 'a'.repeat(40);
  const provenance = path.join(sidecar, 'build-provenance.json');
  fs.writeFileSync(provenance, JSON.stringify({ gitHead: sourceSha, gitDirty: false, version: '0.0.26' }));
  const receipt = path.join(root, 'input.json');
  const data = {
    kind: 'linux-completed-package-finalization-input/v1', profile: 'vm-release',
    version: '0.0.26', sourceSha,
    artifact: { path: deb, sha256: sha(deb), signatureSha256: sha(`${deb}.sig`) },
    sidecarBuildProvenanceSha256: sha(provenance),
  };
  fs.writeFileSync(receipt, JSON.stringify(data));
  fs.copyFileSync(path.join(desktop, 'bin/verify-tauri-signature.mjs'), path.join(here, 'verify-tauri-signature.mjs'));
  fs.writeFileSync(path.join(here, 'audit-release-bundle.py'),
    "import os,sys\nwith open(os.environ['CALL_LOG'],'a') as f:f.write('audit '+','.join(sys.argv[1:])+'\\n')\n");
  fs.writeFileSync(path.join(here, 'repack-deb-xz.sh'), [
    'set -euo pipefail', 'echo repack >> "$CALL_LOG"',
    'if [[ "${REPACK_FAIL:-0}" == 1 ]]; then exit 9; fi',
    'if [[ "${REPACK_STALE_SIGNATURE:-0}" == 1 ]]; then',
    '  printf mutated-runtime > "$PAYLOAD/usr/bin/server"',
    '  dpkg-deb --build "$PAYLOAD" "$1" >/dev/null', 'fi',
  ].join('\n'));
  fs.writeFileSync(path.join(here, 'emit-build-provenance.sh'),
    'printf "provenance %s\\n" "$*" >> "$CALL_LOG"\n');
  return { root, tree, tauri, here, deb, receipt, data, provenance,
    log: path.join(root, 'calls') };
}

function run(f, env = {}, args = ['--finalize-deb', f.deb, f.receipt]) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail', functions, dispatch,
    'echo unexpected-full-build >> "$CALL_LOG"; exit 99',
  ].join('\n'), 'fixture', ...args], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, ROOT: f.root, HERE: f.here, VERSION: '0.0.26',
      DISTRIBUTION_PROFILE: 'vm-release', KEY_FILE: path.join(f.root, 'fixture-key'),
      PAPERCUSP_BUILD_LINUX_SNAPSHOT_DIR: f.root, CALL_LOG: f.log, PAYLOAD: f.tree, ...env },
  });
}
function calls(f) { return fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').split('\n').filter(Boolean) : []; }
function update(f, change) {
  change(f.data); fs.writeFileSync(f.receipt, JSON.stringify(f.data));
}

test('exact signed Server input runs only finalization with real initial/final signature guards', t => {
  const f = fixture(t);
  const before = sha(f.deb);
  const result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(sha(f.deb), before);
  assert.deepEqual(calls(f).map(line => line.split(' ')[0]), ['audit', 'repack', 'audit', 'provenance']);
  assert.match(calls(f).at(-1), /0\.0\.26 a{40} true/);
  assert.ok(result.stdout.indexOf('phase=input-signature') < result.stdout.indexOf('phase=repack-and-sign'));
  assert.ok(result.stdout.indexOf('phase=final-signature') < result.stdout.indexOf('phase=provenance'));
});

test('changed artifact, signature, provenance and receipt identity refuse before repack', t => {
  for (const mutate of [
    f => fs.appendFileSync(f.deb, 'changed'),
    f => fs.appendFileSync(`${f.deb}.sig`, 'changed'),
    f => fs.appendFileSync(f.provenance, 'changed'),
    f => update(f, r => { r.sourceSha = 'invalid'; }),
    f => update(f, r => { r.version = '0.0.25'; }),
    f => update(f, r => { r.artifact.path = `${f.deb}.other`; }),
  ]) {
    const f = fixture(t); mutate(f);
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls(f), []);
  }
});

test('split-root finalization audits use the product superproject and preserve an explicit root', t => {
  for (const override of ['', '/explicit-product-superproject']) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.here, 'audit-release-bundle.py'), [
      'import os,sys',
      "actual=os.path.realpath(os.environ.get('PAPERCUSP_REPO_ROOT',''))",
      "expected=os.path.realpath(os.environ['EXPECTED_AUDIT_REPO'])",
      "assert actual==expected,(actual,expected)",
      "with open(os.environ['CALL_LOG'],'a') as out:out.write('audit '+actual+'\\n')",
    ].join('\n'));
    const expected = override || path.dirname(f.root);
    const result = run(f, { PAPERCUSP_REPO_ROOT: override, EXPECTED_AUDIT_REPO: expected });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(calls(f).filter(line => line.startsWith('audit ')).length, 2);
    assert.deepEqual(calls(f).filter(line => line.startsWith('audit ')),
      [`audit ${expected}`, `audit ${expected}`]);
    assert.equal(calls(f).includes('unexpected-full-build'), false);
  }
});

test('even correctly hashed provenance cannot assert a different or dirty sidecar source', t => {
  for (const change of [{ gitHead: 'b'.repeat(40) }, { gitDirty: true }, { version: '0.0.25' }]) {
    const f = fixture(t);
    const p = JSON.parse(fs.readFileSync(f.provenance));
    fs.writeFileSync(f.provenance, JSON.stringify({ ...p, ...change }));
    update(f, r => { r.sidecarBuildProvenanceSha256 = sha(f.provenance); });
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sidecar source\/version does not match/);
    assert.deepEqual(calls(f), []);
  }
});

test('wrong actual package role/version and unsupported profile refuse before repack', t => {
  for (const options of [{ role: 'papercusp-gui' }, { version: '0.0.25' }]) {
    const f = fixture(t, options);
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact Server package\/version/);
    assert.deepEqual(calls(f), []);
  }
  const f = fixture(t);
  assert.notEqual(run(f, { DISTRIBUTION_PROFILE: 'dogfood' }).status, 0);
  assert.deepEqual(calls(f), []);
});

test('signature with correctly declared hash but invalid signing trust refuses before repack', t => {
  const f = fixture(t);
  fs.writeFileSync(`${f.deb}.sig`, Buffer.from('invalid-signature').toString('base64'));
  update(f, r => { r.artifact.signatureSha256 = sha(`${f.deb}.sig`); });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.deepEqual(calls(f), []);
});

test('a signed forbidden runtime-only payload is refused before expensive compression', t => {
  const f = fixture(t, { forbidden: true });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forbidden payload member/);
  assert.deepEqual(calls(f), []);
});

test('repack error or stale replacement signature cannot emit final provenance', t => {
  for (const env of [{ REPACK_FAIL: '1' }, { REPACK_STALE_SIGNATURE: '1' }]) {
    const f = fixture(t);
    const result = run(f, env);
    assert.notEqual(result.status, 0);
    assert.ok(calls(f).includes('repack'));
    assert.equal(calls(f).some(line => line.startsWith('provenance')), false);
    assert.equal(calls(f).includes('unexpected-full-build'), false);
  }
});

test('incomplete finalize CLI refuses and its dispatch precedes all completed build phases', t => {
  const f = fixture(t);
  const result = run(f, {}, ['--finalize-deb', f.deb]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage: --finalize-deb/);
  assert.deepEqual(calls(f), []);
  assert.ok(start < source.indexOf('case "${PAPERCUSP_REUSE_SIDECAR'));
});

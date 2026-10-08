'use strict';

// Exercise the real packaging functions without a cross-compile or a real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(process.env.BUILD_MAC_CROSS_SCRIPT
  || path.join(__dirname, '../bin/build-mac-cross.sh'), 'utf8');
function functionBody(name) {
  const start = source.indexOf(`${name}() {`);
  const end = source.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start, `${name} shell function is missing`);
  return source.slice(start, end + 3);
}

function fixture(t, { inheritedPath = true, password = '', mode = 'sign', stale = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-cross-signing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const out = path.join(root, 'bundle');
  const app = path.join(out, 'macos/Papercusp GUI.app');
  const key = path.join(root, 'fixture.key');
  const record = path.join(root, 'signer.json');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(out, 'dmg'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/MacOS/papercusp-desktop'), 'fixture-binary');
  fs.writeFileSync(key, 'fixture-key-content');
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  script('dd', '#!/bin/sh\nexit 0\n');
  script('mkfs.hfsplus', '#!/bin/sh\nexit 0\n');
  script('hfsplus', '#!/bin/sh\nexit 0\n');
  script('dmg', '#!/bin/sh\nprintf fixture-dmg > "$2"\n');
  script('7z', '#!/bin/sh\nprintf "%s\\n" "Papercusp GUI.app/Contents/MacOS/papercusp-desktop"\n');
  script('npx', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const env = process.env;
const pathIndex = args.indexOf('--private-key-path');
const passwordIndex = args.indexOf('--password');
const content = env.TAURI_SIGNING_PRIVATE_KEY;
const keyPath = env.TAURI_SIGNING_PRIVATE_KEY_PATH || args[pathIndex + 1];
const hasPath = Boolean(env.TAURI_SIGNING_PRIVATE_KEY_PATH) || pathIndex >= 0;
if (content && hasPath) {
  console.error('conflicting private key content and path');
  process.exit(2);
}
const actualKey = content || (hasPath && fs.readFileSync(keyPath, 'utf8'));
const actualPassword = passwordIndex >= 0 ? args[passwordIndex + 1] : env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
fs.writeFileSync(env.SIGNER_RECORD, JSON.stringify({
  args, keyMatches: actualKey === 'fixture-key-content',
  passwordMatches: actualPassword === env.EXPECT_PASSWORD,
  contentPresent: Boolean(content), inheritedPathPresent: Boolean(env.TAURI_SIGNING_PRIVATE_KEY_PATH),
}));
if (actualKey !== 'fixture-key-content') process.exit(3);
if (env.SIGNER_MODE === 'fail') process.exit(9);
if (env.SIGNER_MODE === 'sign') fs.writeFileSync(args.at(-1) + '.sig', 'fixture-signature');
if (env.SIGNER_MODE === 'empty') fs.writeFileSync(args.at(-1) + '.sig', '');
`);
  const dmg = path.join(out, 'dmg/Papercusp GUI_0.0.26_x64.dmg');
  if (stale) fs.writeFileSync(dmg + '.sig', 'stale-signature');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: root, ROOT: root, OUT_BUNDLE: out, APP: app,
    VERSION: '0.0.26', DMG_ARCH: 'x64', MAC_CERT_P12: '',
    DMG_TOOL: path.join(bin, 'dmg'), HFSPLUS_TOOL: path.join(bin, 'hfsplus'),
    PAPERCUSP_DMG_NO_MOUNT: '1', TAURI_CLI_VERSION: '2.11.0',
    KEY_FILE: key, KEY_PASSWORD: password,
    SIGNER_RECORD: record, SIGNER_MODE: mode, EXPECT_PASSWORD: password };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (inheritedPath) env.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
  return { root, app, out, key, dmg, record, env, inheritedPath };
}

function run(f, name = 'make_dmg') {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'fail() { echo "ERROR: $*" >&2; exit 1; }',
    'build_tutorial_app() { :; }',
    functionBody(name),
    `${name} "$APP" 'Papercusp GUI'`,
    'if [[ "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" == "$KEY_FILE" ]]; then echo CALLER_PATH_PRESERVED; fi',
  ].join('\n')], { encoding: 'utf8', timeout: 10_000, env: f.env });
}

for (const mode of ['normal', 'companion-change', 'shallow-change', 'pre-sign-change', 'generation-change']) {
  test(`app signing seals the final PUI generation and rejects ${mode} corruption`, t => {
    const f = fixture(t);
    const sidecar = path.join(f.app, 'Contents/Resources/sidecar');
    fs.mkdirSync(path.join(sidecar, 'bin'), { recursive: true });
    const binary = path.join(sidecar, 'bin/pui');
    const companion = path.join(sidecar, 'pui-companion.wasm');
    const manifest = path.join(sidecar, 'pui-install.json');
    fs.writeFileSync(binary, 'unsigned PUI');
    fs.writeFileSync(companion, 'fixed companion');
    const helper = process.env.PUI_MANIFEST_HELPER || path.resolve(__dirname, '../../apps/tui/scripts/write-install-manifest.py');
    const product = path.join(f.root, 'tooling');
    const selectedHelper = path.join(product, 'apps/tui/scripts/write-install-manifest.py');
    fs.mkdirSync(path.dirname(selectedHelper), { recursive: true });
    fs.copyFileSync(helper, selectedHelper);
    const here = path.join(product, 'papercusp-desktop/bin');
    fs.mkdirSync(path.join(here, 'lib'), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../bin/lib/source-roots.sh'), path.join(here, 'lib/source-roots.sh'));
    const write = spawnSync('python3', [helper, 'write', '--manifest', manifest,
      '--binary', binary, '--companion', companion, '--relative-paths', '--source-sha', 'fixture-source',
      '--source-dirty', '0', '--built-at-epoch', '1', '--version', 'fixture-version', '--target', 'darwin-x64'], { encoding: 'utf8' });
    assert.equal(write.status, 0, write.stdout + write.stderr);
    const original = JSON.parse(fs.readFileSync(manifest));
    if (mode === 'pre-sign-change') fs.appendFileSync(binary, 'unexpected');
    fs.writeFileSync(path.join(f.root, 'bin/rcodesign'), `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const args=process.argv.slice(2), app=args.at(-1), shallow=args.includes('--shallow');
const sidecar=path.join(app,'Contents/Resources/sidecar'), manifest=path.join(sidecar,'pui-install.json');
fs.appendFileSync(process.env.SIGNING_CALLS, shallow ? 'shallow\\n' : 'deep\\n');
if (!shallow || process.env.PUI_SIGNING_MODE==='shallow-change') fs.appendFileSync(path.join(sidecar,'bin/pui'),'signature');
if (process.env.PUI_SIGNING_MODE==='companion-change') fs.appendFileSync(path.join(sidecar,'pui-companion.wasm'),'corruption');
if (process.env.PUI_SIGNING_MODE==='generation-change') { const j=JSON.parse(fs.readFileSync(manifest)); j.binarySha256='wrong'; fs.writeFileSync(manifest,JSON.stringify(j)); }
fs.mkdirSync(path.join(app,'Contents/_CodeSignature'),{recursive:true});
fs.writeFileSync(path.join(app,'Contents/_CodeSignature/CodeResources'),crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'));
`, { mode: 0o755 });
    Object.assign(f.env, { HERE: here, REPO_ROOT: path.join(f.root, 'pinned-product-with-older-writer'),
      ENTITLEMENTS: path.join(f.root, 'fixture-entitlements'), PUI_SIGNING_MODE: mode,
      SIGNING_CALLS: path.join(f.root, 'calls') });
    const result = run(f, 'sign_app');
    if (mode !== 'normal') {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /PUI generation|companion changed|binary generation changed|cannot bind/);
      return;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const generation = JSON.parse(fs.readFileSync(manifest));
    const { createHash } = require('node:crypto');
    const digest = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.equal(generation.binarySha256, digest(binary));
    assert.deepEqual({ ...generation, binarySha256: original.binarySha256 }, original);
    assert.equal(fs.readFileSync(path.join(f.app, 'Contents/_CodeSignature/CodeResources'), 'utf8'), digest(manifest));
    assert.equal(fs.readFileSync(f.env.SIGNING_CALLS, 'utf8'), 'deep\nshallow\n');
  });
}

for (const inheritedPath of [true, false]) {
  test(`DMG signer receives only key content with inherited path ${inheritedPath}`, t => {
    const f = fixture(t, { inheritedPath, password: 'fixture-password' });
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(fs.readFileSync(f.record, 'utf8'));
    assert.equal(record.keyMatches, true);
    assert.equal(record.passwordMatches, true);
    assert.equal(record.contentPresent, true);
    assert.equal(record.inheritedPathPresent, false);
    assert.deepEqual(record.args.slice(0, -1),
      ['--yes', '-p', '@tauri-apps/cli@2.11.0', 'tauri', 'signer', 'sign']);
    assert.equal(record.args.at(-1), f.dmg);
    assert.equal(fs.readFileSync(f.dmg + '.sig', 'utf8'), 'fixture-signature');
    assert.equal(result.stdout.includes('CALLER_PATH_PRESERVED'), inheritedPath);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-key-content|fixture-password/);
  });
}

for (const [mode, stale] of [['fail', false], ['missing', false], ['empty', false], ['missing', true]]) {
  test(`DMG signing refuses ${mode} output with stale signature ${stale}`, t => {
    const f = fixture(t, { inheritedPath: false, mode, stale });
    const result = run(f);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /tauri signer (failed|produced no .sig)/);
    assert.doesNotMatch(result.stdout, /CALLER_PATH_PRESERVED/);
    if (stale) assert.equal(fs.existsSync(f.dmg + '.sig'), false);
  });
}

test('updater tar signer retains its explicit path contract and caller setting', t => {
  const f = fixture(t);
  const result = run(f, 'make_updater');
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(f.record, 'utf8'));
  assert.equal(record.keyMatches, true);
  assert.equal(record.contentPresent, false);
  assert.equal(record.inheritedPathPresent, false);
  assert.equal(record.args[record.args.indexOf('--private-key-path') + 1], f.key);
  assert.match(result.stdout, /CALLER_PATH_PRESERVED/);
});

for (const mode of ['fail', 'missing', 'empty']) {
  test(`updater tar signing refuses ${mode} output and cannot reuse a stale signature`, t => {
    const f = fixture(t, { mode });
    const sig = path.join(f.out, 'macos/Papercusp GUI.app.tar.gz.sig');
    fs.writeFileSync(sig, 'stale-signature');
    const result = run(f, 'make_updater');
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /tauri signer (failed|produced no .sig)/);
    if (mode !== 'empty') assert.equal(fs.existsSync(sig), false);
  });
}

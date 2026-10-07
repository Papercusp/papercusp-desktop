'use strict';

// D-192 / EI-25349957563451791: run the actual plist writers without compiling
// a Mac package. Fixture native inputs do not claim native compatibility.
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
  assert.ok(start >= 0, `${name} is missing`);
  // gen_info_plist contains Python dict braces inside a quoted heredoc. The
  // shell boundary is its PY terminator, not the first language-agnostic brace.
  const terminator = name === 'gen_info_plist' ? '\nPY\n}\n' : '\n}\n';
  const end = source.indexOf(terminator, start);
  assert.ok(end >= 0, `${name} has no closing brace`);
  return source.slice(start, end + terminator.length);
}
const writers = `${functionBody('gen_info_plist')}\n${functionBody('build_tutorial_app')}`;

function fixture(t, { configured = '10.15', native, user = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-minimum-os-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tauri = path.join(root, 'src-tauri');
  fs.mkdirSync(path.join(tauri, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(tauri, 'icons/icon.icns'), 'fixture-icon');
  fs.writeFileSync(path.join(tauri, 'tauri.conf.json'), JSON.stringify({
    bundle: { macOS: { minimumSystemVersion: configured } },
  }));
  const written = spawnSync('python3', ['-c',
    'import json,plistlib,sys;plistlib.dump(json.loads(sys.argv[1]),open(sys.argv[2],"wb"))',
    JSON.stringify(user), path.join(tauri, 'Info.plist')], { encoding: 'utf8' });
  assert.equal(written.status, 0, written.stderr);
  let nativeRoot = '';
  const sidecar = path.join(root, 'sidecar');
  const copiedManifest = path.join(sidecar, 'apps/operator/runtime/darwin-native-inputs.json');
  if (native !== undefined) {
    nativeRoot = path.join(root, 'native');
    fs.mkdirSync(nativeRoot);
    fs.writeFileSync(path.join(nativeRoot, 'manifest.json'), JSON.stringify(native));
    fs.mkdirSync(path.dirname(copiedManifest), { recursive: true });
    fs.writeFileSync(copiedManifest, JSON.stringify(native));
  }
  return { root, tauri, nativeRoot, sidecar, copiedManifest };
}

function generate(f) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail', writers,
    'gen_info_plist com.papercusp.gui "Papercusp GUI" "$OUT/gui.plist"',
    'gen_info_plist com.papercusp.server "Papercusp Server" "$OUT/server.plist"',
    'build_tutorial_app "$OUT"',
  ].join('\n')], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, VERSION: '0.0.26', SRC_TAURI: f.tauri,
      OUT: f.root, DARWIN_SIDECAR: f.sidecar, PAPERCUSP_DARWIN_NATIVE_INPUTS: f.nativeRoot },
  });
}

function plists(f) {
  const paths = ['gui.plist', 'server.plist', 'Papercusp Tutorial & Setup.app/Contents/Info.plist'];
  const result = spawnSync('python3', ['-c',
    'import sys,json,plistlib;print(json.dumps([plistlib.load(open(p,"rb")) for p in sys.argv[1:]]))',
    ...paths.map(p => path.join(f.root, p))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('qualified native 14.0 raises both main apps and the actual tutorial launcher', t => {
  const f = fixture(t, { native: { minimumMacOS: '14.0' } });
  const result = generate(f);
  assert.equal(result.status, 0, result.stderr);
  const actual = plists(f);
  assert.deepEqual(actual.map(p => p.LSMinimumSystemVersion), ['14.0', '14.0', '14.0']);
  assert.deepEqual(actual.map(p => p.CFBundleExecutable),
    ['papercusp-desktop', 'papercusp-desktop', 'papercusp-tutorial']);
  assert.equal(actual[2].LSUIElement, true);
});

test('lower user Info.plist override cannot replace the qualified floor after merge', t => {
  const f = fixture(t, { native: { minimumMacOS: '14.0' },
    user: { LSMinimumSystemVersion: '10.15', NSMicrophoneUsageDescription: 'fixture mic' } });
  const result = generate(f);
  assert.equal(result.status, 0, result.stderr);
  const actual = plists(f);
  assert.deepEqual(actual.map(p => p.LSMinimumSystemVersion), ['14.0', '14.0', '14.0']);
  assert.equal(actual[0].NSMicrophoneUsageDescription, 'fixture mic');
});

test('higher configured or user floors are retained with numeric version ordering', t => {
  for (const [configured, override, expected] of [
    ['15.0', '10.15', '15.0'], ['14.2', '14.10', '14.10'],
  ]) {
    const f = fixture(t, { configured, native: { minimumMacOS: '14.0' },
      user: { LSMinimumSystemVersion: override } });
    const result = generate(f);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(plists(f).map(p => p.LSMinimumSystemVersion), Array(3).fill(expected));
  }
});

test('no private native selection preserves the existing configured platform minimum', t => {
  const f = fixture(t);
  const result = generate(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(plists(f).map(p => p.LSMinimumSystemVersion), ['10.15', '10.15', '10.15']);
});

test('packaging-only resume still derives the floor from the actual sidecar manifest', t => {
  const f = fixture(t, { native: { minimumMacOS: '14.0' } });
  f.nativeRoot = '';
  const result = generate(f);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(plists(f).map(p => p.LSMinimumSystemVersion), ['14.0', '14.0', '14.0']);
});

test('selected native input refuses missing, malformed and non-string minimum versions', t => {
  for (const native of [{}, { minimumMacOS: null }, { minimumMacOS: 14 },
    { minimumMacOS: '14.x' }, { minimumMacOS: '' }, { minimumMacOS: '14.0\n' }]) {
    const f = fixture(t, { native });
    const result = generate(f);
    assert.notEqual(result.status, 0, JSON.stringify(native));
    assert.match(result.stderr, /qualified native manifest must declare a valid minimum/);
    assert.equal(fs.existsSync(path.join(f.root, 'gui.plist')), false);
  }
});

test('missing selected native manifest and malformed config/user floors refuse metadata writes', t => {
  const absent = fixture(t, { native: { minimumMacOS: '14.0' } });
  fs.unlinkSync(absent.copiedManifest);
  assert.notEqual(generate(absent).status, 0);
  for (const options of [{ configured: null }, { configured: '14.beta' },
    { user: { LSMinimumSystemVersion: 14 } }]) {
    const f = fixture(t, { ...options, native: { minimumMacOS: '14.0' } });
    const result = generate(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must declare a valid minimum macOS version/);
  }
});

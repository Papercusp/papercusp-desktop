'use strict';

// EI-27158244411414674 — build-appimage.sh packed the signed GUI AppImage with
// whichever linuxdeploy-plugin-appimage the Tauri cache held
// (`ls ~/.cache/tauri/*plugin-appimage*.AppImage | sed -n 1p`). Its bundled
// appimagetool writes every payload byte, and nothing pinned it. The packer is
// now pinned by sha256 and resolved from a content-addressed store that is
// seeded only with matching bytes. These tests exercise the real resolver in
// bin/lib/appimage-runtime.sh against fixture caches. The pin constant is
// overridden with a fixture hash, because the real pinned file is 16 MB and
// lives outside the tree.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DESK = path.join(__dirname, '..');
// The *_SUBJECT overrides let scripts/mutation-probe.sh point these guards at a
// mutated copy. The tracked files are never mutated.
const LIB = process.env.APPIMAGE_PACKER_LIB_SUBJECT || path.join(DESK, 'bin', 'lib', 'appimage-runtime.sh');
const LIB_SRC = fs.readFileSync(LIB, 'utf8');
const BUILD = fs.readFileSync(
  process.env.APPIMAGE_PACKER_BUILD_SUBJECT || path.join(DESK, 'bin', 'build-appimage.sh'),
  'utf8',
);
const RELEASE_LOCAL = fs.readFileSync(
  process.env.APPIMAGE_PACKER_RELEASE_SUBJECT || path.join(DESK, 'bin', 'release-local.sh'),
  'utf8',
);

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function withTmp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-packer-pin-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Run `fn` from the library with the pin replaced by `pin`, a fixture store
// and a fixture Tauri cache. HOME points into the fixture so a missing override
// can never reach the real store or cache.
function run(root, fn, pin, args = []) {
  const script = `. ${JSON.stringify(LIB)} || exit 97\nPAPERCUSP_APPIMAGE_PACKER_SHA256=${pin}\n${fn} "$@"`;
  return spawnSync('bash', ['-c', script, 'bash', ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: path.join(root, 'home'),
      PAPERCUSP_RELEASE_TOOLS_DIR: path.join(root, 'store'),
      PAPERCUSP_TAURI_TOOLS_DIR: path.join(root, 'tauri'),
    },
  });
}

function cacheFile(root, name, content) {
  const dir = path.join(root, 'tauri');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, { mode: 0o755 });
  return file;
}

const storeFile = (root, pin) => path.join(root, 'store', 'sha256', pin, 'linuxdeploy-plugin-appimage.AppImage');

test('the library pins the packer by sha256 and names its upstream build', () => {
  assert.match(LIB_SRC, /^PAPERCUSP_APPIMAGE_PACKER_SHA256=[0-9a-f]{64}$/m);
  assert.match(LIB_SRC, /^PAPERCUSP_APPIMAGE_PACKER_UPSTREAM='linuxdeploy\/linuxdeploy-plugin-appimage .*git [0-9a-f]{7,40}/m);
  assert.doesNotMatch(LIB_SRC, /\b(curl|wget)\b/, 'the resolver must never download a packer');
});

test('a cached plugin that does not hash to the pin is refused and never stored', () => {
  withTmp((root) => {
    const pin = sha256('the reviewed packer');
    cacheFile(root, 'linuxdeploy-plugin-appimage.AppImage', 'a different packer');
    const r = run(root, 'papercusp_appimage_packer_path', pin);
    assert.notEqual(r.status, 0, 'an unpinned packer must fail the build');
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /pinned AppImage packer not found/);
    assert.match(r.stderr, new RegExp(pin));
    assert.equal(fs.existsSync(storeFile(root, pin)), false);
  });
});

test('seeding picks the cached file that matches the pin, not the one that sorts first', () => {
  withTmp((root) => {
    const pin = sha256('the reviewed packer');
    cacheFile(root, 'a-plugin-appimage-decoy.AppImage', 'a different packer');
    cacheFile(root, 'linuxdeploy-plugin-appimage.AppImage', 'the reviewed packer');
    const r = run(root, 'papercusp_appimage_packer_path', pin);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), storeFile(root, pin));
    assert.equal(sha256(fs.readFileSync(storeFile(root, pin))), pin);
    assert.ok(fs.statSync(storeFile(root, pin)).mode & 0o111, 'the stored packer must stay executable');
    assert.match(r.stderr, /seeded the pinned AppImage packer/);
    assert.deepEqual(
      fs.readdirSync(path.dirname(storeFile(root, pin))).filter((n) => n.startsWith('.seed.')),
      [],
      'seeding must not leave temporary files behind',
    );
  });
});

test('the store survives the Tauri cache changing, and a tampered store is refused', () => {
  withTmp((root) => {
    const pin = sha256('the reviewed packer');
    const cached = cacheFile(root, 'linuxdeploy-plugin-appimage.AppImage', 'the reviewed packer');
    assert.equal(run(root, 'papercusp_appimage_packer_path', pin).status, 0);

    // The Tauri CLI replaces its cached copy: the stored pin still resolves.
    fs.writeFileSync(cached, 'a newer continuous packer');
    const after = run(root, 'papercusp_appimage_packer_path', pin);
    assert.equal(after.status, 0, after.stderr);
    assert.equal(after.stdout.trim(), storeFile(root, pin));

    // Bytes in the store change: every resolution re-hashes, so this fails.
    const stored = storeFile(root, pin);
    fs.chmodSync(stored, 0o755);
    fs.writeFileSync(stored, 'tampered packer');
    const refused = run(root, 'papercusp_appimage_packer_path', pin);
    assert.notEqual(refused.status, 0);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /refusing to pack with an unreviewed appimagetool/);
  });
});

test('papercusp_appimage_packer_verify accepts only the pinned bytes', () => {
  withTmp((root) => {
    const pin = sha256('the reviewed packer');
    const good = cacheFile(root, 'good.AppImage', 'the reviewed packer');
    const bad = cacheFile(root, 'bad.AppImage', 'the reviewed packer!');
    assert.equal(run(root, 'papercusp_appimage_packer_verify', pin, [good]).status, 0);
    assert.notEqual(run(root, 'papercusp_appimage_packer_verify', pin, [bad]).status, 0);
    assert.notEqual(run(root, 'papercusp_appimage_packer_verify', pin, [path.join(root, 'absent')]).status, 0);
  });
});

test('build-appimage.sh packs only with the resolved pin', () => {
  assert.doesNotMatch(BUILD, /plugin-appimage\*\.AppImage/, 'the build must not glob the Tauri cache for a packer');
  const resolveAt = BUILD.indexOf('PLUGIN="$(papercusp_appimage_packer_path)" || exit 1');
  const packAt = BUILD.indexOf('run_appimage_tool_isolated "$PLUGIN" "$OUT" "$APPDIR" "$APPIMAGE_RUNTIME"');
  const sourceAt = BUILD.indexOf('. "$ORCHESTRATOR_HERE/lib/appimage-runtime.sh"');
  assert.ok(sourceAt > 0, 'the build must source the pin library');
  assert.ok(resolveAt > sourceAt, 'the build must resolve the packer through the pin library');
  assert.ok(packAt > resolveAt, 'the packer must be resolved before packaging');
  assert.equal(BUILD.slice(resolveAt, packAt).match(/^PLUGIN=/gm).length, 1, 'nothing may reassign PLUGIN after resolution');
});

test('Linux provenance records the packer pin, and no packer for a reused AppImage', () => {
  const fnStart = RELEASE_LOCAL.indexOf('emit_linux_build_provenance() {');
  const fnEnd = RELEASE_LOCAL.indexOf('\n}\n', fnStart);
  assert.ok(fnStart >= 0 && fnEnd > fnStart, 'release-local.sh must define emit_linux_build_provenance');
  const fn = RELEASE_LOCAL.slice(fnStart, fnEnd);
  const merge = fn.match(/python3 -I -c '\n([\s\S]*?)\n' "\$appimage_runtime" "\$reused" "\$PAPERCUSP_APPIMAGE_PACKER_SHA256" "\$PAPERCUSP_APPIMAGE_PACKER_UPSTREAM"/);
  assert.ok(merge, 'the Linux leg must merge the packer pin into the runtime verdict');

  const merged = (reused) => {
    const r = spawnSync('python3', ['-I', '-c', merge[1], '{"embeddedMatchesPin": true}', reused, 'f'.repeat(64), 'up'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(merged('false'), { embeddedMatchesPin: true, packer: { sha256: 'f'.repeat(64), upstream: 'up' } });
  const reused = merged('true');
  assert.equal(reused.embeddedMatchesPin, true);
  assert.equal(reused.packer.sha256, null, 'a reused AppImage must not be credited to the current pin');
});

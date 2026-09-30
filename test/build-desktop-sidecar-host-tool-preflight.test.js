// Guards the HOST-TOOL PREFLIGHT in bin/build-desktop-sidecar.sh (WI-10003960 R-15).
//
// A fresh-clone Linux installer build used to discover a missing `kopia` only at its
// point of use, thousands of lines into the script, after the whole sidecar had been
// assembled — so a fresh build host paid a full multi-minute run per missing tool.
// The preflight decides every target-knowable host tool before the first toolchain
// operation and names them all in one failure. These tests hide exactly the tools
// under test from PATH (a symlink shadow of every other PATH entry) so they are
// hermetic on hosts that DO have them installed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..');
const script = path.join(root, 'bin/build-desktop-sidecar.sh');

function shadowPathWithout(hidden, shims = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-host-preflight-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  // Shims are written first so they win over the real tool of the same name.
  for (const [name, body] of Object.entries(shims)) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
  for (const entry of (process.env.PATH || '').split(path.delimiter)) {
    let names;
    try { names = fs.readdirSync(entry); } catch { continue; }
    for (const name of names) {
      if (hidden.includes(name)) continue;
      const link = path.join(bin, name);
      if (fs.existsSync(link)) continue; // first PATH hit wins, like the shell
      try { fs.symlinkSync(path.join(entry, name), link); } catch { /* race/dup */ }
    }
  }
  return { dir, bin };
}

function runWithHidden(hidden, extraEnv = {}, shims = {}) {
  const { dir, bin } = shadowPathWithout(hidden, shims);
  try {
    const env = {
      ...process.env,
      PATH: bin,
      REPO_ROOT: repoRoot,
      PAPERCUSP_ROOT: path.join(repoRoot, 'libs/papercusp'),
      PAPERCUSP_RELEASE_AUDIT: '0',
      // Pin source provenance so the run never depends on shared-tree cleanliness.
      PROVENANCE_SOURCE_GIT_HEAD: '0'.repeat(40),
      PROVENANCE_SOURCE_GIT_DIRTY: 'false',
      // Never let a stray run touch the real sidecar output.
      PAPERCUSP_SIDECAR_OUT: path.join(dir, 'sidecar-out'),
      ...extraEnv,
    };
    delete env.PAPERCUSP_DISTRIBUTION_PROFILE;
    if (extraEnv.PAPERCUSP_DISTRIBUTION_PROFILE) {
      env.PAPERCUSP_DISTRIBUTION_PROFILE = extraEnv.PAPERCUSP_DISTRIBUTION_PROFILE;
    }
    return spawnSync('bash', [script], { encoding: 'utf8', env, timeout: 120_000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a local build without kopia fails in the host-tool preflight, before toolchain work', () => {
  const r = runWithHidden(['kopia']);
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /build host is missing required tool\(s\)/);
  assert.match(output, /- kopia \(snapshot subsystem/);
  assert.doesNotMatch(output, /kopia not found on the build host/,
    'the late point-of-use check must not be the first to notice');
  assert.doesNotMatch(output, /esbuild-bundling|copying first-party/,
    'the preflight must stop the build before any assembly step');
});

test('a darwin cross-build names every missing host tool in ONE failure', () => {
  const r = runWithHidden(['kopia', 'rcodesign'], { TARGET_OS: 'darwin' });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /- kopia \(snapshot subsystem/);
  assert.match(output, /- rcodesign \(darwin cross-build/);
});

// pkg-config shims: `--exists alsa` answers per the shim, everything else fails
// (the preflight is the only caller that runs before it exits).
const PKG_CONFIG_NO_ALSA = '#!/bin/sh\nexit 1\n';
const PKG_CONFIG_WITH_ALSA = '#!/bin/sh\n[ "$1" = "--exists" ] && [ "$2" = "alsa" ] && exit 0\nexit 1\n';

test('a native Linux build without ALSA headers fails in the preflight (build5: alsa-sys exit 101)', () => {
  const r = runWithHidden([], { TARGET_OS: 'linux' }, { 'pkg-config': PKG_CONFIG_NO_ALSA });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /- ALSA development headers, alsa\.pc .*libasound2-dev/);
  assert.doesNotMatch(output, /esbuild-bundling|copying first-party|chat dock/,
    'the preflight must stop the build before any assembly step');
});

test('a native Linux build without pkg-config names pkg-config itself', () => {
  const r = runWithHidden(['pkg-config'], { TARGET_OS: 'linux' });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /- pkg-config \(native Rust builds/);
});

test('ALSA headers present: the preflight does not demand them (control)', () => {
  // kopia hidden so the run still stops in the preflight instead of building.
  const r = runWithHidden(['kopia'], { TARGET_OS: 'linux' }, { 'pkg-config': PKG_CONFIG_WITH_ALSA });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /- kopia \(snapshot subsystem/);
  assert.doesNotMatch(output, /ALSA development headers|- pkg-config/);
});

test('a darwin cross-build does not demand host ALSA headers', () => {
  const r = runWithHidden(['kopia'], { TARGET_OS: 'darwin' }, { 'pkg-config': PKG_CONFIG_NO_ALSA });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.doesNotMatch(output, /ALSA development headers/);
});

// A REPO_ROOT that is the real tree minus node_modules: every earlier check still sees
// real sources, but the transformers cache a fresh clone lacks is absent.
function treeWithoutNodeModules() {
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-no-models-'));
  for (const name of fs.readdirSync(repoRoot)) {
    if (name === 'node_modules') continue;
    fs.symlinkSync(path.join(repoRoot, name), path.join(fresh, name));
  }
  return fresh;
}

test('a tree with no embedding models fails in the preflight and names the fetch command (build6)', () => {
  // No PAPERCUSP_TRANSFORMERS_MODEL_CACHE either: the fresh-clone state.
  const fresh = treeWithoutNodeModules();
  try {
    const r = runWithHidden([], { REPO_ROOT: fresh, PAPERCUSP_TRANSFORMERS_MODEL_CACHE: '' });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, output);
    assert.match(output, /- embedding models \(harrier-oss \+ embeddinggemma.*transformers-models\.sh fetch/);
    assert.doesNotMatch(output, /relocated transformers models missing/,
      'the late models guard must not be the first to notice');
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('an explicit PAPERCUSP_TRANSFORMERS_MODEL_CACHE satisfies the models preflight (control)', () => {
  const fresh = treeWithoutNodeModules();
  try {
    // kopia hidden so the run still stops in the preflight instead of building.
    const r = runWithHidden(['kopia'], { REPO_ROOT: fresh, PAPERCUSP_TRANSFORMERS_MODEL_CACHE: fresh });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, output);
    assert.match(output, /- kopia \(snapshot subsystem/);
    assert.doesNotMatch(output, /- embedding models/);
  } finally {
    fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('the preflight is placed before the first toolchain step in the script', () => {
  const src = fs.readFileSync(script, 'utf8');
  const preflight = src.indexOf('build host is missing required tool(s)');
  assert.ok(preflight > 0, 'preflight block must exist');
  for (const later of ['esbuild-bundling', 'lib/disk-preflight.sh', 'kopia not found on the build host']) {
    const at = src.indexOf(later);
    assert.ok(at > preflight, `${later} must come after the host-tool preflight`);
  }
});

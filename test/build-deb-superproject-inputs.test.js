// WI-10003499 — superproject-owned compile inputs in bin/build-and-archive-deb.sh.
//
// WHY THIS TEST EXISTS
// The deb producer compiles a PRIVATE detached papercusp-desktop worktree so that a
// moving shared tree cannot change its inputs. But desktop Rust sources pull
// superproject-owned files in at compile time through relative include_str! paths
// that climb OUT of the desktop submodule. custom_protocol.rs reads
// ../../../libs/generic/desktop-ipc/src/csp-policy.json. The snapshot root did not
// contain it, so every build died at `cargo build` with "couldn't read
// src/../../../libs/...". Measured 2026-09-27 19:46Z; that broke the default release
// mode and --test-artifact alike. Nothing caught it before a multi-minute compile.
//
// Two guards:
//   1. CLASS: scan src-tauri/src for non-test include_str!/include_bytes! literals that
//      resolve outside papercusp-desktop. The set must equal the producer's
//      DEB_SUPERPROJECT_BUILD_INPUTS list, so a new out-of-tree include fails here, in
//      seconds, instead of in the next deb build.
//   2. BEHAVIOUR: the lib that stages those files reads the PINNED commit through
//      submodule gitlinks (not moved HEAD, not dirty bytes) and fails closed.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(desktopRoot, 'bin/build-and-archive-deb.sh');
const libPath = path.join(desktopRoot, 'bin/lib/superproject-blob.sh');
const rustSrc = path.join(desktopRoot, 'src-tauri/src');

// Includes that climb out of the desktop tree but compile ONLY under #[cfg(test)], so
// a release/test-artifact deb never reads them. Each entry must name its reason.
const TEST_ONLY_OUT_OF_TREE = new Map([
  ['apps/tui/scripts/live-operator-voice-e2e.mjs', 'wsl_setup.rs: inside a #[test] fn (shipped_bootstrap_provisions_live_voice_e2e_dependencies)'],
]);

function rustFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rustFiles(p));
    else if (entry.name.endsWith('.rs')) out.push(p);
  }
  return out;
}

function outOfTreeIncludes() {
  const found = new Map();
  const re = /include_(?:str|bytes)!\(\s*"([^"]+)"\s*,?\s*\)/g;
  for (const file of rustFiles(rustSrc)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const resolved = path.resolve(path.dirname(file), m[1]);
      const rel = path.relative(desktopRoot, resolved);
      if (!rel.startsWith('..')) continue;
      const repoRel = path.relative(path.dirname(desktopRoot), resolved).split(path.sep).join('/');
      found.set(repoRel, path.relative(desktopRoot, file));
    }
  }
  return found;
}

function declaredInputs() {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const m = script.match(/DEB_SUPERPROJECT_BUILD_INPUTS=\(\n([\s\S]*?)\n\)/);
  assert.ok(m, 'DEB_SUPERPROJECT_BUILD_INPUTS array not found in build-and-archive-deb.sh');
  return m[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

test('every non-test out-of-tree Rust include is staged by the deb producer', () => {
  const found = outOfTreeIncludes();
  // Positive controls: the scanner must still see both known includes, including the
  // multi-line csp-policy one, or an empty scan would pass vacuously.
  assert.ok(found.has('libs/generic/desktop-ipc/src/csp-policy.json'), `scanner lost csp-policy.json; found ${[...found.keys()]}`);
  assert.ok(found.has('apps/tui/scripts/live-operator-voice-e2e.mjs'), 'scanner lost the test-only voice include');
  const required = [...found.keys()].filter((k) => !TEST_ONLY_OUT_OF_TREE.has(k)).sort();
  assert.deepEqual(declaredInputs().sort(), required,
    'a desktop Rust source include_str!/include_bytes!s a file outside papercusp-desktop that '
    + 'bin/build-and-archive-deb.sh does not stage (DEB_SUPERPROJECT_BUILD_INPUTS). Add it there, or '
    + 'to TEST_ONLY_OUT_OF_TREE here with a reason if it compiles only under #[cfg(test)].');
});

test('the producer stages superproject inputs from the pinned commit, after the private worktree exists', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const worktreeAt = script.indexOf('DEB_SOURCE_SNAPSHOT_WORKTREE=1');
  const stageAt = script.indexOf('papercusp_materialize_superproject_blob "$LIVE_REPO_DIR" "$DEB_SOURCE_SNAPSHOT_COMMIT"');
  const buildAt = script.indexOf('setsid timeout');
  assert.ok(worktreeAt > 0 && stageAt > worktreeAt, 'inputs must be staged after the snapshot root exists');
  assert.ok(buildAt > stageAt, 'inputs must be staged before the build runs');
  assert.match(script, /"\$DEB_SOURCE_SNAPSHOT_ROOT\/\$_superproject_input"/, 'the destination must be the snapshot root, not the live tree');
});

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim();
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  fs.writeFileSync(path.join(dir, 'README'), 'fixture\n');
  git(dir, 'add', 'README');
  git(dir, 'commit', '-qm', 'init');
}

const POLICY_REL = 'libs/generic/desktop-ipc/src/csp-policy.json';
const MODULE_REL = 'libs/generic/desktop-ipc';

function fixture(context) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deb-superproject-blob-'));
  context.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const superproject = path.join(tmp, 'super project');
  initRepo(superproject);
  const moduleRepo = path.join(superproject, MODULE_REL);
  initRepo(moduleRepo);
  const policyPath = path.join(superproject, POLICY_REL);
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  const pinned = '{"policy":"pinned"}\n';
  fs.writeFileSync(policyPath, pinned);
  git(moduleRepo, 'add', 'src/csp-policy.json');
  git(moduleRepo, 'commit', '-qm', 'policy');
  git(superproject, 'update-index', '--add', '--cacheinfo', `160000,${git(moduleRepo, 'rev-parse', 'HEAD')},${MODULE_REL}`);
  git(superproject, 'commit', '-qm', 'gitlink');
  const pin = git(superproject, 'rev-parse', 'HEAD');
  // Move BOTH the submodule and the gitlink past the pin, then dirty the working file.
  fs.writeFileSync(policyPath, '{"policy":"moved"}\n');
  git(moduleRepo, 'commit', '-qam', 'moved');
  git(superproject, 'update-index', '--cacheinfo', `160000,${git(moduleRepo, 'rev-parse', 'HEAD')},${MODULE_REL}`);
  git(superproject, 'commit', '-qm', 'gitlink moved');
  fs.writeFileSync(policyPath, '{"policy":"dirty"}\n');
  return { tmp, superproject, pin, pinned };
}

function materialize(superproject, commit, rel, dest) {
  return spawnSync('bash', ['-c', `set -euo pipefail; source "$1"; papercusp_materialize_superproject_blob "$2" "$3" "$4" "$5"`,
    'x', libPath, superproject, commit, rel, dest], { encoding: 'utf8' });
}

test('materializes the PINNED blob through a submodule gitlink, not moved HEAD or dirty bytes', (context) => {
  const f = fixture(context);
  const dest = path.join(f.tmp, 'out', POLICY_REL);
  const r = materialize(f.superproject, f.pin, POLICY_REL, dest);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(dest, 'utf8'), f.pinned);
});

test('a path absent at the pinned commit fails closed and leaves no file', (context) => {
  const f = fixture(context);
  const dest = path.join(f.tmp, 'out', 'libs/generic/desktop-ipc/src/missing.json');
  const r = materialize(f.superproject, f.pin, 'libs/generic/desktop-ipc/src/missing.json', dest);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not tracked/);
  assert.equal(fs.existsSync(dest), false);
});

test('a directory is refused as a build input', (context) => {
  const f = fixture(context);
  const dest = path.join(f.tmp, 'out', 'dir');
  const r = materialize(f.superproject, f.pin, `${MODULE_REL}/src`, dest);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a regular blob/);
});

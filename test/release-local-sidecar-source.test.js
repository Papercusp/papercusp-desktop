'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const bin = path.join(__dirname, '..', 'bin');
const release = fs.readFileSync(process.env.PROBE_RELEASE_LOCAL || path.join(bin, 'release-local.sh'), 'utf8');
const sidecar = fs.readFileSync(path.join(bin, 'build-desktop-sidecar.sh'), 'utf8');
const windows = fs.readFileSync(path.join(bin, 'build-windows-cross.sh'), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing shell boundary: ${start}`);
  return text.slice(from, to);
}

const calls = {
  linux: section(release, 'export PAPERCUSP_RELEASE_AUDIT=1\n', '# P-004: the exact sha'),
  mac: section(release, '    env \\\n      TARGET_OS=darwin', '    # 2) universal .app'),
};

test('mac leg asserts the freshly built Darwin sidecar, not the Linux hash', () => {
  assert.match(release, /unset PAPERCUSP_EXPECTED_SERVE_SHA/);
  assert.match(calls.mac, /mac_expected_serve_sha=\"\$\(sha256sum \"\$MAC_SIDECAR_DIR\/serve\.mjs\"/);
  assert.match(calls.mac, /export PAPERCUSP_EXPECTED_SERVE_SHA=\"\$mac_expected_serve_sha\"/);
  assert.match(release, /PAPERCUSP_EXPECTED_SERVE_SHA=\$mac_expected_serve_sha/);
});

test('Windows exact-source salvage runs current producer logic against the frozen target root', () => {
  assert.match(release, /WIN_PRODUCER=\"\$ORCHESTRATOR_HERE\/build-windows-cross\.sh\"/);
  assert.match(release, /WIN_TARGET_ENTRYPOINT=\"\$ROOT\/bin\/build-windows-cross\.sh\"/);
  assert.match(
    release,
    /bash -c 'source \"\$1\"' \"\$WIN_TARGET_ENTRYPOINT\" \"\$WIN_PRODUCER\"/,
  );
});

test('Windows immutable source contains the superproject CSP policy at Rust include_str path', () => {
  const worktreeDir = windows.match(/BUILD_ROOT=\"\$BUILD_CONTAINER\/([^\"]+)\"/)?.[1];
  const policyRel = windows.match(/WINDOWS_CSP_POLICY_REL=\"([^\"]+)\"/)?.[1];
  assert.equal(worktreeDir, 'papercusp-desktop');
  assert.equal(policyRel, 'libs/generic/desktop-ipc/src/csp-policy.json');
  assert.match(windows, /copy_superproject_snapshot_blob \"\$WINDOWS_CSP_POLICY_REL\"/);

  const container = path.join(os.tmpdir(), 'papercusp-win-cross-source-fixture');
  const compileTimePath = path.resolve(
    container,
    worktreeDir,
    'src-tauri',
    'src',
    '../../../libs/generic/desktop-ipc/src/csp-policy.json',
  );
  assert.equal(compileTimePath, path.join(container, policyRel));
});

// Exercise the producer's real refusal, without compiling or altering the live tree.
const headGuard = section(sidecar, '  _provenance_current_head=', '  unset _provenance_current_head\nfi\n');

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function initRepo(root, content) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'fixture');
  git(root, 'config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(root, 'source.txt'), content);
  git(root, 'add', 'source.txt');
  git(root, 'commit', '-qm', 'fixture');
  return git(root, 'rev-parse', 'HEAD');
}

const policyRel = 'libs/generic/desktop-ipc/src/csp-policy.json';
const policyModuleRel = 'libs/generic/desktop-ipc';
const policySnapshot = section(windows, 'copy_superproject_snapshot_blob() {', '\nfor _release_input');

function policyFixture(context, submodule = true) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-policy-source-'));
  context.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, 'source workspace');
  const output = path.join(temp, 'snapshot output');
  initRepo(workspace, 'superproject source');
  const policyRepo = submodule ? path.join(workspace, policyModuleRel) : workspace;
  if (submodule) initRepo(policyRepo, 'policy module source');
  const policyPath = path.join(workspace, policyRel);
  const policy = '{"policy":"selected source"}\n';
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, policy);
  git(policyRepo, 'add', submodule ? 'src/csp-policy.json' : policyRel);
  git(policyRepo, 'commit', '-qm', 'selected policy');
  if (submodule) {
    const moduleCommit = git(policyRepo, 'rev-parse', 'HEAD');
    git(workspace, 'update-index', '--add', '--cacheinfo', `160000,${moduleCommit},${policyModuleRel}`);
    git(workspace, 'commit', '-qm', 'selected policy gitlink');
  }
  return { temp, workspace, output, policyRepo, policyPath, policy, sourceCommit: git(workspace, 'rev-parse', 'HEAD') };
}

function runPolicySnapshot(fixture, relativePath = policyRel) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'fail() { echo "ERROR: $*" >&2; exit 1; }',
    policySnapshot,
    'copy_superproject_snapshot_blob "$POLICY_REL"',
  ].join('\n')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPERPROJECT_ROOT: fixture.workspace,
      BUILD_SUPERPROJECT_COMMIT_SHA: fixture.sourceCommit,
      BUILD_CONTAINER: fixture.output,
      POLICY_REL: relativePath,
    },
  });
}

for (const submodule of [false, true]) {
  test(`Windows policy snapshot reads a pinned ${submodule ? 'gitlink' : 'superproject blob'}, not moved HEAD or dirty bytes`, (context) => {
    const fixture = policyFixture(context, submodule);
    fs.writeFileSync(fixture.policyPath, '{"policy":"newer commit"}\n');
    git(fixture.policyRepo, 'commit', '-qam', 'policy moved');
    if (submodule) {
      const newerCommit = git(fixture.policyRepo, 'rev-parse', 'HEAD');
      git(fixture.workspace, 'update-index', '--cacheinfo', `160000,${newerCommit},${policyModuleRel}`);
      git(fixture.workspace, 'commit', '-qm', 'gitlink moved');
    }
    fs.writeFileSync(fixture.policyPath, '{"policy":"dirty working tree"}\n');
    assert.notEqual(git(fixture.workspace, 'rev-parse', 'HEAD'), fixture.sourceCommit);
    const result = runPolicySnapshot(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(fixture.output, policyRel), 'utf8'), fixture.policy);
  });
}

test('Windows policy snapshot reads the real submodule layout with an unchanged gitlink', (context) => {
  const fixture = policyFixture(context);
  const result = runPolicySnapshot(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(fixture.output, policyRel), 'utf8'), fixture.policy);
});

test('Windows policy snapshot refuses an unavailable gitlink commit instead of using submodule HEAD', (context) => {
  const fixture = policyFixture(context);
  const unavailableCommit = initRepo(path.join(fixture.temp, 'unrelated source'), 'unavailable object');
  git(fixture.workspace, 'update-index', '--cacheinfo', `160000,${unavailableCommit},${policyModuleRel}`);
  git(fixture.workspace, 'commit', '-qm', 'unavailable gitlink');
  fixture.sourceCommit = git(fixture.workspace, 'rev-parse', 'HEAD');
  const result = runPolicySnapshot(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required Windows .* (?:input|commit)/);
  assert.equal(fs.existsSync(path.join(fixture.output, policyRel)), false);
});

test('Windows policy snapshot refuses an uninitialized submodule even when loose policy bytes exist', (context) => {
  const fixture = policyFixture(context);
  fs.rmSync(path.join(fixture.policyRepo, '.git'), { recursive: true, force: true });
  const result = runPolicySnapshot(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required Windows .* (?:input|repository)/);
  assert.equal(fs.existsSync(path.join(fixture.output, policyRel)), false);
});

test('Windows policy snapshot refuses a missing pinned blob despite untracked replacement bytes', (context) => {
  const fixture = policyFixture(context);
  git(fixture.policyRepo, 'rm', 'src/csp-policy.json');
  git(fixture.policyRepo, 'commit', '-qm', 'policy removed');
  const moduleCommit = git(fixture.policyRepo, 'rev-parse', 'HEAD');
  git(fixture.workspace, 'update-index', '--cacheinfo', `160000,${moduleCommit},${policyModuleRel}`);
  git(fixture.workspace, 'commit', '-qm', 'removed policy gitlink');
  fixture.sourceCommit = git(fixture.workspace, 'rev-parse', 'HEAD');
  fs.mkdirSync(path.dirname(fixture.policyPath), { recursive: true });
  fs.writeFileSync(fixture.policyPath, fixture.policy);
  const result = runPolicySnapshot(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required Windows .*input/);
  assert.equal(fs.existsSync(path.join(fixture.output, policyRel)), false);
});

test('Windows policy snapshot rejects symlinks rather than treating their targets as policy content', (context) => {
  const fixture = policyFixture(context, false);
  fs.rmSync(fixture.policyPath);
  fs.symlinkSync('../../../source.txt', fixture.policyPath);
  git(fixture.workspace, 'add', policyRel);
  git(fixture.workspace, 'commit', '-qm', 'symlink policy');
  fixture.sourceCommit = git(fixture.workspace, 'rev-parse', 'HEAD');
  const result = runPolicySnapshot(fixture);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /required Windows .*input/);
  assert.equal(fs.existsSync(path.join(fixture.output, policyRel)), false);
});

for (const platform of Object.keys(calls)) {
  for (const drift of [false, true]) {
    test(`${platform} sidecar ${drift ? 'still refuses real superproject drift' : 'uses the superproject identity with a distinct desktop repository'}`, () => {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sidecar-source-'));
      try {
        const workspace = path.join(temp, 'workspace');
        const desktop = path.join(workspace, 'papercusp-desktop');
        const expected = initRepo(workspace, 'operator source');
        const desktopHead = initRepo(desktop, 'desktop source');
        assert.notEqual(expected, desktopHead);
        if (drift) {
          fs.writeFileSync(path.join(workspace, 'source.txt'), 'moved operator source');
          git(workspace, 'commit', '-qam', 'source moved');
        }
        fs.mkdirSync(path.join(desktop, 'bin'));
        fs.writeFileSync(path.join(desktop, 'bin', 'build-desktop-sidecar.sh'), [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          headGuard,
          'if [[ -n "${PAPERCUSP_SIDECAR_OUT:-}" ]]; then mkdir -p "$PAPERCUSP_SIDECAR_OUT"; printf "fixture\\n" > "$PAPERCUSP_SIDECAR_OUT/serve.mjs"; fi',
          'printf "HEAD=%s DIRTY=%s BUILD=%s TARGET=%s\\n" "$PROVENANCE_SOURCE_GIT_HEAD" "$PROVENANCE_SOURCE_GIT_DIRTY" "$PAPERCUSP_BUILD_SHA" "${TARGET_OS:-linux}"',
        ].join('\n'));
        const result = spawnSync('bash', ['-c', 'set -euo pipefail\nPC_NICE=()\n' + calls[platform]], {
          encoding: 'utf8',
          env: {
            ...process.env,
            ROOT: desktop,
            REPO_ROOT: workspace,
            EXPECTED_SOURCE_SHA: expected,
            PROVENANCE_SOURCE_GIT_HEAD: desktopHead,
            PROVENANCE_SOURCE_GIT_DIRTY: 'false',
            PAPERCUSP_BUILD_SHA: desktopHead.slice(0, 8),
            BUILD_SHA: desktopHead.slice(0, 8),
            VERSION: '0.0.19',
            MAC_SIDECAR_DIR: path.join(temp, 'darwin-sidecar'),
          },
        });
        if (drift) {
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /source HEAD moved during build/);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.match(result.stdout, new RegExp(`HEAD=${expected} DIRTY=false BUILD=${desktopHead.slice(0, 8)} TARGET=${platform === 'mac' ? 'darwin' : 'linux'}`));
        }
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}

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
const windows = fs.readFileSync(process.env.PROBE_WINDOWS_CROSS || path.join(bin, 'build-windows-cross.sh'), 'utf8');
const bootGate = fs.readFileSync(path.join(bin, 'gate-sidecar-boots.sh'), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing source boundary: ${start}`);
  return text.slice(from, to);
}

function shellFunction(text, name) {
  const definition = text.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?^\\}\\n`, 'm'))?.[0];
  assert.ok(definition, `missing shell function: ${name}`);
  return definition;
}

const calls = {
  linux: section(release, 'export PAPERCUSP_RELEASE_AUDIT=1\n', '# P-004: the exact sha'),
  mac: section(release, '    env \\\n      TARGET_OS=darwin', '    # 2) universal .app'),
};

const dependencyPreflight = section(
  release,
  '# EI-28182072788922658:',
  '# EI-21007848170102877:',
);

for (const mode of ['external-symlink', 'writable-hardlink', 'independent-copy', 'declared-snapshot']) {
  test(`release dependency preflight checks ${mode} before seed work`, (context) => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-dependency-preflight-'));
    context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    const root = path.join(fixture, 'candidate');
    const donor = path.join(fixture, 'snapshot');
    const modules = path.join(root, 'node_modules');
    const marker = path.join(fixture, 'seed-started');
    fs.mkdirSync(root);
    fs.mkdirSync(path.join(donor, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"candidate","private":true}');
    fs.writeFileSync(path.join(donor, 'package.json'), '{"name":"snapshot","private":true}');
    const dependency = path.join(donor, 'node_modules', 'dependency.js');
    fs.writeFileSync(dependency, 'module.exports = 1;\n', { mode: 0o644 });
    if (mode === 'external-symlink' || mode === 'declared-snapshot') {
      fs.symlinkSync(path.join(donor, 'node_modules'), modules, 'dir');
    } else {
      fs.mkdirSync(modules);
      if (mode === 'writable-hardlink') fs.linkSync(dependency, path.join(modules, 'dependency.js'));
      else fs.copyFileSync(dependency, path.join(modules, 'dependency.js'));
    }
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      dependencyPreflight,
      'printf "started\\n" > "$SEED_MARKER"',
    ].join('\n')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ORCHESTRATOR_HERE: bin,
        MONOREPO: root,
        PAPERCUSP_PINNED_DEPS_SNAPSHOT_ROOT: mode === 'declared-snapshot' ? donor : '',
        SEED_MARKER: marker,
      },
    });
    const accepted = mode === 'independent-copy' || mode === 'declared-snapshot';
    assert.equal(result.status, accepted ? 0 : 2, `${result.stdout}\n${result.stderr}`);
    assert.equal(fs.existsSync(marker), accepted, 'rejected dependencies must stop seed work');
    if (!accepted) assert.match(result.stderr, /refusing before seed or build mutation/);
    assert.ok(
      release.indexOf(dependencyPreflight) < release.indexOf('release_task_journal_configure()'),
      'dependency ownership must be checked before release stages can begin',
    );
  });
}

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

test('Linux AppImage exact-source salvage runs current producer logic against the frozen target root', () => {
  assert.match(release, /APPIMAGE_PRODUCER="\$ORCHESTRATOR_HERE\/build-appimage\.sh"/);
  assert.match(release, /PAPERCUSP_DESKTOP_TARGET_ROOT="\$ROOT"/);
  assert.match(release, /bash "\$APPIMAGE_PRODUCER"/);
});

test('release identity audits use current policy for every frozen artifact path', () => {
  assert.doesNotMatch(release, /\$ROOT\/bin\/audit-release-bundle\.py/);
  assert.match(release, /\$ORCHESTRATOR_HERE\/audit-release-bundle\.py" --scan-dir "\$ROOT\/src-tauri\/sidecar"/);
  assert.match(release, /\$ORCHESTRATOR_HERE\/audit-release-bundle\.py" --scan-artifact --require-source-archive "\$linux_artifact"/);
  assert.match(release, /\$ORCHESTRATOR_HERE\/audit-release-bundle\.py" --scan-artifact "\$MAC_OUT"/);
});

test('Mac exact-source release uses current producer and keeps the frozen product root', () => {
  const mac = fs.readFileSync(path.join(bin, 'build-mac-cross.sh'), 'utf8');
  assert.match(release, /MAC_PRODUCER="\$ORCHESTRATOR_HERE\/build-mac-cross\.sh"/);
  assert.match(release, /"PAPERCUSP_DESKTOP_TARGET_ROOT=\$ROOT"[\s\S]*env "\$\{mac_env\[@\]\}" bash "\$MAC_PRODUCER"/);
  assert.match(mac, /HERE="\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)"/);
  assert.match(mac, /ROOT="\$\(cd "\$\{PAPERCUSP_DESKTOP_TARGET_ROOT:-\$HERE\/\.\.\}" && pwd\)"/);
});

test('seed cut executes current tooling but exports the frozen Git source', (context) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-seed-tooling-'));
  context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const current = path.join(fixture, 'current');
  const frozen = path.join(fixture, 'frozen');
  const fakeBin = path.join(fixture, 'fake-bin');
  const receipt = path.join(fixture, 'receipt.json');
  const prepareReceipt = path.join(fixture, 'prepare-receipt');
  for (const root of [current, frozen]) {
    fs.mkdirSync(path.join(root, 'apps', 'operator'), { recursive: true });
    fs.mkdirSync(path.join(root, 'papercusp-desktop', 'bin'), { recursive: true });
  }
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'npx'), [
    '#!/usr/bin/env node',
    'const fs = require("node:fs");',
    'if (!fs.existsSync(process.env.PREPARE_RECEIPT)) process.exit(2);',
    'fs.writeFileSync(process.env.RECEIPT, JSON.stringify({ cwd: process.cwd(), policyRoot: process.env.PAPERCUSP_WORKSPACE_ROOT, args: process.argv.slice(2) }));',
    '',
  ].join('\n'), { mode: 0o755 });
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'release_seed_cut_is_quiesced() { return 0; }',
    'release_seed_sparse_refused() { return 1; }',
    'seed_uuid_row_drop_prepare() { SEED_UUID_ROW_DROP_ACTIVE=0; SEED_UUID_ROW_DROP_ARGS=(); printf "prepared\\n" > "$PREPARE_RECEIPT"; }',
    shellFunction(release, 'cut_release_seed'),
    'cut_release_seed',
  ].join('\n')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      MONOREPO: frozen,
      ROOT: path.join(frozen, 'papercusp-desktop'),
      ORCHESTRATOR_HERE: path.join(current, 'papercusp-desktop', 'bin'),
      RECEIPT: receipt,
      PREPARE_RECEIPT: prepareReceipt,
      PAPERCUSP_SKIP_SEED_CUT: '0',
      PAPERCUSP_SEED_SNAPSHOT_DIR: '',
      PAPERCUSP_SEED_REUSE_CORESTORE: '0',
      PAPERCUSP_SEED_CORESTORE: '1',
      PAPERCUSP_SEED_SPARSE: '0',
      PAPERCUSP_SEED_DEPTH: '',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const actual = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  assert.equal(actual.cwd, path.join(current, 'apps', 'operator'));
  assert.equal(actual.policyRoot, current);
  assert.equal(actual.args[actual.args.indexOf('--repo') + 1], frozen);
  assert.equal(actual.args[actual.args.indexOf('--out') + 1], path.join(frozen, 'papercusp-desktop', 'src-tauri', 'seed'));
  assert.ok(actual.args.includes('--emit-epoch-key'));
  assert.ok(!actual.args.includes('--depth'));
  assert.ok(!actual.args.includes('--sparse'));
});

test('packed-sidecar boot gate runs current producer logic against the frozen target root', () => {
  assert.match(
    release,
    /bash "\$ORCHESTRATOR_HERE\/gate-sidecar-boots\.sh" "\$ROOT\/src-tauri\/sidecar"/,
  );
  assert.doesNotMatch(release, /bash "\$ROOT\/bin\/gate-sidecar-boots\.sh"/);
});

test('release sidecar skips unused dependency generation before invoking the current producer', () => {
  const skip =
    'export PAPERCUSP_SKIP_DEP_GENERATION="${PAPERCUSP_SKIP_DEP_GENERATION:-1}"';
  const skipAt = calls.linux.indexOf(skip);
  const sidecarAt = calls.linux.indexOf('bash "$ORCHESTRATOR_HERE/build-desktop-sidecar.sh"');
  assert.ok(skipAt >= 0, 'release-local must declare the D-186 dependency-generation skip');
  assert.ok(sidecarAt > skipAt, 'the skip must reach the current sidecar builder before it starts');
  assert.match(calls.linux, /PAPERCUSP_DESKTOP_TARGET_ROOT="\$ROOT" \\\n/);
  assert.match(calls.mac, /"PAPERCUSP_DESKTOP_TARGET_ROOT=\$ROOT" \\\n/);
  assert.match(calls.mac, /bash "\$ORCHESTRATOR_HERE\/build-desktop-sidecar\.sh"/);
  assert.doesNotMatch(release, /bash "\$ROOT\/bin\/build-desktop-sidecar\.sh"/);
  assert.match(sidecar, /ROOT="\$\(cd "\$\{PAPERCUSP_DESKTOP_TARGET_ROOT:-\$HERE\/\.\.\}" && pwd\)"/);
});

test('release reserves sidecar disk before long preflights and does not double-count it in the child', () => {
  const reserveAt = release.indexOf('papercusp_require_free_gb \\\n  "$ROOT/src-tauri/sidecar"');
  const migrationAt = release.indexOf('echo "==> checking migration safety (lint:migrations)"');
  assert.ok(reserveAt >= 0, 'release-local must reserve sidecar staging space');
  assert.ok(
    migrationAt > reserveAt,
    'sidecar disk reservation must precede migration lint and boot-smoke',
  );

  const childAt = calls.linux.indexOf('bash "$ORCHESTRATOR_HERE/build-desktop-sidecar.sh"');
  const releaseAt = calls.linux.indexOf('papercusp_release_disk_reservation');
  assert.match(calls.linux, /PAPERCUSP_SIDECAR_MIN_FREE_GB=0 \\\nPROVENANCE_SOURCE_GIT_HEAD=/);
  assert.ok(childAt >= 0 && releaseAt > childAt, 'parent reservation must outlive the child build');
  assert.match(
    release,
    /cleanup_release_local\(\) \{[\s\S]*papercusp_release_disk_reservation[\s\S]*\n\}/,
  );
});

test('packed-sidecar boot gate keeps mutable database state off the bundle-isolation filesystem', () => {
  assert.match(
    bootGate,
    /STATE_BASE="\$\{PAPERCUSP_BOOT_GATE_STATE_BASE:-\$\{TMPDIR:-\/tmp\}\}"/,
  );
  assert.match(bootGate, /STATE="\$\(mktemp -d "\$STATE_BASE\/pc-bootgate-state-XXXXXX"\)"/);
  assert.match(bootGate, /HOME="\$STATE\/home"/);
  assert.match(bootGate, /PAPERCUSP_PG_DATA_DIR="\$STATE\/pgdata"/);
  assert.match(bootGate, /PAPERCUSP_DEV_SOURCE_DIR="\$STATE\/dev-source"/);
  assert.match(bootGate, /> "\$STATE\/boot\.log" 2>&1/);
  assert.match(bootGate, /rm -rf "\$ISO" "\$STATE"/);

  assert.doesNotMatch(bootGate, /PAPERCUSP_PG_DATA_DIR="\$ISO\//);
  assert.doesNotMatch(bootGate, /> "\$ISO\/boot\.log" 2>&1/);
});

test('packed-sidecar boot gate discards a partial hardlink tree before fallback copy', (context) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-gate-copy-'));
  context.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  const source = path.join(fixture, 'source sidecar');
  const iso = path.join(fixture, 'isolated root');
  const destination = path.join(iso, 'sidecar');
  const fakeBin = path.join(fixture, 'fake-bin');
  fs.mkdirSync(path.join(source, 'bin'), { recursive: true });
  fs.mkdirSync(iso, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(source, 'bin', 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  // Model GNU cp's real EXDEV shape: mkdirs and some entries exist before the
  // hardlink attempt returns non-zero. A fallback that copies into this tree
  // would create sidecar/sidecar/bin/node and leave top-level bin/node absent.
  const fakeCp = path.join(fakeBin, 'cp');
  fs.writeFileSync(fakeCp, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "${1:-}" == "-al" ]]; then',
    '  source=$2',
    '  destination=$3',
    '  mkdir -p "$destination/bin"',
    '  /bin/cp "$source/bin/node" "$destination/bin/partial"',
    '  echo "forced partial hardlink failure" >&2',
    '  exit 18',
    'fi',
    'exec /bin/cp "$@"',
    '',
  ].join('\n'), { mode: 0o755 });

  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    shellFunction(bootGate, 'stage_isolated_bundle'),
    'HARDLINKED=0',
    'stage_isolated_bundle "$SOURCE" "$DESTINATION"',
    'printf "hardlinked=%s\\n" "$HARDLINKED"',
  ].join('\n')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SOURCE: source,
      DESTINATION: destination,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /hardlinked=0/);
  assert.match(result.stderr, /forced partial hardlink failure/);
  assert.ok(fs.statSync(path.join(destination, 'bin', 'node')).mode & 0o111);
  assert.equal(fs.existsSync(path.join(destination, 'sidecar')), false, 'fallback nested the source');
  assert.equal(fs.existsSync(path.join(destination, 'bin', 'partial')), false, 'partial tree survived');
  assert.deepEqual(fs.readdirSync(iso).sort(), ['sidecar'], 'staging residue survived publication');
  assert.match(bootGate, /stage_isolated_bundle "\$SIDECAR" "\$ISO\/sidecar"/);
});

function productResourceNames(main) {
  const spawn = section(main, '\nfn spawn_serve(', '\n}');
  const headless = section(main, '\nfn run_headless_service(', '\n}');
  const launch = [spawn, headless].join('\n');
  const pathVariable = /"(PAPERCUSP_[A-Z0-9_]*(?:DIR|PATH|ROOT|ARCHIVE))"/g;
  return new Set([...launch.matchAll(pathVariable)].map(([, name]) => name));
}

test('resource discovery includes both launch paths and excludes test artifact output', () => {
  const main = `
fn spawn_serve() {
    cmd.env(
        "PAPERCUSP_NEW_DIR", bundle);
    cmd.envs([("PAPERCUSP_NEW_ROOT", root)]);
}
fn run_headless_service() {
    std::env::var_os("PAPERCUSP_NEW_PATH");
}
#[test]
fn writes_artifact() {
    std::env::var_os("PAPERCUSP_TEST_ARTIFACT_DIR");
}
`;
  assert.deepEqual([...productResourceNames(main)].sort(), [
    'PAPERCUSP_NEW_DIR', 'PAPERCUSP_NEW_PATH', 'PAPERCUSP_NEW_ROOT',
  ]);
});

test('packed-sidecar boot gate passes every product resource path into the isolated sidecar', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
  // Keep this assertion derived from the production source: adding a path to
  // spawn_serve or the headless service must fail this test until the hermetic
  // packed gate forwards it too.
  const gateLaunch = bootGate.slice(
    bootGate.indexOf('  env -i \\\n'),
    bootGate.indexOf('    "$B_NODE" "$B/serve.mjs"', bootGate.indexOf('  env -i \\\n')),
  );
  assert.ok(gateLaunch.length > 0, 'could not isolate the gate launch environment');
  for (const name of productResourceNames(main)) {
    assert.match(gateLaunch, new RegExp(`${name}=`), `${name} is omitted from the gate env`);
  }

  assert.match(gateLaunch, /PAPERCUSP_GOAL_PACKAGES_DIR="\$B\/goal-packages"/);
  assert.match(gateLaunch, /PAPERCUSP_IDENTITY_DIR="\$STATE\/home\/\.papercusp-workspaces\/\.shared\/\.papercusp\/identity"/);
  assert.match(gateLaunch, /PAPERCUSP_SIDECAR_DIR="\$B"/);
  assert.match(gateLaunch, /PAPERCUSP_TEMPLATES_DIR="\$B\/templates"/);
  assert.match(gateLaunch, /PAPERCUSP_WORKSPACES_ROOT="\$STATE\/home\/\.papercusp-workspaces"/);
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
const policySourcePin = section(windows, 'BUILD_SUPERPROJECT_COMMIT_SHA=', '\nif [[ -n "${PAPERCUSP_BUILD_SHA');

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

function runPolicySnapshot(fixture, { sourceCommit = fixture.sourceCommit, afterPin = '' } = {}) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'fail() { echo "ERROR: $*" >&2; exit 1; }',
    policySourcePin,
    afterPin,
    policySnapshot,
    'copy_superproject_snapshot_blob "$POLICY_REL"',
  ].join('\n')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SUPERPROJECT_ROOT: fixture.workspace,
      PAPERCUSP_EXPECTED_SOURCE_SHA: sourceCommit,
      BUILD_CONTAINER: fixture.output,
      POLICY_REL: policyRel,
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

test('Windows policy snapshot pins HEAD once when no exact source override is supplied', (context) => {
  const fixture = policyFixture(context, false);
  const afterPin = [
    'printf "newer committed policy\\n" > "$SUPERPROJECT_ROOT/$POLICY_REL"',
    'git -C "$SUPERPROJECT_ROOT" commit -qam "advance after pin"',
  ].join('\n');
  const result = runPolicySnapshot(fixture, { sourceCommit: '', afterPin });
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(git(fixture.workspace, 'rev-parse', 'HEAD'), fixture.sourceCommit);
  assert.equal(fs.readFileSync(path.join(fixture.output, policyRel), 'utf8'), fixture.policy);
});

test('Windows policy snapshot refuses an invalid source override without falling back to HEAD', (context) => {
  const fixture = policyFixture(context);
  const result = runPolicySnapshot(fixture, { sourceCommit: 'missing-source-commit' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not resolve the Windows superproject source commit/);
  assert.equal(fs.existsSync(path.join(fixture.output, policyRel)), false);
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
        const orchestratorBin = path.join(temp, 'orchestrator', 'bin');
        fs.mkdirSync(orchestratorBin, { recursive: true });
        fs.writeFileSync(path.join(desktop, 'bin', 'build-desktop-sidecar.sh'), 'exit 97 # frozen builder must not run\n');
        fs.writeFileSync(path.join(orchestratorBin, 'build-desktop-sidecar.sh'), [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          headGuard,
          'if [[ -n "${PAPERCUSP_SIDECAR_OUT:-}" ]]; then mkdir -p "$PAPERCUSP_SIDECAR_OUT"; printf "fixture\\n" > "$PAPERCUSP_SIDECAR_OUT/serve.mjs"; fi',
          'printf "HEAD=%s DIRTY=%s BUILD=%s TARGET=%s SKIP_DEP_GENERATION=%s\\n" "$PROVENANCE_SOURCE_GIT_HEAD" "$PROVENANCE_SOURCE_GIT_DIRTY" "$PAPERCUSP_BUILD_SHA" "${TARGET_OS:-linux}" "${PAPERCUSP_SKIP_DEP_GENERATION:-}"',
        ].join('\n'));
        const result = spawnSync(
          'bash',
          [
            '-c',
            'set -euo pipefail\nPC_NICE=()\npapercusp_release_disk_reservation() { :; }\n' +
              calls[platform],
          ],
          {
          encoding: 'utf8',
          env: {
            ...process.env,
            // calls.mac is an isolated later section of release-local.sh. In the
            // real script it inherits the global export from calls.linux above.
            ...(platform === 'mac' ? { PAPERCUSP_SKIP_DEP_GENERATION: '1' } : {}),
            ROOT: desktop,
            ORCHESTRATOR_HERE: orchestratorBin,
            REPO_ROOT: workspace,
            EXPECTED_SOURCE_SHA: expected,
            PROVENANCE_SOURCE_GIT_HEAD: desktopHead,
            PROVENANCE_SOURCE_GIT_DIRTY: 'false',
            PAPERCUSP_BUILD_SHA: desktopHead.slice(0, 8),
            BUILD_SHA: desktopHead.slice(0, 8),
            VERSION: '0.0.19',
            MAC_SIDECAR_DIR: path.join(temp, 'darwin-sidecar'),
          },
          },
        );
        if (drift) {
          assert.notEqual(result.status, 0);
          assert.match(result.stderr, /source HEAD moved during build/);
        } else {
          assert.equal(result.status, 0, result.stderr);
          assert.match(
            result.stdout,
            new RegExp(
              `HEAD=${expected} DIRTY=false BUILD=${desktopHead.slice(0, 8)} TARGET=${platform === 'mac' ? 'darwin' : 'linux'} SKIP_DEP_GENERATION=1`,
            ),
          );
        }
      } finally {
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}

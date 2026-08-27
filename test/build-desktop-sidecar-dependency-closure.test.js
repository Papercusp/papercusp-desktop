// EI-21574140812992625 — the sidecar dependency copier must preserve npm's
// source topology. A package name is not an identity: lost-pixel carries a
// nested posthog-node@3.5.0 (which requires rusha) while the monorepo also has a
// top-level posthog-node@5.x (which does not). Resolving the nested dependency by
// name alone produced a signed Server bundle that installed but could not boot.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const builderPath = process.env.PROBE_SCRIPT
  || path.join(desktopRoot, 'bin/build-desktop-sidecar.sh');
const builder = fs.readFileSync(builderPath, 'utf8');

/** Slice one top-level shell helper from the real builder. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `${name}() is missing from build-desktop-sidecar.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const RESOLVE_PKG_SOURCE = extractFunction('resolve_pkg_source');
const PKG_DEST_FOR_SOURCE = extractFunction('pkg_dest_for_source');
const COPY_PKG_CLOSURE = extractFunction('copy_pkg_closure');
const ASSERT_RUNTIME_DEPENDENCY_CLOSURE = extractFunction(
  'assert_runtime_dependency_closure',
);

function writePackage(dir, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = true;\n');
}

function makeFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-closure-'));
  const repoRoot = path.join(fixtureRoot, 'repo');
  const sidecarDir = path.join(fixtureRoot, 'sidecar');
  const nodeModules = path.join(repoRoot, 'node_modules');

  fs.mkdirSync(path.join(repoRoot, 'apps/operator'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'papercusp-desktop'), { recursive: true });
  fs.mkdirSync(path.join(sidecarDir, 'node_modules'), { recursive: true });

  writePackage(path.join(nodeModules, 'posthog-node'), {
    name: 'posthog-node',
    version: '5.36.15',
    dependencies: {},
  });
  writePackage(path.join(nodeModules, 'lost-pixel'), {
    name: 'lost-pixel',
    version: '3.22.0',
    dependencies: {
      'posthog-node': '3.5.0',
      'onnxruntime-web': '1.0.0',
    },
  });
  writePackage(path.join(nodeModules, 'lost-pixel/node_modules/posthog-node'), {
    name: 'posthog-node',
    version: '3.5.0',
    dependencies: { rusha: '^0.8.14' },
  });
  writePackage(path.join(nodeModules, 'rusha'), {
    name: 'rusha',
    version: '0.8.14',
  });
  // Parent copies can smuggle a skipped nested package into the destination.
  // Its unresolved dependencies must not force an exception in the final-tree
  // guard; the existing browser-only rule promises to omit this package itself.
  writePackage(path.join(nodeModules, 'lost-pixel/node_modules/onnxruntime-web'), {
    name: 'onnxruntime-web',
    version: '1.0.0',
    dependencies: { 'browser-only-missing-dep': '1.0.0' },
  });

  return { fixtureRoot, repoRoot, sidecarDir };
}

function shellPrelude() {
  return [
    'set -euo pipefail',
    'REPO_ROOT="$FIXTURE_REPO_ROOT"',
    'WEB_DIR="$REPO_ROOT/apps/operator"',
    'ROOT="$REPO_ROOT/papercusp-desktop"',
    'SIDECAR_DIR="$FIXTURE_SIDECAR_DIR"',
    'nat_copied=0',
    'nat_missing=0',
    '_seen="|"',
    'prune_transformers_model_fragments() { :; }',
    'prune_foreign_prebuilds() { :; }',
    'prune_foreign_onnx_bins() { :; }',
    'prune_onnx_gpu_providers() { :; }',
    RESOLVE_PKG_SOURCE,
    PKG_DEST_FOR_SOURCE,
  ].join('\n');
}

function runBash(script, fixture) {
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      FIXTURE_REPO_ROOT: fixture.repoRoot,
      FIXTURE_SIDECAR_DIR: fixture.sidecarDir,
    },
  });
}

function readVersion(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

test('closure preserves nested package identity and follows its hoisted dependency', () => {
  const fixture = makeFixture();
  try {
    const result = runBash(
      [
        shellPrelude(),
        COPY_PKG_CLOSURE,
        ASSERT_RUNTIME_DEPENDENCY_CLOSURE,
        // Traverse the top-level version first. A name-keyed seen-set would now
        // suppress the nested 3.5.0 traversal when lost-pixel is copied.
        'copy_pkg_closure posthog-node',
        'copy_pkg_closure lost-pixel',
        'assert_runtime_dependency_closure "$SIDECAR_DIR"',
        'printf "missing=%s\\n" "$nat_missing"',
      ].join('\n'),
      fixture,
    );

    assert.equal(
      result.status,
      0,
      `source-aware closure failed (status ${result.status}):\n${result.stdout}${result.stderr}`,
    );
    assert.match(result.stdout, /missing=0/);

    const installed = path.join(fixture.sidecarDir, 'node_modules');
    assert.equal(readVersion(path.join(installed, 'posthog-node')), '5.36.15');
    assert.equal(
      readVersion(path.join(installed, 'lost-pixel/node_modules/posthog-node')),
      '3.5.0',
    );
    assert.equal(readVersion(path.join(installed, 'rusha')), '0.8.14');
    assert.equal(
      fs.existsSync(path.join(installed, 'lost-pixel/node_modules/onnxruntime-web')),
      false,
      'the browser-only package must be removed even when a parent copy brought it across',
    );
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('assembled-tree guard fails closed and names a nested package missing its dependency', () => {
  const fixture = makeFixture();
  try {
    const copy = runBash(
      [shellPrelude(), COPY_PKG_CLOSURE, 'copy_pkg_closure lost-pixel'].join('\n'),
      fixture,
    );
    assert.equal(copy.status, 0, `${copy.stdout}${copy.stderr}`);

    fs.rmSync(path.join(fixture.sidecarDir, 'node_modules/rusha'), {
      recursive: true,
      force: true,
    });
    const guarded = runBash(
      [shellPrelude(), ASSERT_RUNTIME_DEPENDENCY_CLOSURE, 'assert_runtime_dependency_closure "$SIDECAR_DIR"'].join('\n'),
      fixture,
    );

    assert.equal(guarded.status, 1, 'the guard must reject an unresolved required dependency');
    assert.match(guarded.stderr, /unresolved runtime dependencies/i);
    assert.match(guarded.stderr, /lost-pixel\/node_modules\/posthog-node@3\.5\.0 -> rusha/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('the assembled-tree dependency guard is wired into every sidecar build', () => {
  assert.match(
    builder,
    /^assert_runtime_dependency_closure "\$SIDECAR_DIR" \|\| exit 1$/m,
  );
});

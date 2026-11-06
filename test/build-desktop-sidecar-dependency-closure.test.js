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
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const desktopRoot = path.resolve(__dirname, '..');
const runtimePackaging = import(pathToFileURL(path.join(desktopRoot, 'bin/lib/handler-runtime-package.mjs')).href);
const builderPath = process.env.PROBE_SCRIPT
  || path.join(desktopRoot, 'bin/build-desktop-sidecar.sh');
const builder = fs.readFileSync(builderPath, 'utf8') + '\n'
  + fs.readFileSync(process.env.PROBE_CLOSURE_SCRIPT || path.join(desktopRoot, 'bin/lib/host-runtime-closure.sh'), 'utf8');

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
const PRUNE_NPM_RETIRED_PACKAGES = extractFunction('prune_npm_retired_packages');
const PRUNE_UNUSED_ODIFF_PAYLOAD = extractFunction('prune_unused_odiff_payload');
const ASSERT_RUNTIME_DEPENDENCY_CLOSURE = extractFunction(
  'assert_runtime_dependency_closure',
);
const COPY_HOST_RUNTIME_REQUIRE_CLOSURES = extractFunction(
  'copy_host_runtime_require_closures',
);

function findPackageRoot(entry, name) {
  let dir = path.dirname(entry);
  while (true) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name === name) {
      return dir;
    }
    const parent = path.dirname(dir);
    assert.notEqual(parent, dir, `${name} package root was not found above ${entry}`);
    dir = parent;
  }
}

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
      'odiff-bin': '2.6.1',
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
  const odiff = path.join(nodeModules, 'odiff-bin');
  writePackage(odiff, { name: 'odiff-bin', version: '2.6.1', main: 'odiff.js' });
  // The published JS wrapper eagerly imports without opening its native files.
  fs.copyFileSync(require.resolve('odiff-bin'), path.join(odiff, 'odiff.js'));
  for (const rel of ['bin/odiff', '_export/native.tar.gz',
    '3/i/odiff-33ddbef3/bin/ODiffBin', '3/i/odiff-33ddbef3/bin/RunTests.exe',
    'platform-linux/bin/odiff', 'platform-darwin/bin/odiff']) {
    fs.mkdirSync(path.dirname(path.join(odiff, rel)), { recursive: true });
    fs.writeFileSync(path.join(odiff, rel), 'unused native engine payload');
  }
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
    PRUNE_UNUSED_ODIFF_PAYLOAD,
    PRUNE_NPM_RETIRED_PACKAGES,
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
    assert.equal(readVersion(path.join(installed, 'odiff-bin')), '2.6.1');
    for (const rel of ['bin', '_export', '3', 'platform-linux', 'platform-darwin']) {
      assert.equal(fs.existsSync(path.join(installed, 'odiff-bin', rel)), false, rel);
      assert.equal(fs.existsSync(path.join(fixture.repoRoot, 'node_modules/odiff-bin', rel)), true,
        'the dependency donor must remain untouched');
    }
    assert.equal(
      fs.existsSync(path.join(installed, 'lost-pixel/node_modules/onnxruntime-web')),
      false,
      'the browser-only package must be removed even when a parent copy brought it across',
    );
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('packaged plan guard resolves shell-quote without checkout node_modules', () => {
  const fixture = makeFixture();
  try {
    const parserRoot = findPackageRoot(require.resolve('shell-quote'), 'shell-quote');
    const parserDonor = path.join(fixture.repoRoot, 'node_modules/shell-quote');
    fs.cpSync(parserRoot, parserDonor, { recursive: true });
    const entry = path.join(fixture.sidecarDir, 'serve.mjs');
    fs.writeFileSync(entry, `
      import assert from 'node:assert/strict';
      import { createRequire } from 'node:module';
      const require = createRequire(import.meta.url);
      const resolved = require.resolve('shell-quote');
      assert.ok(resolved.startsWith(${JSON.stringify(fixture.sidecarDir + path.sep)}), resolved);
      assert.deepEqual(require('shell-quote').parse('cat "two words" && pwd'),
        ['cat', 'two words', { op: '&&' }, 'pwd']);
    `);
    const runProbe = () => spawnSync(process.execPath, [entry], {
      cwd: fixture.fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    });
    const missing = runProbe();
    assert.notEqual(missing.status, 0, missing.stdout);
    assert.match(missing.stderr, /Cannot find module 'shell-quote'/);

    const realCopier = COPY_PKG_CLOSURE.replace(
      /^copy_pkg_closure\(\) \{/,
      'copy_pkg_closure_real() {',
    );
    assert.notEqual(realCopier, COPY_PKG_CLOSURE);
    const copied = runBash([
      shellPrelude(), realCopier,
      'copy_pkg_closure() { [[ "$1" == "shell-quote" ]] && copy_pkg_closure_real "$1" || [[ "$1" != "shell-quote" ]]; }',
      COPY_HOST_RUNTIME_REQUIRE_CLOSURES,
      'copy_host_runtime_require_closures',
    ].join('\n'), fixture);
    assert.equal(copied.status, 0, copied.stdout + copied.stderr);
    const installed = runProbe();
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('packaged PSU Codex resume resolves the actual TOML parser without checkout node_modules', () => {
  const fixture = makeFixture();
  try {
    const papercuspRoot = path.resolve(desktopRoot, '..');
    const ptyHostSource = path.join(papercuspRoot, 'apps/operator/scripts/psu-pty-host.mjs');
    const tomlEntry = require.resolve('@iarna/toml');
    const tomlRoot = findPackageRoot(tomlEntry, '@iarna/toml');
    const tomlDonor = path.join(fixture.repoRoot, 'node_modules/@iarna/toml');

    const bundledHost = path.join(fixture.sidecarDir, 'scripts/psu-pty-host.mjs');
    fs.mkdirSync(path.dirname(bundledHost), { recursive: true });
    require('esbuild').buildSync({
      entryPoints: [ptyHostSource],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      external: ['@iarna/toml', '@lydell/*'],
      outfile: bundledHost,
      logLevel: 'silent',
    });

    const codexHome = path.join(fixture.fixtureRoot, 'codex-home');
    const runProbe = () => spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import path from 'node:path';
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const [entry, codexHome, cwd, sidecarModules] = process.argv.slice(1);
      const host = await import(pathToFileURL(entry));
      const stateHome = host.prepareCodexSqliteHome({
        env: { PAPERCUSP_AGENT: 'codex', CODEX_HOME: codexHome },
        cwd,
      });
      assert.equal(stateHome, path.resolve(cwd, codexHome));
      const resolvedParser = createRequire(entry).resolve('@iarna/toml');
      assert.ok(resolvedParser.startsWith(sidecarModules + path.sep), resolvedParser);
      console.log('isolated Codex TOML resume preflight passed');
    `, bundledHost, codexHome, fixture.fixtureRoot, path.join(fixture.sidecarDir, 'node_modules')], {
      cwd: fixture.fixtureRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    });
    const withoutClosure = runProbe();
    assert.notEqual(withoutClosure.status, 0, withoutClosure.stdout);
    assert.match(withoutClosure.stderr, /Cannot find module '@iarna\/toml'/);

    // Run the production closure list, while keeping unrelated runtime roots
    // inert. The @iarna/toml entry still goes through the actual package copier.
    fs.cpSync(tomlRoot, tomlDonor, { recursive: true });
    const realCopier = COPY_PKG_CLOSURE.replace(
      /^copy_pkg_closure\(\) \{/,
      'copy_pkg_closure_real() {',
    );
    assert.notEqual(realCopier, COPY_PKG_CLOSURE, 'the real copier was renamed for the focused closure probe');
    const copied = runBash([
      shellPrelude(),
      realCopier,
      'copy_pkg_closure() { [[ "$1" == "@iarna/toml" ]] && copy_pkg_closure_real "$1" || [[ "$1" != "@iarna/toml" ]]; }',
      COPY_HOST_RUNTIME_REQUIRE_CLOSURES,
      'copy_host_runtime_require_closures',
      ASSERT_RUNTIME_DEPENDENCY_CLOSURE,
      'assert_runtime_dependency_closure "$SIDECAR_DIR"',
    ].join('\n'), fixture);
    assert.equal(copied.status, 0, copied.stdout + copied.stderr);
    assert.equal(
      fs.existsSync(path.join(fixture.sidecarDir, 'node_modules/@iarna/toml/package.json')),
      true,
      copied.stdout + copied.stderr,
    );
    const probe = runProbe();
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.match(probe.stdout, /isolated Codex TOML resume preflight passed/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('pruned odiff preserves the real eager import and pixelmatch comparison without native dispatch', () => {
  const fixture = makeFixture();
  try {
    const result = runBash([shellPrelude(), COPY_PKG_CLOSURE,
      'copy_pkg_closure lost-pixel'].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const copiedWrapper = path.join(fixture.sidecarDir, 'node_modules/odiff-bin/odiff.js');
    const sourceWrapper = path.join(fixture.repoRoot, 'node_modules/odiff-bin/odiff.js');
    assert.deepEqual(fs.readFileSync(copiedWrapper), fs.readFileSync(sourceWrapper));
    const probe = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const Module = require('node:module');
      require('node:child_process').execFile = () => { throw new Error('native dispatch forbidden'); };
      const originalLoad = Module._load;
      let imports = 0;
      Module._load = function(request, parent, main) {
        if (request === 'odiff-bin') { imports++; request = process.argv[1]; }
        return originalLoad.call(this, request, parent, main);
      };
      const comparator = require(process.argv[2]);
      assert.equal(imports, 1, 'the actual lost-pixel importer must load the pruned odiff wrapper');
      const { PNG } = require('pngjs');
      const baseline = new PNG({width: 1, height: 1});
      const current = new PNG({width: 1, height: 1});
      baseline.data.set([0, 0, 0, 255]); current.data.set([255, 255, 255, 255]);
      const base = path.join(process.argv[3], 'base.png');
      const next = path.join(process.argv[3], 'next.png');
      const diff = path.join(process.argv[3], 'diff.png');
      fs.writeFileSync(base, PNG.sync.write(baseline));
      fs.writeFileSync(next, PNG.sync.write(current));
      comparator.compareImagesViaPixelmatch(0, base, next, diff).then(result => {
        assert.equal(result.pixelDifference, 1);
        assert.equal(result.isWithinThreshold, false);
        assert.ok(fs.existsSync(diff));
        console.log('real pixelmatch passed with pruned eager-import odiff');
      }).catch(error => { console.error(error); process.exitCode = 1; });
    `, copiedWrapper, require.resolve('lost-pixel/dist/compare/compare.js'), fixture.fixtureRoot],
    { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stdout + probe.stderr);
    assert.match(probe.stdout, /real pixelmatch passed/);
  } finally { fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }); }
});

test('odiff pruning removes the nested esy engine while inventory rejects other foreign payloads', async () => {
  const fixture = makeFixture();
  try {
    const { sidecarInventory } = await import('../bin/lib/server-container.mjs');
    const relativeEngine = 'node_modules/odiff-bin/3/i/odiff-33ddbef3/bin/ODiffBin';
    const sourceEngine = path.join(fixture.repoRoot, relativeEngine);
    // ELF64 little-endian x86-64, as shipped in odiff's esy installation store.
    const foreignElf = Buffer.alloc(64);
    foreignElf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    foreignElf.writeUInt16LE(62, 18);
    fs.writeFileSync(sourceEngine, foreignElf, { mode: 0o755 });
    const installedOdiff = path.join(fixture.sidecarDir, 'node_modules/odiff-bin');
    fs.cpSync(path.join(fixture.repoRoot, 'node_modules/odiff-bin'), installedOdiff,
      { recursive: true });
    await assert.rejects(sidecarInventory(fixture.sidecarDir, 'linux/arm64'),
      /Native payload architecture mismatch: .*3\/i\/odiff-33ddbef3\/bin\/ODiffBin/);
    const result = runBash([shellPrelude(),
      'prune_unused_odiff_payload "$SIDECAR_DIR/node_modules/odiff-bin"'].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(installedOdiff, '3')), false);
    assert.deepEqual(fs.readFileSync(sourceEngine), foreignElf, 'donor stays intact');
    await sidecarInventory(fixture.sidecarDir, 'linux/arm64');
    const unexpected = path.join(installedOdiff, 'unexpected.node');
    fs.writeFileSync(unexpected, foreignElf);
    const again = runBash([shellPrelude(),
      'prune_unused_odiff_payload "$SIDECAR_DIR/node_modules/odiff-bin"'].join('\n'), fixture);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.deepEqual(fs.readFileSync(unexpected), foreignElf);
    await assert.rejects(sidecarInventory(fixture.sidecarDir, 'linux/arm64'),
      /Native payload architecture mismatch: .*unexpected\.node/);
  } finally { fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }); }
});

test('odiff prune follows distinct nested requester versions and refuses a different package', () => {
  const fixture = makeFixture();
  try {
    const nested = path.join(fixture.repoRoot, 'node_modules/lost-pixel/node_modules/odiff-bin');
    fs.cpSync(path.join(fixture.repoRoot, 'node_modules/odiff-bin'), nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({name: 'odiff-bin', version: '2.5.0'}));
    const result = runBash([shellPrelude(), COPY_PKG_CLOSURE,
      'copy_pkg_closure odiff-bin', 'copy_pkg_closure lost-pixel'].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const modules = path.join(fixture.sidecarDir, 'node_modules');
    assert.equal(readVersion(path.join(modules, 'odiff-bin')), '2.6.1');
    assert.equal(readVersion(path.join(modules, 'lost-pixel/node_modules/odiff-bin')), '2.5.0');
    assert.equal(fs.existsSync(path.join(modules, 'lost-pixel/node_modules/odiff-bin/platform-linux')), false);
    assert.equal(fs.existsSync(path.join(modules, 'lost-pixel/node_modules/odiff-bin/3')), false);
    const wrong = runBash([shellPrelude(),
      'prune_unused_odiff_payload "$REPO_ROOT/node_modules/rusha"'].join('\n'), fixture);
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /refusing odiff payload prune/);
  } finally { fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true }); }
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

test('closure drops npm retirement siblings without changing active packages or their donor', () => {
  const fixture = makeFixture();
  try {
    const source = path.join(fixture.repoRoot, 'node_modules/lost-pixel');
    const retired = ['node_modules/.serialize-error-GEVqaDCA',
      'node_modules/@old/.yargs-u56b5csX'];
    for (const rel of retired) {
      writePackage(path.join(source, rel), { name: 'retired', version: '1.0.0',
        dependencies: { 'only-the-retired-version-required-this': '1.0.0' } });
    }
    const keep = ['node_modules/.bin/tool', '.assets-ABCDEFGH/data',
      'node_modules/.settings/config'];
    for (const rel of keep) {
      fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
      fs.writeFileSync(path.join(source, rel), 'keep');
    }
    const result = runBash([shellPrelude(), COPY_PKG_CLOSURE,
      ASSERT_RUNTIME_DEPENDENCY_CLOSURE, 'copy_pkg_closure lost-pixel',
      'assert_runtime_dependency_closure "$SIDECAR_DIR"'].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const copied = path.join(fixture.sidecarDir, 'node_modules/lost-pixel');
    for (const rel of retired) {
      assert.equal(fs.existsSync(path.join(copied, rel)), false, rel);
      assert.equal(fs.existsSync(path.join(source, rel, 'package.json')), true,
        'retired residue in the dependency donor must remain untouched');
    }
    for (const rel of keep) {
      assert.equal(fs.readFileSync(path.join(copied, rel), 'utf8'), 'keep', rel);
    }
    assert.equal(readVersion(path.join(copied, 'node_modules/posthog-node')), '3.5.0');
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('the assembled-tree dependency guard is wired into every sidecar build', () => {
  assert.match(
    builder,
    /^assert_runtime_dependency_closure "\$SIDECAR_DIR" \|\| exit 1$/m,
  );
  assert.match(builder, /^copy_host_external_closures \|\| exit 1$/m);
});

test('shared host externals ship their package roots and transitive dependencies', () => {
  const fixture = makeFixture();
  try {
    const name = '@opentelemetry/context-async-hooks';
    const source = path.join(fixture.repoRoot, 'node_modules', name);
    writePackage(source, { name, version: '2.12.0',
      dependencies: { 'otel-runtime-dep': '1.0.0' },
      peerDependencies: { '@opentelemetry/api': '^1.0.0', 'otel-optional-peer': '1.0.0' },
      peerDependenciesMeta: { 'otel-optional-peer': { optional: true } },
      devDependencies: { 'otel-dev-only': '1.0.0' },
    });
    fs.writeFileSync(path.join(source, 'index.js'),
      "module.exports = require('otel-runtime-dep') && require('@opentelemetry/api');\n");
    writePackage(path.join(fixture.repoRoot, 'node_modules/otel-runtime-dep'), {
      name: 'otel-runtime-dep', version: '1.0.0',
    });
    writePackage(path.join(fixture.repoRoot, 'node_modules/@opentelemetry/api'), {
      name: '@opentelemetry/api', version: '1.0.0',
    });
    const result = runBash([
      shellPrelude(), COPY_PKG_CLOSURE, extractFunction('copy_host_external_closures'),
      'HOST_COMMON_EXTERNALS=(--external:@opentelemetry/context-async-hooks --external:@opentelemetry/context-async-hooks/subpath --external:fsevents "--external:@lydell/*")',
      'copy_host_external_closures',
      'printf "copied=%s missing=%s\\n" "$nat_copied" "$nat_missing"',
    ].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /copied=3 missing=0/);
    const { createRequire } = require('node:module');
    const bundledRequire = createRequire(path.join(fixture.sidecarDir, 'serve.mjs'));
    const entry = bundledRequire.resolve(name);
    assert.ok(fs.realpathSync(entry).startsWith(fixture.sidecarDir + path.sep), entry);
    const transitive = createRequire(entry).resolve('otel-runtime-dep');
    assert.ok(fs.realpathSync(transitive).startsWith(fixture.sidecarDir + path.sep), transitive);
    const peer = createRequire(entry).resolve('@opentelemetry/api');
    assert.ok(fs.realpathSync(peer).startsWith(fixture.sidecarDir + path.sep), peer);
    assert.equal(bundledRequire(name), true);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('assembled-tree guard rejects a missing required peer without requiring optional peers', () => {
  const fixture = makeFixture();
  try {
    writePackage(path.join(fixture.sidecarDir, 'node_modules/peer-consumer'), {
      name: 'peer-consumer', version: '1.0.0',
      peerDependencies: { 'runtime-peer': '1.0.0', 'optional-peer': '1.0.0' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    });
    const check = () => runBash([shellPrelude(), ASSERT_RUNTIME_DEPENDENCY_CLOSURE,
      'assert_runtime_dependency_closure "$SIDECAR_DIR"'].join('\n'), fixture);
    const missing = check();
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stderr, /peer-consumer@1\.0\.0 -> runtime-peer/);
    assert.doesNotMatch(missing.stderr, /-> optional-peer/);
    writePackage(path.join(fixture.sidecarDir, 'node_modules/runtime-peer'), {
      name: 'runtime-peer', version: '1.0.0',
    });
    const complete = check();
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test('closure follows installed optional peers and their own runtime dependencies', () => {
  const fixture = makeFixture();
  try {
    const modules = path.join(fixture.repoRoot, 'node_modules');
    writePackage(path.join(modules, 'peer-consumer'), {
      name: 'peer-consumer', version: '1.0.0',
      peerDependencies: { 'optional-peer': '1.0.0' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    });
    writePackage(path.join(modules, 'optional-peer'), {
      name: 'optional-peer', version: '1.0.0', dependencies: { 'peer-runtime-dep': '1.0.0' },
    });
    writePackage(path.join(modules, 'peer-runtime-dep'), {
      name: 'peer-runtime-dep', version: '1.0.0',
    });
    fs.writeFileSync(path.join(modules, 'optional-peer/index.js'),
      "module.exports = require('peer-runtime-dep');\n");
    fs.writeFileSync(path.join(modules, 'peer-consumer/index.js'),
      "module.exports = require('optional-peer');\n");
    const result = runBash([shellPrelude(), COPY_PKG_CLOSURE,
      'copy_pkg_closure peer-consumer'].join('\n'), fixture);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const { createRequire } = require('node:module');
    const bundled = createRequire(path.join(fixture.sidecarDir, 'serve.mjs'));
    assert.equal(bundled('peer-consumer'), true);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

// Real ELF inspection and a relocated guest exercise the packaging extension.
// This is development component proof, not signed installed-artifact approval.
function handlerPackageFixture(t) {
  assert.equal(process.platform, 'linux', 'Linux packaging test needs its Linux runner');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-handler-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const loader = createRequire(path.join(desktopRoot, '../packages/plugin-loader/package.json'));
  const koffi = path.dirname(loader.resolve('koffi'));
  const addon = path.join(path.dirname(loader.resolve('@koromix/koffi-linux-' + process.arch)),
    'linux_' + process.arch, 'koffi.node');
  const triplet = process.arch === 'x64' ? 'x86_64-linux-gnu' : 'aarch64-linux-gnu';
  const bootstrap = path.join(root, 'bootstrap.cjs');
  fs.writeFileSync(bootstrap, `const k = require('koffi');
    const arch = k.load('libseccomp.so.2').func('seccomp_arch_native', 'uint32_t', []);
    console.log('RUNTIME_READY:' + arch());`);
  return { root, node: process.execPath, bootstrap, koffi, addon, arch: process.arch,
    output: path.join(root, 'package'), libraryDirs: ['/lib/' + triplet, '/usr/lib/' + triplet] };
}

test('handler runtime package executes Node and Koffi from only its relocated library closure', async t => {
  const f = handlerPackageFixture(t);
  const { stageHandlerRuntime } = await runtimePackaging;
  const inventory = stageHandlerRuntime(f);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(inventory.sha256, digest(JSON.stringify(inventory.files)));
  assert.equal(inventory.bootstrapSha256, digest(fs.readFileSync(f.bootstrap)));
  for (const file of inventory.files) {
    const packaged = path.join(f.output, file.path.slice(1));
    assert.equal(digest(fs.readFileSync(packaged)), file.sha256, file.path);
    assert.equal(fs.statSync(packaged).mode & 0o777, file.executable ? 0o555 : 0o444);
  }
  const relocated = path.join(f.root, 'relocated');
  fs.renameSync(f.output, relocated);
  const mounts = ['runtime', 'lib', 'lib64'].filter(dir => fs.existsSync(path.join(relocated, dir)))
    .flatMap(dir => ['--ro-bind', path.join(relocated, dir), '/' + dir]);
  const result = spawnSync('/usr/bin/bwrap', ['--unshare-all', '--die-with-parent', '--clearenv',
    '--tmpfs', '/', ...mounts, '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
    '--chdir', '/tmp', '--', '/runtime/node', '--no-global-search-paths', '/runtime/bootstrap.cjs'],
  { encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/bin:/bin' } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.trim(), 'RUNTIME_READY:' + (process.arch === 'x64' ? 0xc000003e : 0xc00000b7));
  assert.doesNotMatch(JSON.stringify(inventory), new RegExp(f.root));
  assert.equal(inventory.files.some(file => file.path.includes('static.cjs')), true);
});

test('handler runtime package refuses a missing transitive ELF edge without running constructors or publishing', async t => {
  const f = handlerPackageFixture(t);
  const libs = path.join(f.root, 'libs'); fs.mkdirSync(libs);
  const marker = path.join(f.root, 'EXECUTED');
  const dep = path.join(f.root, 'dep.c'), shim = path.join(f.root, 'shim.c');
  fs.writeFileSync(dep, 'int dep(void) { return 7; }');
  fs.writeFileSync(shim, `#include <stdio.h>\nextern int dep(void);
    __attribute__((constructor)) void start(void) { fclose(fopen("${marker}", "w")); }
    int wrapper(void) { return dep(); }`);
  for (const args of [
    ['-shared', '-fPIC', dep, '-Wl,-soname,libhandlerdep.so.1', '-o', path.join(libs, 'libhandlerdep.so.1')],
    ['-shared', '-fPIC', shim, '-L' + libs, '-l:libhandlerdep.so.1', '-Wl,-soname,libseccomp.so.2', '-o', path.join(libs, 'libseccomp.so.2')],
  ]) {
    const compiled = spawnSync('/usr/bin/gcc', args, { encoding: 'utf8' });
    assert.equal(compiled.status, 0, compiled.stderr);
  }
  fs.unlinkSync(path.join(libs, 'libhandlerdep.so.1'));
  const { stageHandlerRuntime } = await runtimePackaging;
  assert.throws(() => stageHandlerRuntime({ ...f, libraryDirs: [libs, ...f.libraryDirs] }), /missing target ELF dependency: libhandlerdep.so.1/);
  assert.equal(fs.existsSync(marker), false, 'candidate constructor ran during inspection');
  assert.equal(fs.existsSync(f.output), false, 'incomplete closure was published');
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.startsWith('.handler-runtime-')), []);
});

test('handler runtime package refuses target substitution and leaves a prior package intact', async t => {
  const f = handlerPackageFixture(t);
  const { stageHandlerRuntime } = await runtimePackaging;
  const wrong = path.join(f.root, 'wrong.node');
  const bytes = fs.readFileSync(f.node); bytes.writeUInt16LE(process.arch === 'x64' ? 183 : 62, 18);
  fs.writeFileSync(wrong, bytes);
  assert.throws(() => stageHandlerRuntime({ ...f, node: wrong }), /ELF target mismatch/);
  assert.equal(fs.existsSync(f.output), false);
  stageHandlerRuntime(f);
  const original = fs.readFileSync(path.join(f.output, 'inventory.json'));
  assert.throws(() => stageHandlerRuntime(f), /destination already exists/);
  assert.deepEqual(fs.readFileSync(path.join(f.output, 'inventory.json')), original);
});

test('handler runtime package refuses library symlinks outside the explicit roots', async t => {
  const f = handlerPackageFixture(t);
  const libs = path.join(f.root, 'libs'); fs.mkdirSync(libs);
  const outside = path.join(f.root, 'outside.so'); fs.writeFileSync(outside, 'untrusted');
  fs.symlinkSync(outside, path.join(libs, 'libseccomp.so.2'));
  const { stageHandlerRuntime } = await runtimePackaging;
  assert.throws(() => stageHandlerRuntime({ ...f, libraryDirs: [libs] }), /escapes explicit target roots/);
  assert.equal(fs.existsSync(f.output), false);
});

test('handler runtime package refuses an origin-dependent ELF graph', async t => {
  const f = handlerPackageFixture(t);
  const source = path.join(f.root, 'main.c'), candidate = path.join(f.root, 'candidate');
  fs.writeFileSync(source, 'int main(void) { return 0; }');
  const compiled = spawnSync('/usr/bin/gcc', [source, '-Wl,-rpath,$ORIGIN/private', '-o', candidate], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const { stageHandlerRuntime } = await runtimePackaging;
  assert.throws(() => stageHandlerRuntime({ ...f, node: candidate }), /unsupported runtime ELF search path/);
  assert.equal(fs.existsSync(f.output), false);
});

// WI-38142 — keep the sidecar dependency install aligned with the package
// names npm actually resolves. A stale @papercusp/operator selector fuzzily
// matched only operator-vite and omitted every apps/operator dependency.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { builtinModules, createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
// Overridable so scripts/mutation-probe.sh can point the suite at a mutated copy (copy-out mode).
const builder = fs.readFileSync(
  process.env.BUILD_DESKTOP_SIDECAR_PATH ?? path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);
const sidecarVerifier = fs.readFileSync(
  path.join(desktopRoot, 'bin/verify-sidecar-bundle.sh'),
  'utf8',
);

/** Extract a top-level shell helper from the real builder for behavioral tests. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert(start >= 0, `${name}() is missing from build-desktop-sidecar.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const LDCONFIG_RESOLVER = extractFunction('resolve_ldconfig');

test('headless Server shutdown lets operator children finish after the parent exits', { timeout: 120000 }, async (t) => {
  if (process.platform !== 'linux' || childProcess.spawnSync(
    'systemctl', ['--user', 'show-environment'], { stdio: 'ignore', timeout: 5000 },
  ).status !== 0) {
    t.skip('requires a Linux user systemd manager');
    return;
  }
  const unit = fs.readFileSync(path.join(desktopRoot, 'src-tauri/systemd/papercusp-server.service'), 'utf8');
  const productionMode = unit.match(/^KillMode=(.+)$/m)?.[1];
  const productionExitType = unit.match(/^ExitType=(.+)$/m)?.[1] ?? 'main';
  assert.ok(productionMode, 'packaged unit must declare its shutdown policy');

  // The mixed control reproduces the real failure: the headless parent exits
  // on TERM without forwarding it, so systemd KILLs its still-live children.
  for (const [mode, exitType, expectGraceful] of [
    ['mixed', 'main', false], [productionMode, productionExitType, true],
  ]) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-headless-stop-'));
    const name = `pc-headless-stop-${process.pid}-${path.basename(fixture)}.service`;
    const ready = path.join(fixture, 'ready');
    const clean = path.join(fixture, 'clean');
    fs.writeFileSync(path.join(fixture, 'child.cjs'), [
      'const fs = require("node:fs"), path = require("node:path");',
      'const root = process.argv[2];',
      'process.once("SIGTERM", () => setTimeout(() => {',
      '  fs.writeFileSync(path.join(root, "clean"), "graceful"); process.exit(0);',
      '}, 250));',
      'fs.writeFileSync(path.join(root, "ready"), String(process.pid));',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    fs.writeFileSync(path.join(fixture, 'parent.cjs'), [
      'const { spawn } = require("node:child_process"), path = require("node:path");',
      'process.on("SIGTERM", () => process.exit(0));',
      'spawn(process.execPath, [path.join(__dirname, "child.cjs"), process.argv[2]], { stdio: "ignore" });',
      'setInterval(() => {}, 1000);',
    ].join('\n'));
    try {
      const start = childProcess.spawnSync('systemd-run', [
        '--user', '--quiet', '--collect', `--unit=${name}`,
        '--property=Type=exec', `--property=KillMode=${mode}`,
        `--property=ExitType=${exitType}`,
        '--property=TimeoutStopSec=5s', '--property=Restart=no',
        process.execPath, path.join(fixture, 'parent.cjs'), fixture,
      ], { encoding: 'utf8', timeout: 15000 });
      assert.equal(start.status, 0, start.stderr);
      const deadline = Date.now() + 20000;
      while (!fs.existsSync(ready) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.ok(fs.existsSync(ready), 'fixture child must be ready before stopping');
      const stop = childProcess.spawnSync('systemctl', ['--user', 'stop', name], {
        encoding: 'utf8', timeout: 15000,
      });
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(fs.existsSync(clean), expectGraceful, `${mode}/${exitType}: child cleanup after parent exit`);
    } finally {
      childProcess.spawnSync('systemctl', ['--user', 'stop', name], { stdio: 'ignore', timeout: 15000 });
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});

function runPinnedReleaseInstallGuard(t, {
  profile = 'dogfood', audited = '1', pinned = true, skip = '', dirty = 'false', external = false,
} = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-pinned-release-install-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const product = path.join(fixture, 'product');
  fs.mkdirSync(product);
  if (external) {
    const live = path.join(fixture, 'live-node-modules');
    fs.mkdirSync(live);
    fs.symlinkSync(live, path.join(product, 'node_modules'));
  } else fs.mkdirSync(path.join(product, 'node_modules'));
  const blockStart = builder.indexOf('# EI-21832562420831737: having DEMANDED');
  const blockEnd = builder.indexOf('unset _vm_release_build_sha _vm_release_desktop_version', blockStart);
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'release dependency guard block is missing');
  const result = childProcess.spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'source "$PC_SOURCE_ROOT_HELPER"', 'source "$PC_PINNED_DEPS_HELPER"',
    builder.slice(blockStart, blockEnd),
    // This observes the install child's inherited contract, before any build.
    'node -e \'console.log(JSON.stringify({skip:process.env.PAPERCUSP_SKIP_DEP_GENERATION||"unset"}))\'',
  ].join('\n')], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, REPO_ROOT: product, DISTRIBUTION_PROFILE: profile,
      PAPERCUSP_RELEASE_AUDIT: audited, PAPERCUSP_PINNED_DEPS_SNAPSHOT_ROOT: pinned ? product : '',
      PAPERCUSP_SKIP_DEP_GENERATION: skip, PROVENANCE_SOURCE_GIT_DIRTY: dirty,
      PC_SOURCE_ROOT_HELPER: path.join(desktopRoot, 'bin/lib/source-roots.sh'),
      PC_PINNED_DEPS_HELPER: path.join(desktopRoot, 'bin/lib/pinned-deps.sh'),
    },
  });
  return result;
}

test('audited pinned dogfood installs inherit generation skip; ordinary dogfood and explicit zero are preserved', t => {
  for (const [options, expected] of [
    [{}, '1'], [{ profile: 'vm-release', pinned: false }, '1'],
    [{ audited: '0' }, 'unset'], [{ pinned: false }, '1'], [{ skip: '0' }, '0'],
  ]) {
    const result = runPinnedReleaseInstallGuard(t, options);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).skip, expected);
  }
  const guard = builder.indexOf('export PAPERCUSP_SKIP_DEP_GENERATION=');
  const install = builder.indexOf('(cd "$REPO_ROOT" && node scripts/npm-install-safe.mjs install');
  assert.ok(guard >= 0 && install > guard, 'the contract must be inherited by the first install');
});

test('audited pinned dogfood refuses dirty source and external dependencies before the install child', t => {
  for (const options of [{ dirty: 'true' }, { external: true }, { external: true, skip: '0' }]) {
    const result = runPinnedReleaseInstallGuard(t, options);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), '');
    assert.match(result.stderr, /dirty source|SYMLINK to dependencies outside/);
  }
});

test('audited builds without a declared snapshot reject live dependency links before installation', t => {
  for (const profile of ['dogfood', 'public', 'vm-release']) {
    for (const options of [
      { external: true }, { external: true, skip: '0' }, { dirty: 'true' },
    ]) {
      const result = runPinnedReleaseInstallGuard(t, { profile, pinned: false, ...options });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.equal(result.stdout.trim(), '', 'no install child may run on rejected inputs');
      assert.match(result.stderr, /dirty source|SYMLINK to dependencies outside/);
    }
    const clean = runPinnedReleaseInstallGuard(t, { profile, pinned: false });
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.equal(JSON.parse(clean.stdout.trim()).skip, '1');
  }
  const ordinary = runPinnedReleaseInstallGuard(t, { audited: '0', pinned: false, external: true });
  assert.equal(ordinary.status, 0, ordinary.stdout + ordinary.stderr);
  assert.equal(JSON.parse(ordinary.stdout.trim()).skip, 'unset');
});

test('native Server builder defaults enter the real release guard before installing frozen dependencies', t => {
  const recipe = fs.readFileSync(path.join(repoRoot, 'infra/images/server/NativeBuilder.Containerfile'), 'utf8');
  const profile = recipe.match(/^ENV PAPERCUSP_DISTRIBUTION_PROFILE=([^\s]+) /m)?.[1];
  assert.equal(profile, 'dogfood', 'both native architectures require the supported audited pinned route');
  assert.match(recipe, /PAPERCUSP_RELEASE_AUDIT=1/);
  assert.match(recipe, /PAPERCUSP_PINNED_DEPS_SNAPSHOT_ROOT=\/product/);
  for (const [options, expected] of [
    [{ profile, pinned: true }, '1'],
    [{ profile, pinned: true, skip: '0' }, '0'],
  ]) {
    const result = runPinnedReleaseInstallGuard(t, options);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout.trim()).skip, expected);
  }
  for (const options of [{ profile, pinned: true, dirty: 'true' }, { profile, pinned: true, external: true }]) {
    const result = runPinnedReleaseInstallGuard(t, options);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.equal(result.stdout.trim(), '', 'refuse before any install child');
  }
});

test('clean-source native transformer validation follows dependency hydration and precedes SPA assembly', () => {
  const install = builder.indexOf('(cd "$REPO_ROOT" && node scripts/npm-install-safe.mjs install');
  const validation = builder.indexOf('papercusp_verify_transformers_native_target "$REPO_ROOT" "$TARGET_OS" "$TARGET_ARCH" "" "$_transformers_declaration_policy" || exit 1');
  const spa = builder.indexOf('echo "→ building operator-vite SPA (vite build → locked sidecar snapshot)"');
  assert.ok(install >= 0 && validation > install && spa > validation,
    'installed native packages must be checked after clean-source installation, before expensive assembly');
  const preinstall = builder.slice(0, install);
  assert.doesNotMatch(preinstall, /papercusp_verify_transformers_native_target "\$REPO_ROOT"/);
  assert.match(preinstall, /papercusp_verify_transformers_dependencies "\$REPO_ROOT" 0/,
    'manifest and lock contract still fail before installation');
});

test('every sidecar esbuild package runner holds the host package-cache lease', () => {
  const runners = builder.split('\n').filter(line => line.includes('npx --yes esbuild@0.25.0'));
  const shared = fs.readFileSync(path.join(repoRoot, 'apps/operator/bin/bundle-host-common.sh'), 'utf8');
  const delegated = ['bundle_host_primary', 'bundle_host_launcher'];
  for (const name of delegated) {
    assert.match(builder, new RegExp('^\\s*' + name + ' "\\$REPO_ROOT"', 'm'));
    assert.match(sharedBundleFunction(shared, name), /bundle_host_esbuild "\$repo_root"/);
  }
  assert.ok(runners.length + delegated.length >= 8, 'inline and delegated sidecar bundle phases must be covered');
  for (const runner of runners) {
    assert.ok(runner.includes('run_sidecar_cached_package npx'), runner);
  }
  assert.match(extractFunction('run_sidecar_cached_package'), /helper\.withPackageCacheReadLease\(/);
  assert.match(sharedBundleFunction(shared, 'bundle_host_esbuild'), /bundle_host_cached_package "\$repo_root"/);
  assert.match(sharedBundleFunction(shared, 'bundle_host_cached_package'), /run_sidecar_cached_package "\$@"/);
  assert.doesNotMatch(builder, /--exec-under-cache-lock -- npx/);
});

function sharedBundleFunction(source, name) {
  const lines = source.split('\n');
  const start = lines.findIndex(line => line.startsWith(`${name}() {`));
  assert.ok(start >= 0, `shared compiler recipe missing: ${name}`);
  const end = lines.findIndex((line, i) => i > start && line === '}');
  assert.ok(end > start, `unterminated shared compiler recipe: ${name}`);
  return lines.slice(start, end + 1).join('\n');
}

const CACHE_PACKAGE_RUNNER = extractFunction('run_sidecar_cached_package');
const VITE_NATIVE_PREPARE = extractFunction('prepare_vite_native_toolchain');
const EXACT_PLATFORM_FETCH = extractFunction('fetch_cross_npm_pkg');

function viteNativeFixture(t, { parentVersion = '1.0.3', packedVersion = '1.0.3', packStatus = 0, brokenBinding = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pc-vite-native's frozen cut-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const suffix = process.platform === 'linux'
    ? `-${process.report.getReport().header.glibcVersionRuntime ? 'gnu' : 'musl'}`
    : process.platform === 'win32' ? '-msvc' : '';
  const binding = `@rolldown/binding-${process.platform}-${process.arch}${suffix}`;
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const json = (file, content) => write(file, JSON.stringify(content));
  json('apps/operator-vite/package.json', { name: 'fixture-app' });
  json('package-lock.json', { packages: { 'node_modules/rolldown': { version: '1.0.3' } } });
  json('node_modules/vite/package.json', { name: 'vite', type: 'module', main: 'index.mjs', dependencies: { rolldown: '1.0.3' } });
  write('node_modules/vite/index.mjs', "import 'rolldown'; export const ready = true;\n");
  json('node_modules/rolldown/package.json', { name: 'rolldown', version: parentVersion, main: 'index.cjs', optionalDependencies: { [binding]: parentVersion } });
  write('node_modules/rolldown/index.cjs', `module.exports = require(${JSON.stringify(binding)});\n`);
  write('scripts/npm-install-safe.mjs', LEGACY_CACHE_HELPER + '\nexport function repoLockName(root) { return root; }\n');
  write('scripts/lib/fs-mutex.mjs', 'export async function withFsMutex(name, fn) { if (name===process.env.PC_BLOCKED_DONOR_ROOT) throw Error("donor writer blocked by active readers"); process.env.PC_INSTALL_WRITE_LEASE="held"; try { return await fn(); } finally { delete process.env.PC_INSTALL_WRITE_LEASE; } }\nexport async function withFsMutexRead(name, fn) { process.env.PC_INSTALL_READ_LEASE="held"; try { return await fn(); } finally { delete process.env.PC_INSTALL_READ_LEASE; } }\n');
  write('fake-bin/npm', [
    `#!${process.execPath}`,
    'const fs=require("node:fs"),path=require("node:path"),cp=require("node:child_process");',
    'const args=process.argv.slice(2);',
    'fs.appendFileSync(process.env.PC_PACK_RECORD,JSON.stringify({args,cache:process.env.PC_CACHE_LEASE,writer:process.env.PC_INSTALL_WRITE_LEASE})+"\\n");',
    `if (${packStatus}) process.exit(${packStatus});`,
    'fs.mkdirSync("package");',
    `fs.writeFileSync("package/package.json",JSON.stringify({name:${JSON.stringify(binding)},version:${JSON.stringify(packedVersion)},main:"index.cjs"}));`,
    `fs.writeFileSync("package/index.cjs",${JSON.stringify(brokenBinding ? 'throw new Error("native payload cannot load");' : 'module.exports={native:true};')});`,
    'const result=cp.spawnSync("tar",["-czf","binding.tgz","package"]); process.exit(result.status??1);',
  ].join('\n'));
  fs.chmodSync(path.join(root, 'fake-bin/npm'), 0o755);
  const sourceFiles = ['apps/operator-vite/package.json', 'package-lock.json'];
  const original = sourceFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  const run = (extraEnv = {}) => childProcess.spawnSync('bash', ['-c', [
    'set -euo pipefail', CACHE_PACKAGE_RUNNER, EXACT_PLATFORM_FETCH, VITE_NATIVE_PREPARE,
    'prepare_vite_native_toolchain',
  ].join('\n')], {
    encoding: 'utf8', timeout: 15_000,
    env: { ...process.env, REPO_ROOT: root, WEB_DIR: root, PATH: path.join(root, 'fake-bin') + path.delimiter + process.env.PATH,
      PC_PACK_RECORD: path.join(root, 'pack.jsonl'), SIDECAR_DIR: path.join(root, 'sidecar'), ...extraEnv },
  });
  return { root, binding, run, destination: path.join(root, 'node_modules/rolldown/node_modules', binding),
    records: () => fs.existsSync(path.join(root, 'pack.jsonl')) ? fs.readFileSync(path.join(root, 'pack.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    assertSourceUnchanged: () => assert.deepEqual(sourceFiles.map(file => fs.readFileSync(path.join(root, file), 'utf8')), original) };
}

test('Vite native prerequisite hydrates the exact parent pin missing from a platform-specific lock under both leases', t => {
  const fixture = viteNativeFixture(t);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
  assert.deepEqual(fixture.records(), [{ args: ['pack', `${fixture.binding}@1.0.3`, '--silent'], cache: 'held', writer: 'held' }]);
  fixture.assertSourceUnchanged();
  const again = fixture.run();
  assert.equal(again.status, 0, again.stdout + again.stderr);
  assert.equal(fixture.records().length, 1, 'the verified exact package is reused');
  assert.ok(builder.indexOf('prepare_vite_native_toolchain || exit 1') < builder.indexOf('build_runtime_workspace_outputs_after_install\n'));
});

test('Vite native prerequisite loads hydrated bytes despite cached missing package metadata', t => {
  const fixture = viteNativeFixture(t);
  // npm can leave an empty optional-package directory. Even after it is removed,
  // Node retains its missing package.json in this interpreter's resolver cache.
  fs.appendFileSync(path.join(fixture.root, 'scripts/npm-install-safe.mjs'), `
import primeFs from 'node:fs';
import { createRequire as primeRequire } from 'node:module';
const placeholder = ${JSON.stringify(fixture.destination)};
primeFs.mkdirSync(placeholder, { recursive: true });
try {
  primeRequire(${JSON.stringify(path.join(fixture.root, 'node_modules/rolldown/package.json'))})
    .resolve(${JSON.stringify(fixture.binding + '/package.json')});
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}
primeFs.rmSync(placeholder, { recursive: true });
`);
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
  assert.equal(fixture.records().length, 1);
  fixture.assertSourceUnchanged();
});

test('Vite native prerequisite refuses an unpinned parent before fetching and preserves source files', t => {
  const fixture = viteNativeFixture(t, { parentVersion: '1.0.4' });
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no exact locked parent pin/);
  assert.deepEqual(fixture.records(), []);
  fixture.assertSourceUnchanged();
});

test('failed or mismatched native tarballs never publish a partial platform package', t => {
  for (const options of [{ packStatus: 29 }, { packedVersion: '1.0.4' }]) {
    const fixture = viteNativeFixture(t, options);
    const result = fixture.run();
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(fixture.destination), false);
    fixture.assertSourceUnchanged();
  }
});

test('Vite native prerequisite requires the fetched payload and actual Vite import to load', t => {
  const fixture = viteNativeFixture(t, { brokenBinding: true });
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /native payload cannot load/);
  assert.doesNotMatch(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
  fixture.assertSourceUnchanged();
});

test('Vite native prerequisite rejects a broken Vite entrypoint even when its native binding loads', t => {
  const fixture = viteNativeFixture(t);
  fs.writeFileSync(path.join(fixture.root, 'node_modules/vite/index.mjs'), 'import "rolldown"; throw new Error("Vite transitive graph is broken");');
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Vite transitive graph is broken/);
  assert.doesNotMatch(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
});

test('Vite native prerequisite follows a locked workspace-local Rolldown requester', t => {
  const fixture = viteNativeFixture(t);
  const local = path.join(fixture.root, 'node_modules/vite/node_modules/rolldown');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.renameSync(path.join(fixture.root, 'node_modules/rolldown'), local);
  fs.writeFileSync(path.join(fixture.root, 'package-lock.json'), JSON.stringify({ packages: {
    'node_modules/vite/node_modules/rolldown': { version: '1.0.3' },
  } }));
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.existsSync(path.join(local, 'node_modules', fixture.binding, 'package.json')), true);
});

test('Vite native prerequisite refuses a different already-installed binding version without replacing evidence', t => {
  const fixture = viteNativeFixture(t);
  fs.mkdirSync(fixture.destination, { recursive: true });
  const manifest = JSON.stringify({ name: fixture.binding, version: '1.0.4' });
  fs.writeFileSync(path.join(fixture.destination, 'package.json'), manifest);
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs from exact pin/);
  assert.deepEqual(fixture.records(), []);
  assert.equal(fs.readFileSync(path.join(fixture.destination, 'package.json'), 'utf8'), manifest);
});

test('Vite native prerequisite maps an external dependency alias through its exact logical lock pin', t => {
  const fixture = viteNativeFixture(t);
  const donor = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vite-native-donor-'));
  t.after(() => fs.rmSync(donor, { recursive: true, force: true }));
  fs.mkdirSync(path.join(donor, 'node_modules'));
  for (const name of ['vite', 'rolldown']) {
    const external = path.join(donor, 'node_modules', name);
    const logical = path.join(fixture.root, 'node_modules', name);
    fs.renameSync(logical, external);
    fs.symlinkSync(external, logical, 'dir');
  }
  const result = fixture.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
  assert.deepEqual(fixture.records(), [{ args: ['pack', `${fixture.binding}@1.0.3`, '--silent'], cache: 'held', writer: 'held' }]);
  fixture.assertSourceUnchanged();
});

test('an aliased Rolldown with the wrong locked version is refused before fetch', t => {
  const fixture = viteNativeFixture(t, { parentVersion: '1.0.4' });
  const donor = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vite-native-wrong-donor-'));
  t.after(() => fs.rmSync(donor, { recursive: true, force: true }));
  fs.mkdirSync(path.join(donor, 'node_modules'));
  for (const name of ['vite', 'rolldown']) {
    const external = path.join(donor, 'node_modules', name);
    const logical = path.join(fixture.root, 'node_modules', name);
    fs.renameSync(logical, external);
    fs.symlinkSync(external, logical, 'dir');
  }
  const result = fixture.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no exact locked parent pin/);
  assert.deepEqual(fixture.records(), []);
  fixture.assertSourceUnchanged();
});

test('an exact donor binding loads under a reader lease while donor writes are blocked', t => {
  const fixture = viteNativeFixture(t);
  const donor = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vite-native-read-donor-'));
  t.after(() => fs.rmSync(donor, { recursive: true, force: true }));
  fs.mkdirSync(path.join(donor, 'node_modules'));
  for (const name of ['vite', 'rolldown']) {
    const external = path.join(donor, 'node_modules', name);
    const logical = path.join(fixture.root, 'node_modules', name);
    fs.renameSync(logical, external);
    fs.symlinkSync(external, logical, 'dir');
  }
  const bindingDir = path.join(donor, 'node_modules', fixture.binding);
  fs.mkdirSync(bindingDir, { recursive: true });
  fs.writeFileSync(path.join(bindingDir, 'package.json'), JSON.stringify({
    name: fixture.binding, version: '1.0.3', main: 'index.cjs',
  }));
  fs.writeFileSync(path.join(bindingDir, 'index.cjs'),
    'if(process.env.PC_INSTALL_READ_LEASE!=="held") throw Error("native load lost reader lease"); module.exports={native:true};');
  fs.writeFileSync(path.join(donor, 'node_modules/vite/index.mjs'),
    'import "rolldown"; if(process.env.PC_INSTALL_READ_LEASE!=="held") throw Error("Vite load lost reader lease");');
  const result = fixture.run({ PC_BLOCKED_DONOR_ROOT: donor });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /VITE_NATIVE_TOOLCHAIN_OK/);
  assert.deepEqual(fixture.records(), [], 'an existing exact binding needs no package mutation');
  fixture.assertSourceUnchanged();
});

test('a missing donor binding still requires the donor writer', t => {
  const fixture = viteNativeFixture(t);
  const donor = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-vite-native-write-donor-'));
  t.after(() => fs.rmSync(donor, { recursive: true, force: true }));
  fs.mkdirSync(path.join(donor, 'node_modules'));
  for (const name of ['vite', 'rolldown']) {
    const external = path.join(donor, 'node_modules', name);
    const logical = path.join(fixture.root, 'node_modules', name);
    fs.renameSync(logical, external);
    fs.symlinkSync(external, logical, 'dir');
  }
  const result = fixture.run({ PC_BLOCKED_DONOR_ROOT: donor });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /donor writer blocked by active readers/);
  assert.deepEqual(fixture.records(), [], 'no hydration may escape the blocked writer');
  fixture.assertSourceUnchanged();
});

function runCachePackageFixture({ helper, command = [], childStatus = 0 } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "pc-cache-runner's target-"));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.writeFileSync(path.join(fixture, 'scripts/npm-install-safe.mjs'), helper);
    const record = path.join(fixture, 'child.json');
    const child = path.join(fixture, 'child.mjs');
    fs.writeFileSync(child, [
      'import { writeFileSync } from "node:fs";',
      'writeFileSync(process.env.PC_CACHE_CHILD_RECORD, JSON.stringify({',
      '  args: process.argv.slice(2), cwd: process.cwd(), lease: process.env.PC_CACHE_LEASE,',
      '}));',
      `process.exit(${childStatus});`,
    ].join('\n'));
    const result = childProcess.spawnSync('bash', ['-c', [
      'set -euo pipefail',
      CACHE_PACKAGE_RUNNER,
      'run_sidecar_cached_package "$@"',
    ].join('\n'), 'fixture', ...(command.length ? command : [process.execPath, child, 'space argument', "apostrophe's argument", '--platform=node'])], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, REPO_ROOT: fixture, WEB_DIR: fixture, PC_CACHE_CHILD_RECORD: record },
    });
    return {
      ...result,
      fixture,
      child: fs.existsSync(record) ? JSON.parse(fs.readFileSync(record, 'utf8')) : null,
    };
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

const LEGACY_CACHE_HELPER = [
  // Same historical CLI shape as the frozen target: the newer flag would install.
  'export function parseCliArgs(args) { return { npmArgs: ["install", ...args] }; }',
  'export async function withPackageCacheReadLease(fn) {',
  '  process.env.PC_CACHE_LEASE = "held";',
  '  try { return await fn(); } finally { delete process.env.PC_CACHE_LEASE; }',
  '}',
].join('\n');

test('frozen helper with no new CLI flag runs exact child arguments inside its existing cache lease', () => {
  const result = runCachePackageFixture({ helper: LEGACY_CACHE_HELPER });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.child.args, ['space argument', "apostrophe's argument", '--platform=node']);
  assert.equal(result.child.cwd, result.fixture);
  assert.equal(result.child.lease, 'held');
});

test('package-cache runner propagates a failing child instead of swallowing it', () => {
  const result = runCachePackageFixture({ helper: LEGACY_CACHE_HELPER, childStatus: 29 });
  assert.equal(result.status, 29, result.stdout + result.stderr);
  assert.equal(result.child.lease, 'held');
});

test('helper preflight is non-mutating and precedes expensive producer work', () => {
  const result = runCachePackageFixture({
    helper: 'export function withPackageCacheReadLease() { throw new Error("preflight must not enter cache"); }',
    command: ['--check'],
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.child, null);
  const guard = builder.indexOf('run_sidecar_cached_package --check || exit 1');
  assert(guard > 0);
  assert(guard > builder.indexOf('source identity mismatch at entry'));
  assert(guard > builder.indexOf('requires a clean source tree at cut start'));
  assert(guard < builder.indexOf('node scripts/npm-install-safe.mjs install'));
  assert(guard < builder.indexOf('→ building operator-vite SPA'));
});

test('missing shared cache API refuses both preflight and execution before any child runs', () => {
  for (const command of [['--check'], []]) {
    const result = runCachePackageFixture({ helper: 'export const oldHelper = true;', command });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /lacks withPackageCacheReadLease/);
    assert.equal(result.child, null);
  }
});

test('cache lease refusal and missing command are fatal without a bare-run fallback', () => {
  const refused = runCachePackageFixture({
    helper: 'export function withPackageCacheReadLease() { throw new Error("cache writer held"); }',
  });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /cache writer held/);
  assert.equal(refused.child, null);
  const missing = runCachePackageFixture({
    helper: LEGACY_CACHE_HELPER, command: ['pc-nonexistent-cache-runner-command'],
  });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
  assert.equal(missing.child, null);
});

test('current maintained npm helper satisfies the producer cache API preflight', () => {
  const result = childProcess.spawnSync('bash', ['-c', [
    'set -euo pipefail', CACHE_PACKAGE_RUNNER, 'run_sidecar_cached_package --check',
  ].join('\n')], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, REPO_ROOT: repoRoot, WEB_DIR: path.join(repoRoot, 'apps/operator') },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

function runLdconfigResolver(pathValue) {
  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise the builder helper');
  return childProcess.spawnSync(
    bash,
    ['-c', `set -euo pipefail\n${LDCONFIG_RESOLVER}\nresolve_ldconfig`],
    { encoding: 'utf8', env: { ...process.env, PATH: pathValue } },
  );
}

const HOST_LDCONFIG = ['/usr/sbin/ldconfig', '/sbin/ldconfig'].find((candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

test('ldconfig resolver finds admin-directory ldconfig under a minimal PATH', { skip: !HOST_LDCONFIG }, () => {
  const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-no-ldconfig-'));
  try {
    const result = runLdconfigResolver(missingPath);
    assert.equal(
      result.status,
      0,
      `resolver failed with minimal PATH (status ${result.status}):\n${result.stdout}${result.stderr}`,
    );
    assert.equal(result.stdout.trim(), HOST_LDCONFIG);
  } finally {
    fs.rmSync(missingPath, { recursive: true, force: true });
  }
});

test('ldconfig resolver prefers the executable selected by PATH', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-ldconfig-path-'));
  try {
    const pathLdconfig = path.join(bin, 'ldconfig');
    fs.writeFileSync(pathLdconfig, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(pathLdconfig, 0o755);
    const result = runLdconfigResolver(bin);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout.trim(), pathLdconfig);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Linux PostgreSQL library copy loop invokes the resolved ldconfig path', () => {
  assert.match(builder, /_ldconfig="\$\(resolve_ldconfig\)"/);
  assert.match(builder, /\$\("\$_ldconfig" -p 2>\/dev\/null/);
  assert.doesNotMatch(
    builder,
    /_libpath="\$\(ldconfig -p/,
    'the library-copy loop must not invoke ldconfig through PATH directly',
  );
});

test('chat-dock cargo target discovery is fail-soft and leaves diagnostics visible', () => {
  assert.match(builder, /if ! CARGO_TGT="\$\(/);
  assert.match(builder, /cargo metadata could not resolve the pui target directory/);
  assert.match(builder, /CARGO_TGT=""/);
  assert.doesNotMatch(
    builder,
    /CARGO_TGT="\$\(cd "\$REPO\/apps\/tui" && cargo metadata[^\n]*2>\/dev\/null/,
    'a cargo metadata failure must not silently abort the build under set -e/pipefail',
  );
});

test('sidecar build restores Cargo from CARGO_HOME before the expensive build', () => {
  const cargoGuard = builder.indexOf('_cargo_home="${CARGO_HOME:-$HOME/.cargo}"');
  const firstCargoUse = builder.indexOf('cargo metadata --no-deps --format-version 1');

  assert(cargoGuard >= 0, 'missing systemd-safe Cargo PATH normalization');
  assert(firstCargoUse > cargoGuard, 'Cargo must be resolved before its first build-time use');
  const guard = builder.slice(cargoGuard, firstCargoUse);
  assert.match(guard, /! command -v cargo[^\n]+&& \[\[ -x "\$_cargo_home\/bin\/cargo" \]\]/);
  assert.match(guard, /export PATH="\$_cargo_home\/bin:\$PATH"/);
  assert.match(guard, /hash -r/);
  assert.match(guard, /sidecar release build requires Cargo/);
  assert.match(guard, /exit 1/);
});

test('sidecar target architecture stays shell-local before native GNU Make builds', () => {
  const start = builder.indexOf('TARGET_OS="${TARGET_OS:-$_host_os}"');
  // Stop at normalization's own boundary: release preflights now occur before
  // CROSS_BUILD and require the complete builder environment.
  const unexport = builder.indexOf('export -n TARGET_ARCH', start);
  const end = builder.indexOf('\n', unexport);
  const trustBuild = builder.indexOf('papercusp_prepare_vm_release_trust_toolchain', end);
  assert(start >= 0 && unexport > start && end > unexport, 'could not isolate target normalization');
  assert(trustBuild > end, 'native trust build must follow target normalization');

  const normalization = builder.slice(start, end);
  assert.match(normalization, /TARGET_ARCH="\$\{TARGET_ARCH:-\$_host_arch\}"/);
  assert.match(normalization, /export -n TARGET_ARCH/);
  assert.match(normalization, /GNU Make reserves TARGET_ARCH/);

  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise target normalization');
  const result = childProcess.spawnSync(
    bash,
    [
      '-c',
      [
        'set -euo pipefail',
        '_host_os=linux',
        '_host_arch=x64',
        normalization,
        'printf "shell=%s\\n" "$TARGET_ARCH"',
        "if env | grep -q '^TARGET_ARCH='; then exit 97; fi",
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, TARGET_OS: 'linux', TARGET_ARCH: 'x64' },
    },
  );
  assert.equal(
    result.status,
    0,
    `target normalization leaked TARGET_ARCH to child processes: ${result.stdout}${result.stderr}`,
  );
  assert.equal(result.stdout.trim(), 'shell=x64');
});

test('sidecar build fails closed unless all five official mobile templates are packaged', () => {
  for (const ref of [
    'papercusp-mobile-base',
    'papercusp-android-shell',
    'papercusp-android-app',
    'papercusp-iphone-shell',
    'papercusp-iphone-app',
  ]) {
    assert.match(builder, new RegExp(`\\b${ref}\\b`), `${ref} is absent from the packaged-template guard`);
  }
  assert.match(builder, /REQUIRED_MOBILE_TEMPLATES/);
  assert.match(builder, /listing\.json template\.yaml GUIDE\.md/);
  assert.match(builder, /required official mobile template entry missing from sidecar/);
});

test('sidecar privacy prune covers every assembled documentation copy', () => {
  const start = builder.indexOf('python3 "$_audit_py" --prune-docs');
  const end = builder.indexOf('\n  # The prune above deletes by PATH', start);
  assert(start >= 0 && end > start, 'could not isolate the sidecar docs-prune invocation');

  const prune = builder.slice(start, end);
  for (const docsRoot of [
    '$SIDECAR_DIR',
    '$SIDECAR_DIR/internal-docs',
    '$SIDECAR_DIR/apps/operator-docs/src/content/docs',
    '$SIDECAR_DIR/spa/docs',
  ]) {
    assert.match(prune, new RegExp(docsRoot.replaceAll('$', '\\$')));
  }
});

test('sidecar dependency install includes both source workspaces with exact names', () => {
  const operatorName = require(path.join(repoRoot, 'apps/operator/package.json')).name;
  const viteName = require(path.join(repoRoot, 'apps/operator-vite/package.json')).name;

  assert.equal(operatorName, '@papercusp/web');
  assert.equal(viteName, '@papercusp/operator-vite');
  const installStart = builder.indexOf(
    '(cd "$REPO_ROOT" && node scripts/npm-install-safe.mjs install',
  );
  const installEnd = builder.indexOf(
    ')\n',
    installStart,
  );
  assert(installStart >= 0, 'missing scoped sidecar dependency install');
  assert(installEnd > installStart, 'could not isolate scoped sidecar dependency install');
  const install = builder.slice(installStart, installEnd).replace(/\\\r?\n/g, ' ');

  assert.match(install, /--workspace=@papercusp\/web(?:\s|$)/);
  assert.match(install, /--workspace=@papercusp\/operator-vite(?:\s|$)/);
  assert.doesNotMatch(install, /--workspace=@papercusp\/operator(?:\s|$)/);
  assert.doesNotMatch(install, /&& npm install /, 'the shared root install must never bypass npm-install-safe');
});

test('sidecar runtime workspace builds require native TypeScript 7 plus the TypeScript 6 API alias', () => {
  const ssePackage = require(path.join(repoRoot, 'libs/generic/sse/package.json'));

  assert.equal(ssePackage.devDependencies['@typescript/native'], 'npm:typescript@7.0.2');
  assert.equal(
    ssePackage.devDependencies.typescript,
    'npm:@typescript/typescript6@6.0.2',
  );
  assert.match(builder, /require\("@typescript\/native\/package\.json"\)/);
  assert.match(builder, /require\("typescript\/package\.json"\)/);
  assert.match(builder, /actualNative\.name === "typescript"/);
  assert.match(builder, /actualApi\.name === "@typescript\/typescript6"/);
  assert.match(builder, /native TypeScript/);
  assert.match(builder, /API compatibility/);
});

test('prepared runtime builds are protected by the existing reader lease and never upgrade it to an installer', () => {
  const reader = extractFunction('build_runtime_workspace_outputs_after_install');
  // The prepared helper embeds JavaScript containing column-zero braces.
  // Its next shell declaration is an unambiguous boundary; the simple brace
  // extractor above is appropriate only for helpers without that payload.
  const start = builder.indexOf('build_runtime_workspace_outputs_prepared() {');
  const end = builder.indexOf('build_runtime_workspace_outputs_after_install() {', start);
  assert(start >= 0 && end > start, 'missing prepared runtime build helper');
  const prepared = builder.slice(start, end);
  assert.match(reader, /run_sidecar_cached_package node/);
  assert.match(reader, /--repo-root "\$REPO_ROOT" --exec-under-lock -- bash/);
  assert.match(prepared, /npm --workspace "\$workspace" run build/);
  assert.match(prepared, /prepared runtime workspace build failed/);
  assert.doesNotMatch(prepared, /npm-install-safe\.mjs install|npm install|runtime_build_attempts|sleep /,
    'dependency writes and retries belong before the protected build phase');
});

test('Debian removal tears down only verified Papercusp process ownership', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const preRemove = fs.readFileSync(preRemovePath, 'utf8');

  assert.equal(baseConfig.bundle.linux.deb.preRemoveScript, 'deb/preremove.sh');
  // The Server overlay intentionally inherits the base Debian maintainer
  // scripts; adding a second script here would let the two bundles drift.
  assert.equal(serverConfig.bundle.linux.deb.preRemoveScript, undefined);
  assert.equal(childProcess.spawnSync('sh', ['-n', preRemovePath]).status, 0);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_PROC_ROOT/);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_HOME_ROOT/);
  assert.match(preRemove, /operator\.json/);
  assert.match(preRemove, /processIdentity/);
  assert.match(preRemove, /linux:%s:%s/);
  assert.match(preRemove, /serve\.mjs\*\|\*serve\.ts\*/);
  assert.match(preRemove, /hono-host\.mjs\*\|\*hono-host\.ts\*/);
  assert.match(preRemove, /proc_pgid/);
  assert.match(preRemove, /\[ "\$\(proc_pgid "\$pid"\)" = "\$pid" \]/);
  assert.match(preRemove, /kill -TERM -- "-\$operator_pid"/);
  assert.match(preRemove, /kill -KILL -- "-\$operator_pid"/);
  assert.match(preRemove, /is_operator_authority_valid "\$operator_pid" "\$operator_identity"/);
  assert.match(preRemove, /is_packaged_desktop/);
  assert.match(preRemove, /kill -TERM "\$pid"/);
  assert.match(preRemove, /kill -KILL "\$pid"/);
  assert.match(preRemove, /papercusp-gui\)[\s\S]*DESKTOP_EXEC=\/usr\/bin\/papercusp-desktop[\s\S]*OWNS_OPERATOR=0/);
  assert.match(preRemove, /papercusp-server\)[\s\S]*DESKTOP_EXEC=\/usr\/bin\/papercusp-server[\s\S]*OWNS_OPERATOR=1/);
  assert.match(preRemove, /deb-systemd-invoke --user stop "\$SERVER_USER_UNIT"/);
  assert.ok(
    preRemove.indexOf('deb-systemd-invoke --user stop "$SERVER_USER_UNIT"')
      < preRemove.indexOf('for proc_dir in "$PROC_ROOT"/[0-9]*'),
    'Server removal must stop the user unit before direct PID cleanup can trigger Restart=on-failure',
  );
  assert.match(preRemove, /if \[ "\$OWNS_OPERATOR" = 1 \]; then[\s\S]*signal_operator_group/);
});

test('Debian Server removal and upgrade stop the user unit; GUI removal leaves it alone', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-systemd-'));
  const procRoot = path.join(root, 'proc');
  const bin = path.join(root, 'bin');
  const invokeLog = path.join(root, 'deb-systemd-invoke.log');
  const invokeShim = path.join(bin, 'deb-systemd-invoke');

  try {
    fs.mkdirSync(procRoot, { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(
      invokeShim,
      ['#!/bin/sh', 'printf "%s\\n" "$*" >> "$PAPERCUSP_SYSTEMD_INVOKE_LOG"', ''].join('\n'),
    );
    fs.chmodSync(invokeShim, 0o755);

    const run = (packageName, action) => childProcess.spawnSync('sh', [preRemovePath, action], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DPKG_MAINTSCRIPT_PACKAGE: packageName,
        PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
        PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
        PAPERCUSP_SYSTEMD_INVOKE_LOG: invokeLog,
      },
    });

    const serverRemove = run('papercusp-server', 'remove');
    assert.equal(serverRemove.status, 0, `${serverRemove.stdout}${serverRemove.stderr}`);
    assert.equal(fs.readFileSync(invokeLog, 'utf8').trim(), '--user stop papercusp-server.service');

    fs.rmSync(invokeLog);
    const guiRemove = run('papercusp-gui', 'remove');
    assert.equal(guiRemove.status, 0, `${guiRemove.stdout}${guiRemove.stderr}`);
    assert.equal(fs.existsSync(invokeLog), false, 'GUI removal must not stop the Server unit');

    // EI-27105381385516766: letting the unit restart onto the replacement
    // during the transaction crash-looped it against the half-unpacked tree
    // until start-limit-hit. Upgrade now stops it; postinst restarts it.
    const serverUpgrade = run('papercusp-server', 'upgrade');
    assert.equal(serverUpgrade.status, 0, `${serverUpgrade.stdout}${serverUpgrade.stderr}`);
    assert.equal(fs.readFileSync(invokeLog, 'utf8').trim(), '--user stop papercusp-server.service');

    fs.rmSync(invokeLog);
    const guiUpgrade = run('papercusp-gui', 'upgrade');
    assert.equal(guiUpgrade.status, 0, `${guiUpgrade.stdout}${guiUpgrade.stderr}`);
    assert.equal(fs.existsSync(invokeLog), false, 'GUI upgrade must not stop the Server unit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A PATH of logging shims for the Debian systemd helpers, so the maintainer
// scripts' real control flow runs without touching a real systemd. Every call
// lands in ONE log, in order, prefixed with the shim's name.
function debSystemdShims({ restartExit = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-systemd-'));
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'calls.log');
  fs.mkdirSync(bin);
  const shim = (name, body = '') => {
    const file = path.join(bin, name);
    fs.writeFileSync(
      file,
      ['#!/bin/sh', `printf '%s\\n' "${name} $*" >> "$PAPERCUSP_SHIM_LOG"`, body, 'exit 0', ''].join('\n'),
    );
    fs.chmodSync(file, 0o755);
  };
  shim('deb-systemd-invoke', `[ "$2" = restart ] && exit ${restartExit}`);
  shim('deb-systemd-helper');
  // Two live user managers, in systemctl's list-units row shape.
  shim('systemctl', [
    'case "$*" in',
    '  *list-units*)',
    "    echo '  user@1000.service loaded active running User Manager for UID 1000'",
    "    echo '  user@1001.service loaded active running User Manager for UID 1001'",
    '    ;;',
    'esac',
  ].join('\n'));
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
  const reset = () => fs.rmSync(log, { force: true });
  const env = (extra = {}) => ({
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    PAPERCUSP_SHIM_LOG: log,
    ...extra,
  });
  return { root, calls, reset, env };
}

test('Debian Server preinst stops the user unit before an upgrade unpacks (EI-27105381385516766)', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  // dpkg runs the OLD package's prerm on upgrade, so only the NEW package's
  // preinst can stop the unit for an upgrade from an already-shipped release.
  assert.equal(baseConfig.bundle.linux.deb.preInstallScript, 'deb/preinstall.sh');
  assert.equal(serverConfig.bundle.linux.deb.preInstallScript, undefined);
  const preinstPath = process.env.PAPERCUSP_PREINSTALL_UNDER_TEST
    || path.join(desktopRoot, 'src-tauri/deb/preinstall.sh');
  assert.equal(childProcess.spawnSync('sh', ['-n', preinstPath]).status, 0);
  assert.ok(fs.statSync(preinstPath).mode & 0o111, 'the maintainer script must be executable');

  const h = debSystemdShims();
  try {
    const run = (packageName, args, extra = {}) => childProcess.spawnSync('sh', [preinstPath, ...args], {
      encoding: 'utf8',
      env: h.env({ DPKG_MAINTSCRIPT_PACKAGE: packageName, ...extra }),
    });

    const upgrade = run('papercusp-server', ['upgrade', '0.0.26']);
    assert.equal(upgrade.status, 0, `${upgrade.stdout}${upgrade.stderr}`);
    assert.deepEqual(h.calls(), ['deb-systemd-invoke --user stop papercusp-server.service']);

    for (const [packageName, args, extra, why] of [
      ['papercusp-server', ['install'], {}, 'a first install has no running unit to stop'],
      ['papercusp-server', ['abort-upgrade', '0.0.33'], {}, 'an unwind must not stop the restored unit'],
      ['papercusp-gui', ['upgrade', '0.0.26'], {}, 'GUI upgrade must not stop the Server unit'],
      ['papercusp-server', ['upgrade', '0.0.26'], { DPKG_ROOT: '/chroot' }, 'never address the host from a DPKG_ROOT install'],
    ]) {
      h.reset();
      const result = run(packageName, args, extra);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.deepEqual(h.calls(), [], why);
    }
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }
});

test('Debian Server postinst resets and restarts the enabled unit after upgrade and on abort unwind (EI-27105381385516766)', () => {
  const postinstPath = process.env.PAPERCUSP_POSTINSTALL_UNDER_TEST
    || path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(postinstPath, 'utf8');
  const expectedRestart = [
    'deb-systemd-invoke --user daemon-reload',
    'systemctl --no-legend --quiet list-units user@*',
    'systemctl --quiet --user --machine 1000@ reset-failed papercusp-server.service',
    'systemctl --quiet --user --machine 1001@ reset-failed papercusp-server.service',
    'deb-systemd-invoke --user restart papercusp-server.service',
  ];

  // The abort-* unwind exits right after the restart, so the real script runs
  // end to end here without reaching any configure-only side effect.
  const h = debSystemdShims();
  try {
    const run = (packageName, args) => childProcess.spawnSync('sh', [postinstPath, ...args], {
      encoding: 'utf8',
      env: h.env({ DPKG_MAINTSCRIPT_PACKAGE: packageName }),
    });
    for (const action of ['abort-upgrade', 'abort-remove', 'abort-deconfigure']) {
      h.reset();
      const unwind = run('papercusp-server', [action, '0.0.33']);
      assert.equal(unwind.status, 0, `${action}: ${unwind.stdout}${unwind.stderr}`);
      assert.deepEqual(h.calls(), expectedRestart, `${action} must restart the unit prerm stopped`);
    }

    h.reset();
    const gui = run('papercusp-gui', ['abort-upgrade', '0.0.33']);
    assert.equal(gui.status, 0, `${gui.stdout}${gui.stderr}`);
    assert.deepEqual(h.calls(), [], 'GUI postinst must not touch the Server unit');

    h.reset();
    const other = run('papercusp-server', ['triggered', 'x']);
    assert.equal(other.status, 0, `${other.stdout}${other.stderr}`);
    assert.deepEqual(h.calls(), [], 'only configure and abort-* reach the unit');
  } finally {
    fs.rmSync(h.root, { recursive: true, force: true });
  }

  // A restart that systemd refuses must warn, never fail dpkg.
  const failing = debSystemdShims({ restartExit: 1 });
  try {
    const result = childProcess.spawnSync('sh', [postinstPath, 'abort-upgrade', '0.0.33'], {
      encoding: 'utf8',
      env: failing.env({ DPKG_MAINTSCRIPT_PACKAGE: 'papercusp-server' }),
    });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /WARN: could not restart papercusp-server\.service/);
  } finally {
    fs.rmSync(failing.root, { recursive: true, force: true });
  }

  // configure cannot run here (it writes /usr/bin), so pin its call site: the
  // restart is upgrade-only, after the enablement repair and every provisioning
  // step the Server needs, and before the detached ghostty worker.
  const restartCall = postinstall.indexOf('if [ -n "${2:-}" ]; then\n  server_user_unit_restart_enabled\nfi');
  assert.ok(restartCall >= 0, 'configure restarts the unit only when a previous version was configured');
  assert.ok(
    postinstall.indexOf('deb-systemd-helper --user reenable "$SERVER_USER_UNIT"') < restartCall,
    'restart must follow the enablement repair',
  );
  assert.ok(
    postinstall.indexOf('papercusp_install_bwrap_userns_profile /etc/apparmor.d') < restartCall,
    'restart must follow the bwrap userns grant the Server depends on',
  );
  assert.ok(restartCall < postinstall.indexOf('# ── (2) ghostty'), 'restart must not wait behind ghostty');
  assert.ok(
    postinstall.indexOf('abort-*)') < postinstall.indexOf('deb-systemd-helper --user unmask'),
    'the abort-* unwind must exit before any configure-only side effect',
  );
});

test('Debian removal stays quiet when the packaged desktop exits during the TERM wait', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-race-'));
  const procRoot = path.join(root, 'proc');
  const pid = '999999999';
  const pidRoot = path.join(procRoot, pid);
  const bin = path.join(root, 'bin');
  const sleepShim = path.join(bin, 'sleep');

  try {
    fs.mkdirSync(pidRoot, { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(pidRoot, 'cmdline'), '/usr/bin/papercusp-desktop\0');
    fs.writeFileSync(path.join(pidRoot, 'environ'), 'HOME=/nonexistent\0');
    fs.writeFileSync(
      sleepShim,
      [
        '#!/bin/sh',
        `rm -f ${JSON.stringify(path.join(pidRoot, 'cmdline'))} ${JSON.stringify(path.join(pidRoot, 'environ'))}`,
        `rmdir ${JSON.stringify(pidRoot)} 2>/dev/null || true`,
        '',
      ].join('\n'),
    );
    fs.chmodSync(sleepShim, 0o755);

    const result = childProcess.spawnSync('sh', [preRemovePath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
        PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
        PAPERCUSP_PREREMOVE_WAIT_SEC: '1',
        DPKG_MAINTSCRIPT_PACKAGE: 'papercusp-gui',
      },
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`stopping packaged desktop pid=${pid}`));
    assert.doesNotMatch(
      result.stderr,
      /cmdline: No such file|cmdline: cannot open/,
      'a disappearing process must not leak a /proc/cmdline redirection diagnostic',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Debian sibling removal selects only the executable owned by that package', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-siblings-'));
  const procRoot = path.join(root, 'proc');
  const guiPid = '999999991';
  const serverPid = '999999992';

  try {
    for (const [pid, executable] of [
      [guiPid, '/usr/bin/papercusp-desktop'],
      [serverPid, '/usr/bin/papercusp-server'],
    ]) {
      const pidRoot = path.join(procRoot, pid);
      fs.mkdirSync(pidRoot, { recursive: true });
      fs.writeFileSync(path.join(pidRoot, 'cmdline'), `${executable}\0`);
      fs.writeFileSync(path.join(pidRoot, 'environ'), 'HOME=/nonexistent\0');
    }

    for (const { packageName, ownedPid, siblingPid } of [
      { packageName: 'papercusp-gui', ownedPid: guiPid, siblingPid: serverPid },
      { packageName: 'papercusp-server', ownedPid: serverPid, siblingPid: guiPid },
    ]) {
      const result = childProcess.spawnSync('sh', [preRemovePath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DPKG_MAINTSCRIPT_PACKAGE: packageName,
          PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
          PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
          PAPERCUSP_PREREMOVE_WAIT_SEC: '0',
        },
      });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stderr, new RegExp(`stopping packaged desktop pid=${ownedPid}`));
      assert.doesNotMatch(
        result.stderr,
        new RegExp(`stopping packaged desktop pid=${siblingPid}`),
        `${packageName} removal must not stop its sibling executable`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('macOS Server starts without a console login (LaunchDaemon, not a gui-domain LaunchAgent)', () => {
  const launchdDir = path.join(desktopRoot, 'src-tauri/launchd');
  const templatePath = path.join(launchdDir, 'com.papercusp.server.plist.template');
  const currentTemplatePath = path.join(launchdDir, 'com.papercusp.server.current.plist.template');
  const installerPath = path.join(launchdDir, 'install-launchdaemon.sh');
  const currentLauncherPath = path.join(desktopRoot, 'bin/vm-rig/boot-headless-current.sh');
  const template = fs.readFileSync(templatePath, 'utf8');
  const currentTemplate = fs.readFileSync(currentTemplatePath, 'utf8');
  const installer = fs.readFileSync(installerPath, 'utf8');
  const currentLauncher = fs.readFileSync(currentLauncherPath, 'utf8');
  const rustMain = fs.readFileSync(path.join(desktopRoot, 'src-tauri/src/main.rs'), 'utf8');
  const contract = require(path.join(desktopRoot, 'src-tauri/distribution-contract.json'));

  // THE DEFECT THIS PINS (WI-475896). The headless entrypoint was
  // #[cfg(target_os = "linux")] while headless_service_requested() stayed
  // platform-neutral, so on macOS `--headless-service` parsed, was ignored, and
  // the binary fell through into tauri::Builder::default(). With no console
  // session there is no window server to attach to, so the peer stalled at 0%
  // CPU and the federation link went silent with no error anywhere. An
  // accepted-and-ignored flag is worse than a rejected one.
  assert.match(
    rustMain,
    /#\[cfg\(any\(target_os = "linux", target_os = "macos"\)\)\]\s*\n\s*if headless_service_requested/,
    '--headless-service must be honoured on macOS, not parsed and silently ignored',
  );
  assert.doesNotMatch(
    rustMain,
    /run_linux_headless_service/,
    'the headless entrypoint is no longer Linux-only; the Linux-specific name would re-imply it is',
  );

  // A LaunchAgent loads into launchd's gui/<uid> domain, which does not exist
  // while the Mac sits at the login window. Only a system-domain LaunchDaemon
  // delivers "up whenever the machine is up".
  assert.match(installer, /\/Library\/LaunchDaemons/, 'the service must install into the system domain');
  assert.match(installer, /launchctl bootstrap system/);
  assert.doesNotMatch(
    template,
    /LimitLoadToSessionType/,
    'a session-type restriction would re-bind the service to a GUI login',
  );

  assert.match(template, /<key>RunAtLoad<\/key>\s*<true\/>/, 'must start at boot');
  assert.match(template, /<key>KeepAlive<\/key>/, 'must restart after a crash');
  assert.match(template, /<key>UserName<\/key>/, 'running as root would create a root-owned state tree');
  assert.match(template, /--headless-service/);

  // EI-21708848218896947: launchd defaults CWD to "/" and the shipped sidecar
  // fatals during prompt assembly anywhere but its own directory.
  assert.match(
    template,
    /<key>WorkingDirectory<\/key>\s*<string>\/Applications\/Papercusp Server\.app\/Contents\/Resources\/sidecar<\/string>/,
    'without WorkingDirectory the daemon boots embedded Postgres and then dies on prompt assembly',
  );
  // `UserName` alone does NOT populate HOME — launchd leaves it unset or at
  // /var/root — and every workspace path the sidecar resolves hangs off HOME.
  assert.match(template, /<key>HOME<\/key>/);

  // Any placeholder the template declares must be one the installer actually
  // substitutes, or a live plist ships pointing at a literal __TOKEN__ path.
  const declared = [...new Set(template.match(/__PAPERCUSP_[A-Z_]+__/g) || [])];
  assert.ok(declared.length > 0, 'the template is expected to carry install-time placeholders');
  for (const token of declared) {
    assert.ok(
      installer.includes(`//${token}/`),
      `install-launchdaemon.sh declares no substitution for ${token}`,
    );
  }

  // EI-216508 / D-104: the exact tower-composed payload uses the same system
  // service identity instead of a second daemon that can race it for PG/:3070.
  assert.match(currentTemplate, /<string>com\.papercusp\.server<\/string>/);
  assert.match(currentTemplate, /__PAPERCUSP_CURRENT_LAUNCHER__<\/string>\s*<string>--launchd-run<\/string>/);
  assert.match(currentTemplate, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(currentTemplate, /<key>KeepAlive<\/key>[\s\S]*?<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(currentTemplate, /<key>WorkingDirectory<\/key>\s*<string>__PAPERCUSP_CURRENT_PAYLOAD__<\/string>/);
  assert.match(currentTemplate, /<key>HOME<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>USERPROFILE<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_RIG_HOME<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_RIG_SIDECAR_DIR<\/key>\s*<string>__PAPERCUSP_CURRENT_PAYLOAD__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_HONO_PORT<\/key>\s*<string>__PAPERCUSP_CURRENT_PORT__<\/string>/);
  // EI-22368205971185543: a generated current-payload sidecar has no baked
  // source SHA. The LaunchDaemon must receive the exact payload identity so a
  // healthy :3070 response cannot be mistaken for an unproven bundle.
  assert.match(currentTemplate, /<key>PAPERCUSP_BUILD_SHA<\/key>\s*<string>__PAPERCUSP_CURRENT_BUILD_SHA__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_BUILD_VERSION<\/key>\s*<string>__PAPERCUSP_CURRENT_BUILD_VERSION__<\/string>/);
  assert.match(installer, /--build-sha\)/);
  assert.match(installer, /--build-version\)/);
  assert.match(installer, /CURRENT_PAYLOAD}\/BUILD-STAMP\.txt/);
  assert.match(installer, /health_sha=/);
  assert.match(installer, /CURRENT_BUILD_SHA/);

  const currentDeclared = [...new Set(currentTemplate.match(/__PAPERCUSP_[A-Z_]+__/g) || [])];
  for (const token of currentDeclared) {
    assert.ok(installer.includes(`//${token}/`), `installer does not substitute current-payload token ${token}`);
  }

  // EI-218402: the rig's current-payload service executes the checked-in
  // launcher + bundled Node directly. It must remain installable when the
  // unrelated native Tauri binary is absent, while ordinary packaged-service
  // mode still fails closed without that binary.
  const currentBranchStart = installer.indexOf('if [ -n "$CURRENT_PAYLOAD" ] || [ -n "$CURRENT_LAUNCHER" ]');
  const packagedBranchStart = installer.indexOf('\nelse\n  [ -x "$BINARY" ]', currentBranchStart);
  assert.ok(currentBranchStart >= 0 && packagedBranchStart > currentBranchStart);
  const currentPreflight = installer.slice(currentBranchStart, packagedBranchStart);
  assert.doesNotMatch(currentPreflight, /\[ -x "\$BINARY" \]/);
  assert.match(currentPreflight, /\[ -x "\$\{SIDECAR_DIR\}\/bin\/node" \]/);
  assert.match(installer.slice(packagedBranchStart), /\[ -x "\$BINARY" \]/);

  const unload = installer.indexOf('unload_if_present\nif [ "$SERVICE_KIND" = "current" ]');
  const exactStop = installer.indexOf('"$CURRENT_LAUNCHER" --stop-only');
  const enable = installer.indexOf('launchctl enable "system/${LABEL}"');
  const bootstrap = installer.indexOf('launchctl bootstrap system "$PLIST_DEST"');
  assert.ok(
    unload >= 0 && exactStop > unload && enable > exactStop && bootstrap > enable,
    'bootout + exact stop + enable must precede bootstrap',
  );
  assert.match(installer, /operator_pid" = "\$service_pid"/);
  assert.match(installer, /lsof -nP -a -p "\$service_pid" -iTCP:"\$CURRENT_PORT" -sTCP:LISTEN/);
  assert.match(installer, /curl -fsS -m 2 "http:\/\/127\.0\.0\.1:\$\{CURRENT_PORT\}\/api\/health"/);

  // EI-22367240585613586: if launchd's discovery/PID files are stale, the
  // exact-owner stop may recover from a unique port listener only after its
  // executable + serve path are validated; it must never fall back to a broad
  // `pkill`/process-table sweep.
  assert.match(currentLauncher, /process_executable\(\)/);
  assert.match(currentLauncher, /pid_from_unique_port_owner\(\)/);
  assert.match(currentLauncher, /lsof -nP -iTCP:"\$HONO_PORT" -sTCP:LISTEN -t/);
  assert.match(currentLauncher, /pid_from_file "\$PIDFILE" \|\| pid_from_unique_port_owner/);

  // The contract recorded linuxUserUnit and no macOS counterpart, which is how
  // the platform asymmetry stayed invisible. Keep both named.
  assert.equal(
    contract.server.installedIdentities.macosServiceDaemon,
    '/Library/LaunchDaemons/com.papercusp.server.plist',
  );
  assert.equal(
    contract.server.installedIdentities.linuxUserUnit,
    '/usr/lib/systemd/user/papercusp-server.service',
  );

  assert.equal(childProcess.spawnSync('bash', ['-n', installerPath]).status, 0);
});

test('Linux Server ships an opt-in boot-start helper, because a user unit alone dies with the last login', () => {
  const helperPath = path.join(desktopRoot, 'src-tauri/systemd/enable-boot-start.sh');
  const helper = fs.readFileSync(helperPath, 'utf8');
  const unit = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/systemd/papercusp-server.service'),
    'utf8',
  );
  const contract = require(path.join(desktopRoot, 'src-tauri/distribution-contract.json'));

  // THE DEFECT THIS PINS (WI-479556, sibling of WI-475896's macOS half).
  // papercusp-server.service is a systemd USER unit, and a per-user manager is
  // started at login and torn down with the user's last session. Without
  // lingering, a headless Linux peer is up only while somebody is logged in —
  // and nothing errors, so it reads as a federation fault rather than a service
  // that was never started.
  assert.match(unit, /^WantedBy=default\.target$/m, 'this test only makes sense for a user unit');
  assert.match(helper, /loginctl enable-linger/, 'boot-start requires lingering for the owning account');
  assert.match(helper, /loginctl disable-linger/, 'the helper must be reversible');

  // enable-linger can report success while the state does not stick (a
  // read-only /var/lib/systemd/linger, for one). Verify, do not assume.
  assert.match(
    helper,
    /show-user[^\n]*--property=Linger/,
    'the helper must VERIFY linger took, not just request it',
  );

  // Without XDG_RUNTIME_DIR a `systemctl --user` run under sudo addresses
  // ROOT's manager and reports success while changing nothing for the account
  // that matters — a silent no-op with a green exit code.
  assert.match(
    helper,
    /XDG_RUNTIME_DIR=/,
    'systemctl --user must be pointed at the target account\'s own manager',
  );

  // It is deliberately NOT wired into postinstall: a deb maintainer script runs
  // as root with no SUDO_USER and cannot know which account should own the peer.
  const postinstall = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/deb/postinstall.sh'),
    'utf8',
  );
  assert.doesNotMatch(
    postinstall,
    /enable-linger/,
    'postinstall cannot know which account to enable linger for; keep this opt-in',
  );

  // WI-6554700010012562: until 0.0.26 the helper existed only in the SOURCE
  // tree — this test read the source file and passed while no package shipped
  // it, so an installed Server could not run its own remedy. The contract now
  // names an INSTALLED path, and every Linux Server overlay must map it.
  const installedHelper = contract.server.installedIdentities.linuxBootStartHelper;
  assert.equal(installedHelper, '/usr/sbin/papercusp-server-enable-boot-start');
  for (const overlay of ['tauri.server.conf.json', 'tauri.vm-release.conf.json']) {
    const config = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, 'src-tauri', overlay), 'utf8'),
    );
    assert.equal(
      config.bundle?.linux?.deb?.files?.[installedHelper],
      'systemd/enable-boot-start.sh',
      `${overlay} must package the boot-start helper at ${installedHelper}`,
    );
  }
  // Tauri's deb tar keeps only the executable bit, so the shipped helper is
  // runnable only if the source file is executable.
  assert.notEqual(fs.statSync(helperPath).mode & 0o111, 0, 'the helper must be executable');
  assert.match(
    helper,
    /sudo papercusp-server-enable-boot-start/,
    'the usage text must name the installed command, not a source-tree path',
  );
  assert.equal(childProcess.spawnSync('bash', ['-n', helperPath]).status, 0);
});

// EI-21417256075155406: without /etc/codex/skills, Codex's skills watcher watches /etc with
// IN_OPEN, so every process start on the host wakes every Codex agent session.
test('deb postinstall provisions the Codex system skills root for the Server package only', () => {
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(postinstallPath, 'utf8');
  const lines = postinstall.split('\n');
  const serverGate = lines.findIndex((l) => l.includes('DPKG_MAINTSCRIPT_PACKAGE') && l.includes('papercusp-server') && l.includes('exit 0'));
  const mkdir = lines.findIndex((l) => /^mkdir -p "\$\{DPKG_ROOT:-\}\/etc\/codex\/skills"/.test(l));
  assert.ok(serverGate >= 0, 'postinstall keeps its Server-only gate');
  assert.ok(mkdir > serverGate, 'the skills root is created after the Server-only gate, so the GUI package never creates it');
  assert.match(lines[mkdir], /\|\| true$/, 'creating the skills root can never fail the package install');
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);
});

// WI-10004618: on Ubuntu 23.10+ (apparmor_restrict_unprivileged_userns=1) Codex's
// bwrap sandbox cannot create a user namespace without an AppArmor grant, so every
// Codex command fails while the run reports success. Drive the REAL postinst
// function against a temp /etc/apparmor.d with a fake apparmor_parser.
function bwrapProfileHarness() {
  // Overridable so scripts/mutation-probe.sh can point it at a mutated copy.
  const subject = process.env.PAPERCUSP_POSTINSTALL_UNDER_TEST
    || path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(subject, 'utf8');
  const lines = postinstall.split('\n');
  const start = lines.findIndex((l) => l.startsWith('papercusp_install_bwrap_userns_profile() {'));
  assert.ok(start >= 0, 'postinstall defines papercusp_install_bwrap_userns_profile');
  // The heredoc'd AppArmor profile has its own bare `}` line, so the function ends at
  // the `}` that follows its final `return 0`, not at the first `}`.
  const end = lines.findIndex((l, i) => i > start && l === '}' && lines[i - 1] === '  return 0');
  assert.ok(end > start, 'found the end of papercusp_install_bwrap_userns_profile');
  const fn = lines.slice(start, end + 1).join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bwrap-profile-'));
  const aaDir = path.join(tmp, 'apparmor.d');
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(aaDir);
  fs.mkdirSync(binDir);
  const sysctl = path.join(tmp, 'apparmor_restrict_unprivileged_userns');
  const bwrap = path.join(tmp, 'bwrap');
  fs.writeFileSync(bwrap, '#!/bin/sh\n', { mode: 0o755 });
  const parserLog = path.join(tmp, 'parser.log');
  fs.writeFileSync(
    path.join(binDir, 'apparmor_parser'),
    `#!/bin/sh\necho "$@" >> '${parserLog}'\nexit "\${FAKE_PARSER_RC:-0}"\n`,
    { mode: 0o755 },
  );
  const script = path.join(tmp, 'run.sh');
  fs.writeFileSync(script, `set -e\n${fn}\npapercusp_install_bwrap_userns_profile "$1" "$2" "$3"\necho RC=$?\n`);
  const run = (env = {}) => childProcess.spawnSync('sh', [script, aaDir, sysctl, bwrap], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, ...env },
  });
  const profile = path.join(aaDir, 'bwrap');
  const parserCalls = () => (fs.existsSync(parserLog) ? fs.readFileSync(parserLog, 'utf8').trim().split('\n') : []);
  return { tmp, aaDir, sysctl, bwrap, profile, run, parserCalls };
}

test('deb postinstall grants /usr/bin/bwrap userns only on AppArmor-restricted kernels, scoped and reversible', () => {
  const h = bwrapProfileHarness();
  try {
    // Kernel without the restriction: nothing to grant, nothing written.
    let r = h.run();
    assert.match(r.stdout, /RC=0/);
    assert.equal(fs.existsSync(h.profile), false, 'no profile without the restriction sysctl');
    assert.deepEqual(h.parserCalls(), []);

    // Restricted kernel: a profile scoped to the bwrap binary, loaded with -r.
    fs.writeFileSync(h.sysctl, '1\n');
    r = h.run();
    assert.match(r.stdout, /RC=0/);
    const body = fs.readFileSync(h.profile, 'utf8');
    assert.match(body, /^# Managed by the papercusp-server package \(WI-10004618\)\./);
    assert.ok(body.includes(`profile bwrap ${h.bwrap} flags=(unconfined) {`), 'attaches to exactly the bwrap binary');
    assert.match(body, /^\s+userns,$/m);
    assert.match(body, /include if exists <local\/bwrap>/);
    assert.deepEqual(h.parserCalls(), [`-r ${h.profile}`]);

    // Upgrade: our own profile is rewritten in place.
    fs.appendFileSync(h.profile, '# stale\n');
    h.run();
    assert.equal(fs.readFileSync(h.profile, 'utf8').includes('# stale'), false, 'our profile is refreshed on upgrade');

    // A parser that rejects the profile (AppArmor without userns rules) leaves NO file behind.
    fs.rmSync(h.profile);
    r = h.run({ FAKE_PARSER_RC: '1' });
    assert.match(r.stdout, /RC=0/, 'a rejected profile never fails the install');
    assert.equal(fs.existsSync(h.profile), false, 'an unloadable profile is removed so apparmor.service cannot fail at boot');

    // An administrator-owned /etc/apparmor.d/bwrap is never touched.
    fs.writeFileSync(h.profile, 'profile bwrap /usr/bin/bwrap { }\n');
    const callsBefore = h.parserCalls().length;
    h.run();
    assert.equal(fs.readFileSync(h.profile, 'utf8'), 'profile bwrap /usr/bin/bwrap { }\n');
    assert.equal(h.parserCalls().length, callsBefore, 'parser not invoked for a foreign profile');

    // Another package's profile already attaching to bwrap: we stay out.
    fs.rmSync(h.profile);
    fs.writeFileSync(path.join(h.aaDir, 'bwrap-userns-restrict'), `profile bwrap ${h.bwrap} flags=(unconfined) {\n  userns,\n}\n`);
    h.run();
    assert.equal(fs.existsSync(h.profile), false, 'no second profile for the same attachment');
  } finally {
    fs.rmSync(h.tmp, { recursive: true, force: true });
  }
});

test('deb packaging wires the bwrap grant for the Server only: call site, Depends, and removal', () => {
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const lines = fs.readFileSync(postinstallPath, 'utf8').split('\n');
  const serverGate = lines.findIndex((l) => l.includes('DPKG_MAINTSCRIPT_PACKAGE') && l.includes('papercusp-server') && l.includes('exit 0'));
  const call = lines.findIndex((l) => /^\s+papercusp_install_bwrap_userns_profile \/etc\/apparmor\.d \\$/.test(l));
  assert.ok(call > serverGate && serverGate >= 0, 'the grant is installed after the Server-only gate');
  assert.match(lines[call + 1], /\/proc\/sys\/kernel\/apparmor_restrict_unprivileged_userns \/usr\/bin\/bwrap \|\| true$/);
  assert.match(lines[call - 1], /^if \[ -z "\$\{DPKG_ROOT:-\}" \]; then$/, 'never touches the live kernel during a DPKG_ROOT bootstrap');
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);

  const base = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  assert.deepEqual(base.bundle.linux.deb.depends, [], 'the thin GUI does not pull bubblewrap');
  for (const overlay of ['tauri.server.conf.json', 'tauri.vm-release.conf.json']) {
    const cfg = require(path.join(desktopRoot, 'src-tauri', overlay));
    assert.ok(cfg.bundle.linux.deb.depends.includes('bubblewrap'), `${overlay} depends on bubblewrap (Codex runs /usr/bin/bwrap)`);
  }

  const postremovePath = path.join(desktopRoot, 'src-tauri/deb/postremove.sh');
  const postremove = fs.readFileSync(postremovePath, 'utf8');
  assert.match(postremove, /grep -qF '# Managed by the papercusp-server package \(WI-10004618\)\.' \/etc\/apparmor\.d\/bwrap/, 'only our marked profile is removed');
  assert.match(postremove, /apparmor_parser -R \/etc\/apparmor\.d\/bwrap/, 'the grant is unloaded from the kernel, not just deleted');
  assert.equal(childProcess.spawnSync('sh', ['-n', postremovePath]).status, 0);
});

test('Linux Server deb installs and package-enables one systemd user service', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  const unitPath = path.join(desktopRoot, 'src-tauri/systemd/papercusp-server.service');
  const unit = fs.readFileSync(unitPath, 'utf8');
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(postinstallPath, 'utf8');
  const postremovePath = path.join(desktopRoot, 'src-tauri/deb/postremove.sh');
  const postremove = fs.readFileSync(postremovePath, 'utf8');
  const rustMain = fs.readFileSync(path.join(desktopRoot, 'src-tauri/src/main.rs'), 'utf8');

  assert.equal(baseConfig.bundle.linux.deb.files, undefined, 'the GUI package must not ship the Server unit');
  assert.deepEqual(serverConfig.bundle.linux.deb.files, {
    '/usr/lib/systemd/user/papercusp-server.service': 'systemd/papercusp-server.service',
    '/usr/sbin/papercusp-server-enable-boot-start': 'systemd/enable-boot-start.sh',
  });
  assert.equal(serverConfig.mainBinaryName, 'papercusp-server');

  assert.match(unit, /^\[Unit\]$/m);
  const unitSection = unit.split(/^\[Unit\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  assert.match(unitSection, /^StartLimitIntervalSec=600$/m);
  assert.match(unitSection, /^StartLimitBurst=6$/m);
  const serviceSection = unit.split(/^\[Service\]$/m)[1]?.split(/^\[/m)[0] ?? '';
  assert.doesNotMatch(serviceSection, /^StartLimit(?:IntervalSec|Burst)=/m);
  assert.match(unit, /^ConditionFileIsExecutable=\/usr\/bin\/papercusp-server$/m);
  assert.match(
    unit,
    /^Environment="PAPERCUSP_SIDECAR_DIR=\/usr\/lib\/Papercusp Server\/sidecar"$/m,
  );
  assert.match(unit, /^StateDirectory=papercusp\/controller$/m);
  assert.match(unit, /^StateDirectoryMode=0700$/m);
  assert.doesNotMatch(
    unit,
    /PAPERCUSP_WORKSPACE_HOST_(?:SSH_USER|KNOWN_HOSTS|REMOTE_ENTRYPOINT)=/,
    'the resolver must derive workspace-host controller defaults from the deployment contract and systemd StateDirectory',
  );
  assert.match(unit, /^ExecStart=\/usr\/bin\/papercusp-server --headless-service$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^KillMode=control-group$/m);
  assert.match(unit, /^ExitType=cgroup$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(
    unit,
    /graphical-session\.target/,
    'lightweight Linux sessions do not reliably activate graphical-session.target',
  );

  const systemdAnalyze = ['/usr/bin/systemd-analyze', '/bin/systemd-analyze'].find((candidate) => fs.existsSync(candidate));
  if (systemdAnalyze) {
    const unitSearchPath = [
      path.dirname(unitPath),
      '/etc/systemd/user',
      '/usr/local/lib/systemd/user',
      '/usr/lib/systemd/user',
      '/usr/share/systemd/user',
    ].join(':');
    const verified = childProcess.spawnSync(
      systemdAnalyze,
      ['--user', 'verify', 'papercusp-server.service'],
      {
        encoding: 'utf8',
        env: { ...process.env, SYSTEMD_UNIT_PATH: unitSearchPath },
      },
    );
    const unexpectedDiagnostics = verified.stderr
      .split('\n')
      .filter(Boolean)
      // The package binary is intentionally absent on a source/CI checkout.
      .filter((line) => !line.includes('Command /usr/bin/papercusp-server is not executable'));
    assert.deepEqual(
      unexpectedDiagnostics,
      [],
      `systemd-analyze rejected papercusp-server.service:\n${verified.stderr}`,
    );
  }
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);
  assert.equal(childProcess.spawnSync('sh', ['-n', postremovePath]).status, 0);

  assert.match(postinstall, /DPKG_MAINTSCRIPT_PACKAGE:-.*papercusp-server/);
  assert.ok(
    postinstall.indexOf('DPKG_MAINTSCRIPT_PACKAGE:-') < postinstall.indexOf('SERVER_USER_UNIT='),
    'the Server package gate must precede every postinstall side effect',
  );
  assert.match(postinstall, /SC="\/usr\/lib\/Papercusp Server\/sidecar"/);
  assert.doesNotMatch(postinstall, /ls -d \/usr\/lib\/Papercusp\*/);
  assert.match(postinstall, /^Icon=papercusp-server$/m);
  assert.match(postinstall, /deb-systemd-helper --quiet --user debian-installed "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /deb-systemd-helper --user enable "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /deb-systemd-helper --quiet --user was-enabled "\$SERVER_USER_UNIT"/);
  assert.match(
    postinstall,
    /CURRENT_SERVER_USER_LINK="\/etc\/systemd\/user\/default\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /LEGACY_SERVER_USER_LINK="\/etc\/systemd\/user\/graphical-session\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /CURRENT_SERVER_USER_STATE="\/var\/lib\/systemd\/deb-systemd-user-helper-enabled\/default\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /LEGACY_SERVER_USER_STATE="\/var\/lib\/systemd\/deb-systemd-user-helper-enabled\/graphical-session\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /readlink -f -- "\$1"[^\n]+\$SERVER_USER_PATH/,
    'link ownership must compare canonical package paths so /lib and /usr/lib aliases agree',
  );
  assert.match(postinstall, /server_user_link_is_package_owned "\$LEGACY_SERVER_USER_LINK"/);
  assert.match(postinstall, /deb-systemd-helper --user reenable "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /server_user_link_is_package_owned "\$CURRENT_SERVER_USER_LINK"/);
  assert.match(postinstall, /SERVER_USER_NEEDS_STATE_REPAIR=0/);
  assert.match(postinstall, /SERVER_USER_NEEDS_STATE_REPAIR=1/);
  assert.match(postinstall, /rm -f -- "\$CURRENT_SERVER_USER_STATE"/);
  assert.match(postinstall, /rm -f -- "\$LEGACY_SERVER_USER_LINK"/);
  assert.match(postinstall, /rm -f -- "\$LEGACY_SERVER_USER_STATE"/);
  const debianInstalledIndex = postinstall.indexOf(
    'deb-systemd-helper --quiet --user debian-installed "$SERVER_USER_UNIT"',
  );
  const firstInstallEnableIndex = postinstall.indexOf(
    'deb-systemd-helper --user enable "$SERVER_USER_UNIT"',
  );
  const wasEnabledIndex = postinstall.indexOf(
    'deb-systemd-helper --quiet --user was-enabled "$SERVER_USER_UNIT"',
  );
  assert.ok(
    debianInstalledIndex < firstInstallEnableIndex && firstInstallEnableIndex < wasEnabledIndex,
    'fresh installs must enable before the upgrade-only enabled-state branch',
  );
  assert.ok(
    postinstall.indexOf('rm -f -- "$CURRENT_SERVER_USER_STATE"')
      < postinstall.indexOf('deb-systemd-helper --user reenable "$SERVER_USER_UNIT"'),
    'the exact blocking helper stamp must be cleared before reenable',
  );
  assert.ok(
    postinstall.indexOf('deb-systemd-helper --user reenable "$SERVER_USER_UNIT"')
      < postinstall.indexOf('server_user_link_is_package_owned "$CURRENT_SERVER_USER_LINK"'),
    'the current link must be checked only after reenable runs',
  );
  assert.ok(
    postinstall.indexOf('server_user_link_is_package_owned "$CURRENT_SERVER_USER_LINK"')
      < postinstall.indexOf('rm -f -- "$LEGACY_SERVER_USER_STATE"'),
    'legacy recovery state must survive until the current link is proven',
  );
  assert.match(postinstall, /deb-systemd-helper --user update-state "\$SERVER_USER_UNIT"/);
  assert.match(postremove, /deb-systemd-invoke --user daemon-reload/);
  assert.match(postremove, /deb-systemd-helper --user purge "\$SERVER_USER_UNIT"/);
  assert.ok(
    postremove.indexOf('deb-systemd-invoke --user daemon-reload')
      < postremove.indexOf('deb-systemd-helper --user purge "$SERVER_USER_UNIT"'),
    'live user managers must discard the removed fragment before purge state is considered',
  );
  assert.ok(
    postremove.indexOf('DPKG_MAINTSCRIPT_PACKAGE:-') < postremove.indexOf('case "$1" in'),
    'the Server package gate must precede manual launcher removal',
  );

  assert.match(rustMain, /#\[cfg\(not\(target_os = "linux"\)\)\]\s+fn enable_login_autostart/s);
  assert.match(rustMain, /#\[cfg\(target_os = "linux"\)\]\s+fn enable_login_autostart/s);
  assert.match(rustMain, /login auto-start is managed by papercusp-server\.service/);
  const headlessGate = rustMain.indexOf('if headless_service_requested(std::env::args_os())');
  const tauriBuilder = rustMain.indexOf('let base = tauri::Builder::default()');
  assert.ok(headlessGate >= 0, 'the service flag must have an explicit pre-Tauri branch');
  assert.ok(
    headlessGate < tauriBuilder,
    'the headless service branch must run before Tauri/GTK initialization',
  );
  // Renamed from run_linux_headless_service on 2026-08-28 (WI-475896) when the
  // branch was widened to macOS. The macOS-specific coverage — that the cfg gate
  // actually names darwin, so the flag cannot go back to being parsed-and-ignored
  // — lives in the LaunchDaemon test above.
  assert.match(rustMain, /fn run_headless_service\(\) -> !/);
  assert.match(rustMain, /spawn_serve\([\s\S]*?&INSTALL_DEFECT/);
});

test('sidecar ships the standalone project-history generator with the shared ESM banner', () => {
  const postinstall = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/deb/postinstall.sh'),
    'utf8',
  );

  assert.match(builder, /libs\/papercusp\/packages\/cli\/src\/project-history-entry\.ts/);
  assert.match(builder, /scripts\/project-history\.mjs/);
  assert.match(builder, /--banner:js="\$HOST_BANNER"/);
  assert.match(
    postinstall,
    /project-history\) shift; exec "\$SC\/bin\/node" "\$SC\/scripts\/project-history\.mjs"/, 
  );
});

test('sidecar ships and verifies the complete packaged OMP native MCP asset pair', () => {
  const pairLoop = 'for native_mcp_asset in native-client.cjs native-extension.mjs; do';
  assert.ok(
    builder.includes(pairLoop),
    'the producer must stage native-client.cjs and native-extension.mjs as one named pair',
  );
  assert.ok(
    builder.includes('NATIVE_MCP_DIST="$REPO_ROOT/packages/omp-plugin/dist"'),
    'the producer must copy the post-install build outputs from the pinned source tree',
  );
  assert.ok(
    builder.includes('cp -a "$NATIVE_MCP_DIST/$native_mcp_asset" "$SIDECAR_DIR/scripts/$native_mcp_asset"'),
    'the runtime file-URL assets must remain adjacent to packaged scripts/psu.mjs',
  );
  assert.ok(
    builder.includes('[[ -s "$NATIVE_MCP_DIST/$native_mcp_asset" ]]'),
    'the producer must fail closed when either built source asset is absent or empty',
  );
  assert.ok(
    sidecarVerifier.includes(pairLoop),
    'the finished-sidecar verifier must independently require the same complete asset pair',
  );
  assert.ok(
    sidecarVerifier.includes('native_mcp_path="$SIDECAR/scripts/$native_mcp_asset"'),
    'the verifier must inspect the packaged-adjacent layout the launcher actually resolves',
  );
  assert.ok(
    sidecarVerifier.includes('[[ -s "$native_mcp_path" ]]'),
    'the verifier must reject an absent or empty packaged asset',
  );
});

test('sidecar build closes direct linked-workspace peer contracts and hoists dockview v6', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackage = require(path.join(repoRoot, 'apps/operator/package.json'));
  const vitePackage = require(path.join(repoRoot, 'apps/operator-vite/package.json'));
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const workspaceRoot = path.join(repoRoot, 'libs/generic/dock-workbench');
  const installedDeclarations = {
    ...operatorPackage.dependencies,
    ...operatorPackage.devDependencies,
    ...vitePackage.dependencies,
    ...vitePackage.devDependencies,
  };
  const missingPeerDeclarations = [];

  for (const [consumerRel, consumer] of [
    ['apps/operator', operatorPackage],
    ['apps/operator-vite', vitePackage],
  ]) {
    for (const [dep, spec] of Object.entries(consumer.dependencies || {})) {
      if (!spec.startsWith('file:')) continue;
      const dependencyRoot = path.resolve(repoRoot, consumerRel, spec.slice('file:'.length));
      const dependencyPackagePath = path.join(dependencyRoot, 'package.json');
      if (!fs.existsSync(dependencyPackagePath)) continue;
      const dependencyPackage = JSON.parse(fs.readFileSync(dependencyPackagePath, 'utf8'));
      for (const peer of Object.keys(dependencyPackage.peerDependencies || {})) {
        if (dependencyPackage.peerDependenciesMeta?.[peer]?.optional) continue;
        if (!(peer in installedDeclarations)) missingPeerDeclarations.push(`${dep} -> ${peer}`);
      }
    }
  }
  assert.deepEqual(missingPeerDeclarations, []);
  assert.equal(
    lock.packages['apps/operator'].dependencies['@papercusp/kv-persist'],
    operatorPackage.dependencies['@papercusp/kv-persist'],
    'the indexeddb peer must also survive the pinned scoped install',
  );

  for (const peer of ['dockview', 'dockview-react']) {
    assert.equal(
      rootPackage.dependencies[peer],
      operatorPackage.dependencies[peer],
      `${peer} root constraint must stay aligned so the scoped install can hoist it`,
    );
    assert.match(
      lock.packages[`node_modules/${peer}`].version,
      /^6\./,
      `${peer} must be hoisted at the root on the operator v6 line`,
    );
    assert.equal(
      lock.packages[`apps/operator/node_modules/${peer}`],
      undefined,
      `${peer} must not be locked only beneath the consuming app`,
    );
    assert.doesNotThrow(
      () => require.resolve(peer, { paths: [workspaceRoot] }),
      `${peer} must resolve from the workspace realpath Vite uses`,
    );
  }

  assert.match(builder, /spec\.startsWith\("file:"\)/);
  assert.match(builder, /workspacePackage\.peerDependenciesMeta\?\.\[peer\]\?\.optional/);
  assert.match(builder, /createRequire\(workspacePackagePath\)/);
});

test('sidecar source union declares every bare runtime import in operator-core', () => {
  const manifests = [
    require(path.join(repoRoot, 'packages/operator-core/package.json')),
    require(path.join(repoRoot, 'apps/operator/package.json')),
    require(path.join(repoRoot, 'apps/operator-vite/package.json')),
  ];
  const declared = new Set(
    manifests.flatMap((manifest) => [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]),
  );
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
  // Source-tree-only entries that no bundled runtime ever loads, so their imports never
  // reach the sidecar. snapshot-fold.worker.dev.mjs loads the .ts worker through tsx for
  // tsx/vitest runtimes; the sidecar loads the esbuilt snapshot-fold.worker.mjs instead
  // (snapshot-fold-offload.ts picks the bundled worker whenever it exists).
  // admission-jobs.tsx-worker.mjs is the same pattern for the release-admission worker: it
  // registers tsx on an unbundled host's worker thread, while bundled hosts load the esbuilt
  // admission-jobs.worker.mjs (admission-offthread.ts, WI-10005223 / WI-10005359).
  // The Codex-home worker follows the same bundled-worker selection. The BM25
  // helper is imported only by integration suites, never the host source graph.
  const sourceTreeOnly = new Set([
    'packages/operator-core/lib/sync/hyperbee/snapshot-fold.worker.dev.mjs',
    'packages/operator-core/lib/release/admission-jobs.tsx-worker.mjs',
    'packages/operator-core/lib/role-codex-home.worker.dev.mjs',
    'packages/operator-core/lib/code-intelligence/warm-cochange-index.worker.dev.mjs',
    'packages/operator-core/lib/search/lexical/test-pg/bm25-test-db.ts',
  ]);
  for (const relative of sourceTreeOnly) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, relative)),
      `stale sourceTreeOnly entry (file is gone): ${relative}`,
    );
  }
  const codexWorkerSelector = fs.readFileSync(
    path.join(repoRoot, 'packages/operator-core/lib/role-codex-home-offload.ts'), 'utf8',
  );
  assert.match(codexWorkerSelector, /existsSync\(bundled\) \? bundled : resolve\(dir, 'role-codex-home\.worker\.dev\.mjs'\)/);
  const hostBundler = fs.readFileSync(
    path.join(repoRoot, 'apps/operator/bin/bundle-host-common.sh'), 'utf8',
  );
  assert.ok(hostBundler.includes('"$repo_root/packages/operator-core/lib/role-codex-home.worker.ts"'));
  const warmWorkerSelector = fs.readFileSync(
    path.join(repoRoot, 'packages/operator-core/lib/code-intelligence/warm-cochange-index.ts'), 'utf8',
  );
  assert.match(warmWorkerSelector, /existsSync\(bundled\) \? bundled : join\(dirname\(here\), WARM_COCHANGE_WORKER_SOURCE\)/);
  assert.ok(hostBundler.includes('"$repo_root/packages/operator-core/lib/code-intelligence/warm-cochange-index.worker.ts"'));
  const missing = new Map();
  const packageName = (specifier) =>
    specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
  const inspectSpecifier = (specifier, file) => {
    if (specifier.startsWith('.')) {
      const resolved = path.relative(repoRoot, path.resolve(path.dirname(file), specifier));
      assert.notEqual(
        resolved.replace(/\.ts$/, ''),
        'packages/operator-core/lib/search/lexical/test-pg/bm25-test-db',
        `runtime source must not import the test-only BM25 helper: ${path.relative(repoRoot, file)}`,
      );
    }
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:') ||
      builtins.has(specifier.split('/')[0])
    ) return;
    const dependency = packageName(specifier);
    if (declared.has(dependency)) return;
    if (!missing.has(dependency)) missing.set(dependency, new Set());
    missing.get(dependency).add(path.relative(repoRoot, file));
  };
  const visitDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['dist', 'node_modules'].includes(entry.name)) visitDirectory(file);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[^.]+$/.test(entry.name)) continue;
      if (sourceTreeOnly.has(path.relative(repoRoot, file))) continue;
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visitNode = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            inspectSpecifier(node.moduleSpecifier.text, file);
          }
        } else if (
          ts.isCallExpression(node) &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          inspectSpecifier(node.arguments[0].text, file);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(source);
    }
  };

  visitDirectory(path.join(repoRoot, 'packages/operator-core/lib'));
  assert.deepEqual(
    [...missing].map(([dependency, files]) => [dependency, [...files].sort()]).sort(),
    [],
  );
});

test('sidecar server bundle declares DBOS telemetry runtime requirements', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackagePath = path.join(repoRoot, 'apps/operator/package.json');
  const operatorPackage = require(operatorPackagePath);
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const requireFromOperator = createRequire(operatorPackagePath);

  // @dbos-inc/dbos-sdk's telemetry module requires these packages at runtime,
  // but its published manifest does not declare them. The root only carried
  // them as devDependencies, so the release builder's scoped workspace install
  // pruned them before esbuild followed the server graph. Keep the bundle's
  // actual runtime contract on the installed app workspace.
  for (const dependency of ['winston', 'winston-transport']) {
    assert.equal(
      operatorPackage.dependencies[dependency],
      rootPackage.devDependencies[dependency],
      `${dependency} must remain a production dependency of the installed operator workspace`,
    );
    assert.equal(
      lock.packages[`node_modules/${dependency}`].dev,
      undefined,
      `${dependency} must not be locked as dev-only`,
    );
    assert.doesNotThrow(
      () => requireFromOperator.resolve(dependency),
      `${dependency} must resolve from the operator workspace used by the sidecar server bundle`,
    );
  }
});

test('sidecar build resolves and verifies the repo-pinned Node runtime before npm install', () => {
  const runtimeStart = builder.indexOf('PAPERCUSP_REQUIRED_NODE_MAJOR=');
  const installStart = builder.indexOf('node scripts/npm-install-safe.mjs install');
  assert(runtimeStart >= 0, 'missing repo-pinned Node runtime selector');
  assert(installStart > runtimeStart, 'Node runtime selection must happen before npm install');

  const runtimeBlock = builder.slice(runtimeStart, installStart);
  assert.match(runtimeBlock, /REPO_ROOT\/\.nvmrc/);
  assert.match(runtimeBlock, /papercusp_node_major/);
  assert.match(runtimeBlock, /home\/linuxbrew\/\.linuxbrew\/bin\/node/);
  assert.match(runtimeBlock, /opt\/homebrew\/bin\/node/);
  assert.match(runtimeBlock, /\.nvm\/versions\/node/);
  assert.match(runtimeBlock, /export PATH="\$\(dirname "\$_selected_node"\):\$PATH"/);
  assert.match(runtimeBlock, /\[ "\$_node_major" -ge "\$PAPERCUSP_REQUIRED_NODE_MAJOR" \]/);
  assert.match(runtimeBlock, /ERROR: sidecar release build requires Node/);
});

// WI-10006694 — an ESM bundle that reaches a CommonJS require() throws "Dynamic require of ... is
// not supported" at load unless it carries the createRequire banner. The orchestrator bins shipped
// without it, so every packaged dbos-invoke role spawn (the D-055 merge-resolver on c1007k) died
// before main.
const ESM_REQUIRE_SHIM_GUARD = extractFunction('assert_esm_require_shim');

function runEsmRequireShimGuard(files) {
  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise the builder helper');
  return childProcess.spawnSync(
    bash,
    ['-c', `set -euo pipefail\n${ESM_REQUIRE_SHIM_GUARD}\nassert_esm_require_shim "$@"`, 'guard', ...files],
    { encoding: 'utf8' },
  );
}

test('assert_esm_require_shim refuses a bundle with the dynamic-require stub and no createRequire banner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-esm-shim-'));
  try {
    // esbuild's stub, as minified into the c1007k invoke-once.mjs.
    const stub = 'var __require=(x=>{throw Error(\'Dynamic require of "\'+x+\'" is not supported\')});__require("process");\n';
    const bare = path.join(dir, 'bare.mjs');
    fs.writeFileSync(bare, stub);
    const bannered = path.join(dir, 'bannered.mjs');
    fs.writeFileSync(
      bannered,
      `#!/usr/bin/env node\nimport{createRequire as __pcr}from'module';const require=__pcr(import.meta.url);\n${stub}`,
    );
    const plain = path.join(dir, 'plain.mjs');
    fs.writeFileSync(plain, 'console.log(1);\n');

    const refused = runEsmRequireShimGuard([plain, bare]);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /bare\.mjs reaches a CommonJS require\(\) but has no createRequire banner/);

    const accepted = runEsmRequireShimGuard([plain, bannered]);
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every ESM esbuild bundle in the builder carries the createRequire banner or is checked by assert_esm_require_shim', () => {
  const lines = builder.split('\n');
  const invocations = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/npx --yes esbuild@/.test(lines[i])) continue;
    let end = i;
    let text = lines[i];
    while (/\\\s*$/.test(lines[end]) && end + 1 < lines.length) {
      end += 1;
      text += `\n${lines[end]}`;
    }
    invocations.push({ start: i + 1, end: end + 1, text });
  }
  const esm = invocations.filter((inv) => /--format=esm/.test(inv.text));
  const shared = fs.readFileSync(path.join(repoRoot, 'apps/operator/bin/bundle-host-common.sh'), 'utf8');
  const delegated = ['bundle_host_primary', 'bundle_host_launcher'];
  for (const name of delegated) {
    assert.match(builder, new RegExp('^\\s*' + name + ' "\\$REPO_ROOT"', 'm'));
    const recipe = sharedBundleFunction(shared, name);
    assert.match(recipe, /--format=esm/);
    assert.match(recipe, /--banner:js="\$HOST_BANNER"/);
  }
  assert.ok(esm.length + delegated.length >= 7,
    `expected inline and delegated ESM bundles, found ${esm.length} + ${delegated.length}`);
  const unguarded = esm.filter(
    (inv) =>
      !/--banner:js="\$HOST_BANNER"/.test(inv.text) &&
      !lines.slice(inv.end, inv.end + 25).some((line) => /^\s*assert_esm_require_shim /.test(line)),
  );
  assert.deepEqual(unguarded.map((inv) => `build-desktop-sidecar.sh:${inv.start}`), []);

  const orchestrator = esm.find((inv) => inv.text.includes('"$ORCH_SRC/bin/$b.ts"'));
  assert.ok(orchestrator, 'the orchestrator bins bundle is missing from the builder');
  assert.match(orchestrator.text, /--banner:js="\$HOST_BANNER"/);
  assert.match(builder, /^assert_esm_require_shim "\$ORCH_DST"\/bin\/\*\.mjs \|\| exit 1$/m);
});

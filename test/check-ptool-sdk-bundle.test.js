// WI-6554700010012487 — the shipped ptool CLI must carry its MCP SDK inlined.
// Papercusp Server 0.0.26 shipped a /usr/bin/ptool that died with "Cannot find
// package '@modelcontextprotocol/sdk'": ptool imported the SDK through a computed
// import(specifier), which esbuild cannot inline, and the sidecar ships no
// @modelcontextprotocol tree. These tests bundle the REAL ptool source the way
// build-desktop-sidecar.sh does and run bin/check-ptool-sdk-bundle.mjs on it.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const checker = path.join(desktopRoot, 'bin/check-ptool-sdk-bundle.mjs');
const ptoolSource = path.join(repoRoot, 'apps/operator/scripts/ptool.mjs');
const builder = fs.readFileSync(
  process.env.BUILD_DESKTOP_SIDECAR_PATH ?? path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);
const esbuild = createRequire(path.join(repoRoot, 'package.json'))('esbuild');

const LITERAL_TYPES_LOADER = "() => import('@modelcontextprotocol/sdk/types.js')";
// Not constant-foldable: esbuild folds String('x') back into a literal, so the
// mutant must depend on a runtime value to reproduce the 0.0.26 failure.
const COMPUTED_TYPES_LOADER =
  "() => import(globalThis.__ptoolSdkSpecifier ?? '@modelcontextprotocol/sdk/types.js')";

function hasNodeModulesAncestor(dir) {
  let current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, 'node_modules'))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

/** A temp root the checker can isolate in; the suite cannot measure anything without one. */
function isolatedTmpRoot() {
  const root = [os.tmpdir(), '/tmp', '/var/tmp'].find(
    (dir) => fs.existsSync(dir) && !hasNodeModulesAncestor(dir),
  );
  assert(root, 'no temp root without a node_modules ancestor; the self-check cannot be measured');
  return root;
}

/** Bundle `contents` with the builder's esbuild recipe into a fresh temp dir. */
function bundle(contents, label) {
  const outDir = fs.mkdtempSync(path.join(isolatedTmpRoot(), `ptool-bundle-${label}-`));
  const outfile = path.join(outDir, 'ptool.mjs');
  esbuild.buildSync({
    stdin: {
      contents,
      resolveDir: path.dirname(ptoolSource),
      sourcefile: 'ptool.mjs',
      loader: 'js',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minifyWhitespace: true,
    minifySyntax: true,
    outfile,
    external: ['@lydell/*'],
    banner: {
      js: "import { createRequire as __ptoolCreateRequire } from 'node:module'; const require = __ptoolCreateRequire(import.meta.url);",
    },
    logLevel: 'silent',
  });
  return { outDir, outfile };
}

function runChecker(bundlePath, tmpRoot = isolatedTmpRoot(), extraArgs = []) {
  const result = childProcess.spawnSync(
    process.execPath,
    [checker, bundlePath, '--tmp-root', tmpRoot, ...extraArgs],
    { encoding: 'utf8', timeout: 120_000 },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('the sidecar builder refuses missing producer tooling before dependency or UI builds', () => {
  const preflight = builder.match(/^if \[\[ ! -r "\$HERE\/check-ptool-sdk-bundle\.mjs" \]\]; then\n[\s\S]*?^fi$/m)?.[0];
  assert.ok(preflight, 'early producer checker preflight is missing');
  assert.ok(builder.indexOf(preflight) < builder.indexOf('node "$HERE/lib/spa-freshness.js"'));
  const absent = fs.mkdtempSync(path.join(isolatedTmpRoot(), 'ptool-producer-missing-'));
  try {
    const run = (here) => childProcess.spawnSync('bash', ['-c', preflight], {
      encoding: 'utf8', env: { ...process.env, HERE: here },
    });
    assert.equal(run(path.join(desktopRoot, 'bin')).status, 0);
    const missing = run(absent);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /current producer is missing ptool SDK checker/);
  } finally {
    fs.rmSync(absent, { recursive: true, force: true });
  }
});

test('the sidecar builder runs the ptool SDK self-check on the bundled ptool', () => {
  const loopEnd = builder.indexOf(
    'for _psu_cli in psu:psu-launcher ptool:ptool onboard:onboard-launcher',
  );
  assert(loopEnd >= 0, 'psu/ptool esbuild loop not found in build-desktop-sidecar.sh');
  const check = builder.indexOf(
    'node "$HERE/check-ptool-sdk-bundle.mjs" "$SIDECAR_DIR/scripts/ptool.mjs"',
  );
  assert(check > loopEnd, 'the self-check must run on scripts/ptool.mjs after the esbuild loop');
  const guarded = builder.match(/^if ! node [^\n]*check-ptool-sdk-bundle\.mjs[^\n]*\n[\s\S]*?^fi$/m)?.[0];
  assert.ok(guarded, 'the checker must run in a build-failing guard');
  assert.match(guarded, /if ! node "\$HERE\/check-ptool-sdk-bundle\.mjs"/);
  assert.match(guarded, /exit 1/, 'a failed self-check must fail the build');
});

test('the current producer checks the real ptool bundle even when the frozen target predates its checker', () => {
  const source = fs.readFileSync(ptoolSource, 'utf8');
  assert(source.includes(LITERAL_TYPES_LOADER), 'ptool.mjs no longer has the literal types.js loader');
  const { outDir, outfile } = bundle(source, 'real');
  try {
    const block = builder.match(/^if ! node [^\n]*check-ptool-sdk-bundle\.mjs[^\n]*\n[\s\S]*?^fi$/m)?.[0];
    assert.ok(block, 'maintained producer checker call is missing');
    const sidecar = path.join(outDir, 'sidecar');
    const target = path.join(outDir, 'older-desktop');
    fs.mkdirSync(path.join(sidecar, 'scripts'), { recursive: true });
    fs.mkdirSync(target);
    fs.copyFileSync(outfile, path.join(sidecar, 'scripts/ptool.mjs'));
    const execute = (source) => childProcess.spawnSync('bash', ['-c', `set -euo pipefail\n${source}`], {
      encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, HERE: path.join(desktopRoot, 'bin'), ROOT: target, SIDECAR_DIR: sidecar },
    });
    const result = execute(block);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ptool SDK self-check: 3 loader\(s\) resolve from an isolated copy/);
    assert.equal(fs.existsSync(path.join(target, 'bin/check-ptool-sdk-bundle.mjs')), false);
    const oldPath = block.replace('$HERE/check-ptool-sdk-bundle.mjs', '$ROOT/bin/check-ptool-sdk-bundle.mjs');
    assert.notEqual(oldPath, block);
    const counterexample = execute(oldPath);
    assert.equal(counterexample.status, 1);
    assert.match(counterexample.stderr, /Cannot find module .*older-desktop\/bin\/check-ptool-sdk-bundle/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('a computed SDK import in the real ptool source fails the self-check', () => {
  const source = fs.readFileSync(ptoolSource, 'utf8');
  const mutant = source.replace(LITERAL_TYPES_LOADER, COMPUTED_TYPES_LOADER);
  assert.notEqual(mutant, source, 'mutation did not apply');
  const { outDir, outfile } = bundle(mutant, 'computed');
  try {
    const { status, output } = runChecker(outfile);
    assert.equal(status, 1, output);
    assert.match(output, /cannot load @modelcontextprotocol\/sdk\/types\.js without a node_modules tree/);
    assert.match(output, /ERR_MODULE_NOT_FOUND/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('a bundle that exports no loader table fails the self-check', () => {
  const { outDir, outfile } = bundle('export const unrelated = 1;\n', 'empty');
  try {
    const { status, output } = runChecker(outfile);
    assert.equal(status, 1, output);
    assert.match(output, /exports no PTOOL_SDK_MODULE_LOADERS table/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('retained computed SDK imports qualify only with the shipped dependency closure', () => {
  const { outDir, outfile } = bundle(`
    export async function importSdkModuleWithInstallAwareness(specifier) { return import(specifier); }
    if (process.argv.includes('--list')) {
      const { Client } = await importSdkModuleWithInstallAwareness('@modelcontextprotocol/sdk/client/index.js');
      if (typeof Client !== 'function') throw new Error('SDK client unavailable');
    }
  `, 'legacy');
  const sidecar = path.join(outDir, 'sidecar');
  fs.mkdirSync(sidecar);
  try {
    const missing = runChecker(outfile);
    assert.equal(missing.status, 1, missing.output);
    assert.match(missing.output, /exports no PTOOL_SDK_MODULE_LOADERS/);
    const copied = childProcess.spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$CLOSURE"
      nat_copied=0; nat_missing=0; _seen='|'
      _bare_node_platform=''; _bare_node_arch=''
      copy_pkg_closure @modelcontextprotocol/sdk
      test "$nat_missing" -eq 0
    `], { encoding: 'utf8', timeout: 120_000, env: {
      ...process.env, CLOSURE: path.join(desktopRoot, 'bin/lib/host-runtime-closure.sh'),
      WEB_DIR: path.join(repoRoot, 'apps/operator'), REPO_ROOT: repoRoot,
      ROOT: desktopRoot, SIDECAR_DIR: sidecar,
    } });
    assert.equal(copied.status, 0, `${copied.stdout}\n${copied.stderr}`);
    const closure = path.join(sidecar, 'node_modules');
    const qualified = runChecker(outfile, isolatedTmpRoot(), ['--runtime-closure', closure]);
    assert.equal(qualified.status, 0, qualified.output);
    assert.match(qualified.output, /3 loader\(s\).*runtime-closure/);
    // Remove a real transitive dependency, not the SDK entrypoint. No ancestor
    // install may rescue an incomplete shipped graph.
    fs.rmSync(path.join(closure, 'zod'), { recursive: true, force: true });
    const broken = runChecker(outfile, isolatedTmpRoot(), ['--runtime-closure', closure]);
    assert.equal(broken.status, 1, broken.output);
    assert.match(broken.output, /isolated runtime closure/);
    assert.match(broken.output, /ERR_MODULE_NOT_FOUND/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('supplying a closure cannot mask a modern computed loader regression', () => {
  const source = fs.readFileSync(ptoolSource, 'utf8');
  const { outDir, outfile } = bundle(source.replace(LITERAL_TYPES_LOADER, COMPUTED_TYPES_LOADER), 'strict-closure');
  try {
    const result = runChecker(outfile, isolatedTmpRoot(), ['--runtime-closure', path.join(repoRoot, 'node_modules')]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /cannot load @modelcontextprotocol\/sdk\/types\.js without a node_modules tree/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('the self-check rejects a bundle whose loaders pass but CLI bootstrap fails', () => {
  const { outDir, outfile } = bundle(`
    export const PTOOL_SDK_MODULE_LOADERS = { fixture: async () => ({}) };
    if (process.argv.includes('--list')) throw new TypeError('fixture CLI bootstrap failure');
  `, 'cli-bootstrap');
  try {
    const { status, output } = runChecker(outfile);
    assert.equal(status, 1, output);
    assert.match(output, /bundled ptool CLI bootstrap failed/);
    assert.match(output, /fixture CLI bootstrap failure/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
});

test('the self-check refuses an isolation dir that can reach a node_modules tree', async () => {
  const { findNodeModulesAncestor } = await import(pathToFileURL(checker).href);
  assert.equal(findNodeModulesAncestor(isolatedTmpRoot()), null);
  assert.notEqual(findNodeModulesAncestor(path.join(repoRoot, 'apps/operator/scripts')), null);

  const { outDir, outfile } = bundle('export const PTOOL_SDK_MODULE_LOADERS = {};\n', 'masked');
  const masked = fs.mkdtempSync(path.join(isolatedTmpRoot(), 'ptool-masked-'));
  try {
    fs.mkdirSync(path.join(masked, 'node_modules'));
    const { status, output } = runChecker(outfile, masked);
    assert.equal(status, 2, output);
    assert.match(output, /would mask an unbundled SDK import/);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(masked, { recursive: true, force: true });
  }
});

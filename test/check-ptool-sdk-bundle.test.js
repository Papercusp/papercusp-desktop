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

function runChecker(bundlePath, tmpRoot = isolatedTmpRoot()) {
  const result = childProcess.spawnSync(
    process.execPath,
    [checker, bundlePath, '--tmp-root', tmpRoot],
    { encoding: 'utf8', timeout: 120_000 },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test('the sidecar builder runs the ptool SDK self-check on the bundled ptool', () => {
  const loopEnd = builder.indexOf(
    'for _psu_cli in psu:psu-launcher ptool:ptool onboard:onboard-launcher',
  );
  assert(loopEnd >= 0, 'psu/ptool esbuild loop not found in build-desktop-sidecar.sh');
  const check = builder.indexOf(
    'node "$ROOT/bin/check-ptool-sdk-bundle.mjs" "$SIDECAR_DIR/scripts/ptool.mjs"',
  );
  assert(check > loopEnd, 'the self-check must run on scripts/ptool.mjs after the esbuild loop');
  const guarded = builder.slice(check - 10, check + 200);
  assert.match(guarded, /if ! node "\$ROOT\/bin\/check-ptool-sdk-bundle\.mjs"/);
  assert.match(guarded, /exit 1/, 'a failed self-check must fail the build');
});

test('the real ptool bundle loads every SDK module from an isolated copy', () => {
  const source = fs.readFileSync(ptoolSource, 'utf8');
  assert(source.includes(LITERAL_TYPES_LOADER), 'ptool.mjs no longer has the literal types.js loader');
  const { outDir, outfile } = bundle(source, 'real');
  try {
    const { status, output } = runChecker(outfile);
    assert.equal(status, 0, output);
    assert.match(output, /ptool SDK self-check: 3 loader\(s\) resolve from an isolated copy/);
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

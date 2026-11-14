// WI-37620 — the two sidecar-side remedies the WI-4419 identity gate depends on.
//
// WHY THIS TEST EXISTS
// The gate's failure message offers exactly two fixes: "prune the leaking file from
// the sidecar copy in build-desktop-sidecar.sh, or scrub the value — never add an
// exclude here." Both remedies live in audit-release-bundle.py, both are invoked by
// build-desktop-sidecar.sh, and until 0.0.14 both had a hole:
//
//   PRUNE  — prune_docs applied ONLY the `internal-build-infra-docs` rule, so the
//            pagefind shards under the sidecar's internal-docs/ shipped unpruned.
//            The `pagefind-search-index` rule existed (added after the 0.0.9 cut
//            red on exactly this) but only ever filtered source.tar.zst — and
//            covering what tar-excludes cannot reach is the entire purpose of
//            prune_docs. The 0.0.14 cut red on the same literal in the same
//            artifact class as 0.0.9. Pruning DOCS could never have fixed it: the
//            shipping markdown is clean, only the generated INDEX carries the word.
//
//   SCRUB  — a build-box path baked into a compiled addon (.rodata, an assert()
//            __FILE__ expansion) is reachable by neither other remedy: `strip`
//            leaves it, and the file is loaded at runtime so it cannot be pruned.
//
// These assertions are BEHAVIOURAL — they run the real script against fixtures and
// check the real effects, so a rewrite that reintroduces either hole by another
// route still fails.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const AUDIT = path.join(root, 'bin/audit-release-bundle.py');
const TRUST_TOOLCHAIN = path.join(root, 'bin/lib/vm-release-trust-toolchain.sh');
const SOURCE_NOTE_HELPER = path.join(root, 'bin/lib/sidecar-source-note.sh');
const { collectImports, collectStaticClosure, collectLexicalReferences } = require('../bin/lib/runtime-import-census.cjs');

test('unused PostgreSQL language pruning follows hoisted and nested packages while preserving plpgsql', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-language-prune-'));
  try {
    const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
    const start = builder.indexOf('echo "→ stripping unused PL/* extensions');
    const end = builder.indexOf('\n# Strip musl-libc', start);
    assert.ok(start >= 0 && end > start, 'production language prune must be present');
    const retained = [];
    const removed = [];
    const packageRoots = ['node_modules/@embedded-postgres/linux-arm64/native',
      'node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/linux-x64/native'];
    for (const packageRoot of packageRoots) {
      for (const folder of ['lib/postgresql', 'share/postgresql/extension']) {
        for (const name of ['plpython3', 'ltree_plpython3', 'plperl', 'hstore_plperl', 'jsonb_plperl', 'pltcl']) {
          const file = path.join(dir, packageRoot, folder, name + (folder.startsWith('lib') ? '.so' : '.control'));
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, 'unselected language');
          removed.push(file);
        }
        for (const name of ['plpgsql', 'vector', 'pg_textsearch', 'dict_snowball', 'libpq']) {
          const file = path.join(dir, packageRoot, folder, name + (folder.startsWith('lib') ? '.so' : '.control'));
          fs.writeFileSync(file, 'required runtime');
          retained.push(file);
        }
      }
    }
    const result = spawnSync('bash', ['-ec', builder.slice(start, end)], {
      encoding: 'utf8', env: { ...process.env, SIDECAR_DIR: dir,
        EMBEDDED_PG_DST: path.join(dir, 'node_modules/@papercusp/embedded-postgres-server') },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const file of removed) assert.equal(fs.existsSync(file), false, file);
    for (const file of retained) assert.equal(fs.readFileSync(file, 'utf8'), 'required runtime', file);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 namespace census follows the seeded binding through getters and excludes shadowed names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-census-'));
  try {
    const file = path.join(dir, 'bundle.mjs');
    const source = `const c = {}; exportGet(c, {core: () => c});
      function peer(c) { return c.core.Doc; }
      { const c = {Doc: 1}; c.Doc; }
      const unrelated = {c: 2}; unrelated.c;
      const alias = c; const shorthand = {c}; alias.core;`;
    fs.writeFileSync(file, source);
    const proof = collectLexicalReferences(file, [{name: 'c', byteStart: Buffer.byteLength(source.slice(0, source.indexOf('c =')))}]);
    assert.deepEqual(proof.populations[0].references.map((row) => row.context.source),
      ['c = {}', 'exportGet(c, {core: () => c})', '() => c', 'alias = c', 'c']);
    assert.equal(proof.closureAccepted, false);
    const shadow = source.indexOf('peer(c)') + 'peer('.length;
    assert.deepEqual(collectLexicalReferences(file, [{name: 'c', byteStart: shadow}])
      .populations[0].references.map((row) => row.context.source), ['c', 'c.core']);
    assert.throws(() => collectLexicalReferences(file, [{name: 'c', byteStart: source.indexOf('unrelated.c') + 'unrelated.'.length}]), /property name/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 lexical seeds bind UTF8 bytes and fail closed on invalid input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-bytes-'));
  try {
    const file = path.join(dir, 'bundle.cjs');
    const source = '/* Ω😀 */ let __namespace; function init(){ __namespace = {}; return __namespace; }';
    fs.writeFileSync(file, source);
    const byteStart = Buffer.byteLength(source.slice(0, source.indexOf('__namespace')));
    const proof = collectLexicalReferences(file, [{name: '__namespace', byteStart}]);
    assert.equal(proof.populations[0].references.length, 3);
    for (const row of proof.populations[0].references) {
      assert.equal(Buffer.from(source).subarray(row.identifier.byteStart, row.identifier.byteEnd).toString(), '__namespace');
    }
    assert.throws(() => collectLexicalReferences(file, [{name: '__namespace', byteStart: source.indexOf('__namespace')}]), /seed not found/);
    assert.throws(() => collectLexicalReferences(file, [{name: 'absent', byteStart: 0}]), /seed not found/);
    fs.writeFileSync(file, 'function (');
    assert.throws(() => collectLexicalReferences(file, [{name: 'x', byteStart: 0}]), /parse errors/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 lexical census resolves named function expression self references without joining shadows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-self-'));
  try {
    const file = path.join(dir, 'bundle.cjs');
    const source = `/* Ω😀 */ const bind = outer;
      const factory = function bind(value) {
        const again = () => bind(value);
        function shadow(bind) { return bind(value); }
        { const bind = other; bind(value); }
        return {bind, property: object.bind};
      }; bind('outer');`;
    fs.writeFileSync(file, source);
    const at = (fragment, offset = 0) => Buffer.byteLength(source.slice(0, source.indexOf(fragment) + offset));
    const self = { name: 'bind', byteStart: at('function bind', 'function '.length) };
    const expected = [self.byteStart, at('() => bind', '() => '.length), at('{bind,', 1)];
    const proof = collectLexicalReferences(file, [self]);
    assert.deepEqual(proof.populations[0].references.map((row) => row.identifier.byteStart), expected);
    assert.deepEqual(collectLexicalReferences(file, [{ name: 'bind', byteStart: expected[1] }])
      .populations[0].references, proof.populations[0].references);
    assert.deepEqual(collectLexicalReferences(file, [{ name: 'bind', byteStart: at('bind = outer') }])
      .populations[0].references.map((row) => row.identifier.byteStart), [at('bind = outer'), at("bind('outer')")]);
    assert.equal(proof.closureAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 lexical census distinguishes a function expression name from same-name body bindings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-self-shadow-'));
  try {
    const file = path.join(dir, 'bundle.cjs');
    for (const source of ['const f = function bind(bind) { return bind; };',
      'const f = function bind() { var bind = other; return bind; };']) {
      fs.writeFileSync(file, source);
      const selfStart = source.indexOf('function bind') + 'function '.length;
      const bodyStart = source.indexOf('bind', selfStart + 'bind'.length);
      const proof = collectLexicalReferences(file, [{ name: 'bind', byteStart: selfStart },
        { name: 'bind', byteStart: bodyStart }]);
      assert.deepEqual(proof.populations[0].references.map((row) => row.identifier.byteStart), [selfStart]);
      assert.deepEqual(proof.populations[1].references.map((row) => row.identifier.byteStart),
        [bodyStart, source.lastIndexOf('bind')]);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 named function expression census still refuses default and with environments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-self-refusal-'));
  try {
    const file = path.join(dir, 'bundle.cjs');
    for (const [source, refusal] of [
      ['const f = function bind(value = bind) { return value; };', /parameter-default/],
      ['const f = function bind() { with (dynamicScope) { use(bind); } };', /with-scope/],
    ]) {
      fs.writeFileSync(file, source);
      assert.throws(() => collectLexicalReferences(file, [{ name: 'bind',
        byteStart: source.indexOf('function bind') + 'function '.length }]), refusal);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 lexical census preserves TypeScript generic call contexts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-generics-'));
  try {
    const file = path.join(dir, 'caller.ts');
    const source = "import { dynamicImport } from './helper'; await dynamicImport<TransformersModule>('pkg');";
    fs.writeFileSync(file, source);
    const proof = collectLexicalReferences(file, [{ name: 'dynamicImport',
      byteStart: Buffer.byteLength(source.slice(0, source.indexOf('dynamicImport'))) }]);
    assert.deepEqual(proof.populations[0].references.map((row) => row.context.source),
      ['dynamicImport', "dynamicImport<TransformersModule>('pkg')"]);
    assert.equal(proof.closureAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

for (const extension of ['ts', 'mts', 'cts', 'tsx']) {
  test(`D-161 lexical census binds typed aliases and excludes shadowed calls in .${extension}`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-typed-'));
    try {
      const file = path.join(dir, `caller.${extension}`);
      const source = `/* Ω😀 */ import { dynamicImport as load } from './helper';
        type Result = { value: string };
        const pending: Promise<Result> = load<Result>('pkg');
        function shadow(load: <T>(specifier: string) => Promise<T>) {
          return load<Result>('shadow');
        }
        export { load as publicLoad };`;
      fs.writeFileSync(file, source);
      const proof = collectLexicalReferences(file, [{ name: 'load',
        byteStart: Buffer.byteLength(source.slice(0, source.indexOf('load }'))) }]);
      assert.deepEqual(proof.populations[0].references.map((row) => row.context.source),
        ['dynamicImport as load', "load<Result>('pkg')", 'load as publicLoad']);
      for (const row of proof.populations[0].references) {
        assert.equal(Buffer.from(source).subarray(row.identifier.byteStart, row.identifier.byteEnd).toString(), 'load');
      }
      assert.equal(proof.closureAccepted, false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test('D-161 lexical census retains local export escapes and refuses ambiguous lookup environments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-lexical-escapes-'));
  try {
    const file = path.join(dir, 'bundle.mjs');
    fs.writeFileSync(file, 'const c = {}; export {c}; export {c as publicNamespace};');
    assert.deepEqual(collectLexicalReferences(file, [{name: 'c', byteStart: 6}])
      .populations[0].references.map((row) => row.context.source), ['c = {}', 'c', 'c as publicNamespace']);
    fs.writeFileSync(file, 'const c = {}; export {c as c};');
    assert.equal(collectLexicalReferences(file, [{name: 'c', byteStart: 6}]).populations[0].references.length, 2);
    fs.writeFileSync(file, 'const c = {}; function f(x = c) { var c; }');
    assert.throws(() => collectLexicalReferences(file, [{name: 'c', byteStart: 6}]), /parameter-default/);
    fs.writeFileSync(file, 'var c = {}; with (dynamicScope) { use(c); }');
    assert.throws(() => collectLexicalReferences(file, [{name: 'c', byteStart: 4}]), /with-scope/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 static closure follows Node import and require conditions without executing modules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-module-closure-'));
  try {
    const pkg = path.join(dir, 'node_modules', 'dual'); fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'dual', exports: { 'collector-host': './poison.cjs', import: './esm.mjs', require: './cjs.cjs' } }));
    fs.writeFileSync(path.join(pkg, 'poison.cjs'), "require('@aws-sdk/client-kms');");
    fs.writeFileSync(path.join(pkg, 'esm.mjs'), "throw new Error('must not execute'); import './import-leaf.mjs';");
    fs.writeFileSync(path.join(pkg, 'cjs.cjs'), "throw new Error('must not execute'); require('./require-leaf.cjs');");
    fs.writeFileSync(path.join(pkg, 'import-leaf.mjs'), "export const value = 1;");
    fs.writeFileSync(path.join(pkg, 'require-leaf.cjs'), "module.exports = require('./data.json');");
    fs.writeFileSync(path.join(pkg, 'data.json'), '{"value":1}');
    fs.writeFileSync(path.join(dir, 'entry.ts'), "import 'dual'; require('dual'); import d = require('dual'); import type t = require('absent-type'); import(dynamicName);");
    const proof = collectStaticClosure(dir, ['entry.ts']);
    assert.deepEqual(proof.outside, []); assert.deepEqual(proof.failures, []);
    assert.deepEqual(proof.files[0].imports.filter((edge) => edge.target).map((edge) => edge.target),
      ['node_modules/dual/esm.mjs', 'node_modules/dual/cjs.cjs', 'node_modules/dual/cjs.cjs']);
    assert.ok(proof.files.some((file) => file.file === 'node_modules/dual/import-leaf.mjs'));
    assert.ok(proof.files.some((file) => file.file === 'node_modules/dual/require-leaf.cjs'));
    assert.ok(proof.files.some((file) => file.resourceKind === 'json'));
    assert.ok(proof.manifests.some((file) => file.file === 'node_modules/dual/package.json'));
    assert.deepEqual(proof.unresolved.map((edge) => edge.site.source), ['import(dynamicName)']);
    assert.equal(proof.closureAccepted, false);
    const child = JSON.parse(execFileSync(process.execPath, ['-e',
      "console.log(JSON.stringify(require(process.argv[1]).collectStaticClosure(process.argv[2], ['entry.ts'])))",
      path.join(root, 'bin/lib/runtime-import-census.cjs'), dir], {
      env: { ...process.env, NODE_OPTIONS: '--conditions=collector-host' }, encoding: 'utf8',
    }));
    assert.deepEqual(child.files.map((file) => file.file), proof.files.map((file) => file.file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 static closure resolves large import populations without OS argument limits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-module-large-population-'));
  try {
    // This repeated valid edge used to exceed Linux's per-argument limit when
    // the entire query population was serialized into one child argv entry.
    const count = 2400;
    fs.writeFileSync(path.join(dir, 'entry.cjs'), "require('./leaf.cjs');\n".repeat(count));
    fs.writeFileSync(path.join(dir, 'leaf.cjs'), "throw new Error('must not execute');");
    const proof = collectStaticClosure(dir, ['entry.cjs']);
    const edges = proof.files.find((file) => file.file === 'entry.cjs').imports;
    assert.equal(edges.length, count, 'retain every source site');
    assert.ok(edges.every((edge) => edge.target === 'leaf.cjs'));
    assert.deepEqual(proof.files.map((file) => file.file), ['entry.cjs', 'leaf.cjs']);
    assert.deepEqual(proof.failures, []);
    assert.deepEqual(proof.outside, []);
    assert.deepEqual(proof.unresolved, []);
    assert.equal(proof.closureAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 static closure retains caught missing imports, generated bodies and root escapes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-module-boundary-'));
  try {
    const root = path.join(dir, 'root'); fs.mkdirSync(root);
    fs.writeFileSync(path.join(dir, 'outside.cjs'), "require('@aws-sdk/client-kms');");
    fs.symlinkSync(path.join(dir, 'outside.cjs'), path.join(root, 'escape.cjs'));
    fs.writeFileSync(path.join(root, 'entry.cjs'), "try { require('missing'); } catch {} require('./escape.cjs'); new Function(body);");
    const proof = collectStaticClosure(root, ['entry.cjs']);
    assert.equal(proof.outside.length, 1);
    assert.deepEqual(proof.unresolved.map((edge) => edge.site.source),
      ["require('missing')", "require('./escape.cjs')", 'new Function(body)']);
    assert.equal(proof.unresolved[0].errorCode, 'MODULE_NOT_FOUND');
    assert.equal(proof.closureAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-159 census captures loader aliases, generated imports and unresolved arguments without authorizing omission', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-import-census-'));
  try {
    const file = path.join(dir, 'serve.mjs');
    fs.writeFileSync(file, `import { createRequire as factory } from 'node:module';
      const getLoader = factory; const loader = getLoader(import.meta.url);
      const alias = loader; alias(userPath); loader('@aws-sdk/client-kms');
      const conditional = typeof factory === 'function' ? factory(import.meta.url) : undefined;
      conditional(pluginPath); module['require'](configPath);
      const deferred = () => factory(import.meta.url);
      const { createRequire: cjsFactory } = require('node:module');
      const cjsLoader = cjsFactory(import.meta.url); cjsLoader(otherPath);
      const memberFactory = moduleApi['createRequire'];
      const memberLoader = memberFactory(import.meta.url); memberLoader(memberPath);
      const memberAlias = module['require']; memberAlias(aliasedPath);
      const Generator = Function; new Generator('specifier', 'return import(specifier)');
      import('node:path'); import(transpiled.entryPath); export * from './worker.mjs';`);
    const proof = collectImports(file);
    assert.equal(proof.closureAccepted, false);
    assert.ok(proof.loaderAliases.includes('alias'));
    assert.ok(proof.loaderAliases.includes('conditional'));
    assert.ok(proof.loaderAliases.includes('cjsLoader'));
    assert.ok(!proof.loaderAliases.includes('deferred'));
    assert.equal(proof.imports.filter((r) => r.kind === 'require').length, 8);
    assert.ok(proof.imports.some((r) => r.specifier === '@aws-sdk/client-kms'));
    assert.equal(proof.imports.filter((r) => r.kind === 'generated-code').length, 1);
    assert.equal(proof.imports.filter((r) => r.kind === 'dynamic-import' && r.specifier === null).length, 1);
    assert.ok(proof.imports.some((r) => r.specifier === './worker.mjs'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-159 census byte offsets bind UTF-8 bytes and reject malformed input', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-import-bytes-'));
  try {
    const file = path.join(dir, 'serve.mjs');
    const bytes = Buffer.from(`const label = 'é😀'; import(modulePath);\n`);
    fs.writeFileSync(file, bytes);
    const row = collectImports(file).imports[0];
    assert.equal(bytes.subarray(row.byteStart, row.byteEnd).toString(), 'import(modulePath)');
    assert.equal(row.byteStart, bytes.indexOf('import('));
    fs.writeFileSync(file, 'import(');
    assert.throws(() => collectImports(file), /parse errors/);
    fs.writeFileSync(file, Buffer.from([0xff]));
    assert.throws(() => collectImports(file), /non-UTF8/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-159 aliases follow lexical bindings across minified local names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-import-scopes-'));
  try {
    const file = path.join(dir, 'serve.mjs');
    fs.writeFileSync(file, `import { createRequire as make } from 'node:module';
      function load() { const r = make(import.meta.url); const x = r; x(pluginPath); }
      function other() { const r = Math.abs; const x = r; x(value); }
      function shadow(make) { const r = make(import.meta.url); r(value); }
      function generator() { const f = Function; new f('return 1'); }
      function otherGenerator() { const f = Date; new f(); }`);
    const proof = collectImports(file);
    assert.deepEqual(proof.imports.filter((r) => r.kind === 'require').map((r) => r.source), ['x(pluginPath)']);
    assert.deepEqual(proof.imports.filter((r) => r.kind === 'generated-code').map((r) => r.source), ["new f('return 1')"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D-161 census identifies type-only edges without dropping mixed runtime imports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-import-types-'));
  try {
    const file = path.join(dir, 'entry.ts');
    fs.writeFileSync(file, `import type { Plugin } from 'only-types';
      import { type Config } from 'named-types';
      import Default, { type Config as C } from 'default-runtime';
      import { type Config as D, run } from 'mixed-runtime';
      import 'side-effect'; export type { Plugin } from 'export-types';
      export { type Config as E } from 'named-export-types';
      export { type Config as F, run } from 'mixed-export-runtime';
      const value: number = 1;`);
    const proof = collectImports(file);
    assert.deepEqual(proof.imports.filter((r) => r.typeOnly).map((r) => r.specifier),
      ['only-types', 'export-types']);
    assert.deepEqual(proof.imports.filter((r) => !r.typeOnly).map((r) => r.specifier),
      ['named-types', 'default-runtime', 'mixed-runtime', 'side-effect', 'named-export-types', 'mixed-export-runtime']);
    const ts = require('typescript');
    const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { verbatimModuleSyntax: true, module: ts.ModuleKind.ESNext },
    }).outputText;
    assert.ok(emitted.includes("import {} from 'named-types'"));
    assert.ok(emitted.includes("export {} from 'named-export-types'"));
    assert.ok(!emitted.includes("from 'only-types'"));
    assert.ok(!emitted.includes("from 'export-types'"));
    assert.equal(proof.closureAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A synthetic owner value used only to prove D-112 does not require or reject it. */
const SYNTHETIC_OWNER = 'Zzsynthetic Gateowner';
const AUDIT_ENV = { ...process.env };

function audit(...args) {
  return spawnSync('python3', [AUDIT, ...args], { encoding: 'utf8', env: AUDIT_ENV });
}

const VM_RELEASE_ENV = {
  ...AUDIT_ENV,
  PAPERCUSP_BUILD_SHA: 'deadbeefcafefeed',
  PAPERCUSP_DESKTOP_VERSION: '9.8.7-vm-test',
};

function vmReleaseAudit(...args) {
  return spawnSync('python3', [AUDIT, ...args], { encoding: 'utf8', env: VM_RELEASE_ENV });
}

/** A high-entropy identity literal, from the gate's OWN source of truth. */
function identityLiteral() {
  const r = audit('--identity-literals');
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const [value, , low] = line.split('\t');
    if (value && value.length > 12 && low === '0') return value;
  }
  throw new Error('no high-entropy identity literal available on this host');
}

function tmp(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `wi37620-${name}-`));
}

test('vm-release prune removes non-runtime residue, preserves allowlisted assets, and writes the threat boundary', () => {
  const dir = tmp('vm-release-prune');
  const write = (rel, body = 'fixture\n') => {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  };
  try {
    // Runtime bytes that must survive.
    write('serve.mjs', 'export {};\n');
    write('db-sql/001-runtime.sql', 'select 1;\n');
    // Migration names describe the schema they implement. `test` and `spec`
    // therefore do not make SQL under db-sql/ a test fixture: pruning these two
    // real production-shaped names makes a fresh database fail after packaging,
    // even though the pre-prune seed build validated the complete migration set.
    write('db-sql/850-test-runs-future-timestamp-clamp.sql', 'select 1;\n');
    write('db-sql/851-first-class-plan-spec-clauses.sql', 'select 1;\n');
    write('apps/operator/scripts/hooks/omp/coord-hook.mjs', 'export {};\n');
    write('internal-docs/guide.html', '<h1>runtime docs</h1>\n');
    write('harness/hooks/preflight.sh', '#!/bin/sh\n');
    // P-309 content is supplied through the Cupboard into persistent state,
    // never duplicated in the immutable vm-release payload.
    write('prompts/operator.persona.md', 'prompt\n');
    write('templates/papercusp-webapp/src/main.ts', 'export {};\n');
    write('templates/papercusp-webapp/tests/template.test.ts', 'export {};\n');
    write('rubrics/quality/rubric.json', '{}\n');
    write('harness/blueprints/base/blueprint.yaml', 'id: base\n');
    write('harness/templates/legacy/template.yaml', 'id: legacy\n');
    write('node_modules/lost-pixel/dist/compare/compare.js', 'module.exports = {};\n');

    // Dogfood/source/build residue that must not survive a vm-release.
    write('source.tar.zst');
    write('env-sidecars/staging/operator.json', '{}\n');
    write('seed/private.txt');
    write('apps/operator-docs/src/content/docs/private.mdx', '# private\n');
    write('packages/operator-core/lib/runtime.ts', 'export {};\n');
    write('packages/operator-core/lib/runtime.js.map', '{}\n');
    write('packages/operator-core/test/runtime.test.js', 'test();\n');
    write('packages/operator-core/vitest.config.ts', 'export default {};\n');
    write('.github/workflows/release.yml', 'name: release\n');
    write('README.md', '# source docs\n');
    write('node_modules/lost-pixel/node_modules/@esbuild/linux-x64/bin/esbuild', 'compiler\n');
    write('node_modules/lost-pixel/node_modules/esbuild/bin/esbuild', 'cli shim\n');
    // npm may hardlink a platform executable into its .bin shim tree rather
    // than leaving a symlink. The runtime-only profile must prune the whole
    // shim subtree, not just the known esbuild path.
    write('node_modules/lost-pixel/node_modules/.bin/esbuild', 'platform binary\n');
    write('node_modules/lost-pixel/node_modules/.bin/tsc', 'compiler shim\n');
    write('bin/esbuild', 'a non-node_modules executable path is not this rule\n');

    const pruned = vmReleaseAudit('--prune-vm-release', dir);
    assert.equal(pruned.status, 0, `${pruned.stdout}${pruned.stderr}`);
    for (const rel of [
      'source.tar.zst',
      'env-sidecars',
      'seed',
      'apps/operator-docs/src/content/docs',
      'prompts',
      'templates',
      'rubrics',
      'harness/blueprints',
      'harness/templates',
      'packages/operator-core/lib/runtime.ts',
      'packages/operator-core/lib/runtime.js.map',
      'packages/operator-core/test',
      'packages/operator-core/vitest.config.ts',
      '.github',
      'README.md',
      'node_modules/lost-pixel/node_modules/@esbuild',
      'node_modules/lost-pixel/node_modules/esbuild/bin',
      'node_modules/lost-pixel/node_modules/.bin',
    ]) {
      assert.equal(fs.existsSync(path.join(dir, rel)), false, `${rel} must be pruned`);
    }
    for (const rel of [
      'serve.mjs',
      'db-sql/001-runtime.sql',
      'db-sql/850-test-runs-future-timestamp-clamp.sql',
      'db-sql/851-first-class-plan-spec-clauses.sql',
      'apps/operator/scripts/hooks/omp/coord-hook.mjs',
      'internal-docs/guide.html',
      'harness/hooks/preflight.sh',
      'node_modules/lost-pixel/dist/compare/compare.js',
      'bin/esbuild',
    ]) {
      assert.equal(fs.existsSync(path.join(dir, rel)), true, `${rel} must survive`);
    }

    const boundaryPath = path.join(
      dir,
      'apps/operator/runtime/vm-release-threat-boundary.json',
    );
    const boundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
    assert.equal(boundary.profile, 'vm-release');
    assert.equal(boundary.artifactBinding.buildSha, VM_RELEASE_ENV.PAPERCUSP_BUILD_SHA);
    assert.equal(boundary.artifactBinding.version, VM_RELEASE_ENV.PAPERCUSP_DESKTOP_VERSION);
    assert.equal(boundary.rootCloudOwnerNonGoal.protectedByVmRelease, false);
    assert.equal(boundary.hostedBoundary.planItem, 'P-039');
    assert.match(boundary.hostedBoundary.vmComponent, /minimal-signed-reverse-data-plane-connector/);

    const certified = vmReleaseAudit('--audit-vm-release', dir);
    assert.equal(certified.status, 0, `${certified.stdout}${certified.stderr}`);
    assert.match(certified.stdout, /VM-RELEASE CLEAN/);

    // The audit must share the same path-level predicate as the prune. An
    // unpruned arbitrary .bin entry is not allowed to pass merely because it
    // is a JS wrapper today; a dependency-layout change must still red the
    // runtime-only contract.
    write('node_modules/lost-pixel/node_modules/.bin/future-tool', 'future shim\n');
    const unprunedShim = vmReleaseAudit('--audit-vm-release', dir);
    assert.equal(unprunedShim.status, 1, `${unprunedShim.stdout}${unprunedShim.stderr}`);
    assert.match(
      unprunedShim.stdout,
      /\[build-tool-residue\].*node_modules\/lost-pixel\/node_modules\/\.bin\/future-tool/,
    );

    // The audit is not a ceremonial post-prune pass: adding one newly forbidden
    // file must make the SAME classifier reject the assembled payload.
    write('packages/operator-core/lib/late-source.ts', 'export {};\n');
    const rejected = vmReleaseAudit('--audit-vm-release', dir);
    assert.equal(rejected.status, 1, `${rejected.stdout}${rejected.stderr}`);
    assert.match(rejected.stdout, /\[typescript-source\].*late-source\.ts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('vm-release build profile bundles OMP hooks and gates the final sidecar before verification', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  // open-source-release-2026-09-29 D-005 added the `public` profile to the accepted set.
  const profileValidation = sh.indexOf('dogfood|public|vm-release');
  const bundle = sh.indexOf('esbuild-bundling OMP runtime hooks for vm-release');
  const prune = sh.indexOf('--prune-vm-release');
  const postPruneSqlGate = sh.indexOf(
    'assert_sidecar_db_sql_matches_source "after vm-release prune"',
    prune,
  );
  const auditAt = sh.indexOf('--audit-vm-release');
  const verifier = sh.indexOf('release-bundle dependency verifier');
  const vulnerabilityGate = sh.indexOf('--audit-vulnerabilities');
  const publish = sh.indexOf('__pc_acquire_sidecar_publish_lock || exit', verifier);

  assert.ok(profileValidation > 0, 'the producer must reject unknown distribution profiles');
  assert.ok(bundle > profileValidation, 'vm-release must bundle its runtime OMP hooks');
  assert.match(sh.slice(bundle, prune), /--bundle --platform=node --format=esm --target=node20/);
  assert.doesNotMatch(sh.slice(bundle, prune), /--sourcemap/,
    'the vm-release OMP bundle must not embed source maps/sourceContent');
  assert.ok(
    prune > bundle && postPruneSqlGate > prune && auditAt > postPruneSqlGate && verifier > auditAt &&
      vulnerabilityGate > verifier && publish > vulnerabilityGate,
    'bundle → prune → exact SQL-set gate → audit → runtime verify → SBOM/Grype must precede publish',
  );
  assert.match(sh, /if \[\[ "\$DISTRIBUTION_PROFILE" == "vm-release" \]\][\s\S]*?else[\s\S]*?copying omp hook TypeScript bundle/,
    'dogfood must retain the historical readable TypeScript hook copy');
});

test('vm-release trust toolchain pins every upstream input and the measured clean dependency overrides', () => {
  const helper = fs.readFileSync(TRUST_TOOLCHAIN, 'utf8');
  const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

  for (const exact of [
    '"compilerRuntimeProvenance": {',
    '"builderHost": "linux-x64"',
    '"platformOwnedRecipes": {',
    '"linuxX64": "papercusp-desktop/bin/lib/vm-release-trust-toolchain.sh"',
    '"macOS": "papercusp-desktop/bin/release-local.sh"',
    '"windowsX64": "papercusp-desktop/bin/build-windows-cross.sh"',
    '"shippedTargetTriples": {',
    '"linuxX64": ["x86_64-unknown-linux-gnu"]',
    '"macOS": ["x86_64-apple-darwin", "aarch64-apple-darwin"]',
    '"windowsX64": ["x86_64-pc-windows-msvc"]',
    'PAPERCUSP_VM_TRUST_REVISION="2026-10-23-r1"',
    'PAPERCUSP_VM_NODE_VERSION="v24.18.1"',
    'license": "MIT"',
    'd6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0',
    // GO-2026-6603..6613 (published 2026-10-08) affect stdlib before 1.26.9; the
    // D-223 vm-release gate measured them in both gh and kopia (WI-6554700010009733).
    'PAPERCUSP_VM_GO_VERSION="1.26.9"',
    'license": "BSD-3-Clause"',
    '42d158b4d8f7b61ac0a830567c940a86098fb7aac52e467a5ebec03ef5cc2f8d',
    'PAPERCUSP_VM_GH_VERSION="2.98.0"',
    'a255baf71d13fe5947a4eb7ad521ffd412d64cee',
    // GO-2026-6354 and GO-2026-6355 affect x/crypto before v0.56.0. gh used to
    // inherit v0.55.0 through x/net, so this must remain an explicit pin rather
    // than an accidental MVS result. It is v0.57.0 now because x/net v0.60.0
    // (GO-2026-6603/6610/6611/6612) requires it; x/text v0.42.0 requires x/mod v0.41.0.
    'PAPERCUSP_VM_GH_X_CRYPTO_VERSION="v0.57.0"',
    'PAPERCUSP_VM_GH_X_MOD_VERSION="v0.41.0"',
    'PAPERCUSP_VM_GH_X_NET_VERSION="v0.60.0"',
    'PAPERCUSP_VM_KOPIA_VERSION="0.23.1"',
    'PAPERCUSP_VM_KOPIA_COMPRESS_VERSION="v1.18.7"',
    '72ec08fd8edb86c67ed27099bf1b955e1f308ffa',
    'license": "Apache-2.0"',
    // These move TOGETHER (2026-10-13-r1): x/net v0.60.0 fixes GO-2026-6603/6610/
    // 6611/6612 and requires x/crypto v0.57.0 + x/text v0.42.0; x/text v0.42.0
    // requires x/mod v0.41.0. A lower explicit pin is a hard `go get` conflict.
    // See the co-pin comments in bin/lib/vm-release-trust-toolchain.sh.
    'PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION="v0.57.0"',
    'PAPERCUSP_VM_KOPIA_X_MOD_VERSION="v0.41.0"',
    'PAPERCUSP_VM_KOPIA_X_NET_VERSION="v0.60.0"',
    'PAPERCUSP_VM_KOPIA_X_TEXT_VERSION="v0.42.0"',
    // GHSA-2v4p-qf9q-27wj affects both previously pinned v1.83.1 binaries.
    // The patched v1.83.2 requires x/net v0.58.0, below the x/net pinned above.
    // Both explicit pins, binary assertions and cache invalidation must agree.
    'PAPERCUSP_VM_GH_GRPC_VERSION="v1.83.2"',
    'PAPERCUSP_VM_KOPIA_GRPC_VERSION="v1.83.2"',
    'PAPERCUSP_VM_POSTGRES_VERSION="18.6"',
    '555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f',
    'PAPERCUSP_VM_OPENSSL_VERSION="3.5.8"',
    'a8f84a39918ec6415ce765d9b429d313ba97b8143169c172e734b9514464f5b2',
    '"opensslLicense": "Apache-2.0"',
  ]) {
    assert.equal(helper.includes(exact), true, `missing trust-toolchain pin: ${exact}`);
  }
  // A DECLARED pin is not an APPLIED pin. Every module-override variable must actually be
  // requested via `go get`, or it is documentation that silently governs nothing.
  const declaredOverrides = [...helper.matchAll(
    /^(PAPERCUSP_VM_(?:GH|KOPIA)_(?:X_[A-Z]+|GRPC)_VERSION)=/gm,
  )].map((m) => m[1]);
  assert.ok(declaredOverrides.length >= 8,
    `expected the helper to declare several module overrides, found ${declaredOverrides.length}`);
  for (const name of declaredOverrides) {
    assert.ok(helper.includes(`@$${name}"`),
      `${name} is declared but never requested via go get — a pin nothing applies`);
  }

  // Stronger requirement, but only where the evidence supports it. `go get` RAISING a
  // version and the shipped binary actually EMBEDDING it are two different claims, and
  // only the second one ships — so a pin bumped for a CVE must be asserted against the
  // built binary. This list is deliberately the set MEASURED to be embedded rather than
  // every declared override: the 2026-09-02 SBOM named google.golang.org/grpc inside both
  // /bin/gh and /bin/kopia, and x/crypto/x/net/x/text are already asserted for kopia.
  // x/tools is NOT here on purpose — nothing has shown it survives into either binary,
  // and asserting an absent module would fail the build rather than protect it. Add a
  // module here once an SBOM shows it embedded, not on the assumption that it is.
  for (const [binary, name] of [
    ['gh', 'PAPERCUSP_VM_GH_X_CRYPTO_VERSION'],
    // 2026-10-13: the vm-release SBOM matched x/net GO-2026-66xx inside /bin/gh,
    // which is the measured evidence this list requires before asserting a module.
    ['gh', 'PAPERCUSP_VM_GH_X_NET_VERSION'],
    ['gh', 'PAPERCUSP_VM_GH_GRPC_VERSION'],
    ['kopia', 'PAPERCUSP_VM_KOPIA_GRPC_VERSION'],
    ['kopia', 'PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION'],
    ['kopia', 'PAPERCUSP_VM_KOPIA_X_NET_VERSION'],
    ['kopia', 'PAPERCUSP_VM_KOPIA_X_TEXT_VERSION'],
  ]) {
    assert.match(helper, new RegExp(`_pc_vm_assert_module[^\\n]*bin/${binary}[^\\n]*\\$${name}"`),
      `${name} is applied but never asserted against the built ${binary} binary — a silent pin`);
  }

  assert.match(helper, /_pc_vm_verify_sha256[\s\S]*actual[\s\S]*expected/,
    'downloads must be content-verified, not version-label trusted');
  assert.match(helper, /--with-ssl=openssl/,
    'PostgreSQL must make its pgcrypto/OpenSSL closure explicit');
  assert.match(helper, /for extension in pgcrypto pg_trgm/,
    'the source build must install every contrib extension required by first boot');
  assert.match(helper, /CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm;[\s\S]*similarity\(/,
    'the source build must execute both required extensions instead of trusting compilation');
  assert.match(helper, /postgresql\/lib\/pg_trgm\.so[\s\S]*postgresql\/share\/extension\/pg_trgm\.control/,
    'cache admission must reject a PostgreSQL payload missing pg_trgm runtime files');
  assert.match(helper, /"pg_trgm": \{[\s\S]*postgresql\/lib\/pg_trgm\.so[\s\S]*pg_trgm\.control/,
    'the trust manifest must digest-bind the admitted pg_trgm binary and control file');
  assert.match(helper, /patchelf --set-rpath '\$ORIGIN\/\.\.\/lib'/,
    'source-built PostgreSQL tools must remain relocatable after cache copy');
  assert.match(helper, /_pc_vm_sanitize_postgres_config_info[\s\S]*config_info\.c/,
    'PostgreSQL build diagnostics must not retain a random source/SDK path');
  assert.match(helper, /rg -a -l -F "\$work" "\$output"/,
    'temporary source/build paths must fail the cache admission gate');

  const prepare = builder.indexOf('papercusp_prepare_vm_release_trust_toolchain');
  const replacePg = builder.indexOf('replaced npm PostgreSQL payload', prepare);
  const copyKopia = builder.indexOf('pinned source build $PAPERCUSP_VM_KOPIA_VERSION', prepare);
  const copyNode = builder.indexOf('checksum-pinned vm-release trust toolchain', prepare);
  const copyGh = builder.indexOf('checksum-pinned release source', prepare);
  assert.ok(prepare > 0 && replacePg > prepare && copyKopia > prepare && copyNode > prepare && copyGh > prepare,
    'the maintained sidecar builder must consume every validated helper output');
});

test('vm-release derives the embedded PostgreSQL major before profile-specific Kopia wiring', () => {
  const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const majorStart = builder.indexOf('# The embedded server\'s major version');
  const majorGuard = builder.indexOf('if [[ -z "$EMBEDDED_PG_MAJOR" ]]', majorStart);
  const kopiaGuard = builder.indexOf('vm-release pinned Kopia output is unavailable', majorStart);

  assert.ok(majorStart > 0 && majorGuard > majorStart,
    'the embedded PostgreSQL major must be derived and fail-closed before client-tool wiring');
  const majorBlock = builder.slice(majorStart, majorGuard);
  assert.match(majorBlock, /if \[\[ "\$_cross_darwin" == "1" \]\]; then/,
    'cross-darwin must derive the major without executing a target-platform binary');
  assert.match(majorBlock, /else[\s\S]*EMBEDDED_PG_MAJOR=.*postgres.*--version/,
    'native and vm-release builds must derive the major from the assembled postgres binary');
  assert.doesNotMatch(majorBlock, /DISTRIBUTION_PROFILE/,
    'a distribution-profile arm must never bypass EMBEDDED_PG_MAJOR initialization');
  assert.ok(kopiaGuard > majorGuard,
    'vm-release Kopia wiring must be independent and occur only after the major is known');
});

function writeExecutable(file, source) {
  fs.writeFileSync(file, source);
  fs.chmodSync(file, 0o755);
}

function runFakeVulnerabilityAudit({ matches = [], dbValid = true, report = null,
  preflight = false, dbBuilt = new Date().toISOString(), dbStatusText = null,
  sbom = { components: [{ name: 'demo-runtime', version: '1.0.0', purl: 'pkg:generic/demo-runtime@1.0.0' }] } } = {}) {
  const dir = tmp('vulnerability-gate');
  const sidecar = path.join(dir, 'sidecar');
  const evidence = path.join(dir, 'evidence');
  const tools = path.join(dir, 'tools');
  fs.mkdirSync(sidecar, { recursive: true });
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(sidecar, 'serve.mjs'), 'export {};\n');

  writeExecutable(path.join(tools, 'syft'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write(JSON.stringify({ application: 'syft', version: '1.51.0-test' }));
  process.exit(0);
}
const target = args.find((arg) => arg.startsWith('cyclonedx-json='));
if (!target) process.exit(41);
fs.writeFileSync(target.slice('cyclonedx-json='.length), process.env.FAKE_SYFT_SBOM);
`);
  writeExecutable(path.join(tools, 'grype'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write(JSON.stringify({ application: 'grype', version: '0.117.0-test' }));
  process.exit(0);
}
if (args[0] === 'db' && args[1] === 'update') process.exit(0);
if (args[0] === 'db' && args[1] === 'status') {
  if (process.env.FAKE_GRYPE_DB_STATUS_TEXT) {
    process.stdout.write(process.env.FAKE_GRYPE_DB_STATUS_TEXT);
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    schemaVersion: 'test-v1',
    built: process.env.FAKE_GRYPE_DB_BUILT,
    valid: process.env.FAKE_GRYPE_DB_VALID === 'true',
  }));
  process.exit(0);
}
process.stdout.write(process.env.FAKE_GRYPE_REPORT);
require('node:fs').writeFileSync(process.env.FAKE_GRYPE_SCAN_MARKER, 'scanned');
`);

  const env = {
    ...VM_RELEASE_ENV,
    PATH: `${tools}${path.delimiter}${process.env.PATH}`,
    FAKE_GRYPE_DB_BUILT: dbBuilt,
    FAKE_GRYPE_DB_STATUS_TEXT: dbStatusText ?? '',
    FAKE_GRYPE_DB_VALID: String(dbValid),
    FAKE_GRYPE_REPORT: JSON.stringify(report ?? { matches }),
    FAKE_SYFT_SBOM: JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.7', ...sbom }),
    FAKE_GRYPE_SCAN_MARKER: path.join(evidence, 'grype-scan-called'),
  };
  const result = spawnSync(
    'python3',
    preflight ? [AUDIT, '--preflight-vulnerabilities'] : [AUDIT, '--audit-vulnerabilities', sidecar, evidence],
    { encoding: 'utf8', env },
  );
  return { dir, sidecar, evidence, result, env };
}

test('vulnerability scanner preflight validates tools without emitting artifact evidence', () => {
  const run = runFakeVulnerabilityAudit({ preflight: true });
  try {
    assert.equal(run.result.status, 0, `${run.result.stdout}${run.result.stderr}`);
    assert.match(run.result.stdout, /VULNERABILITY TOOLS READY/);
    assert.equal(fs.existsSync(run.evidence), false);
    assert.equal(fs.existsSync(path.join(run.sidecar,
      'apps/operator/runtime/vm-release-vulnerability-attestation.json')), false);
  } finally { fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('vulnerability scanner preflight rejects invalid, stale, future and malformed databases', () => {
  for (const input of [
    { dbValid: false, reason: /valid != true/ },
    { dbBuilt: new Date(Date.now() - 73 * 3600_000).toISOString(), reason: /maximum is 72h/ },
    { dbBuilt: new Date(Date.now() + 2 * 3600_000).toISOString(), reason: /in the future/ },
    { dbStatusText: 'not-json', reason: /invalid JSON/ },
  ]) {
    const run = runFakeVulnerabilityAudit({ ...input, preflight: true });
    try {
      assert.equal(run.result.status, 2, `${run.result.stdout}${run.result.stderr}`);
      assert.match(run.result.stderr, input.reason);
      assert.equal(fs.existsSync(run.evidence), false);
    } finally { fs.rmSync(run.dir, { recursive: true, force: true }); }
  }
});

test('vm-release scanner preflight refuses an invalid database before source capture or build work', () => {
  const run = runFakeVulnerabilityAudit({ dbValid: false, preflight: true });
  try {
    const repo = prepareBuilderPreflightRepo(run.dir);
    const result = spawnSync('bash', [path.join(root, 'bin/build-desktop-sidecar.sh')], {
      encoding: 'utf8',
      env: { ...run.env, PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release',
        REPO_ROOT: repo },
      timeout: 15_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /grype DB reports valid != true/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\.nvmrc|source capture|building SPA/);
  } finally { fs.rmSync(run.dir, { recursive: true, force: true }); }
});

test('scanner preflight gives DB integrity its own finite budget and still rejects a timeout', () => {
  for (const fail of [false, true]) {
    const probe = [
      'import json, runpy, sys, types',
      'ns = runpy.run_path(sys.argv[1])',
      'calls = []',
      'def run(command, **kwargs):',
      '    calls.append({"argv": command[1:], "timeout": kwargs["timeout"], "autoUpdate": kwargs["env"]["GRYPE_DB_AUTO_UPDATE"]})',
      '    is_db = command[1:3] == ["db", "status"]',
      '    if is_db and (kwargs["timeout"] < 90 or sys.argv[2] == "fail"):',
      '        raise ns["subprocess"].TimeoutExpired(command, kwargs["timeout"])',
      '    value = {"version": "test"}',
      '    if is_db: value = {"valid": True, "built": ns["datetime"].now(ns["timezone"].utc).isoformat()}',
      '    return types.SimpleNamespace(returncode=0, stdout=json.dumps(value), stderr="")',
      'ns["subprocess"].run = run',
      'ns["shutil"].which = lambda name: "/test/" + name',
      'code = ns["preflight_vulnerabilities"]([])',
      'print(json.dumps({"code": code, "calls": calls}))',
    ].join('\n');
    const result = spawnSync('python3', ['-c', probe, AUDIT, fail ? 'fail' : 'pass'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const measured = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(measured.code, fail ? 2 : 0);
    assert.deepEqual(measured.calls.map((call) => call.timeout), [60, 60, 300]);
    assert.ok(measured.calls.every((call) => call.autoUpdate === 'false'));
    if (fail) assert.match(result.stderr, /grype db status could not run.*300 seconds/);
  }
});

test('vm-release vulnerability audit emits digest-bound evidence and attests only a zero-High/Critical result', () => {
  const run = runFakeVulnerabilityAudit();
  try {
    assert.equal(run.result.status, 0, `${run.result.stdout}${run.result.stderr}`);
    assert.match(run.result.stdout, /VULNERABILITY GATE GREEN/);
    const summary = JSON.parse(fs.readFileSync(path.join(run.evidence, 'summary.json'), 'utf8'));
    const attestation = JSON.parse(fs.readFileSync(
      path.join(run.sidecar, 'apps/operator/runtime/vm-release-vulnerability-attestation.json'),
      'utf8',
    ));
    assert.equal(summary.result.status, 'green');
    assert.equal(summary.result.gatedMatches, 0);
    assert.equal(summary.coverage.cataloguedPackages, 1);
    assert.match(summary.evidence.sbomSha256, /^[a-f0-9]{64}$/);
    assert.match(summary.evidence.grypeReportSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(attestation, summary, 'the shipped attestation must bind the external evidence exactly');
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('vm-release vulnerability audit rejects a real High match and never writes a green attestation', () => {
  const run = runFakeVulnerabilityAudit({
    matches: [{
      artifact: { name: 'demo-runtime', version: '1.0.0', locations: [{ path: '/bin/demo' }] },
      vulnerability: { id: 'CVE-2099-0001', severity: 'High' },
    }],
  });
  try {
    assert.equal(run.result.status, 1, `${run.result.stdout}${run.result.stderr}`);
    assert.match(run.result.stdout, /VULNERABILITY GATE RED/);
    assert.match(run.result.stdout, /\/bin\/demo.*CVE-2099-0001/);
    const summary = JSON.parse(fs.readFileSync(path.join(run.evidence, 'summary.json'), 'utf8'));
    assert.equal(summary.result.status, 'red');
    assert.equal(summary.result.gatedMatches, 1);
    assert.equal(
      fs.existsSync(path.join(run.sidecar, 'apps/operator/runtime/vm-release-vulnerability-attestation.json')),
      false,
      'a red scan must not leave a shippable green-looking attestation',
    );
  } finally {
    fs.rmSync(run.dir, { recursive: true, force: true });
  }
});

test('vm-release vulnerability audit fails closed when the Grype DB is invalid or the report is unjudgeable', () => {
  for (const input of [
    { dbValid: false, label: 'invalid DB' },
    { report: {}, label: 'missing matches array' },
  ]) {
    const run = runFakeVulnerabilityAudit(input);
    try {
      assert.equal(run.result.status, 2, `${input.label}\n${run.result.stdout}${run.result.stderr}`);
      assert.match(`${run.result.stdout}${run.result.stderr}`, /AUDIT ERROR/);
    } finally {
      fs.rmSync(run.dir, { recursive: true, force: true });
    }
  }
});

test('vulnerability audit refuses empty or unidentified SBOM coverage before scanning or attesting', () => {
  for (const sbom of [
    { components: [] },
    {},
    { components: {} },
    { components: [null, {}, { name: 'file-only' }] },
    { components: [{ name: 'runtime', version: '1.0.0', purl: '' }] },
  ]) {
    const run = runFakeVulnerabilityAudit({ sbom });
    try {
      assert.equal(run.result.status, 2, `${JSON.stringify(sbom)}\n${run.result.stdout}${run.result.stderr}`);
      assert.match(run.result.stderr, /SBOM coverage is unjudgeable/);
      assert.doesNotMatch(run.result.stdout, /VULNERABILITY GATE GREEN/);
      assert.equal(fs.existsSync(path.join(run.evidence, 'grype-scan-called')), false);
      assert.equal(fs.existsSync(path.join(run.evidence, 'summary.json')), false);
      assert.equal(fs.existsSync(path.join(run.sidecar,
        'apps/operator/runtime/vm-release-vulnerability-attestation.json')), false);
    } finally {
      fs.rmSync(run.dir, { recursive: true, force: true });
    }
  }
});

function prepareBuilderPreflightRepo(dir) {
  // These tests stop before building. Give the real source/dependency guards a
  // repository with no borrowed node_modules, rather than inspecting the live
  // checkout (which may legitimately contain writable hardlinks).
  const source = path.resolve(root, '..');
  const repo = path.join(dir, 'source');
  execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', source, repo]);
  const copy = (relative) => {
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, relative), target);
  };
  for (const relative of ['.nvmrc', 'package.json', 'package-lock.json']) copy(relative);
  const lock = JSON.parse(fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8'));
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative.split('/').includes('node_modules') && entry.dependencies?.['@huggingface/transformers']) {
      copy(path.posix.join(relative, 'package.json'));
    }
  }
  // Satisfy the source-closure preflight with coherent worker/handler contracts.
  // These tests exercise later identity/scanner boundaries, so a missing source
  // entrypoint must not stop them before their intended failure is observed.
  const recipes = {
    'packages/operator-core/lib/agent-tools/testing/run.ts': 'export const run = () => {};\n',
    'packages/plugin-loader/package.json': '{"dependencies":{}}\n',
    'packages/plugin-loader/src/daemon/supervisor.ts': 'export default {};\n',
    'apps/operator/bin/bundle-host-common.sh': '# historical source recipe\n',
    'apps/operator/bin/serve.ts': fs.readFileSync(path.join(source, 'apps/operator/bin/serve.ts'), 'utf8'),
    'apps/operator/bin/ascii-escape-bundle.mjs': 'export {};\n',
  };
  for (const [relative, body] of Object.entries(recipes)) {
    const target = path.join(repo, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  // The producer's --check imports this API without executing it. Any accidental
  // package command is a test failure; no install/cache lease is needed here.
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'scripts/npm-install-safe.mjs'),
    'export function withPackageCacheReadLease() { throw new Error("preflight must not run a package command"); }\n');
  return repo;
}

function runBuilderOwnerPreflight({ audit, owner, advance = false }) {
  const dir = tmp('owner-preflight');
  const repo = advance ? prepareBuilderPreflightRepo(dir) : path.join(dir, 'missing-repo');
  const env = {
    ...process.env,
    PAPERCUSP_RELEASE_AUDIT: audit,
    // The rejecting cases use a missing repo to prove they stop before the first
    // runtime-pin read. Allowed cases use isolated source inputs, then stop at
    // the deliberately absent Papercusp dependency before any build operation.
    REPO_ROOT: repo,
    PAPERCUSP_ROOT: path.join(dir, 'missing-papercusp'),
  };
  delete env.PAPERCUSP_RELEASE_OWNER_NAME;
  delete env.PROVENANCE_SOURCE_GIT_HEAD;
  delete env.PROVENANCE_SOURCE_GIT_DIRTY;
  if (advance) {
    // Pin the fixture's phase-boundary source identity. The deliberately partial
    // checkout is not a release input; source-cleanliness coverage lives in
    // test/provenance-sidecar-record.test.js.
    env.PROVENANCE_SOURCE_GIT_HEAD = execFileSync('git', ['-C', env.REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    env.PROVENANCE_SOURCE_GIT_DIRTY = 'false';
  }
  if (owner !== undefined) env.PAPERCUSP_RELEASE_OWNER_NAME = owner;
  try {
    return spawnSync('bash', [path.join(root, 'bin/build-desktop-sidecar.sh')], {
      encoding: 'utf8',
      env,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runBuilderVmReleaseIdentityPreflight({ sha, version, advance = false, targetOs = 'linux', targetArch = 'x64' }) {
  const dir = tmp('vm-release-identity-preflight');
  const repo = advance ? prepareBuilderPreflightRepo(dir) : path.join(dir, 'missing-repo');
  const readiness = advance ? runFakeVulnerabilityAudit({ preflight: true }) : null;
  const env = {
    ...(readiness?.env ?? process.env),
    PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release',
    PAPERCUSP_RELEASE_AUDIT: '0',
    TARGET_OS: targetOs,
    TARGET_ARCH: targetArch,
    // Rejecting cases use a missing repo to prove identity fails before the
    // first runtime-pin read. The admitted case advances safely to the missing
    // Papercusp dependency without starting a build.
    REPO_ROOT: repo,
    PAPERCUSP_ROOT: path.join(dir, 'missing-papercusp'),
  };
  delete env.PAPERCUSP_BUILD_SHA;
  delete env.PAPERCUSP_DESKTOP_VERSION;
  if (advance) {
    // Same phase-boundary seam as the owner preflight. The clean-source guard
    // has separate coverage in sidecar-source-root-coherence.test.ts.
    env.PROVENANCE_SOURCE_GIT_HEAD = execFileSync('git', ['-C', env.REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    env.PROVENANCE_SOURCE_GIT_DIRTY = 'false';
  }
  if (sha !== undefined) env.PAPERCUSP_BUILD_SHA = sha;
  if (version !== undefined) env.PAPERCUSP_DESKTOP_VERSION = version;
  try {
    return spawnSync('bash', [path.join(root, 'bin/build-desktop-sidecar.sh')], {
      encoding: 'utf8',
      env,
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (readiness) fs.rmSync(readiness.dir, { recursive: true, force: true });
  }
}

test('vm-release sidecar build rejects missing artifact identity before toolchain work', () => {
  for (const input of [
    { sha: undefined, version: '9.8.7', label: 'missing SHA' },
    { sha: 'deadbeef', version: undefined, label: 'missing version' },
    { sha: ' \t ', version: '9.8.7', label: 'blank SHA' },
    { sha: 'deadbeef', version: ' unknown ', label: 'unknown version' },
  ]) {
    const r = runBuilderVmReleaseIdentityPreflight(input);
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 2, `${input.label}\n${output}`);
    assert.match(output, /vm-release requires non-empty PAPERCUSP_BUILD_SHA and PAPERCUSP_DESKTOP_VERSION before building/);
    assert.match(output, /refusing before toolchain work/);
    assert.doesNotMatch(output, /could not read the repo-pinned Node major/,
      'the identity rejection must precede the first toolchain/runtime preflight');
  }
});

test('vm-release sidecar identity preflight admits an explicit immutable SHA and version', () => {
  const r = runBuilderVmReleaseIdentityPreflight({
    sha: 'deadbeefcafefeed',
    version: '9.8.7-vm-test',
    advance: true,
  });
  const output = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 1, output);
  assert.match(output, /papercusp not found at/,
    'valid vm-release identity must advance past the preflight');
  assert.doesNotMatch(output, /vm-release requires non-empty PAPERCUSP_BUILD_SHA/);
});

test('vm-release rejects unsupported targets before source, dependency or staging work', () => {
  for (const [targetOs, targetArch] of [['darwin', 'x64'], ['darwin', 'arm64'], ['linux', 'arm64'], ['windows', 'x64']]) {
    const r = runBuilderVmReleaseIdentityPreflight({
      sha: 'deadbeefcafefeed', version: '9.8.7-vm-test', targetOs, targetArch,
    });
    const output = `${r.stdout}${r.stderr}`;
    const nativeMismatch = targetOs === 'linux' && (process.platform !== 'linux' || targetArch !== process.arch);
    assert.equal(r.status, nativeMismatch ? 2 : 1, output);
    if (nativeMismatch) {
      assert.match(output, /requires a matching native Linux build process/);
      assert.ok(output.includes(`Linux sidecar target ${targetArch}`), output);
    } else {
      assert.match(output, /pinned trust toolchain currently supports only linux-x64/);
      assert.ok(output.includes(`requested: ${targetOs}-${targetArch}`), output);
    }
    assert.doesNotMatch(output, /transformers|could not read|papercusp not found|staging|vite/i,
      'target rejection must precede dependency/source reads and expensive build phases');
  }
});

test('vm-release trust preparation retains the target guard before creating cache output', () => {
  const dir = tmp('vm-release-target-preflight');
  const cache = path.join(dir, 'must-not-exist');
  try {
    const supported = spawnSync('bash', ['-c',
      'source "$1"; papercusp_validate_vm_release_target linux x64', 'target-test', TRUST_TOOLCHAIN], { encoding: 'utf8' });
    assert.equal(supported.status, 0, `${supported.stdout}${supported.stderr}`);
    const refused = spawnSync('bash', ['-c',
      'source "$1"; papercusp_prepare_vm_release_trust_toolchain "$2" darwin x64',
      'target-test', TRUST_TOOLCHAIN, cache], { encoding: 'utf8' });
    assert.equal(refused.status, 1, `${refused.stdout}${refused.stderr}`);
    assert.match(refused.stderr, /requested: darwin-x64/);
    assert.equal(fs.existsSync(cache), false, 'unsupported preparation must not create its cache');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('release-audited sidecar build accepts a missing owner name under D-112', () => {
  for (const owner of [undefined, '', ' , ; \t ']) {
    const r = runBuilderOwnerPreflight({ audit: '1', owner, advance: true });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `owner=${JSON.stringify(owner)}\n${output}`);
    assert.match(output, /papercusp not found at/,
      'audit=1 must advance past the removed owner-name gate to the safe missing dependency');
    assert.doesNotMatch(output, /requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME|final identity audit cannot certify/);
  }
});

test('sidecar audit selection leaves dev builds and asserted release builds unchanged', () => {
  for (const input of [
    { audit: '0', owner: undefined, advance: true, label: 'dev build' },
    { audit: '1', owner: SYNTHETIC_OWNER, advance: true, label: 'asserted release build' },
  ]) {
    const r = runBuilderOwnerPreflight(input);
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `${input.label}\n${output}`);
    assert.match(output, /papercusp not found at/,
      `${input.label} must advance to the safe missing dependency`);
    assert.doesNotMatch(output, /requires a non-empty PAPERCUSP_RELEASE_OWNER_NAME/);
  }
});

test('prune-docs removes pagefind search-index shards, not just internal-infra docs', () => {
  const dir = tmp('prune');
  try {
    const docs = path.join(dir, 'internal-docs');
    fs.mkdirSync(path.join(docs, 'pagefind/index'), { recursive: true });
    // The three shard extensions the `pagefind-search-index` rule names.
    for (const f of ['index/en_dead.pf_index', 'pagefind.en_beef.pf_meta', 'x.pf_fragment']) {
      fs.mkdirSync(path.dirname(path.join(docs, 'pagefind', f)), { recursive: true });
      fs.writeFileSync(path.join(docs, 'pagefind', f), 'indexed words\n');
    }
    // A normal doc must SURVIVE — this is a targeted prune, not a purge.
    fs.writeFileSync(path.join(docs, 'guide.html'), 'harmless\n');

    const r = audit('--prune-docs', docs);
    assert.equal(r.status, 0, `prune-docs failed:\n${r.stdout}${r.stderr}`);

    const left = [];
    for (const [d, , files] of walk(docs)) for (const f of files) left.push(path.join(d, f));
    const shards = left.filter((f) => /\.pf_(index|fragment|meta)$/.test(f));
    assert.deepEqual(shards, [], `pagefind shards must be pruned, found:\n${shards.join('\n')}`);
    assert.ok(fs.existsSync(path.join(docs, 'guide.html')), 'a normal doc must survive the prune');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D-150/D-164 producers retain only the exact SSH2 certificate fixture and runtime neighbours', () => {
  const dir = tmp('vendor-key-prune');
  const fixtures = [
    'node_modules/ssh2/test/fixtures/https_key.pem',
    'node_modules/ssh2/test/fixtures/id_rsa',
    'node_modules/ssh2/test/fixtures/keyParser/openssh_new_rsa.pub',
    'node_modules/ssh2/test/fixtures/unknown-public-fixture.txt',
    'node_modules/ssh2/test/fixtures/http',
    'node_modules/ssh2/test/fixtures/https_cert.pem.backup',
    'node_modules/ssh2/test/fixtures/nested/https_cert.pem',
    'packages/peer/node_modules/ssh2/test/fixtures/id_ecdsa',
    'node_modules/style-dictionary/examples/advanced/create-react-native-app/android/app/debug.keystore',
  ];
  const retained = [
    'node_modules/ssh2/lib/client.js',
    'node_modules/ssh2/test/fixtures/https_cert.pem',
    'packages/peer/node_modules/ssh2/test/fixtures/https_cert.pem',
    'node_modules/style-dictionary/lib/index.js',
    'node_modules/other/android/app/debug.keystore',
  ];
  try {
    for (const name of [...fixtures, ...retained]) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), 'synthetic fixture\n');
    }
    const exclusions = audit('--tar-excludes');
    assert.equal(exclusions.status, 0, exclusions.stderr);
    const archive = path.join(dir, 'source.tar');
    const tar = spawnSync('tar', [
      ...exclusions.stdout.trim().split('\n').map(pattern => `--exclude=${pattern}`),
      '-cf', archive, '-C', dir, './node_modules', './packages',
    ], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    const members = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
    assert.equal(members.status, 0, members.stderr);
    const paths = members.stdout.split('\n').map(name => name.replace(/^\.\//, ''));
    for (const name of fixtures) assert.ok(!paths.includes(name), name);
    for (const name of retained) assert.ok(paths.includes(name), name);

    const pruned = audit('--prune-docs', dir);
    assert.equal(pruned.status, 0, pruned.stderr);
    for (const name of fixtures) assert.ok(!fs.existsSync(path.join(dir, name)), name);
    for (const name of retained) assert.ok(fs.existsSync(path.join(dir, name)), name);
    const rescan = spawnSync('python3', ['-c', String.raw`
import importlib.util,pathlib,sys
s=importlib.util.spec_from_file_location('audit',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
root=pathlib.Path(sys.argv[2]);rx=m._rule_rx('vendored-private-key-fixtures')
assert not [p for p in root.rglob('*') if rx.search(p.relative_to(root).as_posix())]
print('vendor-key-fixture-rescan=0')
`, AUDIT, dir], { encoding: 'utf8' });
    assert.equal(rescan.status, 0, rescan.stderr);
    assert.match(rescan.stdout, /vendor-key-fixture-rescan=0/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── WI-38233 / the 0.0.16 cut: the PRUNE↔SCAN predicate gap.
//
// prune_docs deletes by PATH; scan_dir fails by CONTENT. A doc whose path matches no
// FORBIDDEN_PATH rule but whose TEXT quotes this box's identity falls between them —
// 65 assembled files did exactly that and red the 0.0.16 cut after every path rule
// passed clean. --scrub-text closes it. These assertions are behavioural: they drive
// the real gate, so a rewrite that reopens the gap by another route still fails.

test('scrub-text clears a doc the gate would REJECT — and the gate agrees afterwards', () => {
  const lit = identityLiteral();
  const dir = tmp('scrubtext');
  const doc = path.join(dir, 'agent-insights', 'some-insight.mdx');
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, `# Insight\n\nRun it from ${lit}/papercusp and re-check.\n`);

  // FALSIFIER: prove the gate REJECTS this fixture first. Without this, a scrub that
  // did nothing would still let the post-scan assertion below pass vacuously.
  //
  // Asserted as EXACTLY 1, not merely non-zero: the gate separates "found leaks" (1)
  // from "could not check" (2) precisely so a caller can tell a blind gate from a
  // real verdict. A `notEqual(…, 0)` falsifier accepts BOTH, so a gate that refused
  // to certify — and therefore never read the fixture at all — would satisfy this
  // step and make the scrub look proven. That is not hypothetical: it is exactly how
  // this test failed when the box's asserted owner identity went missing.
  assert.equal(audit('--scan-dir', dir).status, 1,
    'fixture must be REJECTED-on-a-leak (exit 1) before the scrub; exit 2 means the ' +
    'gate could not check and this test would prove nothing');

  assert.equal(audit('--scrub-text', dir).status, 0);
  const after = fs.readFileSync(doc, 'utf8');
  assert.ok(!after.includes(lit), 'the identity literal must be gone');
  assert.ok(after.includes('# Insight'), 'surrounding prose must survive the scrub');
  assert.equal(audit('--scan-dir', dir).status, 0, 'the gate must pass after the scrub');
});

test('scrub-text reaches the source and generated-text classes the sidecar actually ships', () => {
  const lit = identityLiteral();
  const dir = tmp('scrubtext-ext');
  // .html matters specifically: internal-docs ships RENDERED twins of each .mdx, so
  // scrubbing only the source would leave the identity live in the served bytes.
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json', 'js', 'mjs', 'ts', 'sql']) {
    fs.writeFileSync(path.join(dir, `f.${ext}`), `see ${lit} here`);
  }
  assert.equal(audit('--scrub-text', dir).status, 0);
  for (const ext of ['md', 'mdx', 'html', 'txt', 'json', 'js', 'mjs', 'ts', 'sql']) {
    assert.ok(!fs.readFileSync(path.join(dir, `f.${ext}`), 'utf8').includes(lit),
      `.${ext} must be scrubbed — it ships`);
  }
});

test('scrub-text breaks hardlinks — the live monorepo doc tree is never rewritten', () => {
  // The sidecar copier hardlinks where the FS supports it. An in-place write would
  // reach back THROUGH the link into apps/operator-docs and mutate the real repo.
  const lit = identityLiteral();
  const dir = tmp('scrubtext-link');
  try {
    const shipped = path.join(dir, 'internal-docs', 'shipped.md');
    fs.mkdirSync(path.dirname(shipped), { recursive: true });
    fs.writeFileSync(shipped, `path ${lit} end`);
    const source = path.join(dir, 'source-of-truth.md'); // OUTSIDE the scrubbed root
    fs.linkSync(shipped, source);
    assert.equal(fs.statSync(shipped).nlink, 2, 'fixture must actually be hardlinked');

    assert.equal(audit('--scrub-text', path.join(dir, 'internal-docs')).status, 0);
    assert.ok(!fs.readFileSync(shipped, 'utf8').includes(lit), 'the shipped copy must be scrubbed');
    assert.ok(fs.readFileSync(source, 'utf8').includes(lit),
      'the sibling hardlink must be UNTOUCHED — an in-place write would have rewritten it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scrub-text leaves a CLEAN doc byte-identical', () => {
  const dir = tmp('scrubtext-clean');
  const doc = path.join(dir, 'clean.md');
  const body = '# Clean\n\nNothing sensitive here.\n';
  fs.writeFileSync(doc, body);
  const before = fs.statSync(doc).mtimeMs;
  assert.equal(audit('--scrub-text', dir).status, 0);
  assert.equal(fs.readFileSync(doc, 'utf8'), body);
  assert.equal(fs.statSync(doc).mtimeMs, before, 'a clean file must not be rewritten at all');
});

test('final shipping-text projection cleans real donor-linked bundles and preserves execution', () => {
  const dir = tmp('scrubtext-donor-bundle');
  try {
    const lit = identityLiteral();
    const donor = path.join(dir, 'donor', lit.replace(/^[/\\]+/, ''), 'node_modules');
    const pkg = path.join(donor, 'shipping-fixture');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'shipping-fixture', main: 'index.cjs' }));
    fs.writeFileSync(path.join(pkg, 'index.cjs'), 'module.exports = { answer: 42 };\n');
    const source = path.join(dir, 'frozen-source');
    fs.mkdirSync(source);
    fs.symlinkSync(donor, path.join(source, 'node_modules'), 'dir');
    fs.writeFileSync(path.join(source, 'entry.cjs'), "console.log(require('shipping-fixture').answer);\n");
    const sidecar = path.join(dir, 'sidecar');
    const worker = path.join(sidecar, 'late.worker.mjs');
    const cli = path.join(sidecar, 'scripts', 'late-cli.cjs');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    const esbuild = require('esbuild');
    for (const [outfile, format] of [[worker, 'esm'], [cli, 'cjs']]) {
      const result = esbuild.buildSync({ absWorkingDir: source, entryPoints: ['entry.cjs'],
        outfile, platform: 'node', format, bundle: true, metafile: true, logLevel: 'silent' });
      fs.writeFileSync(`${outfile}.meta.json`, JSON.stringify(result.metafile));
      assert.ok(fs.readFileSync(outfile, 'utf8').includes(lit), 'real compiler output must reproduce the donor identity leak');
      assert.equal(execFileSync(process.execPath, [outfile], { encoding: 'utf8' }).trim(), '42');
    }
    assert.equal(audit('--scan-dir', sidecar).status, 1, 'the final detector must reject the unprojected real bundles');
    assert.equal(audit('--scrub-text', sidecar).status, 0);
    assert.equal(audit('--scan-dir', sidecar).status, 0, 'all compiled and metadata outputs must pass the same detector');
    for (const outfile of [worker, cli]) {
      assert.ok(!fs.readFileSync(outfile, 'utf8').includes(lit));
      assert.ok(!fs.readFileSync(`${outfile}.meta.json`, 'utf8').includes(lit));
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(`${outfile}.meta.json`, 'utf8')));
      assert.equal(execFileSync(process.execPath, [outfile], { encoding: 'utf8' }).trim(), '42', 'projection must preserve runtime behavior');
    }
    assert.equal(fs.readFileSync(path.join(pkg, 'index.cjs'), 'utf8'), 'module.exports = { answer: 42 };\n', 'donor inputs stay untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-desktop-sidecar runs --scrub-text BEFORE the identity scan that judges it', () => {
  // Ordering is the whole contract: scrubbing after the scan would gate on unscrubbed
  // bytes and red every cut, which is the bug this wiring exists to prevent.
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const scrub = sh.indexOf('--scrub-text');
  const scan = sh.indexOf('--scan-dir');
  assert.ok(scrub > 0, 'build-desktop-sidecar.sh must invoke --scrub-text');
  assert.ok(scan > 0, 'build-desktop-sidecar.sh must invoke --scan-dir');
  assert.ok(scrub < scan, '--scrub-text must run BEFORE --scan-dir');
  // Both doc trees, or the untouched one reds the cut.
  assert.ok(/--scrub-text[\s\S]{0,200}internal-docs/.test(sh), 'must scrub internal-docs');
  assert.ok(/--scrub-text[\s\S]{0,200}operator-docs\/src\/content\/docs/.test(sh),
    'must scrub the .mdx source tree');
  assert.ok(/--scrub-text[\s\S]{0,260}serve\.mjs/.test(sh),
    'must scrub the generated operator entrypoint');
  assert.ok(/--scrub-text[\s\S]{0,300}\$SIDECAR_DIR\/spa/.test(sh),
    'must scrub generated SPA text');
  const overlayCopy = sh.indexOf('cp -a "$OLD_DIR/$_overlay" "$SIDECAR_TMP_DIR/$_overlay"');
  const envTextScrub = sh.indexOf('--scrub-text', overlayCopy);
  assert.ok(envTextScrub > overlayCopy,
    'preserved env-sidecar text must be scrubbed after the overlay restore');
  const finalScrub = sh.lastIndexOf('--scrub-text "$SIDECAR_DIR"');
  const finalScan = sh.lastIndexOf('--scan-dir "$SIDECAR_DIR"');
  assert.ok(finalScrub > overlayCopy && finalScan > finalScrub,
    'the entire shipping text tree must be projected after late assembly and before its final scan');
});

test('sidecar source-note producer scrubs build roots and preserves system provenance', () => {
  const dir = tmp('source-note-helper');
  const note = path.join(dir, 'bin', '.pg-tools-source');
  const sidecar = path.join(dir, 'sidecar.tmp.123');
  const repo = path.join(dir, 'repo');
  const desktop = path.join(repo, 'papercusp-desktop');
  const home = path.join(dir, 'home', 'builder');
  fs.mkdirSync(path.dirname(note), { recursive: true });

  const script = [
    'set -euo pipefail',
    `source ${JSON.stringify(SOURCE_NOTE_HELPER)}`,
    `SIDECAR_DIR=${JSON.stringify(sidecar)}`,
    `SIDECAR_TMP_DIR=${JSON.stringify(sidecar)}`,
    `REPO_ROOT=${JSON.stringify(repo)}`,
    `ROOT=${JSON.stringify(desktop)}`,
    `HOME=${JSON.stringify(home)}`,
    `papercusp_append_pg_tool_source_note ${JSON.stringify(note)} pg_dump symlink ${JSON.stringify(`${sidecar}/node_modules/pg_dump`)}`,
    `papercusp_append_pg_tool_source_note ${JSON.stringify(note)} psql copy ${JSON.stringify('/usr/lib/postgresql/18/bin/psql')}`,
    `cat ${JSON.stringify(note)}`,
  ].join('\n');

  try {
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /pg_dump: symlink \(<sidecar>\/node_modules\/pg_dump\)/);
    assert.match(r.stdout, /psql: copy \(\/usr\/lib\/postgresql\/18\/bin\/psql\)/);
    assert.doesNotMatch(r.stdout, /sidecar\.tmp\.123|\/home\/builder/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sidecar source-note producer refuses an unredacted user-root path before writing', () => {
  const dir = tmp('source-note-reject');
  const note = path.join(dir, '.pg-tools-source');
  const script = [
    'set -u',
    `source ${JSON.stringify(SOURCE_NOTE_HELPER)}`,
    `SIDECAR_DIR=${JSON.stringify(path.join(dir, 'sidecar'))}`,
    `SIDECAR_TMP_DIR=${JSON.stringify(path.join(dir, 'sidecar.tmp'))}`,
    `REPO_ROOT=${JSON.stringify(path.join(dir, 'repo'))}`,
    `ROOT=${JSON.stringify(path.join(dir, 'desktop'))}`,
    `HOME=${JSON.stringify(path.join(dir, 'builder'))}`,
    `set +e`,
    `papercusp_append_pg_tool_source_note ${JSON.stringify(note)} pg_dump copy ${JSON.stringify('/home/other-builder/bin/pg_dump')}`,
    'status=$?',
    `printf 'status=%s\\n' "$status"`,
    `[[ ! -e ${JSON.stringify(note)} ]]`,
  ].join('\n');

  try {
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refusing to write unredacted build-box path/);
    assert.match(r.stdout, /status=1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runSourceNoteAssemblyFixture(sh) {
  const dir = tmp('source-note-assembly');
  const sidecar = path.join(dir, 'sidecar');
  const inputs = path.join(dir, 'darwin-inputs');
  const embedded = path.join(dir, 'embedded');
  const platform = path.join(embedded, 'node_modules/@embedded-postgres/darwin-x64');
  const note = path.join(sidecar, 'bin/.pg-tools-source');
  try {
    fs.mkdirSync(path.dirname(note), { recursive: true });
    fs.writeFileSync(note, 'stale assembly receipt\n');
    fs.mkdirSync(path.join(inputs, 'postgresql/bin'), { recursive: true });
    fs.writeFileSync(path.join(inputs, 'postgresql/bin/postgres'), 'qualified fixture payload');
    fs.writeFileSync(path.join(inputs, 'manifest.json'), JSON.stringify({
      postgresqlVersion: '18.6', minimumMacOS: '17.0',
    }));
    fs.mkdirSync(path.join(platform, 'native'), { recursive: true });
    fs.writeFileSync(path.join(platform, 'package.json'), JSON.stringify({ version: '18.1.0' }));

    // Execute the real staging reset and private-PG branch. The fixture supplies
    // already-qualified native inputs; qualification itself has its own suite.
    const reset = sh.indexOf('rm -rf "$SIDECAR_DIR"');
    const spa = sh.indexOf('echo "→ building operator-vite SPA', reset);
    const privateStart = sh.indexOf('if [[ -n "$DARWIN_NATIVE_INPUTS" ]]; then\n  validate_darwin_native_inputs');
    const privateEnd = sh.indexOf('# Sanity check: must have at least one @embedded-postgres/', privateStart);
    assert.ok(reset >= 0 && spa > reset && privateStart > spa && privateEnd > privateStart,
      'producer fixture must bind the actual assembly and private-PG boundaries');
    // Exercise every later note writer in its production order, including the
    // mutually exclusive Kopia sources. Keep assignments/resets too, so a late
    // truncation cannot silently discard the earlier Darwin payload receipt.
    const laterWrites = sh.slice(privateEnd).replace(/\\\n\s*/g, ' ').split('\n')
      .filter(line => line.includes('SOURCE_NOTE_FILE') && !line.trimStart().startsWith('#'));
    assert.ok(laterWrites.some(line => line.includes('papercusp_append_pg_tool_source_note')));
    assert.ok(laterWrites.some(line => line.includes('gh: qualified private Darwin input')));
    const script = [
      'set -euo pipefail',
      `source ${JSON.stringify(SOURCE_NOTE_HELPER)}`,
      'validate_darwin_native_inputs() { return 0; }',
      sh.slice(reset, spa),
      sh.slice(privateStart, privateEnd),
      ...laterWrites,
    ].join('\n');
    const env = { ...process.env, SIDECAR_DIR: sidecar, SIDECAR_TMP_DIR: sidecar,
      DARWIN_NATIVE_INPUTS: inputs, EMBEDDED_PG_DST: embedded, TARGET_ARCH: 'x64',
      PAPERCUSP_DARWIN_NATIVE_INPUTS_SHA256: 'a'.repeat(64),
      PAPERCUSP_VM_KOPIA_VERSION: '0.24.0', PAPERCUSP_VM_KOPIA_COMMIT: 'fixture-commit',
      _kopia_ver: '0.24.0', _kopia_arch: 'amd64', _kopia_src: '/usr/bin/kopia',
      tool: 'psql', method: 'copy', src: '/usr/lib/postgresql/18/bin/psql' };
    delete env.SOURCE_NOTE_FILE;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', env });
    return { status: result.status, output: `${result.stdout}${result.stderr}`,
      note: fs.existsSync(note) ? fs.readFileSync(note, 'utf8') : '',
      package: JSON.parse(fs.readFileSync(path.join(platform, 'package.json'), 'utf8')) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('sidecar assembly initializes the note before private Darwin PG and preserves all later tool receipts', () => {
  // An exact retained producer can run this same conventional test as a
  // counterfactual without editing that immutable source bank.
  const producer = process.env.PAPERCUSP_SOURCE_NOTE_TEST_PRODUCER
    || path.join(root, 'bin/build-desktop-sidecar.sh');
  const result = runSourceNoteAssemblyFixture(fs.readFileSync(producer, 'utf8'));
  assert.equal(result.status, 0, result.output);
  assert.match(result.note, /private Darwin PostgreSQL bottle payload: a{64}/);
  assert.match(result.note, /psql: copy \(\/usr\/lib\/postgresql\/18\/bin\/psql\)/);
  assert.match(result.note, /kopia: pinned source build/);
  assert.match(result.note, /kopia: qualified private Darwin input/);
  assert.match(result.note, /kopia: cross-fetch/);
  assert.match(result.note, /kopia: copy \(from system PATH\)/);
  assert.match(result.note, /gh: qualified private Darwin input/);
  assert.doesNotMatch(result.note, /stale assembly receipt/);
  assert.equal(result.package.papercuspNativePayload.origin, 'qualified-homebrew-bottle-private');
  assert.equal(result.package.papercuspNativePayload.manifestSha256, 'a'.repeat(64));
});

test('source-note assembly guard detects a late reset erasing the Darwin payload receipt', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const mutated = sh.replace('echo "→ wiring pg_dump / psql / pg_dumpall into $SIDECAR_DIR/bin/"',
    'echo "→ wiring pg_dump / psql / pg_dumpall into $SIDECAR_DIR/bin/"\n> "$SOURCE_NOTE_FILE"');
  assert.notEqual(mutated, sh);
  const result = runSourceNoteAssemblyFixture(mutated);
  assert.equal(result.status, 0, result.output);
  assert.doesNotMatch(result.note, /private Darwin PostgreSQL bottle payload/);
  assert.match(result.note, /gh: qualified private Darwin input/);
});

test('build-desktop-sidecar routes path-bearing source-note writes through the producer guard', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  assert.match(sh, /source "\$HERE\/lib\/sidecar-source-note\.sh"/);
  assert.equal(
    (sh.match(/^\s*papercusp_append_pg_tool_source_note\b/gm) || []).length,
    2,
    'both path-bearing source-note writes must use the producer helper',
  );
  assert.match(sh, /papercusp_append_pg_tool_source_note "\$SOURCE_NOTE_FILE" "\$tool" "\$method" "\$src"/);
  assert.match(
    sh,
    /papercusp_append_pg_tool_source_note \\\s*\n\s*"\$SOURCE_NOTE_FILE" "kopia" "copy \(from system PATH\)" "\$_kopia_src"/,
  );
  assert.doesNotMatch(
    sh,
    /[^\n]*(?:\$src|\$_kopia_src)[^\n]*>> "\$SOURCE_NOTE_FILE"/,
    'path-bearing source-note writes must not bypass the producer helper',
  );
});

test('cross-darwin git vendor prunes git-instaweb before scanning and signing the shipping tree', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const vendorCopy = sh.indexOf(
    'cp -a "$_cross_darwin_git_keg/libexec/git-core" "$SIDECAR_DIR/bin/.git-vendor/libexec/git-core"',
  );
  const prune = sh.indexOf(
    'rm -f "$SIDECAR_DIR/bin/.git-vendor/libexec/git-core/git-instaweb"',
    vendorCopy,
  );
  const rewriteWalk = sh.indexOf(
    'find "$SIDECAR_DIR/bin/.git-vendor" -type f -print0',
    vendorCopy,
  );

  assert.ok(vendorCopy > 0, 'the cross-darwin Git libexec copy must exist');
  assert.ok(prune > vendorCopy,
    'git-instaweb must be pruned from the copied tree, never from the source keg');
  assert.ok(rewriteWalk > prune,
    'the prune must happen before the shipping vendor tree is rewritten and signed');
  assert.match(
    sh.slice(prune, rewriteWalk),
    /\[\[ ! -e "\$SIDECAR_DIR\/bin\/\.git-vendor\/libexec\/git-core\/git-instaweb" \]\]/,
    'the builder must fail closed if git-instaweb survives the prune',
  );
});

test('build-desktop-sidecar scrubs every preserved env-sidecar db-sql tree at its copy point', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const overlayCopy = sh.indexOf('cp -a "$OLD_DIR/$_overlay" "$SIDECAR_TMP_DIR/$_overlay"');
  const envScrub = sh.indexOf('"preserved env sidecars"');
  const stamp = sh.indexOf('_stamp_serve_sha=');
  const finalScan = sh.lastIndexOf('audit-release-bundle.py" --scan-dir "$SIDECAR_DIR"');

  assert.ok(overlayCopy > 0, 'the release-overlay preservation copy must exist');
  assert.ok(envScrub > overlayCopy,
    'env-sidecar db-sql must be scrubbed AFTER preserved overlays are restored');
  assert.ok(stamp > envScrub, 'the scrub must finish before the sidecar is stamped');
  assert.ok(finalScan > envScrub, 'the final assembled scan must judge the scrubbed bytes');
  assert.match(
    sh.slice(envScrub - 120, envScrub + 240),
    /\$SIDECAR_TMP_DIR"\/env-sidecars\/\*\/db-sql/,
    'the copy-point scrub must cover every env-sidecars/<environment>/db-sql tree',
  );
  assert.match(
    sh,
    /find "\$\{_roots\[@\]\}" -type f -name '\*\.sql' -print0/,
    'the shared db-sql scrub helper must recurse through every SQL file in each selected tree',
  );
});

test('sidecar db-sql scrub consumes the audit gate case-folded pattern instead of rebuilding it', () => {
  const sh = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');
  const programStart = sh.indexOf('declare -a _dbsql_sed=()');
  const helperStart = sh.indexOf('_scrub_sidecar_db_sql()', programStart);
  assert.ok(programStart > 0 && helperStart > programStart,
    'the db-sql scrub program and helper must exist in order');

  const program = sh.slice(programStart, helperStart);
  assert.match(
    program,
    /read -r _val _red _wb _pat/,
    'the sidecar scrub must read --identity-literals column 4, which carries the audit case rule',
  );
  assert.match(
    program,
    /_dbsql_sed\+=\(-e "s\/\$\{_pat\}\/\$\{_r\}\/g"\)/,
    'the sidecar scrub must pass the audit-owned folded ERE directly to sed',
  );
  assert.match(
    program,
    /if \[\[ -n "\$_pat" \]\]/,
    'an older three-column audit script may use the compatibility fallback, but must not be the normal path',
  );
});

test('scrub-binaries removes a build-box literal from a compiled addon, preserving byte length', () => {
  const lit = identityLiteral();
  const dir = tmp('scrub');
  try {
    const rel = 'node_modules/pkg/build/Release/addon.node';
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // Shaped like the real leak: an assert() __FILE__ string between NULs in .rodata.
    const blob = Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0]),
      Buffer.from(`void Thing::Method()\0\0${lit}/.cache/node-gyp/x.h\0\0tail`),
    ]);
    fs.writeFileSync(p, blob);
    const before = fs.statSync(p).size;

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);

    const after = fs.readFileSync(p);
    assert.equal(after.length, before,
      'byte length MUST be preserved — every ELF offset/section size depends on it');
    assert.ok(!after.includes(lit), `the literal must be gone, still present in ${rel}`);
    // The surrounding structure must survive: this is a targeted overwrite, not a truncation.
    assert.ok(after.includes('/.cache/node-gyp/x.h'), 'the rest of the path must be intact');
    assert.ok(after.includes('tail'), 'bytes after the literal must be untouched');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// The sidecar copier HARDLINKS where the filesystem supports it (build-desktop-sidecar.sh
// has an explicit "FS without hardlink support" fallback), and the real sshcrypto.node in
// the sidecar carries 3 links. An in-place write would therefore reach through every one
// of them. Measured today the sidecar copy and the repo's own node_modules are different
// inodes, so the shared tree is not at risk — but that is a property of how the copier
// happens to run, not a guarantee, and it is not one to re-verify by hand each release.
test('scrub-binaries breaks hardlinks — a sibling link is NOT rewritten', () => {
  const lit = identityLiteral();
  const dir = tmp('hardlink');
  try {
    const p = path.join(dir, 'node_modules/pkg/build/Release/addon.node');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`\x7fELF\0\0${lit}/.cache/x.h\0tail`));
    const sibling = path.join(dir, 'sibling.node');
    fs.linkSync(p, sibling);          // outside the scrubbed root, same inode
    assert.equal(fs.statSync(p).nlink, 2, 'fixture must actually be hardlinked');

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);

    assert.ok(!fs.readFileSync(p).includes(lit), 'the scrubbed file must be clean');
    assert.ok(fs.readFileSync(sibling).includes(lit),
      'the sibling hardlink must be UNTOUCHED — an in-place write would have rewritten it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// CALIBRATION CONTROL: without this, a scrub that mangled every binary would satisfy
// the assertion above while destroying the bundle.
test('scrub-binaries leaves a CLEAN addon byte-identical', () => {
  const dir = tmp('clean');
  try {
    const p = path.join(dir, 'node_modules/pkg/build/Release/clean.node');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const blob = Buffer.from('\x7fELF\0\0nothing sensitive here\0/usr/include/node/x.h\0');
    fs.writeFileSync(p, blob);

    const r = audit('--scrub-binaries', path.join(dir, 'node_modules'));
    assert.equal(r.status, 0, `scrub-binaries failed:\n${r.stdout}${r.stderr}`);
    assert.ok(fs.readFileSync(p).equals(blob), 'a clean addon must not be rewritten at all');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── WI-37553: --scrub-app-binary (explicit packaged executable) ──────────────
// A THIRD scrub case, separate from --scrub-binaries: that one walks a tree by
// SCRUBBABLE_BINARY_SUFFIXES and would never match an extension-less packaged
// executable. This explicit-file form remains for the Windows release caller
// and other artifacts that need the same length-preserving identity scrub.
//
// The byte-length assertion is the load-bearing one: the scrub rewrites bytes
// inside an already-linked binary, so every Mach-O offset, section size and
// relocation stays valid ONLY because the placeholder is padded to the literal's
// exact length. A regression there would produce a corrupt, signable, shippable
// binary — which is exactly the failure no later gate would catch.
function highEntropyLiteral() {
  const r = spawnSync('python3', [AUDIT, '--identity-literals'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--identity-literals failed: ${r.stderr}`);
  for (const line of r.stdout.split('\n')) {
    const value = line.split('\t')[0];
    if (value && value.length > 12) return value;
  }
  throw new Error('no high-entropy identity literal available on this host');
}

test('--scrub-app-binary removes the literal and PRESERVES byte length exactly', () => {
  const lit = highEntropyLiteral();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi37553-app-'));
  try {
    // Extension-less, like a real .app executable, with NULs so it reads binary.
    const p = path.join(dir, 'papercusp-desktop');
    const blob = Buffer.concat([
      Buffer.from([0, 1, 2]), Buffer.from(`prefix${lit}/src-tauri suffix`), Buffer.from([0, 3]),
    ]);
    fs.writeFileSync(p, blob);
    const before = fs.statSync(p).size;

    const r = spawnSync('python3', [AUDIT, '--scrub-app-binary', p], { encoding: 'utf8' });
    assert.equal(r.status, 0, `scrub-app-binary failed:\n${r.stdout}${r.stderr}`);

    const after = fs.readFileSync(p);
    assert.equal(after.length, before, 'scrub MUST preserve byte length exactly');
    assert.equal(after.includes(lit), false, 'the identity literal must be gone');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--scrub-app-binary takes EXPLICIT files and never sweeps a directory', () => {
  const lit = highEntropyLiteral();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wi37553-scope-'));
  try {
    // A sibling carrying the SAME literal, not named on the command line. If this
    // is rewritten, the flag has quietly become a tree walk.
    const named = path.join(dir, 'papercusp-desktop');
    const bystander = path.join(dir, 'other-binary');
    const blob = Buffer.concat([Buffer.from([0, 1]), Buffer.from(`x${lit}y`), Buffer.from([0])]);
    fs.writeFileSync(named, blob);
    fs.writeFileSync(bystander, blob);

    const r = spawnSync('python3', [AUDIT, '--scrub-app-binary', named], { encoding: 'utf8' });
    assert.equal(r.status, 0, `scrub-app-binary failed:\n${r.stdout}${r.stderr}`);

    assert.equal(fs.readFileSync(named).includes(lit), false, 'the named file must be scrubbed');
    assert.ok(fs.readFileSync(bystander).equals(blob),
      'an unnamed sibling must be byte-identical — this flag must never walk a tree');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PROBE_SCRIPT lets scripts/mutation-probe.sh point these at a mutated COPY
// outside the tree, so falsifiability can be proven without ever mutating the
// shared working tree (a sweep would commit the mutant).
const MAC_CROSS = process.env.PROBE_SCRIPT || path.join(root, 'bin/build-mac-cross.sh');
const MAC_VM = path.join(root, 'bin/mac-vm-build.sh');
const MAC_XATTR_HELPER = path.join(root, 'bin/lib/strip-mac-signing-xattrs.py');

test('build-mac-cross resolves Cargo-installed tools from CARGO_HOME under a minimal manager PATH', () => {
  const dir = tmp('mac-cargo-home');
  const cargoHome = path.join(dir, 'cargo-home');
  const cargoBin = path.join(cargoHome, 'bin');
  const runtimeBin = path.join(dir, 'runtime-bin');
  const zigDir = path.join(dir, 'zig');
  const missingSdk = path.join(dir, 'missing-sdk');
  fs.mkdirSync(cargoBin, { recursive: true });
  fs.mkdirSync(runtimeBin);
  // The public-interface preflight requires Node before reaching Cargo/SDK.
  // Supply that runtime while keeping CARGO_HOME/bin absent from manager PATH.
  fs.symlinkSync(process.execPath, path.join(runtimeBin, 'node'));
  fs.mkdirSync(zigDir, { recursive: true });

  const executable = (file, body) => {
    fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(file, 0o755);
  };
  executable(path.join(cargoBin, 'cargo'), 'printf \'%s\\n\' \'{"target_directory":"/tmp/papercusp-test-target"}\'');
  executable(path.join(cargoBin, 'cargo-zigbuild'), 'exit 0');
  executable(path.join(zigDir, 'zig'), 'exit 0');

  try {
    const r = spawnSync('bash', [MAC_CROSS], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${runtimeBin}:/usr/bin:/bin`,
        HOME: dir,
        CARGO_HOME: cargoHome,
        PAPERCUSP_ZIG_DIR: zigDir,
        SDKROOT: missingSdk,
        PAPERCUSP_RELEASE_HOST: 'updates.invalid.test',
        PAPERCUSP_BUILD_SHA: 'deadbeef',
        PAPERCUSP_BUILD_VERSION: '0.0.0-test',
        // src-tauri/seed/ is gitignored: a clean checkout (the gate's) never has one, so
        // without an explicit opt-out the release seed guard stops this preflight before
        // it reaches Cargo. The fixture builds no installer.
        PAPERCUSP_ALLOW_SEEDLESS_RELEASE: '1',
        PAPERCUSP_ALLOW_SEEDLESS_REASON: 'test fixture: CARGO_HOME preflight only, no installer is produced (WI-10006055)',
      },
    });
    const output = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, output);
    assert.match(output, /macOS SDK not found/,
      'the preflight must advance past cargo-zigbuild and stop at the deliberately missing SDK');
    assert.doesNotMatch(output, /cargo-zigbuild not installed/,
      'CARGO_HOME\/bin must be visible even when the manager PATH omits it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-mac-cross Info.plist generator closes its Python heredoc before shell helpers', () => {
  const src = fs.readFileSync(MAC_CROSS, 'utf8');
  const fnStart = src.indexOf('gen_info_plist() {');
  const nextSection = src.indexOf('# ── env-sidecars/staging', fnStart);
  assert.ok(fnStart > 0 && nextSection > fnStart, 'gen_info_plist function boundaries must exist');
  const fn = src.slice(fnStart, nextSection);
  const pyStart = fn.indexOf("<<'PY'");
  const pyEnd = fn.indexOf('\nPY\n', pyStart);
  const shellHelper = src.indexOf('strip_mac_signing_xattrs() {');
  const absolutePyEnd = fnStart + pyEnd;

  assert.ok(pyStart > 0 && pyEnd > pyStart, 'gen_info_plist must have a closed Python heredoc');
  assert.ok(shellHelper > absolutePyEnd,
    'shell helper definitions must never be embedded inside gen_info_plist Python input');

  const dir = tmp('mac-plist-heredoc');
  const input = path.join(dir, 'Info.plist');
  const output = path.join(dir, 'Generated.plist');
  fs.writeFileSync(path.join(dir, 'tauri.conf.json'), JSON.stringify({
    bundle: { macOS: { minimumSystemVersion: '10.15' } },
  }));
  fs.writeFileSync(input, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict><key>NSMicrophoneUsageDescription</key><string>Synthetic fixture</string></dict></plist>',
  ].join('\n'));
  try {
    const r = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'VERSION=0.0.0-test',
      `SRC_TAURI=${JSON.stringify(dir)}`,
      `DARWIN_SIDECAR=${JSON.stringify(path.join(dir, 'sidecar'))}`,
      'PAPERCUSP_DARWIN_NATIVE_INPUTS=',
      fn,
      `gen_info_plist com.papercusp.synthetic 'Synthetic App' ${JSON.stringify(output)}`,
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const generated = fs.readFileSync(output, 'utf8');
    assert.match(generated, /com\.papercusp\.synthetic/);
    assert.match(generated, /Synthetic fixture/);
    assert.match(generated, /<key>LSMinimumSystemVersion<\/key>\s*<string>10\.15<\/string>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mac producers strip only signing-invalid xattrs and preserve required user.* metadata', () => {
  const dir = tmp('mac-xattrs');
  const file = path.join(dir, 'seed.bin');
  fs.writeFileSync(file, 'seed');
const setup = spawnSync('python3', ['-c', `
import os, subprocess, sys
p = sys.argv[1]
set_names = []
for name in ('com.apple.FinderInfo', 'user.com.apple.FinderInfo'):
    try:
        if hasattr(os, 'setxattr'):
            os.setxattr(p, name, b'finder')
        else:
            subprocess.run(['/usr/bin/xattr', '-w', name, 'finder', p], check=True, capture_output=True)
        set_names.append(name)
        break
    except (OSError, subprocess.CalledProcessError):
        pass
if not set_names:
    raise SystemExit('could not set a platform xattr fixture')
if hasattr(os, 'setxattr'):
    os.setxattr(p, 'user.device-file', b'keep')
else:
    subprocess.run(['/usr/bin/xattr', '-w', 'user.device-file', 'keep', p], check=True)
`, file], { encoding: 'utf8' });
  try {
    assert.equal(setup.status, 0, `could not create xattr fixture: ${setup.stderr}`);
    const dirty = spawnSync('python3', [MAC_XATTR_HELPER, '--check', dir], { encoding: 'utf8' });
    assert.equal(dirty.status, 1, `fixture must fail the strict metadata check: ${dirty.stderr}`);

    const scrub = spawnSync('python3', [MAC_XATTR_HELPER, dir], { encoding: 'utf8' });
    assert.equal(scrub.status, 0, `xattr scrub failed: ${scrub.stdout}${scrub.stderr}`);
    const clean = spawnSync('python3', [MAC_XATTR_HELPER, '--check', dir], { encoding: 'utf8' });
    assert.equal(clean.status, 0, `strict metadata check must pass after scrub: ${clean.stderr}`);

    const attrs = spawnSync('python3', ['-c', `
import os, subprocess, sys
if hasattr(os, 'listxattr'):
    print('\\n'.join(sorted(os.listxattr(sys.argv[1]))))
else:
    subprocess.run(['/usr/bin/xattr', sys.argv[1]], check=True)
`, file], { encoding: 'utf8' });
    assert.equal(attrs.status, 0, attrs.stderr);
    assert.match(attrs.stdout, /(?:^|\n)user\.device-file(?:\n|$)/,
      'required user.device-file xattr must survive');
    assert.doesNotMatch(attrs.stdout, /(?:^|\n)(?:com\.apple\.|user\.com\.apple\.)(?:FinderInfo|ResourceFork)(?:\n|$)/,
      'only signing-invalid Apple xattrs should be removed');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('build-mac-cross enables production codegen and scrubs metadata before signing', () => {
  const src = fs.readFileSync(MAC_CROSS, 'utf8');
  assert.ok(src.includes('cargo zigbuild --release --target "$arch" -p papercusp-desktop --features custom-protocol'),
    'release mac builds must enable Tauri custom-protocol so tauri_build uses production codegen (EI-200443)');
  const scrubAt = src.lastIndexOf('strip_mac_signing_xattrs "$app"');
  const checkAt = src.lastIndexOf('verify_mac_signing_xattrs "$app"');
  const signAt = src.indexOf('sign_app "$app"');
  assert.ok(scrubAt > 0 && scrubAt < signAt,
    'the assembled app must be scrubbed before rcodesign');
  assert.ok(checkAt > scrubAt && checkAt < signAt,
    'the cross-build must fail closed if signing-invalid xattrs remain');
  assert.doesNotMatch(src, /^\s*xattr\s+-cr\b/m,
    'the producer must not delete required user.* xattrs with blanket xattr -cr');
});

test('mac-vm-build cleans resource staging and runs strict codesign before publication', () => {
  const src = fs.readFileSync(MAC_VM, 'utf8');
  const buildAt = src.indexOf('npx tauri build');
  const verifyAt = src.indexOf('verify_mac_app_signature "$role_bundle_dir/macos/$role_label.app"');
  const identityScanAt = src.indexOf('--scan-dir "$role_bundle_dir/macos/$role_label.app"');
  assert.ok(src.includes('strip_mac_signing_xattrs "$_res_src"'),
    'mac VM builds must clean source resources before Tauri creates fresh staging');
  assert.ok(src.includes('strip_mac_signing_xattrs "$_res_dst"'),
    'mac VM builds must clean persistent per-role staging resources');
  assert.ok(buildAt > 0 && verifyAt > buildAt && verifyAt < identityScanAt,
    'strict codesign verification must run after Tauri builds the app and before later publication gates');
  assert.ok(src.includes('codesign --verify --deep --strict "$app"'),
    'the native mac leg must use the strict codesign verifier');
  assert.doesNotMatch(src, /^\s*xattr\s+-cr\b/m,
    'the producer must not delete required user.* xattrs with blanket xattr -cr');
});

test('build-mac-cross fails fast: the binary is scanned right after lipo', () => {
  // WHY THIS EXISTS: the authoritative assembled-bytes gate runs AFTER assemble_app
  // copies a ~2.4GB sidecar per role. Measured on the 0.0.14 cut that is ~58min into a
  // ~75min mac leg, and the mac leg is ~96% of the whole release's wall clock. Two
  // attempts died there, each burning a full mac build to learn something the binary
  // already knew. So the binary gets scanned IN ISOLATION straight after lipo. This
  // test pins that the early gate exists AND still precedes assembly —
  // an early gate that drifted after assemble_app would be pure cost and no benefit.
  const src = fs.readFileSync(MAC_CROSS, 'utf8');

  const lipoAt = src.indexOf('-create');                      // llvm-lipo fuses the arches
  const earlyScanAt = src.indexOf('--scan-dir "$_early_scan"');
  const assembleAt = src.indexOf('assemble_app "$app_id"');
  const fullScanAt = src.indexOf('--scan-dir "$app"');

  assert.ok(earlyScanAt > -1, 'the universal binary must be identity-scanned right after lipo');
  assert.ok(earlyScanAt < assembleAt,
    'THE POINT: the early scan must precede assemble_app — after it, the 2.4GB/role sidecar copies are already paid');
  // The authoritative gate is NOT replaced by the cheap one.
  assert.ok(fullScanAt > assembleAt,
    'the assembled-bytes scan must still run after assembly — the early scan supplements it, never replaces it');
});

function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  yield [dir, entries.filter((e) => e.isDirectory()).map((e) => e.name),
         entries.filter((e) => e.isFile()).map((e) => e.name)];
  for (const e of entries) if (e.isDirectory()) yield* walk(path.join(dir, e.name));
}

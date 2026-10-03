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
const { collectImports } = require('../bin/lib/runtime-import-census.cjs');

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
    'PAPERCUSP_VM_TRUST_REVISION="2026-09-19-r1"',
    'PAPERCUSP_VM_NODE_VERSION="v24.18.1"',
    'license": "MIT"',
    'd6c664df3f3f61458e8c277585571328522d705166723a7c7823a9253a4d15a0',
    'PAPERCUSP_VM_GO_VERSION="1.26.6"',
    'license": "BSD-3-Clause"',
    '708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89',
    'PAPERCUSP_VM_GH_VERSION="2.98.0"',
    'a255baf71d13fe5947a4eb7ad521ffd412d64cee',
    // GO-2026-6354 and GO-2026-6355 affect x/crypto before v0.56.0. gh used to
    // inherit v0.55.0 through x/net, so this must remain an explicit pin rather
    // than an accidental MVS result.
    'PAPERCUSP_VM_GH_X_CRYPTO_VERSION="v0.56.0"',
    'PAPERCUSP_VM_GH_X_MOD_VERSION="v0.40.0"',
    'PAPERCUSP_VM_KOPIA_VERSION="0.23.1"',
    '72ec08fd8edb86c67ed27099bf1b955e1f308ffa',
    'license": "Apache-2.0"',
    // These three stay compatible as x/crypto moves to v0.56.0 for GO-2026-6354/6355:
    // it requires x/net >= v0.57.0 (v0.58.0 already pinned) and x/text v0.41.0.
    // See the co-pin comments in bin/lib/vm-release-trust-toolchain.sh.
    'PAPERCUSP_VM_KOPIA_X_CRYPTO_VERSION="v0.56.0"',
    'PAPERCUSP_VM_KOPIA_X_MOD_VERSION="v0.40.0"',
    'PAPERCUSP_VM_KOPIA_X_NET_VERSION="v0.58.0"',
    'PAPERCUSP_VM_KOPIA_X_TEXT_VERSION="v0.41.0"',
    // GHSA-2v4p-qf9q-27wj affects both previously pinned v1.83.1 binaries.
    // The patched v1.83.2 requires x/net v0.58.0, already pinned above.
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

function runFakeVulnerabilityAudit({ matches = [], dbValid = true, report = null } = {}) {
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
fs.writeFileSync(target.slice('cyclonedx-json='.length), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.7', components: [] }));
`);
  writeExecutable(path.join(tools, 'grype'), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'version') {
  process.stdout.write(JSON.stringify({ application: 'grype', version: '0.117.0-test' }));
  process.exit(0);
}
if (args[0] === 'db' && args[1] === 'status') {
  process.stdout.write(JSON.stringify({
    schemaVersion: 'test-v1',
    built: process.env.FAKE_GRYPE_DB_BUILT,
    valid: process.env.FAKE_GRYPE_DB_VALID === 'true',
  }));
  process.exit(0);
}
process.stdout.write(process.env.FAKE_GRYPE_REPORT);
`);

  const env = {
    ...VM_RELEASE_ENV,
    PATH: `${tools}${path.delimiter}${process.env.PATH}`,
    FAKE_GRYPE_DB_BUILT: new Date().toISOString(),
    FAKE_GRYPE_DB_VALID: String(dbValid),
    FAKE_GRYPE_REPORT: JSON.stringify(report ?? { matches }),
  };
  const result = spawnSync(
    'python3',
    [AUDIT, '--audit-vulnerabilities', sidecar, evidence],
    { encoding: 'utf8', env },
  );
  return { dir, sidecar, evidence, result };
}

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

function runBuilderOwnerPreflight({ audit, owner, advance = false }) {
  const dir = tmp('owner-preflight');
  const env = {
    ...process.env,
    PAPERCUSP_RELEASE_AUDIT: audit,
    // The rejecting cases use a missing repo to prove they stop before the first
    // runtime-pin read. Allowed cases use the real pin, then stop safely at the
    // deliberately absent Papercusp dependency before any build operation.
    REPO_ROOT: advance ? path.resolve(root, '..') : path.join(dir, 'missing-repo'),
    PAPERCUSP_ROOT: path.join(dir, 'missing-papercusp'),
  };
  delete env.PAPERCUSP_RELEASE_OWNER_NAME;
  delete env.PROVENANCE_SOURCE_GIT_HEAD;
  delete env.PROVENANCE_SOURCE_GIT_DIRTY;
  if (advance) {
    // EI-21809903601430402 — HERMETICITY, not a product change. This case is about the OWNER-NAME
    // guard, but the advancing audit=1 input has to cross the clean-source-tree guard
    // (bin/build-desktop-sidecar.sh, "requires a clean source tree at cut start") to reach the
    // deliberately-absent Papercusp dependency it asserts on. That guard reads the source
    // provenance captured from REPO_ROOT — which here is the SHARED fleet checkout, where
    // gitDirty is essentially always true — so without this the case could never pass on a
    // developer or CI checkout that has any uncommitted file, and a red here said nothing about
    // the guard under test. The script documents the seam this uses (same file, "A release
    // orchestrator that already captured the phase boundary supplies both seams, and remains
    // authoritative"): supplying the PAIR pins the source state instead of shelling out to git.
    // Supplied for advance-only inputs, so the rejecting cases still prove they stop before any
    // filesystem work. The clean-tree guard itself keeps its own coverage in
    // test/provenance-sidecar-record.test.js.
    env.PROVENANCE_SOURCE_GIT_HEAD = '0'.repeat(40);
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

function runBuilderVmReleaseIdentityPreflight({ sha, version, advance = false }) {
  const dir = tmp('vm-release-identity-preflight');
  const env = {
    ...process.env,
    PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release',
    PAPERCUSP_RELEASE_AUDIT: '0',
    // Rejecting cases use a missing repo to prove identity fails before the
    // first runtime-pin read. The admitted case advances safely to the missing
    // Papercusp dependency without starting a build.
    REPO_ROOT: advance ? path.resolve(root, '..') : path.join(dir, 'missing-repo'),
    PAPERCUSP_ROOT: path.join(dir, 'missing-papercusp'),
  };
  delete env.PAPERCUSP_BUILD_SHA;
  delete env.PAPERCUSP_DESKTOP_VERSION;
  if (advance) {
    // EI-21832562420831737: vm-release now also refuses a source tree that was DIRTY at the
    // phase boundary, and the advancing case points REPO_ROOT at the SHARED fleet checkout,
    // where uncommitted files are essentially always present — so without this the case
    // could never pass on a developer or CI checkout and a red here would say nothing about
    // the identity preflight under test. Same seam, and same reasoning, as the owner
    // preflight above: supplying the PAIR pins the source state instead of shelling out to
    // git, and a release orchestrator that captured the boundary itself remains
    // authoritative. Supplied for advance-only inputs, so the rejecting cases still prove
    // they stop at the identity gate before any filesystem work. The clean-source guard
    // keeps its own coverage in packages/operator-core/lib/sidecar-source-root-coherence.test.ts.
    env.PROVENANCE_SOURCE_GIT_HEAD = '0'.repeat(40);
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

test('D-150 producer removes vendor private-key fixtures from sidecar and source archive, preserving runtime neighbours', () => {
  const dir = tmp('vendor-key-prune');
  const fixtures = [
    'node_modules/ssh2/test/fixtures/https_key.pem',
    'node_modules/style-dictionary/examples/advanced/create-react-native-app/android/app/debug.keystore',
  ];
  const retained = [
    'node_modules/ssh2/lib/client.js',
    'node_modules/ssh2/test/fixtures/https_cert.pem',
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
      '-cf', archive, '-C', dir, './node_modules',
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
  const zigDir = path.join(dir, 'zig');
  const missingSdk = path.join(dir, 'missing-sdk');
  fs.mkdirSync(cargoBin, { recursive: true });
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
        PATH: '/usr/bin:/bin',
        HOME: dir,
        CARGO_HOME: cargoHome,
        PAPERCUSP_ZIG_DIR: zigDir,
        SDKROOT: missingSdk,
        PAPERCUSP_RELEASE_HOST: 'updates.invalid.test',
        PAPERCUSP_BUILD_SHA: 'deadbeef',
        PAPERCUSP_BUILD_VERSION: '0.0.0-test',
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
      fn,
      `gen_info_plist com.papercusp.synthetic 'Synthetic App' ${JSON.stringify(output)}`,
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    const generated = fs.readFileSync(output, 'utf8');
    assert.match(generated, /com\.papercusp\.synthetic/);
    assert.match(generated, /Synthetic fixture/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mac producers strip only signing-invalid xattrs and preserve required user.* metadata', () => {
  const dir = tmp('mac-xattrs');
  const file = path.join(dir, 'seed.bin');
  fs.writeFileSync(file, 'seed');
  const setup = spawnSync('python3', ['-c', `
import os, sys
p = sys.argv[1]
set_names = []
for name in ('com.apple.FinderInfo', 'user.com.apple.FinderInfo'):
    try:
        os.setxattr(p, name, b'finder')
        set_names.append(name)
        break
    except OSError:
        pass
if not set_names:
    raise SystemExit('could not set a platform xattr fixture')
os.setxattr(p, 'user.device-file', b'keep')
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
import os, sys
print('\\n'.join(sorted(os.listxattr(sys.argv[1]))))
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

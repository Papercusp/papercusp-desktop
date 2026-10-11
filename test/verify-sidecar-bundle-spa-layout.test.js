// WI-10004073 — verify-sidecar-bundle.sh must refuse an SPA whose ONNX runtime is
// not at the served top level.
//
// WHY THIS TEST EXISTS
// The SPA loads the onnxruntime-web backends from /wake-runtime/ and
// /vad-runtime/ (its `wasmPaths`), so the four ort-wasm-simd-threaded.* files must
// sit DIRECTLY inside spa/wake-runtime/ and spa/vad-runtime/.
//
// A release checkout provisioned onto a different filesystem from the
// integration tree (/mnt/data vs /) broke that. setup-release-checkout.sh step 3b
// ran `cp -al SRC DST || cp -a SRC DST`; the hardlink copy fails with EXDEV only
// AFTER creating DST, so the `cp -a` fallback copied INTO it and produced
// spa/wake-runtime/wake-runtime/…, spa/vad-runtime/vad-runtime/…, and extra
// spa/vditor/vditor + spa/porcupine/porcupine copies. The sidecar build finished
// with exit 0, and both verify-sidecar-bundle and the release identity audit
// passed that bundle, even though /wake-runtime/ort-wasm-*.wasm would 404.
//
// check_spa_runtime_layout is the detector that was missing. This test runs the
// REAL function text out of the script (not a copy), under the script's own
// shell flags, against synthetic spa trees — including the exact layout the bug
// produced — and pins that the function is wired into the script's FAIL verdict.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');

const scriptPath = path.resolve(__dirname, '../bin/verify-sidecar-bundle.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

/** Pull a top-level shell function verbatim out of the real verify script. */
function extractFunction(name, source = script) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `${name}() not found in verify-sidecar-bundle.sh`);
  let heredoc = null;
  let end = -1;
  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index];
    if (heredoc) {
      if ((heredoc.stripTabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) heredoc = null;
      continue;
    }
    if (line === '}') { end = index; break; }
    const marker = line.match(/<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/);
    if (marker) heredoc = { delimiter: marker[3], stripTabs: marker[1] === '-' };
  }
  assert.ok(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const CHECK_SPA_RUNTIME_LAYOUT = extractFunction('check_spa_runtime_layout');
const CHECK_BOOT_IMPORT_CLOSURE = extractFunction('check_boot_import_closure');
const WRITE_VERIFICATION_RECEIPT = extractFunction('write_verification_receipt');
const INVENTORY_HELPER = path.resolve(__dirname, '../bin/lib/server-container.mjs');

function elfHeader(arch) {
  const header = Buffer.alloc(20);
  header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
  header.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
  return header;
}

// Execute the real Linux linkage branch. Only objdump's external observation is
// a fixture: target policy, bundle resolution and the FAIL verdict stay real.
const linkageStart = script.indexOf('# ── [3] linkage closure');
const linkageEnd = script.indexOf('# ── [4]', linkageStart);
assert.ok(linkageStart >= 0 && linkageEnd > linkageStart);
const CHECK_LINKAGE = script.slice(linkageStart, linkageEnd);
const IS_ELF = script.split('\n').find(line => line.startsWith('_is_elf()'));
assert.ok(IS_ELF);

function runLinkageCheck(arch, needed, bundled = [], extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-linkage-'));
  try {
    const bin = path.join(dir, 'bin');
    fs.mkdirSync(path.join(bin, '.pg-real/lib'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'node'), elfHeader(arch));
    for (const { rel, bytes = elfHeader(arch), link } of extra) {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (link) fs.symlinkSync(link, file);
      else fs.writeFileSync(file, bytes, { mode: 0o644 });
    }
    for (const name of bundled) fs.writeFileSync(path.join(bin, '.pg-real/lib', name), 'bundled dependency');
    return spawnSync('bash', ['-c', 'set -uo pipefail\nFAIL=0\n' +
      'fail() { printf "%s\\n" "$*"; FAIL=1; }; ok() { printf "%s\\n" "$*"; };\n' +
      'objdump() { printf "%s\\n" "$FIXTURE_NEEDED"; };\n' +
      IS_ELF + '\n' + CHECK_LINKAGE + '\nexit "$FAIL"'], {
      encoding: 'utf8', env: { ...process.env, OS: 'Linux', BIN: bin, SIDECAR: dir,
        TARGET_ARCH_N: arch, _elf_inventory_tool: INVENTORY_HELPER,
        FIXTURE_NEEDED: needed.map(name => 'NEEDED ' + name).join('\n') },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('Linux linkage closure admits the matching ARM64 and AMD64 base loaders', () => {
  for (const [arch, loader] of [['arm64', 'ld-linux-aarch64.so.1'], ['x64', 'ld-linux-x86-64.so.2']]) {
    const result = runLinkageCheck(arch, [loader, 'libc.so.6']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /all 1 bundled ELFs close over bundle libs \+ base allowlist/);
  }
});

test('Linux linkage closure refuses foreign and unknown loaders', () => {
  for (const [arch, foreign] of [['arm64', 'ld-linux-x86-64.so.2'], ['x64', 'ld-linux-aarch64.so.1']]) {
    for (const loader of [foreign, 'ld-linux-riscv64-lp64d.so.1']) {
      const result = runLinkageCheck(arch, [loader]);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.ok(result.stdout.includes('node needs ' + loader));
      assert.match(result.stdout, /host-masked dependency/);
    }
  }
});

test('Linux linkage closure still requires non-base dependencies inside the bundle', () => {
  for (const arch of ['arm64', 'x64']) {
    const missing = runLinkageCheck(arch, ['libprivate.so.1']);
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /node needs libprivate\.so\.1/);
    const present = runLinkageCheck(arch, ['libprivate.so.1'], ['libprivate.so.1']);
    assert.equal(present.status, 0, present.stdout + present.stderr);
    assert.match(present.stdout, /all 1 bundled ELFs close/);
  }
});

test('Linux linkage closure refuses an unsupported target architecture', () => {
  const result = runLinkageCheck('riscv64', ['libc.so.6']);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /unsupported Linux target architecture/);
});

test('complete Linux ELF inventory rejects foreign extensionless payloads at arbitrary depths', () => {
  for (const arch of ['arm64', 'x64']) {
    for (const rel of ['node_modules/odiff-bin/platform-linux/bin/odiff',
      'nested runtime/deep/vendor/private-tool']) {
      const passing = runLinkageCheck(arch, ['libc.so.6'], [], [{rel}]);
      assert.equal(passing.status, 0, passing.stdout + passing.stderr);
      assert.match(passing.stdout, /all 2 bundled ELFs close/);
      const foreign = runLinkageCheck(arch, [], [],
        [{rel, bytes: elfHeader(arch === 'arm64' ? 'x64' : 'arm64')}]);
      assert.equal(foreign.status, 1, foreign.stdout + foreign.stderr);
      assert.ok(foreign.stderr.includes(rel));
      assert.match(foreign.stderr, /Native payload architecture mismatch/);
    }
  }
});

test('complete Linux ELF inventory rejects malformed headers and escaping links', () => {
  const wrongClass = elfHeader('arm64'); wrongClass[4] = 1;
  const wrongEndian = elfHeader('arm64'); wrongEndian[5] = 2;
  for (const bytes of [Buffer.from([127, 69, 76, 70]), wrongClass, wrongEndian]) {
    const result = runLinkageCheck('arm64', [], [], [{rel: 'deep/file.bin', bytes}]);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /architecture mismatch/);
  }
  const link = runLinkageCheck('arm64', [], [], [{rel: 'node_modules/vendor/link', link: '/bin/sh'}]);
  assert.equal(link.status, 1, link.stdout + link.stderr);
  assert.match(link.stderr, /link escapes its payload/);
  const contained = runLinkageCheck('arm64', [], [], [{rel: 'deep/node-link', link: '../bin/node'}]);
  assert.equal(contained.status, 0, contained.stdout + contained.stderr);
  assert.match(contained.stdout, /all 2 bundled ELFs close/);
});

function runAddonLinkageCheck({ bundled = false, runpath = '' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-addon-linkage-'));
  try {
    const bin = path.join(dir, 'bin');
    const addonDir = path.join(dir, 'node_modules/package with spaces/prebuilds/linux-arm64');
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(addonDir, { recursive: true });
    const elf = elfHeader('arm64');
    fs.writeFileSync(path.join(bin, 'node'), elf);
    fs.writeFileSync(path.join(addonDir, 'fixture.node'), elf);
    if (bundled) fs.writeFileSync(path.join(addonDir, 'libatomic.so.1'), elf);
    return spawnSync('bash', ['-c', 'set -uo pipefail\nFAIL=0\n' +
      'fail() { printf "%s\\n" "$*"; FAIL=1; }; ok() { printf "%s\\n" "$*"; };\n' +
      'objdump() { case "$2" in *.node) printf "NEEDED libatomic.so.1\\n"; ' +
      'if [[ -n "$FIXTURE_RUNPATH" ]]; then printf "RUNPATH %s\\n" "$FIXTURE_RUNPATH"; fi ;; ' +
      '*) printf "NEEDED libc.so.6\\n" ;; esac; };\n' +
      IS_ELF + '\n' + CHECK_LINKAGE + '\nexit "$FAIL"'], {
      encoding: 'utf8', env: { ...process.env, OS: 'Linux', BIN: bin, SIDECAR: dir,
        TARGET_ARCH_N: 'arm64', _elf_inventory_tool: INVENTORY_HELPER, FIXTURE_RUNPATH: runpath },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('Linux linkage closure catches a host-masked native addon dependency', () => {
  const result = runAddonLinkageCheck();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /fixture\.node needs libatomic\.so\.1/);
});

test('native addon libraries must be reachable through the packaged ELF runpath', () => {
  const unreachable = runAddonLinkageCheck({ bundled: true });
  assert.equal(unreachable.status, 1, unreachable.stdout + unreachable.stderr);
  const reachable = runAddonLinkageCheck({ bundled: true, runpath: '$ORIGIN' });
  assert.equal(reachable.status, 0, reachable.stdout + reachable.stderr);
  assert.match(reachable.stdout, /all 3 bundled ELFs close/);
});

test('native addon linkage refuses an external library search path', () => {
  const result = runAddonLinkageCheck({ bundled: true, runpath: '/usr/lib' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /fixture\.node needs libatomic\.so\.1/);
});

for (const suffix of ['.node', '.bare', '']) {
test(`producer vendors ${suffix || 'extensionless'} ELF library that loads after relocation without the factory library path`, { skip: process.platform !== 'linux' }, () => {
  const builder = fs.readFileSync(path.resolve(__dirname, '../bin/build-desktop-sidecar.sh'), 'utf8');
  const bundleLibraries = extractFunction('bundle_linux_addon_libraries', builder);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-addon-vendor-'));
  try {
    const factory = path.join(dir, 'factory');
    const side = path.join(dir, 'sidecar with spaces');
    const addonDir = path.join(side, 'node_modules/fixture/prebuilds/linux-x64');
    fs.mkdirSync(factory, { recursive: true });
    fs.mkdirSync(addonDir, { recursive: true });
    const librarySource = path.join(factory, 'atomic.c');
    const addonSource = path.join(factory, 'addon.c');
    const library = path.join(factory, 'libatomic.so.1');
    const addon = path.join(addonDir, 'fixture' + suffix);
    fs.writeFileSync(librarySource, 'int atomic_fixture(void) { return 73; }\n');
    fs.writeFileSync(addonSource, 'extern int atomic_fixture(void); int addon_value(void) { return atomic_fixture(); }\n');
    for (const args of [
      ['-shared', '-fPIC', '-Wl,-soname,libatomic.so.1', librarySource, '-o', library],
      ['-shared', '-fPIC', addonSource, '-L' + factory, '-l:libatomic.so.1', '-o', addon],
    ]) {
      const result = spawnSync('cc', args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + bundleLibraries +
      '\nbundle_linux_addon_libraries "$1"', 'vendor', side], {
      encoding: 'utf8', env: { ...process.env, TARGET_OS: 'linux',
        TARGET_ARCH: process.arch, HERE: path.resolve(__dirname, '../bin'), LD_LIBRARY_PATH: factory },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const moved = path.join(dir, 'relocated');
    fs.renameSync(side, moved);
    fs.rmSync(factory, { recursive: true });
    const movedAddon = path.join(moved, path.relative(side, addon));
    const env = { ...process.env };
    delete env.LD_LIBRARY_PATH;
    const probe = () => spawnSync('python3', ['-c',
      'import ctypes,sys; print(ctypes.CDLL(sys.argv[1]).addon_value())', movedAddon], { encoding: 'utf8', env });
    const loaded = probe();
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
    assert.equal(loaded.stdout.trim(), '73');
    fs.rmSync(path.join(moved, 'bin/.pg-real/lib/libatomic.so.1'));
    assert.notEqual(probe().status, 0, 'negative control must require the packaged library');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
}

test('producer relocates PGXS consumers to the bundled libpq and preserves their executable behavior', { skip: process.platform !== 'linux' }, () => {
  const builder = fs.readFileSync(path.resolve(__dirname, '../bin/build-desktop-sidecar.sh'), 'utf8');
  const bundleLibraries = extractFunction('bundle_linux_addon_libraries', builder);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-pgxs-relocation-'));
  try {
    const side = path.join(dir, 'sidecar with spaces');
    const native = path.join(side, 'node_modules/@papercusp/embedded-postgres-server/node_modules/@embedded-postgres/linux-' + process.arch, 'native');
    const libraryDir = path.join(native, 'lib');
    const toolDir = path.join(libraryDir, 'postgresql/pgxs/src/test/regress');
    fs.mkdirSync(toolDir, {recursive: true});
    const librarySource = path.join(dir, 'pq.c');
    const toolSource = path.join(dir, 'regress.c');
    const library = path.join(libraryDir, 'libpq.so.5');
    const tool = path.join(toolDir, 'pg_regress');
    fs.writeFileSync(librarySource, 'int fixture_pg_value(void) { return 47; }\n');
    fs.writeFileSync(toolSource, '#include <stdio.h>\nextern int fixture_pg_value(void); int main(void) { printf("%d\\n", fixture_pg_value()); return 0; }\n');
    for (const args of [
      ['-shared', '-fPIC', '-Wl,-soname,libpq.so.5', librarySource, '-o', library],
      [toolSource, '-L' + libraryDir, '-l:libpq.so.5', '-Wl,-rpath,/usr/local/pg-build/lib', '-o', tool],
    ]) {
      const result = spawnSync('cc', args, {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const env = {...process.env}; delete env.LD_LIBRARY_PATH;
    assert.notEqual(spawnSync(tool, [], {encoding: 'utf8', env}).status, 0,
      'the original build-host RUNPATH must fail without its compiler prefix');
    const result = spawnSync('bash', ['-c', 'set -euo pipefail\n' + bundleLibraries +
      '\nbundle_linux_addon_libraries "$1"', 'vendor', side], {
      encoding: 'utf8', env: {...env, TARGET_OS: 'linux', TARGET_ARCH: process.arch,
        HERE: path.resolve(__dirname, '../bin')},
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const moved = path.join(dir, 'relocated'); fs.renameSync(side, moved);
    const movedTool = path.join(moved, path.relative(side, tool));
    const probe = () => spawnSync(movedTool, [], {encoding: 'utf8', env});
    const loaded = probe();
    assert.equal(loaded.status, 0, loaded.stdout + loaded.stderr);
    assert.equal(loaded.stdout.trim(), '47');
    const runpath = spawnSync('patchelf', ['--print-rpath', movedTool], {encoding: 'utf8'});
    assert.match(runpath.stdout, /\$ORIGIN/);
    assert.ok(!runpath.stdout.includes('/usr/local/pg-build'));
    fs.rmSync(path.join(moved, path.relative(side, library)));
    assert.notEqual(probe().status, 0, 'negative control must require the packaged libpq');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('native addon assembly refuses missing inspection and relocation tools', { skip: process.platform !== 'linux' }, () => {
  const builder = fs.readFileSync(path.resolve(__dirname, '../bin/build-desktop-sidecar.sh'), 'utf8');
  const bundleLibraries = extractFunction('bundle_linux_addon_libraries', builder);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-addon-tools-'));
  try {
    for (const missing of ['objdump', 'ldd', 'file', 'patchelf']) {
      const shims = path.join(dir, missing);
      fs.mkdirSync(shims);
      for (const tool of ['objdump', 'ldd', 'file', 'patchelf']) {
        if (tool !== missing) fs.writeFileSync(path.join(shims, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }
      const result = spawnSync('/bin/bash', ['-c', 'set -euo pipefail\n' + bundleLibraries +
        '\nbundle_linux_addon_libraries "$1"', 'vendor', dir], {
        encoding: 'utf8', env: { ...process.env, PATH: shims, TARGET_OS: 'linux', TARGET_ARCH: process.arch },
      });
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, new RegExp('requires ' + missing));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const hashFile = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('real verifier emits an executable-bound failure receipt on an incomplete bundle', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-receipt-'));
  try {
    const receipt = path.join(dir, 'result.json');
    const result = spawnSync('bash', [scriptPath, path.join(dir, 'absent'), '--receipt', receipt], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    const body = JSON.parse(fs.readFileSync(receipt));
    assert.equal(body.verifier.path, scriptPath);
    assert.equal(body.verifier.sha256, hashFile(scriptPath));
    assert.equal(body.exitCode, 2);
    assert.equal(body.verdict, 'fail');
    assert.equal(body.onTargetNativeLoadVerified, false);
    assert.equal(body.bootImportClosureVerified, false);
    assert.equal(body.candidateAccepted, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('machine receipt independently binds the verifier and selected manifest writer and rejects changed bytes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-receipt-inputs-'));
  try {
    const executable = path.join(dir, 'verifier.sh');
    const helper = path.join(dir, 'manifest writer.py');
    const inventory = path.join(dir, 'inventory.mjs');
    const receipt = path.join(dir, 'result.json');
    fs.writeFileSync(executable, 'executable verifier fixture');
    fs.writeFileSync(helper, 'manifest helper fixture');
    fs.writeFileSync(inventory, 'ELF inventory fixture');
    const verifierSha = hashFile(executable);
    const helperSha = hashFile(helper);
    const inventorySha = hashFile(inventory);
    const run = (status, cross = '1') => {
      const result = spawnSync('bash', ['-c', `set -uo pipefail\n${WRITE_VERIFICATION_RECEIPT}\n` +
        'RECEIPT="$1"; _receipt_verifier="$2"; _receipt_verifier_sha="$3"\n' +
        '_pui_manifest_tool="$4"; _pui_manifest_tool_sha="$5"; SIDECAR=fixture\n' +
        '_elf_inventory_tool="$8"; _elf_inventory_tool_sha="$9"\n' +
        'TARGET_OS_N=darwin; TARGET_ARCH_N=x64; CROSS="$7"\n' +
        '_receipt_command=(bash "$2" fixture); write_verification_receipt "$6"',
        'receipt', receipt, executable, verifierSha, helper, helperSha, String(status), cross,
        inventory, inventorySha], { encoding: 'utf8' });
      return { result, body: JSON.parse(fs.readFileSync(receipt)) };
    };
    const passing = run(0);
    assert.equal(passing.result.status, 0, passing.result.stderr);
    assert.equal(passing.body.verifier.sha256, verifierSha);
    assert.equal(passing.body.helpers[0].sha256, helperSha);
    assert.equal(passing.body.helpers[1].role, 'elf-inventory');
    assert.equal(passing.body.helpers[1].sha256, inventorySha);
    assert.notEqual(passing.body.verifier.sha256, passing.body.helpers[0].sha256);
    assert.equal(passing.body.qualification, 'static-cross');
    assert.equal(passing.body.onTargetNativeLoadVerified, false);
    assert.equal(passing.body.bootImportClosureVerified, false);
    const refused = run(1, '0');
    assert.equal(refused.body.exitCode, 1);
    assert.equal(refused.body.verdict, 'fail');
    assert.equal(refused.body.onTargetNativeLoadVerified, false);
    fs.appendFileSync(inventory, ' changed');
    const changedInventory = run(0);
    assert.equal(changedInventory.result.status, 1);
    assert.equal(changedInventory.body.sourceHashesStable, false);
    assert.equal(changedInventory.body.verdict, 'fail');
    fs.writeFileSync(inventory, 'ELF inventory fixture');
    fs.appendFileSync(helper, ' changed');
    const changedHelper = run(0);
    assert.equal(changedHelper.result.status, 1);
    assert.equal(changedHelper.body.sourceHashesStable, false);
    assert.equal(changedHelper.body.verdict, 'fail');
    fs.writeFileSync(helper, 'manifest helper fixture');
    fs.appendFileSync(executable, ' changed');
    const changedVerifier = run(0);
    assert.equal(changedVerifier.result.status, 1);
    assert.equal(changedVerifier.body.sourceHashesStable, false);
    assert.equal(changedVerifier.body.verdict, 'fail');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// EI-25314848971418539: execute the real source lookup and protocol derivation,
// with distinct protocol versions beside the tooling and selected product.
const rootLookupStart = script.indexOf('_verify_here=');
const rootLookupEnd = script.indexOf('\n_pui_manifest_tool=', rootLookupStart);
const protocolLookupStart = script.indexOf('_ri_repo=');
const protocolLookupEnd = script.indexOf('if [[ ! -f "$_ri" ]]; then', protocolLookupStart);
assert.ok(rootLookupStart >= 0 && rootLookupEnd > rootLookupStart);
assert.ok(protocolLookupStart > rootLookupEnd && protocolLookupEnd > protocolLookupStart);
const PROTOCOL_LOOKUP = script.slice(rootLookupStart, rootLookupEnd) + '\n' + script.slice(protocolLookupStart, protocolLookupEnd);

function runProtocolLookup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-verifier-source-'));
  try {
    const tooling = path.join(dir, 'tooling');
    const product = path.join(dir, 'product');
    const verifier = path.join(tooling, 'papercusp-desktop/bin/verify-sidecar-bundle.sh');
    const helper = path.join(path.dirname(verifier), 'lib/source-roots.sh');
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../bin/lib/source-roots.sh'), helper);
    for (const [root, version] of [[tooling, 'v111'], [product, 'v987']]) {
      const source = path.join(root, 'libs/generic/deployment-driver/src/workspace-host-remote-initializer.ts');
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, `export const WORKSPACE_HOST_REMOTE_INITIALIZER_PROTOCOL_VERSION =\n  'papercusp-gcp-iap-initialization-${version}';\n`);
    }
    fs.mkdirSync(path.join(product, 'papercusp-desktop'));
    const env = { ...process.env, REPO_ROOT: '', PAPERCUSP_DESKTOP_TARGET_ROOT: '' };
    if (overrides.repo) env.REPO_ROOT = overrides.repo === 'missing' ? path.join(dir, 'absent') : product;
    if (overrides.desktop) env.PAPERCUSP_DESKTOP_TARGET_ROOT = path.join(product, 'papercusp-desktop');
    const result = spawnSync('bash', ['-c', `set -uo pipefail\nFAIL=0\nfail() { echo "$*" >&2; FAIL=1; }\n${PROTOCOL_LOOKUP}\nprintf '%s\\n' "$_ri_ver"\nexit "$FAIL"`, verifier], { encoding: 'utf8', env });
    return { status: result.status, out: result.stdout, err: result.stderr };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('verifier preserves the adjacent product source default', () => {
  const result = runProtocolLookup();
  assert.equal(result.status, 0, result.err);
  assert.equal(result.out.trim(), 'papercusp-gcp-iap-initialization-v111');
});

test('verifier derives the protocol from REPO_ROOT instead of the tooling checkout', () => {
  const result = runProtocolLookup({ repo: true });
  assert.equal(result.status, 0, result.err);
  assert.equal(result.out.trim(), 'papercusp-gcp-iap-initialization-v987');
});

test('verifier honors a separate desktop target when REPO_ROOT is absent', () => {
  const result = runProtocolLookup({ desktop: true });
  assert.equal(result.status, 0, result.err);
  assert.equal(result.out.trim(), 'papercusp-gcp-iap-initialization-v987');
});

test('a missing selected source refuses instead of falling back to tooling protocol', () => {
  const result = runProtocolLookup({ repo: 'missing', desktop: true });
  assert.equal(result.status, 1);
  assert.match(result.err, /refusing a vacuous content assertion/);
  assert.equal(result.out.trim(), '__UNDERIVABLE_INITIALIZER_PROTOCOL_VERSION__');
});

function runBootCheck(body, envOverrides = {}, setup = () => {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-boot-closure-'));
  const dir = path.join(scratch, 'sidecar');
  const nativeContract = script.match(/REQUIRED_NATIVE_MODULES="([^"]+)"/)[1];
  try {
    fs.mkdirSync(dir);
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.symlinkSync(process.execPath, path.join(dir, 'bin/node'));
    fs.writeFileSync(path.join(dir, 'serve.mjs'), body);
    for (const name of [...nativeContract.trim().split(/\s+/), `@lydell/node-pty-${process.platform}-${process.arch}`]) {
      const pkg = path.join(dir, 'node_modules', name);
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name, main: 'index.cjs' }));
      fs.writeFileSync(path.join(pkg, 'index.cjs'), 'module.exports = {};');
    }
    setup(dir);
    return spawnSync('bash', ['-c', `set -uo pipefail\nREQUIRED_NATIVE_MODULES=$2\n${CHECK_BOOT_IMPORT_CLOSURE}\ncheck_boot_import_closure "$1"`, 'check', dir, nativeContract], {
      encoding: 'utf8', env: { ...process.env, ORIGINAL_HOME: process.env.HOME, HARNESS_ADMIN_DATABASE_URL: 'must-not-inherit', PAPERCUSP_INTEGRATION_ROOT: '/missing-build-tree', ...envOverrides },
    });
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

test('boot preflight refuses ancestor natives and missing target node-pty before executing the graph', () => {
  for (const name of ['@lydell/node-pty', `@lydell/node-pty-${process.platform}-${process.arch}`]) {
    const result = runBootCheck(`throw Error('GRAPH_MUST_NOT_RUN');`, {}, dir => {
      const source = path.join(dir, 'node_modules', name);
      const ancestor = path.join(dir, '..', 'node_modules', name);
      fs.mkdirSync(path.dirname(ancestor), { recursive: true });
      fs.renameSync(source, ancestor);
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /boot import namespace FAILED.*resolved OUTSIDE/);
    assert.doesNotMatch(result.stderr, /GRAPH_MUST_NOT_RUN/);
  }
});

test('full boot graph refuses ancestor CommonJS, ESM and escaping package links', () => {
  for (const [body, linked] of [
    [`import { createRequire } from 'node:module'; createRequire(import.meta.url)('ancestor-only');`, false],
    [`await import('ancestor-only');`, false],
    [`await import('ancestor-only');`, true],
  ]) {
    const result = runBootCheck(body + `console.log('PAPERCUSP_BOOT_IMPORTS_OK');`, {}, dir => {
      const ancestor = path.join(dir, '..', 'node_modules', 'ancestor-only');
      fs.mkdirSync(ancestor, { recursive: true });
      fs.writeFileSync(path.join(ancestor, 'package.json'), JSON.stringify({ name: 'ancestor-only', main: 'index.cjs' }));
      fs.writeFileSync(path.join(ancestor, 'index.cjs'), 'module.exports = {};');
      if (linked) fs.symlinkSync(ancestor, path.join(dir, 'node_modules', 'ancestor-only'), 'dir');
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ESCAPED_BUNDLE.*resolved OUTSIDE/);
    assert.doesNotMatch(result.stderr, /receiptObserved":true/);
  }
});

test('full boot graph permits in-bundle transitive CommonJS, ESM and builtin imports', () => {
  const result = runBootCheck(`
    import fs from 'node:fs';
    import { createRequire } from 'node:module';
    createRequire(import.meta.url)('@lydell/node-pty');
    await import('@lydell/node-pty');
    if (!fs.existsSync(import.meta.filename)) throw Error('missing entry');
    console.log('PAPERCUSP_BOOT_IMPORTS_OK');`);
  assert.equal(result.status, 0, result.stderr);
});

test('packaged import closure qualifies isolated final-image imports, not build-host assets', () => {
  const result = runBootCheck(`if (!process.argv.includes('--verify-boot-imports')) throw Error('wrong probe');
    if (process.env.HARNESS_ADMIN_DATABASE_URL || process.env.PAPERCUSP_INTEGRATION_ROOT) throw Error('ambient host leaked');
    if (process.env.HOME === process.env.ORIGINAL_HOME) throw Error('not isolated');
    console.log('PAPERCUSP_BOOT_IMPORTS_OK');`);
  assert.equal(result.status, 0, result.stderr);
});
test('packaged imports cannot connect to an ambient PostgreSQL endpoint, even when the error is caught', async () => {
  const net = require('node:net');
  let contacts = 0;
  const listener = net.createServer(socket => { contacts++; socket.destroy(); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try {
    for (const [imports, operation] of [
      [`import net from 'node:net';`, `net.createConnection({ host: '127.0.0.1', port: Number(process.env.PAPERCUSP_PG_PORT) })`],
      [`import { Socket } from 'node:net';`, `new Socket().connect(Number(process.env.PAPERCUSP_PG_PORT), '127.0.0.1')`],
      [`import { createRequire } from 'node:module';`, `createRequire(import.meta.url)('net').connect(Number(process.env.PAPERCUSP_PG_PORT), '127.0.0.1')`],
      [`import { connect } from 'node:tls';`, `connect({ host: '127.0.0.1', port: Number(process.env.PAPERCUSP_PG_PORT), rejectUnauthorized: false })`],
    ]) {
      const result = runBootCheck(`${imports}\ntry {
        const socket = ${operation};
        socket.on('error', () => {});
        socket.once('connect', () => socket.destroy());
      } catch {}\nconsole.log('PAPERCUSP_BOOT_IMPORTS_OK');`, {
        PAPERCUSP_PG_PORT: String(listener.address().port),
      });
      await new Promise(resolve => setTimeout(resolve, 25));
      assert.equal(contacts, 0, 'the live loopback listener must receive no connection');
      assert.equal(result.status, 1, 'a caught connection error must still refuse the boot receipt');
      assert.match(result.stderr, /BOOT_IMPORT_IO_FORBIDDEN.*socket/);
      assert.match(result.stderr, /BOOT_IMPORT_IO_DETAIL: .*"operation":"socket.connect"/);
      assert.match(result.stderr, /serve\.mjs/);
      assert.match(result.stderr, /"receiptObserved":true/);
    }
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
test('packaged imports refuse the real PostgreSQL driver before it reaches an ambient listener', async () => {
  let contacts = 0;
  const listener = require('node:net').createServer(socket => { contacts++; socket.destroy(); });
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try {
    const result = runBootCheck(`import postgres from 'postgres';
      const sql = postgres('postgresql://probe:probe@127.0.0.1:' + process.env.PAPERCUSP_PG_PORT + '/probe', { connect_timeout: 1, max: 1 });
      try { await sql\`select 1\`; } catch {} finally { await sql.end({ timeout: 0 }); }
      console.log('PAPERCUSP_BOOT_IMPORTS_OK');`, {
      PAPERCUSP_PG_PORT: String(listener.address().port),
    }, dir => {
      // The package's CJS entry is cjs/src/index.js. Copy its real source so
      // the namespace guard still qualifies a wholly in-bundle dependency.
      const packageRoot = path.resolve(path.dirname(require.resolve('postgres')), '../..');
      assert.equal(JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).name, 'postgres');
      fs.cpSync(packageRoot, path.join(dir, 'node_modules/postgres'), { recursive: true });
    });
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(contacts, 0, 'the real driver must never contact the live loopback listener');
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /BOOT_IMPORT_IO_FORBIDDEN.*socket/);
    assert.match(result.stderr, /node_modules\/postgres\/src\/connection\.js/);
    assert.match(result.stderr, /"receiptObserved":false/);
  } finally { await new Promise(resolve => listener.close(resolve)); }
});
test('packaged imports cannot launch a subprocess that escapes the isolated probe', () => {
  for (const body of [
    `import { spawnSync } from 'node:child_process'; try { spawnSync(process.execPath, ['-e', 'process.exit(0)']); } catch {}`,
    `import { createRequire } from 'node:module'; try { createRequire(import.meta.url)('child_process').execFileSync(process.execPath, ['-e', 'process.exit(0)']); } catch {}`,
  ]) {
    const result = runBootCheck(body + `\nconsole.log('PAPERCUSP_BOOT_IMPORTS_OK');`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BOOT_IMPORT_IO_FORBIDDEN.*child_process/);
    assert.match(result.stderr, /BOOT_IMPORT_IO_DETAIL: .*"operation":"child_process\.(?:spawnSync|execFileSync)"/);
    assert.match(result.stderr, /serve\.mjs/);
    assert.match(result.stderr, /"receiptObserved":true/);
  }
});
test('packaged import closure accepts a receipt after stderr exceeds the pipe buffer', () => {
  const result = runBootCheck(`import { writeSync } from 'node:fs';
    writeSync(2, Buffer.alloc(2 * 1024 * 1024, 'x'));
    console.log('PAPERCUSP_BOOT_IMPORTS_OK');`);
  assert.equal(result.status, 0, result.stderr);
});
test('packaged import failure keeps a bounded tail after oversized stderr', () => {
  const result = runBootCheck(`import { writeSync } from 'node:fs';
    writeSync(2, Buffer.alloc(2 * 1024 * 1024, 'x'));
    console.error('FINAL_CHILD_TRACE'); process.exit(2);`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /"status":2/);
  assert.match(result.stderr, /FINAL_CHILD_TRACE/);
  assert.doesNotMatch(result.stderr, /ENOBUFS/);
  assert.ok(Buffer.byteLength(result.stderr) < 8192, 'failure output must remain bounded');
});
test('Linux import probe launches with the host allocator contract and preserves explicit settings', { skip: process.platform !== 'linux' }, () => {
  for (const [cap, tunable, expected] of [
    [undefined, undefined, '2'],
    ['8', undefined, '8'],
    [undefined, 'glibc.malloc.arena_max=4', undefined],
  ]) {
    const result = runBootCheck(`
      if (process.env.MALLOC_ARENA_MAX !== ${JSON.stringify(expected) ?? 'undefined'}) throw Error('unexpected allocator cap: ' + process.env.MALLOC_ARENA_MAX);
      if (process.env.GLIBC_TUNABLES !== ${JSON.stringify(tunable) ?? 'undefined'}) throw Error('changed explicit tunable');
      console.log('PAPERCUSP_BOOT_IMPORTS_OK');`, { MALLOC_ARENA_MAX: cap, GLIBC_TUNABLES: tunable });
    assert.equal(result.status, 0, result.stderr);
  }
});
test('packaged import timeout preserves partial output and launch diagnostics', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-timeout-observation-'));
  try {
    const preload = path.join(fixture, 'spawn-observation.cjs');
    for (const status of [null, 0]) {
      fs.writeFileSync(preload, `
      const cp = require('node:child_process');
      const original = cp.spawnSync;
      cp.spawnSync = (file, args, options) => {
        if (args?.some(arg => String(arg).endsWith('/serve.mjs'))) {
          require('node:assert/strict').equal(options.timeout, 60000);
          require('node:assert/strict').equal(options.maxBuffer, 1024 * 1024);
          const error = new Error('observed boot probe deadline');
          error.code = 'ETIMEDOUT';
          return { pid: 123, status: ${JSON.stringify(status)}, signal: ${JSON.stringify(status === null ? 'SIGTERM' : null)}, error,
            stdout: 'LAST_COMPLETED_BOOT_PHASE registry-start\\nPAPERCUSP_BOOT_IMPORTS_OK\\n',
            stderr: 'CHILD_DIAGNOSTIC registry-pending\\n' };
        }
        return original(file, args, options);
      };
      require('node:module').syncBuiltinESMExports();
    `);
      const result = runBootCheck('', { NODE_OPTIONS: '--require=' + preload });
      assert.equal(result.status, 1, 'a partial receipt must not accept a timed-out child');
      assert.match(result.stderr, /LAST_COMPLETED_BOOT_PHASE registry-start/);
      assert.match(result.stderr, /CHILD_DIAGNOSTIC registry-pending/);
      assert.match(result.stderr, /"errorCode":"ETIMEDOUT"/);
      assert.match(result.stderr, /"pid":123/);
      assert.match(result.stderr, /"elapsedMs":\d+/);
      assert.match(result.stderr, /"cwd":"[^\n]+packaged-boot-closure-/);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('packaged import failure retains both child output streams', () => {
  const result = runBootCheck(`console.log('PARTIAL_IMPORT_PROGRESS');
    console.error('CHILD_IMPORT_FAILURE'); process.exit(2);`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PARTIAL_IMPORT_PROGRESS/);
  assert.match(result.stderr, /CHILD_IMPORT_FAILURE/);
});

test('packaged import closure refuses pruned eager persona reads and missing probe receipts', () => {
  for (const body of ["throw Error('oracle.persona.md not found');", "console.log('not a boot receipt');"]) {
    const result = runBootCheck(body);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /boot import closure FAILED/);
  }
  assert.match(script, /check_boot_import_closure "\$SIDECAR" \|\| exit 1/);
});

const ORT_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.wasm',
];
const RUNTIMES = ['wake-runtime', 'vad-runtime'];

function writeFile(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
}

/** A healthy served layout: every ORT file at the top level of each runtime dir. */
function buildHealthySpa(sidecar) {
  for (const rt of RUNTIMES) {
    for (const f of ORT_FILES) writeFile(path.join(sidecar, 'spa', rt, f));
  }
  writeFile(path.join(sidecar, 'spa', 'vditor', 'dist', 'index.min.js'));
  writeFile(path.join(sidecar, 'spa', 'porcupine', 'porcupine_params.pv'));
  writeFile(path.join(sidecar, 'spa', 'index.html'));
}

/** Run the real function against a sidecar dir under the script's shell flags. */
function runCheck(build) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-spa-layout-'));
  try {
    const sidecar = path.join(tmp, 'sidecar');
    fs.mkdirSync(sidecar);
    build(sidecar);
    const program = `set -uo pipefail\n${CHECK_SPA_RUNTIME_LAYOUT}\ncheck_spa_runtime_layout "$1"\n`;
    const res = spawnSync('bash', ['-c', program, 'check', sidecar], { encoding: 'utf8' });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('a healthy served layout passes', () => {
  const r = runCheck(buildHealthySpa);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /✓ spa ONNX runtime at the served top level/);
});

test('the exact cross-filesystem layout (runtime copied INTO itself) fails', () => {
  // What the EXDEV fallback produced: every runtime dir holds only a nested copy of
  // itself, and the served top level has no ORT files at all.
  const r = runCheck((sidecar) => {
    for (const rt of RUNTIMES) {
      for (const f of ORT_FILES) writeFile(path.join(sidecar, 'spa', rt, rt, f));
    }
    writeFile(path.join(sidecar, 'spa', 'vditor', 'vditor', 'dist', 'index.min.js'));
    writeFile(path.join(sidecar, 'spa', 'porcupine', 'porcupine', 'porcupine_params.pv'));
  });
  assert.equal(r.status, 1, r.out);
  for (const rt of RUNTIMES) {
    for (const f of ORT_FILES) {
      assert.ok(r.out.includes(`spa/${rt}/${f} missing at the served top level`), `${rt}/${f}: ${r.out}`);
    }
    assert.ok(r.out.includes(`spa/${rt}/${rt} exists`), r.out);
  }
  assert.ok(r.out.includes('spa/vditor/vditor exists'), r.out);
  assert.ok(r.out.includes('spa/porcupine/porcupine exists'), r.out);
  assert.doesNotMatch(r.out, /✓/);
});

test('one missing top-level ORT file fails and is named', () => {
  const r = runCheck((sidecar) => {
    buildHealthySpa(sidecar);
    fs.rmSync(path.join(sidecar, 'spa', 'wake-runtime', 'ort-wasm-simd-threaded.jsep.mjs'));
  });
  assert.equal(r.status, 1, r.out);
  assert.ok(r.out.includes('spa/wake-runtime/ort-wasm-simd-threaded.jsep.mjs missing'), r.out);
  assert.ok(!r.out.includes('spa/vad-runtime/ort-wasm-simd-threaded.jsep.mjs missing'), r.out);
});

test('a self-nested non-ONNX asset dir fails even when the ORT files are served correctly', () => {
  for (const d of ['vditor', 'porcupine', 'monaco']) {
    const r = runCheck((sidecar) => {
      buildHealthySpa(sidecar);
      writeFile(path.join(sidecar, 'spa', d, d, 'payload.js'));
    });
    assert.equal(r.status, 1, `${d}: ${r.out}`);
    assert.ok(r.out.includes(`spa/${d}/${d} exists`), `${d}: ${r.out}`);
  }
});

test('a sidecar with no spa/ fails', () => {
  const r = runCheck(() => {});
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /spa\/ missing under/);
});

test('both spa checks are wired into the script verdict, after their definitions and before the FAIL exit', () => {
  const verdict = script.lastIndexOf('if [[ "$FAIL" != 0 ]]; then');
  for (const fn of ['check_spa_runtime_layout', 'check_spa_no_baked_flag_seed']) {
    const def = script.indexOf(`${fn}() {`);
    const call = script.indexOf(`${fn} "$SIDECAR" || FAIL=1`);
    assert.ok(def >= 0, `${fn}: definition missing`);
    assert.ok(call > def, `${fn}: the call must follow the definition and fold into FAIL`);
    assert.ok(verdict > call, `${fn}: the call must run before the final FAIL verdict`);
  }
});

// WI-10004079 — a built index.html must not bake a flag seed. The shipped 0.0.25
// shell carried `<head><script>window.__PAPERCUSP_FLAGS__={…}</script>`, which
// ran after the installed app's own host-injected seed and overwrote it.
const CHECK_NO_BAKED_FLAG_SEED = extractFunction('check_spa_no_baked_flag_seed');

function runSeedCheck(indexHtml) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-spa-seed-'));
  try {
    const sidecar = path.join(tmp, 'sidecar');
    fs.mkdirSync(sidecar);
    if (indexHtml !== null) {
      fs.mkdirSync(path.join(sidecar, 'spa'));
      fs.writeFileSync(path.join(sidecar, 'spa', 'index.html'), indexHtml);
    }
    const program = `set -uo pipefail\n${CHECK_NO_BAKED_FLAG_SEED}\ncheck_spa_no_baked_flag_seed "$1"\n`;
    const res = spawnSync('bash', ['-c', program, 'check', sidecar], { encoding: 'utf8' });
    return { status: res.status, out: `${res.stdout}${res.stderr}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('an index.html with no baked flag seed passes', () => {
  const r = runSeedCheck('<!doctype html><html><head><title>Papercusp</title></head><body></body></html>');
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /✓ spa\/index.html carries no baked flag seed/);
});

test('the shipped 0.0.25 shape (a baked build-host seed right after <head>) fails', () => {
  const baked =
    '<!doctype html><html><head><script>window.__PAPERCUSP_FLAGS__={"flags":{"papercusp-accept-delegated-seats":false},"evaluatedAt":1790690000000,"source":"posthog"};</script><title>Papercusp</title></head></html>';
  const r = runSeedCheck(baked);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /bakes window.__PAPERCUSP_FLAGS__/);
});

test('a missing spa/index.html fails', () => {
  const r = runSeedCheck(null);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /spa\/index.html missing/);
});

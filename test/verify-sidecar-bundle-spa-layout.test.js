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
function extractFunction(name) {
  const lines = script.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `${name}() not found in verify-sidecar-bundle.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const CHECK_SPA_RUNTIME_LAYOUT = extractFunction('check_spa_runtime_layout');
const CHECK_BOOT_IMPORT_CLOSURE = extractFunction('check_boot_import_closure');
const WRITE_VERIFICATION_RECEIPT = extractFunction('write_verification_receipt');

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
    const receipt = path.join(dir, 'result.json');
    fs.writeFileSync(executable, 'executable verifier fixture');
    fs.writeFileSync(helper, 'manifest helper fixture');
    const verifierSha = hashFile(executable);
    const helperSha = hashFile(helper);
    const run = (status, cross = '1') => {
      const result = spawnSync('bash', ['-c', `set -uo pipefail\n${WRITE_VERIFICATION_RECEIPT}\n` +
        'RECEIPT="$1"; _receipt_verifier="$2"; _receipt_verifier_sha="$3"\n' +
        '_pui_manifest_tool="$4"; _pui_manifest_tool_sha="$5"; SIDECAR=fixture\n' +
        'TARGET_OS_N=darwin; TARGET_ARCH_N=x64; CROSS="$7"\n' +
        '_receipt_command=(bash "$2" fixture); write_verification_receipt "$6"',
        'receipt', receipt, executable, verifierSha, helper, helperSha, String(status), cross], { encoding: 'utf8' });
      return { result, body: JSON.parse(fs.readFileSync(receipt)) };
    };
    const passing = run(0);
    assert.equal(passing.result.status, 0, passing.result.stderr);
    assert.equal(passing.body.verifier.sha256, verifierSha);
    assert.equal(passing.body.helpers[0].sha256, helperSha);
    assert.notEqual(passing.body.verifier.sha256, passing.body.helpers[0].sha256);
    assert.equal(passing.body.qualification, 'static-cross');
    assert.equal(passing.body.onTargetNativeLoadVerified, false);
    assert.equal(passing.body.bootImportClosureVerified, false);
    const refused = run(1, '0');
    assert.equal(refused.body.exitCode, 1);
    assert.equal(refused.body.verdict, 'fail');
    assert.equal(refused.body.onTargetNativeLoadVerified, false);
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

function runBootCheck(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-boot-closure-'));
  try {
    fs.mkdirSync(path.join(dir, 'bin'));
    fs.symlinkSync(process.execPath, path.join(dir, 'bin/node'));
    fs.writeFileSync(path.join(dir, 'serve.mjs'), body);
    return spawnSync('bash', ['-c', `set -uo pipefail\n${CHECK_BOOT_IMPORT_CLOSURE}\ncheck_boot_import_closure "$1"`, 'check', dir], {
      encoding: 'utf8', env: { ...process.env, ORIGINAL_HOME: process.env.HOME, HARNESS_ADMIN_DATABASE_URL: 'must-not-inherit', PAPERCUSP_INTEGRATION_ROOT: '/missing-build-tree' },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('packaged import closure qualifies isolated final-image imports, not build-host assets', () => {
  const result = runBootCheck(`if (!process.argv.includes('--verify-boot-imports')) throw Error('wrong probe');
    if (process.env.HARNESS_ADMIN_DATABASE_URL || process.env.PAPERCUSP_INTEGRATION_ROOT) throw Error('ambient host leaked');
    if (process.env.HOME === process.env.ORIGINAL_HOME) throw Error('not isolated');
    console.log('PAPERCUSP_BOOT_IMPORTS_OK');`);
  assert.equal(result.status, 0, result.stderr);
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

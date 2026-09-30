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

test('the check is wired into the script verdict, after its definition and before the FAIL exit', () => {
  const def = script.indexOf('check_spa_runtime_layout() {');
  const call = script.indexOf('check_spa_runtime_layout "$SIDECAR" || FAIL=1');
  const verdict = script.lastIndexOf('if [[ "$FAIL" != 0 ]]; then');
  assert.ok(def >= 0, 'definition missing');
  assert.ok(call > def, 'the call must follow the definition and fold into FAIL');
  assert.ok(verdict > call, 'the call must run before the final FAIL verdict');
});

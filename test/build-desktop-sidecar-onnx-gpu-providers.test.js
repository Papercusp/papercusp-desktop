const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// PROBE_SCRIPT lets scripts/mutation-probe.sh point this at a MUTATED COPY outside
// the tree, so falsifiability can be proven without ever dirtying the shared
// checkout — git-sync sweeps every few minutes and would happily commit a mutant
// that a trap cannot save you from (see the mutation-probe doctrine in CLAUDE.md).
const builderPath = process.env.PROBE_SCRIPT || path.join(root, 'bin/build-desktop-sidecar.sh');
const builder = fs.readFileSync(builderPath, 'utf8') + '\n'
  + fs.readFileSync(process.env.PROBE_CLOSURE_SCRIPT || path.join(root, 'bin/lib/host-runtime-closure.sh'), 'utf8');

// WI-38682. onnxruntime-node ships ONNX Runtime's GPU execution providers inside the
// platform/arch dir the foreign-platform prune KEEPS, and on linux/x64
// libonnxruntime_providers_cuda.so alone is 301M — the single largest file in the
// whole sidecar, on every install, forever. It can never execute here: the embedder
// is CPU-only by design (EI-19363236885307403) and the only GPU-capable component
// (the local reranker) is opt-in AND verified-load with a CPU fallback.
//
// These tests EXECUTE the real shell functions rather than pattern-matching the
// script text. A text assertion here would only prove the guard is *spelled*
// correctly — the sibling lock test's comment explains at length how a shape-based
// assertion goes stale against code that never regressed. The functions are sliced
// out of the real script so there is exactly ONE implementation: a rename, a
// refactor, or a deleted call site fails extraction rather than silently testing a
// stale copy pasted into this file.

/** Slice a top-level `name() { … }` out of the real script (closing brace at col 0). */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((l) => l === `${name}() {`);
  assert.ok(
    start >= 0,
    `${name}() not found in bin/build-desktop-sidecar.sh — if it was renamed, rename it here too; ` +
      'if it was deleted, the 301MB CUDA provider is shipping again and this test is the thing that noticed',
  );
  const end = lines.findIndex((l, i) => i > start && l === '}');
  assert.ok(end > start, `${name}() has no closing brace at column 0`);
  return lines.slice(start, end + 1).join('\n');
}

const PRUNE = extractFunction('prune_onnx_gpu_providers');
const GUARD = extractFunction('assert_no_onnx_gpu_providers');

function runBash(script) {
  const res = spawnSync('bash', ['-c', `set -uo pipefail\n${script}`], { encoding: 'utf8' });
  assert.equal(res.error, undefined, `bash failed to spawn: ${res.error}`);
  return res;
}

/** Build a throwaway tree; files are tiny — these tests assert PRESENCE, not bytes. */
function makeTree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-onnx-ep-'));
  for (const rel of files) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  return dir;
}

const NAPI = 'node_modules/onnxruntime-node/bin/napi-v6/linux/x64';
/** What onnxruntime-node actually ships for linux/x64, verified against the real tree. */
const REAL_LAYOUT = [
  `${NAPI}/libonnxruntime_providers_cuda.so`, // 301M — the whole point
  `${NAPI}/libonnxruntime_providers_tensorrt.so`, // 835K
  `${NAPI}/libonnxruntime_providers_shared.so`, // 14K — REQUIRED, must survive
  `${NAPI}/libonnxruntime.so.1`, // 35M — the runtime itself, must survive
  `${NAPI}/onnxruntime_binding.node`, // the addon, must survive
];

test('prune drops the GPU providers and keeps the runtime, the addon, and the EP shim', () => {
  const dir = makeTree(REAL_LAYOUT);
  try {
    const pkg = path.join(dir, 'node_modules/onnxruntime-node');
    const res = runBash(`${PRUNE}\nprune_onnx_gpu_providers ${JSON.stringify(pkg)}`);
    assert.equal(res.status, 0, `prune exited ${res.status}: ${res.stderr}`);

    const survives = (rel) => fs.existsSync(path.join(dir, rel));
    assert.equal(survives(`${NAPI}/libonnxruntime_providers_cuda.so`), false, 'CUDA provider must be pruned');
    assert.equal(survives(`${NAPI}/libonnxruntime_providers_tensorrt.so`), false, 'TensorRT provider must be pruned');

    // The keep-set matters as much as the drop-set: removing any of these breaks
    // inference outright, which is far worse than shipping a large file.
    assert.ok(survives(`${NAPI}/libonnxruntime_providers_shared.so`), 'the EP-registration shim is REQUIRED');
    assert.ok(survives(`${NAPI}/libonnxruntime.so.1`), 'the ONNX runtime itself must survive');
    assert.ok(survives(`${NAPI}/onnxruntime_binding.node`), 'the napi addon must survive');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prune is a no-op (exit 0) on a package that has no napi-v6 layout at all', () => {
  const dir = makeTree(['node_modules/left-pad/index.js']);
  try {
    const pkg = path.join(dir, 'node_modules/left-pad');
    const res = runBash(`${PRUNE}\nprune_onnx_gpu_providers ${JSON.stringify(pkg)}`);
    // It runs against EVERY package in the closure walk, under `set -e`. A non-zero
    // return on the ordinary no-match case would abort the whole build.
    assert.equal(res.status, 0, `prune must exit 0 on unrelated packages, got ${res.status}: ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard FAILS the build when a GPU provider survives, and names it', () => {
  const dir = makeTree(REAL_LAYOUT); // deliberately NOT pruned
  try {
    const res = runBash(`${GUARD}\nassert_no_onnx_gpu_providers ${JSON.stringify(dir)}`);
    // This is the falsifiability case: a guard that cannot fail guards nothing.
    assert.equal(res.status, 1, 'guard must exit non-zero when a GPU provider is present');
    assert.match(res.stderr, /libonnxruntime_providers_cuda\.so/, 'guard must name the offending file');
    assert.match(res.stderr, /prune_onnx_gpu_providers/, 'guard must say how to fix it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard PASSES once the providers are gone — the two halves agree', () => {
  const dir = makeTree(REAL_LAYOUT);
  try {
    // Compose them exactly as the build does: prune during the closure walk, then
    // guard the assembled tree. This is the invariant that keeps the pair honest —
    // if someone widens the prune's keep-set without widening the guard's allowlist
    // (or vice versa), the build starts failing on its own correct output.
    const pkg = path.join(dir, 'node_modules/onnxruntime-node');
    const res = runBash(
      `${PRUNE}\n${GUARD}\nprune_onnx_gpu_providers ${JSON.stringify(pkg)} && ` +
        `assert_no_onnx_gpu_providers ${JSON.stringify(dir)}`,
    );
    assert.equal(res.status, 0, `prune output must satisfy the guard, got ${res.status}: ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard catches a provider vendored ANYWHERE, not just under the pruned package', () => {
  // The per-package prune only ever sees packages the closure walk brought in, so
  // this is the case it structurally cannot catch and the backstop exists for: a new
  // dependency vendoring its own onnxruntime copy somewhere else in the tree.
  const dir = makeTree([
    'node_modules/some-new-dep/vendor/onnx/libonnxruntime_providers_cuda.so',
    `${NAPI}/libonnxruntime_providers_shared.so`,
  ]);
  try {
    const res = runBash(`${GUARD}\nassert_no_onnx_gpu_providers ${JSON.stringify(dir)}`);
    assert.equal(res.status, 1, 'guard must scan the whole assembled tree, not just the known package path');
    assert.match(res.stderr, /some-new-dep/, 'guard must name where it found it');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guard refuses an UNKNOWN provider — it is an allowlist, not a denylist of known names', () => {
  // The expensive failure is a provider nobody has seen before (an onnxruntime bump
  // adding one) shipping silently because a denylist did not list it. Stopping the
  // line and forcing a decision is the intended behavior, not a bug to route around.
  const dir = makeTree([
    `${NAPI}/libonnxruntime_providers_rocm.so`,
    `${NAPI}/libonnxruntime_providers_shared.so`,
  ]);
  try {
    const res = runBash(`${GUARD}\nassert_no_onnx_gpu_providers ${JSON.stringify(dir)}`);
    assert.equal(res.status, 1, 'an unrecognised provider must stop the build rather than ship');
    assert.match(res.stderr, /libonnxruntime_providers_rocm\.so/, 'guard must name the unknown provider');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the prune is actually wired into the closure walk, and the guard into the build', () => {
  // Both functions can be perfect and still never run. These are the call sites.
  assert.match(
    builder,
    /^\s*prune_onnx_gpu_providers "\$dest"$/m,
    'prune_onnx_gpu_providers must be called for each resolved destination inside copy_pkg_closure',
  );
  assert.match(
    builder,
    /^assert_no_onnx_gpu_providers "\$SIDECAR_DIR" \|\| exit 1$/m,
    'assert_no_onnx_gpu_providers must run against the assembled sidecar and fail the build',
  );
});

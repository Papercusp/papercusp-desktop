// EI-18885442084466501 — the stray-.cache guard in bin/build-desktop-sidecar.sh
// must survive its own HEALTHY case.
//
// WHY THIS TEST EXISTS
// The guard is written as:
//
//   _stray_caches=$(find … -name ".cache" | grep -v -F -x "$_expected_cache")
//
// `grep -v` exits 1 when it filters out every line — which is precisely the
// healthy outcome (no stray caches). The script runs under `set -euo pipefail`,
// so that status killed the entire build. The guard's only non-fatal path was a
// fatal one, and it fired on every single run.
//
// What made it expensive is WHERE it sits. By this point the script has already
// done its destructive `mv "$SIDECAR_FINAL_DIR" "$OLD_DIR"`, and the EXIT trap
// installed at the top `rm -rf`s the staged tmp dir. So each run moved the
// previous sidecar aside, built a complete bundle, verified it, printed
// "verify-sidecar-bundle: OK" and a freshness stamp — then deleted the result,
// leaving NO sidecar at all. The final line printed was success-shaped, so it
// read as a clean build, and the damage only surfaced much later as an app
// packaged with build.rs's placeholder (which cannot start its operator, waits
// out a 120s boot timeout, and silently falls back to a foreign environment).
//
// 11 orphaned sidecar.old.<pid> dirs — one per killed build — were in the tree
// when this was found.
//
// This test runs the REAL guard text out of the script (not a copy) so that
// removing the `|| true`, or reintroducing the same shape elsewhere in the
// block, fails here instead of silently destroying sidecar builds again.
//
// ⚠ UPDATED BY D-178 (2026-08-29). The `grep -v -F -x "$_expected_cache"` filter
// described above NO LONGER EXISTS: the two live embedding models moved out of
// `.cache/` into the transformers package's default `models/` dir, so there is no
// legitimate cache left to carve out and the stray scan is a bare `find` again.
// That retires the `|| true` hazard at this site rather than fixing it — the
// class-level test below ("no assignment ... pipes into grep without a || true")
// is what keeps the shape from coming back anywhere in the script. The
// allowlisting the old block did (exactly harrier-oss + embeddinggemma, nothing
// else) moved to the models guard, and is covered here at equal strength, in both
// directions: an unexpected model fails, and so does a MISSING one.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const scriptPath = path.resolve(__dirname, '../bin/build-desktop-sidecar.sh');
const builder = fs.readFileSync(scriptPath, 'utf8') + '\n'
  + fs.readFileSync(path.join(root, 'bin/lib/host-runtime-closure.sh'), 'utf8');

/** Pull a top-level shell function verbatim out of the real build script. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `${name}() not found in the real sidecar builder`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const PRUNE_TRANSFORMER_FRAGMENTS = extractFunction('prune_transformers_model_fragments');
const ASSERT_NO_TRANSFORMER_FRAGMENTS = extractFunction('assert_no_transformers_model_fragments');

/** Pull the guard block verbatim out of the real script. */
function extractGuard() {
  const full = fs.readFileSync(scriptPath, 'utf8');
  // D-178 removed `_expected_cache=` (there is no longer a legitimate cache at
  // all), so the block is anchored on the stray scan itself.
  const start = full.indexOf('_stray_caches=$(find');
  assert.notEqual(start, -1, 'could not find the stray-.cache guard in the script');
  const end = full.indexOf('# EI-200 epilogue', start);
  assert.notEqual(end, -1, 'could not find the end of the stray-.cache guard block');
  return full.slice(start, end);
}

const MODELS_REL = 'node_modules/@huggingface/transformers/models/onnx-community';
const LIVE_MODELS = ['harrier-oss-v1-0.6b-ONNX', 'embeddinggemma-300m-ONNX'];

/**
 * Execute the guard against a synthetic staged tree, under the SAME shell flags
 * the real script uses — `set -euo pipefail` is the whole point of the test.
 *
 * D-178: the two live embedding models moved OUT of `.cache/` into the
 * transformers package's default `models/` dir, so the fixture builds them there
 * and a `.cache` anywhere — including under transformers itself — is now stray.
 */
function runGuard({ stray = false, strayUnderTransformers = false, models = LIVE_MODELS } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-stray-cache-'));
  try {
    const nodeModules = path.join(tmp, 'node_modules');
    // Always create node_modules, even for the models:[] fixture. A missing root
    // makes the guard's `find` fail, and under `set -euo pipefail` that killed the
    // block with EMPTY stderr — indistinguishable from the guard firing correctly.
    fs.mkdirSync(nodeModules, { recursive: true });
    for (const model of models) {
      fs.mkdirSync(path.join(tmp, MODELS_REL, model, 'onnx'), { recursive: true });
    }
    if (stray) fs.mkdirSync(path.join(nodeModules, 'some-pkg/.cache'), { recursive: true });
    if (strayUnderTransformers) {
      fs.mkdirSync(path.join(nodeModules, '@huggingface/transformers/.cache/onnx-community'), {
        recursive: true,
      });
    }

    const script =
      'set -euo pipefail\n' +
      `SIDECAR_DIR=${JSON.stringify(tmp)}\n` +
      `${ASSERT_NO_TRANSFORMER_FRAGMENTS}\n` +
      extractGuard() +
      '\necho GUARD_COMPLETED\n';
    const res = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    return { ...res, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('the guard SURVIVES a clean bundle (no stray caches)', () => {
  // The regression: this is the ordinary, healthy path, and it used to exit 1
  // with no output at all — after the sidecar had already been moved aside.
  const res = runGuard({ stray: false });
  assert.equal(
    res.status,
    0,
    `guard killed a healthy build (status ${res.status}). If a grep was reintroduced into the ` +
      `stray scan without \`|| true\`, that is the cause — see this file's header.\nstderr: ${res.stderr}`,
  );
  assert.match(res.stdout, /GUARD_COMPLETED/, 'execution must continue past the guard');
});

test('the guard still FAILS the build on a genuine stray cache', () => {
  // The fix must not defang the guard: download scratch must never ship.
  const res = runGuard({ stray: true });
  assert.equal(res.status, 1, 'a stray .cache must fail the build');
  assert.match(res.stderr, /runtime \.cache dir\(s\) found/);
  assert.match(res.stderr, /some-pkg/, 'the error names the offending directory');
  assert.doesNotMatch(res.stdout, /GUARD_COMPLETED/, 'execution must stop at the guard');
});

test('D-178: transformers no longer gets a .cache exception', () => {
  // This is the invariant that changed. A `.cache` under @huggingface/transformers
  // used to be the ONE allowed cache in the bundle; it is now as fatal as any
  // other, because the models it used to justify live at models/ instead. If this
  // test starts passing a .cache through, the release identity gate's
  // `[build-cache]` rule will red the cut again (33-finding r12 lineage).
  const res = runGuard({ strayUnderTransformers: true });
  assert.equal(res.status, 1, 'a .cache under transformers must now fail the build');
  assert.match(res.stderr, /runtime \.cache dir\(s\) found/);
  assert.match(res.stderr, /@huggingface\/transformers/, 'the error names the offending directory');
  assert.doesNotMatch(res.stdout, /GUARD_COMPLETED/, 'execution must stop at the guard');
});

test('D-178: the guard is fail-closed on MISSING models, not just unexpected ones', () => {
  // Fail-closed in both directions is deliberate. "Models silently absent" ships a
  // product whose local embedding is quietly broken — a .deb installs its
  // resources root-owned and read-only, so a missing model cannot be
  // re-downloaded at runtime; it just fails. That is strictly harder to detect
  // than a red gate, which is why absence is fatal here.
  for (const missing of LIVE_MODELS) {
    const res = runGuard({ models: LIVE_MODELS.filter((m) => m !== missing) });
    assert.equal(res.status, 1, `a missing ${missing} must fail the build`);
    assert.match(res.stderr, /required embedding model missing after relocation/);
    assert.match(res.stderr, new RegExp(missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  // …and the whole models root being absent is fatal too, with its own message.
  const res = runGuard({ models: [] });
  assert.equal(res.status, 1, 'an absent models root must fail the build');
  assert.match(res.stderr, /relocated transformers models missing/);
});

test('D-178: an unexpected third model still fails the build', () => {
  // The allowlist that used to live in the .cache block moved here at equal
  // strength: exactly the two owner-confirmed models, nothing else.
  const res = runGuard({ models: [...LIVE_MODELS, 'some-other-model-ONNX'] });
  assert.equal(res.status, 1, 'an unexpected model dir must fail the build');
  assert.match(res.stderr, /unexpected entries beside the relocated models/);
  assert.match(res.stderr, /some-other-model-ONNX/);
});

test('no assignment in the script pipes into grep without a || true escape', () => {
  // The class, not just the instance. `set -e` + a command substitution ending
  // in `grep` is a silent-death shape: it fails exactly when the grep finds
  // nothing, which for a guard is the PASSING case.
  const full = fs.readFileSync(scriptPath, 'utf8');
  const offenders = full
    .split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(
      ({ line }) =>
        /^\s*(local\s+)?_?[A-Za-z_][A-Za-z0-9_]*=\$\(.*\|\s*grep\b/.test(line) &&
        !/\|\|\s*(true|:)/.test(line),
    );
  assert.deepEqual(
    offenders.map((o) => `${o.n}: ${o.line.trim()}`),
    [],
    'these assignments die under set -e when their grep matches nothing',
  );
});

test('no Python bytecode or __pycache__ artifacts are tracked in the release source', () => {
  // .gitignore prevents new interpreter caches from entering the tree, but it
  // does not remove a cache that was already tracked. Keep the source-copy
  // boundary closed against a tracked .pyc carrying this build box's paths.
  const res = spawnSync(
    'git',
    ['ls-files', '-z', '--', '*__pycache__*', '*.pyc', '*.pyo', '*.pyd'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(res.status, 0, `git ls-files failed: ${res.stderr}`);
  const tracked = (res.stdout ?? '')
    .split('\0')
    .filter(Boolean)
    // A deletion is intentionally visible as a worktree change until the
    // background git-sync commit lands; only paths still present can ship.
    .filter((file) => fs.existsSync(path.join(root, file)));
  assert.deepEqual(
    tracked,
    [],
    `tracked interpreter artifacts must be removed from the release source: ${tracked.join(', ')}`,
  );
});

function makeTransformersCache({ withFragments = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-transformers-cache-'));
  const cache = tmp;
  const modelRoot = path.join(cache, 'onnx-community');
  const models = [
    'harrier-oss-v1-0.6b-ONNX',
    'embeddinggemma-300m-ONNX',
  ];
  for (const model of models) {
    const onnx = path.join(modelRoot, model, 'onnx');
    fs.mkdirSync(onnx, { recursive: true });
    fs.writeFileSync(path.join(onnx, 'model.onnx_data'), 'real model bytes');
    if (withFragments) {
      fs.writeFileSync(path.join(onnx, 'model.onnx_data.tmp.123.fragment'), 'temporary');
      fs.writeFileSync(path.join(onnx, 'model.onnx_data.partial'), 'partial');
      fs.writeFileSync(path.join(onnx, 'model.onnx_data.part'), 'partial');
    }
  }
  return { tmp, cache };
}

function runTransformerShell(script) {
  const res = spawnSync('bash', ['-c', `set -euo pipefail\n${script}`], {
    encoding: 'utf8',
  });
  return { ...res, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

test('prune removes every download-fragment suffix from both preserved models and keeps model data', () => {
  const { tmp, cache } = makeTransformersCache();
  try {
    const res = runTransformerShell(
      `${PRUNE_TRANSFORMER_FRAGMENTS}\nprune_transformers_model_fragments ${JSON.stringify(cache)}\necho PRUNE_COMPLETED`,
    );
    assert.equal(res.status, 0, `fragment prune failed: ${res.stderr}`);
    assert.match(res.stdout, /PRUNE_COMPLETED/);
    for (const model of ['harrier-oss-v1-0.6b-ONNX', 'embeddinggemma-300m-ONNX']) {
      const onnx = path.join(cache, 'onnx-community', model, 'onnx');
      assert.equal(fs.existsSync(path.join(onnx, 'model.onnx_data')), true, `${model} data must survive`);
      assert.equal(fs.existsSync(path.join(onnx, 'model.onnx_data.tmp.123.fragment')), false, `${model} fragment must be pruned`);
      assert.equal(fs.existsSync(path.join(onnx, 'model.onnx_data.partial')), false, `${model} .partial must be pruned`);
      assert.equal(fs.existsSync(path.join(onnx, 'model.onnx_data.part')), false, `${model} .part must be pruned`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('assembled-tree guard rejects fragments and passes after the source prune', () => {
  const { tmp, cache } = makeTransformersCache();
  try {
    const before = runTransformerShell(
      `${ASSERT_NO_TRANSFORMER_FRAGMENTS}\nassert_no_transformers_model_fragments ${JSON.stringify(cache)}`,
    );
    assert.equal(before.status, 1, 'guard must reject a surviving download fragment');
    assert.match(before.stderr, /download fragment/);
    assert.match(before.stderr, /model\.onnx_data\.tmp\.123\.fragment/);
    assert.match(before.stderr, /model\.onnx_data\.partial/);
    assert.match(before.stderr, /model\.onnx_data\.part/);

    const after = runTransformerShell(
      `${PRUNE_TRANSFORMER_FRAGMENTS}\n${ASSERT_NO_TRANSFORMER_FRAGMENTS}\n` +
        `prune_transformers_model_fragments ${JSON.stringify(cache)} && ` +
        `assert_no_transformers_model_fragments ${JSON.stringify(cache)} && echo GUARD_COMPLETED`,
    );
    assert.equal(after.status, 0, `guard rejected the pruned cache: ${after.stderr}`);
    assert.match(after.stdout, /GUARD_COMPLETED/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('fragment prune and assembled guard are wired into the real builder', () => {
  assert.match(
    builder,
    /^\s*prune_transformers_model_fragments "\$_transformers_models"$/m,
    'the closure walk must prune preserved transformers model fragments (D-178: at models/, not .cache/)',
  );
  assert.match(
    builder,
    /^assert_no_transformers_model_fragments "\$SIDECAR_DIR\/node_modules\/@huggingface\/transformers\/models" \|\| exit 1$/m,
    'the assembled-sidecar guard must reject preserved transformers model fragments',
  );
  // D-178: the models must actually be MOVED out of .cache, not merely tolerated
  // there. Without this, a future edit could drop the relocation and the build
  // would still pass every test above while shipping the forbidden path again.
  assert.match(
    builder,
    /mv "\$_transformers_cache\/onnx-community" "\$_transformers_models\/onnx-community"/,
    'the closure walk must relocate the models out of .cache/ (D-178)',
  );
  assert.match(
    builder,
    /^\s*rm -rf "\$dest\/\.cache"$/m,
    'the closure walk must unconditionally remove .cache/ after relocating (D-178)',
  );
});

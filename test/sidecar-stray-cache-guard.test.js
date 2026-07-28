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

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.resolve(__dirname, '../bin/build-desktop-sidecar.sh');

/** Pull the guard block verbatim out of the real script. */
function extractGuard() {
  const full = fs.readFileSync(scriptPath, 'utf8');
  const start = full.indexOf('_expected_cache=');
  assert.notEqual(start, -1, 'could not find the stray-.cache guard in the script');
  const end = full.indexOf('# EI-200 epilogue', start);
  assert.notEqual(end, -1, 'could not find the end of the stray-.cache guard block');
  return full.slice(start, end);
}

/**
 * Execute the guard against a synthetic staged tree, under the SAME shell flags
 * the real script uses — `set -euo pipefail` is the whole point of the test.
 */
function runGuard({ stray }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-stray-cache-'));
  try {
    const nodeModules = path.join(tmp, 'node_modules');
    // The one legitimately-preserved cache (owner-confirmed live models).
    const expected = path.join(nodeModules, '@huggingface/transformers/.cache');
    fs.mkdirSync(path.join(expected, 'onnx-community'), { recursive: true });
    if (stray) fs.mkdirSync(path.join(nodeModules, 'some-pkg/.cache'), { recursive: true });

    const script =
      'set -euo pipefail\n' +
      `SIDECAR_DIR=${JSON.stringify(tmp)}\n` +
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
    `guard killed a healthy build (status ${res.status}). If the \`|| true\` was removed from ` +
      `the grep, that is the cause — see this file's header.\nstderr: ${res.stderr}`,
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

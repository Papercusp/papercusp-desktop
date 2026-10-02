// WI-10003497: build-desktop-sidecar.sh calls bundle_host_workers, which it sourced ONLY from the
// frozen TARGET tree's bundle-host-common.sh. A target older than the shared worker bundler has no
// such function, so the 0.0.22-alpha exact-source cut of 7708e704 died with
// "bundle_host_workers: command not found". These tests pin the orchestrator-revision fallback.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const lib = path.join(root, 'bin/lib/host-worker-bundler.sh');
const builder = fs.readFileSync(path.join(root, 'bin/build-desktop-sidecar.sh'), 'utf8');

const GUARD = [
  'if [[ "${PAPERCUSP_BUNDLE_HOST_COMMON_LOADED:-}" == "1" ]]; then',
  '  return 0',
  'fi',
  'PAPERCUSP_BUNDLE_HOST_COMMON_LOADED=1',
].join('\n');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'host-worker-bundler-'));
  // An OLD target helper: esbuild boundary only, no worker bundler.
  fs.writeFileSync(
    path.join(dir, 'target-common.sh'),
    `${GUARD}\nHOST_COMMON_EXTERNALS=(--external:target-only)\n`,
  );
  // The orchestrator helper: a different boundary plus the worker bundler.
  fs.writeFileSync(
    path.join(dir, 'orch-common.sh'),
    `${GUARD}\nHOST_COMMON_EXTERNALS=(--external:orchestrator-only)\n` +
      'HOST_WORKER_OUTPUTS=(a.script.mjs "b worker.mjs")\n' +
      'bundle_host_workers() { echo "bundled $1 -> $2 (${#HOST_WORKER_OUTPUTS[@]})"; }\n',
  );
  return dir;
}

function run(script) {
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

test('an old target helper gets the orchestrator bundle_host_workers and keeps its own esbuild boundary', () => {
  const dir = fixture();
  const r = run(`
    set -u
    source "${dir}/target-common.sh"
    source "${lib}"
    papercusp_ensure_host_worker_bundler "${dir}/orch-common.sh" || exit 9
    echo "externals=\${HOST_COMMON_EXTERNALS[*]}"
    echo "outputs=\${#HOST_WORKER_OUTPUTS[@]}:\${HOST_WORKER_OUTPUTS[1]}"
    bundle_host_workers /src /out
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /externals=--external:target-only$/m);
  assert.match(r.stdout, /outputs=2:b worker\.mjs$/m);
  assert.match(r.stdout, /bundled \/src -> \/out \(2\)$/m);
});

test('a target helper that already defines bundle_host_workers is used as-is (orchestrator copy never read)', () => {
  const dir = fixture();
  const r = run(`
    bundle_host_workers() { echo target-version; }
    source "${lib}"
    papercusp_ensure_host_worker_bundler "${dir}/does-not-exist.sh" || exit 9
    bundle_host_workers
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'target-version');
});

test('no function anywhere fails loudly instead of reaching "command not found"', () => {
  const dir = fixture();
  const missing = run(`
    source "${dir}/target-common.sh"
    source "${lib}"
    papercusp_ensure_host_worker_bundler "${dir}/does-not-exist.sh"
  `);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /FATAL: .*does not define bundle_host_workers/);

  const incomplete = run(`
    source "${dir}/target-common.sh"
    source "${lib}"
    papercusp_ensure_host_worker_bundler "${dir}/target-common.sh"
  `);
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /FATAL: orchestrator helper .* does not define/);
});

test('build-desktop-sidecar.sh resolves the bundler right after the target helper, before calling it', () => {
  const sourceAt = builder.indexOf('source "$WEB_DIR/bin/bundle-host-common.sh"');
  const ensureAt = builder.indexOf(
    'papercusp_ensure_host_worker_bundler "$HERE/../../apps/operator/bin/bundle-host-common.sh"',
  );
  const callAt = builder.indexOf('bundle_host_workers "$REPO_ROOT" "$SIDECAR_DIR"');
  assert.ok(sourceAt > 0 && ensureAt > sourceAt && callAt > ensureAt, `${sourceAt} ${ensureAt} ${callAt}`);
});

// The optional standalone sibling follows the TARGET revision, unlike the
// required worker composer. Execute the real caller block against each helper
// contract so an older exact-source release never calls a missing function.
for (const [name, definition, expected] of [
  ['old target keeps its full-host route', '', 0],
  ['current target builds its standalone sibling', 'bundle_host_spawner() { echo "standalone $1 -> $2"; }', 0],
  ['current target build failure fails the release', 'bundle_host_spawner() { echo "standalone refused" >&2; return 7; }', 1],
]) {
  test(name, () => {
    const block = builder.match(/^if declare -F bundle_host_spawner[\s\S]*?^fi$/m)?.[0];
    assert.ok(block, 'maintained standalone target gate is missing');
    const result = run([
      'set -euo pipefail', 'REPO_ROOT=/target', 'SIDECAR_DIR=/output',
      'MINIFY_ARGS=(); VERSION_DEFINE_ARGS=(); HOST_EXTERNALS=()', definition, block,
    ].join('\n'));
    assert.equal(result.status, expected, result.stderr);
    if (!definition) assert.match(result.stdout, /target helper predates standalone spawner/);
    else if (expected === 0) assert.match(result.stdout, /standalone \/target -> \/output/);
    else assert.match(result.stderr, /standalone refused/);
  });
}

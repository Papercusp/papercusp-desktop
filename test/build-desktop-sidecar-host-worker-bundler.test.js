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
      'HOST_WORKER_OUTPUTS=(a.script.mjs "b worker.mjs" role-codex-home.worker.mjs)\n' +
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
    echo "outputs=\${#HOST_WORKER_OUTPUTS[@]}:\${HOST_WORKER_OUTPUTS[2]}"
    bundle_host_workers /src /out
  `);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /externals=--external:target-only$/m);
  assert.match(r.stdout, /outputs=3:role-codex-home\.worker\.mjs$/m);
  assert.match(r.stdout, /bundled \/src -> \/out \(3\)$/m);
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

test('an imported worker composer retains its required witness helper dependencies', () => {
  const dir = fixture();
  fs.appendFileSync(path.join(dir, 'orch-common.sh'), [
    'bundle_host_verify_testing_core() { echo "verified $1"; }',
    'bundle_host_prepare_testing_core() { bundle_host_verify_testing_core "$1"; }',
    'bundle_host_workers() { bundle_host_prepare_testing_core "$1"; echo "workers $2"; }',
    '',
  ].join('\n'));
  const r = run([
    'set -euo pipefail', `source "${dir}/target-common.sh"`, `source "${lib}"`,
    `papercusp_ensure_host_worker_bundler "${dir}/orch-common.sh"`,
    'bundle_host_workers /source /output',
    'echo "externals=${HOST_COMMON_EXTERNALS[*]}"',
  ].join('\n'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verified \/source/);
  assert.match(r.stdout, /workers \/output/);
  assert.match(r.stdout, /externals=--external:target-only/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('imported testing-core recipes retain fixture/degradation helpers and global state', () => {
  const dir = fixture();
  fs.appendFileSync(path.join(dir, 'orch-common.sh'), [
    'BUNDLE_HOST_TESTING_CORE_UNWITNESSED=unwitnessed:legacy',
    'BUNDLE_HOST_TESTING_CORE_DEGRADED=unwitnessed:refused',
    'BUNDLE_HOST_TESTING_CORE_FIXTURE=unwitnessed:fixture',
    'BUNDLE_HOST_TESTING_CORE_WORKER_ARGS=(entry.ts --bundle)',
    'bundle_host_testing_core_fixture_opt_in() { return 1; }',
    'bundle_host_degrade_testing_core() { echo "$BUNDLE_HOST_TESTING_CORE_DEGRADED ${BUNDLE_HOST_TESTING_CORE_WORKER_ARGS[*]}"; }',
    'bundle_host_prepare_testing_core() { bundle_host_testing_core_fixture_opt_in || bundle_host_degrade_testing_core; }',
    'bundle_host_workers() { bundle_host_prepare_testing_core; }', '',
  ].join('\n'));
  try {
    const r = run(['set -euo pipefail', `source "${dir}/target-common.sh"`, `source "${lib}"`,
      `papercusp_ensure_host_worker_bundler "${dir}/orch-common.sh"`, 'bundle_host_workers',
      'echo "$BUNDLE_HOST_TESTING_CORE_UNWITNESSED $BUNDLE_HOST_TESTING_CORE_FIXTURE"',
    ].join('\n'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /unwitnessed:refused entry.ts --bundle/);
    assert.match(r.stdout, /unwitnessed:legacy unwitnessed:fixture/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the real sidecar recipe adapter supports a target predating replay identity', () => {
  const dir = fixture();
  const mono = path.resolve(root, '..');
  const block = builder.match(/^for _pc_recipe in [\s\S]*?^BUNDLE_HOST_ESBUILD_PATH=.*$/m)?.[0];
  assert.ok(block, 'maintained recipe adapter is missing');
  try {
    const r = run(['set -euo pipefail', `source "${dir}/target-common.sh"`,
      `HERE="${mono}/papercusp-desktop/bin"`, block,
      `bundle_host_replay_identity_define "${dir}"`,
      'bundle_host_testing_core_fixture_opt_in && exit 88',
      'echo "$BUNDLE_HOST_TESTING_CORE_UNWITNESSED $BUNDLE_HOST_TESTING_CORE_DEGRADED"',
      'declare -F bundle_host_degrade_testing_core >/dev/null',
      'echo "externals=${HOST_COMMON_EXTERNALS[*]}"',
    ].join('\n'));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /RETAINED_REPLAY_SOURCE_SHA256__=undefined/);
    assert.match(r.stdout, /unwitnessed:helper-not-committed unwitnessed:custody-refused/);
    assert.match(r.stdout, /externals=--external:target-only/);
    assert.doesNotMatch(r.stderr, /command not found|unbound variable/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

function historicalSource(dir) {
  for (const [file, body] of Object.entries({
    'packages/operator-core/lib/agent-tools/testing/run.ts': 'export default {};\n',
    'apps/operator/bin/bundle-host-common.sh': '# historical helper\n',
    'apps/operator/bin/serve.ts': 'console.log("historical host");\n',
    'apps/operator/bin/ascii-escape-bundle.mjs': '// fixture syntax check\n',
    'scripts/npm-install-safe.mjs': '// fixture cache lease\n',
  })) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
}

test('the real imported primary packages a historical runtime without compiling or inventing a testing core', () => {
  const dir = fixture();
  historicalSource(dir);
  const mono = path.resolve(root, '..');
  const block = builder.match(/^for _pc_recipe in [\s\S]*?^BUNDLE_HOST_ESBUILD_PATH=.*$/m)?.[0];
  try {
    const result = run([
      'set -euo pipefail', `source "${dir}/target-common.sh"`, `source "${lib}"`,
      `HERE="${mono}/papercusp-desktop/bin"`, block,
      `papercusp_preflight_host_recipes "${dir}" "${mono}/apps/operator/bin/bundle-host-common.sh"`,
      `papercusp_configure_host_testing_core "${dir}"`,
      'HOST_BANNER=""; HOST_BANNER_DEFINES=(); NATIVE_PKGS=()',
      'bundle_host_esbuild() { printf "compile %s\\n" "$*"; for arg in "$@"; do case "$arg" in --outfile=*) printf "host" > "${arg#--outfile=}";; esac; done; }',
      `bundle_host_primary "${dir}" "${dir}/out"`,
    ].join('\n'));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, 'out/serve.mjs'), 'utf8'), 'host');
    assert.match(result.stdout, /--define:__PAPERCUSP_TESTING_CORE_WITNESS__=undefined/);
    assert.doesNotMatch(result.stdout, /testing-core[.]worker/);
    assert.equal(fs.existsSync(path.join(dir, 'out/testing-core.worker.witness.json')), false);
    assert.match(result.stderr, /preserving its worker graph/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('partial current testing-core contracts fail preflight and never replace the current recipe', () => {
  const dir = fixture();
  historicalSource(dir);
  const worker = path.join(dir, 'packages/operator-core/lib/agent-tools/testing/testing-core.worker.ts');
  const runtime = path.join(dir, 'packages/operator-core/lib/agent-tools/testing/run.ts');
  const helper = path.join(dir, 'scripts/lib/testing-core-witness.mjs');
  const check = () => run(`set -euo pipefail\nsource "${lib}"\npapercusp_configure_host_testing_core "${dir}"`);
  try {
    fs.mkdirSync(path.dirname(helper), { recursive: true });
    fs.writeFileSync(helper, '// helper\n');
    assert.notEqual(check().status, 0, 'helper without runtime/worker must fail');
    fs.rmSync(helper);
    fs.writeFileSync(runtime, "new URL('./testing-core.worker.mjs', import.meta.url);\n");
    assert.notEqual(check().status, 0, 'runtime with missing worker/helper must fail');
    fs.writeFileSync(worker, '// current worker\n');
    assert.notEqual(check().status, 0, 'missing witness helper must fail');
    fs.writeFileSync(helper, '// helper\n');
    const current = run(`set -euo pipefail\nsource "${lib}"\nbundle_host_prepare_testing_core() { echo current-recipe; }\npapercusp_configure_host_testing_core "${dir}"\nbundle_host_prepare_testing_core`);
    assert.equal(current.status, 0, current.stderr);
    assert.equal(current.stdout.trim(), 'current-recipe');
    fs.writeFileSync(worker, '');
    assert.notEqual(check().status, 0, 'empty current worker must fail');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('early source preflight rejects replay closure and primary input gaps before expensive build phases', () => {
  const dir = fixture();
  historicalSource(dir);
  const common = path.resolve(root, '../apps/operator/bin/bundle-host-common.sh');
  const preflight = () => run(`set -euo pipefail\nsource "${lib}"\npapercusp_preflight_host_recipes "${dir}" "${common}"`);
  try {
    assert.equal(preflight().status, 0);
    const identity = path.join(dir, 'packages/operator-core/lib/retained-replay-identity.ts');
    fs.writeFileSync(identity, '// current identity\n');
    assert.notEqual(preflight().status, 0, 'partial replay feature must fail');
    fs.writeFileSync(path.join(path.dirname(identity), 'retained-replay-sources.json'), '["missing.ts"]');
    assert.notEqual(preflight().status, 0, 'missing replay input must fail');
    fs.rmSync(identity);
    fs.rmSync(path.join(path.dirname(identity), 'retained-replay-sources.json'));
    fs.rmSync(path.join(dir, 'apps/operator/bin/ascii-escape-bundle.mjs'));
    const missing = preflight();
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing host recipe input.*ascii-escape-bundle/);
    const preflightAt = builder.indexOf('papercusp_preflight_host_recipes "$REPO_ROOT"');
    assert.ok(preflightAt > 0 && preflightAt < builder.indexOf('--preflight-vulnerabilities --refresh-db'));
    assert.ok(preflightAt < builder.indexOf('→ building operator-vite SPA'));
    assert.match(builder, /papercusp_configure_host_testing_core "\$REPO_ROOT" \|\| exit 1/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

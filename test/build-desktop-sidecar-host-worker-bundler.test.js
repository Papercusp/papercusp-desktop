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
const { historicalSource } = require('./host-source-fixture.cjs');

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

function historicalQualificationSource(dir) {
  const files = {
    'packages/operator-core/package.json': '{"name":"@papercusp/operator-core","exports":{"./lib/*":"./lib/*.ts"}}',
    'packages/operator-core/lib/agent-tools/index.ts': 'export const registry = [];\n',
    'packages/operator-core/lib/prompt-assembly.ts': `
export const PROMPT_ROLES = ['operator'];
export const CHAT_ROLE_DOCUMENT_KINDS = ['persona', 'converse', 'tools'];
export function resolveChatRoleDocument() { return null; }
export function chatRoleDocumentFilePath(role, kind) { return '/missing/' + role + '.' + kind + '.md'; }
export function chatRoleDocumentCandidates(role, kind) { return [chatRoleDocumentFilePath(role, kind)]; }
function missing(role, kind) {
  throw Error('prompt-assembly: ' + role + '.' + kind + '.md not found at ' +
    chatRoleDocumentFilePath(role, kind) + ' (nor at any of the prompt-chain candidates: ). ' +
    (kind === 'persona' ? 'Every role must have a persona.md.' : 'Required for chat-mode roles.'));
}
export function loadRolePersona(role) { return missing(role, 'persona'); }
export function loadRoleConverse(role) { return missing(role, 'converse'); }
export function loadRoleToolsMd() { return null; }
`,
  };
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), body);
  }
  fs.mkdirSync(path.join(dir, 'node_modules/@papercusp'), { recursive: true });
  fs.symlinkSync(path.join(dir, 'packages/operator-core'), path.join(dir, 'node_modules/@papercusp/operator-core'));
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

test('handler runtime preflight requires the complete current feature or a fully historical source', () => {
  const dir = fixture();
  historicalSource(dir);
  const base = path.join(dir, 'packages/plugin-loader');
  const manifest = path.join(base, 'package.json');
  const supervisor = path.join(base, 'src/daemon/supervisor.ts');
  const files = ['handler-bootstrap.ts', 'handler-runtime.ts', 'handler-seccomp.ts',
    'handler-runtime-build.ts', 'handler-installation.ts'].map(file => path.join(base, 'src/daemon', file));
  const check = () => run(`set -euo pipefail\nsource "${lib}"\npapercusp_host_handler_runtime_contract "${dir}"`);
  try {
    assert.equal(check().stdout.trim(), 'historical');
    fs.writeFileSync(manifest, '{"dependencies":{"koffi":"3.3.7"}}');
    assert.notEqual(check().status, 0, 'a Koffi pin alone is not the handler feature');
    fs.writeFileSync(supervisor, "import './handler-runtime';\n");
    for (const file of files) fs.writeFileSync(file, '// handler source\n');
    assert.equal(check().stdout.trim(), 'current');
    for (const file of files) {
      fs.rmSync(file);
      assert.notEqual(check().status, 0, `missing ${path.basename(file)} must fail early`);
      fs.writeFileSync(file, '// handler source\n');
    }
    fs.writeFileSync(manifest, '{"dependencies":{"koffi":"^3.3.7"}}');
    assert.notEqual(check().status, 0, 'unpinned Koffi must fail');
    fs.writeFileSync(manifest, '{"dependencies":{}}');
    assert.notEqual(check().status, 0, 'current runtime without Koffi must fail');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('real Koffi fetch and handler packaging blocks follow the validated target feature', () => {
  const dir = fixture();
  const koffi = builder.match(/^if \[\[ "\$PAPERCUSP_HANDLER_RUNTIME_CONTRACT" == current \]\]; then[\s\S]*?^fi$/m)?.[0];
  const handler = builder.match(/^if \[\[ "\$target_os" == linux && "\$PAPERCUSP_HANDLER_RUNTIME_CONTRACT" == current \]\]; then[\s\S]*?^fi$/m)?.[0];
  assert.ok(koffi && handler, 'both native runtime stages must follow the target contract');
  try {
    const execute = (contract, pin) => run([
      'set -euo pipefail', `SIDECAR_DIR="${dir}"`, '_bare_node_platform=linux; TARGET_ARCH=x64',
      `PAPERCUSP_HANDLER_RUNTIME_CONTRACT=${contract}`, 'target_os=linux; target_arch=x64; node_dst=/node',
      `opt_dep_version() { printf '%s' '${pin}'; }`,
      'fetch_cross_npm_pkg() { echo "fetch $1"; }',
      'stage_handler_runtime() { echo "stage $1 $2"; }', koffi, handler,
    ].join('\n'));
    const old = execute('historical', '');
    assert.equal(old.status, 0, old.stderr);
    assert.equal(old.stdout, '', 'historical packaging must not inject a native runtime');
    const missing = execute('current', '');
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /Koffi target pin missing/);
    const current = execute('current', '3.3.7');
    assert.equal(current.status, 0, current.stderr);
    assert.match(current.stdout, /fetch @koromix\/koffi-linux-x64@3.3.7/);
    assert.match(current.stdout, /stage \/node x64/);
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

test('vm-release selects historical diagnostics or complete native probes and refuses partial capabilities early', () => {
  const dir = fixture();
  historicalSource(dir);
  const serve = path.join(dir, 'apps/operator/bin/serve.ts');
  const check = (profile = 'vm-release') => run(`set -euo pipefail\nsource "${lib}"\npapercusp_preflight_host_qualification "${dir}" "${profile}"`);
  const boot = '  if (argv[0] === "--verify-boot-imports") {\n    console.log("PAPERCUSP_BOOT_IMPORTS_OK");\n    process.exit(0);\n  }\n';
  const prompts = '  if (argv[0] === "--verify-role-prompts") {\n    console.log("PAPERCUSP_ROLE_PROMPT_ASSETS ");\n    process.exit(0);\n  }\n';
  const main = (body) => `async function main(): Promise<void> {\n${body}\n}\n`;
  try {
    const historical = check();
    assert.notEqual(historical.status, 0);
    assert.match(historical.stderr, /prompt-assembly/);
    assert.equal(check('dogfood').status, 0, 'historical dogfood is not a vm-release qualification claim');
    historicalQualificationSource(dir);
    assert.equal(check().stdout.trim(), 'diagnostic');
    const prompt = path.join(dir, 'packages/operator-core/lib/prompt-assembly.ts');
    const complete = fs.readFileSync(prompt, 'utf8');
    fs.writeFileSync(prompt, complete.replace('export function loadRolePersona', 'function loadRolePersona'));
    assert.match(check().stderr, /historical prompt qualification capability unavailable: loadRolePersona/);
    fs.writeFileSync(prompt, complete);
    for (const body of [boot, prompts, boot + prompts.replace('PAPERCUSP_ROLE_PROMPT_ASSETS ', 'wrong receipt'),
      boot.replace('process.exit(0)', 'process.exit(1)') + prompts,
      '  assertVmReleaseRuntimePolicy({});\n' + boot + prompts,
      '// flags alone are not dispatch: --verify-boot-imports --verify-role-prompts\n']) {
      fs.writeFileSync(serve, main(body));
      assert.notEqual(check().status, 0, body);
    }
    fs.writeFileSync(serve, main(boot + prompts + '  assertVmReleaseRuntimePolicy({});\n'));
    assert.equal(check().status, 0, 'complete early source contract must pass');
    assert.equal(check().stdout.trim(), 'native');
    fs.copyFileSync(path.resolve(root, '../apps/operator/bin/serve.ts'), serve);
    assert.equal(check().status, 0, 'maintained current source must pass');
    const guard = builder.indexOf('papercusp_preflight_host_qualification "$REPO_ROOT" "$DISTRIBUTION_PROFILE"');
    assert.ok(guard > 0 && guard < builder.indexOf('--preflight-vulnerabilities --refresh-db'));
    assert.ok(guard < builder.indexOf('→ building operator-vite SPA'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('historical diagnostic compiles only the selected registry and verifies actual prompt refusal behavior', () => {
  const dir = fixture();
  const source = path.join(dir, 'source');
  const out = path.join(dir, 'out');
  const esbuild = require.resolve('esbuild/bin/esbuild');
  const git = spawnSync('git', ['clone', '--quiet', '--shared', '--no-checkout', path.resolve(root, '..'), source], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  historicalSource(source);
  historicalQualificationSource(source);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'serve.mjs'), 'throw Error("installed serve must stay untouched");\n');
  const original = fs.readFileSync(path.join(out, 'serve.mjs'));
  // The real frozen cache runner consumes stdin for its lease adapter. A
  // compiler fixture that inherited stdin masked this production boundary.
  const build = () => run(`set -euo pipefail\nsource "${lib}"\nHOST_BANNER=''; HOST_BANNER_DEFINES=()\nbundle_host_esbuild() { shift; "${esbuild}" "$@" </dev/null; }\npapercusp_bundle_host_qualification "${source}" "${out}"`);
  const probe = flag => spawnSync(process.execPath, [path.join(out, 'sidecar-qualification.mjs'), flag], { encoding: 'utf8' });
  try {
    const built = build();
    assert.equal(built.status, 0, built.stderr);
    assert.equal(fs.existsSync(path.join(out, '.sidecar-qualification-entry.ts')), false);
    assert.deepEqual(fs.readFileSync(path.join(out, 'serve.mjs')), original);
    assert.equal(probe('--verify-boot-imports').stdout.trim(), 'PAPERCUSP_BOOT_IMPORTS_OK');
    const prompts = probe('--verify-role-prompts');
    assert.equal(prompts.status, 0, prompts.stderr);
    const receipt = JSON.parse(prompts.stdout.trim().slice('PAPERCUSP_ROLE_PROMPT_ASSETS '.length));
    assert.equal(receipt.installedUseVerified, false);
    assert.deepEqual(receipt.documents.map(doc => [doc.disposition, doc.refusalVerified]),
      [['unavailable', true], ['unavailable', true], ['optional-absent', false]]);
    assert.notEqual(probe('--unknown').status, 0);
    const binding = JSON.parse(fs.readFileSync(path.join(out, 'sidecar-qualification.json')));
    assert.equal(binding.sourceSha, spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim());
    const promptFile = path.join(source, 'packages/operator-core/lib/prompt-assembly.ts');
    const originalPrompt = fs.readFileSync(promptFile, 'utf8');
    fs.writeFileSync(promptFile, originalPrompt.replace('return null;', "return { text: 'SYNTHETIC_PROMPT' };"));
    fs.rmSync(path.join(out, 'sidecar-qualification.json'));
    assert.equal(build().status, 0);
    const present = JSON.parse(probe('--verify-role-prompts').stdout.trim().slice('PAPERCUSP_ROLE_PROMPT_ASSETS '.length));
    const expectedHash = require('node:crypto').createHash('sha256').update('SYNTHETIC_PROMPT').digest('hex');
    assert.ok(present.documents.every(doc => doc.disposition === 'available' && doc.sha256 === expectedHash && doc.refusalVerified === false));
    fs.writeFileSync(promptFile, originalPrompt.replace("return missing(role, 'persona');", "return '';// not a refusal\n"));
    fs.rmSync(path.join(out, 'sidecar-qualification.json'));
    assert.equal(build().status, 0);
    const refused = probe('--verify-role-prompts');
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /HISTORICAL_PROMPT_REFUSAL_UNVERIFIED/);
    fs.writeFileSync(promptFile, originalPrompt);
    fs.writeFileSync(path.join(source, 'packages/operator-core/lib/agent-tools/index.ts'),
      "import { loadRolePersona } from '../prompt-assembly';\nexport const eager = loadRolePersona('oracle');\n");
    fs.rmSync(path.join(out, 'sidecar-qualification.json'));
    assert.equal(build().status, 0);
    const eager = probe('--verify-boot-imports');
    assert.notEqual(eager.status, 0, 'a frozen eager persona read must never produce qualification');
    assert.match(eager.stderr, /oracle.persona.md not found/);
    assert.doesNotMatch(eager.stdout, /PAPERCUSP_BOOT_IMPORTS_OK/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('frozen packaging repairs eager persona reads and the guarded root walk without changing source or IO grants', () => {
  const dir = fixture();
  const source = path.join(dir, 'source');
  const out = path.join(dir, 'out');
  const esbuild = require.resolve('esbuild/bin/esbuild');
  const git = spawnSync('git', ['clone', '--quiet', '--shared', '--no-checkout', path.resolve(root, '..'), source], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  historicalSource(source);
  historicalQualificationSource(source);
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(dir, 'packages'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"outside-image"}');
  const promptSource = `
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
let boundary = dirname(fileURLToPath(import.meta.url));
while (!(existsSync(join(boundary, 'package.json')) && existsSync(join(boundary, 'packages')))) {
  const parent = dirname(boundary);
  if (parent === boundary) throw Error('FROZEN_ROOT_BOUNDARY_MISSING');
  boundary = parent;
}
readFileSync(join(boundary, 'package.json'), 'utf8');
export const PROMPT_ROLES = ['operator', 'oracle', 'papercup-deep'];
export const CHAT_ROLE_DOCUMENT_KINDS = ['persona', 'converse', 'tools'];
function promptsDir() {
  const explicit = process.env.PAPERCUSP_PROMPTS_DIR;
  return explicit && existsSync(explicit) ? explicit : join(process.cwd(), 'apps/operator/prompts');
}
export function chatRoleDocumentFilePath(role, kind) { return join(promptsDir(), role + '.' + kind + '.md'); }
export function chatRoleDocumentCandidates(role, kind) { return [chatRoleDocumentFilePath(role, kind)]; }
export function resolveChatRoleDocument(role, kind) {
  const file = chatRoleDocumentFilePath(role, kind);
  return existsSync(file) ? { path: file, text: readFileSync(file, 'utf8') } : null;
}
export function loadRolePersona(role) {
  const hit = resolveChatRoleDocument(role, 'persona');
  if (!hit) throw Error(role + '.persona.md was pruned');
  return hit.text;
}
export function loadRoleConverse(role) { return resolveChatRoleDocument(role, 'converse').text; }
export function loadRoleToolsMd(role) { return resolveChatRoleDocument(role, 'tools')?.text ?? null; }
`;
  fs.writeFileSync(path.join(source, 'packages/operator-core/lib/prompt-assembly.ts'), promptSource);
  fs.writeFileSync(path.join(source, 'packages/operator-core/lib/agent-tools/index.ts'),
    "import { loadRolePersona } from '../prompt-assembly'; export const eager = loadRolePersona('oracle');\n");
  const expected = new Map();
  for (const role of ['operator', 'oracle', 'papercup-deep']) for (const kind of ['persona', 'converse', 'tools']) {
    const rel = `apps/operator/prompts/${role}.${kind}.md`;
    const bytes = Buffer.from(`# frozen ${role}.${kind}\nΩ exact source bytes\n`);
    fs.mkdirSync(path.dirname(path.join(source, rel)), { recursive: true });
    fs.writeFileSync(path.join(source, rel), bytes);
    expected.set(rel, bytes);
  }
  fs.writeFileSync(path.join(out, 'serve.mjs'), 'throw Error("installed serve stays unchanged");\n');
  const serve = fs.readFileSync(path.join(out, 'serve.mjs'));
  const compile = () => run(`set -euo pipefail\nsource "${lib}"\nHOST_BANNER=''; HOST_BANNER_DEFINES=()\nbundle_host_esbuild() { shift; "${esbuild}" "$@" </dev/null; }\npapercusp_bundle_host_qualification "${source}" "${out}"`);
  const stage = () => run(`set -euo pipefail\nsource "${lib}"\npapercusp_stage_host_qualification_assets "${source}" "${out}"`);
  const verifier = fs.readFileSync(path.join(root, 'bin/verify-sidecar-bundle.sh'), 'utf8');
  const start = verifier.indexOf('check_boot_import_closure() {');
  const end = verifier.indexOf('\nif [[ "$CROSS" == "0" ]]; then', start);
  assert.ok(start >= 0 && end > start);
  const check = phase => run(`set -euo pipefail\nREQUIRED_NATIVE_MODULES=fixture-native\n${verifier.slice(start, end)}\ncheck_boot_import_closure "${out}" "${phase}"`);
  const audit = () => spawnSync('python3', [path.join(root, 'bin/audit-release-bundle.py'), '--prune-vm-release', out],
    { encoding: 'utf8', env: { ...process.env, PAPERCUSP_BUILD_SHA: 'a'.repeat(40), PAPERCUSP_DESKTOP_VERSION: '1.0.0' } });
  try {
    const compiled = compile();
    assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
    fs.mkdirSync(path.join(out, 'bin'));
    fs.symlinkSync(process.execPath, path.join(out, 'bin/node'));
    fs.mkdirSync(path.join(out, 'node_modules/fixture-native'), { recursive: true });
    fs.writeFileSync(path.join(out, 'node_modules/fixture-native/index.js'), 'module.exports = {};\n');
    const missingPersona = check('boot');
    assert.notEqual(missingPersona.status, 0);
    assert.match(missingPersona.stderr, /oracle.persona.md was pruned/);
    const outsideWalk = check('prompts');
    assert.notEqual(outsideWalk.status, 0);
    assert.match(outsideWalk.stderr, /ERR_ACCESS_DENIED/);
    const bindingPath = path.join(out, 'sidecar-qualification.json');
    const originalBinding = fs.readFileSync(bindingPath);
    const retainedBinding = path.join(dir, 'retained-binding.json');
    fs.linkSync(bindingPath, retainedBinding);
    const staged = stage();
    assert.equal(staged.status, 0, staged.stderr);
    assert.deepEqual(fs.readFileSync(retainedBinding), originalBinding, 'retained hardlinks must not be mutated');
    const binding = JSON.parse(fs.readFileSync(bindingPath));
    assert.deepEqual(binding.packaging.promptAssets.map(asset => asset.file), [...expected.keys()]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'package.json'))).type, undefined);
    fs.writeFileSync(path.join(out, 'apps/operator/prompts/unreferenced.persona.md'), 'not a loader asset');
    const pruned = audit();
    assert.equal(pruned.status, 0, pruned.stderr);
    assert.equal(fs.existsSync(path.join(out, 'apps/operator/prompts/unreferenced.persona.md')), false);
    for (const [file, bytes] of expected) {
      assert.deepEqual(fs.readFileSync(path.join(out, file)), bytes);
      assert.deepEqual(fs.readFileSync(path.join(source, file)), bytes);
    }
    assert.deepEqual(fs.readFileSync(path.join(out, 'serve.mjs')), serve);
    assert.equal(fs.readFileSync(path.join(source, 'packages/operator-core/lib/prompt-assembly.ts'), 'utf8'), promptSource);
    for (const phase of ['boot', 'prompts']) {
      const result = check(phase);
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const last = [...expected.keys()].at(-1);
    fs.writeFileSync(path.join(out, last), 'tampered');
    assert.match(check('prompts').stderr, /QUALIFICATION_PACKAGING_INVALID/);
    fs.writeFileSync(path.join(out, last), expected.get(last));
    fs.unlinkSync(path.join(out, last));
    assert.match(check('boot').stderr, /QUALIFICATION_PACKAGING_INVALID/);
    const outside = path.join(dir, 'outside-prompt.md');
    fs.writeFileSync(outside, expected.get(last));
    fs.symlinkSync(outside, path.join(out, last));
    assert.match(check('prompts').stderr, /QUALIFICATION_PACKAGING_INVALID/);
    fs.unlinkSync(path.join(out, last));
    fs.writeFileSync(path.join(out, last), expected.get(last));
    // Frozen DBOS boot identity starts an unconditional Git lookup at module
    // evaluation. A receipt alone must never turn this into accepted no-IO proof.
    fs.writeFileSync(path.join(source, 'packages/operator-core/lib/agent-tools/index.ts'),
      "import { execFile } from 'node:child_process'; import { promisify } from 'node:util';\n" +
      "async function resolveHead() { try { await promisify(execFile)('git', ['rev-parse', 'HEAD']); } catch { return null; } }\n" +
      "export const bootIdentity = { bootCommit: resolveHead() };\n");
    fs.unlinkSync(bindingPath);
    const eagerBuild = compile();
    assert.equal(eagerBuild.status, 0, eagerBuild.stderr);
    const eagerStage = stage();
    assert.equal(eagerStage.status, 0, eagerStage.stderr);
    const eagerIO = check('boot');
    assert.notEqual(eagerIO.status, 0);
    assert.match(eagerIO.stderr, /"receiptObserved":true/);
    assert.match(eagerIO.stderr, /BOOT_IMPORT_IO_FORBIDDEN/);
    assert.match(eagerIO.stderr, /child_process.execFile/);
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

# shellcheck shell=bash
# Resolve bundle_host_workers for build-desktop-sidecar.sh across an orchestrator/target split.
#
# Exact-source release cuts run the CURRENT orchestrator's build-desktop-sidecar.sh against a
# FROZEN target tree (EI-21078401508503033). The target tree's apps/operator/bin/
# bundle-host-common.sh is sourced first on purpose: its esbuild boundary (HOST_BANNER,
# NATIVE_PKGS, HOST_COMMON_EXTERNALS) must match the TARGET's host import graph.
#
# bundle_host_workers is different. The orchestrator script CALLS it, so under that same rule it
# has to follow the orchestrator's revision. A target older than the shared worker bundler
# (superproject c809329d3f, 2026-09-27) does not define it at all, and the cut died with
# "bundle_host_workers: command not found" after the SPA and serve.mjs were already built
# (WI-10003497: the 0.0.22-alpha cut of 7708e704).
#
# papercusp_ensure_host_worker_bundler <orchestrator bundle-host-common.sh>
#   No-op when the already-sourced target helper defines bundle_host_workers. Otherwise it
#   imports bundle_host_workers, its helper dependencies and HOST_WORKER_OUTPUTS from the orchestrator's copy. It
#   never re-sources that copy into this shell: the helper's load-once guard would turn a
#   re-source into a silent no-op, and a real re-source would replace the target's esbuild
#   boundary variables.

# The current producer can target a revision from before the detached testing
# core existed. Absence is historical only when its runtime, worker and witness
# helper agree. A damaged current checkout must never acquire the legacy route.
papercusp_host_testing_core_contract() { # <target repo root>
  local root="$1" runtime="$1/packages/operator-core/lib/agent-tools/testing/run.ts"
  local worker="$1/packages/operator-core/lib/agent-tools/testing/testing-core.worker.ts"
  local helper="$1/scripts/lib/testing-core-witness.mjs" required=0
  [[ -s "$runtime" ]] || { echo "FATAL: missing testing runtime $runtime" >&2; return 1; }
  if grep -Eq 'testing-core[.]worker|__PAPERCUSP_TESTING_CORE_WITNESS__' "$runtime"; then required=1; fi
  if [[ ! -e "$worker" && ! -e "$helper" && "$required" == 0 ]]; then
    printf '%s\n' historical
  elif [[ -s "$worker" && -s "$helper" && "$required" == 1 ]]; then
    printf '%s\n' witnessed
  else
    echo "FATAL: incomplete target testing-core contract: runtime=$runtime worker=$worker helper=$helper" >&2
    return 1
  fi
}

papercusp_host_handler_runtime_contract() { # <target repo root>
  node --input-type=module - "$1" <<'NODE'
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const root = process.argv[2];
const base = 'packages/plugin-loader';
const manifest = JSON.parse(readFileSync(resolve(root, base, 'package.json'), 'utf8'));
const supervisor = readFileSync(resolve(root, base, 'src/daemon/supervisor.ts'), 'utf8');
const files = ['handler-bootstrap.ts', 'handler-runtime.ts', 'handler-seccomp.ts',
  'handler-runtime-build.ts', 'handler-installation.ts'].map(file => resolve(root, base, 'src/daemon', file));
const pin = manifest.dependencies?.koffi;
const references = /handler-runtime|handler-bootstrap|handler-seccomp/.test(supervisor);
if (!pin && !references && files.every(file => !existsSync(file))) {
  console.log('historical');
} else if (typeof pin === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pin)
    && references && files.every(file => existsSync(file) && statSync(file).isFile() && statSync(file).size > 0)) {
  console.log('current');
} else {
  throw new Error('incomplete target handler runtime: require matching supervisor, source closure and exact Koffi pin');
}
NODE
}

papercusp_preflight_host_recipes() { # <target repo root> <producer common helper>
  local root="$1" common="$2" input
  papercusp_host_testing_core_contract "$root" >/dev/null || return 1
  PAPERCUSP_HANDLER_RUNTIME_CONTRACT="$(papercusp_host_handler_runtime_contract "$root")" || return 1
  for input in apps/operator/bin/bundle-host-common.sh apps/operator/bin/serve.ts \
    apps/operator/bin/ascii-escape-bundle.mjs scripts/npm-install-safe.mjs; do
    [[ -s "$root/$input" ]] || { echo "FATAL: missing host recipe input $root/$input" >&2; return 1; }
  done
  # Exercise the maintained replay manifest reader before scanner downloads or
  # SPA compilation. It validates partial features and every named source input.
  env -u PAPERCUSP_BUNDLE_HOST_COMMON_LOADED bash -c '
    set -euo pipefail
    source "$1"
    bundle_host_replay_identity_define "$2" >/dev/null
  ' _ "$common" "$root"
}

# The final verifier invokes these read-only CLI seams. Older serve entrypoints
# interpret unknown flags as normal startup, so an immutable-policy error is a
# misleading late symptom. D-100 permits a producer-owned diagnostic compiled
# from the selected target's own registry and prompt resolver, never new product
# code. A partial native seam cannot fall back to this historical route.
papercusp_preflight_host_qualification() { # <target repo root> <distribution profile>
  [[ "$2" == vm-release ]] || return 0
  node --input-type=module - "$1" <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const file = resolve(process.argv[2], 'apps/operator/bin/serve.ts');
const source = readFileSync(file, 'utf8');
const main = source.slice(source.indexOf('async function main('));
const policy = main.indexOf('assertVmReleaseRuntimePolicy(');
let native = 0;
for (const [flag, receipt] of [['--verify-boot-imports', 'PAPERCUSP_BOOT_IMPORTS_OK'],
    ['--verify-role-prompts', 'PAPERCUSP_ROLE_PROMPT_ASSETS ']]) {
  const branch = new RegExp('^\\s*if\\s*\\(\\s*argv\\[0\\]\\s*===\\s*["\']' + flag + '["\']\\s*\\)\\s*\\{', 'm').exec(main);
  const end = branch && main.indexOf('\n  }', branch.index);
  const body = branch && end >= 0 ? main.slice(branch.index, end) : '';
  if (!branch && !source.includes(flag)) continue;
  if (!body.includes(receipt) || !body.includes('process.exit(0)')
      || (policy >= 0 && branch.index >= policy)) {
    throw new Error(`target lacks early final-image qualification seam ${flag}: ${file}; ` +
      'unknown flags would start the runtime. Partial native probes cannot use historical diagnostics; ' +
      'refusing before scanner downloads or compilation (no product injection or verifier bypass).');
  }
  native++;
}
if (native === 2) { console.log('native'); process.exit(0); }
if (native !== 0) throw new Error('partial final-image qualification seams; need both native probes');
const prompt = readFileSync(resolve(process.argv[2], 'packages/operator-core/lib/prompt-assembly.ts'), 'utf8');
for (const name of ['PROMPT_ROLES', 'CHAT_ROLE_DOCUMENT_KINDS', 'resolveChatRoleDocument',
    'chatRoleDocumentFilePath', 'chatRoleDocumentCandidates', 'loadRolePersona', 'loadRoleConverse', 'loadRoleToolsMd']) {
  if (!new RegExp('export (?:const|function) ' + name + '\\b').test(prompt)) {
    throw new Error('historical prompt qualification capability unavailable: ' + name);
  }
}
if (!readFileSync(resolve(process.argv[2], 'packages/operator-core/lib/agent-tools/index.ts'), 'utf8').trim()) {
  throw new Error('historical tool registry qualification capability unavailable');
}
console.log('diagnostic');
NODE
}

# Reuse the primary's compiler, native boundary, source guards and banner.
# Only the observer entry is new; serve.mjs and every imported product source
# remain unchanged. Bind the observer to both serve bytes and source identity.
papercusp_bundle_host_qualification() { # <target repo root> <output dir> [esbuild args...]
  local root="$1" out="$2" route
  shift 2
  route="$(papercusp_preflight_host_qualification "$root" vm-release)" || return 1
  [[ "$route" == diagnostic ]] || return 0
  (
    cd "$root" || exit 1
    # The target's cache-lease runner owns stdin for its own JS. A named
    # generated observer entry survives that wrapper without mutating source.
    [[ ! -e "$out/.sidecar-qualification-entry.ts" ]] || exit 1
    trap 'rm -f "$out/.sidecar-qualification-entry.ts"' EXIT
    cat > "$out/.sidecar-qualification-entry.ts" <<'ENTRY'
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
const flag = process.argv[2];
if (flag === '--package-role-prompts') {
  const source = realpathSync(process.argv[3]);
  const out = realpathSync(process.argv[4]);
  if (source === out) throw Error('QUALIFICATION_PACKAGING_SOURCE_IS_OUTPUT');
  const p = await import('@papercusp/operator-core/lib/prompt-assembly');
  if (!Array.isArray(p.PROMPT_ROLES) || !p.PROMPT_ROLES.length
      || JSON.stringify(p.CHAT_ROLE_DOCUMENT_KINDS) !== '["persona","converse","tools"]') {
    throw Error('HISTORICAL_PROMPT_CAPABILITY_UNAVAILABLE: document population');
  }
  const inside = (root, file) => {
    const suffix = relative(root, realpathSync(file));
    return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep);
  };
  // Rename new files into place: retained diagnostic images may share hardlinks
  // with an unaccepted stage whose bytes must remain unchanged.
  const write = (file, bytes) => {
    mkdirSync(dirname(file), { recursive: true });
    if (!inside(out, dirname(file))) throw Error('QUALIFICATION_PACKAGING_OUTPUT_ESCAPED');
    const temp = file + '.packaging.' + process.pid;
    writeFileSync(temp, bytes, { flag: 'wx' });
    renameSync(temp, file);
  };
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const assets = [];
  const seen = new Set();
  // Derive the complete population from the selected loader. No current prompt
  // source or producer-maintained role roster may enter an historical image.
  for (const role of p.PROMPT_ROLES) for (const document of p.CHAT_ROLE_DOCUMENT_KINDS) {
    if (!/^[a-z][a-z0-9-]*$/.test(role)) throw Error('HISTORICAL_PROMPT_CAPABILITY_UNAVAILABLE: role');
    const file = 'apps/operator/prompts/' + role + '.' + document + '.md';
    if (seen.has(file)) throw Error('QUALIFICATION_PACKAGING_DUPLICATE: ' + file);
    seen.add(file);
    const hit = p.resolveChatRoleDocument(role, document,
      { harnessDir: join(source, 'libs/papercusp/packages/harness'), blueprintRoots: [] });
    if (!hit) continue;
    if (!inside(source, hit.path)) throw Error('QUALIFICATION_PROMPT_SOURCE_ESCAPED: ' + file);
    const bytes = readFileSync(hit.path);
    if (bytes.toString('utf8') !== hit.text) throw Error('QUALIFICATION_PROMPT_SOURCE_CHANGED: ' + file);
    write(join(out, file), bytes);
    assets.push({ file, sha256: hash(bytes) });
  }
  // The frozen store recognizes a monorepo root by package.json AND packages/.
  // Keep CommonJS .js helpers working: a new boundary must not set type:module.
  mkdirSync(join(out, 'packages'), { recursive: true });
  if (!inside(out, join(out, 'packages'))) throw Error('QUALIFICATION_PACKAGING_OUTPUT_ESCAPED');
  const manifestPath = join(out, 'package.json');
  const manifest = existsSync(manifestPath) ? readFileSync(manifestPath)
    : Buffer.from(JSON.stringify({ name: 'papercusp-runtime', private: true }) + '\n');
  write(manifestPath, manifest);
  const binding = join(out, 'sidecar-qualification.json');
  const receipt = JSON.parse(readFileSync(binding, 'utf8'));
  receipt.packaging = { promptAssets: assets, rootManifestSha256: hash(manifest) };
  write(binding, JSON.stringify(receipt) + '\n');
} else if (flag === '--verify-boot-imports') {
  await import('@papercusp/operator-core/lib/agent-tools/index');
  console.log('PAPERCUSP_BOOT_IMPORTS_OK');
} else if (flag === '--verify-role-prompts') {
  const p = await import('@papercusp/operator-core/lib/prompt-assembly');
  for (const key of ['resolveChatRoleDocument', 'chatRoleDocumentFilePath', 'chatRoleDocumentCandidates',
      'loadRolePersona', 'loadRoleConverse', 'loadRoleToolsMd']) {
    if (typeof p[key] !== 'function') throw Error('HISTORICAL_PROMPT_CAPABILITY_UNAVAILABLE: ' + key);
  }
  if (!Array.isArray(p.PROMPT_ROLES) || !p.PROMPT_ROLES.length
      || JSON.stringify(p.CHAT_ROLE_DOCUMENT_KINDS) !== '["persona","converse","tools"]') {
    throw Error('HISTORICAL_PROMPT_CAPABILITY_UNAVAILABLE: document population');
  }
  const documents = p.PROMPT_ROLES.flatMap(role => p.CHAT_ROLE_DOCUMENT_KINDS.map(document => {
    const required = document !== 'tools';
    const resolved = p.resolveChatRoleDocument(role, document);
    const hit = required && !resolved?.text.trim() ? null : resolved;
    let refusalVerified = false;
    if (!hit && required) {
      const expected = 'prompt-assembly: ' + role + '.' + document + '.md not found at ' +
        p.chatRoleDocumentFilePath(role, document) + ' (nor at any of the prompt-chain candidates: ' +
        p.chatRoleDocumentCandidates(role, document).slice(0, -1).join(', ') + '). ' +
        (document === 'persona' ? 'Every role must have a persona.md.' : 'Required for chat-mode roles.');
      try {
        if (document === 'persona') p.loadRolePersona(role);
        else p.loadRoleConverse(role);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== expected) throw error;
        refusalVerified = true;
      }
      if (!refusalVerified) throw Error('HISTORICAL_PROMPT_REFUSAL_UNVERIFIED: ' + role + '.' + document);
    }
    if (!hit && !required && p.loadRoleToolsMd(role) !== null) throw Error('HISTORICAL_OPTIONAL_PROMPT_MISMATCH');
    return { role, document, required, disposition: hit ? 'available' : required ? 'unavailable' : 'optional-absent',
      sha256: hit ? createHash('sha256').update(hit.text).digest('hex') : null, refusalVerified };
  }));
  console.log('PAPERCUSP_ROLE_PROMPT_ASSETS ' + JSON.stringify({ schemaVersion: 'role-prompt-assets/v1',
    roles: [...p.PROMPT_ROLES], documents, installedUseVerified: false, candidateAccepted: false }));
} else throw Error('HISTORICAL_QUALIFICATION_FLAG_INVALID');
process.exit(0);
ENTRY
    node --input-type=module - "$root" "$out/.sidecar-qualification-entry.ts" <<'NODE'
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [root, entry] = process.argv.slice(2);
let source = readFileSync(entry, 'utf8');
for (const name of ['agent-tools/index', 'prompt-assembly']) {
  source = source.replace("'@papercusp/operator-core/lib/" + name + "'",
    JSON.stringify(resolve(root, 'packages/operator-core/lib', name + '.ts')));
}
writeFileSync(entry, source);
NODE
    bundle_host_esbuild "$root" "$out/.sidecar-qualification-entry.ts" \
      --bundle --platform=node --format=esm --target=node22 \
      --outfile="$out/sidecar-qualification.mjs" --metafile="$out/sidecar-qualification.mjs.meta.json" \
      --banner:js="$HOST_BANNER" "${HOST_BANNER_DEFINES[@]}" "$@" || exit 1
  ) || return 1
  node --input-type=module - "$root" "$out" <<'NODE'
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const [root, out] = process.argv.slice(2);
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const sourceSha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw Error('qualification requires exact source commit');
writeFileSync(resolve(out, 'sidecar-qualification.json'), JSON.stringify({ schemaVersion: 'sidecar-qualification/v1',
  route: 'diagnostic', sourceSha, serveSha256: hash(resolve(out, 'serve.mjs')),
  diagnosticSha256: hash(resolve(out, 'sidecar-qualification.mjs')),
  registrySourceSha256: hash(resolve(root, 'packages/operator-core/lib/agent-tools/index.ts')),
  promptSourceSha256: hash(resolve(root, 'packages/operator-core/lib/prompt-assembly.ts')) }) + '\n', { flag: 'wx' });
NODE
}

papercusp_stage_host_qualification_assets() { # <selected source> <image>
  local root="$1" out="$2" route
  route="$(papercusp_preflight_host_qualification "$root" vm-release)" || return 1
  [[ "$route" == diagnostic ]] || return 0
  PAPERCUSP_PROMPTS_DIR="$root/apps/operator/prompts" \
    PAPERCUSP_HARNESS_DIR="$root/libs/papercusp/packages/harness" \
    PAPERCUSP_INTEGRATION_ROOT="" PAPERCUSP_CANONICAL_TREE="" \
    node "$out/sidecar-qualification.mjs" --package-role-prompts "$root" "$out"
}

papercusp_configure_host_testing_core() { # <target repo root>
  local contract
  contract="$(papercusp_host_testing_core_contract "$1")" || return 1
  [[ "$contract" == historical ]] || return 0
  # Only the producer's new primary recipe is adapted. Keep the target's worker
  # composer and external boundary; do not inject newer runtime code or a witness.
  bundle_host_prepare_testing_core() {
    BUNDLE_HOST_TESTING_CORE_WITNESS_DEFINE='--define:__PAPERCUSP_TESTING_CORE_WITNESS__=undefined'
    echo '    ✓ target runtime predates the detached testing core; preserving its worker graph' >&2
  }
  bundle_host_verify_testing_core() {
    [[ "$(papercusp_host_testing_core_contract "$1")" == historical ]]
  }
}

papercusp_ensure_host_worker_bundler() {
  declare -F bundle_host_workers >/dev/null 2>&1 && return 0
  local common="${1:-}" defs
  if [[ -z "$common" || ! -f "$common" ]]; then
    echo "FATAL: the target tree's bundle-host-common.sh does not define bundle_host_workers, and the orchestrator copy is missing at '${common}'" >&2
    return 1
  fi
  if ! defs="$(env -u PAPERCUSP_BUNDLE_HOST_COMMON_LOADED bash -c '
      source "$1" >/dev/null || exit 1
      declare -F bundle_host_workers >/dev/null || exit 1
      declare -p HOST_WORKER_OUTPUTS >/dev/null 2>&1 || exit 1
      for helper in bundle_host_run_step bundle_host_cached_package bundle_host_prepare_esbuild \
        bundle_host_replay_identity_define bundle_host_esbuild bundle_host_testing_core_fixture_opt_in \
        bundle_host_degrade_testing_core bundle_host_prepare_testing_core \
        bundle_host_verify_testing_core bundle_host_handler_bootstrap bundle_host_workers; do
        if declare -F "$helper" >/dev/null; then declare -f "$helper"; fi
      done
      for state in BUNDLE_HOST_TESTING_CORE_UNWITNESSED BUNDLE_HOST_TESTING_CORE_DEGRADED \
        BUNDLE_HOST_TESTING_CORE_FIXTURE BUNDLE_HOST_TESTING_CORE_WORKER_ARGS; do
        if declare -p "$state" >/dev/null 2>&1; then declare -p "$state"; fi
      done
      declare -p HOST_WORKER_OUTPUTS
    ' _ "$common")"; then
    echo "FATAL: orchestrator helper '$common' does not define bundle_host_workers + HOST_WORKER_OUTPUTS" >&2
    return 1
  fi
  # declare -p prints `declare -a NAME=(...)`; evaluated inside this function that would create a
  # LOCAL array, so promote it to a global. Function definitions are always global.
  defs="${defs/declare -a HOST_WORKER_OUTPUTS=/declare -ga HOST_WORKER_OUTPUTS=}"
  defs="${defs//declare -- BUNDLE_HOST_TESTING_CORE_/declare -g BUNDLE_HOST_TESTING_CORE_}"
  defs="${defs//declare -a BUNDLE_HOST_TESTING_CORE_/declare -ga BUNDLE_HOST_TESTING_CORE_}"
  eval "$defs" || return 1
  declare -F bundle_host_workers >/dev/null 2>&1 || return 1
  echo "    ✓ target helper predates bundle_host_workers; using the orchestrator's ($common)"
}

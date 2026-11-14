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
# misleading late symptom. Refuse that target before any expensive production;
# never replace its product code or relax the final-image verifier.
papercusp_preflight_host_qualification() { # <target repo root> <distribution profile>
  [[ "$2" == vm-release ]] || return 0
  node --input-type=module - "$1" <<'NODE'
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const file = resolve(process.argv[2], 'apps/operator/bin/serve.ts');
const source = readFileSync(file, 'utf8');
const main = source.slice(source.indexOf('async function main('));
const policy = main.indexOf('assertVmReleaseRuntimePolicy(');
for (const [flag, receipt] of [['--verify-boot-imports', 'PAPERCUSP_BOOT_IMPORTS_OK'],
    ['--verify-role-prompts', 'PAPERCUSP_ROLE_PROMPT_ASSETS ']]) {
  const branch = new RegExp('^\\s*if\\s*\\(\\s*argv\\[0\\]\\s*===\\s*["\']' + flag + '["\']\\s*\\)\\s*\\{', 'm').exec(main);
  const end = branch && main.indexOf('\n  }', branch.index);
  const body = branch && end >= 0 ? main.slice(branch.index, end) : '';
  if (!body.includes(receipt) || !body.includes('process.exit(0)')
      || (policy >= 0 && branch.index >= policy)) {
    throw new Error(`target lacks early final-image qualification seam ${flag}: ${file}; ` +
      'unknown flags would start the runtime. Select a source with both read-only probes; ' +
      'refusing before scanner downloads or compilation (no product injection or verifier bypass).');
  }
}
console.log('HOST_QUALIFICATION_SOURCE_READY');
NODE
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

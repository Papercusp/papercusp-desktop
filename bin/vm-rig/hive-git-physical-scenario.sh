#!/usr/bin/env bash
# hive-git-physical-scenario.sh — checked-in mutation/observation driver for
# the P-505 two-machine hive-git release drill.
#
# This first landed increment is deliberately OFFLINE-ONLY. It pins the
# invocation, topology, output, and ordered A-G phase contract, then stops
# before the first ssh, service, database, git-ref, or Corestore operation.
# Installing the entrypoint must not make E/P-306 or G/P-308 look proven: the
# producer signs nothing unless this driver eventually emits a complete fresh
# manifest, and this revision cannot emit one.
#
# Future increments replace the seven fail-closed phase stubs below with fixed,
# checked-in operations. Do not add an environment-supplied command seam or an
# input-manifest escape hatch; either would re-introduce pre-banked evidence.
#
# Canonical invocation (from hive-git-physical-probe.sh only):
#   hive-git-physical-scenario.sh \
#     /abs/run/unsigned-evidence.json \
#     /abs/run/tower-identity.json \
#     /abs/run/vm-identity.json
#
# Offline inspection:
#   hive-git-physical-scenario.sh --contract-check
set -euo pipefail

EXPECTED_PLAN='p2p-git-live-activation-2026-07-09'
IMPLEMENTATION_STATE='offline-contract-v1'
PHASE_SEQUENCE=(A B C D E F G)
NODE_BIN="${PAPERCUSP_NODE_BIN:-node}"

fail() {
  echo "hive-git-physical-scenario: $*" >&2
  exit 1
}

if [ "${1:-}" = '--contract-check' ]; then
  printf '{"schemaVersion":"hive-git-physical-scenario-contract/v1","implementationState":"%s","ready":false,"phases":["A","B","C","D","E","F","G"]}\n' \
    "$IMPLEMENTATION_STATE"
  exit 0
fi

unsigned_out="${1:-}"
tower_identity="${2:-}"
vm_identity="${3:-}"

[ "$#" -eq 3 ] \
  || fail 'usage: hive-git-physical-scenario.sh <unsigned-evidence.json> <tower-identity.json> <vm-identity.json>'
[ "${HIVE_GIT_PHYSICAL_PLAN:-}" = "$EXPECTED_PLAN" ] \
  || fail "HIVE_GIT_PHYSICAL_PLAN must be $EXPECTED_PLAN"

require_absolute() {
  local label="$1" path="$2"
  [ -n "$path" ] && [ "${path#/}" != "$path" ] \
    || fail "$label must be an absolute path"
}

require_absolute 'unsigned evidence output' "$unsigned_out"
require_absolute 'tower identity' "$tower_identity"
require_absolute 'vm identity' "$vm_identity"
[ ! -e "$unsigned_out" ] || fail 'refusing to overwrite a pre-banked unsigned evidence file'
[ -f "$tower_identity" ] || fail 'tower identity must be a readable regular file'
[ -r "$tower_identity" ] || fail 'tower identity is not readable'
[ -f "$vm_identity" ] || fail 'vm identity must be a readable regular file'
[ -r "$vm_identity" ] || fail 'vm identity is not readable'

# The producer creates all three paths inside one private run directory. Pinning
# that shape prevents a direct caller from mixing a fresh output with identities
# or observations banked in another run.
run_dir="$(dirname "$unsigned_out")"
[ "$(dirname "$tower_identity")" = "$run_dir" ] \
  && [ "$(dirname "$vm_identity")" = "$run_dir" ] \
  || fail 'output and both identities must belong to the same producer run directory'
[ "$(basename "$unsigned_out")" = 'unsigned-evidence.json' ] \
  && [ "$(basename "$tower_identity")" = 'tower-identity.json' ] \
  && [ "$(basename "$vm_identity")" = 'vm-identity.json' ] \
  || fail 'producer run files have unexpected canonical names'

identity_fields() {
  "$NODE_BIN" - "$1" "$2" <<'NODE'
const fs = require('node:fs');
const [path, expectedHost] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(path, 'utf8'));
const device = typeof value.deviceKey === 'string' ? Buffer.from(value.deviceKey, 'base64') : Buffer.alloc(0);
if (
  value.schemaVersion !== 'hive-git-physical-host-identity/v1' ||
  value.hostId !== expectedHost ||
  device.length !== 32 ||
  typeof value.machineFingerprint !== 'string' ||
  !/^[0-9a-f]{64}$/.test(value.machineFingerprint)
) {
  process.stderr.write(`invalid ${expectedHost} physical host identity\n`);
  process.exit(1);
}
process.stdout.write(`${value.deviceKey}\t${value.machineFingerprint}`);
NODE
}

tower_fields="$(identity_fields "$tower_identity" tower)" \
  || fail 'tower identity does not satisfy the physical-host contract'
vm_fields="$(identity_fields "$vm_identity" vm)" \
  || fail 'vm identity does not satisfy the physical-host contract'
tower_device="${tower_fields%%$'\t'*}"
vm_device="${vm_fields%%$'\t'*}"
tower_machine="${tower_fields#*$'\t'}"
vm_machine="${vm_fields#*$'\t'}"
[ "$tower_device" != "$vm_device" ] \
  || fail 'tower and vm identities resolve to the same device key'
[ "$tower_machine" != "$vm_machine" ] \
  || fail 'tower and vm identities resolve to the same physical machine'

phase_missing() {
  fail "phase $1 is not installed; refusing to emit partial or synthetic physical evidence"
}

# The order is part of D-002: G may run only after the same physical run has
# observed A-F. These fixed functions are intentionally not replaceable via env.
phase_a_storage_join() { phase_missing A; }
phase_b_ref_announce() { phase_missing B; }
phase_c_staging_advance() { phase_missing C; }
phase_d_worktree_materialization() { phase_missing D; }
phase_e_github_bridge() { phase_missing E; }
phase_f_restart_rejoin() { phase_missing F; }
phase_g_crash_epoch_chaos() { phase_missing G; }

run_all_phases() {
  phase_a_storage_join
  phase_b_ref_announce
  phase_c_staging_advance
  phase_d_worktree_materialization
  phase_e_github_bridge
  phase_f_restart_rejoin
  phase_g_crash_epoch_chaos
}

# OFFLINE CONTRACT BOUNDARY. This must remain before the first phase call and
# before any future ssh/mutation primitive until all seven fixed executors and
# their focused falsifiability tests are checked in.
[ "$IMPLEMENTATION_STATE" = 'ready-v1' ] \
  || fail "scenario is not execution-ready ($IMPLEMENTATION_STATE); A-G phase executors have not all landed"
[ "${HIVE_GIT_PHYSICAL_EXECUTE:-}" = "$EXPECTED_PLAN" ] \
  || fail 'destructive physical run requires HIVE_GIT_PHYSICAL_EXECUTE to equal the canonical plan slug'

run_all_phases
fail 'all phases returned without emitting the required unsigned evidence manifest'

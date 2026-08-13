#!/usr/bin/env bash
# hive-git-physical-scenario.sh — checked-in mutation/observation driver for
# the P-505 two-machine hive-git release drill.
#
# The landed increments are deliberately OFFLINE-ONLY. They pin the invocation,
# topology, output, ordered A-G phase contract, and the fixed Phase A cold-join
# executor, then stop before the first ssh, service, database, git-ref, or
# Corestore operation because the global A-G readiness gate remains red.
# Installing the entrypoint must not make E/P-306 or G/P-308 look proven: the
# producer signs nothing unless this driver eventually emits a complete fresh
# manifest, and this revision cannot emit one.
#
# Future increments replace the remaining six fail-closed phase stubs below
# with fixed, checked-in operations satisfying their offline contracts. Do not add an
# environment-supplied command seam or an input-manifest escape hatch; either
# would re-introduce pre-banked evidence.
#
# Canonical invocation (from hive-git-physical-probe.sh only):
#   hive-git-physical-scenario.sh \
#     /abs/run/unsigned-evidence.json \
#     /abs/run/tower-identity.json \
#     /abs/run/vm-identity.json
#
# Offline inspection:
#   hive-git-physical-scenario.sh --contract-check
#   hive-git-physical-scenario.sh --phase-contract A
# Wrapper readiness gate (non-zero until every fixed phase has landed):
#   hive-git-physical-scenario.sh --require-ready
set -euo pipefail

EXPECTED_PLAN='p2p-git-live-activation-2026-07-09'
IMPLEMENTATION_STATE='offline-phase-a-executor-v1'
PHASE_A_POT_HOME='hello-world-3-pot'
PHASE_A_REPO_KEY='gh-1296269'
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
PRODUCER="$REPO_ROOT/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
TSX="$REPO_ROOT/node_modules/.bin/tsx"
VM='aviweiss@172.31.44.2'
VM_NODE='/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node'
VM_TSX='/Users/aviweiss/.papercusp-workspaces/.shared/dev-source/node_modules/tsx/dist/cli.mjs'
VM_PRODUCER='/Users/aviweiss/.papercusp-workspaces/.shared/dev-source/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts'
VM_CALL='/tmp/vmcall.sh'
TOWER_REPO="$HOME/.papercusp/pot-git/$PHASE_A_POT_HOME/$PHASE_A_REPO_KEY.git"
VM_REPO="/Users/aviweiss/.papercusp/pot-git/$PHASE_A_POT_HOME/$PHASE_A_REPO_KEY.git"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

fail() {
  echo "hive-git-physical-scenario: $*" >&2
  exit 1
}

phase_a_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"A","planItem":"P-302","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1296269","topology":"tower-to-vm-cold-join"},"causalOrder":["towerStoreObserved","vmStoreQuarantinedByScenario","vmStoreAbsenceObserved","canonicalGitSyncBootstrapTriggered","vmStoreRecreatedAfterBootstrap","twoHostNamespaceAndObjectParityObserved"],"requiredObservations":["towerBareRepo","vmBareRepo","bothPhysicalDeviceNamespacesOnBothHosts","namespaceRefOidsMatch","referencedObjectsExistOnBothHosts","oneObjectDatabasePerRepo","deviceSignedExactNamespaceSnapshots","freshVmOwnNamespaceSignature","bootstrapCompletedAfterObservedAbsence"],"forbiddenEvidence":["preExistingVmStoreAsColdJoinProof","singleHostObservation","preAuthoredManifest","environmentSuppliedCommand"],"externalCommandOverrides":false}
JSON
}

if [ "${1:-}" = '--contract-check' ]; then
  printf '{"schemaVersion":"hive-git-physical-scenario-contract/v1","implementationState":"%s","ready":false,"phases":["A","B","C","D","E","F","G"],"phaseContracts":{"A":"executor-installed"}}\n' \
    "$IMPLEMENTATION_STATE"
  exit 0
fi
if [ "${1:-}" = '--phase-contract' ]; then
  [ "$#" -eq 2 ] || fail 'usage: hive-git-physical-scenario.sh --phase-contract A'
  [ "$2" = 'A' ] || fail "phase $2 has no installed offline contract"
  phase_a_contract
  exit 0
fi
if [ "${1:-}" = '--require-ready' ]; then
  [ "$IMPLEMENTATION_STATE" = 'ready-v1' ] \
    || fail "scenario is not execution-ready ($IMPLEMENTATION_STATE); A-G phase executors have not all landed"
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
  node - "$1" "$2" <<'NODE'
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
phase_a_storage_join() {
  [ "$PHASE_A_POT_HOME" = 'hello-world-3-pot' ] \
    && [ "$PHASE_A_REPO_KEY" = 'gh-1296269' ] \
    || fail 'phase A target drifted from its checked-in contract'
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase A local observer is unavailable'

  # This function is unreachable until --require-ready turns green for ALL
  # seven phases. Once enabled, it is still fixed to one test hive, one repo,
  # one VM, one canonical git-sync trigger, and one preserved atomic quarantine.
  # No env command, alternate manifest, or caller-selected repo can enter it.
  local phase_dir="$run_dir/phase-a"
  local run_id="p505-a-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  local started_at bootstrap_started bootstrap_finished finished_at
  mkdir -m 700 "$phase_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  "$TSX" "$PRODUCER" phase-a-observe tower present "$TOWER_REPO" \
    "$tower_device" "$vm_device" >"$phase_dir/tower-before.json"

  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-quarantine '$VM_REPO' '$run_id'" \
    >"$phase_dir/quarantine.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-observe vm absent '$VM_REPO' '$vm_device' '$tower_device'" \
    >"$phase_dir/vm-absent.json"

  bootstrap_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
    >"$phase_dir/bootstrap-raw.json"
  bootstrap_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  # A multi-GB cold join is allowed to take minutes. Presence is necessary but
  # not sufficient; the verifier below still requires exact two-host namespace
  # OID parity, local object existence, and independent ODB fingerprints.
  local deadline=$((SECONDS + 1200))
  while ! ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-observe vm present '$VM_REPO' '$vm_device' '$tower_device'" \
    >"$phase_dir/vm-after.json" 2>"$phase_dir/vm-after.err"; do
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase A canonical bootstrap did not recreate an observable VM store within 20 minutes'
    sleep 10
  done
  "$TSX" "$PRODUCER" phase-a-observe tower present "$TOWER_REPO" \
    "$tower_device" "$vm_device" >"$phase_dir/tower-after.json"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$bootstrap_started" \
    "$bootstrap_finished" "$finished_at" "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, bootstrapStarted, bootstrapFinished, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
fs.writeFileSync(`${dir}/verify-input.json`, JSON.stringify({
  schemaVersion: 'hive-git-physical-phase-a-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  quarantine: read('quarantine'),
  bootstrap: {
    tool: 'git-sync:run', installSlug: 'hello-world-3-pot', targetHost: 'vm', fired: true,
    startedAt: bootstrapStarted, finishedAt: bootstrapFinished,
  },
  observations: {
    towerBefore: read('tower-before'),
    vmAbsent: read('vm-absent'),
    towerAfter: read('tower-after'),
    vmAfter: read('vm-after'),
  },
}, null, 2));
NODE
  "$TSX" "$PRODUCER" phase-a-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}
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

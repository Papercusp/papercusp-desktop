#!/usr/bin/env bash
# hive-git-physical-scenario.sh — checked-in mutation/observation driver for
# the P-505 two-machine hive-git release drill.
#
# The landed increments are deliberately OFFLINE-ONLY. They pin the invocation,
# topology, output, ordered A-G phase contract, and the fixed Phase A cold-join
# plus Phase B ref-announcement and Phase C trust executors, then stop before the first ssh,
# service, database, git-ref, or
# Corestore operation because the global A-G readiness gate remains red.
# Installing the entrypoint must not make E/P-306 or G/P-308 look proven: the
# producer signs nothing unless this driver eventually emits a complete fresh
# manifest, and this revision cannot emit one.
#
# Future increments replace the remaining four fail-closed phase stubs below
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
#   hive-git-physical-scenario.sh --phase-contract A|B|C
# Wrapper readiness gate (non-zero until every fixed phase has landed):
#   hive-git-physical-scenario.sh --require-ready
set -euo pipefail

EXPECTED_PLAN='p2p-git-live-activation-2026-07-09'
IMPLEMENTATION_STATE='offline-phase-a-b-c-executors-v1'
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
TOWER_CALL="$HOME/.local/bin/ptool"
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

phase_b_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"B","planItem":"P-303","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1296269","topology":"bidirectional-tower-vm-ref-announce"},"causalOrder":["transferRefAbsentOnBothHosts","freshSourceNamespaceCommitCreated","sourceGitSyncPublishTriggered","sourceSignedSigrefsAdvanced","destinationGitSyncReceiveTriggered","exactSignedNamespaceAndObjectsObservedOnDestination","reverseDirectionRepeated"],"requiredObservations":["freshRunBoundCommitInEachDeviceNamespace","sourceAndDestinationPreMutationAbsence","deviceSignedExactNamespaceSnapshot","sameSigrefsOidOnSourceAndDestination","sameCommitAndPayloadOnSourceAndDestination","reachableObjectCounts","boundedTransferLatency","canonicalGitSyncPublishAndReceiveTicks"],"forbiddenEvidence":["preExistingTransferRef","directGitFetch","bundleTransfer","preAuthoredManifest","environmentSuppliedCommand"],"transport":"ref-announce-protomux-git-upload-pack-v2","externalCommandOverrides":false}
JSON
}

phase_c_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"C","planItem":"P-304","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1296269","topology":"two-host-local-trust-negative-controls"},"causalOrder":["runBoundThirdDeviceKeyGeneratedOnEachHost","honestNamespaceHeadCreatedAndSigned","relayHeadMutatedAfterSignature","authenticSignatureAccepted","servedHeadReconciledAgainstSignedSnapshot","staleSignedSnapshotRejectedByVersionFence","nonMemberScopeServeRejected","honestHeadRestored","twoHostEvidenceAggregated"],"requiredObservations":["distinctRunBoundThirdDeviceOnEachPhysicalHost","realGitHonestAndRogueCommits","validEd25519SignedSnapshot","exactRelayHeadMismatch","rollbackRefusalFromMonotonicVersionFence","nonMemberRefusalFromScopeServeGate","realBareScopeRepoOnEachHost","postControlHonestHeadRestoration"],"forbiddenEvidence":["singleHostControl","sharedThirdDeviceKey","unverifiedSignature","restoredBeforeMismatchObserved","preAuthoredManifest","environmentSuppliedCommand"],"trustPrimitives":["acceptFetchedSigrefs","reconcileFetchedHeads","authorizeScopeRepoServe"],"externalCommandOverrides":false}
JSON
}

if [ "${1:-}" = '--contract-check' ]; then
  printf '{"schemaVersion":"hive-git-physical-scenario-contract/v1","implementationState":"%s","ready":false,"phases":["A","B","C","D","E","F","G"],"phaseContracts":{"A":"executor-installed","B":"executor-installed","C":"executor-installed"}}\n' \
    "$IMPLEMENTATION_STATE"
  exit 0
fi
if [ "${1:-}" = '--phase-contract' ]; then
  [ "$#" -eq 2 ] || fail 'usage: hive-git-physical-scenario.sh --phase-contract A|B|C'
  case "$2" in
    A) phase_a_contract ;;
    B) phase_b_contract ;;
    C) phase_c_contract ;;
    *) fail "phase $2 has no installed offline contract" ;;
  esac
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
phase_b_ref_announce() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] && [ -x "$TOWER_CALL" ] \
    || fail 'phase B local producer or canonical ptool is unavailable'

  # Like Phase A, this remains unreachable until every A-G executor exists.
  # Once enabled it creates only two run-bound refs in the fixed test repo and
  # drives only the production git-sync action. The destination action owns the
  # signed ref-announcement receive path and its Protomux git-upload-pack v2
  # fetch; this scenario never invokes a direct fetch or bundle command.
  local phase_dir="$run_dir/phase-b"
  local forward_dir="$phase_dir/tower-to-vm"
  local reverse_dir="$phase_dir/vm-to-tower"
  local run_id="p505-b-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  local started_at finished_at
  local forward_started forward_publish_started forward_publish_finished
  local forward_receive_started forward_receive_finished forward_finished
  local reverse_started reverse_publish_started reverse_publish_finished
  local reverse_receive_started reverse_receive_finished reverse_finished
  local deadline attempt
  mkdir -m 700 "$phase_dir"
  mkdir -m 700 "$forward_dir" "$reverse_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  forward_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-b-observe tower tower-to-vm absent "$TOWER_REPO" \
    "$tower_device" "$run_id" >"$forward_dir/source-before.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm tower-to-vm absent '$VM_REPO' '$tower_device' '$run_id'" \
    >"$forward_dir/destination-before.json"
  "$TSX" "$PRODUCER" phase-b-commit tower tower-to-vm "$TOWER_REPO" \
    "$tower_device" "$run_id" >"$forward_dir/mutation.json"
  forward_publish_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$forward_dir/source-publish-raw.json"
  forward_publish_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-b-observe tower tower-to-vm present "$TOWER_REPO" \
    "$tower_device" "$run_id" >"$forward_dir/source-after.json"
  forward_receive_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
      >"$forward_dir/destination-receive-$attempt.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm tower-to-vm present '$VM_REPO' '$tower_device' '$run_id'" \
      >"$forward_dir/destination-after.json" 2>"$forward_dir/destination-after.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase B tower-to-vm ref announcement did not materialize within 20 minutes'
    sleep 10
  done
  forward_receive_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  forward_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  reverse_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm vm-to-tower absent '$VM_REPO' '$vm_device' '$run_id'" \
    >"$reverse_dir/source-before.json"
  "$TSX" "$PRODUCER" phase-b-observe tower vm-to-tower absent "$TOWER_REPO" \
    "$vm_device" "$run_id" >"$reverse_dir/destination-before.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-commit vm vm-to-tower '$VM_REPO' '$vm_device' '$run_id'" \
    >"$reverse_dir/mutation.json"
  reverse_publish_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
    >"$reverse_dir/source-publish-raw.json"
  reverse_publish_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm vm-to-tower present '$VM_REPO' '$vm_device' '$run_id'" \
    >"$reverse_dir/source-after.json"
  reverse_receive_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
      | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
        >"$reverse_dir/destination-receive-$attempt.json"
    if "$TSX" "$PRODUCER" phase-b-observe tower vm-to-tower present "$TOWER_REPO" \
      "$vm_device" "$run_id" >"$reverse_dir/destination-after.json" 2>"$reverse_dir/destination-after.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase B vm-to-tower ref announcement did not materialize within 20 minutes'
    sleep 10
  done
  reverse_receive_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  reverse_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" \
    "$tower_device" "$vm_device" \
    "$forward_started" "$forward_publish_started" "$forward_publish_finished" \
    "$forward_receive_started" "$forward_receive_finished" "$forward_finished" \
    "$reverse_started" "$reverse_publish_started" "$reverse_publish_finished" \
    "$reverse_receive_started" "$reverse_receive_finished" "$reverse_finished" <<'NODE'
const fs = require('node:fs');
const [
  dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey,
  forwardStarted, forwardPublishStarted, forwardPublishFinished,
  forwardReceiveStarted, forwardReceiveFinished, forwardFinished,
  reverseStarted, reversePublishStarted, reversePublishFinished,
  reverseReceiveStarted, reverseReceiveFinished, reverseFinished,
] = process.argv.slice(2);
const read = (direction, name) => JSON.parse(fs.readFileSync(`${dir}/${direction}/${name}.json`, 'utf8'));
const direction = ({ name, sourceHost, destinationHost, sourceDeviceKey, destinationDeviceKey,
  windowStarted, publishStarted, publishFinished, receiveStarted, receiveFinished, windowFinished }) => {
  const observations = {
    sourceBefore: read(name, 'source-before'),
    destinationBefore: read(name, 'destination-before'),
    sourceAfter: read(name, 'source-after'),
    destinationAfter: read(name, 'destination-after'),
  };
  return {
    direction: name,
    sourceHost,
    destinationHost,
    sourceDeviceKey,
    destinationDeviceKey,
    window: { startedAt: windowStarted, finishedAt: windowFinished },
    mutation: read(name, 'mutation'),
    triggers: {
      sourcePublish: { tool: 'git-sync:run', installSlug: 'hello-world-3-pot', host: sourceHost,
        role: 'source-publish', fired: true, startedAt: publishStarted, finishedAt: publishFinished },
      destinationReceive: { tool: 'git-sync:run', installSlug: 'hello-world-3-pot', host: destinationHost,
        role: 'destination-receive', fired: true, startedAt: receiveStarted, finishedAt: receiveFinished },
    },
    observations,
    latencyMs: Date.parse(observations.destinationAfter.observedAt) - Date.parse(publishStarted),
  };
};
fs.writeFileSync(`${dir}/verify-input.json`, JSON.stringify({
  schemaVersion: 'hive-git-physical-phase-b-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  directions: [
    direction({ name: 'tower-to-vm', sourceHost: 'tower', destinationHost: 'vm',
      sourceDeviceKey: towerDeviceKey, destinationDeviceKey: vmDeviceKey,
      windowStarted: forwardStarted, publishStarted: forwardPublishStarted,
      publishFinished: forwardPublishFinished, receiveStarted: forwardReceiveStarted,
      receiveFinished: forwardReceiveFinished, windowFinished: forwardFinished }),
    direction({ name: 'vm-to-tower', sourceHost: 'vm', destinationHost: 'tower',
      sourceDeviceKey: vmDeviceKey, destinationDeviceKey: towerDeviceKey,
      windowStarted: reverseStarted, publishStarted: reversePublishStarted,
      publishFinished: reversePublishFinished, receiveStarted: reverseReceiveStarted,
      receiveFinished: reverseReceiveFinished, windowFinished: reverseFinished }),
  ],
}, null, 2));
NODE
  "$TSX" "$PRODUCER" phase-b-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}
phase_c_trust_negative_controls() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase C local producer is unavailable'

  # Phase B already proves the cross-machine transport. This phase runs the
  # trust layer's three production negative controls independently on both
  # physical stores. Each producer invocation generates its own run-bound
  # third-device Ed25519 key, real honest/rogue commits, and real scope repo;
  # there is no caller-supplied key, command, or manifest seam.
  local phase_dir="$run_dir/phase-c"
  local run_id="p505-c-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  local started_at finished_at
  mkdir -m 700 "$phase_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  "$TSX" "$PRODUCER" phase-c-run tower "$TOWER_REPO" \
    "$tower_device" "$vm_device" "$run_id" >"$phase_dir/tower.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-c-run vm '$VM_REPO' '$vm_device' '$tower_device' '$run_id'" \
    >"$phase_dir/vm.json"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" \
    "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
fs.writeFileSync(`${dir}/verify-input.json`, JSON.stringify({
  schemaVersion: 'hive-git-physical-phase-c-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  hostResults: [read('tower'), read('vm')],
}, null, 2));
NODE
  "$TSX" "$PRODUCER" phase-c-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}
phase_d_worktree_materialization() { phase_missing D; }
phase_e_github_bridge() { phase_missing E; }
phase_f_restart_rejoin() { phase_missing F; }
phase_g_crash_epoch_chaos() { phase_missing G; }

run_all_phases() {
  phase_a_storage_join
  phase_b_ref_announce
  phase_c_trust_negative_controls
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

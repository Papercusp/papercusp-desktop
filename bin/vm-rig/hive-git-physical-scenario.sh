#!/usr/bin/env bash
# hive-git-physical-scenario.sh — checked-in mutation/observation driver for
# the P-505 two-machine hive-git release drill.
#
# This driver pins the invocation, topology, output, ordered A-G phase contract,
# and every fixed executor. It remains fail-closed at two independent edges:
# the caller must opt into the canonical plan and the destructive execution
# grant, and the producer will not sign or finalize anything unless every phase
# returns a complete same-run object accepted by its strict validator.
#
# Canonical invocation (from hive-git-physical-probe.sh only):
#   hive-git-physical-scenario.sh \
#     /abs/run/unsigned-evidence.json \
#     /abs/run/tower-identity.json \
#     /abs/run/vm-identity.json
#
# Offline inspection:
#   hive-git-physical-scenario.sh --contract-check
#   hive-git-physical-scenario.sh --phase-contract A|B|C|D|E|F|G
# Wrapper readiness gate:
#   hive-git-physical-scenario.sh --require-ready
set -euo pipefail

EXPECTED_PLAN='p2p-git-live-activation-2026-07-09'
IMPLEMENTATION_STATE='ready-v1'
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

phase_d_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"D","planItem":"P-305","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1296269","topology":"vm-below-steer-to-tower-integrator-to-vm-worktree"},"causalOrder":["freshVmBelowSteerCommitCreated","vmGitSyncPublishTriggered","towerGitSyncQueueReceiveTriggered","exactPendingRequestObserved","productionRatificationApplied","towerGitSyncIntegrationTriggered","towerSignedStagingAdvanceObserved","vmReceivedIdenticalSignedAdvance","vmCanonicalAndWorktreeFastForwarded","vmOverlapFileMadeDirty","freshTowerOverlapCommitCreated","towerSecondSignedAdvanceObserved","vmMirrorAndCursorAdvanced","vmWorktreeHeadAndDirtyFileObservedUntouched"],"requiredObservations":["freshRunBoundBelowSteerHead","exactVisibleIntegrationRequest","ratifyIntegrationRequestResult","productionGitSyncTriggers","signedStagingAdvanceOnBothPhysicalHosts","integratorNamespaceAndCanonicalStagingOids","worktreeBridgeCursorEpochSeqAndEventRow","secondFreshOverlappingAdvance","unchangedDirtyWorktreeHead","unchangedProtectedFileHash"],"forbiddenEvidence":["localSecondWorktreeAsPhysicalProof","directGitFetch","directRefMutation","preAuthoredManifest","environmentSuppliedCommand","callerSelectedRepoOrWorktree"],"productionSurfaces":["git-sync:run","listIntegrationRequests","ratifyIntegrationRequest","pot-git:staging-advance","worktree-bridge"],"externalCommandOverrides":false}
JSON
}

phase_e_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"E","planItem":"P-306","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1296269","topology":"two-host-commit-only-members-to-single-github-bridge-writer"},"causalOrder":["legacyModeObservedOnBothHosts","bridgedModePersistedThroughSetPotGitMode","bothPhysicalMemberGitSyncTicksTriggered","bothMembersObservedCommitOnlyWithNoDirectPushes","freshFixedUpstreamIngressCreated","bridgeIngressAdmissionAndIntegrationTicksTriggered","lastAdmittedReachedExactIngressHead","canonicalAndForkStagingConverged","twoProductionWatchdogSweepsStayedQuiet","freshForkAheadControlCreated","bridgeReportedStructuredEgressNonFastForward","canonicalStayedFixedDuringDivergence","forkRestoredWithForceWithLease","legacyModeRestoredAndObservedOnBothHosts"],"requiredObservations":["federatedModeRowOnBothPhysicalHosts","commitOnlyRoutineMetadataAndEmptyLastPushed","freshUpstreamHead","githubBridgeLastAdmitted","canonicalStagingOid","forkRemoteStagingOid","productionGitSyncTriggers","twoDistinctCheckGitSyncStallResults","structuredEgressNonFfEscalation","unchangedCanonicalAcrossForkAheadControl","forceWithLeaseRecoveryRecord","legacyRollbackOnBothHosts"],"forbiddenEvidence":["memberDirectPush","summaryOnlyLegPass","singleHostObservation","callerSelectedRepoRefOrRemote","directCanonicalRefMutation","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["setPotGitMode","git-sync:run","runGithubBridgeLeg","checkGitSyncStall","github-bridge-divergence"],"externalCommandOverrides":false}
JSON
}

phase_f_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"F","planItem":"P-307","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"topology":"two-host-private-lifecycle-repositories","repositoryLifetime":"one-host-execution"},"causalOrder":["privateBareRepositoriesCreatedOnEachPhysicalHost","liveAndDepartedNamespacesPopulated","productionGcCollectorExecuted","WorkRefAndNewestTwoPublishedRefsRetained","oldestPublishedRefPruned","departedNamespaceArchived","cleanPublishAdmitted","plantedCredentialRefused","oversizedBlobRefused","temporaryRepositoriesRemoved","twoHostLifecycleEvidenceAggregated"],"requiredObservations":["towerAndVmProductionLifecycleResults","identityDerivedLiveAndDepartedNamespaces","exactBeforeAndAfterRefInventories","gcHiveGitRepoResult","checkPublishGuardCleanResult","checkPublishGuardSecretRefusal","checkPublishGuardOversizedBlobRefusal","temporaryRepositoryCleanup"],"forbiddenEvidence":["singleHostLifecycleResult","summaryOnlyLegPass","callerSelectedRepoPath","callerSelectedNamespaceOrRetentionCap","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["gcHiveGitRepo","checkPublishGuard"],"externalCommandOverrides":false}
JSON
}

phase_g_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"G","planItem":"P-308","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"topology":"two-host-attested-ephemeral-protocol-adapter","repositoryLifetime":"one-phase-execution"},"causalOrder":["outerPhysicalIdentitiesPreflighted","ephemeralAuthorityHandoffPublished","successorGrantDerivedFromHandoff","successorAdvanceAccepted","staleAuthorityRejectedWithoutRefMove","retryableUnknownShaHeldCursor","retryableUngrantedEpochHeldCursor","evidenceArrivalAdvancedCursor","pgReadFailureFailedOpenLegacy","nonFastForwardPushRecoveredWithoutForce","coreKeyRotatedWithStableEphemeralNamespace","exactGitRoundTripVerified","temporaryStateRemoved","outerHostReceiptsAttestSameRunManifest"],"requiredObservations":["truthfulPhysicalVsEphemeralIdentityBoundary","signedHandoffAndDerivedEpochGrant","acceptedSuccessorAndRejectedStaleAdvance","unchangedReceiverRefAfterStaleReplay","durableRetryCursorBeforeAndAfterEvidence","structuredPostgresFallback","noisyNonFastForwardAndSuccessfulRetry","noForcePush","distinctCoreKeys","stableEphemeralDeviceNamespace","exactCommitAndPayloadRoundTrip","temporaryRepositoryCleanup"],"forbiddenEvidence":["protocolSignerRepresentedAsPhysicalHost","summaryOnlyLegPass","callerSelectedRepoPath","callerSelectedProtocolKey","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["publishHandoffToken","deriveIntegratorGrant","signStagingAdvance","acceptStagingAdvanceFF","runWorktreeBridgeTick","decideWorktreeBridgePersistence","deriveMaxGrantedEpoch","readPotGitMode","runGitSync","openOwnLog","deviceNamespaceKey","writeNamespaceRef","readNamespaceRef"],"externalCommandOverrides":false}
JSON
}

if [ "${1:-}" = '--contract-check' ]; then
  printf '{"schemaVersion":"hive-git-physical-scenario-contract/v1","implementationState":"%s","ready":true,"phases":["A","B","C","D","E","F","G"],"phaseContracts":{"A":"executor-installed","B":"executor-installed","C":"executor-installed","D":"executor-installed","E":"executor-installed","F":"executor-installed","G":"executor-installed"}}\n' \
    "$IMPLEMENTATION_STATE"
  exit 0
fi
if [ "${1:-}" = '--phase-contract' ]; then
  [ "$#" -eq 2 ] || fail 'usage: hive-git-physical-scenario.sh --phase-contract A|B|C|D|E|F|G'
  case "$2" in
    A) phase_a_contract ;;
    B) phase_b_contract ;;
    C) phase_c_contract ;;
    D) phase_d_contract ;;
    E) phase_e_contract ;;
    F) phase_f_contract ;;
    G) phase_g_contract ;;
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

# One run identifier binds every strict causal leg to the enclosing manifest.
# Phase-local ids cannot satisfy the final D/E/G evidence validator.
physical_run_id="p505-physical-$(date -u +%Y%m%dT%H%M%SZ)-$$"

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
phase_d_worktree_materialization() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] && [ -x "$TOWER_CALL" ] \
    || fail 'phase D local producer or canonical ptool is unavailable'

  # This is intentionally a thin adapter around production surfaces. The only
  # mutations are two fixed canary commits and one fixed dirty-overlap file;
  # all publication, queueing, ratification, integration, federation, and
  # worktree materialization are driven through the canonical application
  # paths and then captured as one revalidated causal object.
  local phase_dir="$run_dir/phase-d"
  local first_dir="$phase_dir/first-advance"
  local dirty_dir="$phase_dir/dirty-advance"
  local run_id="$physical_run_id"
  local started_at finished_at first_head second_head
  local publish_started publish_finished queue_started queue_finished
  local integrate_started integrate_finished first_bridge_started first_bridge_finished
  local dirty_integrate_started dirty_integrate_finished dirty_bridge_started dirty_bridge_finished
  local deadline attempt
  mkdir -m 700 "$phase_dir"
  mkdir -m 700 "$first_dir" "$dirty_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-commit vm below-steer '$vm_device' '$run_id'" \
    >"$first_dir/mutation.json"
  first_head="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).headOid)" "$first_dir/mutation.json")"

  publish_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
    >"$first_dir/publish-raw.json"
  publish_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  queue_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
      | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
        >"$first_dir/queue-receive-$attempt.json"
    if "$TSX" "$PRODUCER" phase-d-request pending "$vm_device" "$first_head" \
      >"$first_dir/pending-request.json" 2>"$first_dir/pending-request.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D fresh below-steer request did not become visible on the tower within 20 minutes'
    sleep 10
  done
  queue_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-d-ratify "$vm_device" "$first_head" \
    >"$first_dir/ratification.json"

  integrate_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$first_dir/integrate-raw.json"
  integrate_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-d-event tower 0 "$tower_device" "$first_head" \
    >"$first_dir/source-event.json"
  "$TSX" "$PRODUCER" phase-d-observe tower first-source "$tower_device" "$run_id" \
    >"$first_dir/source-observation.json"

  first_bridge_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
      >"$first_dir/destination-bridge-$attempt.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-event vm 0 '$tower_device' '$first_head'" \
      >"$first_dir/destination-event.json" 2>"$first_dir/destination-event.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D first signed staging advance did not reach the VM within 20 minutes'
    sleep 10
  done
  first_bridge_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-observe vm first-destination '$tower_device' '$run_id'" \
    >"$first_dir/destination-observation.json"

  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-dirty '$run_id'" \
    >"$dirty_dir/dirty-mutation.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-observe vm dirty-before '$tower_device' '$run_id'" \
    >"$dirty_dir/before-observation.json"

  "$TSX" "$PRODUCER" phase-d-commit tower dirty-overlap "$tower_device" "$run_id" \
    >"$dirty_dir/mutation.json"
  second_head="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).headOid)" "$dirty_dir/mutation.json")"
  dirty_integrate_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$dirty_dir/integrate-raw.json"
  dirty_integrate_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-d-event tower 0 "$tower_device" "$second_head" \
    >"$dirty_dir/source-event.json"

  dirty_bridge_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
      >"$dirty_dir/destination-bridge-$attempt.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-event vm 0 '$tower_device' '$second_head'" \
      >"$dirty_dir/destination-event.json" 2>"$dirty_dir/destination-event.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D second signed staging advance did not reach the VM within 20 minutes'
    sleep 10
  done
  dirty_bridge_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-observe vm dirty-after '$tower_device' '$run_id'" \
    >"$dirty_dir/after-observation.json"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" \
    "$publish_started" "$publish_finished" "$queue_started" "$queue_finished" \
    "$integrate_started" "$integrate_finished" "$first_bridge_started" "$first_bridge_finished" \
    "$dirty_integrate_started" "$dirty_integrate_finished" "$dirty_bridge_started" "$dirty_bridge_finished" <<'NODE'
const fs = require('node:fs');
const [
  dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey,
  publishStarted, publishFinished, queueStarted, queueFinished,
  integrateStarted, integrateFinished, firstBridgeStarted, firstBridgeFinished,
  dirtyIntegrateStarted, dirtyIntegrateFinished, dirtyBridgeStarted, dirtyBridgeFinished,
] = process.argv.slice(2);
const read = (path) => JSON.parse(fs.readFileSync(`${dir}/${path}.json`, 'utf8'));
const trigger = (host, role, triggerStartedAt, triggerFinishedAt) => ({
  tool: 'git-sync:run', installSlug: 'hello-world-3-pot', host, role, fired: true,
  startedAt: triggerStartedAt, finishedAt: triggerFinishedAt,
});
const input = {
  schemaVersion: 'hive-git-physical-phase-d-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  belowSteer: {
    mutation: read('first-advance/mutation'),
    publishTrigger: trigger('vm', 'below-steer-publish', publishStarted, publishFinished),
    queueTrigger: trigger('tower', 'queue-receive', queueStarted, queueFinished),
    pendingReceipt: read('first-advance/pending-request'),
    ratification: read('first-advance/ratification'),
  },
  firstAdvance: {
    integratorTrigger: trigger('tower', 'ratified-integrate', integrateStarted, integrateFinished),
    sourceEvent: read('first-advance/source-event'),
    destinationEvent: read('first-advance/destination-event'),
    destinationTrigger: trigger('vm', 'first-bridge', firstBridgeStarted, firstBridgeFinished),
    sourceObservation: read('first-advance/source-observation'),
    destinationObservation: read('first-advance/destination-observation'),
  },
  dirtyAdvance: {
    mutation: read('dirty-advance/mutation'),
    integratorTrigger: trigger('tower', 'dirty-integrate', dirtyIntegrateStarted, dirtyIntegrateFinished),
    sourceEvent: read('dirty-advance/source-event'),
    destinationEvent: read('dirty-advance/destination-event'),
    destinationTrigger: trigger('vm', 'dirty-bridge', dirtyBridgeStarted, dirtyBridgeFinished),
    dirtyBefore: read('dirty-advance/before-observation'),
    dirtyAfter: read('dirty-advance/after-observation'),
  },
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-d-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}
phase_e_github_bridge() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] && [ -x "$TOWER_CALL" ] \
    || fail 'phase E local producer or canonical ptool is unavailable'

  # Phase E drives the real mode row, git-sync member ticks, GitHub bridge,
  # watchdog, and divergence escalation. The only direct GitHub mutations are
  # the producer's fixed fresh upstream commit and lease-guarded fork control;
  # there is no caller-selected repo, ref, remote, command, or evidence seam.
  local phase_dir="$run_dir/phase-e"
  local run_id="$physical_run_id"
  local started_at finished_at
  local tower_member_started tower_member_finished vm_member_started vm_member_finished
  local ingress_started ingress_finished integrate_started integrate_finished egress_started egress_finished
  local divergence_started divergence_finished rollback_tower_started rollback_tower_finished
  local rollback_vm_started rollback_vm_finished
  local mode_armed=0 divergence_armed=0
  mkdir -m 700 "$phase_dir"

  _phase_e_cleanup() {
    set +e
    if [ "$divergence_armed" -eq 1 ] && [ -s "$phase_dir/divergence-mutation.json" ]; then
      "$TSX" "$PRODUCER" phase-e-recover "$phase_dir/divergence-mutation.json" \
        >"$phase_dir/cleanup-recovery.json" 2>"$phase_dir/cleanup-recovery.err"
    fi
    if [ "$mode_armed" -eq 1 ]; then
      "$TSX" "$PRODUCER" phase-e-mode legacy "$run_id" \
        >"$phase_dir/cleanup-mode.json" 2>"$phase_dir/cleanup-mode.err"
    fi
    set -e
  }
  trap _phase_e_cleanup RETURN

  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-e-observe tower legacy-before "$tower_device" "$run_id" \
    >"$phase_dir/tower-legacy-before.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm legacy-before '$vm_device' '$run_id'" \
    >"$phase_dir/vm-legacy-before.json"

  "$TSX" "$PRODUCER" phase-e-mode bridged "$run_id" \
    >"$phase_dir/activation-mode.json"
  mode_armed=1

  tower_member_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/tower-member-raw.json"
  tower_member_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  vm_member_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
    >"$phase_dir/vm-member-raw.json"
  vm_member_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-e-observe tower bridged-member "$tower_device" "$run_id" \
    >"$phase_dir/tower-bridged-member.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm bridged-member '$vm_device' '$run_id'" \
    >"$phase_dir/vm-bridged-member.json"

  "$TSX" "$PRODUCER" phase-e-ingress "$run_id" \
    >"$phase_dir/ingress-mutation.json"
  ingress_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/healthy-ingress-raw.json"
  ingress_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  integrate_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/healthy-integrate-raw.json"
  integrate_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  egress_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/healthy-egress-raw.json"
  egress_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-e-observe tower healthy-egress "$tower_device" "$run_id" \
    >"$phase_dir/healthy-observation.json"

  "$TSX" "$PRODUCER" phase-e-watchdog 1 "$run_id" \
    >"$phase_dir/watchdog-1.json"
  "$TSX" "$PRODUCER" phase-e-watchdog 2 "$run_id" \
    >"$phase_dir/watchdog-2.json"

  "$TSX" "$PRODUCER" phase-e-observe tower divergence-before "$tower_device" "$run_id" \
    >"$phase_dir/divergence-before.json"
  "$TSX" "$PRODUCER" phase-e-diverge "$run_id" \
    >"$phase_dir/divergence-mutation.json"
  divergence_armed=1
  divergence_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/divergence-egress-raw.json"
  divergence_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-e-observe tower divergence-after "$tower_device" "$run_id" \
    >"$phase_dir/divergence-after.json"
  "$TSX" "$PRODUCER" phase-e-recover "$phase_dir/divergence-mutation.json" \
    >"$phase_dir/divergence-recovery.json"
  divergence_armed=0

  "$TSX" "$PRODUCER" phase-e-mode legacy "$run_id" \
    >"$phase_dir/rollback-mode.json"
  rollback_tower_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  printf '{"installSlug":"%s"}\n' "$PHASE_A_POT_HOME" \
    | "$TOWER_CALL" git-sync:run --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
      >"$phase_dir/rollback-tower-raw.json"
  rollback_tower_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  rollback_vm_started="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' git-sync:run '{\"installSlug\":\"$PHASE_A_POT_HOME\"}' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
    >"$phase_dir/rollback-vm-raw.json"
  rollback_vm_finished="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-e-observe tower legacy-after "$tower_device" "$run_id" \
    >"$phase_dir/tower-legacy-after.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm legacy-after '$vm_device' '$run_id'" \
    >"$phase_dir/vm-legacy-after.json"
  mode_armed=0
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" \
    "$tower_member_started" "$tower_member_finished" "$vm_member_started" "$vm_member_finished" \
    "$ingress_started" "$ingress_finished" "$integrate_started" "$integrate_finished" \
    "$egress_started" "$egress_finished" "$divergence_started" "$divergence_finished" \
    "$rollback_tower_started" "$rollback_tower_finished" "$rollback_vm_started" "$rollback_vm_finished" <<'NODE'
const fs = require('node:fs');
const [
  dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey,
  towerMemberStarted, towerMemberFinished, vmMemberStarted, vmMemberFinished,
  ingressStarted, ingressFinished, integrateStarted, integrateFinished,
  egressStarted, egressFinished, divergenceStarted, divergenceFinished,
  rollbackTowerStarted, rollbackTowerFinished, rollbackVmStarted, rollbackVmFinished,
] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const trigger = (host, role, triggerStartedAt, triggerFinishedAt) => ({
  tool: 'git-sync:run', installSlug: 'hello-world-3-pot', host, role, fired: true,
  startedAt: triggerStartedAt, finishedAt: triggerFinishedAt,
});
const input = {
  schemaVersion: 'hive-git-physical-phase-e-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  before: { tower: read('tower-legacy-before'), vm: read('vm-legacy-before') },
  activation: {
    modeChange: read('activation-mode'),
    towerTrigger: trigger('tower', 'tower-member', towerMemberStarted, towerMemberFinished),
    vmTrigger: trigger('vm', 'vm-member', vmMemberStarted, vmMemberFinished),
    tower: read('tower-bridged-member'),
    vm: read('vm-bridged-member'),
  },
  healthy: {
    ingressMutation: read('ingress-mutation'),
    ingressTrigger: trigger('tower', 'healthy-ingress', ingressStarted, ingressFinished),
    integrateTrigger: trigger('tower', 'healthy-integrate', integrateStarted, integrateFinished),
    egressTrigger: trigger('tower', 'healthy-egress', egressStarted, egressFinished),
    observation: read('healthy-observation'),
  },
  watchdogSweeps: [read('watchdog-1'), read('watchdog-2')],
  divergence: {
    before: read('divergence-before'),
    mutation: read('divergence-mutation'),
    trigger: trigger('tower', 'divergence-egress', divergenceStarted, divergenceFinished),
    after: read('divergence-after'),
    recovery: read('divergence-recovery'),
  },
  rollback: {
    modeChange: read('rollback-mode'),
    towerTrigger: trigger('tower', 'rollback-observe', rollbackTowerStarted, rollbackTowerFinished),
    vmTrigger: trigger('vm', 'rollback-observe', rollbackVmStarted, rollbackVmFinished),
    tower: read('tower-legacy-after'),
    vm: read('vm-legacy-after'),
  },
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-e-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
  trap - RETURN
}
phase_f_lifecycle_safety() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase F local producer is unavailable'

  # Each host independently creates private throwaway bare repositories and
  # drives the real G-9/G-10 surfaces. The producer owns every repo path, ref,
  # namespace, retention cap, planted control, and cleanup action; the caller
  # supplies only the already-attested host identities and enclosing run id.
  local phase_dir="$run_dir/phase-f"
  local run_id="$physical_run_id"
  local started_at finished_at
  mkdir -m 700 "$phase_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  "$TSX" "$PRODUCER" phase-f-run tower "$tower_device" "$vm_device" "$run_id" \
    >"$phase_dir/tower-lifecycle.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-f-run vm '$vm_device' '$tower_device' '$run_id'" \
    >"$phase_dir/vm-lifecycle.json"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const input = {
  schemaVersion: 'hive-git-physical-phase-f-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  hostResults: [read('tower-lifecycle'), read('vm-lifecycle')],
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-f-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}
phase_g_crash_epoch_chaos() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase G local producer is unavailable'

  # The already-preflighted tower and VM keys bind this adapter to the outer
  # two-host manifest. The protocol authority, survivor, and restart identity
  # are deliberately fresh EPHEMERAL keypairs: neither may be relabelled as a
  # physical host. Both real hosts attest the complete manifest afterward.
  local phase_dir="$run_dir/phase-g"
  local run_id="$physical_run_id"
  local started_at finished_at
  mkdir -m 700 "$phase_dir"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  "$TSX" "$PRODUCER" phase-g-run "$tower_device" "$vm_device" "$run_id" \
    >"$phase_dir/result.json"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8'));
const input = {
  schemaVersion: 'hive-git-physical-phase-g-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  result,
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-g-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}

assemble_unsigned_evidence() {
  local started_at="$1" finished_at="$2"
  node - "$run_dir" "$unsigned_out" "$physical_run_id" "$started_at" "$finished_at" \
    "$tower_device" "$vm_device" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const [dir, output, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const readJson = (path) => JSON.parse(fs.readFileSync(path, 'utf8'));
const phaseInput = (phase) => readJson(`${dir}/phase-${phase.toLowerCase()}/verify-input.json`);
const inputs = Object.fromEntries([...'ABCDEFG'].map((phase) => [phase, phaseInput(phase)]));
const witness = (host, path) => {
  const bytes = fs.readFileSync(path);
  return {
    host,
    contentBase64: bytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
};
const observedAt = (phase) => phase === 'G'
  ? inputs.G.result.observedAt
  : inputs[phase].window.finishedAt;
const evidence = {
  schemaVersion: 'hive-git-physical-evidence/v1',
  plan: 'p2p-git-live-activation-2026-07-09',
  runId,
  window: { startedAt, finishedAt },
  topology: {
    kind: 'two-physical-machines',
    hosts: [
      { id: 'tower', deviceKey: towerDeviceKey },
      { id: 'vm', deviceKey: vmDeviceKey },
    ],
  },
  artifacts: [
    witness('tower', `${dir}/phase-f/tower-lifecycle.json`),
    witness('vm', `${dir}/phase-f/vm-lifecycle.json`),
  ],
  legVerdicts: [...'ABCDEFG'].map((leg) => ({
    leg,
    status: 'pass',
    scope: 'physical',
    observedAt: observedAt(leg),
  })),
  legD: inputs.D,
  legE: inputs.E,
  legF: inputs.F,
  legG: inputs.G,
};
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
}

run_all_phases() {
  phase_a_storage_join
  phase_b_ref_announce
  phase_c_trust_negative_controls
  phase_d_worktree_materialization
  phase_e_github_bridge
  phase_f_lifecycle_safety
  phase_g_crash_epoch_chaos
}

# OFFLINE CONTRACT BOUNDARY. This must remain before the first phase call and
# before any future ssh/mutation primitive until all seven fixed executors and
# their focused falsifiability tests are checked in.
[ "$IMPLEMENTATION_STATE" = 'ready-v1' ] \
  || fail "scenario is not execution-ready ($IMPLEMENTATION_STATE); A-G phase executors have not all landed"
[ "${HIVE_GIT_PHYSICAL_EXECUTE:-}" = "$EXPECTED_PLAN" ] \
  || fail 'destructive physical run requires HIVE_GIT_PHYSICAL_EXECUTE to equal the canonical plan slug'

scenario_started_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
run_all_phases
scenario_finished_at="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
assemble_unsigned_evidence "$scenario_started_at" "$scenario_finished_at"
[ -s "$unsigned_out" ] || fail 'all phases returned without emitting the required unsigned evidence manifest'

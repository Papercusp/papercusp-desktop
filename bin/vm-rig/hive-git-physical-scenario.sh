#!/usr/bin/env bash
# hive-git-physical-scenario.sh — checked-in mutation/observation driver for
# the P-505 two-machine hive-git release drill.
#
# This driver pins the invocation, topology, output, ordered A-J phase contract,
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
#   hive-git-physical-scenario.sh --phase-contract A|B|C|D|E|F|G|H|I|J
# Wrapper readiness gate:
#   hive-git-physical-scenario.sh --require-ready
set -euo pipefail

EXPECTED_PLAN='p2p-git-live-activation-2026-07-09'
IMPLEMENTATION_STATE='ready-v1'
PHASE_A_POT_HOME='hello-world-3-pot'
PHASE_A_REPO_KEY='gh-1303510992'
TOWER_GIT_SYNC_SLUG="$PHASE_A_POT_HOME"
# The VM's canonical invite-link join registers the pot repo under the pot slug
# (joined_via_link + remote_hive + self_repo), and that entry owns git-sync. The
# old joinHiveAsView member 'hello-world' is gone since the P-007 fresh join
# (WI-10003546). Mirrors PHASE_A_VM_GIT_SYNC_SLUG in physical-drill-phase-a.ts.
VM_GIT_SYNC_SLUG="$PHASE_A_POT_HOME"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
PRODUCER="$REPO_ROOT/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
TSX="$REPO_ROOT/node_modules/.bin/tsx"
VM='aviweiss@172.31.44.2'
VM_NODE='/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/node'
VM_TSX='/Users/aviweiss/.papercusp-workspaces/.shared/dev-source/node_modules/tsx/dist/cli.mjs'
VM_SOURCE="${HIVE_GIT_PHYSICAL_VM_SOURCE:-}"
# WI-10004062: the probe's run-private, pinned-commit tower snapshot. Once the
# execution gate below validates it, PRODUCER points INTO it, so no phase runs
# tower bytes out of the shared working tree that parallel builders edit.
TOWER_SOURCE="${HIVE_GIT_PHYSICAL_TOWER_SOURCE:-}"
VM_PRODUCER="$VM_SOURCE/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
VM_CALL='/tmp/vmcall.sh'
VM_MCP_CALL='/tmp/mcp-call.mjs'
DEPLOY="$HERE/deploy.sh"
# The unprojected diagnostic includes detailed rows for every booted harness and
# can cross the transport result door.  Pin the dispatch-level projection at
# the call site so this destructive gate always receives the direct readiness
# shape rather than a {summary,_projection} spill wrapper.
# Phase A readiness status query. Its target is the git-sync slug the readiness gate matches
# rows on (phase_a_host_substrate_readiness), so the query and the gate always name the same
# harness. On the physical rig that slug is the pot home; on the same-box rig it is the pot
# member (rig-profile.sh). Same-box run 20260930T050610Z failed in 40s when a string rewrite
# pointed the query at the pot home while the gate matched the member.
phase_a_status_args() {
  printf '{"targetHarness":{"workspaceId":"papercusp-workspace","harnessSlug":"%s"},"projection":{"pick":["substrateActive","reachedSubstrateOwner","healthInputsObserved","bootedCount","harnesses[].workspaceId","harnesses[].harnessSlug","harnesses[].verdict","harnesses[].reasons","contentConnectivity[].workspaceId","contentConnectivity[].harnessSlug","contentConnectivity[].topicHex","contentConnectivity[].contentPeers","contentConnectivity[].lastContentAnnounceRecvMs"]}}' "$1"
}
TOWER_CALL="$HOME/.local/bin/ptool"
TOWER_REPO="$HOME/.papercusp/pot-git/$PHASE_A_POT_HOME/$PHASE_A_REPO_KEY.git"
VM_REPO="/Users/aviweiss/.papercusp/pot-git/$PHASE_A_POT_HOME/$PHASE_A_REPO_KEY.git"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)

# Every production tick targets the entry that owns system:git-sync on its
# host: the tower's self_repo pot home, and the VM's link-joined clone of the
# same pot repo (see VM_GIT_SYNC_SLUG above).
#
# The tower's request-serving operator (:3070, PAPERCUSP_BACKGROUND_WORKERS=0)
# refuses a mutating git-sync:run as request-only-host and names the
# background-worker host in retry.dev_box_url (agent-tools/git_sync/run.ts).
# P-505 run 11 (WI-2039874) recorded that refusal as the Phase B publish and
# moved on; only the scheduled tick later published, out of causal order. So:
# follow the named host once, and fail at the publish if it still did not fire.
#
# Prints the retry URL of a request-only-host refusal read from stdin, or
# nothing for any other result (including unparseable output).
git_sync_refusal_retry_url() {
  node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let value = null;
      try { value = JSON.parse(raw); } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) { try { value = JSON.parse(raw.slice(start, end + 1)); } catch {} }
      }
      if (!value || value.fired !== false || value.reason !== "request-only-host") return;
      const url = value.retry && value.retry.dev_box_url;
      if (typeof url === "string" && /^https?:\/\/[^\s]+$/.test(url)) process.stdout.write(url);
    });
  '
}

# One logical tower git-sync:run against the default door (empty $1) or the
# named host. Prints the result and returns ptool's exit status.
#
# ptool gives git-sync:run a 60s client deadline, which is exactly the
# server's own budget (a 45s fire, two 5s HEAD reads, 5s MCP settlement). Any
# main-thread lag on the background-worker host therefore makes ptool give up
# first with MCP -32001 outcome=unknown. P-505 run 13 (WI-10003638) lost Phase B
# that way while bg-host logged ~30 event-loop-lag warnings in 7 minutes. The
# transport stores a result under the call's _meta.idempotencyKey even after
# the client has gone, and a replay with the SAME key returns it without
# re-executing (_mcp-result-replay.ts). So each logical call carries its own
# fresh key, and an unknown outcome is replayed with that key (at most twice)
# instead of abandoning the phase. Never share one key between the
# request-only attempt and the re-fire: both hosts share the replay store, so a
# shared key would replay the refusal.
tower_git_sync_call() {
  local url="$1" args key errf out="" rc=0 attempt
  local wait_sec="${TOWER_GIT_SYNC_REPLAY_WAIT_SEC:-30}"
  local url_flags=()
  [ -z "$url" ] || url_flags=("--url=$url")
  args="$(printf '{"installSlug":"%s"}' "$TOWER_GIT_SYNC_SLUG")"
  key="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
  errf="$(mktemp)"
  for attempt in 0 1 2; do
    if [ "$attempt" -gt 0 ]; then
      echo "hive-git-physical-scenario: tower git-sync:run outcome unknown (rc=$rc); replaying idempotency key $key in ${wait_sec}s (replay $attempt/2)" >&2
      sleep "$wait_sec"
    fi
    rc=0
    out="$(printf '%s\n' "$args" \
      | "$TOWER_CALL" git-sync:run --json - ${url_flags[@]+"${url_flags[@]}"} --idempotency-key="$key" \
          --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" 2>"$errf")" || rc=$?
    cat "$errf" >&2
    if [ "$rc" -eq 0 ] || ! grep -q 'outcome=unknown' "$errf"; then break; fi
  done
  rm -f "$errf"
  printf '%s\n' "$out"
  return "$rc"
}

run_tower_git_sync() {
  local out rc=0 retry_url
  out="$(tower_git_sync_call '')" || rc=$?
  retry_url="$(printf '%s' "$out" | git_sync_refusal_retry_url)"
  if [ -n "$retry_url" ]; then
    echo "hive-git-physical-scenario: tower git-sync:run refused (request-only-host); re-firing on $retry_url" >&2
    rc=0
    out="$(tower_git_sync_call "$retry_url")" || rc=$?
  fi
  printf '%s\n' "$out"
  # ptool exits 5 when git-sync:run ANSWERED ok:false (EI-24654733539966460). The
  # answer is on stdout and every evidence-bearing caller judges it with
  # require_git_sync_fired, so only a transport failure may abort under set -e.
  [ "$rc" -ne 5 ] || rc=0
  return "$rc"
}

# The VM git-sync:run client deadline. vmcall.sh bounds every call at 30s by
# default, but the server's own git-sync:run budget is 60s (the same breakdown
# as the tower note above: a 45s fire, two 5s HEAD reads, 5s MCP settlement).
# Same-box run 9 (WI-10004195) lost phase A to exactly that gap: the bootstrap
# fire's result file was empty and vmcall printed MCP_RESULT_TIMEOUT at 30s,
# while the same VM owner answered ten other calls in about 1s each, eight of
# them with a git-sync fire in flight. So the VM call gets the full server
# budget plus margin, and an unknown outcome is replayed under the call's own
# idempotency key (at most twice), exactly like tower_git_sync_call.
VM_GIT_SYNC_CALL_TIMEOUT_SEC=75

run_vm_git_sync() {
  local rc=0 key errf out="" attempt
  local wait_sec="${VM_GIT_SYNC_REPLAY_WAIT_SEC:-30}"
  key="$(node -e 'process.stdout.write(require("crypto").randomUUID())')"
  errf="$(mktemp)"
  for attempt in 0 1 2; do
    if [ "$attempt" -gt 0 ]; then
      echo "hive-git-physical-scenario: VM git-sync:run outcome unknown (rc=$rc); replaying idempotency key $key in ${wait_sec}s (replay $attempt/2)" >&2
      sleep "$wait_sec"
    fi
    rc=0
    out="$(ssh "${SSH_OPTS[@]}" "$VM" \
      "PCUSP_VM_CALL_TIMEOUT_SEC='$VM_GIT_SYNC_CALL_TIMEOUT_SEC' '$VM_CALL' git-sync:run '{\"installSlug\":\"$VM_GIT_SYNC_SLUG\"}' --idempotency-key '$key' --workspace papercusp-workspace --harness '$PHASE_A_POT_HOME'" \
      2>"$errf")" || rc=$?
    cat "$errf" >&2
    # Only vmcall's client deadline leaves the outcome unknown; every other
    # exit (an answer, a refusal, a transport failure) is final.
    if [ "$rc" -eq 0 ] || ! grep -q 'MCP_RESULT_TIMEOUT' "$errf"; then break; fi
  done
  rm -f "$errf"
  printf '%s\n' "$out"
  # mcp-call (forwarded by vmcall.sh and ssh) exits 5 when git-sync:run
  # ANSWERED ok:false (EI-24654733539966460). Same rule as the tower side: the
  # answer is on stdout for require_git_sync_fired to judge, so only a transport
  # failure may abort under set -e.
  [ "$rc" -ne 5 ] || rc=0
  return "$rc"
}

# Fails the run when a recorded git-sync:run result did not fire (a refusal or
# a preview) or is not a JSON result at all. A fired result may still be
# skipped or in progress; the phase observations judge its effect.
require_git_sync_fired() {
  local file="$1" label="$2" verdict
  verdict="$(node -e '
    const raw = require("fs").readFileSync(process.argv[1], "utf8");
    let value = null;
    try { value = JSON.parse(raw); } catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) { try { value = JSON.parse(raw.slice(start, end + 1)); } catch {} }
    }
    if (!value || typeof value !== "object") { process.stdout.write("no JSON result"); process.exit(0); }
    if (value.fired === true) process.exit(0);
    process.stdout.write(`${value.status ?? "unknown"}: ${value.reason ?? value.note ?? "no reason"}`);
  ' "$file")"
  [ -z "$verdict" ] || fail "$label git-sync:run did not fire ($verdict); see $file"
}

# Phase A's quarantine is intentionally destructive: it removes the VM's
# existing test bare store so the production bootstrap must recreate it from
# the tower. A booted local handle is not enough. Refuse that mutation unless
# BOTH fixed harnesses report a live remote content peer, a recent inbound
# announce, and the same exact content topic. This is the smallest witness that
# the two-host dial path exists before the last usable VM store is moved.
phase_a_host_substrate_readiness() {
  local host="$1" harness_slug="$2" raw="$3"
  node -e '
    const [host, harnessSlug, raw] = process.argv.slice(1);
    const workspaceId = "papercusp-workspace";
    const maxAnnounceAgeMs = 10 * 60 * 1000;
    let status;
    try {
      status = JSON.parse(raw);
    } catch {
      process.stderr.write(`phase A ${host} substrate readiness probe returned invalid JSON\n`);
      process.exit(2);
    }
    const harnesses = Array.isArray(status?.harnesses) ? status.harnesses : [];
    const connectivity = Array.isArray(status?.contentConnectivity)
      ? status.contentConnectivity
      : [];
    const harness = harnesses.find((row) =>
      row?.workspaceId === workspaceId && row?.harnessSlug === harnessSlug,
    );
    const content = connectivity.find((row) =>
      row?.workspaceId === workspaceId && row?.harnessSlug === harnessSlug,
    );
    const topicHex = typeof content?.topicHex === "string" ? content.topicHex : null;
    const lastAnnounce = Number.isInteger(content?.lastContentAnnounceRecvMs)
      ? content.lastContentAnnounceRecvMs
      : null;
    const announceAgeMs = lastAnnounce === null ? null : Math.abs(Date.now() - lastAnnounce);
    const ready =
      status?.substrateActive === true &&
      status?.reachedSubstrateOwner === true &&
      status?.healthInputsObserved === true &&
      Number.isInteger(status?.bootedCount) &&
      status.bootedCount > 0 &&
      Boolean(harness) &&
      /^[0-9a-f]{64}$/.test(topicHex ?? "") &&
      Number.isInteger(content?.contentPeers) &&
      content.contentPeers > 0 &&
      announceAgeMs !== null &&
      announceAgeMs <= maxAnnounceAgeMs;
    const evidence = {
      host,
      ready,
      target: { workspaceId, harnessSlug },
      substrateActive: status?.substrateActive === true,
      reachedSubstrateOwner: status?.reachedSubstrateOwner === true,
      healthInputsObserved: status?.healthInputsObserved === true,
      bootedCount: Number.isInteger(status?.bootedCount) ? status.bootedCount : null,
      harnessVerdict: harness?.verdict ?? null,
      harnessReasons: Array.isArray(harness?.reasons) ? harness.reasons : [],
      contentTopicHex: topicHex,
      contentPeers: Number.isInteger(content?.contentPeers) ? content.contentPeers : null,
      lastContentAnnounceRecvMs: lastAnnounce,
      announceAgeMs,
      maxAnnounceAgeMs,
    };
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
    if (!ready) process.exit(1);
  ' "$host" "$harness_slug" "$raw"
}

require_phase_a_two_host_substrate_ready() {
  local vm_raw tower_raw vm_evidence tower_evidence
  # Exit 5 is mcp-call's "the tool answered ok:false", forwarded by vmcall.sh
  # (EI-24654733539966460): the VM operator was reached, and the readiness gate
  # below judges the answer.
  local vm_rc=0
  vm_raw="$(ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_CALL' dev:dogfood_substrate_status '$(phase_a_status_args "$VM_GIT_SYNC_SLUG")' --client hive-git-phase-a-readiness --workspace papercusp-workspace --harness '$VM_GIT_SYNC_SLUG'")" || vm_rc=$?
  if [ "$vm_rc" -ne 0 ] && [ "$vm_rc" -ne 5 ]; then
    fail 'phase A VM substrate readiness probe could not reach the VM operator'
  fi
  if ! vm_evidence="$(phase_a_host_substrate_readiness vm "$VM_GIT_SYNC_SLUG" "$vm_raw")"; then
    printf '%s\n' "$vm_evidence"
    fail 'phase A VM substrate readiness gate failed: exact topic has no live, recent remote content peer'
  fi

  # Exit 5 is ptool's "the tool answered ok:false" (EI-24654733539966460): the
  # operator was reached, and the readiness gate below judges the answer.
  local tower_rc=0
  tower_raw="$(printf '%s\n' "$(phase_a_status_args "$TOWER_GIT_SYNC_SLUG")" \
    | "$TOWER_CALL" dev:dogfood_substrate_status --json - \
      --workspace=papercusp-workspace --harness="$TOWER_GIT_SYNC_SLUG")" || tower_rc=$?
  if [ "$tower_rc" -ne 0 ] && [ "$tower_rc" -ne 5 ]; then
    fail 'phase A tower substrate readiness probe could not reach the tower operator'
  fi
  if ! tower_evidence="$(phase_a_host_substrate_readiness tower "$TOWER_GIT_SYNC_SLUG" "$tower_raw")"; then
    printf '%s\n' "$tower_evidence"
    fail 'phase A tower substrate readiness gate failed: exact topic has no live, recent remote content peer'
  fi

  node -e '
    const [towerRaw, vmRaw] = process.argv.slice(1);
    const tower = JSON.parse(towerRaw);
    const vm = JSON.parse(vmRaw);
    const sameTopic = tower.contentTopicHex === vm.contentTopicHex;
    const ready = tower.ready === true && vm.ready === true && sameTopic;
    process.stdout.write(`${JSON.stringify({
      schemaVersion: "hive-git-phase-a-substrate-readiness/v2",
      ready,
      sameTopic,
      tower,
      vm,
    })}\n`);
    if (!ready) process.exit(1);
  ' "$tower_evidence" "$vm_evidence" \
    || fail 'phase A two-host substrate readiness gate failed: tower and VM do not share one live content topic'
}

# Node-produced observations carry millisecond precision. Truncating the shell
# side of the same causal window to .000Z can make a later action sort before
# an observation from the same second, so every scenario timestamp uses the
# same precision.
now_iso() {
  date -u +%Y-%m-%dT%H:%M:%S.%3NZ
}

fail() {
  echo "hive-git-physical-scenario: $*" >&2
  exit 1
}

# ptool before EI-24654733539966460 exits 0 on an ok:false result, and the tower
# runs whatever ptool its release checkout carries, so the exit status alone cannot
# tell a refused write from a landed one. Judge the saved result as well: the
# envelope and every per-item result must be ok.
ptool_result_ok() {
  node -e 'const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")); process.exit(o.ok === true && Array.isArray(o.results) && o.results.length > 0 && o.results.every((r) => r.ok === true) ? 0 : 1)' "$1"
}

# A work-item a phase creates only to observe it (a FIXTURE) is not work: it must
# not outlive the run as an open, claimable item in the drill pot (WI-10004116 —
# phase J leaked its writes A and B this way on every run). Register each id the
# moment its create is accepted; drop the registered set on the phase's success
# path AND from its EXIT trap, so a failed run cannot leak one either.
DRILL_FIXTURES=()
drill_fixture_register() {
  local id
  id="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).results?.[0]?.id ?? ""' "$1")" || return 1
  [ -n "$id" ] || return 1
  DRILL_FIXTURES+=("$id")
}
drill_fixtures_drop() {
  [ "${#DRILL_FIXTURES[@]}" -gt 0 ] || return 0
  node -e 'process.stdout.write(JSON.stringify({ ids: process.argv.slice(2), state: "dropped", assumptions: "none", reason: `Physical drill fixture from run ${process.argv[1]}; not work (WI-10004116).` }))' "$physical_run_id" "${DRILL_FIXTURES[@]}" \
    | "$TOWER_CALL" work_items:set_state --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" >"$1" \
    || return 1
  ptool_result_ok "$1" || return 1
  DRILL_FIXTURES=()
}

phase_a_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"A","planItem":"P-302","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1303510992","topology":"tower-to-vm-cold-join"},"causalOrder":["towerStoreObserved","vmStoreQuarantinedByScenario","vmStoreAbsenceObserved","canonicalGitSyncBootstrapTriggered","vmStoreRecreatedAfterBootstrap","twoHostNamespaceAndObjectParityObserved"],"requiredObservations":["towerBareRepo","vmBareRepo","bothPhysicalDeviceNamespacesOnBothHosts","namespaceRefOidsMatch","referencedObjectsExistOnBothHosts","oneObjectDatabasePerRepo","deviceSignedExactNamespaceSnapshots","freshVmOwnNamespaceSignature","bootstrapCompletedAfterObservedAbsence"],"forbiddenEvidence":["preExistingVmStoreAsColdJoinProof","singleHostObservation","preAuthoredManifest","environmentSuppliedCommand"],"externalCommandOverrides":false}
JSON
}

phase_b_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"B","planItem":"P-303","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1303510992","topology":"bidirectional-tower-vm-ref-announce"},"causalOrder":["transferRefAbsentOnBothHosts","freshSourceNamespaceCommitCreated","sourceGitSyncPublishTriggered","sourceSignedSigrefsAdvanced","destinationGitSyncReceiveTriggered","exactSignedNamespaceAndObjectsObservedOnDestination","reverseDirectionRepeated"],"requiredObservations":["freshRunBoundCommitInEachDeviceNamespace","sourceAndDestinationPreMutationAbsence","deviceSignedExactNamespaceSnapshot","sameSigrefsOidOnSourceAndDestination","sameCommitAndPayloadOnSourceAndDestination","reachableObjectCounts","boundedTransferLatency","canonicalGitSyncPublishAndReceiveTicks"],"forbiddenEvidence":["preExistingTransferRef","directGitFetch","bundleTransfer","preAuthoredManifest","environmentSuppliedCommand"],"transport":"ref-announce-protomux-git-upload-pack-v2","externalCommandOverrides":false}
JSON
}

phase_c_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"C","planItem":"P-304","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1303510992","topology":"two-host-local-trust-negative-controls"},"causalOrder":["runBoundThirdDeviceKeyGeneratedOnEachHost","honestNamespaceHeadCreatedAndSigned","relayHeadMutatedAfterSignature","authenticSignatureAccepted","servedHeadReconciledAgainstSignedSnapshot","staleSignedSnapshotRejectedByVersionFence","nonMemberScopeServeRejected","honestHeadRestored","twoHostEvidenceAggregated"],"requiredObservations":["distinctRunBoundThirdDeviceOnEachPhysicalHost","realGitHonestAndRogueCommits","validEd25519SignedSnapshot","exactRelayHeadMismatch","rollbackRefusalFromMonotonicVersionFence","nonMemberRefusalFromScopeServeGate","realBareScopeRepoOnEachHost","postControlHonestHeadRestoration"],"forbiddenEvidence":["singleHostControl","sharedThirdDeviceKey","unverifiedSignature","restoredBeforeMismatchObserved","preAuthoredManifest","environmentSuppliedCommand"],"trustPrimitives":["acceptFetchedSigrefs","reconcileFetchedHeads","authorizeScopeRepoServe"],"externalCommandOverrides":false}
JSON
}

phase_d_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"D","planItem":"P-305","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1303510992","topology":"vm-below-steer-to-tower-integrator-to-vm-worktree"},"causalOrder":["freshVmBelowSteerCommitCreated","vmGitSyncPublishTriggered","towerGitSyncQueueReceiveTriggered","exactPendingRequestObserved","productionRatificationApplied","towerGitSyncIntegrationTriggered","towerSignedStagingAdvanceObserved","vmReceivedIdenticalSignedAdvance","vmCanonicalAndWorktreeFastForwarded","vmOverlapFileMadeDirty","freshTowerOverlapCommitCreated","towerSecondSignedAdvanceObserved","vmMirrorAndCursorAdvanced","vmWorktreeHeadAndDirtyFileObservedUntouched"],"requiredObservations":["freshRunBoundBelowSteerHead","exactVisibleIntegrationRequest","ratifyIntegrationRequestResult","productionGitSyncTriggers","signedStagingAdvanceOnBothPhysicalHosts","integratorNamespaceAndCanonicalStagingOids","worktreeBridgeCursorEpochSeqAndEventRow","secondFreshOverlappingAdvance","unchangedDirtyWorktreeHead","unchangedProtectedFileHash"],"forbiddenEvidence":["localSecondWorktreeAsPhysicalProof","directGitFetch","directRefMutation","preAuthoredManifest","environmentSuppliedCommand","callerSelectedRepoOrWorktree"],"productionSurfaces":["git-sync:run","setCommsTrust","listIntegrationRequests","ratifyIntegrationRequest","pot-git:staging-advance","worktree-bridge"],"externalCommandOverrides":false}
JSON
}

phase_e_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"E","planItem":"P-306","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","repoKey":"gh-1303510992","topology":"two-host-commit-only-members-to-single-github-bridge-writer"},"causalOrder":["legacyModeObservedOnBothHosts","bridgedModePersistedThroughSetPotGitMode","bothPhysicalMemberGitSyncTicksTriggered","bothMembersObservedCommitOnlyWithNoDirectPushes","freshFixedUpstreamIngressCreated","bridgeIngressAdmissionAndIntegrationTicksTriggered","lastAdmittedReachedExactIngressHead","canonicalAndForkStagingConverged","twoProductionWatchdogSweepsStayedQuiet","freshForkAheadControlCreated","bridgeReportedStructuredEgressNonFastForward","canonicalStayedFixedDuringDivergence","forkRestoredWithForceWithLease","legacyModeRestoredAndObservedOnBothHosts"],"requiredObservations":["federatedModeRowOnBothPhysicalHosts","commitOnlyRoutineMetadataAndEmptyLastPushed","freshUpstreamHead","githubBridgeLastAdmitted","canonicalStagingOid","forkRemoteStagingOid","productionGitSyncTriggers","twoDistinctCheckGitSyncStallResults","structuredEgressNonFfEscalation","unchangedCanonicalAcrossForkAheadControl","forceWithLeaseRecoveryRecord","legacyRollbackOnBothHosts"],"forbiddenEvidence":["memberDirectPush","summaryOnlyLegPass","singleHostObservation","callerSelectedRepoRefOrRemote","directCanonicalRefMutation","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["setPotGitMode","git-sync:run","runGithubBridgeLeg","checkGitSyncStall","github-bridge-divergence"],"externalCommandOverrides":false}
JSON
}

phase_f_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"F","planItem":"P-307","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"topology":"two-host-private-lifecycle-repositories","repositoryLifetime":"one-host-execution"},"causalOrder":["privateBareRepositoriesCreatedOnEachPhysicalHost","liveAndDepartedNamespacesPopulated","productionGcCollectorExecuted","WorkRefAndNewestTwoPublishedRefsRetained","oldestPublishedRefPruned","departedNamespaceArchived","cleanPublishAdmitted","plantedCredentialRefused","oversizedBlobRefused","temporaryRepositoriesRemoved","twoHostLifecycleEvidenceAggregated"],"requiredObservations":["towerAndVmProductionLifecycleResults","identityDerivedLiveAndDepartedNamespaces","exactBeforeAndAfterRefInventories","gcHiveGitRepoResult","checkPublishGuardCleanResult","checkPublishGuardSecretRefusal","checkPublishGuardOversizedBlobRefusal","temporaryRepositoryCleanup"],"forbiddenEvidence":["singleHostLifecycleResult","summaryOnlyLegPass","callerSelectedRepoPath","callerSelectedNamespaceOrRetentionCap","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["gcHiveGitRepo","checkPublishGuard"],"externalCommandOverrides":false}
JSON
}

phase_g_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"G","planItem":"P-308","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"topology":"two-host-attested-ephemeral-protocol-adapter","repositoryLifetime":"one-phase-execution"},"causalOrder":["outerPhysicalIdentitiesPreflighted","singleOwningHivePublicationTermDerived","ownerCountersignedAdvanceAccepted","deviceOnlyHigherTermRejectedWithoutRefMove","staleOwnerPublicationRejectedWithoutRefMove","retryableUnknownShaHeldCursor","retryableUnknownGenerationHeldCursor","evidenceArrivalAdvancedCursor","pgReadFailureFailedOpenLegacy","nonFastForwardPushRecoveredWithoutForce","coreKeyRotatedWithStableEphemeralNamespace","exactGitRoundTripVerified","temporaryStateRemoved","outerHostReceiptsAttestSameRunManifest"],"requiredObservations":["truthfulPhysicalVsEphemeralIdentityBoundary","singleOwningHiveCountersignatureAndSignedContext","acceptedPublicationAndRejectedDeviceOnlyHigherTerm","rejectedStaleOwnerPublication","unchangedReceiverRefAfterDeniedAttempts","durableRetryCursorBeforeAndAfterEvidence","structuredPostgresFallback","noisyNonFastForwardAndSuccessfulRetry","noForcePush","distinctCoreKeys","stableEphemeralDeviceNamespace","exactCommitAndPayloadRoundTrip","temporaryRepositoryCleanup"],"forbiddenEvidence":["protocolSignerRepresentedAsPhysicalHost","automaticOwnershipFailover","summaryOnlyLegPass","callerSelectedRepoPath","callerSelectedProtocolKey","preAuthoredManifest","environmentSuppliedCommand"],"productionSurfaces":["nextHivePublicationTerm","requireHiveEffectAuthority","signStagingAdvance","acceptStagingAdvanceFF","runWorktreeBridgeTick","decideWorktreeBridgePersistence","readPotGitMode","runGitSync","openOwnLog","deviceNamespaceKey","writeNamespaceRef","readNamespaceRef"],"externalCommandOverrides":false}
JSON
}

phase_h_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"H","planItem":"P-521","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","servingOwner":"vm-operator","publisher":"separate-vm-process"},"causalOrder":["liveOwnerCapabilitySignsAndPublishes","frozenOwnerOmittedRetryableWithoutRefMove","sameArtifactRestartFreshRuntimePublishes","staleRuntimeCapabilityRefused","storeReplacementFreshGenerationPublishes","towerServesEachSignedSigrefs"]}
JSON
}

phase_i_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"I","planItem":"P-521","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"topology":"two-host-divergent-advisory-views-single-vm-owning-hive","owner":"separate-vm-drill-owner-process","targets":"disposable-per-host-stand-ins"},"causalOrder":["vmOwnerStartedWithFreshRunBoundHiveKey","vmOwnerAuthorizedEveryProtectedEffect","staleScopeOwnerKeyRefused","towerMissingDeviceOnlyReplayedAndForeignAuthorityRefused","ownerKilledBetweenAuthorizedPushAndPrOpen","nextPushAndSubmodulePublicationRefused","outageRefusedBothHostsWithoutFailover","localCommitsAndSignedDeviceHeadExchangeContinued","ownerRelaunchedWithSameKey","restoredOwnerMadeFreshProgressTowerStillRefused"],"requiredObservations":["protectedTargetSnapshotsBeforeAndAfterEveryAttempt","everySinkPushArgv","capturedGenuineOwnerSignature","ownerProcessGoneAfterLoss","noForcePush"],"forbiddenEvidence":["sharedRealRemoteAsTarget","ownerKeyOnTower","automaticOwnershipFailover","attemptInsideOwnerProcess","summaryOnlyLegPass"],"productionSurfaces":["integrateMemberHeads","promoteRelease","egressCanonicalRefs","runGitSync","egressRatifiedRequestAsForkPr","requireHiveEffectAuthority","electFleetLeader","buildSigrefs","acceptFetchedSigrefs"],"externalCommandOverrides":false}
JSON
}

phase_j_contract() {
  cat <<'JSON'
{"schemaVersion":"hive-git-physical-phase-contract/v1","phase":"J","planItem":"P-521","state":"executor-installed","ready":true,"missingAssertions":[],"target":{"potHomeSlug":"hello-world-3-pot","applyTarget":"vm-read-merge-into-vm-postgres","fault":"vm-scoped-57P03-trigger-on-run-bound-write-A","towerRole":"author-only-never-frozen-restarted-or-faulted"},"causalOrder":["baselineNeitherWriteAndNoFault","vmOutageFaultInstalledBeforeAnyWrite","towerAuthoredWritesAAndBThroughProductionVerb","vmCursorHeldAtWriteAPastRetiredRetryBudget","holdSurvivedVmOwnerRestartOnSameArtifact","faultRemovedAndTowerExactWritesReplayed"],"requiredObservations":["durableRetryableApplyFailureNamingWriteA","everyHeldSample","vmOwnerIdentityBeforeAndAfterRestart","faultMeasuredPresentAfterInstallAndAbsentAfterRemove","towerAuthoredContentDigests"],"forbiddenEvidence":["towerBgHostFrozenRestartedOrFaulted","cursorAdvancedPastWriteAUnderFault","unboundedOutage","faultOutlivesScenario"],"productionSurfaces":["work_items:create","mergeAdmittedLogsIncremental","substrate_merge_cursor.apply_failure"],"externalCommandOverrides":false}
JSON
}

# Phase selection (plan physical-drill-iteration-speed-2026-09-29 P-002). Unset means every
# phase: the release run. A subset is a diagnostic re-run against the rig state the last
# run left behind, and never emits release evidence (see the end of this file).
# shellcheck source=../lib/physical-phase-select.sh
. "$HERE/../lib/physical-phase-select.sh"
# The rig profile (P-005, D-003) is SOURCED here, before the first profile-dependent check
# (the identity contract below); sourcing only defines constants and functions. It is
# APPLIED later, once every host value it retargets exists (rig_profile_apply).
# shellcheck source=lib/rig-profile.sh
. "$HERE/lib/rig-profile.sh"
SCENARIO_PHASES="$(physical_phase_list "${HIVE_GIT_PHYSICAL_PHASES:-}")" \
  || fail "HIVE_GIT_PHYSICAL_PHASES=${HIVE_GIT_PHYSICAL_PHASES:-} is not a phase selection ($PHYSICAL_PHASE_RANGE, comma-separated)"
SCENARIO_FULL_RUN=0
physical_phase_is_full "$SCENARIO_PHASES" && SCENARIO_FULL_RUN=1

# Offline: which phases this invocation would run, without touching the rig.
if [ "${1:-}" = '--phase-plan' ]; then
  printf '{"schemaVersion":"hive-git-physical-phase-plan/v1","phases":"%s","fullRun":%s,"releaseEvidence":%s}\n' \
    "$SCENARIO_PHASES" "$([ "$SCENARIO_FULL_RUN" = 1 ] && echo true || echo false)" \
    "$([ "$SCENARIO_FULL_RUN" = 1 ] && echo true || echo false)"
  exit 0
fi

if [ "${1:-}" = '--contract-check' ]; then
  printf '{"schemaVersion":"hive-git-physical-scenario-contract/v1","implementationState":"%s","ready":true,"phases":["A","B","C","D","E","F","G","H","I","J"],"phaseContracts":{"A":"executor-installed","B":"executor-installed","C":"executor-installed","D":"executor-installed","E":"executor-installed","F":"executor-installed","G":"executor-installed","H":"executor-installed","I":"executor-installed","J":"executor-installed"}}\n' \
    "$IMPLEMENTATION_STATE"
  exit 0
fi
if [ "${1:-}" = '--phase-contract' ]; then
  [ "$#" -eq 2 ] || fail 'usage: hive-git-physical-scenario.sh --phase-contract A|B|C|D|E|F|G|H|I|J'
  case "$2" in
    A) phase_a_contract ;;
    B) phase_b_contract ;;
    C) phase_c_contract ;;
    D) phase_d_contract ;;
    E) phase_e_contract ;;
    F) phase_f_contract ;;
    G) phase_g_contract ;;
    H) phase_h_contract ;;
    I) phase_i_contract ;;
    J) phase_j_contract ;;
    *) fail "phase $2 has no installed offline contract" ;;
  esac
  exit 0
fi
if [ "${1:-}" = '--require-ready' ]; then
  [ "$IMPLEMENTATION_STATE" = 'ready-v1' ] \
    || fail "scenario is not execution-ready ($IMPLEMENTATION_STATE); A-J phase executors have not all landed"
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
# Two machines are a release-evidence property. The same-box rig runs both owners on ONE
# machine by construction, and a diagnostic run never emits signable evidence (D-005 (5)),
# so only the physical rig demands distinct machines. Distinct owners are required always.
if ! rig_profile_is_diagnostic; then
  [ "$tower_machine" != "$vm_machine" ] \
    || fail 'tower and vm identities resolve to the same physical machine'
fi

# The order is part of D-002: G may run only after the same physical run has
# observed A-F. These fixed functions are intentionally not replaceable via env.
phase_a_storage_join() {
  # The physical rig's target is fixed. Only a diagnostic same-box run takes its own pot, and
  # the producer re-derives that same target from the profile (physicalDrillTarget).
  local want_pot='hello-world-3-pot' want_key='gh-1303510992'
  if rig_profile_is_diagnostic; then want_pot="$SB_POT_HOME"; want_key="$SB_REPO_KEY"; fi
  [ "$PHASE_A_POT_HOME" = "$want_pot" ] \
    && [ "$PHASE_A_REPO_KEY" = "$want_key" ] \
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
  started_at="$(now_iso)"

  require_phase_a_two_host_substrate_ready >"$phase_dir/two-host-substrate-readiness.json"

  # single-read: the tower baseline, taken before the quarantine and the bootstrap — nothing is in flight yet
  "$TSX" "$PRODUCER" phase-a-observe tower present "$TOWER_REPO" \
    "$tower_device" "$vm_device" >"$phase_dir/tower-before.json"
  # The baseline is Phase A's precondition (the tower already holds the VM's device
  # namespace), and nothing below can change it. Check it before the quarantine mutates
  # the VM: same-box run 20260930T085016Z-2629813 only learned of a missing VM namespace
  # from the convergence wait's verifier, 20 minutes later.
  "$TSX" "$PRODUCER" phase-a-precheck "$phase_dir/tower-before.json" \
    "$tower_device" "$vm_device" >"$phase_dir/precheck.json" 2>"$phase_dir/precheck.err" \
    || { cat "$phase_dir/precheck.err" >&2; fail 'phase A precondition: the tower baseline does not hold both device namespaces'; }

  # Quarantine and the absence observation MUST be one VM process: the VM's
  # scheduled git-sync bootstrap tick legitimately recreates a missing store,
  # and two separate ssh + tsx launches left a ~25s window it won on P-505
  # run 12 (WI-10003632). The producer renames, then observes absence
  # microseconds later, and emits both records; split them here.
  # single-read: absence is read in the SAME process as the local rename — waiting would hand the store back to the bootstrap tick
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-quarantine-observe '$VM_REPO' '$run_id' '$vm_device' '$tower_device'" \
    >"$phase_dir/quarantine-observe.json"
  node - "$phase_dir" <<'NODE' || fail 'phase A quarantine-observe did not return quarantine + vmAbsent records'
const fs = require('node:fs');
const dir = process.argv[2];
const raw = fs.readFileSync(`${dir}/quarantine-observe.json`, 'utf8');
const start = raw.indexOf('{');
const end = raw.lastIndexOf('}');
const value = start >= 0 && end > start ? JSON.parse(raw.slice(start, end + 1)) : null;
if (!value || typeof value.quarantine !== 'object' || typeof value.vmAbsent !== 'object') process.exit(1);
fs.writeFileSync(`${dir}/quarantine.json`, JSON.stringify(value.quarantine, null, 2));
fs.writeFileSync(`${dir}/vm-absent.json`, JSON.stringify(value.vmAbsent, null, 2));
NODE

  bootstrap_started="$(now_iso)"
  run_vm_git_sync >"$phase_dir/bootstrap-raw.json"
  bootstrap_finished="$(now_iso)"

  # A multi-GB cold join is allowed to take minutes. Presence is necessary but
  # not sufficient: keep sampling until the strict verifier observes both
  # namespaces, both signed witnesses, exact ref-OID parity, and independent
  # object databases. Capture tower first and the final VM snapshot second so
  # the evidence preserves the validator's causal order.
  local deadline=$((SECONDS + 1200))
  local receive_drive=0 next_receive_drive=$((SECONDS + 60))
  while :; do
    "$TSX" "$PRODUCER" phase-a-observe tower present "$TOWER_REPO" \
      "$tower_device" "$vm_device" >"$phase_dir/tower-after.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-observe vm present '$VM_REPO' '$vm_device' '$tower_device'" \
      >"$phase_dir/vm-after.json" 2>"$phase_dir/vm-after.err"; then
      finished_at="$(now_iso)"

      node - "$phase_dir" "$run_id" "$started_at" "$bootstrap_started" \
        "$bootstrap_finished" "$finished_at" "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, bootstrapStarted, bootstrapFinished, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const vmGitSyncSlug = process.env.VM_GIT_SYNC_SLUG;
if (!vmGitSyncSlug) throw new Error('vm git-sync slug is not exported by the scenario');
fs.writeFileSync(`${dir}/verify-input.json`, JSON.stringify({
  schemaVersion: 'hive-git-physical-phase-a-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  quarantine: read('quarantine'),
  bootstrap: {
    tool: 'git-sync:run', installSlug: vmGitSyncSlug, targetHost: 'vm', fired: true,
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
      local verify_rc=0
      "$TSX" "$PRODUCER" phase-a-verify "$phase_dir/verify-input.json" \
        >"$phase_dir/verdict.json" 2>"$phase_dir/verdict.err" || verify_rc=$?
      [ "$verify_rc" -eq 0 ] && break
      # Exit 3 = not converged yet (retry). Anything else rejected an input fixed before
      # this wait, which another observation cannot clear: stop now, not at the deadline.
      if [ "$verify_rc" -ne 3 ]; then
        cat "$phase_dir/verdict.err" >&2
        fail "phase A verifier rejected a frozen input (exit $verify_rc); retrying cannot clear it"
      fi
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      if [ -s "$phase_dir/verdict.err" ]; then
        cat "$phase_dir/verdict.err" >&2
      elif [ -s "$phase_dir/vm-after.err" ]; then
        cat "$phase_dir/vm-after.err" >&2
      fi
      fail 'phase A canonical bootstrap did not reach strict two-host convergence within 20 minutes'
    fi
    # Drive both hosts' production receive instead of waiting on the 10-min
    # scheduled tick (WI-10003711). The quarantine itself makes the VM commit a
    # github-bridge escalation set and clear, which moves the VM namespace, and
    # the tower only receives peer announces on its git-sync tick. Phase B already
    # drives the receive this way on every attempt. Every fire is kept as evidence.
    if [ "$SECONDS" -ge "$next_receive_drive" ]; then
      receive_drive=$((receive_drive + 1))
      run_vm_git_sync >"$phase_dir/drive-vm-receive-$receive_drive.log" 2>&1 || true
      run_tower_git_sync >"$phase_dir/drive-tower-receive-$receive_drive.log" 2>&1 || true
      next_receive_drive=$((SECONDS + 120))
    fi
    sleep 10
  done
}
# Print one dotted field of a JSON artifact, or nothing when it is absent.
phase_b_json_field() {
  node -e 'const v = process.argv[2].split(".").reduce((o, k) => o?.[k], JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))); if (v != null) process.stdout.write(String(v));' "$1" "$2"
}
phase_b_ref_announce() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] && [ -x "$TOWER_CALL" ] \
    || fail 'phase B local producer or canonical ptool is unavailable'

  # Like Phase A, this remains unreachable until every A-I executor exists.
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
  local deadline attempt rc
  local forward_oid forward_before_version reverse_oid reverse_before_version
  mkdir -m 700 "$phase_dir"
  mkdir -m 700 "$forward_dir" "$reverse_dir"
  started_at="$(now_iso)"

  forward_started="$(now_iso)"
  # single-read: source baseline, taken before the tower-to-vm commit exists
  "$TSX" "$PRODUCER" phase-b-observe tower tower-to-vm absent "$TOWER_REPO" \
    "$tower_device" "$run_id" >"$forward_dir/source-before.json"
  # single-read: destination baseline, taken before the tower-to-vm commit exists
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm tower-to-vm absent '$VM_REPO' '$tower_device' '$run_id'" \
    >"$forward_dir/destination-before.json"
  "$TSX" "$PRODUCER" phase-b-commit tower tower-to-vm "$TOWER_REPO" \
    "$tower_device" "$run_id" >"$forward_dir/mutation.json"
  forward_oid="$(phase_b_json_field "$forward_dir/mutation.json" oid)"
  forward_before_version="$(phase_b_json_field "$forward_dir/source-before.json" signedSigrefs.version)"
  [ -n "$forward_oid" ] && [ -n "$forward_before_version" ] \
    || fail 'phase B tower-to-vm has no mutation OID or pre-commit sigrefs version'
  forward_publish_started="$(now_iso)"
  run_tower_git_sync >"$forward_dir/source-publish-raw.json"
  require_git_sync_fired "$forward_dir/source-publish-raw.json" 'phase B tower source-publish'
  # The publish fire can return in_progress while its ref-announce leg is still
  # writing, so read the source until its signed sigrefs cover the fresh commit
  # (P-505 run 33b read it once, 11s after signing, before the local sigrefs ref
  # moved). Each retry nudges git-sync and re-stamps the publish finish, which
  # keeps the verifier's publish-before-source-observation order.
  deadline=$((SECONDS + 600))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    forward_publish_finished="$(now_iso)"
    rc=0
    "$TSX" "$PRODUCER" phase-b-observe tower tower-to-vm present "$TOWER_REPO" \
      "$tower_device" "$run_id" "$forward_oid" "$forward_before_version" \
      >"$forward_dir/source-after.json" 2>"$forward_dir/source-after.err" || rc=$?
    [ "$rc" -ne 0 ] || break
    [ "$rc" -eq 3 ] \
      || fail "phase B tower source observation failed (exit $rc); see $forward_dir/source-after.err"
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase B tower source sigrefs did not cover the fresh commit within 600s: $(tail -n 1 "$forward_dir/source-after.err")"
    run_tower_git_sync >"$forward_dir/source-publish-nudge-$attempt.json" 2>&1 || true
    sleep 10
  done
  forward_receive_started="$(now_iso)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    run_vm_git_sync >"$forward_dir/destination-receive-$attempt.json"
    # Stamp the receive's finish BEFORE observing it. The verifier requires
    # destinationReceive.finishedAt <= destinationAfter.observedAt, and a stamp
    # taken after the loop's break always lands after the observation, which
    # rejected every run (WI-10003717, P-505 run 14).
    forward_receive_finished="$(now_iso)"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm tower-to-vm present '$VM_REPO' '$tower_device' '$run_id' '$forward_oid' '$forward_before_version'" \
      >"$forward_dir/destination-after.json" 2>"$forward_dir/destination-after.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase B tower-to-vm ref announcement did not materialize within 20 minutes'
    sleep 10
  done
  forward_finished="$(now_iso)"

  reverse_started="$(now_iso)"
  # single-read: source baseline, taken before the vm-to-tower commit exists
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm vm-to-tower absent '$VM_REPO' '$vm_device' '$run_id'" \
    >"$reverse_dir/source-before.json"
  # single-read: destination baseline, taken before the vm-to-tower commit exists
  "$TSX" "$PRODUCER" phase-b-observe tower vm-to-tower absent "$TOWER_REPO" \
    "$vm_device" "$run_id" >"$reverse_dir/destination-before.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-commit vm vm-to-tower '$VM_REPO' '$vm_device' '$run_id'" \
    >"$reverse_dir/mutation.json"
  reverse_oid="$(phase_b_json_field "$reverse_dir/mutation.json" oid)"
  reverse_before_version="$(phase_b_json_field "$reverse_dir/source-before.json" signedSigrefs.version)"
  [ -n "$reverse_oid" ] && [ -n "$reverse_before_version" ] \
    || fail 'phase B vm-to-tower has no mutation OID or pre-commit sigrefs version'
  reverse_publish_started="$(now_iso)"
  run_vm_git_sync >"$reverse_dir/source-publish-raw.json"
  require_git_sync_fired "$reverse_dir/source-publish-raw.json" 'phase B vm source-publish'
  deadline=$((SECONDS + 600))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    reverse_publish_finished="$(now_iso)"
    rc=0
    ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-b-observe vm vm-to-tower present '$VM_REPO' '$vm_device' '$run_id' '$reverse_oid' '$reverse_before_version'" \
      >"$reverse_dir/source-after.json" 2>"$reverse_dir/source-after.err" || rc=$?
    [ "$rc" -ne 0 ] || break
    [ "$rc" -eq 3 ] \
      || fail "phase B vm source observation failed (exit $rc); see $reverse_dir/source-after.err"
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase B vm source sigrefs did not cover the fresh commit within 600s: $(tail -n 1 "$reverse_dir/source-after.err")"
    run_vm_git_sync >"$reverse_dir/source-publish-nudge-$attempt.json" 2>&1 || true
    sleep 10
  done
  reverse_receive_started="$(now_iso)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    run_tower_git_sync >"$reverse_dir/destination-receive-$attempt.json"
    reverse_receive_finished="$(now_iso)"
    if "$TSX" "$PRODUCER" phase-b-observe tower vm-to-tower present "$TOWER_REPO" \
      "$vm_device" "$run_id" "$reverse_oid" "$reverse_before_version" \
      >"$reverse_dir/destination-after.json" 2>"$reverse_dir/destination-after.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase B vm-to-tower ref announcement did not materialize within 20 minutes'
    sleep 10
  done
  reverse_finished="$(now_iso)"
  finished_at="$(now_iso)"

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
const gitSyncSlug = (host) => {
  const slug = process.env[host === 'tower' ? 'TOWER_GIT_SYNC_SLUG' : 'VM_GIT_SYNC_SLUG'];
  if (!slug) throw new Error(`${host} git-sync slug is not exported by the scenario`);
  return slug;
};
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
      sourcePublish: { tool: 'git-sync:run', installSlug: gitSyncSlug(sourceHost), host: sourceHost,
        role: 'source-publish', fired: true, startedAt: publishStarted, finishedAt: publishFinished },
      destinationReceive: { tool: 'git-sync:run', installSlug: gitSyncSlug(destinationHost), host: destinationHost,
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
  started_at="$(now_iso)"

  "$TSX" "$PRODUCER" phase-c-run tower "$TOWER_REPO" \
    "$tower_device" "$vm_device" "$run_id" >"$phase_dir/tower.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-c-run vm '$VM_REPO' '$vm_device' '$tower_device' '$run_id'" \
    >"$phase_dir/vm.json"
  finished_at="$(now_iso)"

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
# Phase D rig-state preconditions (WI-10003723). Both are set only while the
# scenario holds a change it must undo, and the EXIT trap undoes it if the
# phase dies first: the tower-side comms-tier hold, and this run's own planted
# dirt in the VM worktree. Both undo steps are idempotent.
PHASE_D_TIER_HOLD=''
PHASE_D_VM_DIRTY_RUN=''
# Bounded wait for the tower's own signed staging event after a tower integrate
# that may have returned in_progress (WI-10003787). The producer caps it at 1200.
PHASE_D_TOWER_EVENT_WAIT_SEC=600

# A duplicate signed event for one head is a producer defect (WI-10003781);
# retrying the VM capture would only turn it into a 20-minute timeout.
phase_d_fail_on_duplicate_event() {
  local err_file="$1" which="$2"
  if grep -q 'duplicate signed production staging events' "$err_file" 2>/dev/null; then
    fail "phase D $which advance: duplicate signed staging events for one head on the VM; see $err_file"
  fi
}
# Observe one Phase D host until it has converged to the expected signed head
# (WI-10003811). Each host reaches the head asynchronously. P-505 run 30 read
# both once, 7-23s after the event, and caught each mid-flight. The tower's own
# canonical ref, worktree and cursor were still on the prior head. The VM had
# not yet refreshed its mirror of the integrator namespace ref. Between
# attempts this fires that host's git-sync, so its bridge runs now rather than
# on the 10-minute scheduled tick. The producer exits 3 when the host has not
# converged and still prints the observation, so the last attempt survives as
# evidence. The verifier stays the judge.
# Usage: phase_d_observe_converged <tower|vm> <stage> <device> <run-id> <sha> <out.json> <budget-sec>
phase_d_observe_converged() {
  local host="$1" stage="$2" device="$3" run="$4" expected="$5" out="$6" budget="$7"
  local deadline=$((SECONDS + budget)) attempt=0 rc
  while :; do
    attempt=$((attempt + 1))
    rc=0
    if [ "$host" = tower ]; then
      "$TSX" "$PRODUCER" phase-d-observe tower "$stage" "$device" "$run" "$expected" \
        >"$out" 2>"${out%.json}.err" || rc=$?
    else
      ssh "${SSH_OPTS[@]}" "$VM" \
        "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-observe vm '$stage' '$device' '$run' '$expected'" \
        >"$out" 2>"${out%.json}.err" || rc=$?
    fi
    [ "$rc" -ne 0 ] || return 0
    [ "$rc" -eq 3 ] \
      || fail "phase D $host $stage observation failed (exit $rc); see ${out%.json}.err"
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase D $host $stage did not converge to $expected within ${budget}s: $(tail -n 1 "${out%.json}.err")"
    if [ "$host" = tower ]; then run_tower_git_sync; else run_vm_git_sync; fi \
      >"${out%.json}-nudge-$attempt.json" 2>&1 || true
    sleep 10
  done
}
phase_d_tier_restore() {
  [ -n "$PHASE_D_TIER_HOLD" ] || return 0
  "$TSX" "$PRODUCER" phase-d-tier-restore "$PHASE_D_TIER_HOLD"
}
phase_d_vm_reset() {
  [ -n "$PHASE_D_VM_DIRTY_RUN" ] || return 0
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-reset '$PHASE_D_VM_DIRTY_RUN'"
}
phase_d_restore_on_exit() {
  if [ -n "$PHASE_D_TIER_HOLD" ] && [ -f "$PHASE_D_TIER_HOLD" ]; then
    phase_d_tier_restore >"${PHASE_D_TIER_HOLD%.json}-exit-restore.json" 2>"${PHASE_D_TIER_HOLD%.json}-exit-restore.err" \
      || echo "hive-git-physical-scenario: WARNING phase D tier restore failed; run: $TSX $PRODUCER phase-d-tier-restore $PHASE_D_TIER_HOLD" >&2
  fi
  if [ -n "$PHASE_D_VM_DIRTY_RUN" ]; then
    phase_d_vm_reset >/dev/null 2>&1 \
      || echo "hive-git-physical-scenario: WARNING phase D VM worktree reset failed for run $PHASE_D_VM_DIRTY_RUN" >&2
  fi
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
  started_at="$(now_iso)"

  # The tower's comms-trust row can pin the VM user at or above the
  # auto-integrate tier ('steer'); the integrator then merges the VM head and
  # never queues the request this phase must observe (P-505 run 15). Hold the
  # user below steer through the production surface, with the exact prior row
  # recorded first, then outwait the integrator's 30s tier cache
  # (comms-tier-gate.ts CACHE_TTL_MS) before the below-steer head exists.
  PHASE_D_TIER_HOLD="$phase_dir/phase-d-tier-hold.json"
  trap phase_d_restore_on_exit EXIT
  "$TSX" "$PRODUCER" phase-d-tier-hold "$vm_device" "$run_id" "$PHASE_D_TIER_HOLD" \
    >"$phase_dir/tier-hold-receipt.json"
  sleep 35

  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-commit vm below-steer '$vm_device' '$run_id'" \
    >"$first_dir/mutation.json"
  first_head="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).headOid)" "$first_dir/mutation.json")"

  publish_started="$(now_iso)"
  run_vm_git_sync >"$first_dir/publish-raw.json"
  require_git_sync_fired "$first_dir/publish-raw.json" 'phase D vm publish'
  publish_finished="$(now_iso)"

  queue_started="$(now_iso)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    run_tower_git_sync >"$first_dir/queue-receive-$attempt.json"
    if "$TSX" "$PRODUCER" phase-d-request pending "$vm_device" "$first_head" \
      >"$first_dir/pending-request.json" 2>"$first_dir/pending-request.err"; then
      break
    fi
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D fresh below-steer request did not become visible on the tower within 20 minutes'
    sleep 10
  done
  queue_finished="$(now_iso)"
  "$TSX" "$PRODUCER" phase-d-ratify "$vm_device" "$first_head" \
    >"$first_dir/ratification.json"
  # Ratification is keyed to (device, head), so restoring the prior tier now
  # cannot change how this run-bound head integrates.
  phase_d_tier_restore >"$phase_dir/tier-restore.json"

  integrate_started="$(now_iso)"
  run_tower_git_sync >"$first_dir/integrate-raw.json"
  require_git_sync_fired "$first_dir/integrate-raw.json" 'phase D tower integrate'
  integrate_finished="$(now_iso)"
  # The integrate call may return in_progress (45s window); the capture waits
  # up to PHASE_D_TOWER_EVENT_WAIT_SEC for the one event (WI-10003787).
  "$TSX" "$PRODUCER" phase-d-event tower 0 "$tower_device" "$first_head" "$PHASE_D_TOWER_EVENT_WAIT_SEC" \
    >"$first_dir/source-event.json"
  phase_d_observe_converged tower first-source "$tower_device" "$run_id" "$first_head" \
    "$first_dir/source-observation.json" 1200

  first_bridge_started="$(now_iso)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    run_vm_git_sync >"$first_dir/destination-bridge-$attempt.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-event vm 0 '$tower_device' '$first_head'" \
      >"$first_dir/destination-event.json" 2>"$first_dir/destination-event.err"; then
      break
    fi
    phase_d_fail_on_duplicate_event "$first_dir/destination-event.err" 'first'
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D first signed staging advance did not reach the VM within 20 minutes'
    sleep 10
  done
  first_bridge_finished="$(now_iso)"
  phase_d_observe_converged vm first-destination "$tower_device" "$run_id" "$first_head" \
    "$first_dir/destination-observation.json" 1200

  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-dirty '$run_id'" \
    >"$dirty_dir/dirty-mutation.json"
  PHASE_D_VM_DIRTY_RUN="$run_id"
  # single-read: baseline after the VM's own synchronous dirty write, before the tower commit — nothing cross-host is in flight
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-observe vm dirty-before '$tower_device' '$run_id'" \
    >"$dirty_dir/before-observation.json"

  "$TSX" "$PRODUCER" phase-d-commit tower dirty-overlap "$tower_device" "$run_id" \
    >"$dirty_dir/mutation.json"
  second_head="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).headOid)" "$dirty_dir/mutation.json")"
  dirty_integrate_started="$(now_iso)"
  run_tower_git_sync >"$dirty_dir/integrate-raw.json"
  require_git_sync_fired "$dirty_dir/integrate-raw.json" 'phase D tower dirty integrate'
  dirty_integrate_finished="$(now_iso)"
  "$TSX" "$PRODUCER" phase-d-event tower 0 "$tower_device" "$second_head" "$PHASE_D_TOWER_EVENT_WAIT_SEC" \
    >"$dirty_dir/source-event.json"

  dirty_bridge_started="$(now_iso)"
  deadline=$((SECONDS + 1200))
  attempt=0
  while :; do
    attempt=$((attempt + 1))
    run_vm_git_sync >"$dirty_dir/destination-bridge-$attempt.json"
    if ssh "${SSH_OPTS[@]}" "$VM" \
      "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-d-event vm 0 '$tower_device' '$second_head'" \
      >"$dirty_dir/destination-event.json" 2>"$dirty_dir/destination-event.err"; then
      break
    fi
    phase_d_fail_on_duplicate_event "$dirty_dir/destination-event.err" 'second'
    [ "$SECONDS" -lt "$deadline" ] \
      || fail 'phase D second signed staging advance did not reach the VM within 20 minutes'
    sleep 10
  done
  dirty_bridge_finished="$(now_iso)"
  # Short bound: the dirt's file lock has a 30-minute TTL
  # (PHASE_D_DIRT_LOCK_TTL_SEC), and the event waits above already spend part
  # of it. git-sync must never see the dirt unlocked.
  phase_d_observe_converged vm dirty-after "$tower_device" "$run_id" "$second_head" \
    "$dirty_dir/after-observation.json" 300
  finished_at="$(now_iso)"

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
const gitSyncSlug = (host) => {
  const slug = process.env[host === 'tower' ? 'TOWER_GIT_SYNC_SLUG' : 'VM_GIT_SYNC_SLUG'];
  if (!slug) throw new Error(`${host} git-sync slug is not exported by the scenario`);
  return slug;
};
const trigger = (host, role, triggerStartedAt, triggerFinishedAt) => ({
  tool: 'git-sync:run', installSlug: gitSyncSlug(host), host, role, fired: true,
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
  # The dirty file was this run's own probe; once observed untouched it is
  # discarded so later phases and the next run start from a clean worktree.
  phase_d_vm_reset >"$dirty_dir/reset.json"
  PHASE_D_VM_DIRTY_RUN=''
  PHASE_D_TIER_HOLD=''
  trap - EXIT
}
# Phase E rig state (WI-10003791): the canary's original hiveGit.mode and a
# fork-ahead control that stays armed until recovered. The EXIT trap undoes
# both if the phase dies first. It must be EXIT: a RETURN trap never runs when
# set -e ends the shell mid-function. Both undo steps are idempotent.
PHASE_E_DIR=''
PHASE_E_RUN_ID=''
PHASE_E_RESTORE_MODE=''
PHASE_E_DIVERGENCE_MUTATION=''
# Bounded wait for each observation's stage mode: the VM learns the tower's
# mode write by federation, so a one-shot read races it. The producer caps it at 1200.
PHASE_E_MODE_WAIT_SEC=600
phase_e_restore_on_exit() {
  [ -n "$PHASE_E_DIR" ] || return 0
  if [ -n "$PHASE_E_DIVERGENCE_MUTATION" ] && [ -s "$PHASE_E_DIVERGENCE_MUTATION" ]; then
    "$TSX" "$PRODUCER" phase-e-recover "$PHASE_E_DIVERGENCE_MUTATION" \
      >"$PHASE_E_DIR/exit-recovery.json" 2>"$PHASE_E_DIR/exit-recovery.err" \
      || echo "hive-git-physical-scenario: WARNING phase E fork recovery failed; see $PHASE_E_DIR/exit-recovery.err" >&2
  fi
  if [ -n "$PHASE_E_RESTORE_MODE" ]; then
    "$TSX" "$PRODUCER" phase-e-mode-ensure "$PHASE_E_RESTORE_MODE" "$PHASE_E_RUN_ID" \
      >"$PHASE_E_DIR/exit-restore-mode.json" 2>"$PHASE_E_DIR/exit-restore-mode.err" \
      || echo "hive-git-physical-scenario: WARNING phase E mode restore to $PHASE_E_RESTORE_MODE failed; see $PHASE_E_DIR/exit-restore-mode.err" >&2
  fi
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
  local original_mode
  mkdir -m 700 "$phase_dir"

  # The fixed canary keeps the mode its hive chose (hello-world-3-pot has been
  # bridged since 2026-07-17), but the contract starts from legacy. Record the
  # original mode, arm the EXIT restore, then set the legacy baseline through
  # the production surface. The baseline write is not evidence.
  "$TSX" "$PRODUCER" phase-e-mode-read >"$phase_dir/original-mode.json"
  original_mode="$(node -e 'process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).mode))' \
    "$phase_dir/original-mode.json")"
  case "$original_mode" in
    legacy|bridged) ;;
    *) fail "phase E canary mode is '$original_mode'; the drill changes only legacy/bridged" ;;
  esac
  PHASE_E_DIR="$phase_dir"
  PHASE_E_RUN_ID="$run_id"
  PHASE_E_RESTORE_MODE="$original_mode"
  trap phase_e_restore_on_exit EXIT
  "$TSX" "$PRODUCER" phase-e-mode-ensure legacy "$run_id" \
    >"$phase_dir/baseline-mode.json"

  started_at="$(now_iso)"
  "$TSX" "$PRODUCER" phase-e-observe tower legacy-before "$tower_device" "$run_id" "$PHASE_E_MODE_WAIT_SEC" \
    >"$phase_dir/tower-legacy-before.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm legacy-before '$vm_device' '$run_id' '$PHASE_E_MODE_WAIT_SEC'" \
    >"$phase_dir/vm-legacy-before.json"

  "$TSX" "$PRODUCER" phase-e-mode bridged "$run_id" \
    >"$phase_dir/activation-mode.json"

  tower_member_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/tower-member-raw.json"
  require_git_sync_fired "$phase_dir/tower-member-raw.json" 'phase E tower member'
  tower_member_finished="$(now_iso)"
  # The VM learns the bridged row by federation; its tick must not fire before
  # the row lands, or it measures a legacy tick (WI-10003791 second race).
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-await-mode bridged-member '$PHASE_E_MODE_WAIT_SEC'" \
    >"$phase_dir/vm-member-mode-await.json"
  vm_member_started="$(now_iso)"
  run_vm_git_sync >"$phase_dir/vm-member-raw.json"
  require_git_sync_fired "$phase_dir/vm-member-raw.json" 'phase E vm member'
  vm_member_finished="$(now_iso)"
  # A tower observation judged on a fire's verdict waits for a finished fire
  # started at/after that trigger: git-sync:run answers in_progress at 45s and
  # the bridge row lands later (WI-10004055).
  "$TSX" "$PRODUCER" phase-e-observe tower bridged-member "$tower_device" "$run_id" "$PHASE_E_MODE_WAIT_SEC" "$tower_member_started" \
    >"$phase_dir/tower-bridged-member.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm bridged-member '$vm_device' '$run_id' '$PHASE_E_MODE_WAIT_SEC'" \
    >"$phase_dir/vm-bridged-member.json"

  "$TSX" "$PRODUCER" phase-e-ingress "$run_id" \
    >"$phase_dir/ingress-mutation.json"
  ingress_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/healthy-ingress-raw.json"
  require_git_sync_fired "$phase_dir/healthy-ingress-raw.json" 'phase E tower healthy ingress'
  ingress_finished="$(now_iso)"
  integrate_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/healthy-integrate-raw.json"
  require_git_sync_fired "$phase_dir/healthy-integrate-raw.json" 'phase E tower healthy integrate'
  integrate_finished="$(now_iso)"
  egress_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/healthy-egress-raw.json"
  require_git_sync_fired "$phase_dir/healthy-egress-raw.json" 'phase E tower healthy egress'
  egress_finished="$(now_iso)"
  "$TSX" "$PRODUCER" phase-e-observe tower healthy-egress "$tower_device" "$run_id" "$PHASE_E_MODE_WAIT_SEC" "$egress_started" \
    >"$phase_dir/healthy-observation.json"

  "$TSX" "$PRODUCER" phase-e-watchdog 1 "$run_id" \
    >"$phase_dir/watchdog-1.json"
  "$TSX" "$PRODUCER" phase-e-watchdog 2 "$run_id" \
    >"$phase_dir/watchdog-2.json"

  # single-read: baseline taken before the divergence mutation exists
  "$TSX" "$PRODUCER" phase-e-observe tower divergence-before "$tower_device" "$run_id" \
    >"$phase_dir/divergence-before.json"
  "$TSX" "$PRODUCER" phase-e-diverge "$run_id" \
    >"$phase_dir/divergence-mutation.json"
  PHASE_E_DIVERGENCE_MUTATION="$phase_dir/divergence-mutation.json"
  divergence_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/divergence-egress-raw.json"
  require_git_sync_fired "$phase_dir/divergence-egress-raw.json" 'phase E tower divergence egress'
  divergence_finished="$(now_iso)"
  "$TSX" "$PRODUCER" phase-e-observe tower divergence-after "$tower_device" "$run_id" "$PHASE_E_MODE_WAIT_SEC" "$divergence_started" \
    >"$phase_dir/divergence-after.json"
  "$TSX" "$PRODUCER" phase-e-recover "$phase_dir/divergence-mutation.json" \
    >"$phase_dir/divergence-recovery.json"
  PHASE_E_DIVERGENCE_MUTATION=''

  "$TSX" "$PRODUCER" phase-e-mode legacy "$run_id" \
    >"$phase_dir/rollback-mode.json"
  rollback_tower_started="$(now_iso)"
  run_tower_git_sync >"$phase_dir/rollback-tower-raw.json"
  require_git_sync_fired "$phase_dir/rollback-tower-raw.json" 'phase E tower rollback'
  rollback_tower_finished="$(now_iso)"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-await-mode legacy-after '$PHASE_E_MODE_WAIT_SEC'" \
    >"$phase_dir/rollback-vm-mode-await.json"
  rollback_vm_started="$(now_iso)"
  run_vm_git_sync >"$phase_dir/rollback-vm-raw.json"
  require_git_sync_fired "$phase_dir/rollback-vm-raw.json" 'phase E vm rollback'
  rollback_vm_finished="$(now_iso)"
  "$TSX" "$PRODUCER" phase-e-observe tower legacy-after "$tower_device" "$run_id" "$PHASE_E_MODE_WAIT_SEC" \
    >"$phase_dir/tower-legacy-after.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-e-observe vm legacy-after '$vm_device' '$run_id' '$PHASE_E_MODE_WAIT_SEC'" \
    >"$phase_dir/vm-legacy-after.json"
  finished_at="$(now_iso)"

  # Leave the canary in the mode its hive chose. Not evidence; the EXIT trap
  # retries it if this write or anything after it fails.
  "$TSX" "$PRODUCER" phase-e-mode-ensure "$PHASE_E_RESTORE_MODE" "$run_id" \
    >"$phase_dir/restore-mode.json"
  PHASE_E_RESTORE_MODE=''

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
const gitSyncSlug = (host) => {
  const slug = process.env[host === 'tower' ? 'TOWER_GIT_SYNC_SLUG' : 'VM_GIT_SYNC_SLUG'];
  if (!slug) throw new Error(`${host} git-sync slug is not exported by the scenario`);
  return slug;
};
const trigger = (host, role, triggerStartedAt, triggerFinishedAt) => ({
  tool: 'git-sync:run', installSlug: gitSyncSlug(host), host, role, fired: true,
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
  PHASE_E_DIR=''
  trap - EXIT
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
  started_at="$(now_iso)"

  "$TSX" "$PRODUCER" phase-f-run tower "$tower_device" "$vm_device" "$run_id" \
    >"$phase_dir/tower-lifecycle.json"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-f-run vm '$vm_device' '$tower_device' '$run_id'" \
    >"$phase_dir/vm-lifecycle.json"
  finished_at="$(now_iso)"

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
phase_g_owner_authority_chaos() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase G local producer is unavailable'

  # The already-preflighted tower and VM keys bind this adapter to the outer
  # two-host manifest. The owning hive, publishers, and restart identity
  # are deliberately fresh EPHEMERAL keypairs: none may be relabelled as a
  # physical host. Both real hosts attest the complete manifest afterward.
  local phase_dir="$run_dir/phase-g"
  local run_id="$physical_run_id"
  local started_at finished_at
  mkdir -m 700 "$phase_dir"
  started_at="$(now_iso)"
  "$TSX" "$PRODUCER" phase-g-run "$tower_device" "$vm_device" "$run_id" \
    >"$phase_dir/result.json"
  finished_at="$(now_iso)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey] = process.argv.slice(2);
const result = JSON.parse(fs.readFileSync(`${dir}/result.json`, 'utf8'));
const input = {
  schemaVersion: 'hive-git-physical-phase-g-input/v2',
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

# Phase H (P-521 F3, D-081): the pot's serving identity survives an owner that
# goes silent, restarts, and has its store replaced. The VM operator is the one
# process that owns the serving identity. A SEPARATE VM process
# (phase-h-attempt, never the owner) must publish through the capability the
# owner advertises, refuse a stale capability retryably, and pick up the fresh
# runtime after a restart and the fresh store generation after a replacement.
# Each step observes the VM, attempts one publish with the most recent READY
# capability the VM advertised, lets the tower receive on its own git-sync, and
# observes what the tower serves; phase-h-verify judges the whole record.
VM_OWNER_PORT=3070
VM_HOME="/Users/${VM%@*}"
# The rig launcher stops the owner it runs, relaunches it and waits for health.
# An installed-artifact run boots the app's own sidecar instead and names that
# launcher in HIVE_GIT_PHYSICAL_VM_OWNER_LAUNCHER. That one only spawns, so the
# restart stops the old owner first.
VM_OWNER_LAUNCHER="${HIVE_GIT_PHYSICAL_VM_OWNER_LAUNCHER:-$VM_HOME/.papercusp/vm-rig/boot-headless-current.sh}"
VM_OWNER_LAUNCHER_SPAWNS_ONLY=0
[ -z "${HIVE_GIT_PHYSICAL_VM_OWNER_LAUNCHER:-}" ] || VM_OWNER_LAUNCHER_SPAWNS_ONLY=1
# The publisher signs as the VM device. Over ssh the macOS login keychain
# refuses (security exits 36), so the key comes from the encrypted-file tier
# that both owner launchers point the owner at.
VM_OWNER_IDENTITY_DIR="$VM_HOME/.papercusp-workspaces/.shared/.papercusp/identity"
# The advertisement lease is 30s and phase-h-verify requires >= 35s of silence.
PHASE_H_FREEZE_SEC=45
PHASE_H_OWNER_PID=''
PHASE_H_FROZEN=0

# Prints the VM owner as {pid, build, launcher}: the process listening on the
# owner port, the build it reports (its health sha, or version:<v> for a release
# build whose health carries no sha), and its exact command line. A restart on
# the same artifact keeps the build and the command and changes only the pid.
phase_h_owner_identity() {
  ssh "${SSH_OPTS[@]}" "$VM" \
    "pid=\$(lsof -nP -iTCP:$VM_OWNER_PORT -sTCP:LISTEN -t | head -1); [ -n \"\$pid\" ] || exit 3; echo \"\$pid\"; ps -o command= -p \"\$pid\"; curl -s -m 10 http://127.0.0.1:$VM_OWNER_PORT/api/health" \
    | node -e '
const lines = require("node:fs").readFileSync(0, "utf8").split("\n");
const pid = Number(lines[0]);
const launcher = (lines[1] ?? "").trim();
let health = null;
try { health = JSON.parse(lines.slice(2).join("\n")); } catch {}
const build = typeof health?.sha === "string" && health.sha ? health.sha
  : typeof health?.version === "string" && health.version ? `version:${health.version}` : "";
if (!Number.isInteger(pid) || pid <= 1 || !launcher || !build) process.exit(1);
process.stdout.write(`${JSON.stringify({ pid, build, launcher })}\n`);
'
}
phase_h_thaw_owner() {
  [ "$PHASE_H_FROZEN" = 1 ] || return 0
  ssh "${SSH_OPTS[@]}" "$VM" "kill -CONT $PHASE_H_OWNER_PID" || return 1
  PHASE_H_FROZEN=0
}
# A frozen owner must never outlive the scenario. EXIT, not RETURN: set -e
# ends the shell mid-function and a RETURN trap would never run.
phase_h_restore_on_exit() {
  phase_h_thaw_owner \
    || echo "hive-git-physical-scenario: WARNING phase H could not resume the frozen VM owner; run: ssh $VM kill -CONT $PHASE_H_OWNER_PID" >&2
}
phase_h_observe_vm() {
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-h-observe vm '$1' '$VM_REPO' '$vm_device'" >"$2"
}
# Restarts the VM owner through its launcher, then waits up to 300s for the
# owner port to answer health. A spawn-only launcher needs the old owner gone
# first: TERM it and wait up to 90s for it and its children to exit, so the new owner
# never starts against a database the old one is still shutting down.
phase_h_restart_owner() {
  if [ "$VM_OWNER_LAUNCHER_SPAWNS_ONLY" = 1 ]; then
    ssh "${SSH_OPTS[@]}" "$VM" \
      "pid=\$(lsof -nP -iTCP:$VM_OWNER_PORT -sTCP:LISTEN -t | head -1); [ -n \"\$pid\" ] || exit 3; kids=\$(pgrep -P \"\$pid\" | tr '\n' ' '); kill -TERM \"\$pid\"; for i in \$(seq 90); do alive=0; for q in \$pid \$kids; do kill -0 \"\$q\" 2>/dev/null && alive=1; done; [ \$alive = 0 ] && exit 0; sleep 1; done; exit 4" \
      || return 1
  fi
  ssh "${SSH_OPTS[@]}" "$VM" "bash '$VM_OWNER_LAUNCHER'" || return 1
  ssh "${SSH_OPTS[@]}" "$VM" \
    "for i in \$(seq 300); do curl -sf -m 5 http://127.0.0.1:$VM_OWNER_PORT/api/health >/dev/null && exit 0; sleep 1; done; exit 5"
}
phase_h_observe_tower() {
  "$TSX" "$PRODUCER" phase-h-observe tower "$1" "$TOWER_REPO" "$vm_device" >"$2"
}
# The captured observation travels to the VM on stdin, so no scp and no
# fixed remote path; the VM-side temp file is removed however the attempt ends.
phase_h_attempt() {
  local step="$1" captured="$2" output="$3"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "set -e; f=\$(mktemp /tmp/hive-git-physical-phase-h.XXXXXX); trap 'rm -f \"\$f\"' EXIT; cat >\"\$f\"; PAPERCUSP_IDENTITY_DIR='$VM_OWNER_IDENTITY_DIR' '$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-h-attempt '$step' '$VM_REPO' '$vm_device' '$physical_run_id' \"\$f\"" \
    <"$captured" >"$output" \
    || fail "phase H $step publish attempt failed on the VM"
}
# Re-observes the VM until the owner advertises a ready capability. With a
# previous observation it also requires a change: a fresh runtime after the
# restart, a fresh store generation after the replacement.
phase_h_await_vm_ready() {
  local step="$1" output="$2" previous="$3" deadline=$((SECONDS + 600)) i=0
  while :; do
    i=$((i + 1))
    phase_h_observe_vm "$step" "$output" || fail "phase H VM observation failed at step $step"
    node - "$output" "$previous" "$step" <<'NODE' && return 0
const fs = require('node:fs');
const [path, previousPath, step] = process.argv.slice(2);
const capability = (p) => JSON.parse(fs.readFileSync(p, 'utf8')).serving?.capability ?? null;
const now = capability(path);
if (!now) process.exit(1);
if (!previousPath) process.exit(0);
const before = capability(previousPath);
const changed = step === 'replaced'
  ? now.context?.store_generation !== before?.context?.store_generation
  : now.runtimeId !== before?.runtimeId;
process.exit(changed ? 0 : 1);
NODE
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase H VM owner advertised no fresh ready capability for step $step within 600s"
    # Replacement needs the VM's own git-sync bootstrap to recreate the store.
    [ "$step" != replaced ] || run_vm_git_sync >"$(dirname "$output")/replace-bootstrap-nudge-$i.json" 2>&1 || true
    sleep 5
  done
}
# Drives tower git-sync until the tower serves the attempt's post-publish
# sigrefs, leaving the matching observation as the step's tower record.
phase_h_tower_receive() {
  local step="$1" attempt="$2" dir="$3" deadline=$((SECONDS + 600)) i=0
  while :; do
    i=$((i + 1))
    run_tower_git_sync >"$dir/tower-receive-$step-$i.json" 2>&1 || true
    phase_h_observe_tower "$step" "$dir/tower-$step.json" \
      || fail "phase H tower observation failed at step $step"
    node - "$attempt" "$dir/tower-$step.json" "$vm_device" <<'NODE' && return 0
const fs = require('node:fs');
const [attemptPath, towerPath, vmDevice] = process.argv.slice(2);
const want = JSON.parse(fs.readFileSync(attemptPath, 'utf8')).sigrefsAfter?.sigrefsOid;
const tower = JSON.parse(fs.readFileSync(towerPath, 'utf8'));
const have = tower.namespaces?.find((n) => n.deviceKey === vmDevice);
process.exit(want && have?.sigrefsOid === want && have.signatureValid ? 0 : 1);
NODE
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase H tower did not serve the VM's $step sigrefs within 600s"
    sleep 10
  done
}
phase_h_serving_identity() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase H local producer is unavailable'

  local phase_dir="$run_dir/phase-h"
  local run_id="$physical_run_id"
  local started_at finished_at frozen_at thawed_at
  mkdir -m 700 "$phase_dir"
  started_at="$(now_iso)"
  phase_h_owner_identity >"$phase_dir/owner-before.json" \
    || fail 'phase H could not identify the VM serving owner'
  PHASE_H_OWNER_PID="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid' "$phase_dir/owner-before.json")"
  trap phase_h_restore_on_exit EXIT

  # pre: the live owner's own capability signs, and the publish reaches the tower.
  phase_h_await_vm_ready pre "$phase_dir/vm-pre.json" ''
  phase_h_attempt pre "$phase_dir/vm-pre.json" "$phase_dir/attempt-pre.json"
  phase_h_tower_receive pre "$phase_dir/attempt-pre.json" "$phase_dir"

  # omitted: the frozen owner's advertisement goes stale; the publisher must
  # refuse retryably and nothing may move on either host. The tower is only
  # observed: a git-sync tick against a frozen peer proves nothing here.
  ssh "${SSH_OPTS[@]}" "$VM" "kill -STOP $PHASE_H_OWNER_PID" \
    || fail "phase H could not freeze VM owner pid $PHASE_H_OWNER_PID"
  PHASE_H_FROZEN=1
  frozen_at="$(date +%s%3N)"
  sleep "$PHASE_H_FREEZE_SEC"
  # single-read: the owner is SIGSTOPped; this records the frozen state after the fixed hold — nothing may move, so nothing converges
  phase_h_observe_vm omitted "$phase_dir/vm-omitted.json" \
    || fail 'phase H VM observation failed at step omitted'
  phase_h_attempt omitted "$phase_dir/vm-pre.json" "$phase_dir/attempt-omitted.json"
  # single-read: negative control — the refused attempt must leave the tower unchanged, so one read after it is the evidence
  phase_h_observe_tower omitted "$phase_dir/tower-omitted.json" \
    || fail 'phase H tower observation failed at step omitted'
  thawed_at="$(date +%s%3N)"
  phase_h_thaw_owner || fail "phase H could not resume VM owner pid $PHASE_H_OWNER_PID"

  # restarted: the owner's own launcher restarts it on the same payload;
  # the pre-restart capability must refuse and the fresh runtime must publish.
  phase_h_restart_owner >"$phase_dir/owner-restart.log" 2>&1 \
    || fail "phase H owner restart through $VM_OWNER_LAUNCHER failed; see $phase_dir/owner-restart.log"
  phase_h_owner_identity >"$phase_dir/owner-after.json" \
    || fail 'phase H could not identify the restarted VM serving owner'
  phase_h_await_vm_ready restarted "$phase_dir/vm-restarted.json" "$phase_dir/vm-pre.json"
  phase_h_attempt restarted "$phase_dir/vm-pre.json" "$phase_dir/attempt-restarted.json"
  phase_h_tower_receive restarted "$phase_dir/attempt-restarted.json" "$phase_dir"

  # replaced: quarantine the VM store so the production bootstrap recreates it
  # under a new store generation; the restarted capability must refuse.
  ssh "${SSH_OPTS[@]}" "$VM" \
    "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-a-quarantine '$VM_REPO' '$run_id'" \
    >"$phase_dir/replace-quarantine.json" \
    || fail 'phase H could not quarantine the VM store'
  run_vm_git_sync >"$phase_dir/replace-bootstrap.json"
  require_git_sync_fired "$phase_dir/replace-bootstrap.json" 'phase H vm replace-bootstrap'
  phase_h_await_vm_ready replaced "$phase_dir/vm-replaced.json" "$phase_dir/vm-restarted.json"
  phase_h_attempt replaced "$phase_dir/vm-restarted.json" "$phase_dir/attempt-replaced.json"
  phase_h_tower_receive replaced "$phase_dir/attempt-replaced.json" "$phase_dir"
  trap - EXIT
  finished_at="$(now_iso)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" \
    "$((thawed_at - frozen_at))" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey, frozenMs] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const input = {
  schemaVersion: 'hive-git-physical-phase-h-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  vmOwner: { before: read('owner-before'), after: read('owner-after'), frozenMs: Number(frozenMs) },
  steps: Object.fromEntries(['pre', 'omitted', 'restarted', 'replaced'].map((step) => [step, {
    vm: read(`vm-${step}`),
    attempt: read(`attempt-${step}`),
    tower: read(`tower-${step}`),
  }])),
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-h-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}

# Phase I (P-521 F6, D-022/D-082): protected-effect fencing beyond canonical staging.
# The single owning hive key is minted once by a drill owner process on the VM
# (phase-i-owner) and never leaves it: the tower gets only its public key and one
# captured owner signature. Both hosts' advisory elections name themselves at one
# roster epoch; only the owner may authorize canonical staging, release promotion,
# the GitHub push, the submodule-origin push and fork/PR publication. Every effect
# runs through its production sink against disposable stand-in targets in the host's
# own private phase directory, never a shared remote. The VM attempt SIGKILLs the
# owner between pushes (lost); it stays down (outage); the scenario relaunches it
# with the same key file (restored). phase-i-verify judges the whole record.
PHASE_I_VM_DIR=''
phase_i_producer_vm() {
  local quoted="" a
  for a in "$@"; do quoted="$quoted '$a'"; done
  ssh "${SSH_OPTS[@]}" "$VM" "PAPERCUSP_IDENTITY_DIR='$VM_OWNER_IDENTITY_DIR' '$VM_NODE' '$VM_TSX' '$VM_PRODUCER'$quoted"
}
# Starts the owner detached on the VM and prints its start record once it serves.
phase_i_start_owner() {
  local log="$PHASE_I_VM_DIR/owner-$1.log"
  ssh "${SSH_OPTS[@]}" "$VM" \
    "nohup '$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-i-owner '$PHASE_I_VM_DIR' '$physical_run_id' >'$log' 2>&1 </dev/null & for i in \$(seq 120); do r=\$(grep -m1 'hive-git-physical-phase-i-owner/v1' '$log' 2>/dev/null) && { printf '%s\n' \"\$r\"; exit 0; }; sleep 0.5; done; cat '$log' >&2; exit 5"
}
# Kills whichever owner the VM phase directory last recorded (only if that pid is
# still a phase-i-owner process), then removes the directory with its hive key.
# The owner must never outlive the scenario (same EXIT rule as phase H).
phase_i_remove_vm_state() {
  [ -n "$PHASE_I_VM_DIR" ] || return 0
  ssh "${SSH_OPTS[@]}" "$VM" \
    "p=\$(sed -n 's/.*\"pid\":\\([0-9][0-9]*\\).*/\\1/p' '$PHASE_I_VM_DIR/owner/owner.json' 2>/dev/null); if [ -n \"\$p\" ] && ps -o command= -p \"\$p\" | grep -q phase-i-owner; then kill -9 \"\$p\"; fi; rm -rf '$PHASE_I_VM_DIR'" \
    || return 1
  PHASE_I_VM_DIR=''
}
phase_i_restore_on_exit() {
  local dir="$PHASE_I_VM_DIR"
  phase_i_remove_vm_state \
    || echo "hive-git-physical-scenario: WARNING phase I could not stop the VM drill owner; inspect $VM:$dir/owner/owner.json and remove $dir" >&2
}
phase_i_protected_effects() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase I local producer is unavailable'

  local phase_dir="$run_dir/phase-i"
  local run_id="$physical_run_id"
  local started_at finished_at tower_keychain vm_keychain hive_id first_pid gone
  mkdir -m 700 "$phase_dir" "$phase_dir/tower-work"
  tower_keychain="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).keychainId ?? ""' "$tower_identity")"
  vm_keychain="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).keychainId ?? ""' "$vm_identity")"
  [ -n "$tower_keychain" ] && [ -n "$vm_keychain" ] \
    || fail 'phase I host identities name no device keychain'
  started_at="$(now_iso)"

  PHASE_I_VM_DIR="$(ssh "${SSH_OPTS[@]}" "$VM" 'mktemp -d /tmp/hive-git-physical-phase-i.XXXXXX')" \
    && [ -n "$PHASE_I_VM_DIR" ] || fail 'phase I could not create the VM phase directory'
  trap phase_i_restore_on_exit EXIT
  phase_i_start_owner first >"$phase_dir/owner-first.json" \
    || fail 'phase I could not start the VM drill owner'
  hive_id="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).hiveId' "$phase_dir/owner-first.json")"
  first_pid="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).pid' "$phase_dir/owner-first.json")"

  local vm_args=("$PHASE_I_VM_DIR" "$run_id" "$vm_device" "$vm_keychain" "$hive_id")
  local tower_args=("$phase_dir/tower-work" "$run_id" "$tower_device" "$tower_keychain" "$hive_id")
  phase_i_producer_vm phase-i-attempt vm live "${vm_args[@]}" >"$phase_dir/vm-live.json" \
    || fail 'phase I VM live attempt failed'
  "$TSX" "$PRODUCER" phase-i-attempt tower live "${tower_args[@]}" "$phase_dir/vm-live.json" \
    >"$phase_dir/tower-live.json" || fail 'phase I tower live attempt failed'
  phase_i_producer_vm phase-i-attempt vm lost "${vm_args[@]}" >"$phase_dir/vm-lost.json" \
    || fail 'phase I VM lost-authority attempt failed'
  # Independent of the attempt's own check: the first owner pid is gone.
  gone=false
  ssh "${SSH_OPTS[@]}" "$VM" "! kill -0 '$first_pid' 2>/dev/null" && gone=true
  phase_i_producer_vm phase-i-attempt vm outage "${vm_args[@]}" >"$phase_dir/vm-outage.json" \
    || fail 'phase I VM outage attempt failed'
  "$TSX" "$PRODUCER" phase-i-attempt tower outage "${tower_args[@]}" "$phase_dir/vm-live.json" "$phase_dir/vm-outage.json" \
    >"$phase_dir/tower-outage.json" || fail 'phase I tower outage attempt failed'
  phase_i_start_owner restored >"$phase_dir/owner-restored.json" \
    || fail 'phase I could not relaunch the VM drill owner'
  phase_i_producer_vm phase-i-attempt vm restored "${vm_args[@]}" >"$phase_dir/vm-restored.json" \
    || fail 'phase I VM restored attempt failed'
  "$TSX" "$PRODUCER" phase-i-attempt tower restored "${tower_args[@]}" "$phase_dir/vm-live.json" \
    >"$phase_dir/tower-restored.json" || fail 'phase I tower restored attempt failed'
  phase_i_remove_vm_state || fail "phase I could not stop the VM drill owner in $PHASE_I_VM_DIR"
  trap - EXIT
  rm -rf "$phase_dir/tower-work"
  finished_at="$(now_iso)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" "$gone" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey, gone] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8'));
const input = {
  schemaVersion: 'hive-git-physical-phase-i-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  owner: { first: read('owner-first'), restored: read('owner-restored'), goneAfterLost: gone === 'true' },
  steps: {
    live: { vm: read('vm-live'), tower: read('tower-live') },
    lost: { vm: read('vm-lost') },
    outage: { vm: read('vm-outage'), tower: read('tower-outage') },
    restored: { vm: read('vm-restored'), tower: read('tower-restored') },
  },
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-i-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
}

# Phase J (P-521 F4, D-082): bounded target-apply outage, preserved cursor, replay.
# The VM is the target and the only mutated host: a scoped fault on its Postgres
# (phase-j-fault) makes the production read-merge apply of the tower's write A
# fail retryably. The tower only authors writes A and B through its production
# MCP verb; its bg-host is never frozen, restarted or faulted. The VM cursor must
# hold at A past the retired retry budget and across a VM owner restart; after
# the fault is removed, A and B must arrive with the tower's exact content.
PHASE_J_FAULT_RUN=''
PHASE_J_WAIT_SEC=900
PHASE_J_LAST=''
phase_j_producer_vm() {
  local quoted="" a
  for a in "$@"; do quoted="$quoted '$a'"; done
  ssh "${SSH_OPTS[@]}" "$VM" "'$VM_NODE' '$VM_TSX' '$VM_PRODUCER'$quoted"
}
phase_j_remove_fault() {
  [ -n "$PHASE_J_FAULT_RUN" ] || return 0
  phase_j_producer_vm phase-j-fault vm remove "$PHASE_J_FAULT_RUN" >"$1" || return 1
  PHASE_J_FAULT_RUN=''
}
# Neither the fault nor the fixture writes may outlive the scenario (same EXIT
# rule as phase H). The fault goes first: a drop must not queue behind it.
phase_j_restore_on_exit() {
  phase_j_remove_fault "$run_dir/phase-j/exit-fault-remove.json" 2>"$run_dir/phase-j/exit-fault-remove.err" \
    || echo "hive-git-physical-scenario: WARNING phase J could not remove the VM outage fault; run: ssh $VM '$VM_NODE' '$VM_TSX' '$VM_PRODUCER' phase-j-fault vm sweep" >&2
  drill_fixtures_drop "$run_dir/phase-j/exit-fixtures-drop.json" 2>"$run_dir/phase-j/exit-fixtures-drop.err" \
    || echo "hive-git-physical-scenario: WARNING phase J could not drop its fixture work-items ${DRILL_FIXTURES[*]} in $PHASE_A_POT_HOME; drop them with work_items:set_state (see $run_dir/phase-j/exit-fixtures-drop.json)" >&2
}
# Samples the VM until the step's lag contract is met (producer exit 0). Exit 3
# is a valid observation that has not reached the step yet; anything else fails.
# Every sample is kept: the verifier judges each held one.
phase_j_await_vm() {
  local step="$1" prefix="$2" deadline=$((SECONDS + PHASE_J_WAIT_SEC)) i=0 rc
  shift 2
  while :; do
    i=$((i + 1))
    rc=0
    phase_j_producer_vm phase-j-observe vm "$step" "$physical_run_id" "$@" >"$prefix-$i.json" || rc=$?
    if [ "$rc" = 0 ]; then PHASE_J_LAST="$prefix-$i.json"; return 0; fi
    [ "$rc" = 3 ] || fail "phase J VM observation failed at step $step (exit $rc); see $prefix-$i.json"
    [ "$SECONDS" -lt "$deadline" ] \
      || fail "phase J VM did not reach $step within ${PHASE_J_WAIT_SEC}s; last sample $prefix-$i.json"
    sleep 10
  done
}
phase_j_apply_outage_replay() {
  [ -x "$TSX" ] && [ -f "$PRODUCER" ] \
    || fail 'phase J local producer is unavailable'

  local phase_dir="$run_dir/phase-j"
  local run_id="$physical_run_id"
  local started_at finished_at feature_a log_key held_pos w
  mkdir -m 700 "$phase_dir"
  started_at="$(now_iso)"
  # single-read: baseline taken before the outage fault and the tower writes
  "$TSX" "$PRODUCER" phase-j-observe tower baseline "$run_id" >"$phase_dir/tower-baseline.json" \
    || fail 'phase J tower baseline observation failed'
  phase_j_producer_vm phase-j-observe vm baseline "$run_id" >"$phase_dir/vm-baseline.json" \
    || fail 'phase J VM baseline observation failed'
  phase_h_owner_identity >"$phase_dir/owner-before.json" \
    || fail 'phase J could not identify the VM owner'

  # Outage on: armed before the tower writes, so A can never land before it.
  PHASE_J_FAULT_RUN="$run_id"
  trap phase_j_restore_on_exit EXIT
  phase_j_producer_vm phase-j-fault vm install "$run_id" >"$phase_dir/fault-install.json" \
    || fail "phase J could not install the VM outage fault; see $phase_dir/fault-install.json"
  for w in A B; do
    "$TSX" "$PRODUCER" phase-j-write "$w" "$run_id" \
      | "$TOWER_CALL" work_items:create --json - --workspace=papercusp-workspace --harness="$PHASE_A_POT_HOME" \
        >"$phase_dir/tower-create-$w.json" \
      || fail "phase J tower could not author write $w; see $phase_dir/tower-create-$w.json"
    # A refused create must fail here, not after the whole replay bound (WI-10003961 attempt 2
    # waited 900s for a write B that never existed). Current ptool exits 5 on ok:false, but the
    # tower may run an older one that exits 0 — so judge the saved result too.
    ptool_result_ok "$phase_dir/tower-create-$w.json" \
      || fail "phase J tower refused write $w; see $phase_dir/tower-create-$w.json"
    drill_fixture_register "$phase_dir/tower-create-$w.json" \
      || fail "phase J tower create for write $w returned no work-item id; see $phase_dir/tower-create-$w.json"
  done
  # single-read: the tower's own rows, committed synchronously by the creates above (ptool_result_ok) — 'authored' has no lag predicate
  "$TSX" "$PRODUCER" phase-j-observe tower authored "$run_id" >"$phase_dir/tower-authored.json" \
    || fail 'phase J tower authored observation failed'
  feature_a="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).writes?.A?.row?.featureId ?? ""' "$phase_dir/tower-authored.json")"
  [ -n "$feature_a" ] || fail 'phase J tower has no row for write A'
  feature_b="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).writes?.B?.row?.featureId ?? ""' "$phase_dir/tower-authored.json")"
  [ -n "$feature_b" ] || fail 'phase J tower has no row for write B'

  # held: the durable failure names A, past the retired budget and the minimum hold.
  phase_j_await_vm held "$phase_dir/vm-held" "$feature_a"
  read -r log_key held_pos < <(node -e '
const o = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const c = (o.cursors ?? []).find((x) => x.applyFailure?.groupKey?.endsWith(`/${process.argv[2]}`));
if (!c) process.exit(1);
process.stdout.write(`${c.logKeyHex} ${c.applyFailure.position}\n`);
' "$PHASE_J_LAST" "$feature_a") || fail "phase J held sample names no failing log; see $PHASE_J_LAST"

  # held-after-restart: same artifact, new owner process, fault still in.
  phase_h_restart_owner >"$phase_dir/owner-restart.log" 2>&1 \
    || fail "phase J owner restart through $VM_OWNER_LAUNCHER failed; see $phase_dir/owner-restart.log"
  phase_h_owner_identity >"$phase_dir/owner-after.json" \
    || fail 'phase J could not identify the restarted VM owner'
  phase_j_await_vm held-after-restart "$phase_dir/vm-held-after-restart" "$feature_a"
  cp "$PHASE_J_LAST" "$phase_dir/vm-held-after-restart.json"

  # Outage off, then replay.
  phase_j_remove_fault "$phase_dir/fault-remove.json" \
    || fail "phase J could not remove the VM outage fault; see $phase_dir/fault-remove.json"
  # The EXIT trap stays armed until the fixtures are dropped below.
  phase_j_await_vm replayed "$phase_dir/vm-replayed" "$feature_a" "$log_key" "$held_pos"
  cp "$PHASE_J_LAST" "$phase_dir/vm-replayed.json"
  finished_at="$(now_iso)"

  node - "$phase_dir" "$run_id" "$started_at" "$finished_at" "$tower_device" "$vm_device" "$feature_a" <<'NODE'
const fs = require('node:fs');
const [dir, runId, startedAt, finishedAt, towerDeviceKey, vmDeviceKey, featureA] = process.argv.slice(2);
const read = (name) => JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8'));
const n = (name) => Number(/-(\d+)\.json$/.exec(name)[1]);
// Held samples from the first one whose durable failure names A; earlier ones
// only show the op had not reached the VM yet and are kept on disk.
const names = (o) => (o.cursors ?? []).some((c) => c.applyFailure?.groupKey?.endsWith(`/${featureA}`));
const held = fs.readdirSync(dir).filter((f) => /^vm-held-\d+\.json$/.test(f)).sort((a, b) => n(a) - n(b)).map(read);
const input = {
  schemaVersion: 'hive-git-physical-phase-j-input/v1',
  runId,
  window: { startedAt, finishedAt },
  identities: { towerDeviceKey, vmDeviceKey },
  baseline: { tower: read('tower-baseline.json'), vm: read('vm-baseline.json') },
  fault: { install: read('fault-install.json'), remove: read('fault-remove.json') },
  authored: read('tower-authored.json'),
  held: held.slice(held.findIndex(names)),
  vmOwner: { before: read('owner-before.json'), after: read('owner-after.json') },
  heldAfterRestart: read('vm-held-after-restart.json'),
  replayed: read('vm-replayed.json'),
};
fs.writeFileSync(`${dir}/verify-input.json`, `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
  "$TSX" "$PRODUCER" phase-j-verify "$phase_dir/verify-input.json" \
    >"$phase_dir/verdict.json"
  drill_fixtures_drop "$phase_dir/fixtures-drop.json" \
    || fail "phase J could not drop its fixture work-items ${DRILL_FIXTURES[*]}; see $phase_dir/fixtures-drop.json"
  trap - EXIT
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
const inputs = Object.fromEntries([...'ABCDEFGHIJ'].map((phase) => [phase, phaseInput(phase)]));
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
  schemaVersion: 'hive-git-physical-evidence/v3',
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
  legVerdicts: [...'ABCDEFGHIJ'].map((leg) => ({
    leg,
    status: 'pass',
    scope: 'physical',
    observedAt: observedAt(leg),
  })),
  legD: inputs.D,
  legE: inputs.E,
  legF: inputs.F,
  legG: inputs.G,
  legH: inputs.H,
  legI: inputs.I,
  legJ: inputs.J,
};
fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
NODE
}

# Each phase announces itself on stderr before it runs. The drill reads the LAST
# marker to name the phase a failed run died in (bin/lib/physical-failure-summary.sh,
# plan physical-drill-iteration-speed-2026-09-29 P-001). Informational only:
# nothing parses it as evidence, and it never touches stdout.
#
# A phase-selective run (HIVE_GIT_PHYSICAL_PHASES, plan P-002) announces a phase it will
# not run as PHASE_SKIP and returns 1, so its executor never starts; the failure summary
# reads only PHASE_START, so a skip can never be named as the phase a run died in.
phase_start() {
  case ",${SCENARIO_PHASES:-$PHYSICAL_PHASES_ALL}," in
    *",$1,"*)
      echo "hive-git-physical-scenario: PHASE_START $1 $2 $(now_iso)" >&2
      return 0
      ;;
  esac
  echo "hive-git-physical-scenario: PHASE_SKIP $1 $2 (not selected)" >&2
  return 1
}

run_all_phases() {
  phase_start A phase_a_storage_join             && phase_a_storage_join
  phase_start B phase_b_ref_announce             && phase_b_ref_announce
  phase_start C phase_c_trust_negative_controls  && phase_c_trust_negative_controls
  phase_start D phase_d_worktree_materialization && phase_d_worktree_materialization
  phase_start E phase_e_github_bridge            && phase_e_github_bridge
  phase_start F phase_f_lifecycle_safety         && phase_f_lifecycle_safety
  phase_start G phase_g_owner_authority_chaos    && phase_g_owner_authority_chaos
  phase_start H phase_h_serving_identity         && phase_h_serving_identity
  phase_start I phase_i_protected_effects        && phase_i_protected_effects
  phase_start J phase_j_apply_outage_replay      && phase_j_apply_outage_replay
  return 0
}

verify_physical_vm_source() {
  case "$VM_SOURCE" in
    /tmp/hive-git-physical-source.[0-9]*) ;;
    *) fail 'physical VM source must be the canonical probe staging directory' ;;
  esac

  local local_sha remote_sha
  local_sha="$(sha256sum "$PRODUCER" | awk '{print $1}')"
  remote_sha="$(ssh "${SSH_OPTS[@]}" "$VM" \
    "[ -x '$VM_TSX' ] && [ -f '$VM_PRODUCER' ] && shasum -a 256 '$VM_PRODUCER' | awk '{print \$1}'")" \
    || fail 'physical VM source is incomplete or unreadable'
  [ "$remote_sha" = "$local_sha" ] \
    || fail 'physical VM producer digest does not match the tower'
}

# Every phase reaches the VM operator through $VM_CALL, which runs $VM_MCP_CALL.
# Both live in the VM's /tmp, which loses them (reboot, macOS tmp cleanup) while
# deploy.sh's persistent copy survives. A missing driver surfaced as "phase A VM
# substrate readiness probe could not reach the VM operator" — a misdiagnosis of
# a healthy operator (2026-09-27, WI-2039874: VM up 18h, /tmp/vmcall.sh gone,
# /tmp/mcp-call.mjs stale). Pin both helpers to the checked-in bytes and restore
# them through the canonical deploy seam before any phase runs.
vm_driver_digests() {
  ssh "${SSH_OPTS[@]}" "$VM" \
    "[ -x '$VM_CALL' ] && [ -f '$VM_MCP_CALL' ] && shasum -a 256 '$VM_CALL' '$VM_MCP_CALL' | awk '{print \$1}' | paste -s -d ' ' -" \
    2>/dev/null || true
}

ensure_vm_driver_current() {
  local want have
  want="$(sha256sum "$HERE/vmcall.sh" | awk '{print $1}') $(sha256sum "$REPO_ROOT/scripts/mcp-call.mjs" | awk '{print $1}')"
  have="$(vm_driver_digests)"
  [ "$have" = "$want" ] && return 0
  printf 'hive-git-physical-scenario: VM driver missing or stale (have=%s want=%s); restoring through %s\n' \
    "${have:-none}" "$want" "$DEPLOY" >&2
  "$DEPLOY" "$VM" >&2 || true
  have="$(vm_driver_digests)"
  [ "$have" = "$want" ] \
    || fail "VM driver still missing or stale after $DEPLOY (have=${have:-none} want=$want): $VM_CALL and $VM_MCP_CALL must match the checked-in bytes"
}

# OFFLINE CONTRACT BOUNDARY. This must remain before the first phase call and
# before any future ssh/mutation primitive until all eight fixed executors and
# their focused falsifiability tests are checked in.
[ "$IMPLEMENTATION_STATE" = 'ready-v1' ] \
  || fail "scenario is not execution-ready ($IMPLEMENTATION_STATE); A-J phase executors have not all landed"
[ "${HIVE_GIT_PHYSICAL_EXECUTE:-}" = "$EXPECTED_PLAN" ] \
  || fail 'destructive physical run requires HIVE_GIT_PHYSICAL_EXECUTE to equal the canonical plan slug'

# physical-drill-iteration-speed-2026-09-29 P-005 (D-003): HIVE_GIT_RIG=same-box retargets
# every host value defined above (tower, VM, pot, owner launcher) at the same-box
# two-instance rig, after all of them exist and before the first host access. The default
# profile changes nothing. A same-box run is diagnostic: it never emits unsigned evidence.
# (The profile library was sourced next to physical-phase-select.sh above.)
rig_profile_apply || fail "rig profile '$(rig_profile_name)' could not be applied"
# The phase record writers (embedded node) read the applied git-sync slugs from the
# environment, so a record can never name a slug the rig does not use.
export TOWER_GIT_SYNC_SLUG VM_GIT_SYNC_SLUG
if rig_profile_is_diagnostic; then SCENARIO_FULL_RUN=0; fi

# The staged VM source root is EPHEMERAL by design: hive-git-physical-probe.sh
# creates /tmp/hive-git-physical-source.$$ on the VM, exports it here as
# HIVE_GIT_PHYSICAL_VM_SOURCE for exactly one invocation, and removes it again
# from its EXIT/HUP/INT/TERM trap. Nothing persists that path, so there is no
# staged root for a post-interruption caller to inherit or rediscover.
#
# Refuse with the cause NAMED rather than pasting an unusable value into
# VM_PRODUCER. Left unchecked, an unset value yields the absolute nonsense path
# /packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts, which the
# VM reports as ERR_MODULE_NOT_FOUND — an error that reads as a broken VM
# dev-source tree and sends the reader hunting there, when the real cause is a
# missing input. Measured 2026-09-05 (EI-20407955869521811): the VM's dev-source
# tree and its tsx loader are both present, so that reading was always a
# misdiagnosis. The shape check pins the same staging contract the probe's own
# cleanup guard enforces (/tmp/hive-git-physical-source.[0-9]*), which is the
# only path this driver's producer is ever staged at.
[ -n "$VM_SOURCE" ] \
  || fail 'HIVE_GIT_PHYSICAL_VM_SOURCE is unset. The staged VM source root is ephemeral (hive-git-physical-probe.sh removes it on exit) and is never persisted, so this driver cannot be resumed directly after an interruption. Re-drive through hive-git-physical-probe.sh, which is the only producer of that tree and exports this variable; its --source-preflight mode stages and verifies without mutating the rig.'
require_absolute 'HIVE_GIT_PHYSICAL_VM_SOURCE' "$VM_SOURCE"
case "$VM_SOURCE" in
  /tmp/hive-git-physical-source.[0-9]*) ;;
  *) fail "HIVE_GIT_PHYSICAL_VM_SOURCE=$VM_SOURCE is not a probe-staged source root (expected /tmp/hive-git-physical-source.<pid>). Only hive-git-physical-probe.sh stages the VM producer, and it stages nowhere else; a hand-supplied root — including the installed dev-source tree, which carries no producer — resolves VM_PRODUCER to a path that does not exist and surfaces as ERR_MODULE_NOT_FOUND." ;;
esac
# WI-10004062 — the tower half of the same contract. The probe resolves ONE
# commit, extracts it into a run-private tower snapshot, and stages the same
# commit on the VM. Every "$TSX" "$PRODUCER" call in the phases below must run
# that snapshot, never $REPO_ROOT: the shared working tree changes under a run
# (a peer's mid-run edit aborted WI-10004055 retry #1, and an uncommitted one
# refused retry #2 before any phase).
[ -n "$TOWER_SOURCE" ] \
  || fail 'HIVE_GIT_PHYSICAL_TOWER_SOURCE is unset. The tower producer must run from the probe-staged pinned-commit snapshot, which hive-git-physical-probe.sh creates and exports for exactly one invocation; re-drive through the probe.'
require_absolute 'HIVE_GIT_PHYSICAL_TOWER_SOURCE' "$TOWER_SOURCE"
case "$TOWER_SOURCE" in
  */hive-git-physical-tower-source.*) ;;
  *) fail "HIVE_GIT_PHYSICAL_TOWER_SOURCE=$TOWER_SOURCE is not a probe-staged tower snapshot (expected .../hive-git-physical-tower-source.<id>). Running the tower producer from the shared working tree is exactly what WI-10004062 removed." ;;
esac
PRODUCER="$TOWER_SOURCE/packages/operator-core/lib/sync/pot-git/physical-drill-producer.ts"
[ -f "$PRODUCER" ] \
  || fail "probe-staged tower snapshot carries no physical-drill producer: $PRODUCER"
verify_physical_vm_source
ensure_vm_driver_current

scenario_started_at="$(now_iso)"
run_all_phases
scenario_finished_at="$(now_iso)"
if [ "$SCENARIO_FULL_RUN" != 1 ]; then
  # A partial run reached here only if every selected phase passed. It writes NO
  # unsigned evidence: the manifest needs A-I from one run, and the probe must see
  # the absence to know not to sign anything.
  echo "hive-git-physical-scenario: PARTIAL_RUN phases=$SCENARIO_PHASES passed $scenario_started_at..$scenario_finished_at (diagnostic only; no release evidence)" >&2
  exit 0
fi
assemble_unsigned_evidence "$scenario_started_at" "$scenario_finished_at"
[ -s "$unsigned_out" ] || fail 'all phases returned without emitting the required unsigned evidence manifest'

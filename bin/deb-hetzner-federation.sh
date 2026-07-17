#!/usr/bin/env bash
# deb-hetzner-federation.sh — the PACKAGED-.deb cross-machine federation proof
# (linux-test-vm-and-federation-2026-06-04 Phase 2, the .deb-specific variant of
# D-019). Where vm-federation.sh runs two .deb instances in same-HOST qemu VMs
# (which cannot holepunch — D-017/D-018), this runs the SHIPPED .deb's federating
# SIDECAR (serve.mjs + bundled embedded-pg + swarm) on TWO genuinely-separate
# Hetzner cloud VMs over the PUBLIC DHT — where the substrate Tier-3 already
# proved holepunch + merge complete (D-019). It reuses the SAME assert core the
# one-box smokes + vm-federation.sh use (bin/lib/federation-asserts.sh, D-003);
# only the driver (SSH to a Hetzner public IP) + the launch (headless serve.mjs,
# no Tauri GUI / no Xvfb — the GUI is irrelevant to federation) differ.
#
# REFACTOR (federation-release-hardening Brief 1): the provision/install/join/
# assert MACHINERY now lives in the reusable lib bin/lib/deb-hetzner-rig.sh — this
# script is the 2-FRAME BASE SCENARIO that sources it. The lib generalizes to N
# frames (owner + N members) so the live-matrix briefs (2-7) are small scenario
# scripts (see bin/deb-hetzner-multimember.sh for the 3-frame template) instead of
# copy-pasting this file. This base run is BEHAVIOR-PRESERVING: same 2 frames
# (a=owner papercupai, b=joiner aviynw), same hive flow, same assertions, same
# EXIT-trap auto-destroy + servers=0 guarantee.
#
# Pass criteria (same as vm-federation.sh, now for the .deb's sidecar across the
# real internet): both sidecars boot embedded-pg + operator; share write-free;
# [swarm] peer_connected in both; a feature INSERTed on A lands in B's PG as
# origin='remote' within ~90s AND the reverse; teardown = DESTROY (ends billing).
#
# Cost-safety (belt-and-braces, mirrors bench-frames.ts): every provisioned
# server id is written to the rig servers file BEFORE install (rig_create_server);
# the EXIT trap (rig_install_exit_trap → rig_cleanup) DELETEs every one and
# confirms it is GONE (404). No frame is left billing — for ANY frame count.
#
# Env / creds:
#   HCLOUD_TOKEN            Hetzner API token (default: ~/.papercusp/hcloud-token)
#   HETZNER_SSH_KEY_ID      ssh key id registered in the project (default 114898429 — 'papercusp-frame-deploy' on the 2026-07-09 account)
#   HETZNER_SSH_IDENTITY    matching private key (default ~/.ssh/papercusp-latitude-frame)
#   gh auth: papercupai + aviynw (per-frame GH_TOKEN identity, like vm-federation.sh)
#
# Usage: bin/deb-hetzner-federation.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"   # reusable rig (Brief 1)
set +e   # this driver owns its own exit codes (the asserts report PASS/FAIL)
set +u   # federation-asserts.sh + the dynamic FED_*/FRAME_* assoc arrays are
         # nounset-hostile (e.g. a just-declared local referenced in the same
         # `local`); common.sh left -u on, which tripped provision→setup handoff.

# ── args / config ─────────────────────────────────────────────────────────────
LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
for arg in "$@"; do case "$arg" in
  --locs=*) LOCS="${arg#--locs=}" ;;
  --type=*) STYPE="${arg#--type=}" ;;
  --deb=*)  DEB="${arg#--deb=}" ;;
  --image=*) IMAGE="${arg#--image=}" ;;
  --keep-up) KEEP_UP=1 ;;
  -h|--help) sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) die "unknown arg: $arg" ;;
esac; done
IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
[ -n "$DEB" ] || DEB="$(default_deb)"
P_A_USER="${P_A_USER:-papercupai}"; P_B_USER="${P_B_USER:-aviynw}"

# ── init the reusable rig (creds, work dir, servers file) + ARM auto-destroy ───
RIG_KEEP_UP="$KEEP_UP"
rig_init "$STYPE" "$IMAGE" || exit 1
rig_install_exit_trap        # EXIT-trap auto-destroy live BEFORE the first create
RIG_DEB="$DEB"

# ── 1. artifact gates (reuse the assert core, via the lib) ─────────────────────
rig_gate_artifact "$DEB" || exit 2

# ── 2. identities (a=owner, b=joiner) ─────────────────────────────────────────
rig_set_identity a "$P_A_USER" || exit 1
rig_set_identity b "$P_B_USER" || exit 1

# ── 3. provision both frames (records ids BEFORE install) ──────────────────────
rig_provision "$LOC_A" "$LOC_B" || exit 3

# ── 4. install .deb + launch the headless sidecar on each frame ────────────────
rig_setup_frame a || exit 4
rig_setup_frame b || exit 4

# ── 5. boot + share + discovery + merge (the assert core, over SSH) ───────────
fed_log "wait embedded-PG + operator in both sidecars"
fed_wait_boot a 50 || { echo "A boot failed: $FED_BOOT_ERR"; drv_exec a <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
fed_wait_boot b 50 || { echo "B boot failed: $FED_BOOT_ERR"; drv_exec b <<<"tail -25 /home/pcusp/serve.log"; exit 5; }
echo "✓ isolated by construction (separate cloud machines)"
fed_log "A: PG=${FED_PG[a]} sc=${FED_SC[a]} | B: PG=${FED_PG[b]} sc=${FED_SC[b]}"

fed_wait_api a || echo "⚠ A api not ready"; fed_wait_api b || echo "⚠ B api not ready"

# hive-federation-cross-machine-merge D-002: the REAL merge test is the HIVE flow
# (from-repo publishes A's attestation binding + announces; join-link publishes B's
# binding + admits) run CROSS-MACHINE — the only config with BOTH the binding
# (admission) AND real holepunch. rig_owner_publish_hive does the from-repo on the
# OWNER + resolves the three join-hive inputs (RIG_HIVE_ID/PUBKEY/LINK) from
# whichever response shape (fresh-create vs existing) came back.
REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
rig_owner_publish_hive a "$REPO_URL" || exit 6
A_LINK="$RIG_HIVE_LINK"; HIVE_ID="$RIG_HIVE_ID"; HIVE_PUBKEY="$RIG_HIVE_PUBKEY"
# D-007 diag: does the member link carry the owner binding (hive_pubkey + owner_device_pubkey
# + owner_github_user_id + attestation_gist_id)? If absent, the joiner can't seed
# hive_directory_cache at join → bootstrap-admit can't fire (the receive-side fix is a no-op).
echo "D-007 A_LINK owner-binding params present: $(printf '%s' "$A_LINK" | grep -oE 'hive_pubkey|owner_device_pubkey|owner_github_user_id|attestation_gist_id' | sort -u | tr '\n' ' ')"

# REAL hive-join flow (4250638d root cause): BOTH peers join via POST /api/discovery/join-hive,
# NOT /api/harness/join-link. join-link alone creates ONLY a member harness — it never boots a
# hive VIEW, so on the JOINER the hive VIEW's substrate (which runs the hive_members roster
# projection + the owner-log bootstrap-admit) never materializes → empty roster →
# decideMemberContentOp drops ALL the owner's federated content. join-hive (joinHiveAsView):
#   (1) calls handleJoinLink per member — boot_federate boots the member substrate AND the
#       D-007 owner-binding seed still fires;
#   (2) materializes the repo-less hive VIEW + the OWNER's Hive identity (from hivePubkey); and
#   (3) RE-KEYS each joined member IN PLACE onto the owner's hive-pubkey topic (EI-681) — the
#       only path that lands the joiner on the owner's topic WITH a populated roster.
fed_log "A + B both JOIN THE HIVE via /api/discovery/join-hive (hiveId=$HIVE_ID) — materialize VIEW + rekey members onto the owner topic"
rig_join_hive a; A_MEMBER_SLUG="${FRAME_MEMBER_SLUG[a]}"
rig_join_hive b; B_MEMBER_SLUG="${FRAME_MEMBER_SLUG[b]}"
MEMBER_SLUG="$A_MEMBER_SLUG"

# NO RESTART (EI-521 isolation): join-hive's per-member boot_federate already boots the
# federation substrate (drain + read-merge + swarm) at join time, and joinHiveAsView then
# RE-KEYS it IN PLACE onto the owner's hive-pubkey topic (no reboot — a reboot breaks the
# owner's corestore serving). A restart KILLS that substrate and boot-all does NOT re-boot
# joined members (attempted=0) — that was the run5 failure. So just give the swarm a moment
# to peer-connect + drain.
fed_log "join-hive booted + re-keyed the substrate at join — wait for peer_connect + drain (NO restart)"
sleep 12
echo "--- A [swarm]/drain diag ---"; drv_exec a <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"
echo "--- B [swarm]/drain diag ---"; drv_exec b <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -8"

fed_log "wait swarm peer discovery over the PUBLIC DHT (~210s — sidecar-process swarm boot adds latency; longer window rules out DHT timing vs a real peering bug, D-043)"
disc="$(fed_wait_discovery a b strict 70 || true)"
[ "$disc" = 1 ] && echo "✓ sidecars peer_connected across machines" || echo "⚠ no peer_connected in ~210s"
if [ "$disc" != 1 ]; then
  # D-043 DISC-DIAG: the sidecar JOINED its topic but did not peer. Dump the swarm/DHT
  # detail (announce/lookup/holepunch/bootstrap/flush) on BOTH frames to settle
  # 'joined-but-not-peering' = real sidecar-process transport bug vs public-DHT timing.
  fed_log "DISC-DIAG (D-043): sidecar swarm/DHT state — why joined-but-not-peering"
  for inst in a b; do
    echo "--- $inst: swarm/dht detail (serve.log) ---"
    drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|announce|lookup|holepunch|dht|bootstrap|flush|server|client' /home/pcusp/serve.log 2>/dev/null | tail -35"
  done
fi

fed_log "A→B MERGE (hive, slug-agnostic probe; A member='$MEMBER_SLUG')"
probe_ab="$(fed_hive_merge_probe a b "$MEMBER_SLUG" F-A2B 80 || true)"
ab=0; [ "${probe_ab%% *}" = 1 ] && ab=1
[ "$ab" = 1 ] && echo "✓ A→B: F-A2B federated into B as origin=remote (landed slug='${probe_ab#* }')" || echo "✗ A→B failed (probe=$probe_ab)"
fed_log "B→A MERGE (hive, slug-agnostic probe; B member='$B_MEMBER_SLUG')"
probe_ba="$(fed_hive_merge_probe b a "$B_MEMBER_SLUG" F-B2A 80 || true)"
ba=0; [ "${probe_ba%% *}" = 1 ] && ba=1
[ "$ba" = 1 ] && echo "✓ B→A: F-B2A federated into A as origin=remote (landed slug='${probe_ba#* }')" || echo "✗ B→A failed (probe=$probe_ba)"

# plan-federation-regrain P-008/D-004: the NEW per-part plan-federation table
# (flag papercusp-plan-part-federation ON in both sidecars) must federate
# cross-machine over the same wire. A→B then B→A, distinct plan slugs per dir.
fed_log "PLAN-PART MERGE (per-part plan federation, flag ON) A→B + B→A (hive member slugs)"
ppab="$(fed_plan_part_merge_assert a b "$MEMBER_SLUG" 80 || true)"
case "$ppab" in
  1)    echo "✓ plan-part A→B: item:P-001 federated into B as origin=remote" ;;
  skip) echo "⊘ plan-part A→B: SKIPPED — harness_plan_parts table absent (this .deb predates the plan-parts lane, EI-505)" ;;
  *)    echo "✗ plan-part A→B failed (probe=$ppab)" ;;
esac
ppba="$(fed_plan_part_merge_assert b a "$B_MEMBER_SLUG" 80 || true)"
case "$ppba" in
  1)    echo "✓ plan-part B→A: item:P-001 federated into A as origin=remote" ;;
  skip) echo "⊘ plan-part B→A: SKIPPED — harness_plan_parts table absent (this .deb predates the plan-parts lane, EI-505)" ;;
  *)    echo "✗ plan-part B→A failed (probe=$ppba)" ;;
esac

# D-042 COMMS: the cross-machine COMMUNICATION system (coord feed / coord_event_log)
# must federate over the SAME peer-log wire as content. A→B then B→A, harness-scoped.
fed_log "COORD-COMMS MERGE (coord_event_log feed) A→B + B→A (hive member slugs)"
cab="$(fed_coord_merge_probe a b "$MEMBER_SLUG" A2B 80 || true)"
[ "$cab" = 1 ] && echo "✓ coord A→B: comm event federated into B as origin=remote" || echo "✗ coord A→B failed (probe=$cab)"
cba="$(fed_coord_merge_probe b a "$B_MEMBER_SLUG" B2A 80 || true)"
[ "$cba" = 1 ] && echo "✓ coord B→A: comm event federated into A as origin=remote" || echo "✗ coord B→A failed (probe=$cba)"

# EI-521 WS-DIAG: on merge-fail, dump workspace_ids to settle product-bug vs probe-artifact —
# does the undrained outbox row's workspace_id match the member's boot workspace (the drain's
# WHERE workspace_id = handle.workspaceId)?
if [ "$ab" != 1 ] || [ "$ba" != 1 ] || { [ "$ppab" != 1 ] && [ "$ppab" != skip ]; } || { [ "$ppba" != 1 ] && [ "$ppba" != skip ]; } || [ "${cab:-0}" != 1 ] || [ "${cba:-0}" != 1 ]; then
  fed_log "WS-DIAG (EI-521): workspace_id alignment between capture + drain"
  echo "--- A: undrained outbox (id|table_name|harness_slug|workspace_id|drained_at) ---"; drv_psql a "SELECT id||'|'||table_name||'|'||COALESCE(harness_slug,'∅')||'|'||workspace_id||'|d='||COALESCE(drained_at::text,'NULL') FROM harness_shared.substrate_outbox ORDER BY id;" 2>/dev/null
  echo "--- A: booted-harness workspaceId/slug (the drain's WHERE key — does it match the outbox above?) ---"; drv_exec a <<<"grep -aoE 'bootHarness[^ ]* (ws|workspace)[=:][^ ]+ (slug|harness)[=:][^ ]+|wireOutbox.*slug[=:][^ ]+|startOutboxDrain.*[a-z]' /home/pcusp/serve.log 2>/dev/null | tail -10; echo '(drain-wiring lines:)'; grep -aE 'ensureRelocatedSendSideWired|wireOutbox|outbox wiring|startOutboxDrain|\[outbox-drain\]|relocated send-side|drain wired' /home/pcusp/serve.log 2>/dev/null | tail -15"
  echo "--- A: feature rows (harness_slug|workspace_id|origin) ---"; drv_psql a "SELECT harness_slug||'|'||workspace_id||'|'||origin FROM harness_shared.harness_features_consolidated;" 2>/dev/null
  echo "--- A: registry (slug|workspace_id) ---"; drv_psql a "SELECT slug||'|'||workspace_id FROM harness_shared.harness_registry;" 2>/dev/null
  # D-051: send-side drain now WORKS (A content rows get drained_at). Does the content REACH B?
  echo "--- B: received content (table|harness_slug|workspace_id|origin) — origin=remote means federated ---"; drv_psql b "SELECT table_name||'|'||harness_slug||'|'||workspace_id||'|'||origin FROM (SELECT 'features' table_name, harness_slug, workspace_id, origin FROM harness_shared.harness_features_consolidated UNION ALL SELECT 'plan_parts', harness_slug, workspace_id, origin FROM harness_shared.harness_plan_parts UNION ALL SELECT 'coord_event', COALESCE(harness_slug,'∅'), workspace_id, origin FROM harness_shared.coord_event_log WHERE harness_slug IS NOT NULL) x ORDER BY 1;" 2>/dev/null
  echo "--- B: undrained-or-not outbox (id|table|harness_slug|workspace_id|drained) ---"; drv_psql b "SELECT id||'|'||table_name||'|'||COALESCE(harness_slug,'∅')||'|'||workspace_id||'|d='||COALESCE(drained_at::text,'NULL') FROM harness_shared.substrate_outbox ORDER BY id;" 2>/dev/null
  # RECEIVE-SIDE DIAG (from-repo-seed root cause, run20): the joiner applies 0 origin=remote rows
  # because its hive_directory_cache is empty → ownerDeviceForTopic null → no owner-log bootstrap-
  # admit → 0 hive_members roster → decideMemberContentOp drops/defers every peer op.
  for inst in a b; do
    echo "--- $inst: hive_members roster (github_user_id|binding_status|#device_attest) ---"; drv_psql "$inst" "SELECT github_user_id||'|'||binding_status||'|'||COALESCE(jsonb_array_length(device_attestations),0) FROM harness_shared.pot_members ORDER BY github_user_id;" 2>/dev/null
    echo "--- $inst: hive_directory_cache (workspace_id|plain?|ct?|#hives) — empty = root cause ---"; drv_psql "$inst" "SELECT workspace_id||'|plain='||(payload IS NOT NULL)||'|ct='||(payload_ct IS NOT NULL)||'|hives='||COALESCE(jsonb_array_length(payload->'hives'),-1) FROM harness_shared.pot_directory_cache;" 2>/dev/null
    echo "--- $inst: announce/directory/bootstrap-admit activity (serve.log; counts+slugs only, no creds) ---"; drv_exec "$inst" <<<"grep -aoE 'verifyHiveAnnounce|hive-announce|hiveDirectory|hive_directory|ownerDeviceForTopic|bootstrap.?admit|loadHiveOwnerDevice|resolveSameHiveMember|\[announce\]' /home/pcusp/serve.log 2>/dev/null | sort | uniq -c | tail -20"
  done
  # EI-521 drain-loop diag (D-031): the SEND-side drain is wired but the outbox is undrained.
  for inst in a b; do
    echo "--- $inst: outbox-drain / sidecar-host wiring lines (serve.log) ---"
    drv_exec "$inst" <<<"grep -aE '\[outbox-drain\]|\[substrate-sidecar-host\]|wireOutbox|startOutboxDrain|boot_federate|drain' /home/pcusp/serve.log 2>/dev/null | tail -25"
    echo "--- $inst: announce-channel debug (open/sent/recv + pair + onAnnounce + log_core_key) ---"; drv_exec "$inst" <<<"grep -aE 'announceDebug|open topic|sent fresh|sent static|recv topic|onAnnounce|log_core_key|\bpair\(|admitAnnouncedPeer|openRemoteLog' /home/pcusp/serve.log 2>/dev/null | tail -40"
    echo "--- $inst: [A-003] admit-chain trace (su-a5793 PAPERCUSP_A003_TRACE: owner-resolve/owner-admit/member-guard/slug-filter/hiveHomeSlug/rekey) ---"; drv_exec "$inst" <<<"grep -aE '\[A-003\]' /home/pcusp/serve.log 2>/dev/null | tail -60"
  done
fi

# ── 6. report ─────────────────────────────────────────────────────────────────
fed_log "RESULT (.deb sidecar, Hetzner $STYPE $LOC_A+$LOC_B, public DHT)"
if [ "$disc" != 1 ] || [ "$ab" != 1 ] || [ "$ba" != 1 ]; then
  for inst in a b; do echo "[$inst] $(drv_exec "$inst" <<<"grep -E '\[swarm\]' /home/pcusp/serve.log 2>/dev/null | tail -5")"; done
fi
echo "discovery=$([ "$disc" = 1 ] && echo PASS || echo FAIL)  A→B=$([ "$ab" = 1 ] && echo PASS || echo FAIL)  B→A=$([ "$ba" = 1 ] && echo PASS || echo FAIL)  plan-part A→B=$([ "$ppab" = 1 ] && echo PASS || echo FAIL)  plan-part B→A=$([ "$ppba" = 1 ] && echo PASS || echo FAIL)  coord A→B=$([ "${cab:-0}" = 1 ] && echo PASS || echo FAIL)  coord B→A=$([ "${cba:-0}" = 1 ] && echo PASS || echo FAIL)"
if [ "$disc" = 1 ] && [ "$ab" = 1 ] && [ "$ba" = 1 ] && [ "$ppab" = 1 ] && [ "$ppba" = 1 ] && [ "${cab:-0}" = 1 ] && [ "${cba:-0}" = 1 ]; then
  echo "OVERALL: PASS — the .deb federates cross-machine incl. per-part plans AND coord COMMUNICATION (2 separate Hetzner VMs, real public DHT)"; exit 0
fi
echo "OVERALL: INCOMPLETE — see [swarm] diagnostics + /home/pcusp/serve.log on each frame"; exit 6

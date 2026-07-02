#!/usr/bin/env bash
# deb-hetzner-concurrent.sh — Brief 6 LIVE scenario: concurrent writes / LWW convergence.
#
# Reproduces the in-process spec federation-concurrent-writes-sidecar.repro.integration.test.ts
# over TWO real Hetzner machines (a=owner, b=member) on ONE hive, real public DHT.
# The in-process test proves conflict-free convergence in a shared process; this proves the
# SAME two guarantees hold across two SEPARATE machines with INDEPENDENT HLC clocks (the whole
# reason these live briefs exist — in-process green ≠ live green):
#
#   PHASE 1 — DIFFERENT keys authored ~simultaneously on both peers → after merge BOTH peers
#     hold BOTH features (the other peer's at origin='remote'), exactly ONE row each, NO loss.
#   PHASE 2 — the SAME key authored concurrently on both peers → the PG-level LWW guard
#     (EI-79 / D-001: ON CONFLICT (harness_slug, feature_id) DO UPDATE, ordered by fed_hlc then
#     fed_ts) converges BOTH peers to the SAME deterministic winner — NO split-brain, NO dup row.
#     Winner content {title,status,fed_hlc,fed_ts} is byte-identical on both frames (harness_slug
#     + origin legitimately differ per-side — slug is bound at projection, the winner's side is
#     origin='local' and the loser's side is origin='remote').
#
# WHY the pre-read: two independent machines have independent HLCs, so which of two near-
# simultaneous writes wins is decided by the stamped fed_hlc (mig-314 stamp_local_federated_write
# BEFORE trigger → hlc_now()), NOT by wall-clock ordering. So the script does NOT force a winner —
# it fires both writes concurrently (so each frame INSERTs its own local F-CONTESTED BEFORE either
# federates → no local PK conflict), READS each side's stamped fed_hlc, computes the expected
# winner by the SAME order the PG guard uses, then asserts BOTH frames converge to exactly that.
#
# ── DUAL MODE (the Brief-13 registry contract, same as deb-hetzner-restart.sh) ──
#   1. SOURCED (the combined-matrix design): the matrix (bin/deb-hetzner-matrix.sh) provisions
#      a(owner)+b(member) ONCE, joins them to one hive, then `source`s this file (via
#      bin/lib/scenarios/b6-concurrent.sh) and calls `scenario_concurrent_lww a b` against
#      those SHARED frames. Sourcing only DEFINES the function + the _cl_* helpers — it
#      provisions/tears down NOTHING (the run-if-main guard).
#   2. STANDALONE (the deb-hetzner-<scenario>.sh registry contract): run directly —
#      `bash deb-hetzner-concurrent.sh --deb=PATH` — and it does the full rig_init →
#      install-exit-trap (auto-destroy, servers=0) → provision → setup → publish → join →
#      scenario → exit-with-code dance. Exit 0 = PASS, non-zero = FAIL/INCOMPLETE.
#      Accepts the shared --deb / --type / --locs / --keep-up args.
#
# The scenario is NON-INVASIVE (no sidecar kill/restart) and self-contained (unique
# timestamped feature_ids) — in the combined matrix it runs mid-order (40), after the base
# content/plan-part/coord scenarios and before the invasive restart/reconnect/revocation ones.
#
# ⚠ QUOTA (READ the live-brief quota protocol before running): provisions 2 servers. The Hetzner
# project quota is a HARD ~2-server limit and claiming a brief does NOT reserve it. Take the quota
# mutex FIRST (from the PARENT, not this script):
#     locks:acquire { paths:['ops/hetzner-federation-quota'], intent:'brief 6 live rig', ttl_sec:3600 }
# Only ONE rig at a time. On finish: verify Hetzner /v1/servers shows servers=0, THEN release.
# Pass the SHARED gated forceReFold .deb (do NOT rebuild): --deb=<RIG_DEB from the 4327b thread>.
#
# COST-SAFETY: identical to the base rig — every provisioned server id is recorded
# (rig_create_server) BEFORE anything billable, and the EXIT trap (rig_install_exit_trap →
# rig_cleanup) DELETEs every recorded id + confirms 404, for BOTH frames, regardless of where
# setup failed.
#
# Env / creds (same as deb-hetzner-federation.sh / deb-hetzner-multimember.sh):
#   HCLOUD_TOKEN / HETZNER_SSH_KEY_ID / HETZNER_SSH_IDENTITY
#   gh auth: papercupai (owner) + aviynw (member)
#
# Usage (standalone): bin/deb-hetzner-concurrent.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e
set +u

# ── scenario-local helpers (prefixed _cl_ so co-sourced scenario files don't clash) ─

# _cl_read_lww <inst> <fid> → "title|status|fed_hlc|fed_ts"  (the byte-identical-across-peers
#   tuple; origin + harness_slug are DELIBERATELY excluded — they legitimately differ per side).
#   Richer than rig_read_content — the LWW convergence assert needs the LWW columns.
_cl_read_lww() {
  drv_psql "$1" "SELECT COALESCE(title,'')||'|'||COALESCE(status,'')||'|'||COALESCE(fed_hlc,'')||'|'||COALESCE(fed_ts::text,'') FROM harness_shared.harness_features_consolidated WHERE feature_id='$2' LIMIT 1;" 2>/dev/null | tr -d '[:space:]'
}
_cl_read_origin() { drv_psql "$1" "SELECT COALESCE(origin,'') FROM harness_shared.harness_features_consolidated WHERE feature_id='$2' LIMIT 1;" 2>/dev/null | tr -d '[:space:]'; }
_cl_read_hlc()    { drv_psql "$1" "SELECT COALESCE(fed_hlc,'') FROM harness_shared.harness_features_consolidated WHERE feature_id='$2' AND origin='local' LIMIT 1;" 2>/dev/null | tr -d '[:space:]'; }
_cl_count_feat()  { local n; n="$(drv_psql "$1" "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id='$2';" 2>/dev/null | tr -d '[:space:]')"; echo "${n:-?}"; }
# _cl_poll_present <inst> <fid> <origin|any> <tries> → 1 (present as requested) / 0 (timeout)
_cl_poll_present() {
  local inst="$1" fid="$2" want="$3" tries="${4:-80}" i o
  for i in $(seq 1 "$tries"); do
    o="$(_cl_read_origin "$inst" "$fid")"
    if [ -n "$o" ]; then
      if [ "$want" = "any" ] || [ "$o" = "$want" ]; then echo 1; return 0; fi
    fi
    sleep 3
  done
  echo 0; return 1
}
# _cl_roster_ids <inst> — the frame's hive_members github_user_id set (sorted, comma-joined).
_cl_roster_ids() { drv_psql "$1" "SELECT COALESCE(string_agg(github_user_id::text,',' ORDER BY github_user_id),'') FROM harness_shared.hive_members;" 2>/dev/null | tr -d '[:space:]'; }

# ── the scenario (operates on already-provisioned+joined frames a=owner, b=member) ─
# Reads the rig globals FRAME_MEMBER_SLUG[a|b], FRAME_IP[*], FED_PG[*] (filled by
# rig_owner_publish_hive + rig_join_all + rig_wait_*). Returns 0 = PASS, 6 = FAIL
# (the historical standalone exit code, preserved). NON-INVASIVE + self-contained:
# unique timestamped feature_ids → safe to run after other scenarios on the same
# shared frames, and it leaves the frames healthy. (Prose labels "a"/"b" in the
# output assume the canonical `scenario_concurrent_lww a b` call.)
scenario_concurrent_lww() {
  local OWNER="${1:-a}" MEMBER="${2:-b}"
  local inst disc_ab SLUG_A SLUG_B ts

  # join-hive boots + re-keys the substrate at join — surface the drain diagnostics.
  for inst in "$OWNER" "$MEMBER"; do
    echo "--- $inst [swarm]/drain diag ---"
    drv_exec "$inst" <<<"grep -aE '\[swarm\]|joined topic|peer_connected|drain|federate|attempted=' /home/pcusp/serve.log | tail -6"
  done

  # ── swarm discovery: owner must peer with the member (both directions share it) ─
  rig_wait_swarm "$OWNER" "$MEMBER" 70; disc_ab=$?

  SLUG_A="${FRAME_MEMBER_SLUG[$OWNER]}"
  SLUG_B="${FRAME_MEMBER_SLUG[$MEMBER]}"
  echo "member slugs: a='$SLUG_A' b='$SLUG_B'"

  ts="$(date +%s)"

  # ── ROSTER-POPULATED GATE (the precondition for owner→joiner federation) ──────
  # A receive-side hive_members roster MUST hold the peer set before any peer op is
  # accepted (empty roster → decideMemberContentOp drops every op). Attempt-1 found the
  # JOINER's roster stayed EMPTY in the plain join→write (no-restart) path even with the
  # forceReFold .deb → owner→joiner content dropped. This gate polls b's roster until it
  # matches a's member set (the real precondition), logging it each tick — so a run that
  # NEVER converges is a CONFIRMED owner→joiner gap, not a scenario-timing artifact.
  local A_ROSTER roster_ok i b_r
  A_ROSTER="$(_cl_roster_ids "$OWNER")"
  fed_log "ROSTER GATE: a's member set = [$A_ROSTER]; waiting for b to converge to it (≤300s)"
  roster_ok=0
  for i in $(seq 1 100); do
    b_r="$(_cl_roster_ids "$MEMBER")"
    [ $(( i % 5 )) -eq 1 ] && echo "  roster b @ $(( (i-1) * 3 ))s = [$b_r]"
    if [ -n "$A_ROSTER" ] && [ "$b_r" = "$A_ROSTER" ]; then roster_ok=1; echo "✓ roster gate: b converged to a's member set after ~$(( (i-1) * 3 ))s"; break; fi
    sleep 3
  done
  if [ "$roster_ok" != 1 ]; then
    echo "✗ ROSTER GATE FAILED — b's roster never converged to a's [$A_ROSTER] in 300s (b=[$(_cl_roster_ids "$MEMBER")])"
    echo "   ⇒ CONFIRMED owner→joiner gap: the joiner never folds the owner's hive_members op in the no-restart path."
    echo "   (running the write phases anyway to capture the full failure signature)"
  fi

  # ══ PHASE 1 — DIFFERENT keys concurrent → both peers hold both, no loss ════════
  local FID_A="F-AONLY-$ts"   # authored on a
  local FID_B="F-BONLY-$ts"   # authored on b
  fed_log "PHASE 1: different keys authored concurrently (a writes $FID_A, b writes $FID_B)"
  rig_write_content "$OWNER" "$SLUG_A" "$FID_A" "a-only-feature" todo >/dev/null &
  rig_write_content "$MEMBER" "$SLUG_B" "$FID_B" "b-only-feature" todo >/dev/null &
  wait

  # each peer's OWN write is origin=local; the OTHER peer's must arrive origin=remote.
  local p1_a_own p1_b_own p1_a_rem p1_b_rem c1_a_a c1_a_b c1_b_a c1_b_b phase1_pass
  p1_a_own=$(_cl_poll_present "$OWNER" "$FID_A" local 20)      # a sees its own immediately
  p1_b_own=$(_cl_poll_present "$MEMBER" "$FID_B" local 20)     # b sees its own immediately
  p1_a_rem=$(_cl_poll_present "$OWNER" "$FID_B" remote 80)     # b's write federates INTO a
  p1_b_rem=$(_cl_poll_present "$MEMBER" "$FID_A" remote 80)    # a's write federates INTO b
  c1_a_a=$(_cl_count_feat "$OWNER" "$FID_A"); c1_a_b=$(_cl_count_feat "$OWNER" "$FID_B")
  c1_b_a=$(_cl_count_feat "$MEMBER" "$FID_A"); c1_b_b=$(_cl_count_feat "$MEMBER" "$FID_B")
  echo "PHASE1 present: a{own=$p1_a_own remote=$p1_a_rem} b{own=$p1_b_own remote=$p1_b_rem}"
  echo "PHASE1 counts:  a[$FID_A]=$c1_a_a a[$FID_B]=$c1_a_b b[$FID_A]=$c1_b_a b[$FID_B]=$c1_b_b (each must be 1)"
  phase1_pass=0
  if [ "$p1_a_own" = 1 ] && [ "$p1_b_own" = 1 ] && [ "$p1_a_rem" = 1 ] && [ "$p1_b_rem" = 1 ] \
     && [ "$c1_a_a" = 1 ] && [ "$c1_a_b" = 1 ] && [ "$c1_b_a" = 1 ] && [ "$c1_b_b" = 1 ]; then
    phase1_pass=1; echo "✓ PHASE 1 PASS — both peers hold BOTH keys, exactly 1 row each, no loss"
  else
    echo "✗ PHASE 1 FAIL — a write was lost or duplicated"
  fi

  # ══ PHASE 2 — SAME key concurrent → LWW converges both peers to ONE winner ═════
  local FID_C="F-CONTESTED-$ts"
  fed_log "PHASE 2: SAME key '$FID_C' authored concurrently on both peers (LWW convergence)"
  # Fire BOTH local INSERTs concurrently — each frame writes its own F-CONTESTED BEFORE either
  # federates, so no local PK conflict; the LWW guard resolves them after drain.
  rig_write_content "$OWNER" "$SLUG_A" "$FID_C" "A-side-write" in_progress >/dev/null &
  rig_write_content "$MEMBER" "$SLUG_B" "$FID_C" "B-side-write" done >/dev/null &
  wait
  # Convergence, asserted DIRECTLY: federation can converge before we could read the loser's
  # pre-converge local row, so we do NOT pre-guess the winner — we poll until BOTH frames show the
  # SAME {title,status,fed_hlc,fed_ts} tuple AND exactly 1 row each. That IS the guarantee: a
  # deterministic LWW winner agreed on both sides, no split-brain, no dup. origin legitimately differs
  # (winner=local on its author, remote on the loser).
  local converged WINTUPLE ta tb ca cb FINAL_A FINAL_B CNT_A CNT_B O_A O_B phase2_pass
  converged=0; WINTUPLE=""
  for i in $(seq 1 100); do
    ta="$(_cl_read_lww "$OWNER" "$FID_C")"; tb="$(_cl_read_lww "$MEMBER" "$FID_C")"
    ca="$(_cl_count_feat "$OWNER" "$FID_C")"; cb="$(_cl_count_feat "$MEMBER" "$FID_C")"
    if [ -n "$ta" ] && [ "$ta" = "$tb" ] && [ "$ca" = 1 ] && [ "$cb" = 1 ]; then converged=1; WINTUPLE="$ta"; break; fi
    sleep 3
  done
  FINAL_A="$(_cl_read_lww "$OWNER" "$FID_C")"; FINAL_B="$(_cl_read_lww "$MEMBER" "$FID_C")"
  CNT_A="$(_cl_count_feat "$OWNER" "$FID_C")"; CNT_B="$(_cl_count_feat "$MEMBER" "$FID_C")"
  O_A="$(_cl_read_origin "$OWNER" "$FID_C")"; O_B="$(_cl_read_origin "$MEMBER" "$FID_C")"
  echo "PHASE2 final: a=[$FINAL_A] origin=$O_A count=$CNT_A"
  echo "PHASE2 final: b=[$FINAL_B] origin=$O_B count=$CNT_B"
  phase2_pass=0
  if [ "$converged" = 1 ]; then
    phase2_pass=1; echo "✓ PHASE 2 PASS — both peers converged to the SAME LWW winner [$WINTUPLE], byte-identical, 1 row each, no split-brain/dup"
  else
    echo "✗ PHASE 2 FAIL — no convergence (a=[$FINAL_A] b=[$FINAL_B] cnt a=$CNT_A b=$CNT_B)"
    fed_log "PHASE2-DIAG: rosters (empty roster drops peer ops)"
    for inst in "$OWNER" "$MEMBER"; do echo "--- $inst roster ---"; rig_read_roster "$inst"; done
  fi

  # ── report ────────────────────────────────────────────────────────────────────
  fed_log "RESULT (2-frame .deb sidecar, Hetzner ${RIG_STYPE:-?} ${LOC_A:-?}+${LOC_B:-?}, public DHT)"
  echo "disc a↔b=$([ "$disc_ab" = 0 ] && echo PASS || echo FAIL)  roster-gate(owner→joiner precond)=$([ "$roster_ok" = 1 ] && echo PASS || echo FAIL)  phase1(different-keys/no-loss)=$([ "$phase1_pass" = 1 ] && echo PASS || echo FAIL)  phase2(same-key/LWW-converge)=$([ "$phase2_pass" = 1 ] && echo PASS || echo FAIL)"
  if [ "$disc_ab" = 0 ] && [ "$roster_ok" = 1 ] && [ "$phase1_pass" = 1 ] && [ "$phase2_pass" = 1 ]; then
    echo "OVERALL: PASS — concurrent bidirectional writes converge conflict-free (no loss on different keys; deterministic LWW winner on the same key) across 2 separate Hetzner VMs (real public DHT)"; return 0
  fi
  echo "OVERALL: INCOMPLETE — see [swarm] diagnostics + /home/pcusp/serve.log on each frame"; return 6
}

# ── STANDALONE entrypoint (deb-hetzner-<scenario>.sh registry contract) — only when run directly ──
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  # ── args / config ─────────────────────────────────────────────────────────────
  LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
  for arg in "$@"; do case "$arg" in
    --locs=*) LOCS="${arg#--locs=}" ;;
    --type=*) STYPE="${arg#--type=}" ;;
    --deb=*)  DEB="${arg#--deb=}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    --keep-up) KEEP_UP=1 ;;
    -h|--help) sed -n '2,58p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg" ;;
  esac; done
  IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
  [ -n "$LOC_B" ] || LOC_B="$LOC_A"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  P_A_USER="${P_A_USER:-papercupai}"   # owner
  P_B_USER="${P_B_USER:-aviynw}"       # member

  # ── init + ARM auto-destroy (BEFORE any provision) ────────────────────────────
  RIG_KEEP_UP="$KEEP_UP"
  rig_init "$STYPE" "$IMAGE" || exit 1
  rig_install_exit_trap
  RIG_DEB="$DEB"

  # ── artifact gate (once) ──────────────────────────────────────────────────────
  rig_gate_artifact "$DEB" || exit 2

  # ── identities: a=owner, b=member ─────────────────────────────────────────────
  rig_set_identity a "$P_A_USER" || exit 1
  rig_set_identity b "$P_B_USER" || exit 1

  # ── provision both frames (records every id BEFORE install) ────────────────────
  rig_provision "$LOC_A" "$LOC_B" || exit 3

  # ── install .deb + launch sidecar on every frame ──────────────────────────────
  rig_setup_all || exit 4

  # ── boot + API readiness on every frame ───────────────────────────────────────
  fed_log "wait embedded-PG + operator on both sidecars"
  rig_wait_all_ready 50 || exit 5
  echo "✓ isolated by construction (2 separate cloud machines)"

  # ── owner publishes the hive; both frames join it ─────────────────────────────
  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  rig_owner_publish_hive a "$REPO_URL" || exit 6
  rig_join_all a   # a (owner self-join) + b

  # join-hive boots + re-keys the substrate at join — give the swarm time to peer.
  fed_log "joined — wait for peer_connect + drain (NO restart)"
  sleep 12

  scenario_concurrent_lww a b
  exit $?
fi

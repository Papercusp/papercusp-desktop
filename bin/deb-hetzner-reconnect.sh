#!/usr/bin/env bash
# deb-hetzner-reconnect.sh — federation-release-hardening Brief 4: LIVE reconnect / catch-up.
#
# Proves (over REAL Hetzner VMs, real public DHT) that a member which is OFFLINE while the
# owner writes several ops CATCHES UP FULLY on reconnect — the live reproduction of the
# in-process `federation-reconnect-catchup-sidecar.repro.integration.test.ts`. The offline
# member missed the ops entirely (its sidecar — operator + swarm — was down), so their
# arrival origin='remote' AFTER it re-peers is genuine catch-up (log-replay from the cursor),
# not live delivery. Covers all three federated op classes: CONTENT (features),
# PLAN-PART (harness_plan_parts), and COORD (coord_event_log). Plus no-loss (pre-partition
# content survives), no-dup (exactly one row per feature after the cold re-open re-fold),
# roster intact, and link-healed (a NEW owner write after reconnect still federates).
#
# ── DUAL MODE (matches the deb-hetzner-restart.sh registry contract) ────────────
#   1. SOURCED (the combined-matrix design): the matrix provisions a(owner)+b(member)
#      ONCE, joins them to one hive, then `source`s this file and calls
#      `scenario_reconnect_catchup a b` against those SHARED frames. Sourcing only
#      DEFINES the function — it provisions/tears down NOTHING (the run-if-main guard).
#   2. STANDALONE (the deb-hetzner-<scenario>.sh registry contract): run directly —
#      `bash deb-hetzner-reconnect.sh --deb=PATH` — and it does the full rig_init →
#      install-exit-trap (auto-destroy, servers=0) → provision → setup → publish → join →
#      scenario → exit-with-code dance. Exit 0 = PASS, non-zero = FAIL/INCOMPLETE.
#      Accepts the shared --deb / --type / --locs / --keep-up args.
#
# The scenario is a 2-FRAME run (owner + one member) — fits the permanent 2-server Hetzner
# cap. It is INVASIVE (kills + restarts the member sidecar) so in the combined matrix it
# should run alongside the restart scenario (LATE); it leaves both sidecars UP + re-joined
# so a later scenario can reuse the frames.
#
# Reuse the fixed .deb (forceReFold==4 in its bundled serve.mjs); do NOT rebuild.
# NOTE: `default_deb` currently resolves an OLDER bundle whose serve.mjs is forceReFold==0 —
# the matrix/standalone caller MUST pass a --deb that carries the fix (the RIG_DEB path from
# the su-4327b .deb thread: ~/.cargo-target/release/bundle/deb/Papercusp_0.0.2_amd64.deb),
# else this tests the pre-fix code.
#
# Usage (standalone): bin/deb-hetzner-reconnect.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e
set +u

# ── scenario-local helpers (prefixed _rc_ so co-sourced scenario files don't clash) ─

# _rc_poll_feature <inst> <feature_id> [tries] — PASS (0) iff the feature row arrives with
# origin='remote' on <inst> within tries×3s. Echoes the receiving harness_slug on success.
_rc_poll_feature() {
  local inst="$1" fid="$2" tries="${3:-90}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo "$row"; return 0; }
    sleep 3
  done
  return 1
}

# _rc_row_count <inst> <feature_id> — echo the number of PG rows for this feature_id.
_rc_row_count() {
  drv_psql "$1" "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id='$2';" 2>/dev/null | tr -d '[:space:]'
}

# _rc_assert_single <inst> <feature_id> <label> — assert exactly one PG row (no-dup guard).
_rc_assert_single() {
  local n; n="$(_rc_row_count "$1" "$2")"
  if [ "${n:-0}" = "1" ]; then echo "  ✓ no-dup: $3 ($1/$2) = exactly 1 row"; else
    echo "  ✗ NO-DUP FAIL: $3 ($1/$2) = '${n:-?}' rows (want 1)"; _RC_RC=1; fi
}

# _rc_origin <inst> <feature_id> — echo "<slug>|<origin>" for the row (empty if absent).
_rc_origin() { rig_read_content "$1" "$2"; }

# _rc_write_planpart <src> <slug> <plan_slug> <part_key> <body> — INSERT a plan-part
# origin='local' on <src> (the mig-271 capture trigger enqueues it). Body must be
# whitespace-free (the poll strips whitespace before comparing). Mirrors
# fed_plan_part_merge_assert's INSERT; workspace_id = the operator's REAL workspace.
_rc_write_planpart() {
  local src="$1" slug="$2" plan_slug="$3" part_key="$4" body="$5" ts ws
  ts="$(date +%s)000"
  # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping) — works on
  # owner AND joiner, unlike origin='local'. See its definition for the mechanism.
  ws="$(rig_resolve_ws "$src")" || return 1
  drv_psql "$src" "INSERT INTO harness_shared.harness_plan_parts (workspace_id,harness_slug,plan_slug,part_key,kind,body,ordinal,fed_ts,author,tombstone,origin) VALUES ('$ws','$slug','$plan_slug','$part_key','item','$body',1,$ts,'$src',false,'local');" >/dev/null
}

# _rc_poll_planpart <dst> <plan_slug> <part_key> <body> [tries] — PASS iff the part arrives
# origin='remote' with the matching body on <dst>.
_rc_poll_planpart() {
  local dst="$1" plan_slug="$2" part_key="$3" body="$4" tries="${5:-90}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$dst" "SELECT origin||'|'||body FROM harness_shared.harness_plan_parts WHERE plan_slug='$plan_slug' AND part_key='$part_key' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ "$row" = "remote|$body" ] && return 0
    sleep 3
  done
  return 1
}

# _rc_write_coord <src> <slug> <msg_id> — INSERT a coord (messages surface) event
# origin='local' on <src>. Mirrors fed_coord_merge_probe's INSERT.
_rc_write_coord() {
  local src="$1" slug="$2" msg_id="$3" ws
  # D-050 / WI-5399 iteration 2: rig_resolve_ws (pot_home_slug scoping).
  ws="$(rig_resolve_ws "$src")" || return 1
  drv_psql "$src" "INSERT INTO harness_shared.coord_event_log (workspace_id,surface,writer_key,msg_id,body,harness_slug,origin) VALUES ('$ws','messages','rc-probe','$msg_id','{\"kind\":\"message\",\"text\":\"reconnect catchup coord probe\"}'::jsonb,'$slug','local');" >/dev/null
}

# _rc_poll_coord <dst> <msg_id> [tries] — PASS iff the coord event arrives origin='remote'.
_rc_poll_coord() {
  local dst="$1" msg_id="$2" tries="${3:-90}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$dst" "SELECT msg_id FROM harness_shared.coord_event_log WHERE msg_id='$msg_id' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && return 0
    sleep 3
  done
  return 1
}

# ── the scenario (operates on already-provisioned+joined frames a=owner, b=member) ─
# Reads rig globals FRAME_MEMBER_SLUG[a|b], FRAME_IP[*], FED_PG[*]. Returns 0 = PASS.
# Self-contained: unique timestamped ids → safe to run after other scenarios on the same
# shared frames. Leaves both sidecars UP + re-joined.
scenario_reconnect_catchup() {
  local OWNER="${1:-a}" MEMBER="${2:-b}"
  local oslug="${FRAME_MEMBER_SLUG[$OWNER]:-}" mslug="${FRAME_MEMBER_SLUG[$MEMBER]:-}"
  local ts; ts="$(date +%s)"
  local FBASE="F-RC-BASE-$ts"
  local FOFF1="F-RC-OFF1-$ts" FOFF2="F-RC-OFF2-$ts" FOFF3="F-RC-OFF3-$ts"
  local FPOST="F-RC-POST-$ts"
  local PPSLUG="ppfed-rc-$ts" PPKEY="item:P-001" PPBODY="rc-planpart-off-from-$OWNER"
  local CMID="COMM-RC-OFF-$ts"
  _RC_RC=0

  fed_log "═══ Brief 4: LIVE reconnect / catch-up (owner=$OWNER member=$MEMBER) ═══"
  if [ -z "$oslug" ] || [ -z "$mslug" ]; then
    echo "✗ reconnect-catchup: frames not joined (owner-slug='$oslug' member-slug='$mslug') — run rig_owner_publish_hive + rig_join_all first"
    echo "OVERALL: INCOMPLETE"; return 1
  fi
  echo "  owner-view slug=$oslug   member slug=$mslug"

  # ── STEP 1: baseline — owner writes F-BASE → member receives (link healthy pre-partition) ──
  fed_log "[1] baseline: owner writes $FBASE → federate to member (confirm the link BEFORE the partition)"
  rig_write_content "$OWNER" "$oslug" "$FBASE" "reconnect baseline owner feature" todo >/dev/null
  if rslug="$(_rc_poll_feature "$MEMBER" "$FBASE" 70)"; then
    echo "  ✓ baseline: $FBASE federated to member pre-partition (origin=remote, slug=$rslug)"
  else
    echo "  ✗ BASELINE FAIL: $FBASE never federated to member before partition"
    fed_log "diag: member roster (empty roster drops every owner op):"; rig_read_roster "$MEMBER"; _RC_RC=1
  fi

  # ── STEP 2: take the MEMBER OFFLINE (kill sidecar, preserve pgdata) ──
  fed_log "[2] take member OFFLINE — rig_kill_sidecar (preserve pgdata; operator + swarm down)"
  rig_kill_sidecar "$MEMBER" >/dev/null 2>&1
  # Verify the partition is REAL by the member's OWN unreachability — NOT by parsing the
  # kill helper's stdout (it interleaves its fed_log line, so a literal "sidecar stopped"
  # match is unreliable and false-negatives). The member sidecar owns the operator API +
  # embedded PG; once it is down, drv_psql to the member fails → genuine partition → any
  # offline-window op arriving after restart is real CATCH-UP, not a live delivery.
  local _rc_down=0 i
  for i in 1 2 3 4 5; do
    if ! drv_psql "$MEMBER" "SELECT 1;" >/dev/null 2>&1; then _rc_down=1; break; fi
    sleep 2
  done
  if [ "$_rc_down" = 1 ]; then
    echo "  ✓ member offline — operator/PG unreachable, so it can no longer federate live (catch-up will be genuine)"
  else
    echo "  ✗ PARTITION FAIL: member operator still answering after kill — a live delivery would make catch-up vacuous"; _RC_RC=1
  fi

  # ── STEP 3: while member is OFFLINE, owner writes SEVERAL ops (content + plan-part + coord) ──
  fed_log "[3] owner writes offline-window ops while member is DOWN: $FOFF1 $FOFF2 $FOFF3 + plan-part $PPSLUG + coord $CMID"
  rig_write_content "$OWNER" "$oslug" "$FOFF1" "offline-window feature 1" todo >/dev/null
  rig_write_content "$OWNER" "$oslug" "$FOFF2" "offline-window feature 2" in_progress >/dev/null
  rig_write_content "$OWNER" "$oslug" "$FOFF3" "offline-window feature 3" done >/dev/null
  _rc_write_planpart "$OWNER" "$oslug" "$PPSLUG" "$PPKEY" "$PPBODY"
  _rc_write_coord "$OWNER" "$oslug" "$CMID"
  local owncount; owncount="$(drv_psql "$OWNER" "SELECT count(*) FROM harness_shared.harness_features_consolidated WHERE feature_id IN ('$FOFF1','$FOFF2','$FOFF3') AND origin='local';" 2>/dev/null | tr -d '[:space:]')"
  if [ "${owncount:-0}" = "3" ]; then echo "  ✓ owner authored 3 offline-window features (origin=local) while member down"; else
    echo "  ✗ OFFLINE-WRITE FAIL: owner has '${owncount:-?}'/3 offline features local"; _RC_RC=1; fi

  # ── STEP 4: bring the MEMBER BACK — reconnect → catch-up ──
  fed_log "[4] bring member BACK — rig_restart_sidecar → boot-all re-reads state → swarm rejoin → CATCH-UP"
  rig_restart_sidecar "$MEMBER"
  rig_wait_frame_ready "$MEMBER" 60 || { echo "  ✗ member sidecar did not come back after reconnect"; _RC_RC=1; }
  rig_wait_swarm "$OWNER" "$MEMBER" 80 || echo "  ⚠ member did not re-peer within window (catch-up polls below still retry)"

  # ── STEP 5: assert CATCH-UP of every offline-window op on the member (origin=remote) ──
  fed_log "[5] assert member caught up on ALL missed ops (content + plan-part + coord)"
  local f
  for f in "$FOFF1" "$FOFF2" "$FOFF3"; do
    if _rc_poll_feature "$MEMBER" "$f" 90 >/dev/null; then echo "  ✓ catch-up content: $f arrived on member (origin=remote)"; else
      echo "  ✗ CATCH-UP FAIL (content): $f never arrived on member after reconnect"; _RC_RC=1; fi
  done
  if _rc_poll_planpart "$MEMBER" "$PPSLUG" "$PPKEY" "$PPBODY" 90; then echo "  ✓ catch-up plan-part: $PPSLUG/$PPKEY arrived on member (origin=remote)"; else
    echo "  ✗ CATCH-UP FAIL (plan-part): $PPSLUG/$PPKEY never arrived on member after reconnect"; _RC_RC=1; fi
  if _rc_poll_coord "$MEMBER" "$CMID" 90; then echo "  ✓ catch-up coord: $CMID arrived on member (origin=remote)"; else
    echo "  ✗ CATCH-UP FAIL (coord): $CMID never arrived on member after reconnect"; _RC_RC=1; fi

  # NO LOSS: the pre-partition baseline still present on the member.
  local base_post; base_post="$(_rc_origin "$MEMBER" "$FBASE")"
  case "$base_post" in *"|remote") echo "  ✓ no-loss: pre-partition $FBASE still present on member (origin=remote)";; *) echo "  ✗ NO-LOSS FAIL: $FBASE missing/wrong-origin on member after reconnect (got '$base_post')"; _RC_RC=1;; esac

  # NO DUP: exactly one PG row per feature on the member (the cold re-open re-fold + LWW upsert dedup).
  _rc_assert_single "$MEMBER" "$FBASE" "baseline F-base"
  _rc_assert_single "$MEMBER" "$FOFF1" "offline F-off1"
  _rc_assert_single "$MEMBER" "$FOFF2" "offline F-off2"
  _rc_assert_single "$MEMBER" "$FOFF3" "offline F-off3"

  # ROSTER intact on the member after reconnect.
  local roster_post; roster_post="$(rig_read_roster "$MEMBER")"
  if [ -n "$roster_post" ]; then echo "  ✓ roster intact on member after reconnect: $(printf '%s' "$roster_post" | tr '\n' ' ')"; else
    echo "  ✗ ROSTER FAIL: member roster EMPTY after reconnect (would drop all peer ops)"; _RC_RC=1; fi

  # ── STEP 6: link fully healed — a NEW owner write after reconnect still federates ──
  fed_log "[6] link-healed check — owner writes $FPOST after reconnect → must federate to member"
  rig_write_content "$OWNER" "$oslug" "$FPOST" "post-reconnect owner feature" todo >/dev/null
  if _rc_poll_feature "$MEMBER" "$FPOST" 90 >/dev/null; then echo "  ✓ link-healed: $FPOST federated to member after reconnect (ongoing federation resumed, not just a one-time catch-up)"; else
    echo "  ✗ LINK-HEALED FAIL: $FPOST did not federate after reconnect"; _RC_RC=1; fi
  _rc_assert_single "$MEMBER" "$FPOST" "post-reconnect F-post"

  # ── report ──
  fed_log "RESULT Brief 4 (reconnect / catch-up, 2-frame .deb sidecar, real public DHT)"
  if [ "$_RC_RC" = 0 ]; then
    echo "OVERALL: PASS — member offline during owner writes CAUGHT UP FULLY on reconnect (content+plan-part+coord, origin=remote), no loss, no dup, roster intact, link resumed"
    return 0
  fi
  echo "OVERALL: INCOMPLETE — reconnect/catch-up had failures (see ✗ lines + /home/pcusp/serve.log on each frame)"
  return 1
}

# ── STANDALONE entrypoint (deb-hetzner-<scenario>.sh registry contract) — only when run directly ──
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"
  for arg in "$@"; do case "$arg" in
    --locs=*) LOCS="${arg#--locs=}" ;;
    --type=*) STYPE="${arg#--type=}" ;;
    --deb=*)  DEB="${arg#--deb=}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    --keep-up) KEEP_UP=1 ;;
    -h|--help) sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg" ;;
  esac; done
  IFS=',' read -r LOC_A LOC_B <<<"$LOCS"
  [ -n "$LOC_B" ] || LOC_B="$LOC_A"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  P_A_USER="${P_A_USER:-papercupai}"   # owner
  P_B_USER="${P_B_USER:-aviynw}"       # member

  RIG_KEEP_UP="$KEEP_UP"
  rig_init "$STYPE" "$IMAGE" || exit 1
  rig_install_exit_trap          # ARM auto-destroy BEFORE any provision (servers=0)
  RIG_DEB="$DEB"
  rig_gate_artifact "$DEB" || exit 2

  rig_set_identity a "$P_A_USER" || exit 1
  rig_set_identity b "$P_B_USER" || exit 1
  rig_provision "$LOC_A" "$LOC_B" || exit 3
  rig_setup_all || exit 4

  fed_log "wait embedded-PG + operator on both sidecars"
  rig_wait_all_ready 50 || exit 5

  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  rig_owner_publish_hive a "$REPO_URL" || exit 6
  rig_join_all a   # a (owner self-join) + b

  fed_log "joined — wait for peer_connect + initial drain"
  sleep 12
  rig_wait_swarm a b 70 || echo "⚠ a↔b not yet peered before scenario (scenario polls/restarts will retry)"

  scenario_reconnect_catchup a b
  rc=$?
  [ "$rc" = 0 ] && echo "OVERALL: PASS" || echo "OVERALL: INCOMPLETE"
  exit "$rc"
fi

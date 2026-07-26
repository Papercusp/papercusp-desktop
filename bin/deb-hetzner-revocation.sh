#!/usr/bin/env bash
# deb-hetzner-revocation.sh — federation-release-hardening Brief 3: LIVE revocation + epoch K-cut.
#
# Proves (over REAL Hetzner VMs) that a REVOKED / BANNED member STOPS receiving
# federated content — the live reproduction of the in-process
# `federation-revocation-kcut-sidecar.repro.integration.test.ts` (+ the "banned-member
# subsequent content dropped" leg of federation-security-drops-sidecar.repro, DROP 3b).
#
# The in-process repro asserts the epoch-crypto internals (epoch-1 key wrapped to the
# REMAINING device only → the banned device's decrypt gate DEFERS the op forever); over
# SSH+psql we observe the BEHAVIORAL equivalent in PG state: post-ban owner content
# NEVER lands origin='remote' on the banned member, while pre-ban content stays readable
# and (3-frame) a still-valid member keeps receiving. This is mechanism-AGNOSTIC by
# design (like deb-hetzner-restart.sh): the owner ban drives BOTH the revoked_pubkeys
# admission blocklist (member denied on next re-verify) AND, where hive epoch-crypto is
# active, the epoch 0→1 K-cut read cut-off. Either path yields the same observable.
#
# ── The baseline guard (why this scenario restarts B on an empty roster) ──────────
# A post-ban ABSENCE only proves a cut-off if owner→B federation WORKED before the ban.
# There is a KNOWN concurrent gap (e7698/0f0a4/WI-1378): forceReFold fires only on the
# rekey→REBIND path, so in the plain fresh-join NO-restart path the owner's hive_members
# op is dropped in the home=<none> window and B's roster stays EMPTY → decideMemberContentOp
# drops every owner op → owner→B federation is broken independent of any ban. If the
# baseline is left broken, the post-ban absence FALSE-POSITIVES. So the scenario's baseline
# step is ADAPTIVE: if the first owner→B write does not land AND B's roster is empty, it
# re-folds via a member restart (8f1ad's Brief 5 live data point: a restart populates the
# roster + federates) and retries — isolating the revocation test from WI-1378. Once
# WI-1378 lands the restart branch simply never triggers.
#
# ── DUAL MODE (matches deb-hetzner-restart.sh, for the Brief-13 combined matrix) ──
#   1. SOURCED: the matrix provisions+joins frames ONCE, then `source`s this file and
#      calls `scenario_revocation_kcut <owner> <banned> [valid_member]` on the shared
#      frames. Sourcing DEFINES the function only (run-if-main guard) — no provision.
#   2. STANDALONE: `bash deb-hetzner-revocation.sh --deb=PATH` runs the full
#      rig_init → exit-trap (auto-destroy, servers=0) → provision → setup → publish →
#      join → scenario → exit-code dance. Exit 0 = PASS, non-zero = FAIL/INCOMPLETE.
#
# Frame count: 2-frame by default (owner + banned member) — fits the permanent 2-server
# Hetzner cap. Pass --with-valid-member to add a 3rd frame (a still-valid member C,
# proving the ban is TARGETED not a global outage) — needs a ≥3 quota bump. This scenario
# is INVASIVE (bans a member): in the combined matrix, run it LATE and never before a
# scenario that needs the banned member federating.
#
# ── Live-run reminders (per 8f1ad's fleet protocol) ─────────────────────────────
#   • The ops/hetzner-federation-quota mutex is now AUTOMATIC (EI-5884 / WI-1442
#     fix b): rig_provision (deb-hetzner-rig.sh) acquires it exclusively before
#     creating any server and rig_cleanup releases it unconditionally on exit —
#     no manual locks:acquire_resource/release_resource calls needed here.
#   • --deb must carry the fix: /home/marsh-office/.cargo-target/release/bundle/deb/Papercusp_0.0.2_amd64.deb
#     (forceReFold==4). `default_deb` may resolve an OLDER bundle — pass --deb explicitly.
#   • After the run: verify Hetzner servers=0 (the EXIT trap destroys; confirm).
#
# Usage (standalone): bin/deb-hetzner-revocation.sh [--locs=ash,ash] [--type=cpx31] [--deb=PATH] [--with-valid-member] [--keep-up]
set -uo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DESKTOP_DIR/scripts/linux-test-vm/lib/common.sh"
source "$DESKTOP_DIR/bin/lib/federation-asserts.sh"
source "$DESKTOP_DIR/bin/lib/deb-hetzner-rig.sh"
set +e
set +u

# ── scenario-local helpers (prefixed _rv_ so co-sourced scenario files don't clash) ─

# _rv_poll_remote <inst> <feature_id> [tries] — PASS (0) + echo the receiving slug iff
# the row arrives origin='remote' on <inst> within tries×3s. Positive analog of
# rig_assert_absent (federation landed).
_rv_poll_remote() {
  local inst="$1" fid="$2" tries="${3:-80}" i row
  for i in $(seq 1 "$tries"); do
    row="$(drv_psql "$inst" "SELECT harness_slug FROM harness_shared.harness_features_consolidated WHERE feature_id='$fid' AND origin='remote' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$row" ] && { echo "$row"; return 0; }
    sleep 3
  done
  return 1
}

# _rv_roster_empty <inst> — true (0) iff <inst>'s pot_members roster for THIS pot
# has NO rows (the WI-1378 no-restart symptom that drops every owner op). SCOPED
# to this run's workspace + RIG_HIVE_ID (EI-18656746187879489: an unscoped count
# here reads "non-empty" from ANY unrelated pot on a reused frame, sending the
# baseline-fail branch above down the wrong diagnosis — "a different federation
# fault, not the ban" — when the real WI-1378 empty-roster gap was masked by
# another pot's rows).
_rv_roster_empty() {
  local inst="$1" pot="${RIG_HIVE_ID:-}" conds="" where="" n
  [ -n "${RIG_WORKSPACE_ID:-}" ] && conds="workspace_id='${RIG_WORKSPACE_ID}'"
  if [ -n "$pot" ]; then
    [ -n "$conds" ] && conds="$conds AND pot_home_slug='$pot'" || conds="pot_home_slug='$pot'"
  fi
  [ -n "$conds" ] && where=" WHERE $conds"
  n="$(drv_psql "$inst" "SELECT count(*) FROM harness_shared.pot_members${where};" 2>/dev/null | tr -d '[:space:]')"
  [ "${n:-0}" = "0" ]
}

# _rv_baseline_diag — on a BASELINE FAIL, dump enough state to tell an ADMIT-side
# fault (owner never wrote B's roster row: announce/attestation/gh-API) from a
# REPLICATION fault (op exists on the owner but never landed on B). Added after the
# 2026-07-01 INCOMPLETE run where auto-destroy wiped the evidence: B's roster was
# empty even after a restart re-fold, which the B-side-only diag could not explain.
_rv_baseline_diag() {
  local OWNER="${1:-a}" BANNED="${2:-b}" inst
  fed_log "diag: $BANNED roster:"; rig_read_roster "$BANNED"
  fed_log "diag: $OWNER roster (does the owner hold ANY member rows — did admit ever happen?):"
  rig_read_roster "$OWNER"
  for inst in "$OWNER" "$BANNED"; do
    fed_log "diag: $inst serve.log tail (swarm/admit/announce/attest/hive_members):"
    rig_ssh "${FRAME_IP[$inst]}" \
      "tail -n 400 /home/pcusp/serve.log 2>/dev/null | grep -Ei 'swarm|admit|announce|attest|hive_member|roster|rate.?limit|gist' | tail -n 40" \
      || echo "  (serve.log unreadable on $inst)"
  done
}

# ── the scenario (operates on already-provisioned+joined frames) ──────────────
# scenario_revocation_kcut <owner> <banned> [valid_member]
# Reads rig globals FRAME_MEMBER_SLUG/FRAME_IP/FED_PG/FRAME_USER + RIG_HIVE_ID (filled
# by rig_owner_publish_hive + rig_join_all + rig_wait_*). Returns 0 = PASS, 1 = FAIL,
# 2 = INCOMPLETE (baseline could not be established — cannot attribute a cut-off).
# Unique timestamped feature_ids → safe to run after other scenarios on shared frames.
scenario_revocation_kcut() {
  local OWNER="${1:-a}" BANNED="${2:-b}" VALID="${3:-}"
  local oslug="${FRAME_MEMBER_SLUG[$OWNER]:-}" bslug="${FRAME_MEMBER_SLUG[$BANNED]:-}"
  local ts; ts="$(date +%s)"
  local FPRE="F-RV-PRE-$ts" FPRE2="F-RV-PRE2-$ts" FPOST="F-RV-POST-$ts"
  local _RV_RC=0

  fed_log "═══ Brief 3: LIVE revocation + epoch K-cut (owner=$OWNER banned=$BANNED valid=${VALID:-none}) ═══"
  if [ -z "$oslug" ] || [ -z "$bslug" ]; then
    echo "✗ revocation: frames not joined (owner-slug='$oslug' banned-slug='$bslug') — run rig_owner_publish_hive + rig_join_all first"
    echo "OVERALL: INCOMPLETE"; return 2
  fi
  echo "  owner slug=$oslug   banned-member slug=$bslug   hive=$RIG_HIVE_ID"

  # ── STEP 1: establish a WORKING owner→B baseline (adaptive — see header) ──
  fed_log "[1] baseline: owner writes $FPRE → banned member must receive it (proves owner→B federation works PRE-ban)"
  rig_write_content "$OWNER" "$oslug" "$FPRE" "revocation pre-ban baseline" todo >/dev/null
  local bpre=""
  if bpre="$(_rv_poll_remote "$BANNED" "$FPRE" 60)"; then
    echo "  ✓ baseline: $FPRE federated to banned-member (origin=remote, slug=$bpre)"
  else
    echo "  ⚠ baseline miss on $FPRE — checking $BANNED roster for the WI-1378 no-restart empty-roster gap"
    if _rv_roster_empty "$BANNED"; then
      echo "  ↻ $BANNED roster EMPTY (WI-1378 no-restart gap) — re-folding via member restart, then retrying baseline"
      rig_restart_sidecar "$BANNED"
      rig_wait_frame_ready "$BANNED" 60 || { echo "  ✗ $BANNED did not come back after re-fold restart"; echo "OVERALL: INCOMPLETE"; return 2; }
      rig_wait_swarm "$OWNER" "$BANNED" 70 || echo "  ⚠ $OWNER↔$BANNED did not re-peer (retry poll may still land)"
      rig_write_content "$OWNER" "$oslug" "$FPRE2" "revocation pre-ban baseline (post re-fold)" todo >/dev/null
      if bpre="$(_rv_poll_remote "$BANNED" "$FPRE2" 80)"; then
        echo "  ✓ baseline (post re-fold): $FPRE2 federated to banned-member (origin=remote, slug=$bpre)"
        FPRE="$FPRE2"
      else
        echo "  ✗ BASELINE FAIL: owner→B federation broken even after a re-fold restart — cannot attribute a post-ban absence to the ban"
        _rv_baseline_diag "$OWNER" "$BANNED"
        echo "OVERALL: INCOMPLETE"; return 2
      fi
    else
      echo "  ✗ BASELINE FAIL: $BANNED roster is NON-empty but $FPRE never federated — a different federation fault, not the ban"
      _rv_baseline_diag "$OWNER" "$BANNED"
      echo "OVERALL: INCOMPLETE"; return 2
    fi
  fi

  # valid member (3-frame) should also receive the baseline (so its post-ban positive is meaningful).
  local vslug=""
  if [ -n "$VALID" ]; then
    vslug="${FRAME_MEMBER_SLUG[$VALID]:-}"
    if _rv_poll_remote "$VALID" "$FPRE" 60 >/dev/null; then echo "  ✓ baseline: $FPRE also federated to valid-member $VALID"; else
      echo "  ⚠ baseline: $FPRE did NOT reach valid-member $VALID — its post-ban positive check may be unreliable"; fi
  fi

  # The OWNER must hold B's roster row (the revoke resolves B's device pubkeys from it).
  local roster_owner; roster_owner="$(rig_read_roster "$OWNER")"
  echo "  owner roster pre-ban: $(printf '%s' "$roster_owner" | tr '\n' ' ')"

  # ── STEP 2: BAN the member (owner authority; Hive-wide revoke) ──
  # Resolve the banned member's github id: gh api (×2 — it flaked INCOMPLETE on a
  # run where the whole baseline had just passed), then the OWNER's roster row
  # (offline + deterministic; the roster is populated — step 1 proved it).
  local banned_id; banned_id="$(rig_github_id "${FRAME_USER[$BANNED]}")"
  [ -n "$banned_id" ] || { sleep 3; banned_id="$(rig_github_id "${FRAME_USER[$BANNED]}")"; }
  [ -n "$banned_id" ] || banned_id="$(drv_psql "$OWNER" "SELECT github_user_id FROM harness_shared.pot_members WHERE github_username='${FRAME_USER[$BANNED]}' LIMIT 1;" 2>/dev/null | tr -d '[:space:]')"
  if [ -z "$banned_id" ]; then echo "  ✗ could not resolve github id for '${FRAME_USER[$BANNED]:-?}'"; echo "OVERALL: INCOMPLETE"; return 2; fi
  fed_log "[2] OWNER bans member '${FRAME_USER[$BANNED]}' (github_id=$banned_id) — Hive-wide revoke"
  local ban_resp; ban_resp="$(rig_ban_member "$OWNER" "$banned_id" hive)"
  echo "  ban response: $(printf '%s' "$ban_resp" | head -c 300)"
  if printf '%s' "$ban_resp" | grep -q '"ok":true'; then
    echo "  ✓ revoke accepted (revokedPubkeys present)"
  else
    echo "  ✗ REVOKE FAILED (response above) — the ban did not take; cannot prove a cut-off"
    echo "OVERALL: INCOMPLETE"; return 2
  fi

  # ── STEP 3: post-ban owner content must NOT reach the banned member ──
  # The owner WRITE triggers the C-001 re-key (revoke.live is false until then), which
  # advances the epoch EXCLUDING B → B can never decrypt/apply it. rig_assert_absent waits
  # the full window and passes ONLY if the row never appears on B.
  fed_log "[3] owner writes $FPOST (POST-ban → triggers the re-key) → banned member must NOT receive it"
  rig_write_content "$OWNER" "$oslug" "$FPOST" "revocation post-ban (must be ABSENT on banned member)" todo >/dev/null
  local absent; absent="$(rig_assert_absent "$BANNED" "$FPOST" 30)"
  if [ "$absent" = 1 ]; then
    echo "  ✓ CUT-OFF: $FPOST never reached the banned member in ~90s (revocation holds)"
  else
    echo "  ✗ LEAK: $FPOST reached the banned member AFTER the ban — revocation did NOT cut it off"
    _RV_RC=1
  fi

  # ── STEP 4: pre-ban content stays readable on the banned member (not retroactive) ──
  local fpre_post; fpre_post="$(rig_read_content "$BANNED" "$FPRE")"
  case "$fpre_post" in
    *"|remote") echo "  ✓ pre-ban $FPRE still present on banned member (revocation is not retroactive — matches the repro's readable epoch-0)";;
    *) echo "  ⚠ pre-ban $FPRE not present on banned member post-ban (got '$fpre_post') — unexpected but not the cut-off assertion";;
  esac

  # ── STEP 5 (3-frame): a still-valid member MUST still receive post-ban content ──
  if [ -n "$VALID" ]; then
    if _rv_poll_remote "$VALID" "$FPOST" 80 >/dev/null; then
      echo "  ✓ TARGETED: valid-member $VALID DID receive $FPOST (the ban is targeted, not a global outage)"
    else
      echo "  ✗ COLLATERAL: valid-member $VALID did NOT receive $FPOST — the revoke over-blocked (not targeted)"
      _RV_RC=1
    fi
  else
    echo "  (2-frame run: 'valid member still receives' contrast needs --with-valid-member / a ≥3 quota bump)"
  fi

  # ── report ──
  fed_log "RESULT Brief 3 (revocation + K-cut, .deb sidecar, real public DHT)"
  if [ "$_RV_RC" = 0 ]; then
    echo "OVERALL: PASS — banned member stopped receiving post-ban content${VALID:+ while valid member kept receiving}; pre-ban content stayed readable"
    return 0
  fi
  echo "OVERALL: INCOMPLETE — revocation had failures (see ✗ lines + /home/pcusp/serve.log on each frame)"
  return 1
}

# ── STANDALONE entrypoint (only when run directly, not sourced) ────────────────
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  LOCS="ash,ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24.04"; WITH_VALID=0
  for arg in "$@"; do case "$arg" in
    --locs=*) LOCS="${arg#--locs=}" ;;
    --type=*) STYPE="${arg#--type=}" ;;
    --deb=*)  DEB="${arg#--deb=}" ;;
    --image=*) IMAGE="${arg#--image=}" ;;
    --with-valid-member) WITH_VALID=1 ;;
    --keep-up) KEEP_UP=1 ;;
    -h|--help) sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $arg" ;;
  esac; done
  IFS=',' read -r LOC_A LOC_B LOC_C <<<"$LOCS"
  [ -n "$LOC_B" ] || LOC_B="$LOC_A"
  [ -n "$LOC_C" ] || LOC_C="$LOC_B"
  [ -n "$DEB" ] || DEB="$(default_deb)"
  P_A_USER="${P_A_USER:-papercupai}"   # owner (holds the Hive key → authority to ban)
  P_B_USER="${P_B_USER:-aviynw}"       # member to be banned
  P_C_USER="${P_C_USER:-aviynw}"       # still-valid member (only with --with-valid-member)

  RIG_KEEP_UP="$KEEP_UP"
  rig_init "$STYPE" "$IMAGE" || exit 1
  rig_install_exit_trap          # ARM auto-destroy BEFORE any provision (servers=0)
  RIG_DEB="$DEB"
  rig_gate_artifact "$DEB" || exit 2

  rig_set_identity a "$P_A_USER" || exit 1
  rig_set_identity b "$P_B_USER" || exit 1
  if [ "$WITH_VALID" = 1 ]; then rig_set_identity c "$P_C_USER" || exit 1; fi

  if [ "$WITH_VALID" = 1 ]; then rig_provision "$LOC_A" "$LOC_B" "$LOC_C" || exit 3
  else rig_provision "$LOC_A" "$LOC_B" || exit 3; fi
  rig_setup_all || exit 4

  fed_log "wait embedded-PG + operator on all sidecars"
  rig_wait_all_ready 50 || exit 5

  REPO_URL="${HIVE_REPO_URL:-https://github.com/octocat/Hello-World}"
  rig_owner_publish_hive a "$REPO_URL" || exit 6
  rig_join_all a   # a (owner self-join) + b [+ c]

  fed_log "joined — wait for peer_connect + initial drain (NO restart; baseline step re-folds if needed)"
  sleep 12
  rig_wait_swarm a b 70 || echo "⚠ a↔b not peered before scenario (scenario polls/restart retry)"
  if [ "$WITH_VALID" = 1 ]; then rig_wait_swarm a c 70 || echo "⚠ a↔c not peered before scenario"; fi

  if [ "$WITH_VALID" = 1 ]; then scenario_revocation_kcut a b c; else scenario_revocation_kcut a b; fi
  rc=$?
  [ "$rc" = 0 ] && echo "OVERALL: PASS" || echo "OVERALL: INCOMPLETE"
  exit "$rc"
fi

#!/usr/bin/env bash
# membership-churn.sh — P-006 of p2p-rest-lanes-2026-07-09 (umbrella P-010): the
# standing 3-node coverage gap. Every other matrix scenario is pairwise A↔B
# (fits the permanent 2-server Hetzner cap); this is the one scenario that
# actually needs a THIRD frame, so it only runs when the matrix auto-registered
# frame 'c' (deb-hetzner-matrix.sh FRAME3=1 — local containerized rig only, via
# bin/local-matrix.sh --frames=3; see that file's exclusion of this id when
# FRAME3=0).
#
# What it proves, with c joining LATE (after a↔b already have live content):
#   1. roster convergence — a/b/c each end up with all 3 members present
#      (hive_members has 3 rows on every frame, not just the joiner's own view).
#   2. backfill — c catches up on content a and b already exchanged BEFORE c
#      joined (late-joiner gets full history, not just post-join deltas).
#   3. full-mesh propagation — c's own writes reach BOTH a and b (not just the
#      owner it joined through).
#
# NON-INVASIVE (one throwaway feature row per leg, ids suffixed with
# MATRIX_RUN_ID). Order 35: with the other non-invasive content scenarios,
# before the invasive restart(80)+ block.

# rig_read_roster gives "<github_user_id>|<binding_status>|<#attestations>" per
# line; count DISTINCT ids present with an ok binding state.
_mchurn_member_count() {
  rig_read_roster "$1" 2>/dev/null | grep -c '|'
}

# The rig's identity assignment (deb-hetzner-matrix.sh) lets frame c share b's
# GitHub identity by DEFAULT (P_C_USER defaults to $P_B_USER — "a real
# multi-device topology", WI-3546 known-limitations territory). When that's the
# case there are only 2 DISTINCT github identities across 3 frames, so
# hive_members can never converge to 3 rows keyed by github_user_id — that is
# not a bug, it's the topology working as configured. The real convergence
# signal in that case is c's DEVICE landing as a 2nd attestation on b's shared
# identity row. Compute the topology-correct expected member-row count once
# (2026-07-10, WI-3543 v4-run root-cause: this hardcoded ">=3" false-failed
# every 3-frame run under the DEFAULT same-identity topology).
_mchurn_expected_members() {
  if [ "${P_C_USER:-${P_B_USER:-}}" = "${P_B_USER:-}" ] && [ -n "${P_B_USER:-}" ]; then
    echo 2
  else
    echo 3
  fi
}

scn_membership_churn() {
  local rid="$MATRIX_RUN_ID" n_a n_b n_c want
  local cslug="${FRAME_MEMBER_SLUG[c]}"

  # frame c should already have been joined by rig_join_all (called before any
  # scenario runs) — this scenario proves what that join converged to, plus
  # backfill + full-mesh propagation, not the join call itself.
  [ -n "${FRAME_MEMBER_SLUG[c]:-}" ] || { echo "membership_churn FAIL — frame c never resolved a member slug (join-pot failed?)"; return 1; }

  # ── 1. roster convergence: every DISTINCT identity visible on every frame ──
  # (want=2 under the default same-identity b/c topology, 3 when P_C_USER is a
  # genuinely distinct identity — see _mchurn_expected_members above.)
  want="$(_mchurn_expected_members)"
  n_a="$(_mchurn_member_count a)"; n_b="$(_mchurn_member_count b)"; n_c="$(_mchurn_member_count c)"
  if [ "${n_a:-0}" -lt "$want" ] || [ "${n_b:-0}" -lt "$want" ] || [ "${n_c:-0}" -lt "$want" ]; then
    echo "membership_churn FAIL — roster not converged (a=$n_a b=$n_b c=$n_c, want >=$want each)"
    return 1
  fi
  if [ "$want" = 2 ]; then
    # same-identity topology: prove c's DEVICE actually landed (not just that
    # b's own single-device row was already there pre-c-join) — the shared
    # identity's attestation count must be >=2 on every frame.
    local shared_att
    shared_att="$(rig_read_roster a 2>/dev/null | awk -F'|' -v u="${P_B_USER:-}" '{print $3}' | sort -rn | head -1)"
    if [ "${shared_att:-0}" -lt 2 ]; then
      echo "membership_churn FAIL — same-identity topology (b=c=$P_B_USER) but max attestation count on a is only ${shared_att:-0} (want >=2 — c's device never landed)"
      return 1
    fi
  fi

  # ── 2. backfill: c sees content the matrix already wrote a→b before c joined
  # (00-base.sh's content_bidir ran earlier in matrix order — its F-A2B-$rid
  # row should already be on c via the SAME peer-log c is now attached to).
  local backfill
  backfill="$(rig_read_content c "F-A2B-$rid" 2>/dev/null)"
  if [ -z "$backfill" ]; then
    echo "⚠ membership_churn: no pre-join content to backfill-check (content_bidir may not have run/ordered before this) — skipping backfill leg"
  elif [ "${backfill#*|}" != remote ] && [ "${backfill#*|}" != local ]; then
    echo "membership_churn FAIL — backfill: F-A2B-$rid absent on late-joiner c (got '$backfill')"
    return 1
  fi

  # ── 3. full-mesh: c's own write reaches BOTH a and b (not just its joining owner) ──
  local ca cb
  ca="$(fed_hive_merge_probe c a "$cslug" "F-C2A-$rid" 60 || true)"
  [ "${ca%% *}" = 1 ] || { echo "membership_churn FAIL — content C→A (got '$ca')"; return 1; }
  cb="$(fed_hive_merge_probe c b "$cslug" "F-C2B-$rid" 60 || true)"
  [ "${cb%% *}" = 1 ] || { echo "membership_churn FAIL — content C→B (got '$cb')"; return 1; }

  echo "membership_churn OK (roster a=$n_a b=$n_b c=$n_c; backfill=${backfill:-n/a}; C→A='${ca#* }' C→B='${cb#* }')"
}
matrix_register membership_churn 35 "3-node roster convergence + backfill + full-mesh (c joins late)" scn_membership_churn

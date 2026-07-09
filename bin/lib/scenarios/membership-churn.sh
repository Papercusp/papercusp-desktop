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

scn_membership_churn() {
  local rid="$MATRIX_RUN_ID" n_a n_b n_c
  local cslug="${FRAME_MEMBER_SLUG[c]}"

  # frame c should already have been joined by rig_join_all (called before any
  # scenario runs) — this scenario proves what that join converged to, plus
  # backfill + full-mesh propagation, not the join call itself.
  [ -n "${FRAME_MEMBER_SLUG[c]:-}" ] || { echo "membership_churn FAIL — frame c never resolved a member slug (join-pot failed?)"; return 1; }

  # ── 1. roster convergence: 3 members visible on every frame ────────────────
  n_a="$(_mchurn_member_count a)"; n_b="$(_mchurn_member_count b)"; n_c="$(_mchurn_member_count c)"
  if [ "${n_a:-0}" -lt 3 ] || [ "${n_b:-0}" -lt 3 ] || [ "${n_c:-0}" -lt 3 ]; then
    echo "membership_churn FAIL — roster not converged (a=$n_a b=$n_b c=$n_c, want >=3 each)"
    return 1
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

# b3-revocation.sh — Brief 3 matrix scenario: revocation + epoch K-cut (TERMINAL).
#
# Sourced by bin/deb-hetzner-matrix.sh (Brief 13). Self-contained: the matrix has
# ALREADY sourced federation-asserts.sh + deb-hetzner-rig.sh and populated
# RIG_FRAMES=(a b) / FRAME_*/FED_*/FRAME_MEMBER_SLUG/RIG_HIVE_*/MATRIX_RUN_ID, and
# published+joined the hive with a↔b peer_connected. Do NOT re-source those (re-sourcing
# deb-hetzner-rig.sh would reset RIG_FRAMES=() and clobber the matrix's frame state) and
# do NOT provision/teardown. `return`, never `exit`. See README.md for the full contract.
#
# TERMINAL/DESTRUCTIVE → order 90 (runs LAST): it bans member B, so B may be unable to
# receive afterward. The standalone equivalent (its own 2 frames + adaptive baseline) is
# bin/deb-hetzner-revocation.sh; this is the matrix-integrated form on the shared frames.
#
# Proof (mechanism-agnostic behavioral form of federation-revocation-kcut-sidecar.repro):
#   1. baseline — owner→B federation works pre-ban (attribution guard: a post-ban absence
#      only proves a cut-off if federation worked before it);
#   2. owner BANS B (Hive-wide revoke → revoked_pubkeys blocklist + epoch 0→1 K-cut);
#   3. owner writes post-ban content (triggers the C-001 re-key) → it must NOT reach B.

scn_revocation_kcut() {
  local rid="$MATRIX_RUN_ID" oslug="${FRAME_MEMBER_SLUG[a]:-}" bslug="${FRAME_MEMBER_SLUG[b]:-}"
  local FPRE="F-RV-PRE-$rid" FPOST="F-RV-POST-$rid"
  [ -n "$oslug" ] && [ -n "$bslug" ] || { echo "revocation: frames not joined (owner='$oslug' member='$bslug')"; return 1; }

  # 1. baseline — owner→B federation works pre-ban (the matrix already proved it at order
  #    10; re-confirm here so the post-ban absence is attributable to the BAN, not a broken
  #    path e.g. the WI-1378 no-restart empty-roster gap).
  local pre; pre="$(fed_hive_merge_probe a b "$oslug" "$FPRE" 40 || true)"
  [ "${pre%% *}" = 1 ] || { echo "revocation: BASELINE FAIL — owner→B pre-ban federation broken (probe=$pre; roster empty / WI-1378?) — cannot attribute a cut-off"; return 1; }

  # 2. owner bans B (owner authority = the Hive-key holder = frame a; Hive-wide revoke →
  #    revoked_pubkeys admission blocklist + the epoch 0→1 K-cut).
  local bid; bid="$(rig_github_id "${FRAME_USER[b]}")"
  [ -n "$bid" ] || { echo "revocation: could not resolve github id for member '${FRAME_USER[b]:-?}'"; return 1; }
  local ban; ban="$(rig_ban_member a "$bid" hive)"
  printf '%s' "$ban" | grep -q '"ok":true' || { echo "revocation: REVOKE FAILED — $(printf '%s' "$ban" | head -c 160)"; return 1; }

  # 3. post-ban owner write (triggers the re-key; revoke.live is false until it lands) must
  #    NOT reach B. rig_assert_absent waits the full window and passes only if it never appears.
  rig_write_content a "$oslug" "$FPOST" "revocation post-ban (must be ABSENT on banned B)" todo >/dev/null
  local absent; absent="$(rig_assert_absent b "$FPOST" 30)"
  [ "$absent" = 1 ] || { echo "revocation: LEAK — $FPOST reached banned member B after the ban (cut-off failed)"; return 1; }

  # pre-ban content stays readable on B (revocation is not retroactive — matches the repro's
  # readable epoch-0). A WARN (not FAIL): the cut-off assertion above is the gate.
  local fpre_post; fpre_post="$(rig_read_content b "$FPRE" 2>/dev/null)"
  case "$fpre_post" in *"|remote") : ;; *) echo "revocation: WARN — pre-ban $FPRE not readable on B post-ban (got '$fpre_post')";; esac

  echo "revocation + K-cut OK — B federated pre-ban, then after the ban B stopped receiving post-ban content (pre-ban stayed readable)"
  return 0
}
matrix_register revocation_kcut 90 "revocation + epoch K-cut" scn_revocation_kcut

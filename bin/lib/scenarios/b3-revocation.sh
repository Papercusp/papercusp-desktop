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
  #    path). NOTE (EI-15535): this is a CONTENT probe (harness_features_consolidated),
  #    NOT the hive_members/roster path WI-1378 fixed — a "WI-1378?" guess in this message
  #    is a red herring for THIS probe. Cross-run evidence (EI-15535, WI-5481, WI-5448)
  #    instead shows this baseline reliably fails whenever order-87 replication_soak just
  #    failed a few scenarios earlier: the soak's sustained 5x-restart churn leaves
  #    federation genuinely stalled (WI-183-class) and it has not recovered by the time
  #    this order-90 scenario runs. Surface THAT correlation instead of misattributing to
  #    WI-1378, so a reader doesn't file a fresh "is this a WI-1378 regression?" bug again
  #    (SCN_RC is the matrix runner's global result table — populated for every
  #    already-run scenario id since scenarios run in-process in order; guarded with a
  #    default for standalone/--only invocations where it may be unset under `set -u`).
  local pre; pre="$(fed_hive_merge_probe a b "$oslug" "$FPRE" 40 || true)"
  if [ "${pre%% *}" != 1 ]; then
    local hint="mechanism unconfirmed — this is a content probe, not the WI-1378 roster path; check order-87 replication_soak + WI-5481/WI-5448 (known WI-183-class sustained-restart stall) before assuming a fresh regression"
    if [ "${SCN_RC[replication_soak]:-0}" -ne 0 ]; then
      hint="order-87 replication_soak FAILED earlier this run (rc=${SCN_RC[replication_soak]}) — this is almost certainly the SAME downstream WI-183-class stall (see WI-5481/WI-5448), not a fresh regression or a WI-1378 roster issue"
    fi
    echo "revocation: BASELINE FAIL — owner→B pre-ban federation broken (probe=$pre; $hint) — cannot attribute a cut-off"
    return 1
  fi

  # 2. owner bans B (owner authority = the Hive-key holder = frame a; Hive-wide revoke →
  #    revoked_pubkeys admission blocklist + the epoch 0→1 K-cut).
  local bid; bid="$(rig_github_id "${FRAME_USER[b]}")"
  [ -n "$bid" ] || { echo "revocation: could not resolve github id for member '${FRAME_USER[b]:-?}'"; return 1; }
  local ban; ban="$(rig_ban_member a "$bid" hive)"
  printf '%s' "$ban" | grep -q '"ok":true' || { echo "revocation: REVOKE FAILED — $(printf '%s' "$ban" | head -c 160)"; return 1; }

  # EI-18712383368117845: SURFACE revoke.live. The revoke response carries {ok,revokedPubkeys,live}
  # and `live` is THE diagnostic for this leg — true = the epoch advance applied a real read cut,
  # false = PG-only write-plane block with no read cut-off, so a LEAK below is EXPECTED rather than
  # mysterious. It was being captured into $ban and discarded (only "ok":true was grepped), which
  # is why 5 FAIL / 1 PASS gave no way to tell "the cut-off ran and lost a race" from "no cut-off
  # ever applied". Diagnostic only — the assertion below is deliberately UNCHANGED.
  local rvlive; rvlive="$(printf '%s' "$ban" | grep -oE '"live":[a-z]+' | head -1)"
  echo "  · revocation: revoke.live=${rvlive:-ABSENT} (true ⇒ real read cut applied; false/ABSENT ⇒ write-plane block only)"

  # 3. post-ban owner write (triggers the re-key; revoke.live is false until it lands) must
  #    NOT reach B. rig_assert_absent waits the full window and passes only if it never appears.
  rig_write_content a "$oslug" "$FPOST" "revocation post-ban (must be ABSENT on banned B)" todo >/dev/null
  local absent; absent="$(rig_assert_absent b "$FPOST" 30)"
  if [ "$absent" != 1 ]; then
    # EI-18712383368117845: on a LEAK, also record whether B can actually READ the leaked content.
    # rig_assert_absent only proves the row reached B's consolidated table; this distinguishes a
    # plaintext disclosure from replicated-but-undecryptable bytes, which is what sets the real
    # severity. Diagnostic only — the FAIL verdict is unchanged either way.
    local leaked; leaked="$(rig_read_content b "$FPOST" 2>/dev/null)"
    echo "  · revocation: LEAK detail — revoke.live=${rvlive:-ABSENT}; B read of $FPOST => '${leaked:-<unreadable>}' (a '*|remote' value = READABLE plaintext disclosure)"
    echo "revocation: LEAK — $FPOST reached banned member B after the ban (cut-off failed)"
    return 1
  fi

  # pre-ban content stays readable on B (revocation is not retroactive — matches the repro's
  # readable epoch-0). A WARN (not FAIL): the cut-off assertion above is the gate.
  local fpre_post; fpre_post="$(rig_read_content b "$FPRE" 2>/dev/null)"
  case "$fpre_post" in *"|remote") : ;; *) echo "revocation: WARN — pre-ban $FPRE not readable on B post-ban (got '$fpre_post')";; esac

  echo "revocation + K-cut OK — B federated pre-ban, then after the ban B stopped receiving post-ban content (pre-ban stayed readable)"
  return 0
}
matrix_register revocation_kcut 90 "revocation + epoch K-cut" scn_revocation_kcut

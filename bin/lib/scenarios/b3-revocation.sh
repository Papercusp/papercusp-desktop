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

  # WI-6043: OPTIONAL ban→write gap, for discriminating the two live leak hypotheses.
  #
  # WHY THIS KNOB EXISTS. hive-epoch-state.ts:50-58 documents a v1 scope gap: a producer that
  # advances the epoch (member-ban) and then writes post-boundary content while a DIFFERENT
  # process still holds a cached pre-boundary epoch (EPOCH_CACHE_TTL_MS = 5000,
  # hive-epoch-op-gate.ts:160-169) re-uses the STALE epoch — and at the 0→1 boundary that hits
  # the epoch === BASELINE_EPOCH plaintext bypass and federates post-ban content UNENCRYPTED to
  # the member just revoked. If that TTL is the mechanism, delaying the write past 5s must make
  # the leak disappear; if the leak persists across the delay, the TTL story is dead and the
  # "epoch never armed at all" branch leads instead.
  #
  # NOTE the gap is ~0s by default: the ban above and the write below are adjacent with only a
  # grep+echo between them. So the "<5s" arm of that experiment is what EVERY run already does
  # and is not forceable — which is itself evidence, because a gap-only mechanism would then
  # predict a ~100% leak rate rather than the intermittency actually observed. Only the >5s arm
  # carries new information, which is what this knob buys.
  #
  # DEFAULT IS UNSET ⇒ ZERO behaviour change: the gate, and every existing run, take the exact
  # path they took before. This is deliberately a defaulted knob and not a hardcoded sleep, so
  # it can live in the tree permanently without ever slowing or altering the real gate.
  if [ -n "${RIG_REVOKE_WRITE_DELAY_SEC:-}" ]; then
    echo "  · revocation: RIG_REVOKE_WRITE_DELAY_SEC=$RIG_REVOKE_WRITE_DELAY_SEC — delaying post-ban write to probe the epoch-cache TTL window (WI-6043)"
    sleep "$RIG_REVOKE_WRITE_DELAY_SEC"
  fi

  # 3. post-ban owner write (triggers the re-key; revoke.live is false until it lands) must
  #    NOT reach B. rig_assert_absent waits the full window and passes only if it never appears.
  rig_write_content a "$oslug" "$FPOST" "revocation post-ban (must be ABSENT on banned B)" todo >/dev/null
  local absent; absent="$(rig_assert_absent b "$FPOST" 30)"

  # WI-560 K-CUT CRYPTO WITNESS (diagnostic — the assertion above is deliberately UNCHANGED).
  #
  # The pass/fail leg of this scenario is BEHAVIORAL and self-describes as "mechanism-agnostic"
  # (header line 14): it proves post-ban content did not REACH B. That is a real cut, but it is
  # a row-arrival fact — rig_assert_absent checks B's consolidated table, so a write-plane
  # admission block (revoked_pubkeys) satisfies it identically to a cryptographic key cut. It
  # therefore cannot distinguish "B held epoch N and was cut off at N+1" (the K-CUT WI-560 asks
  # to witness) from "B never held a key at all", and it never queries an epoch-key table.
  #
  # These two dumps close that gap by capturing the K-sequence on BOTH sides at the one moment
  # it is decidable — after the ban's re-key has landed, before teardown destroys the frames:
  #   owner (a): epoch N wrapped to BOTH devices, epoch N+1 wrapped to the REMAINING device only
  #              ⇒ the owner-side cut. (The 20260726-213733 run already showed the epoch-0 half.)
  #   joiner (b): its OWN rows — epoch N present, epoch N+1 ABSENT ⇒ the live B-side K-CUT.
  # Deliberately dumped rather than asserted: B-side receipt has never been measured on any rig,
  # so asserting a shape nobody has observed would red a shared gate on a prediction. Measure
  # first; the assertion lands once the real shape is known. Non-fatal by construction.
  echo "  · WI-560 K-CUT witness — pot_epoch_keys AFTER ban+re-key (expect: owner has N+1 for remaining device only; B has N but NOT N+1)"
  # EVERY line below MUST carry the `·` marker. The matrix runner surfaces a PASSING
  # scenario's output by grepping `^[[:space:]]*·` (deb-hetzner-matrix.sh:351, WI-6057) and
  # then DESTROYS $RIG_WORK/scn.<id>.log at teardown unless --keep-up. So an unmarked
  # diagnostic line is discarded on exactly the runs that need it — a PASS — and is then
  # unrecoverable. Verified the hard way on run m1785118654: this block's header (marked)
  # printed while the psql rows (unmarked, indented with spaces) vanished entirely, which
  # looked identical to the dump never having run. Marking each row via sed is what makes
  # the evidence survive; do not "tidy" these into plain indentation.
  #
  # No `|| echo "dump failed"` fallback: piping into sed makes the pipeline's exit status
  # sed's, never drv_psql's, so such a guard could never fire. `2>&1` is the real mechanism —
  # a psql/transport error is captured and printed inline as a marked line instead.
  echo "  · WI-560 K-CUT — frame a (owner, wrap record):"
  drv_psql a "SELECT harness_slug, epoch, member_device_pubkey, origin FROM harness_shared.pot_epoch_keys ORDER BY epoch, member_device_pubkey;" 2>&1 | sed 's/^/  ·   a: /'
  echo "  · WI-560 K-CUT — frame b (banned joiner, own view):"
  drv_psql b "SELECT harness_slug, epoch, member_device_pubkey, origin FROM harness_shared.pot_epoch_keys ORDER BY epoch, member_device_pubkey;" 2>&1 | sed 's/^/  ·   b: /'

  # ── WI-560 K-CUT ASSERTION (the CRYPTO form; the content assert below is the behavioral one) ──
  #
  # WI-560 asks to witness: B has epoch N but NOT epoch N+1 — "its machine never gets the new key".
  # Measured live on run m1785119xxx, and the OBVIOUS form of this assert would have been WRONG:
  #
  #   epoch 0 → owner wraps to BOTH devices; B holds both, origin=remote
  #   epoch 1 → owner wraps to the REMAINING device ONLY (K-cut on the owner side)
  #   ...but B STILL RECEIVES the epoch-1 ROW, origin=remote — wrapped to the OWNER's pubkey.
  #
  # So "B has no epoch-N+1 row" is FALSE and asserting it would red this gate on correct behavior.
  # Revocation is a DECRYPT cut, not a replication cut, for this table: the row that reaches B is
  # a blob sealed to a key B does not hold. The true invariant is DEVICE-SCOPED —
  #   *** no epoch-key row wrapped to B'S OWN device pubkey exists at the post-ban epoch ***
  # — which is exactly what makes B unable to read post-ban content, and is what we assert.
  #
  # Fail-closed on VACUITY: if the epoch never advanced (max epoch still 0) there was no re-key to
  # cut, so a device-scoped absence would pass trivially and prove nothing — the exact
  # "a probe that cannot fail is not a probe" trap this file's rig_assert_* helpers were rewritten
  # for (WI-5768). We therefore require maxep>=1 and FAIL loudly if it did not advance. Likewise a
  # blank pubkey means the identity lookup failed, not that the cut held — also a FAIL, never a pass.
  local bpub maxep
  bpub="$(drv_psql b "SELECT jsonb_array_elements(device_attestations::jsonb)->>'device_pubkey' FROM harness_shared.pot_members WHERE github_username='${FRAME_USER[b]}' LIMIT 1;" 2>/dev/null | head -1 | tr -d '[:space:]')"
  maxep="$(drv_psql a "SELECT COALESCE(MAX(epoch),0) FROM harness_shared.pot_epoch_keys;" 2>/dev/null | head -1 | tr -d '[:space:]')"
  echo "  · WI-560 K-CUT assert — B device=${bpub:-<UNRESOLVED>} post-ban maxEpoch=${maxep:-<UNRESOLVED>}"
  if [ -z "$bpub" ]; then
    echo "revocation: K-CUT UNMEASURED — could not resolve B's device pubkey (identity lookup failed); an unmeasurable probe is not a pass"; return 1
  fi
  case "${maxep:-}" in
    ''|*[!0-9]*) echo "revocation: K-CUT UNMEASURED — could not read max epoch on the owner ('${maxep:-}'); not a pass"; return 1 ;;
  esac
  if [ "$maxep" -lt 1 ]; then
    echo "revocation: K-CUT VACUOUS — epoch never advanced past 0, so there was no re-key to cut (papercusp-hive-rekey not armed? see rig_arm_hive_rekey); refusing to pass a probe that cannot fail"; return 1
  fi
  local kcut; kcut="$(rig_assert_row_absent b "harness_shared.pot_epoch_keys WHERE epoch=$maxep AND member_device_pubkey='$bpub'" 12)"
  if [ "$kcut" != 1 ]; then
    echo "revocation: K-CUT FAILED — banned member B still holds an epoch-$maxep key wrapped to its OWN device ($bpub); the re-key did not cut it off"; return 1
  fi
  echo "  · WI-560 K-CUT VERIFIED — B holds NO epoch-$maxep key for its own device (pre-ban epochs retained; the epoch-$maxep row B did receive is sealed to the owner's device, unreadable by B)"

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

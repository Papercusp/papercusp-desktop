# b9-attestation.sh — P-413 residual (WI-5779) matrix scenario: attestation +
# refused-op-counter witness across a GENUINE second frame.
#
# Sourced by bin/deb-hetzner-matrix.sh (also reached via bin/local-matrix.sh's BYO-frames
# exec). Self-contained: the matrix has ALREADY sourced federation-asserts.sh +
# deb-hetzner-rig.sh and populated RIG_FRAMES=(a b) / FRAME_*/FED_*/FRAME_MEMBER_SLUG/
# RIG_HIVE_*/MATRIX_RUN_ID, and published+joined the hive with a↔b peer_connected. Do NOT
# re-source those and do NOT provision/teardown. `return`, never `exit`. See README.md.
#
# WHY THIS SCENARIO EXISTS (WI-5766/P-413 finding, 2026-07-25): every attestation/
# refused-op-counter witness ever run (WI-5136, WI-1730's closure, the ATTESTATION_PROBE
# rider on two-instance-hive-from-repo-smoke.sh) is SAME-BOX — both HIVE_SMOKE_MODE=deb
# and =sidecar run two isolated instances on ONE machine (loopback + testnet DHT, isolated
# HOMEs/ports). local-matrix.sh's docker-frame rig (pcusp-rig-a / pcusp-rig-b, or the real
# Hetzner BYO frames) is the only vehicle in this repo with a genuine container/machine
# boundary between the two identities, and it had ZERO attestation coverage. This file
# ports the ATTESTATION_PROBE legs from two-instance-hive-from-repo-smoke.sh onto that
# real boundary, using the matrix's own MCP-over-SSH pattern (fleet-directory.sh's
# `_fdir_mcp_call` precedent) instead of a same-box curl to 127.0.0.1.
#
# TWO scenarios, split by the order convention (see README "Order convention"):
#   attestation_membership (60) — LEG1 membership seeding + LEG2 second-device merge +
#     LEG3 wrong-gh-user-id refused-op. All three are ADDITIVE (approve a pending join,
#     union a 2nd device, insert one throwaway mis-attributed receipt that gets refused)
#     and leave both frames HEALTHY for downstream scenarios — safe in the 10-70 band.
#   attestation_unattested_device (91) — LEG4 unattested-device refused-op. TERMINAL: it
#     permanently STRIPS member B's device_attestations on frame a (simulating an author
#     device that resolves to no member) to trigger 'identity_unresolved'. This mutates
#     admission-relevant state for the rest of the run, so — like revocation_kcut(90) — it
#     is registered to run LAST (order ≥90), never before restart_durability/
#     reconnect_catchup/replication_soak/revocation_kcut. It also needs a real 35s sleep
#     to wait out the receiver's comms-tier device→user cache TTL (PAPERCUSP_COMMS_TIER_
#     CACHE_MS, default 30_000ms) — acceptable at the very end of a run, not mid-matrix.
#
# LANDING NOTE (do NOT skip): bin/deb-hetzner-matrix.sh sources every bin/lib/scenarios/*.sh
# unconditionally, so dropping this file into that directory makes it part of EVERY future
# full matrix run, including the standing hourly release gate (P-402/P-405). Land it only
# once the current in-flight gate run (P-402 first-green push, 2026-07-25) has completed —
# an untested new scenario landing mid-verification risks turning a hard-won genuine green
# into a red for an unrelated reason. `bash -n` this file and confirm registration via
# `bin/deb-hetzner-matrix.sh --list` (free, no provision) before moving it into place.

# Bounded on-frame MCP tools/call as the pcusp user (fleet-directory.sh's _fdir_mcp_call
# precedent: sidecar superuser bearer from ~/.papercusp/superuser-token, streamable-HTTP
# single-shot, workspace resolved via rig_resolve_ws so the call hits the right partition).
_att_mcp_call() {
  local inst="$1" tool="$2" args="$3" ws
  if ! ws="$(rig_resolve_ws "$inst")"; then
    echo '{"isError":true,"error":"MCP_ERROR: could not resolve a real workspace_id for the mcp call (D-050/WI-5399 class)"}'
    return 1
  fi
  rig_pcusp_run "$inst" <<EOS
f="\$HOME/.papercusp/superuser-token"
[ -s "\$f" ] || { mkdir -p "\$HOME/.papercusp"; head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40 > "\$f"; chmod 600 "\$f"; }
TOK="\$(cat "\$f" 2>/dev/null)"
if [ -z "\$TOK" ]; then echo "ATT_NO_TOKEN"; exit 1; fi
curl -s -m 60 -X POST "http://127.0.0.1:${FED_SC[$inst]}/api/mcp?superuser=1&client=mx-attestation&workspace=${ws}" \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H "authorization: Bearer \$TOK" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"${tool}","arguments":${args}}}'
EOS
}

# ── attestation_membership (60): LEG1 seeding + LEG2 2nd-device + LEG3 wrong-gh refusal ──
scn_attestation_membership() {
  local rid="$MATRIX_RUN_ID" oslug="${FRAME_MEMBER_SLUG[a]:-}" mslug="${FRAME_MEMBER_SLUG[b]:-}"
  [ -n "$oslug" ] && [ -n "$mslug" ] || { echo "attestation: frames not joined (owner='$oslug' member='$mslug')"; return 1; }
  [ -n "${RIG_HIVE_ID:-}" ] || { echo "attestation FAIL — RIG_HIVE_ID unset (hive not published?)"; return 1; }

  local ws b_gh_id a_gh_id
  ws="$(rig_resolve_ws a)" || { echo "attestation FAIL — could not resolve workspace_id on frame a"; return 1; }
  b_gh_id="$(rig_github_id "${FRAME_USER[b]}")"
  a_gh_id="$(rig_github_id "${FRAME_USER[a]}")"
  [ -n "$b_gh_id" ] || { echo "attestation FAIL — could not resolve github id for member '${FRAME_USER[b]:-?}'"; return 1; }

  # (setup) Approve B if the join left a pending row (approval-mode rigs) — idempotent
  # no-op if B is already an admitted member with a device row.
  _att_mcp_call a "pot:membership_decide" "{\"pot\":\"$RIG_HIVE_ID\",\"githubUserId\":$b_gh_id,\"decision\":\"approve\"}" >/dev/null
  sleep 4

  # ── LEG1 — MEMBERSHIP SEEDING: A attests B (≥1 device on A's row) AND B's own roster
  # seeds the owner as origin='remote' (the WI-1585 VM-half symptom was an EMPTY B roster
  # — this is the "genuine second frame" version of that same assert).
  local a_bdev
  a_bdev="$(drv_psql a "SELECT jsonb_array_length(device_attestations) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" 2>/dev/null | tr -d '[:space:]')"
  { [ -n "$a_bdev" ] && [ "$a_bdev" -ge 1 ]; } 2>/dev/null || { echo "attestation FAIL — LEG1a A does not attest B across the container boundary (B devices on A=$a_bdev)"; return 1; }
  local b_seed=0 i
  for i in $(seq 1 20); do
    b_seed="$(drv_psql b "SELECT count(*) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND origin='remote';" 2>/dev/null | tr -d '[:space:]')"
    { [ -n "$b_seed" ] && [ "$b_seed" -ge 1 ]; } 2>/dev/null && break
    sleep 3
  done
  { [ -n "$b_seed" ] && [ "$b_seed" -ge 1 ]; } 2>/dev/null || { echo "attestation FAIL — LEG1b B's roster never seeded owner origin=remote across the container boundary (remote members=$b_seed — WI-1585 VM-half empty-roster class)"; return 1; }

  # ── LEG2 — SECOND-DEVICE MERGE (union by device_pubkey, no clobber — WI-1585 leg-A) ──
  local d1 d2 n_before n_after has_d1 has_d2 now_ms
  d1="$(drv_psql a "SELECT (device_attestations->0->>'device_pubkey') FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" 2>/dev/null | tr -d '[:space:]')"
  d2="att2dev-${rid}-$RANDOM"
  n_before="$a_bdev"
  now_ms="$(date +%s)000"
  drv_psql a "INSERT INTO harness_shared.pot_pending_joins (workspace_id,harness_slug,github_user_id,github_username,device_attestations,status,requested_at,created_at,updated_at) VALUES ('$ws','$RIG_HIVE_ID',$b_gh_id,'${FRAME_USER[b]}','[{\"device_pubkey\":\"$d2\",\"gist_id\":\"att-2dev-probe-$rid\",\"gist_url\":\"\",\"device_label\":\"${FRAME_USER[b]}-dev2\",\"created_at\":$now_ms,\"signature_by_device\":\"\"}]'::jsonb,'pending',$now_ms,$now_ms,$now_ms) ON CONFLICT (workspace_id,harness_slug,github_user_id) DO UPDATE SET device_attestations=EXCLUDED.device_attestations,status='pending',updated_at=EXCLUDED.updated_at;" >/dev/null 2>&1
  _att_mcp_call a "pot:membership_decide" "{\"pot\":\"$RIG_HIVE_ID\",\"githubUserId\":$b_gh_id,\"decision\":\"approve\"}" >/dev/null
  sleep 3
  n_after="$(drv_psql a "SELECT jsonb_array_length(device_attestations) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" 2>/dev/null | tr -d '[:space:]')"
  has_d1=1
  [ -n "$d1" ] && has_d1="$(drv_psql a "SELECT count(*) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id AND device_attestations @> jsonb_build_array(jsonb_build_object('device_pubkey','$d1'));" 2>/dev/null | tr -d '[:space:]')"
  has_d2="$(drv_psql a "SELECT count(*) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id AND device_attestations @> jsonb_build_array(jsonb_build_object('device_pubkey','$d2'));" 2>/dev/null | tr -d '[:space:]')"
  { [ -n "$n_after" ] && [ "$n_after" -ge 2 ] && [ "$has_d1" = 1 ] && [ "$has_d2" = 1 ]; } 2>/dev/null || { echo "attestation FAIL — LEG2 second-device merge across the container boundary (devices $n_before→$n_after; D1 kept=$has_d1 D2 added=$has_d2 — WI-1585 leg-A clobber?)"; return 1; }

  # ── LEG3 — WRONG-GH-USER-ID refused-op counter (non-destructive: one throwaway receipt
  # that MUST be refused, never applied) ──
  local rc_before rc_after rid_wrong rid_on_a rc_after_measured
  # WI-5788 (P-411 residual): an UNMEASURED baseline must FAIL, never coerce to 0. An empty
  # read here means the probe never ran (frame a down, psql refused, wrong DSN) — it does NOT
  # mean "the counter is 0". Coercing it to 0 made ANY later nonzero reading satisfy
  # `rc_after -gt rc_before`, so this leg could report PASS on a run where its own refusal
  # never fired and the counter had simply been nonzero all along. Same shape as
  # rig_assert_absent (bin/lib/deb-hetzner-rig.sh): score UNMEASURED as FAIL.
  rc_before="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:responder_mismatch';" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$rc_before" ] || { echo "attestation FAIL — LEG3 baseline UNMEASURED: the responder_mismatch counter probe on frame a returned nothing, so 'counter is 0' and 'probe never ran' are indistinguishable; refusing to score this leg"; return 1; }
  rid_wrong="att-wrong-${rid}-$RANDOM"; now_ms="$(date +%s)000"
  drv_psql b "INSERT INTO harness_shared.p2p_receipts (workspace_id,harness_slug,receipt_id,kind,action,detail,responder_github_user_id,receipt_ts,origin) VALUES ('$ws','$RIG_HIVE_ID','$rid_wrong','refusal','work-offer:claim','att wrong-gh probe ($rid)',${a_gh_id:-999999999},$now_ms,'local');" >/dev/null 2>&1
  # WI-6046: record whether the probe actually landed on b — DIAGNOSTIC ONLY (see the LEG4
  # note below for why this must not hard-fail: a federated receipt may legitimately leave b).
  # Surfaced in the scoring message so a silently-failed INSERT stops reading as "the feature
  # did not bump the counter".
  local wrong_on_b
  wrong_on_b="$(drv_psql b "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_wrong';" 2>/dev/null | tr -d '[:space:]')"
  rc_after=""; rc_after_measured=0
  for i in $(seq 1 40); do
    rc_after="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:responder_mismatch';" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$rc_after" ]; then
      rc_after_measured=1
      { [ "$rc_after" -gt "$rc_before" ]; } 2>/dev/null && break
    fi
    sleep 3
  done
  # A poll that NEVER got a reading is a dead probe, not "no bump" — distinguish them so the
  # failure message names the real fault instead of blaming the feature under test.
  [ "$rc_after_measured" = 1 ] || { echo "attestation FAIL — LEG3 post-probe UNMEASURED: all 40 responder_mismatch reads on frame a returned empty (the probe never ran — this is NOT evidence the counter failed to bump)"; return 1; }
  rid_on_a="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_wrong';" 2>/dev/null | tr -d '[:space:]')"
  { [ "$rc_after" -gt "$rc_before" ] && [ "$rid_on_a" = 0 ]; } 2>/dev/null || { echo "attestation FAIL — LEG3 wrong-gh-user refused-op across the container boundary (responder_mismatch $rc_before→$rc_after, row-on-a=$rid_on_a, probe-on-b=${wrong_on_b:-<unmeasured>} [WI-6046: probe-on-b=0/<unmeasured> means the probe receipt may never have been emitted — suspect the rig, not the feature])"; return 1; }

  echo "attestation OK on a GENUINE second frame (container boundary, not same-box): LEG1 A attests B + B roster seeded origin=remote, LEG2 second-device merge no-clobber, LEG3 wrong-gh-user refused-op counter $rc_before→$rc_after"
  return 0
}
matrix_register attestation_membership 60 "attestation membership seeding + 2nd-device + wrong-gh refused-op, on a GENUINE 2nd frame (P-413/WI-5779)" scn_attestation_membership

# ── attestation_unattested_device (91, TERMINAL): LEG4 unattested-device refused-op ──
# Runs LAST (after revocation_kcut/90): permanently strips B's device_attestations on A to
# simulate an author device that resolves to no member, then waits out the comms-tier
# device→user cache TTL and asserts the identity_unresolved refusal + counter bump. Mirrors
# revocation_kcut's "may leave the member unable to receive" terminal contract — do NOT
# reorder this before restart_durability/reconnect_catchup/replication_soak/revocation_kcut.
scn_attestation_unattested_device() {
  local rid="$MATRIX_RUN_ID" oslug="${FRAME_MEMBER_SLUG[a]:-}" mslug="${FRAME_MEMBER_SLUG[b]:-}"
  [ -n "$oslug" ] && [ -n "$mslug" ] || { echo "attestation(unattested-device): frames not joined"; return 1; }
  [ -n "${RIG_HIVE_ID:-}" ] || { echo "attestation(unattested-device) FAIL — RIG_HIVE_ID unset"; return 1; }

  local ws b_gh_id
  ws="$(rig_resolve_ws a)" || { echo "attestation(unattested-device) FAIL — could not resolve workspace_id on frame a"; return 1; }
  b_gh_id="$(rig_github_id "${FRAME_USER[b]}")"
  [ -n "$b_gh_id" ] || { echo "attestation(unattested-device) FAIL — could not resolve github id for member '${FRAME_USER[b]:-?}'"; return 1; }

  # WI-5779 fix (2026-07-25, code-review catch — same class as WI-5715): the assert MUST be
  # scoped to the EXACT reason 'receipt-apply:identity_unresolved', never a loose
  # `LIKE 'receipt-apply:%'` total. LEG3 (attestation_membership, order 60, same run) already
  # bumped 'receipt-apply:responder_mismatch' earlier, AND restart_durability(80)/
  # reconnect_catchup(85)/replication_soak(87)/revocation_kcut(90) — all invasive scenarios
  # that can trigger re-federation/retries of prior receipts — run BETWEEN leg3 and this
  # scenario(91). A loose total-based `tot_after > tot_before` can therefore go true from a
  # STRAY re-bump of responder_mismatch (or any other receipt-apply reason) without
  # identity_unresolved ever firing — a guaranteed-nonzero baseline plus an unrelated further
  # bump is a false PASS, never actually proving this leg's own claim. Scope to the one reason
  # this leg actually causes.
  local rc_before rc_after rid_rem rem_on_a reasons now_ms rc_after_measured
  # WI-5788 (P-411 residual): UNMEASURED baseline ⇒ FAIL, never coerce to 0. See the LEG3
  # comment above — and note this leg is MORE exposed to it, because it runs LAST (order 91)
  # after four invasive scenarios (restart_durability/reconnect_catchup/replication_soak/
  # revocation_kcut) that can leave frame a briefly unreachable. A dead baseline probe there
  # coerces to 0, and then a single real identity_unresolved bump from ANY source reads as
  # this leg's own proof.
  rc_before="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:identity_unresolved';" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$rc_before" ] || { echo "attestation(unattested-device) FAIL — LEG4 baseline UNMEASURED: the identity_unresolved counter probe on frame a returned nothing, so 'counter is 0' and 'probe never ran' are indistinguishable; refusing to score this leg"; return 1; }

  # Strip B's attestation on A (author device now maps to no member) — safe here: this is
  # the LAST scenario in the run, so no downstream scenario depends on B's device row.
  drv_psql a "UPDATE harness_shared.pot_members SET device_attestations='[]'::jsonb WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" >/dev/null 2>&1
  # WI-6046 (2026-07-26): the strip above is this leg's ENTIRE precondition, and it swallowed
  # every error (>/dev/null 2>&1, no rc check, no read-back). If frame a's PG is degraded when
  # it runs — likely, since this leg runs LAST after four invasive scenarios, exactly as the
  # WI-5788 comment below already warns — the UPDATE silently no-ops. B's device then still
  # resolves to a member, A correctly does NOT refuse, and the scoring assert at the bottom
  # reports "identity_unresolved 0→0" as though the FEATURE under test had failed.
  # Observed live: gate run 083840 (12:38Z UTC) failed exactly this way while frame a was
  # recovering from 3 SIGTERMs. Verify the setup and fail as SETUP, naming the real fault —
  # the same UNMEASURED⇒FAIL discipline the read path already gets, applied to the write path.
  # Probe with count(*) FIRST: it ALWAYS returns exactly one row, so an empty result means the
  # query never ran (frame a down / psql refused) rather than "no such member". Without that
  # split, a member row that legitimately does not exist on a — a state in which the
  # precondition (B's device resolves to no member) is ALREADY satisfied and this leg passes
  # today — would read as UNVERIFIED and turn a genuine PASS into a FAIL. That would be the
  # mirror image of the bug this change fixes, so it is worth the extra query.
  local member_rows stripped
  member_rows="$(drv_psql a "SELECT count(*) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" 2>/dev/null | tr -d '[:space:]')"
  [ -n "$member_rows" ] || { echo "attestation(unattested-device) FAIL — LEG4 SETUP UNVERIFIED: the pot_members probe on frame a returned nothing after the strip (count(*) always returns a row, so this means the query never ran — frame a down / psql refused), leaving 'strip applied' and 'probe never ran' indistinguishable; refusing to score this leg"; return 1; }
  if [ "$member_rows" != 0 ]; then
    stripped="$(drv_psql a "SELECT COALESCE(jsonb_array_length(device_attestations),0) FROM harness_shared.pot_members WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" 2>/dev/null | tr -d '[:space:]')"
    [ -n "$stripped" ] || { echo "attestation(unattested-device) FAIL — LEG4 SETUP UNVERIFIED: the member row exists on frame a but device_attestations could not be read back after the strip; refusing to score this leg"; return 1; }
    [ "$stripped" = 0 ] || { echo "attestation(unattested-device) FAIL — LEG4 SETUP DID NOT APPLY: B still carries $stripped device attestation(s) on frame a after the strip UPDATE (frame a degraded / PG unavailable?). The precondition was never established, so a non-refusal below would NOT be a product defect"; return 1; }
  fi
  sleep 35   # PAPERCUSP_COMMS_TIER_CACHE_MS default 30_000ms — wait out the device→user cache

  rid_rem="att-unatt-${rid}-$RANDOM"; now_ms="$(date +%s)000"
  drv_psql b "INSERT INTO harness_shared.p2p_receipts (workspace_id,harness_slug,receipt_id,kind,action,detail,responder_github_user_id,receipt_ts,origin) VALUES ('$ws','$RIG_HIVE_ID','$rid_rem','refusal','work-offer:claim','att unattested-device probe ($rid)',${b_gh_id:-999999999},$now_ms,'local');" >/dev/null 2>&1
  # WI-6046: same class as the strip above — if this INSERT silently fails (frame b degraded),
  # no receipt ever federates, the counter cannot bump, and the scoring assert blames the
  # feature for a probe that was never emitted. Record whether the row landed, DIAGNOSTIC ONLY:
  # deliberately NOT a hard fail, because a receipt may legitimately leave b once it federates,
  # so "absent" here cannot distinguish never-inserted from already-drained. Hard-failing on it
  # would manufacture the very false-FAIL class this change removes. It is surfaced in the
  # scoring message below, where it separates "rig never emitted the probe" from "A failed to refuse".
  local probe_on_b
  probe_on_b="$(drv_psql b "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_rem';" 2>/dev/null | tr -d '[:space:]')"
  rc_after=""; rc_after_measured=0
  local i
  for i in $(seq 1 40); do
    rc_after="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:identity_unresolved';" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$rc_after" ]; then
      rc_after_measured=1
      { [ "$rc_after" -gt "$rc_before" ]; } 2>/dev/null && break
    fi
    sleep 3
  done
  [ "$rc_after_measured" = 1 ] || { echo "attestation(unattested-device) FAIL — LEG4 post-probe UNMEASURED: all 40 identity_unresolved reads on frame a returned empty (the probe never ran — NOT evidence the counter failed to bump)"; return 1; }
  rem_on_a="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_rem';" 2>/dev/null | tr -d '[:space:]')"
  reasons="$(drv_psql a "SELECT reason||'='||count FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason LIKE 'receipt-apply:%' ORDER BY updated_at DESC LIMIT 3;" 2>/dev/null | tr '\n' ' ')"
  { [ "$rc_after" -gt "$rc_before" ] && [ "$rem_on_a" = 0 ]; } 2>/dev/null || { echo "attestation(unattested-device) FAIL — across the container boundary: identity_unresolved $rc_before→$rc_after, row-on-a=$rem_on_a, probe-on-b=${probe_on_b:-<unmeasured>}, strip-verified=yes, all reasons: $reasons [WI-6046: the strip precondition IS verified above, so this is a genuine non-refusal unless probe-on-b=0/<unmeasured>, which points at the rig rather than the feature]"; return 1; }

  echo "unattested-device refused-op OK on a GENUINE second frame: author device attested to no member → A refuses (identity_unresolved $rc_before→$rc_after; all reasons: $reasons; row-on-a=$rem_on_a)"
  return 0
}
matrix_register attestation_unattested_device 91 "unattested-device refused-op witness, on a GENUINE 2nd frame (P-413/WI-5779, TERMINAL)" scn_attestation_unattested_device

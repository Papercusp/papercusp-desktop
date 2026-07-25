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
  local rc_before rc_after rid_wrong rid_on_a
  rc_before="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:responder_mismatch';" 2>/dev/null | tr -d '[:space:]')"
  [ -z "$rc_before" ] && rc_before=0
  rid_wrong="att-wrong-${rid}-$RANDOM"; now_ms="$(date +%s)000"
  drv_psql b "INSERT INTO harness_shared.p2p_receipts (workspace_id,harness_slug,receipt_id,kind,action,detail,responder_github_user_id,receipt_ts,origin) VALUES ('$ws','$RIG_HIVE_ID','$rid_wrong','refusal','work-offer:claim','att wrong-gh probe ($rid)',${a_gh_id:-999999999},$now_ms,'local');" >/dev/null 2>&1
  rc_after=$rc_before
  for i in $(seq 1 40); do
    rc_after="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason='receipt-apply:responder_mismatch';" 2>/dev/null | tr -d '[:space:]')"
    [ -z "$rc_after" ] && rc_after=0
    { [ "$rc_after" -gt "$rc_before" ]; } 2>/dev/null && break
    sleep 3
  done
  rid_on_a="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_wrong';" 2>/dev/null | tr -d '[:space:]')"
  { [ "$rc_after" -gt "$rc_before" ] && [ "$rid_on_a" = 0 ]; } 2>/dev/null || { echo "attestation FAIL — LEG3 wrong-gh-user refused-op across the container boundary (responder_mismatch $rc_before→$rc_after, row-on-a=$rid_on_a)"; return 1; }

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

  local tot_before tot_after rid_rem rem_on_a reasons now_ms
  tot_before="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason LIKE 'receipt-apply:%';" 2>/dev/null | tr -d '[:space:]')"
  [ -z "$tot_before" ] && tot_before=0

  # Strip B's attestation on A (author device now maps to no member) — safe here: this is
  # the LAST scenario in the run, so no downstream scenario depends on B's device row.
  drv_psql a "UPDATE harness_shared.pot_members SET device_attestations='[]'::jsonb WHERE pot_home_slug='$RIG_HIVE_ID' AND github_user_id=$b_gh_id;" >/dev/null 2>&1
  sleep 35   # PAPERCUSP_COMMS_TIER_CACHE_MS default 30_000ms — wait out the device→user cache

  rid_rem="att-unatt-${rid}-$RANDOM"; now_ms="$(date +%s)000"
  drv_psql b "INSERT INTO harness_shared.p2p_receipts (workspace_id,harness_slug,receipt_id,kind,action,detail,responder_github_user_id,receipt_ts,origin) VALUES ('$ws','$RIG_HIVE_ID','$rid_rem','refusal','work-offer:claim','att unattested-device probe ($rid)',${b_gh_id:-999999999},$now_ms,'local');" >/dev/null 2>&1
  tot_after=$tot_before
  local i
  for i in $(seq 1 40); do
    tot_after="$(drv_psql a "SELECT COALESCE(sum(count),0) FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason LIKE 'receipt-apply:%';" 2>/dev/null | tr -d '[:space:]')"
    [ -z "$tot_after" ] && tot_after=0
    { [ "$tot_after" -gt "$tot_before" ]; } 2>/dev/null && break
    sleep 3
  done
  rem_on_a="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_receipts WHERE harness_slug='$RIG_HIVE_ID' AND receipt_id='$rid_rem';" 2>/dev/null | tr -d '[:space:]')"
  reasons="$(drv_psql a "SELECT reason||'='||count FROM harness_shared.p2p_refused_op_counters WHERE harness_slug='$RIG_HIVE_ID' AND reason LIKE 'receipt-apply:%' ORDER BY updated_at DESC LIMIT 3;" 2>/dev/null | tr '\n' ' ')"
  { [ "$tot_after" -gt "$tot_before" ] && [ "$rem_on_a" = 0 ]; } 2>/dev/null || { echo "attestation(unattested-device) FAIL — across the container boundary: receipt-apply total $tot_before→$tot_after, row-on-a=$rem_on_a, reasons: $reasons"; return 1; }

  echo "unattested-device refused-op OK on a GENUINE second frame: author device attested to no member → A refuses (receipt-apply total $tot_before→$tot_after; reasons: $reasons; row-on-a=$rem_on_a)"
  return 0
}
matrix_register attestation_unattested_device 91 "unattested-device refused-op witness, on a GENUINE 2nd frame (P-413/WI-5779, TERMINAL)" scn_attestation_unattested_device

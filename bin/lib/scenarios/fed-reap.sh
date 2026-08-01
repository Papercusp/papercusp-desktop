#!/usr/bin/env bash
# fed-reap.sh — FEDERATED REVOCATION REAP: revoke on A → reap on B.
# (p2p-work-distribution P-106 "revocation-reaper deferred #3"; driven by
# p2p-public-release-remaining-lanes-2026-07-16 P-205 / WI-5135, the LIVE-2
# acceptance drill — release-blocker #1.)
#
# WHY THIS FILE EXISTS. The LIVE-2 drill (bin/work-distribution-drill.sh) proves
# the LOCAL reap on one box: revoke a fleet grant and the grantor's OWN in-flight
# foreign sessions fail closed (its LEG R). It structurally CANNOT prove the
# federated half, and this is not a rig-availability excuse — it is by
# construction. The projection hook that carries a withdrawal to the machines
# actually running the work (sync/hyperbee/projections/p2p-peer-grants.ts, the
# reapForeignSessionsForRevocation call guarded by `provenance?.origin ===
# 'remote'`) is unreachable from a local op: a local write never reaches
# writeToPg at all (skipOwnOps). One box can therefore only ever produce a
# vacuous green for this leg. Two frames with distinct device identities are the
# minimum that makes the assertion mean anything — hence a matrix scenario
# rather than another leg in the single-box drill.
#
# WHAT IT PROVES (the security story, end to end):
#   a host withdraws consent → every OTHER machine in the hive that is running
#   that fleet's work stops, fails CLOSED, and says why in a receipt.
#
#   1. BASELINE — the ACTIVE grant federates a→b as origin='remote'. Without
#      this, a post-revoke absence proves nothing (b3-revocation.sh's attribution
#      discipline: an absence is only a cut-off if presence came first).
#   2. b is running foreign work for that fleet (an 'active'
#      p2p_foreign_workspaces row).
#   3. OWNER (a) revokes the fleet grant through the real product path
#      (MCP p2p-grant-set action=revoke).
#   4. The REVOKED row federates to b (origin='remote', status='revoked') and
#      b's projection reaps b's OWN session: state='reaped' + a grant-revoked
#      refusal receipt threaded by offer_id.
#
# ⚠ HONEST SCOPE — READ BEFORE QUOTING THIS SCENARIO AS RELEASE EVIDENCE:
#   · The foreign session on b is SEEDED, not spawned. The executor spawn leg
#     does not run on a packaged host today (the p2p-work-intake routine does not
#     seed — see the LIVE-2 drill's detected SPAWN census line), so there is no
#     honest way to get a REAL foreign session here yet. What is under test is
#     the REVOCATION path; the seed is scaffolding for it, exactly as the drill's
#     own LEG FW is. When the intake routine seeds, replace step 2 with a real
#     claimed offer and this scenario gets strictly stronger with no other edit.
#   · This proves an honest session WINDS DOWN on withdrawal. It does NOT prove a
#     HOSTILE session is stopped — mechanical kill (revocation-reaper deferred #1,
#     cgroup/dedicated OS user after the X13 wind-down) is P-105 tier and is
#     UNBUILT; owner decision D-001 ships v1 without it, on the user-trust chain
#     alone. Do not let a green here be read as containment.
#
# NON-INVASIVE (no sidecar kill/restart; one throwaway fleet grant + one foreign
# session row on b, ids suffixed with MATRIX_RUN_ID). Order 59: the tail of the
# work-distribution cluster (fleet_directory 55 → seat_offer 56 → spawn_request 57
# → work_item 58 → HERE), and far ahead of the TERMINAL legs — attestation's
# unattested-device witness (79) and above all b3-revocation(90), which bans b
# hive-wide and would make every assertion below unreachable.

# Bounded row poll on one frame: $1=inst $2=table $3=predicate [$4=tries]
# → echoes 1 (present) / 0 (absent). 120×2s mirrors seat-offer.sh's window: the
# initial replicator attach has been measured at ~2.8min, which a 90s window
# false-REDs on.
_freap_row_present() {
  local inst="$1" tbl="$2" pred="$3" tries="${4:-120}" n
  for _ in $(seq 1 "$tries"); do
    n="$(drv_psql "$inst" "SELECT count(*) FROM harness_shared.$tbl WHERE $pred;" 2>/dev/null | tr -d '[:space:]')"
    if [ -n "$n" ] && [ "$n" != "0" ]; then echo 1; return; fi
    sleep 2
  done
  echo 0
}

scn_fed_reap() {
  # The MCP driver lives in fleet-directory.sh — the runner sources every
  # scenario file before executing any, so this reuse is load-order-safe
  # (seat-offer.sh does the same).
  if ! declare -f _fdir_mcp_call >/dev/null; then
    echo "fed-reap FAIL — _fdir_mcp_call missing (fleet-directory.sh not loaded)"
    return 1
  fi

  local rid="$MATRIX_RUN_ID"
  local aslug="${FRAME_MEMBER_SLUG[a]:-}" bslug="${FRAME_MEMBER_SLUG[b]:-}"
  [ -n "$aslug" ] && [ -n "$bslug" ] || {
    echo "fed-reap FAIL — frames not joined (owner='$aslug' member='$bslug')"; return 1; }

  local fleet="mx-fedreap-${rid}" offer="mx-fedreap-offer-${rid}" out bws
  fleet="$(printf '%s' "$fleet" | tr '[:upper:]' '[:lower:]')"

  # b's real workspace partition — the same resolver the MCP driver uses. A
  # 'default'/'*' partition is refused by the reaper itself (a stranded reap that
  # never federates is a security hole), so resolve it rather than assume it.
  if ! bws="$(rig_resolve_ws b)"; then
    echo "fed-reap FAIL — could not resolve a real workspace_id on frame b (D-050/WI-5399 class)"
    return 1
  fi

  # 1. OWNER (a): grant the fleet work-offer rights on the shared pot.
  out="$(_fdir_mcp_call a 'p2p-grant-set' \
    "{\"action\":\"set\",\"potSlug\":\"$aslug\",\"granteeKind\":\"fleet\",\"granteeRef\":\"$fleet\",\"preset\":\"delegate\",\"note\":\"matrix fed-reap $rid\"}")"
  if printf '%s' "$out" | tr -d '\\' | grep -Eq '"isError" *: *true|"ok" *: *false|MCP_ERROR|FDIR_NO_TOKEN'; then
    echo "fed-reap FAIL — p2p-grant-set(set) on frame a errored: $(printf '%s' "$out" | tail -c 300)"
    return 1
  fi
  if [ "$(_freap_row_present a p2p_peer_grants "grantee_ref='$fleet' AND status='active'" 30)" != 1 ]; then
    echo "fed-reap FAIL — grant never went active locally on frame a (grant plane broken before federation is even in question)"
    return 1
  fi

  # 2. BASELINE — the ACTIVE grant must reach b as origin='remote'. This is the
  #    attribution guard: without it, a reap that never fires is indistinguishable
  #    from a grant plane that never federated at all.
  if [ "$(_freap_row_present b p2p_peer_grants "grantee_ref='$fleet' AND origin='remote'")" != 1 ]; then
    echo "fed-reap FAIL — BASELINE: the active grant for '$fleet' never materialized origin='remote' on frame b; a later reap could not be attributed to the revocation (grant plane not federating a→b)"
    return 1
  fi

  # 3. b is running foreign work for that fleet. SEEDED, not spawned — see the
  #    honest-scope note in this file's header. state='active' is a REAPABLE_STATE;
  #    the reaper matches purely on fleet_slug + reapable state
  #    (foreignSessionMatchesRevocation).
  drv_psql b "INSERT INTO harness_shared.p2p_foreign_workspaces
       (workspace_id, offer_id, fleet_slug, origin_github_user_id, executor_device, root_path, clone_path, state)
     VALUES ('$bws','$offer','$fleet', 1567022, 'mx-fedreap-device-$rid', '/tmp/mx-fedreap-$rid', '/tmp/mx-fedreap-$rid/clone', 'active');" >/dev/null 2>&1
  if [ "$(_freap_row_present b p2p_foreign_workspaces "offer_id='$offer' AND state='active'" 5)" != 1 ]; then
    echo "fed-reap FAIL — could not seed the in-flight foreign session on frame b (ws=$bws)"
    return 1
  fi

  # 4. OWNER (a): withdraw consent through the real product path.
  out="$(_fdir_mcp_call a 'p2p-grant-set' \
    "{\"action\":\"revoke\",\"potSlug\":\"$aslug\",\"granteeKind\":\"fleet\",\"granteeRef\":\"$fleet\"}")"
  if printf '%s' "$out" | tr -d '\\' | grep -Eq '"isError" *: *true|"ok" *: *false|MCP_ERROR|FDIR_NO_TOKEN'; then
    echo "fed-reap FAIL — p2p-grant-set(revoke) on frame a errored: $(printf '%s' "$out" | tail -c 300)"
    return 1
  fi

  # 5. The revocation must ARRIVE on b...
  if [ "$(_freap_row_present b p2p_peer_grants "grantee_ref='$fleet' AND origin='remote' AND status='revoked'")" != 1 ]; then
    echo "fed-reap FAIL — the revoked grant for '$fleet' never materialized origin='remote' on frame b (withdrawal did not federate; b would keep running the work)"
    return 1
  fi

  # 6. ...and b must fail CLOSED: its own session reaped by the projection hook.
  if [ "$(_freap_row_present b p2p_foreign_workspaces "offer_id='$offer' AND state='reaped'" 45)" != 1 ]; then
    local st
    st="$(drv_psql b "SELECT state FROM harness_shared.p2p_foreign_workspaces WHERE offer_id='$offer';" 2>/dev/null | tr -d '[:space:]')"
    echo "fed-reap FAIL — b received the revocation but did NOT reap its in-flight session (state='$st'): the federated withdrawal landed and the work kept running. This is the P-106 deferred-#3 hook (p2p-peer-grants.ts) not firing — the exact hole this scenario exists to catch."
    return 1
  fi

  # 7. ...and say why, in a receipt threaded by offer_id (D-004: loud, never a
  #    silent drop — the origin has to be able to learn its work was stopped).
  if [ "$(_freap_row_present b p2p_receipts "offer_id='$offer' AND action='work-offer:reap'" 20)" != 1 ]; then
    echo "fed-reap FAIL — session reaped on b but NO grant-revoked receipt threaded by offer_id=$offer (D-004 silent drop: the origin can never learn why its work stopped)"
    return 1
  fi

  # Evidence that must survive a PASS (WI-6057 / EI-18762718908280875: only the
  # last non-blank line and `·`-marked lines are printed on a green run).
  echo "  · fed-reap evidence — b's view after a's revocation:"
  drv_psql b "SELECT 'grant', status, origin FROM harness_shared.p2p_peer_grants WHERE grantee_ref='$fleet'
              UNION ALL SELECT 'session', state, '-' FROM harness_shared.p2p_foreign_workspaces WHERE offer_id='$offer'
              UNION ALL SELECT 'receipt', action, coalesce(offer_id,'-') FROM harness_shared.p2p_receipts WHERE offer_id='$offer';" 2>&1 | scn_diag "b: "

  echo "federated reap proven a→b: withdrawal on the owner frame federated (origin='remote', status='revoked') and frame b failed CLOSED on its own in-flight session for '$fleet' (state='reaped' + offer-threaded grant-revoked receipt). Session was seeded, not spawned — see header scope note; proves wind-down, NOT containment of a hostile session."
  return 0
}

matrix_register fed_reap 59 "federated revocation reap a→b (P-106 deferred #3)" scn_fed_reap

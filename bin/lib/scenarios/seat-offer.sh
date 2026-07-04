#!/usr/bin/env bash
# seat-offer.sh — WI-1935/D-005 matrix scenario: seat-offer federation
# (agent-allocation-framework-2026-07-03 P-007; rides the p2p-work-distribution
# offer store, mig 490).
#
# What it proves: delegating agent seats on the MEMBER frame (b) through the
# real product path (MCP resource:delegate kind=agent_slot → the D-005 hook in
# agent-tools/resource/delegate.ts → p2p/offer-store-publish.ts) authors a
# PUBLISHER-SIGNED seat-offer that rides the hive peer-log and MATERIALIZES on
# the OWNER frame (a) as an origin='remote' row in harness_shared.p2p_work_offers
# — the "B delegates → A sees B's machine: N model·effort seats" story, in the
# b→a direction (the mirror of fleet-directory.sh's a→b leg). Presence on a IS
# the signature assert: the projection (sync/hyperbee/projections/work-offers.ts)
# verifies the device signature + the device→publisher attestation BEFORE
# applying. Also asserts the D-005/M19 privacy contract: the record body carries
# accountScope, never a raw gateway account id.
#
# Composes with fleet-directory.sh (order 55): reuses its _fdir_mcp_call MCP
# driver and runs right after it, so the fleet + its directory card exist by the
# time seats are delegated. NON-INVASIVE (no sidecar kill/restart; one throwaway
# fleet + one offer row, ids suffixed with MATRIX_RUN_ID).

# Bounded offer-row poll: $1=inst $2=predicate → echoes 1 (present) / 0 (absent).
_soffer_row_present() {
  local inst="$1" pred="$2" tries="${3:-45}" n
  for _ in $(seq 1 "$tries"); do
    n="$(drv_psql "$inst" "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE $pred;" 2>/dev/null | tr -d '[:space:]')"
    if [ "$n" != "0" ] && [ -n "$n" ]; then echo 1; return; fi
    sleep 2
  done
  echo 0
}

scn_seat_offer() {
  # The MCP driver lives in fleet-directory.sh — both files are sourced by the
  # runner before any scenario executes, so this is a load-order-safe reuse.
  if ! declare -f _fdir_mcp_call >/dev/null; then
    echo "seat-offer FAIL — _fdir_mcp_call missing (fleet-directory.sh not loaded)"
    return 1
  fi

  local slug="mx-seatoffer-${MATRIX_RUN_ID}" out
  slug="$(printf '%s' "$slug" | tr '[:upper:]' '[:lower:]')"

  # 1. OWNER (a): create the fleet the member will delegate seats to.
  out="$(_fdir_mcp_call a 'fleet:create' "{\"name\":\"$slug\",\"description\":\"matrix seat-offer probe $MATRIX_RUN_ID\"}")"
  if printf '%s' "$out" | grep -Eq '"isError" *: *true|MCP_ERROR|FDIR_NO_TOKEN'; then
    echo "seat-offer FAIL — fleet:create on frame a errored: $(printf '%s' "$out" | tail -c 300)"
    return 1
  fi

  # 2. MEMBER (b): delegate 2 haiku·low seats through the real product path.
  #    The store write is synchronous; the seat-offer publish is best-effort
  #    fire-and-forget behind it (polled below, never assumed).
  out="$(_fdir_mcp_call b 'resource:delegate' "{\"fleetSlug\":\"$slug\",\"kind\":\"agent_slot\",\"model\":\"haiku\",\"effort\":\"low\",\"count\":2}")"
  if printf '%s' "$out" | grep -Eq '"isError" *: *true|MCP_ERROR|FDIR_NO_TOKEN'; then
    echo "seat-offer FAIL — resource:delegate on frame b errored: $(printf '%s' "$out" | tail -c 300)"
    return 1
  fi

  # 3. The offer must exist LOCALLY on b (the publish leg — catches a silent
  #    skip: no shared hive resolved, no gh identity, keychain fault on b).
  if [ "$(_soffer_row_present b "fleet_slug='$slug' AND offer_kind='seat'")" != 1 ]; then
    echo "seat-offer FAIL — no local seat-offer on frame b for $slug (publish leg skipped/errored; check no_single_shared_hive / identity / keychain on b)"
    return 1
  fi

  # 4. The offer must MATERIALIZE on a as origin='remote' — the cross-node,
  #    sig-verified leg (the projection refuses anything unverified).
  if [ "$(_soffer_row_present a "fleet_slug='$slug' AND offer_kind='seat' AND origin='remote'")" != 1 ]; then
    echo "seat-offer FAIL — seat-offer for $slug never materialized origin='remote' on frame a (published on b but not verified/applied on a)"
    return 1
  fi

  # 5. Content sanity on a: a live open v1+ seat record, no host refusal, and
  #    the D-005/M19 privacy contract — the record advertises accountScope only
  #    (an 'auto' delegation must not leak any account ref into the body).
  local live leak
  live="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug' AND origin='remote' AND status='open' AND record_version>=1 AND local_disposition IS NULL;" 2>/dev/null | tr -d '[:space:]')"
  if [ "$live" = "0" ] || [ -z "$live" ]; then
    echo "seat-offer FAIL — remote seat-offer on a is not a live open v1+ record"
    return 1
  fi
  leak="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug' AND origin='remote' AND record_json NOT LIKE '%\"accountScope\":\"auto\"%';" 2>/dev/null | tr -d '[:space:]')"
  if [ "$leak" != "0" ]; then
    echo "seat-offer FAIL — remote record on a lacks accountScope:'auto' (either malformed or leaking a pinned account ref for an AUTO delegation)"
    return 1
  fi

  echo "seat-offer federated b→a (publisher-signed publish on delegate; sig-verified remote apply; live open seat card for $slug, account id kept local)"
  return 0
}

matrix_register seat_offer 56 "seat-offer federation on delegate (WI-1935/D-005)" scn_seat_offer

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
# 120 tries × 2s = 4min: covers the ~2.8min initial replicator attach (measured,
# run m1783165541) that a 90s window false-REDs on.
_soffer_row_present() {
  local inst="$1" pred="$2" tries="${3:-120}" n
  for _ in $(seq 1 "$tries"); do
    n="$(drv_psql "$inst" "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE $pred;" 2>/dev/null | tr -d '[:space:]')"
    if [ "$n" != "0" ] && [ -n "$n" ]; then echo 1; return; fi
    sleep 2
  done
  echo 0
}

# WI-6179 b→a DISCRIMINATOR. "published on b but not applied on a" collapses three
# materially different faults into one sentence, and the banked 1.3MB serve.log pair
# cannot separate them (verified on the 170106-seat_offer bundle: grepping the offer
# slug returns 0 hits on BOTH frames — the publish/apply path logs nothing
# addressable). Only ONE of the three deserves the "environmental / WI-5639 SLA"
# write-off, so the FAIL line must say WHICH:
#   NEVER-LEFT-B       b's substrate_outbox row is quarantined or still undrained
#   ARRIVED-NOT-REMOTE a HAS a row for the fleet, but not origin='remote' (applied
#                      locally / refused at sig-verify) — a product fault, not timing
#   LOST-OR-REFUSED    b drained it and a has nothing at all
#   TIMING-ONLY        the genuine late-apply case (LOST-OR-REFUSED + clean counters)
# Echoes a one-line classification; never fails the leg (diagnostic only, reads only).
# The outbox is queried by table_name + aggregate counts rather than by key, because
# the key is composed downstream of this scenario (harnessSlug/offerId/publisher/
# workspace) and the matrix authors exactly one seat offer per run — so the counts for
# that table ARE this offer, and the probe cannot rot when the key format changes.
_soffer_diag_b_to_a() {
  local slug="$1" b_pending b_quar b_total a_any a_break verdict
  # Scoped by harness_slug as well as table_name: substrate_outbox is MULTI-TENANT (keyed
  # workspace_id + harness_slug), so a bare table_name filter can count another hive's rows
  # and mis-classify — an unrelated undrained row would read as NEVER-LEFT-B for THIS offer.
  # (Caught by dev:pg_query's tenant-scope advisory while validating these against the real
  # schema; see agent-insights/raw-sql-plan-slug-needs-workspace-harness-scope.)
  b_total="$(drv_psql b "SELECT count(*) FROM harness_shared.substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug='$RIG_HIVE_ID';" 2>/dev/null | tr -d '[:space:]')"
  b_pending="$(drv_psql b "SELECT count(*) FROM harness_shared.substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug='$RIG_HIVE_ID' AND drained_at IS NULL;" 2>/dev/null | tr -d '[:space:]')"
  b_quar="$(drv_psql b "SELECT count(*) FROM harness_shared.substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug='$RIG_HIVE_ID' AND quarantined_at IS NOT NULL;" 2>/dev/null | tr -d '[:space:]')"
  # ⚠ THE VERDICT READ MUST MATCH THE ASSERT IT EXPLAINS. Step 4 asserts on
  # `offer_kind='seat' AND origin='remote'`; this count used to be scoped by fleet_slug
  # ALONE, across EVERY offer_kind. p2p_work_offers holds more than seats for the same
  # fleet — spawn-request records are published through the sibling putWorkOffer call site
  # (spawn-request-publish.ts:141) against the same fleet_slug — so a single non-seat row on
  # frame a was enough to flip the verdict to ARRIVED-NOT-REMOTE ("the record arrived, the
  # apply path is the fault") while the SEAT offer the leg actually tests had never arrived
  # at all. Two opposite diagnoses, identical output: the same scoped-vs-identified confusion
  # the clock probe below was already rewritten to remove. Scope the verdict to the kind
  # under test; the breakdown below deliberately does NOT filter kind, so a stray non-seat
  # row stays VISIBLE (named by kind) instead of being silently filtered into "no row".
  a_any="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug' AND offer_kind='seat';" 2>/dev/null | tr -d '[:space:]')"
  # WI-6210 WRITER DISCRIMINATOR (added with the origin/status breakdown, not instead
  # of it): on an ARRIVED-NOT-REMOTE row, the AUTHOR_PUBKEY SHAPE names WHICH writer
  # produced it, and the two answers point at completely different bugs:
  #   author:NULL   — offer-store.ts publishOffer wrote it (its column list omits
  #                   author_pubkey/origin/fed_ts entirely, so origin lands on the
  #                   column DEFAULT 'local'). That is a LOCAL publish on frame a —
  #                   an MCP-routing / scenario fault, NOT the federation apply path.
  #   author:64hex  — a PROJECTION apply (work-offers.ts is the only other writer, and
  #                   it always stamps an author) that nonetheless computed
  #                   origin='local'. Given projection.ts resolveOpProvenance, origin
  #                   can only be 'local' when sourceLogKeyHex === ownLogKeyHex OR
  #                   ownLogKeyHex is UNDEFINED — and the first is impossible here
  #                   because work-offers sets skipOwnOps:true, which DROPS such a put
  #                   before any write. So author:64hex + origin='local' PROVES the
  #                   apply ran without ownLogKeyHex (register-all.ts's
  #                   `opts.ownLogKeyHex ? {…} : {}` fallback silently degrading).
  # Without this field the FAIL line cannot separate those two, which is exactly the
  # ambiguity that cost a wake of forward-reasoning on run 174655.
  # WI-6179: the breakdown is grouped BY offer_id@publisher too, so each token names a ROW,
  # not just a shape. Grouped on the shape alone it reported "local/open/author:64hex=1" for
  # a fleet — which frame a can hold for its OWN offer just as easily as for b's — and run
  # 184106 was read as "b's offer arrived and was re-stamped" off exactly that ambiguity.
  # A count is not evidence about a row until the row is named.
  a_break="$(drv_psql a "SELECT COALESCE(string_agg(k||' kind='||kd||' '||o||'/'||s||'/'||au||'='||n, ' '), '<no row for this fleet>') FROM (SELECT offer_id||'@'||publisher_github_user_id k, COALESCE(offer_kind,'<null>') kd, COALESCE(origin,'<null>') o, COALESCE(status,'<null>') s, CASE WHEN author_pubkey IS NULL THEN 'author:NULL' WHEN author_pubkey ~ '^[0-9a-f]{64}\$' THEN 'author:64hex' ELSE 'author:other' END au, count(*) n FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug' GROUP BY 1,2,3,4,5) t;" 2>/dev/null | tr '\n' ' ')"
  # WI-6210 CLOCK-PROVENANCE PROBE — the 3-way decision procedure for an
  # ARRIVED-NOT-REMOTE row. Capture stamps the wire op's clock FROM the source row
  # (mig 423/528: substrate_outbox.ts = row.fed_ts, op_hlc = row.fed_hlc), and the
  # projection apply writes fed_ts/fed_hlc VERBATIM from that wire clock. So
  # comparing a's stored clock against b's outbox clock names the writer:
  #   a.fed_hlc == b.op_hlc  → the projection stamped it from the wire op. Origin is
  #                            then whatever resolveOpProvenance computed — read it.
  #   a.fed_hlc != b.op_hlc, b.op_hlc NOT NULL → a's clock was generated LOCALLY, i.e.
  #                            harness_shared.hlc_now() inside stamp_local_federated_write
  #                            (mig 490/517) ran. Its INSERT branch stamps ONLY when
  #                            fed_ts IS NULL — which cannot hold when the wire carried a
  #                            clock — so the stamp came from its UPDATE branch, which
  #                            ALSO forces `NEW.origin := 'local'`. That is a LOCAL WRITE
  #                            re-stamping an already-applied remote row, NOT an apply bug.
  #   b.op_hlc IS NULL       → the op crossed the wire CLOCKLESS; the trigger's INSERT
  #                            branch legitimately filled the clock, and origin stayed at
  #                            its 'local' default — an apply-path/provenance bug.
  # Two cheap SELECTs, and they separate three faults that are otherwise identical in
  # every observable column (verified against the banked run-174655 row pair).
  #
  # ⚠ THE CLOCKS ONLY DECIDE ANYTHING IF BOTH SIDES NAME THE SAME ROW. Run 184106 read
  # "differing clocks ⇒ a LOCAL write re-stamped an applied remote row" off an a-side read
  # scoped by fleet_slug ALONE against a b-side read scoped by table+harness alone — so
  # "these are the same offer, re-stamped" and "these are two DIFFERENT offers (b's never
  # arrived; the row on a is one frame a authored itself for the same fleet)" produced the
  # IDENTICAL output. A fleet slug is not an identity: `resource:delegate` can emit more than
  # one offer for a fleet, and the honor/spawn path on a publishes its own rows against the
  # same fleet. So every clock is now emitted KEYED BY offer_id@publisher, and b's own stored
  # row is read too — capture stamps the outbox op straight from that row (mig 423/528:
  # ts = row.fed_ts, op_hlc = row.fed_hlc), so b.row is the wire clock with an identity
  # attached. Pair by the key FIRST; only compare clocks within one key. If no key appears on
  # both sides, the answer is "b's offer never arrived", NOT "it arrived and was re-stamped".
  local b_clock a_clock b_row_clock
  b_clock="$(drv_psql b "SELECT COALESCE(string_agg(ts||'|'||COALESCE(op_hlc,'<null-hlc>'), ' '), '<no outbox row>') FROM harness_shared.substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug='$RIG_HIVE_ID';" 2>/dev/null | tr '\n' ' ')"
  b_row_clock="$(drv_psql b "SELECT COALESCE(string_agg(offer_id||'@'||publisher_github_user_id||'/'||COALESCE(offer_kind,'?')||':'||COALESCE(fed_ts::text,'<null-ts>')||'|'||COALESCE(fed_hlc,'<null-hlc>'), ' '), '<no row on b>') FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug';" 2>/dev/null | tr '\n' ' ')"
  a_clock="$(drv_psql a "SELECT COALESCE(string_agg(offer_id||'@'||publisher_github_user_id||'/'||COALESCE(offer_kind,'?')||':'||COALESCE(fed_ts::text,'<null-ts>')||'|'||COALESCE(fed_hlc,'<null-hlc>'), ' '), '<no row>') FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug';" 2>/dev/null | tr '\n' ' ')"
  if [ "${b_quar:-0}" -gt 0 ] 2>/dev/null; then
    verdict="NEVER-LEFT-B (outbox QUARANTINED on b — the row crossed the retry threshold and is excluded from the drain batch, mig 645; a b-side publish fault, NOT convergence timing)"
  elif [ "${b_pending:-0}" -gt 0 ] 2>/dev/null; then
    verdict="NEVER-LEFT-B (outbox row still UNDRAINED on b — never written to the hive peer log; b-side drain is stalled, NOT convergence timing)"
  elif [ "${a_any:-0}" -gt 0 ] 2>/dev/null; then
    verdict="ARRIVED-NOT-REMOTE (frame a HAS a row for this fleet but not origin='remote' — applied locally, or refused at sig-verify/device-attestation; a PRODUCT fault in the apply path, NOT convergence timing)"
  elif [ -z "${b_total}${a_any}" ]; then
    verdict="DIAG-UNAVAILABLE (could not read substrate_outbox on b / p2p_work_offers on a — treat the classification as unknown, not as timing)"
  else
    verdict="LOST-OR-REFUSED-BEFORE-APPLY (b drained every outbox row and frame a has NOTHING for this fleet — either the record never reached a, or a dropped it before the projection wrote a row; check a's inbound refusal counters, and only THEN read this as the late-apply/timing case)"
  fi
  echo "$verdict | b.outbox(p2p_work_offers): total=${b_total:-<unreadable>} undrained=${b_pending:-<unreadable>} quarantined=${b_quar:-<unreadable>} · a.rows(fleet=$slug) by origin/status/author: ${a_break:-<unreadable>} · clock b.outbox(ts|op_hlc)=${b_clock:-<unreadable>} · b.row(offer@pub:fed_ts|fed_hlc)=${b_row_clock:-<unreadable>} vs a.row(offer@pub:fed_ts|fed_hlc)=${a_clock:-<unreadable>} [PAIR BY offer@pub FIRST — a key present on b and ABSENT on a means b's offer never arrived, whatever else a holds for this fleet. Within ONE key: equal clocks ⇒ projection stamped from the wire; differing with a non-null b.op_hlc ⇒ a LOCAL write re-stamped via stamp_local_federated_write's UPDATE branch, which also forces origin='local'; b.op_hlc null ⇒ clockless wire op + apply-path origin default]"
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
  if printf '%s' "$out" | tr -d '\\' | grep -Eq '"isError" *: *true|"ok" *: *false|MCP_ERROR|FDIR_NO_TOKEN'; then
    echo "seat-offer FAIL — fleet:create on frame a errored: $(printf '%s' "$out" | tail -c 300)"
    return 1
  fi

  # 2. MEMBER (b): delegate 2 haiku·low seats through the real product path.
  #    The store write is synchronous; the seat-offer publish is best-effort
  #    fire-and-forget behind it (polled below, never assumed).
  out="$(_fdir_mcp_call b 'resource:delegate' "{\"fleetSlug\":\"$slug\",\"kind\":\"agent_slot\",\"model\":\"haiku\",\"effort\":\"low\",\"count\":2}")"
  if printf '%s' "$out" | tr -d '\\' | grep -Eq '"isError" *: *true|"ok" *: *false|MCP_ERROR|FDIR_NO_TOKEN'; then
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
    echo "seat-offer FAIL — seat-offer for $slug never materialized origin='remote' on frame a (published on b but not verified/applied on a). WI-6179 discriminator: $(_soffer_diag_b_to_a "$slug")"
    return 1
  fi

  # 5. Content sanity on a: a live open v1+ seat record, no host refusal, and
  #    the D-005/M19 privacy contract — the record advertises accountScope only
  #    (an 'auto' delegation must not leak any account ref into the body).
  local live leak
  # P-014 hardened bar: author_pubkey must be a receiver-stamped 64-hex substrate
  # LOG key (unforgeable, D-006) — kills a masking-importer false-green.
  live="$(drv_psql a "SELECT count(*) FROM harness_shared.p2p_work_offers WHERE fleet_slug='$slug' AND origin='remote' AND status='open' AND record_version>=1 AND local_disposition IS NULL AND author_pubkey ~ '^[0-9a-f]{64}\$';" 2>/dev/null | tr -d '[:space:]')"
  if [ "$live" = "0" ] || [ -z "$live" ]; then
    echo "seat-offer FAIL — remote seat-offer on a is not a live open v1+ substrate-attributed record (origin/author_pubkey check)"
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

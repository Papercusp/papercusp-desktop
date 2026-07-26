#!/usr/bin/env bash
# seat-offer-diag.selftest.sh — guards the WI-6179 b→a failure discriminator in
# scenarios/seat-offer.sh.
#
# WHY THIS EXISTS. seat_offer's FAIL used to say only "published on b but not
# verified/applied on a", which collapses three materially different faults into
# one sentence — and the on-FAIL triage bundle cannot separate them either
# (verified on bundle 170106-seat_offer: grepping the offer slug returns 0 hits in
# BOTH 660K+ serve.logs; the publish/apply path logs nothing addressable). Only
# ONE of the three readings is "environmental / convergence timing", so a leg that
# cannot name which one keeps donating its failures to the WI-5639 write-off pile.
# That is exactly how WI-5064's hard ordering bug hid behind a leg whose own
# message asserted "RIG/ENVIRONMENTAL" for three straight runs.
#
# WHAT IT ASSERTS. The classifier's four real branches plus its unreadable-DB
# branch, driven through a stubbed drv_psql (hermetic: no docker, no ssh, no
# network, no PG — runs in well under a second), AND a static assertion that the
# step-4 FAIL line still calls the classifier, so the wiring cannot be silently
# dropped while these branch tests keep passing.
#
#   bash bin/lib/seat-offer-diag.selftest.sh      # exit 0 = PASS, 1 = FAIL
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCN="$DIR/scenarios/seat-offer.sh"

fails=0
ok()   { echo "  ✓ $1"; }
bad()  { echo "  ✗ $1"; fails=$((fails + 1)); }

[ -f "$SCN" ] || { echo "FAIL — cannot find $SCN"; exit 1; }

# matrix_register is defined by the runner, not by the scenario file; stub it so
# sourcing the scenario in isolation is clean rather than noisy-but-tolerated.
matrix_register() { :; }

# shellcheck disable=SC1090
source "$SCN"

declare -f _soffer_diag_b_to_a >/dev/null \
  || { echo "FAIL — _soffer_diag_b_to_a missing from $SCN (WI-6179 discriminator removed?)"; exit 1; }

# The stub answers by SQL shape, mirroring the four reads the classifier makes.
# CASE_* are set per case below.
drv_psql() {
  case "$1:$2" in
    b:*quarantined_at*)            printf '%s\n' "$CASE_QUAR" ;;
    b:*"drained_at IS NULL"*)      printf '%s\n' "$CASE_PENDING" ;;
    b:*substrate_outbox*)          printf '%s\n' "$CASE_TOTAL" ;;
    a:*string_agg*)                printf '%s\n' "$CASE_BREAK" ;;
    a:*count*)                     printf '%s\n' "$CASE_ANY" ;;
    *)                             printf '\n' ;;
  esac
}

expect_verdict() {
  local name="$1" want="$2" got
  got="$(_soffer_diag_b_to_a mx-seatoffer-selftest)"
  if printf '%s' "$got" | grep -q "$want"; then ok "$name → $want"; else bad "$name — wanted '$want', got: $got"; fi
}

echo "── seat-offer-diag.selftest: WI-6179 b→a discriminator ──"

# Ambient the matrix runner exports before any scenario runs; the outbox reads are
# harness_slug-scoped by it (multi-tenant table). Set it here or `set -u` aborts the
# classifier mid-way and the branch cases below fail for the wrong reason.
RIG_HIVE_ID='mx-selftest-pot'

# 1. Quarantined outbox row on b ⇒ it never left b. Outranks every later branch:
#    a quarantined row is excluded from the drain batch (mig 645), so "a has
#    nothing" is a CONSEQUENCE here, not independent evidence.
CASE_TOTAL=3 CASE_PENDING=0 CASE_QUAR=1 CASE_ANY=0 CASE_BREAK='<no row for this fleet>'
expect_verdict "quarantined outbox on b" NEVER-LEFT-B

# 2. Undrained (not yet quarantined) row on b ⇒ also never left b, different cause.
CASE_TOTAL=3 CASE_PENDING=2 CASE_QUAR=0 CASE_ANY=0 CASE_BREAK='<no row for this fleet>'
expect_verdict "undrained outbox on b" NEVER-LEFT-B

# 3. b drained cleanly AND a has a row for the fleet, just not origin='remote' ⇒
#    the record arrived and the APPLY path is the fault. This is the branch that
#    must never be reported as timing.
CASE_TOTAL=3 CASE_PENDING=0 CASE_QUAR=0 CASE_ANY=1 CASE_BREAK='local/open=1'
expect_verdict "arrived with wrong origin" ARRIVED-NOT-REMOTE

# 4. b drained everything and a has nothing at all ⇒ lost in transit or dropped
#    before the projection wrote a row. Only here is late-apply/timing plausible.
CASE_TOTAL=3 CASE_PENDING=0 CASE_QUAR=0 CASE_ANY=0 CASE_BREAK='<no row for this fleet>'
expect_verdict "drained, nothing on a" LOST-OR-REFUSED-BEFORE-APPLY

# 5. Both DBs unreadable ⇒ say UNKNOWN. A diagnostic that silently degrades into
#    its own most-innocent branch is worse than none: it would manufacture
#    "timing" verdicts out of a psql outage.
CASE_TOTAL='' CASE_PENDING='' CASE_QUAR='' CASE_ANY='' CASE_BREAK=''
expect_verdict "both DBs unreadable" DIAG-UNAVAILABLE

# 6. STATIC WIRING ASSERT. The branch tests above all pass if the classifier is
#    perfect but nothing calls it, which is precisely the regression that would
#    put the leg back to its one-sentence FAIL. Pin the call site.
if grep -q 'never materialized origin=.remote. on frame a.*_soffer_diag_b_to_a' "$SCN"; then
  ok "step-4 FAIL line still calls the discriminator"
else
  bad "step-4 FAIL line no longer calls _soffer_diag_b_to_a — the leg is back to a one-sentence FAIL"
fi

# 7. TENANT SCOPE. substrate_outbox is keyed (workspace_id, harness_slug), so a bare
# table_name filter counts OTHER hives' rows — an unrelated undrained row would then
# read as NEVER-LEFT-B for this offer. Every outbox read must carry harness_slug.
if [ "$(grep -c "substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug=" "$SCN")" = 3 ]; then
  ok "all 3 substrate_outbox reads are harness_slug-scoped (multi-tenant table)"
else
  bad "substrate_outbox reads must all filter harness_slug — found $(grep -c "substrate_outbox WHERE table_name='p2p_work_offers' AND harness_slug=" "$SCN")/3"
fi

echo
if [ "$fails" = 0 ]; then
  echo "PASS — seat-offer-diag selftest (6/6)"
  exit 0
fi
echo "FAIL — seat-offer-diag selftest: $fails check(s) failed"
exit 1

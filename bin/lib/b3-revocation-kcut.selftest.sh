#!/usr/bin/env bash
# b3-revocation-kcut.selftest.sh — guards the two EI-18712383368117845 probes in
# scenarios/b3-revocation.sh: the K-CUT device resolver and the leak classifier.
#
# WHY THIS EXISTS. Both probes were previously wrong in the one way a live run can
# never reveal — they produced a CONFIDENT verdict that was structurally incapable of
# being different:
#
#   1. K-CUT device resolution. The old lookup took an ARBITRARY element of B's
#      device_attestations array (`jsonb_array_elements(...) ... LIMIT 1`). By order 90,
#      scenario order 60 (attestation_membership LEG2) has merged a SYNTHETIC device into
#      that array: d2="att2dev-${rid}-$RANDOM". That is a label, not a key — it can never
#      equal a base64 member_device_pubkey — so `rig_assert_row_absent ...
#      member_device_pubkey='att2dev-…'` returned "absent" unconditionally and the
#      scenario printed "K-CUT VERIFIED" on EVERY banked run, INCLUDING run 223522
#      (2026-08-06) whose content leg failed with a real leak. Measured in all four banked
#      runs: "B device=att2dev-m1786068697-27155" beside a dump of base64 pubkeys.
#
#   2. Leak classification. The LEAK-detail line called rig_read_content — which returns
#      `harness_slug||'|'||origin`, i.e. table METADATA from the same table and predicate
#      rig_assert_absent had already probed — and labelled a '*|remote' result "READABLE
#      plaintext disclosure". It restated the arrival fact under a label that escalated it.
#      Delivery is not disclosure: revocation is designed as a DECRYPT cut, so a banned
#      member holding sealed bytes is expected behaviour, not a breach.
#
# WHAT IT ASSERTS. Each probe is driven under a stubbed drv_psql across the shapes that
# decide it, INCLUDING a calibration case that must come out the other way — a test where
# every case passes for the same reason is the defect this file exists to prevent.
# Hermetic: no docker, no ssh, no PG, no network.
#
#   bash bin/lib/b3-revocation-kcut.selftest.sh   # exit 0 = PASS
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# B3_SCENARIO_SRC lets a falsifiability probe point this at a MUTATED COPY outside the
# tree (scripts/mutation-probe.sh tier 2) instead of mutating the shared checkout, where
# git-sync would commit the mutant mid-probe. Defaults to the real file.
SCN="${B3_SCENARIO_SRC:-$DIR/scenarios/b3-revocation.sh}"

fails=0
ok()  { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; fails=$((fails + 1)); }

[ -f "$SCN" ] || { echo "FAIL — cannot find $SCN"; exit 1; }

matrix_register() { :; }
# shellcheck disable=SC1090
source "$SCN"

for fn in _rv_key_bearing_device _rv_classify_leak; do
  declare -f "$fn" >/dev/null \
    || { echo "FAIL — $fn missing from $SCN (EI-18712383368117845 probe removed or inlined again?)"; exit 1; }
done

declare -A FRAME_USER=([a]=owner-user [b]=member-user)

# ── The stub. It answers _rv_key_bearing_device's query the way PG would, from a table of
#    (device_pubkey, max epoch it holds a key at) pairs in $STUB_DEVICES: "pk:epoch" rows,
#    where epoch=-1 means "attested but holds no epoch key at all" (the att2dev shape).
#    The stub honours the query's `epoch < $maxep` filter, so the resolver's real
#    discriminating clause is what decides each case — not the stub's mood.
STUB_DEVICES=""
STUB_CALLS=0
drv_psql() {
  local sql="${2:-}"   # drv_psql <inst> <sql>

  STUB_CALLS=$((STUB_CALLS + 1))
  local maxep row pk ep
  maxep="$(printf '%s' "$sql" | sed -n 's/.*k\.epoch < \([0-9]\+\).*/\1/p')"
  [ -n "$maxep" ] || return 0
  for row in $STUB_DEVICES; do
    pk="${row%%:*}"; ep="${row##*:}"
    if [ "$ep" != "-1" ] && [ "$ep" -lt "$maxep" ]; then echo "  $pk  "; return 0; fi
  done
  return 0
}

echo "── b3-revocation-kcut.selftest: EI-18712383368117845 probes ──"

echo "K-CUT device resolver"

# CALIBRATION — the case that must come out NON-EMPTY. Without it, every assertion below
# could be satisfied by a resolver that simply always returns nothing.
STUB_DEVICES="RealPubKeyAAA=:0"
got="$(_rv_key_bearing_device 1)"
[ "$got" = "RealPubKeyAAA=" ] \
  && ok "calibration: a device holding an epoch-0 key resolves at maxep=1 (got '$got')" \
  || bad "calibration FAILED: expected 'RealPubKeyAAA=', got '$got' — the resolver returns nothing even when a key-bearing device exists, so every case below would pass vacuously"

# THE REGRESSION. The exact live shape: the synthetic att2dev device is FIRST in the array
# (as it was in all four banked runs), the real key-bearing device second.
STUB_DEVICES="att2dev-m1786068697-27155:-1 RealPubKeyAAA=:0"
got="$(_rv_key_bearing_device 1)"
[ "$got" = "RealPubKeyAAA=" ] \
  && ok "skips the synthetic att2dev device and resolves the key-bearing one (got '$got')" \
  || bad "resolved '$got' — a device that never held an epoch key makes the absence assert unfalsifiable (the pre-fix behaviour)"

# FAIL-CLOSED. Only the synthetic device attested ⇒ empty ⇒ the caller scores UNMEASURED
# rather than printing K-CUT VERIFIED.
STUB_DEVICES="att2dev-m1786068697-27155:-1"
got="$(_rv_key_bearing_device 1)"
[ -z "$got" ] \
  && ok "returns EMPTY when only the synthetic device is attested (caller must score UNMEASURED, never VERIFIED)" \
  || bad "returned '$got' for a devices set holding no epoch key — this is the exact false VERIFIED that ran on every banked run"

# A device whose only key is AT the post-ban epoch is not a pre-ban holder, so it cannot
# calibrate the cut either.
STUB_DEVICES="RealPubKeyAAA=:1"
got="$(_rv_key_bearing_device 1)"
[ -z "$got" ] \
  && ok "excludes a device whose only key is at the post-ban epoch itself" \
  || bad "returned '$got' for a device with no key BELOW maxep — nothing was cut, so the assert would be vacuous"

echo "leak classifier"

WRITTEN="revocation post-ban (must be ABSENT on banned B)"
got="$(_rv_classify_leak "$WRITTEN" "$WRITTEN")"
[ "$got" = DISCLOSURE ] \
  && ok "exact plaintext title on B ⇒ DISCLOSURE" \
  || bad "exact plaintext match classified '$got' — a real breach would be under-reported"

got="$(_rv_classify_leak "hello-world|remote" "$WRITTEN")"
[ "$got" = SEALED ] \
  && ok "the retracted 'hello-world|remote' metadata reading ⇒ SEALED, not DISCLOSURE" \
  || bad "classified '$got' — this is the exact string the old probe labelled READABLE plaintext disclosure"

got="$(_rv_classify_leak "" "$WRITTEN")"
[ "$got" = UNREADABLE ] \
  && ok "empty read ⇒ UNREADABLE (probe error or sealed), never DISCLOSURE" \
  || bad "classified '$got' — an unread probe must never be reported as a disclosure finding"

echo
if [ "$fails" -eq 0 ]; then echo "b3-revocation-kcut.selftest: PASS"; exit 0; fi
echo "b3-revocation-kcut.selftest: FAIL ($fails)"; exit 1

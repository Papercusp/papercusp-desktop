#!/usr/bin/env bash
# b5-restart.selftest.sh — regression test for the restart_durability matrix
# adapter's failure transcript (EI-21115093867849562).
#
# A failing restart_durability run contains useful passing and failing asserts.
# The adapter used to retain only the ✗/OVERALL projection, throwing away every
# ✓ line before the matrix's per-scenario log could capture it. This test sources
# the shipping adapter and stubs the live scenario, so it is hermetic: no VM,
# SSH, PG, Docker, or network access.
#
#   bash bin/lib/b5-restart.selftest.sh   # exit 0 = PASS, 1 = FAIL
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCEN="$DIR/scenarios/b5-restart.sh"
[ -f "$SCEN" ] || { echo "SKIP: scenario file not found at $SCEN"; exit 0; }
# The production adapter expects the matrix to seed DESKTOP_DIR before sourcing;
# provide that same root explicitly so nounset turns missing test setup into a
# readable failure instead of terminating during the source.
DESKTOP_DIR="$(cd "$DIR/../.." && pwd)"

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

# The scenario adapter registers itself at source time; avoid requiring the real
# matrix runner while still sourcing the exact production file under test.
matrix_register() { :; }
# shellcheck disable=SC1090
source "$SCEN" >/dev/null 2>&1

# ── 1. A failing run keeps both passing and failing assertion lines ───────────
scenario_restart_durability() {
  printf '%s\n' \
    '  ✓ assert-one' \
    '  ✓ assert-three' \
    '  ✗ assert-two' \
    'OVERALL: INCOMPLETE'
  return 1
}
out="$(scn_restart_durability a b 2>&1)"
rc=$?
if [ "$rc" = 1 ] \
  && grep -Fq 'restart durability FAIL — key lines:' <<<"$out" \
  && grep -Fq '✗ assert-two' <<<"$out" \
  && grep -Fq 'OVERALL: INCOMPLETE' <<<"$out"; then
  ok "failing run retains the key failure projection"
else
  bad "failing run lost key lines: rc=$rc out='$out'"
fi

if grep -Fq '── full assert transcript (all ✓/✗) ──' <<<"$out" \
  && grep -Fq '✓ assert-one' <<<"$out" \
  && grep -Fq '✓ assert-three' <<<"$out"; then
  ok "failing run retains every passing assertion in the full transcript"
else
  bad "failing run lost passing assertions: out='$out'"
fi

# ── 2. Success remains terse and does not leak the captured raw transcript ───
scenario_restart_durability() {
  printf '%s\n' '  ✓ assert-one' 'OVERALL: PASS'
  return 0
}
out="$(scn_restart_durability a b 2>&1)"
rc=$?
if [ "$rc" = 0 ] \
  && grep -Fq 'restart durability OK' <<<"$out" \
  && ! grep -Fq 'assert-one' <<<"$out"; then
  ok "successful run keeps its existing concise summary"
else
  bad "successful run changed unexpectedly: rc=$rc out='$out'"
fi

echo "── b5-restart.selftest: $((3 - FAILS))/3 passed ──"
if [ "$FAILS" = 0 ]; then
  echo "OVERALL: PASS"
  exit 0
fi
echo "OVERALL: FAIL ($FAILS failing)"
exit 1

#!/usr/bin/env bash
# restart-settle-barrier.selftest.sh — regression test for the WI-5444 settle-
# or-repair barrier (bin/lib/scenarios/restart-settle-barrier.sh).
#
# Deliberately lives HERE (bin/lib/, not bin/lib/scenarios/) even though it
# tests a scenarios/ file: bin/deb-hetzner-matrix.sh's source_scenarios()
# sources EVERY bin/lib/scenarios/*.sh at the top of a real run — a selftest
# living inside that directory would itself get swept in and its STUBBED
# matrix_register/fed_log/_rd_origin/_rd_poll_remote would silently clobber
# the real ones for the whole live run. Mirrors
# live-federation-gate-reaper.selftest.sh, which avoids the same trap the
# same way (it tests bin/live-federation-gate.sh from outside its sweep too).
#
# Sources the REAL scenario file (the shipping code, not a copy) and exercises
# scn_restart_settle_barrier() against STUBBED _rd_origin/_rd_poll_remote/fed_log
# so this never touches a real rig/SSH/PG — purely local, <1s. Mirrors the
# live-federation-gate-reaper.selftest.sh convention (the four canonical
# TS/Cargo/LLM frameworks don't host shell units; the live matrix is the
# integration test).
#
#   bash bin/lib/restart-settle-barrier.selftest.sh   # exit 0 = PASS, 1 = FAIL
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCEN="$DIR/scenarios/restart-settle-barrier.sh"
[ -f "$SCEN" ] || { echo "SKIP: scenario file not found at $SCEN"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

# ── stubs (matrix_register is a top-level call in the sourced file — stub it
#    as a no-op recorder so sourcing doesn't need the real matrix runner) ────
matrix_register() { : ; }
fed_log() { : ; }

# Controllable fakes for the two real helpers the barrier calls:
#   STUB_ORIGIN     — what _rd_origin returns (e.g. "slug|remote" / "slug|local" / "")
#   STUB_POLL_RC    — the exit code _rd_poll_remote returns
_rd_origin() { printf '%s' "${STUB_ORIGIN:-}"; }
_rd_poll_remote() { return "${STUB_POLL_RC:-1}"; }

# shellcheck disable=SC1090
source "$SCEN"

now() { date +%s; }

reset_env() {
  unset RD_LAST_CANARY_FID RD_LAST_MEMBER RD_LAST_CANARY_WRITE_TS RD_LAST_RAN_AT
  RD_SETTLE_WARN_S=120; RD_SETTLE_FAIL_S=900; RD_SETTLE_WARN_IS_FAIL=0
  STUB_ORIGIN=""; STUB_POLL_RC=1
}

# ── 1. no preceding canary AND order 80 never ran → PASS, no-op, never a forced fail ──
reset_env
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 0 ] && grep -q "didn't run this session" <<<"$out" && grep -q "nothing to settle" <<<"$out" \
  && ok "no-canary, order-80-never-ran → PASS/no-op" \
  || bad "no-canary case: rc=$rc out='$out'"

# ── 1b. WI-5772: order 80 RAN (RD_LAST_RAN_AT set) but left no canary (failed/
#       bailed before its final write) → hard FAIL, never the "didn't run" PASS ──
reset_env
RD_LAST_RAN_AT="$(now)"
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 1 ] && grep -q "OVERALL: FAIL" <<<"$out" && grep -q "RAN this session" <<<"$out" \
  && ! grep -q "didn't run this session" <<<"$out" \
  && ok "ran-but-no-canary → FAIL, distinguished from didn't-run" \
  || bad "ran-but-no-canary case: rc=$rc out='$out'"

# ── 2. already converged, fast (elapsed well under warn bar) → PASS, no ⚠ ────
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 5))"
STUB_ORIGIN="slug1|remote"
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 0 ] && grep -q "OVERALL: PASS" <<<"$out" && ! grep -q '⚠' <<<"$out" \
  && ok "already-converged fast → PASS, no warn" \
  || bad "already-converged-fast case: rc=$rc out='$out'"

# ── 3. already converged, SLOW (elapsed past warn, under fail) → PASS + ⚠ ────
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 300))"
STUB_ORIGIN="slug1|remote"
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 0 ] && grep -q '⚠' <<<"$out" && grep -q "OVERALL: PASS" <<<"$out" \
  && ok "already-converged slow → PASS + warn" \
  || bad "already-converged-slow case: rc=$rc out='$out'"

# ── 4. same as #3 but RD_SETTLE_WARN_IS_FAIL=1 → hard FAIL ───────────────────
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 300))"
STUB_ORIGIN="slug1|remote"; RD_SETTLE_WARN_IS_FAIL=1
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 1 ] && grep -q "OVERALL: FAIL" <<<"$out" \
  && ok "WARN_IS_FAIL=1 escalates a slow-but-converged case to FAIL" \
  || bad "WARN_IS_FAIL case: rc=$rc out='$out'"

# ── 5. not yet converged, poll succeeds within budget → PASS ─────────────────
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 30))"
STUB_ORIGIN=""; STUB_POLL_RC=0
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 0 ] && grep -q "OVERALL: PASS" <<<"$out" \
  && ok "not-yet-converged, poll lands within budget → PASS" \
  || bad "poll-lands case: rc=$rc out='$out'"

# ── 6. not yet converged, ALREADY past the hard deadline → immediate FAIL, no poll needed ──
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 1000))"
STUB_ORIGIN=""; STUB_POLL_RC=0   # even if poll WOULD succeed, budget<=0 must short-circuit
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 1 ] && grep -q "OVERALL: FAIL" <<<"$out" && grep -q "past the 900s hard deadline" <<<"$out" \
  && ok "already past hard deadline → immediate FAIL (no poll)" \
  || bad "past-deadline case: rc=$rc out='$out'"

# ── 7. not yet converged, poll exhausts its budget and never lands → FAIL ────
reset_env
RD_LAST_CANARY_FID="F-X"; RD_LAST_MEMBER="b"; RD_LAST_CANARY_WRITE_TS="$(($(now) - 30))"
STUB_ORIGIN=""; STUB_POLL_RC=1
out="$(scn_restart_settle_barrier)"; rc=$?
[ "$rc" = 1 ] && grep -q "OVERALL: FAIL" <<<"$out" \
  && ok "poll never lands within budget → FAIL" \
  || bad "poll-timeout case: rc=$rc out='$out'"

echo "── restart-settle-barrier.selftest: $((8 - FAILS))/8 passed ──"
[ "$FAILS" = 0 ] && { echo "OVERALL: PASS"; exit 0; }
echo "OVERALL: FAIL ($FAILS failing)"; exit 1

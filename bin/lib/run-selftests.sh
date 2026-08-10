#!/usr/bin/env bash
# run-selftests.sh — aggregate runner for the papercusp-desktop bash
# self-tests (EI-18725214765732588).
#
# These selftests guard the live-federation rig + release-leg scripts —
# exactly the code whose failures are expensive and hard to reproduce — but
# were referenced by NOTHING: no aggregate script, no CI workflow, no green
# gate. Only federation-asserts had a single live caller
# (live-federation-gate.sh), and only inside that gate's own run, never in
# CI. This script is the aggregate; `test:selftests` in package.json runs it,
# and the `desktop-selftests` testing-domains-registry.ts domain surfaces
# each one individually in the Tests tab / admin Testing dashboard.
#
# Verified hermetic before wiring in: synthetic localhost-only HTTP
# listeners + static grep assertions, no docker/ssh/real network. Slower
# than their own "~2s" header claims (30-40s each, mostly python3/bash
# process-startup overhead) but still pure-local — safe to run in any gate.
#
#   bash bin/lib/run-selftests.sh     # exit 0 = all PASS, 1 = at least one FAIL
#
# Every selftest runs even if an earlier one fails (so one red doesn't hide
# a second) — the aggregate's own exit code is the AND of all of them.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS=(
  federation-asserts.selftest.sh
  release-artifacts.selftest.sh
  gen-latest-manifest.selftest.sh
  live-federation-gate-reaper.selftest.sh
  release-local-leg-reaper.selftest.sh
  local-matrix-starvation.selftest.sh
  rig-bank-logs.selftest.sh
  vm-run-env.selftest.sh
  seat-offer-diag.selftest.sh
  b9-attestation-precondition.selftest.sh
  restart-settle-barrier.selftest.sh
  rig-wait-converged.selftest.sh
  roster-scope.selftest.sh
  deployed-state-guards.selftest.sh
  inno-legacy-reaper.selftest.sh
  rust-path-remap.selftest.sh
  disk-preflight.selftest.sh
)

# COMPLETENESS GATE (WI-6181) — fixed; this array is no longer silently partial.
#
# The array above is the source of truth for WHAT RUNS; the files on disk are the
# source of truth for WHAT EXISTS. Drift between them is how EI-18725214765732588's
# fix went dark TWICE: a hand-maintained list plus a new *.selftest.sh equals a
# guard that nothing executes, and nothing anywhere complains. The three files that
# were dark at the time this gate was written (restart-settle-barrier,
# rig-wait-converged, roster-scope) are now listed above; each was run standalone and
# passed 8/8, 4/4 and 4/4 respectively before being wired in, so adding them does not
# introduce a new red.
#
# We FAIL on drift rather than auto-running whatever is on disk, deliberately: a new
# selftest must be adopted by a deliberate act, because silently auto-running an
# unvetted file inside the live-federation gate could red the gate for a reason nobody
# chose. Both directions are checked — an unlisted file (a guard nothing runs) and a
# listed-but-absent file (a stale entry after a rename/delete).
#
# The cross-surface half of this invariant — disk == TESTS == the `desktop-selftests`
# testing-domains registry domain — is asserted by
# packages/operator-core/lib/__tests__/desktop-selftests-registry-complete.test.ts,
# so registry drift reds a fast unit test rather than this gate.
DRIFT=0
declare -A LISTED=()
for t in "${TESTS[@]}"; do LISTED["$t"]=1; done

UNLISTED=()
shopt -s nullglob
for f in "$DIR"/*.selftest.sh; do
  b="$(basename "$f")"
  [ -n "${LISTED[$b]:-}" ] || UNLISTED+=("$b")
done
shopt -u nullglob

MISSING=()
for t in "${TESTS[@]}"; do
  [ -f "$DIR/$t" ] || MISSING+=("$t")
done

if [ "${#UNLISTED[@]}" -gt 0 ]; then
  echo "FAIL — ${#UNLISTED[@]} *.selftest.sh file(s) exist on disk but are NOT in the TESTS array, so nothing runs them: ${UNLISTED[*]}" >&2
  echo "       Add them to TESTS in bin/lib/run-selftests.sh, and to the 'desktop-selftests' domain in packages/operator-core/lib/testing-domains-registry.ts." >&2
  DRIFT=1
fi
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "FAIL — ${#MISSING[@]} TESTS entr(ies) have no file on disk (stale after a rename/delete?): ${MISSING[*]}" >&2
  DRIFT=1
fi
if [ "$DRIFT" -ne 0 ]; then
  exit 1
fi

FAILED=()
for t in "${TESTS[@]}"; do
  echo "=== $t ==="
  if bash "$DIR/$t"; then
    echo "--- $t: PASS"
  else
    echo "--- $t: FAIL"
    FAILED+=("$t")
  fi
  echo
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "FAIL — ${#FAILED[@]}/${#TESTS[@]} papercusp-desktop selftest(s) failed: ${FAILED[*]}"
  exit 1
fi
echo "PASS — all ${#TESTS[@]} papercusp-desktop selftests green"

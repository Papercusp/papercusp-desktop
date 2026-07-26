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
# a second) — the aggregate's own exit code is the AND of all seven.
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
)

# NOTE (WI-6181): this array is HAND-MAINTAINED, so a newly added *.selftest.sh is
# silently run by nothing — which is how EI-18725214765732588's fix went dark a
# second time. At the time of writing THREE files on disk are still unlisted
# (restart-settle-barrier, rig-wait-converged, roster-scope; all three pass). The
# durable fix — enumerate *.selftest.sh here and FAIL on any unlisted file, plus a
# Vitest asserting disk == this array == the desktop-selftests registry domain — is
# tracked at WI-6181. Do not add a selftest without adding it here as well.

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

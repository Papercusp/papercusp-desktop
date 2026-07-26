#!/usr/bin/env bash
# deployed-state-guards.selftest.sh — focused unit test for the WI-6212
# DEPLOYED-STATE preconditions in scripts/linux-test-vm/lib/common.sh:
# vm_assert_uniform_sidecar / vm_assert_build_provenance / vm_assert_dht_isolated.
#
#   bash bin/lib/deployed-state-guards.selftest.sh    # exit 0 = PASS, 1 = FAIL
#
# WHY THIS EXISTS. Every one of these guards was written after the rig produced a
# confident, reproducible, WRONG answer that nothing anywhere contradicted:
#   - heterogeneous builds  → WI-6209 was misdiagnosed as a product transport bug
#     for hours; the failing direction was simply the one dialed by the stale VM.
#   - unprovenanced build   → both VMs uniformly stale looks IDENTICAL to both
#     being current, so the uniformity guard alone cannot see it.
#   - public DHT            → a relaunch omitting ~/fed.env silently joins the
#     PUBLIC DHT; nothing fails, the rig just quietly measures outside peers.
# A guard against a silent-wrong-answer class is worthless if it is itself
# silently broken, so each assertion below has a CONTROL proving it REJECTS.
#
# Hermetic: the VM-touching primitives (vm_deployed_sidecar_id, vm_build_provenance,
# vm_ssh) are stubbed. No VM, no ssh, no network, ~0s.
#
# Why a bash self-test and not Vitest: the unit under test is bash. Same rationale
# as federation-asserts.selftest.sh.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMON="$DIR/../../scripts/linux-test-vm/lib/common.sh"
[ -f "$COMMON" ] || { echo "SKIP: $COMMON not found"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

# run_guard <stub-body> <guard-invocation> [env assignments...] → exit code
# Each case runs in its own bash so a `die` (which exits) cannot kill this runner.
run_guard() {
  local stub="$1" call="$2"; shift 2
  env "$@" bash -c "
    source '$COMMON' >/dev/null 2>&1
    $stub
    $call
  " >/dev/null 2>&1
}

echo "=== vm_assert_uniform_sidecar ==="
run_guard 'vm_deployed_sidecar_id() { echo "abc123def456 43001503"; }' \
  'vm_assert_uniform_sidecar vm1 vm2' \
  && ok "identical sidecar bundles on both VMs → accepted" \
  || bad "uniform sidecars were REJECTED — the guard now blocks a valid rig"

run_guard 'vm_deployed_sidecar_id() { [ "$1" = vm1 ] && echo "aaaaaaaaaaaa 100" || echo "bbbbbbbbbbbb 200"; }' \
  'vm_assert_uniform_sidecar vm1 vm2' \
  && bad "CONTROL: a HETEROGENEOUS rig was ACCEPTED — the WI-6209 misdiagnosis is back" \
  || ok "CONTROL: heterogeneous sidecar bundles → refused"

run_guard 'vm_deployed_sidecar_id() { echo ""; }' \
  'vm_assert_uniform_sidecar vm1' \
  && bad "CONTROL: an UNREADABLE sidecar was accepted — an unidentifiable build must stop the run" \
  || ok "CONTROL: unreadable sidecar bundle → refused"

echo "=== vm_assert_build_provenance ==="
run_guard 'vm_build_provenance() { echo "a1b2c3d|0.0.13"; }' \
  'vm_assert_build_provenance vm1' \
  && ok "a provenanced build (real sha + real version) → accepted" \
  || bad "a properly-provenanced build was REJECTED"

# The live WI-6209 rig state: /api/health {"sha":null,"version":"0.0.0"}.
run_guard 'vm_build_provenance() { echo "|0.0.0"; }' \
  'vm_assert_build_provenance vm1' \
  && bad "CONTROL: an UNPROVENANCED build (version 0.0.0) was ACCEPTED — uniform-but-stale stays invisible" \
  || ok "CONTROL: unprovenanced build (version 0.0.0, sha null) → refused"

run_guard 'vm_build_provenance() { echo "|0.0.13"; }' \
  'vm_assert_build_provenance vm1' \
  && bad "CONTROL: a build with a real version but NO sha was accepted" \
  || ok "CONTROL: version present but sha null → refused"

run_guard 'vm_build_provenance() { echo ""; }' \
  'vm_assert_build_provenance vm1' \
  && bad "CONTROL: no operator answering /api/health was accepted" \
  || ok "CONTROL: no operator answered /api/health → refused"

run_guard 'vm_build_provenance() { echo "|0.0.0"; }' \
  'vm_assert_build_provenance vm1' RIG_ALLOW_UNPROVENANCED=1 \
  && ok "RIG_ALLOW_UNPROVENANCED=1 downgrades an unprovenanced build to a warning" \
  || bad "the documented RIG_ALLOW_UNPROVENANCED escape hatch does not work"

run_guard 'vm_build_provenance() { echo "a1b2c3d|0.0.13"; }' \
  'vm_assert_build_provenance vm1' RIG_EXPECT_SHA=a1b2c3d \
  && ok "RIG_EXPECT_SHA matching the running build → accepted" \
  || bad "RIG_EXPECT_SHA rejected a build whose sha MATCHES the commit under test"

run_guard 'vm_build_provenance() { echo "a1b2c3d|0.0.13"; }' \
  'vm_assert_build_provenance vm1' RIG_EXPECT_SHA=deadbee \
  && bad "CONTROL: a rig STALE relative to RIG_EXPECT_SHA was accepted" \
  || ok "CONTROL: build sha != RIG_EXPECT_SHA → refused as stale"

echo "=== vm_assert_dht_isolated ==="
run_guard 'vm_ssh() { echo "[swarm] DHT bootstrap = ISOLATED 10.77.0.1:41286"; }' \
  'vm_assert_dht_isolated vm1' \
  && ok "an ISOLATED testnet bootstrap → accepted" \
  || bad "an isolated DHT bootstrap was REJECTED"

run_guard 'vm_ssh() { echo "[swarm] DHT bootstrap = PUBLIC DHT"; }' \
  'vm_assert_dht_isolated vm1' \
  && bad "CONTROL: a PUBLIC DHT bootstrap was ACCEPTED — outside peers can silently join the rig" \
  || ok "CONTROL: PUBLIC DHT bootstrap → refused"

run_guard 'vm_ssh() { echo ""; }' \
  'vm_assert_dht_isolated vm1' \
  && bad "CONTROL: a MISSING bootstrap line was accepted — which DHT it joined is unknown" \
  || ok "CONTROL: no 'DHT bootstrap' line in the app log → refused"

echo
if [ "$FAILS" -eq 0 ]; then echo "PASS — deployed-state guards self-test green"; exit 0; fi
echo "FAIL — $FAILS assertion(s) failed"; exit 1

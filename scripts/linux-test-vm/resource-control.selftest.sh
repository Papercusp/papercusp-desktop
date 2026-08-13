#!/usr/bin/env bash
# Focused regression test for WI-38429's test-VM resource envelope. It never
# launches QEMU or talks to the real user manager: the systemd doors are Bash
# function seams and the exact argv contract is asserted below.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

assert_eq() {
  local want="$1" got="$2" label="$3"
  [ "$got" = "$want" ] && ok "$label" || bad "$label — expected '$want', got '$got'"
}

contains_arg() {
  local want="$1" arg
  for arg in "${CAPTURED_ARGS[@]}"; do [ "$arg" = "$want" ] && return 0; done
  return 1
}

echo "1. derived memory envelopes"
assert_eq "12288 16384 4096" "$(testvm_memory_envelope 8192)" \
  "8 GiB guest gets reclaim cushion, hard ceiling, and 4 GiB swap floor"
assert_eq "20480 24576 8192" "$(testvm_memory_envelope 16384)" \
  "default 16 GiB guest is bounded to 20/24 GiB memory and 8 GiB swap"
assert_eq "36864 40960 16384" "$(testvm_memory_envelope 32768)" \
  "32 GiB guest keeps swap capped at 16 GiB"
if (testvm_memory_envelope 0 >/dev/null 2>&1); then
  bad "zero guest RAM was accepted"
else
  ok "non-positive guest RAM fails closed"
fi

echo "2. systemd scope launch contract"
CAPTURED_ARGS=()
fake_systemd_escape() {
  [ "$1" = "--template=papercup-testvm@.scope" ] || return 91
  printf 'papercup-testvm@%s.scope\n' "$2"
}
fake_systemd_run() { CAPTURED_ARGS=("$@"); }
PAPERCUSP_TESTVM_SYSTEMD_ESCAPE=fake_systemd_escape
PAPERCUSP_TESTVM_SYSTEMD_RUN=fake_systemd_run

run_testvm_scoped clean 16384 qemu-system-x86_64 -name papercusp-testvm-clean -daemonize

for expected in \
  --user --scope --quiet --collect \
  papercup-testvm@clean.scope \
  MemoryAccounting=yes MemoryHigh=20480M MemoryMax=24576M MemorySwapMax=8192M \
  qemu-system-x86_64 -name papercusp-testvm-clean -daemonize; do
  contains_arg "$expected" && ok "launch includes $expected" || bad "launch omitted $expected"
done

unit_index=-1 separator_index=-1 qemu_index=-1
for i in "${!CAPTURED_ARGS[@]}"; do
  [ "${CAPTURED_ARGS[$i]}" = "--unit" ] && unit_index="$i"
  [ "${CAPTURED_ARGS[$i]}" = "--" ] && separator_index="$i"
  [ "${CAPTURED_ARGS[$i]}" = "qemu-system-x86_64" ] && qemu_index="$i"
done
if [ "$unit_index" -ge 0 ] && [ "${CAPTURED_ARGS[$((unit_index + 1))]}" = "papercup-testvm@clean.scope" ]; then
  ok "escaped scope name is passed as --unit's value"
else
  bad "escaped scope name is not wired to --unit"
fi
if [ "$separator_index" -ge 0 ] && [ "$qemu_index" -eq $((separator_index + 1)) ]; then
  ok "QEMU argv begins immediately after systemd-run's -- separator"
else
  bad "QEMU argv is not isolated behind systemd-run's -- separator"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "PASS — Linux test-VM resource-control self-test"
  exit 0
fi
echo "FAIL — $FAILS assertion(s) failed"
exit 1

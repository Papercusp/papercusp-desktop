#!/usr/bin/env bash
# local-matrix-starvation.selftest.sh — regression test for the local-matrix
# frame-starvation downgrade (WI-5319/WI-5329) in bin/live-federation-gate.sh.
#
# WHY: restart_durability/reconnect_catchup/replication_soak REDs on the local-matrix
# leg were root-caused (WI-5329) to sustained host CPU oversubscription blowing the
# CPU-pinned frames' 30s substrate-boot timeout — NOT a merge/apply/admission logic
# bug. The gate's own STORM_GATE comment already claimed the frame-local
# `[event-loop-lag] ... maxMs` signal in the banked serve.logs was checked "per
# WI-5319", but no such check existed anywhere (host loadavg is a single
# end-of-run sample and can miss a mid-run starvation spike that already caused the
# failure). This self-test proves, on the REAL gate functions:
#   1. local_matrix_only_starvation_prone_fails: true only when EVERY failing
#      scenario name is in the restart-heavy whitelist (never masks an unrelated
#      genuine regression, e.g. concurrent_lww).
#   2. check_local_matrix_frame_starvation: true only when a banked frame serve.log
#      NEWER than the leg's start timestamp shows event-loop-lag maxMs > 1000ms.
#   3. The combination (both true) is what the gate wires as the downgrade gate —
#      exercised end-to-end via the three scenarios below.
# It uses a scratch RIG_BANK_DIR (never the real ~/.papercusp/live-fed-gate/triage)
# and synthetic fixtures — no docker/rig run.
#
#   bash bin/lib/local-matrix-starvation.selftest.sh   # exit 0 = PASS, 1 = FAIL
#
# Why a bash self-test and not Vitest: the unit under test is bash. Mirrors
# federation-asserts.selftest.sh / live-federation-gate-reaper.selftest.sh — the
# four canonical TS/Cargo/LLM frameworks don't host shell units; the live gate is
# the integration test.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$DIR/../live-federation-gate.sh"

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

[ -f "$GATE" ] || { echo "SKIP: gate script not found at $GATE"; exit 0; }

# ── Extract the two starvation-downgrade functions (+ their shared whitelist var)
#    from the REAL gate source and eval them, so this test exercises the shipping
#    code (not a copy). ──
FN_SRC="$(sed -n '/^STARVATION_PRONE_SCENARIOS=/p;/^local_matrix_only_starvation_prone_fails() {/,/^}/p;/^check_local_matrix_frame_starvation() {/,/^}/p' "$GATE")"
if ! grep -q 'local_matrix_only_starvation_prone_fails()' <<<"$FN_SRC" \
  || ! grep -q 'check_local_matrix_frame_starvation()' <<<"$FN_SRC"; then
  echo "SKIP: could not extract starvation-downgrade functions from $GATE (refactored/renamed?)"
  echo "      → if they were intentionally reshaped, update this selftest to match."
  exit 0
fi
eval "$FN_SRC"

WORK_DIR="$(mktemp -d /tmp/local-matrix-starvation-selftest.XXXXXX)"
BANK_DIR="$WORK_DIR/bank"
mkdir -p "$BANK_DIR"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT INT TERM

# matrix_out <path> <FAIL-scenario-names...> — writes a local-matrix.out fixture in
# the REAL summary-table format deb-hetzner-matrix.sh emits
# (`printf "  %-4s  %-26s %s\n" "$st" "$id" "$line"`), one PASS line for a control
# scenario plus one FAIL line per requested name.
matrix_out() {
  local path="$1"; shift
  { printf '  %-4s  %-26s %s\n' PASS directory_sync '✓ converged'
    for name in "$@"; do
      printf '  %-4s  %-26s %s\n' FAIL "$name" '✗ NO-DUP FAIL: something'
    done
  } >"$path"
}

# ── 1. local_matrix_only_starvation_prone_fails ─────────────────────────────────
ALL_KNOWN_OUT="$WORK_DIR/all-known.out"
matrix_out "$ALL_KNOWN_OUT" restart_durability reconnect_catchup
if local_matrix_only_starvation_prone_fails "$ALL_KNOWN_OUT"; then
  ok "only-starvation-prone-fails: restart_durability+reconnect_catchup → true"
else
  bad "only-starvation-prone-fails: whitelisted-only FAIL set wrongly read as false (downgrade would never fire)"
fi

MIXED_OUT="$WORK_DIR/mixed.out"
matrix_out "$MIXED_OUT" restart_durability concurrent_lww
if local_matrix_only_starvation_prone_fails "$MIXED_OUT"; then
  bad "only-starvation-prone-fails: a non-whitelisted FAIL (concurrent_lww) alongside restart_durability wrongly read as true — would mask a genuine regression"
else
  ok "only-starvation-prone-fails: a non-whitelisted co-FAIL correctly keeps this false"
fi

NO_FAIL_OUT="$WORK_DIR/no-fail.out"
matrix_out "$NO_FAIL_OUT"
if local_matrix_only_starvation_prone_fails "$NO_FAIL_OUT"; then
  bad "only-starvation-prone-fails: an out file with ZERO FAIL lines wrongly read as true"
else
  ok "only-starvation-prone-fails: zero-FAIL out file correctly reads as false (nothing to downgrade)"
fi

if local_matrix_only_starvation_prone_fails "$WORK_DIR/does-not-exist.out"; then
  bad "only-starvation-prone-fails: a missing out file wrongly read as true"
else
  ok "only-starvation-prone-fails: a missing out file correctly reads as false"
fi

# ── 2. check_local_matrix_frame_starvation ──────────────────────────────────────
START_TS="$(date +%s)"
sleep 1.1   # ensure "newer than start" is unambiguous at 1s mtime granularity

RIG_BANK_DIR="$BANK_DIR" check_local_matrix_frame_starvation "$START_TS" \
  && bad "frame-starvation: an EMPTY bank dir (no serve logs at all) wrongly read as true" \
  || ok "frame-starvation: an empty bank dir correctly reads as false"

# A banked log present but with only healthy (<1s) event-loop-lag readings.
cat >"$BANK_DIR/serve-pcusp-rig-a.log" <<'EOF'
[event-loop-lag] high loop delay — host is CPU-bound on the main thread maxMs: 240.5
[event-loop-lag] high loop delay — host is CPU-bound on the main thread maxMs: 610.0
EOF
RIG_BANK_DIR="$BANK_DIR" check_local_matrix_frame_starvation "$START_TS" \
  && bad "frame-starvation: sub-1000ms event-loop-lag readings wrongly read as starvation" \
  || ok "frame-starvation: sub-1000ms event-loop-lag readings correctly do NOT trip the check"

# Now add a genuinely starved reading (>1000ms) to a NEWER banked log.
sleep 1.1
cat >"$BANK_DIR/serve-pcusp-rig-b.log" <<'EOF'
[event-loop-lag] high loop delay — host is CPU-bound on the main thread maxMs: 1240.0
boot timeout after 30000ms
EOF
RIG_BANK_DIR="$BANK_DIR" check_local_matrix_frame_starvation "$START_TS" \
  && ok "frame-starvation: a >1000ms event-loop-lag reading in a newer banked log correctly trips the check" \
  || bad "frame-starvation: a genuine >1000ms starvation reading was MISSED (downgrade would never fire on a real starved run)"

# A starved log OLDER than the leg's start timestamp must NOT count (stale/previous run).
OLD_BANK_DIR="$WORK_DIR/bank-old"
mkdir -p "$OLD_BANK_DIR"
cat >"$OLD_BANK_DIR/serve-pcusp-rig-a.log" <<'EOF'
[event-loop-lag] high loop delay — host is CPU-bound on the main thread maxMs: 5000.0
EOF
touch -d '@1' "$OLD_BANK_DIR/serve-pcusp-rig-a.log"   # epoch 1 — long before any real start_ts
LATER_TS="$(date +%s)"
RIG_BANK_DIR="$OLD_BANK_DIR" check_local_matrix_frame_starvation "$LATER_TS" \
  && bad "frame-starvation: a STALE (pre-leg-start) banked log wrongly counted as this run's evidence" \
  || ok "frame-starvation: a stale banked log older than the leg start is correctly ignored"

# ── 3. end-to-end: the gate's own combination gate ──────────────────────────────
# Whitelisted-only FAIL + fresh starvation evidence ⇒ both true ⇒ gate would downgrade.
if local_matrix_only_starvation_prone_fails "$ALL_KNOWN_OUT" \
  && RIG_BANK_DIR="$BANK_DIR" check_local_matrix_frame_starvation "$START_TS"; then
  ok "end-to-end: whitelisted-only FAIL + fresh starvation evidence ⇒ downgrade fires"
else
  bad "end-to-end: whitelisted-only FAIL + fresh starvation evidence should have combined to fire the downgrade"
fi
# Mixed (non-whitelisted) FAIL + the SAME starvation evidence must still NOT downgrade.
if local_matrix_only_starvation_prone_fails "$MIXED_OUT" \
  && RIG_BANK_DIR="$BANK_DIR" check_local_matrix_frame_starvation "$START_TS"; then
  bad "end-to-end: a non-whitelisted co-FAIL must never be downgraded, even with real starvation evidence present"
else
  ok "end-to-end: a non-whitelisted co-FAIL correctly stays FAIL despite starvation evidence"
fi

# ── 4. structural: the gate actually wires the combination into a downgrade ─────
if grep -qE 'local_matrix_only_starvation_prone_fails.*&&' "$GATE" \
  && grep -q 'check_local_matrix_frame_starvation' "$GATE" \
  && grep -q 'SKIPPED-STARVATION' "$GATE"; then
  ok "gate wires both predicates + the SKIPPED-STARVATION downgrade result"
else
  bad "gate no longer wires the starvation downgrade — a later edit may have dropped it"
fi

echo
if [ "$FAILS" -eq 0 ]; then
  echo "local-matrix-starvation selftest: PASS"
  exit 0
else
  echo "local-matrix-starvation selftest: FAIL ($FAILS)"
  exit 1
fi

#!/usr/bin/env bash
# rig-bank-logs.selftest.sh — regression test for rig_bank_logs() in
# deb-hetzner-rig.sh, specifically the EI-18660101091813036 (2026-07-26) fix:
# an optional `tag` arg so a FAILING scenario can bank serve.log MID-RUN
# (deb-hetzner-matrix.sh's scenario loop now calls `rig_bank_logs "$id"` on
# every FAIL), not only once at the very end via the EXIT trap. Guards the
# regression this issue exists to prevent: a killed/never-clean-exit run, or
# an investigation into scenario N's failure after scenario N+3 already
# overwrote the frame's (cumulative) serve.log picture, silently loses its
# evidence again.
#
# Lives in bin/lib/ (not bin/lib/scenarios/) for the same reason
# rig-wait-converged.selftest.sh does: deb-hetzner-matrix.sh's
# source_scenarios() sources every bin/lib/scenarios/*.sh at the top of a
# real run, so a selftest living there would be swept in and its stubbed
# drv_exec/fed_log would silently clobber the real ones for the whole run.
#
# Sources the REAL rig lib (the shipping code, not a copy) and exercises
# rig_bank_logs() against STUBBED drv_exec/drv_applog/fed_log, so this never
# touches a real rig/docker/SSH — purely local, <1s.
#
#   bash bin/lib/rig-bank-logs.selftest.sh   # exit 0 = PASS, 1 = FAIL
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIB="$DIR/deb-hetzner-rig.sh"
[ -f "$LIB" ] || { echo "SKIP: rig lib not found at $LIB"; exit 0; }

FAILS=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }

fed_log() { : ; }

# shellcheck disable=SC1090
source "$LIB" >/dev/null 2>&1 || true

# ── stubs MUST come after the source: the rig lib defines the real drv_*. ──
drv_exec() {  # <inst> — reads the remote "command" off stdin, ignored; returns
              # deterministic fake content keyed by frame so we can assert on it.
  local inst="$1" cmd; cmd="$(cat)"
  case "$cmd" in
    *loadavg*) echo "FAKE-LOADAVG-$inst" ;;
    *)         echo "FAKE-SERVE-LOG-CONTENT-$inst" ;;
  esac
}
drv_applog() { echo "/home/pcusp/serve.log"; }
fed_log() { : ; }

BANK_TMP="$(mktemp -d)"
WORK_TMP="$(mktemp -d)"
trap 'rm -rf "$BANK_TMP" "$WORK_TMP"' EXIT

reset_env() {
  RIG_BANK_DIR="$BANK_TMP/bank-$RANDOM"; mkdir -p "$RIG_BANK_DIR"
  RIG_BANK_KEEP=200
  RIG_WORK=""
  declare -ga RIG_FRAMES=(a b)
  declare -gA FRAME_IP=([a]=10.99.0.11 [b]=10.99.0.12)
}

# ── 1. no tag (the original end-of-run call shape) → stamp has NO trailing tag ─
reset_env
rig_bank_logs
files="$(ls "$RIG_BANK_DIR"/serve-a-*.log 2>/dev/null)"
if [ -n "$files" ] && ! grep -qE '^serve-a-[0-9]{6}-.+\.log$' <<<"$(basename "$files")"; then
  ok "no-tag call → plain HHMMSS stamp, no trailing tag in the filename"
else
  bad "no-tag call produced unexpected filename(s): $files"
fi

# ── 2. content is actually banked per frame (both a and b) ───────────────────
reset_env
rig_bank_logs
a_file="$(ls "$RIG_BANK_DIR"/serve-a-*.log 2>/dev/null | head -1)"
b_file="$(ls "$RIG_BANK_DIR"/serve-b-*.log 2>/dev/null | head -1)"
if [ -f "$a_file" ] && [ -f "$b_file" ] \
  && grep -q "FAKE-SERVE-LOG-CONTENT-a" "$a_file" \
  && grep -q "FAKE-SERVE-LOG-CONTENT-b" "$b_file" \
  && grep -q "FAKE-LOADAVG-a" "$a_file"; then
  ok "banks per-frame serve.log content for every frame in RIG_FRAMES"
else
  bad "missing/empty per-frame bank files: a='$a_file' b='$b_file'"
fi

# ── 3. THE FIX: a tag arg (a scenario id) is folded into the stamp ────────────
reset_env
rig_bank_logs "restart_durability"
tagged="$(ls "$RIG_BANK_DIR"/serve-a-*-restart_durability.log 2>/dev/null | head -1)"
if [ -f "$tagged" ] && grep -q "FAKE-SERVE-LOG-CONTENT-a" "$tagged"; then
  ok "tag arg (scenario id) is folded into the banked filename — mid-run per-scenario bank works"
else
  bad "tagged bank file not found/empty — expected serve-a-<HHMMSS>-restart_durability.log, dir has: $(ls "$RIG_BANK_DIR" 2>/dev/null | tr '\n' ' ')"
fi

# ── 4. two on-FAIL banks in the same run (different scenario ids) both land ───
reset_env
rig_bank_logs "scenario_one"
rig_bank_logs "scenario_two"
n_one="$(ls "$RIG_BANK_DIR"/serve-a-*-scenario_one.log 2>/dev/null | wc -l)"
n_two="$(ls "$RIG_BANK_DIR"/serve-a-*-scenario_two.log 2>/dev/null | wc -l)"
if [ "$n_one" = 1 ] && [ "$n_two" = 1 ]; then
  ok "multiple on-FAIL banks in one run each land as their OWN distinctly-tagged file (no clobber)"
else
  bad "expected exactly 1 file per tag, got scenario_one=$n_one scenario_two=$n_two"
fi

# ── 5. RIG_FRAMES empty → still LOUD (WI-5380 regression), tag or not ─────────
reset_env
declare -ga RIG_FRAMES=()
rig_bank_logs "some_scenario"
empty_marker="$(ls "$RIG_BANK_DIR"/BANK-EMPTY-*.txt 2>/dev/null | head -1)"
if [ -f "$empty_marker" ]; then
  ok "RIG_FRAMES empty (even with a tag) still writes the loud BANK-EMPTY marker — WI-5380 class not silently reintroduced"
else
  bad "no BANK-EMPTY marker written when RIG_FRAMES was empty"
fi

# ── 6. RIG_WORK's scn.*.log files are still copied in (untouched by the fix) ──
reset_env
RIG_WORK="$WORK_TMP"
echo "scenario raw output" >"$RIG_WORK/scn.restart_durability.log"
rig_bank_logs "restart_durability"
scn_bank="$(ls "$RIG_BANK_DIR"/scn.restart_durability-*.log 2>/dev/null | head -1)"
if [ -f "$scn_bank" ] && grep -q "scenario raw output" "$scn_bank"; then
  ok "RIG_WORK/scn.*.log per-scenario raw-output banking is unaffected by the tag-arg change"
else
  bad "scn.*.log bank missing/empty: $scn_bank"
fi

echo
if [ "$FAILS" = 0 ]; then echo "PASS — rig_bank_logs selftest"; exit 0; fi
echo "FAIL — $FAILS check(s) failed"; exit 1

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

# ── 5. RIG_FRAMES empty AFTER frames were registered → still LOUD (WI-5380 ───
#      regression), tag or not. This is the genuine state-loss case: frames
#      WERE registered earlier in the run (RIG_FRAMES_EVER_REGISTERED>0) and
#      something wiped RIG_FRAMES since.
reset_env
declare -ga RIG_FRAMES=()
RIG_FRAMES_EVER_REGISTERED=1
rig_bank_logs "some_scenario"
empty_marker="$(ls "$RIG_BANK_DIR"/BANK-EMPTY-*.txt 2>/dev/null | head -1)"
if [ -f "$empty_marker" ]; then
  ok "RIG_FRAMES empty AFTER frames were registered (even with a tag) still writes the loud BANK-EMPTY marker — WI-5380 class not silently reintroduced"
else
  bad "no BANK-EMPTY marker written when RIG_FRAMES was empty after frames were registered (genuine WI-5380 case)"
fi

# ── 5b. EI-18657462128167571 fix: RIG_FRAMES empty because NO frame was ever ──
#       registered (e.g. a run that exited before rig_set_identity, such as an
#       early rig_gate_artifact failure) must NOT write the loud BANK-EMPTY
#       alarm — there was never anything to lose.
reset_env
declare -ga RIG_FRAMES=()
RIG_FRAMES_EVER_REGISTERED=0
rig_bank_logs "some_scenario"
empty_marker="$(ls "$RIG_BANK_DIR"/BANK-EMPTY-*.txt 2>/dev/null | head -1)"
if [ -z "$empty_marker" ]; then
  ok "RIG_FRAMES empty with NO frame ever registered stays quiet — no false-positive WI-5380 alarm (EI-18657462128167571)"
else
  bad "BANK-EMPTY marker wrongly written when no frame was ever registered this run: $empty_marker"
fi

# ── 5c. rig_set_identity bumps RIG_FRAMES_EVER_REGISTERED (the discriminator ──
#       itself, not just its downstream effect on rig_bank_logs) ──────────────
reset_env
declare -ga RIG_FRAMES=()
RIG_FRAMES_EVER_REGISTERED=0
gh() { echo "FAKE-GH-TOKEN"; }  # stub: rig_set_identity shells out to `gh auth token`
rig_set_identity a fakeuser >/dev/null 2>&1
if [ "${RIG_FRAMES_EVER_REGISTERED:-0}" -gt 0 ]; then
  ok "rig_set_identity bumps RIG_FRAMES_EVER_REGISTERED"
else
  bad "rig_set_identity did not bump RIG_FRAMES_EVER_REGISTERED (got '$RIG_FRAMES_EVER_REGISTERED')"
fi
unset -f gh

# ── 5d. EI-18687774064705397 fix: banked serve.log gets a coverage-window ─────
#       header (first/last in-content timestamp) so nested/cumulative captures
#       are visible at read time instead of silently read as independent runs.
reset_env
drv_exec() {  # override: emit two bracketed timestamps so first != last
  local inst="$1" cmd; cmd="$(cat)"
  case "$cmd" in
    *loadavg*) echo "FAKE-LOADAVG-$inst" ;;
    *) printf '[2026-07-26T05:59:08.366Z] [serve] boot %s\n[2026-07-26T06:02:16.650Z] [serve] tail %s\n' "$inst" "$inst" ;;
  esac
}
rig_bank_logs
ts_file="$(ls "$RIG_BANK_DIR"/serve-a-*.log 2>/dev/null | head -1)"
if [ -f "$ts_file" ] \
  && head -1 "$ts_file" | grep -q "CUMULATIVE for the whole rig session" \
  && head -1 "$ts_file" | grep -qF '05:59:08.366Z' \
  && head -1 "$ts_file" | grep -qF '06:02:16.650Z' \
  && grep -q "\[serve\] boot a" "$ts_file"; then
  ok "banked serve.log is stamped with its own first/last content timestamp + a cumulative-log warning, ahead of the real content"
else
  bad "coverage-window header missing/wrong in banked file: $(head -1 "$ts_file" 2>/dev/null)"
fi
# restore the original stub for any later checks in this file
drv_exec() {
  local inst="$1" cmd; cmd="$(cat)"
  case "$cmd" in
    *loadavg*) echo "FAKE-LOADAVG-$inst" ;;
    *)         echo "FAKE-SERVE-LOG-CONTENT-$inst" ;;
  esac
}

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

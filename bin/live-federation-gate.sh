#!/usr/bin/env bash
# live-federation-gate.sh — periodic LIVE 2-peer shared-hive federation gate (WI-261).
#
# WHY: the green-rig/red-binary class. Federation bugs (A-003, WI-259) pass the hermetic
# suite (1085+ backbone green) but FAIL the real packaged binary, because the integration
# tests mock/inject the substrate federation. The two-instance live smokes catch this class
# but only run manually → regressions reach the shipped binary undetected. This gate runs
# them on a load-gated quiet box on a schedule + files an EI on any RED, so the class is
# caught within ~a day instead of by chance. (Distinct from the per-bug hermetic guards the
# team adds — those catch the specific regression; this catches the CLASS.)
#
# Usage:  bin/live-federation-gate.sh
# Env:
#   LOAD_GATE         (default max(15, nproc/4)) — SKIP (not fail) if /proc/loadavg 1-min
#                                     exceeds this. Core-aware (P-013): an absolute 15 made the
#                                     gate skip EVERY window on the 128-core fleet box.
#   STORM_GATE        (default nproc*0.6) — a FAIL with end-of-run load above this is
#                                     downgraded to SKIPPED-STORM (starvation, not signal).
#   GATE_SUCCESS_TTL_H(default 22)  — a GREEN younger than this ⇒ instant FRESH exit
#                                     (pairs with the hourly timer: ~daily actual run).
#   GATE_STALE_DAYS   (default 3)   — no GREEN for this long ⇒ file a LOUD staleness EI
#                                     (silence must never look like green).
#   GATE_FORCE        (default 0)   — set 1 to ignore the freshness TTL and run now.
#   REBUILD           (default 1)   — rebuild the sidecar from HEAD first (test current code).
#   GATE_DEB          (unset)       — use this prebuilt .deb instead of rebuild+repack.
#   SKIP_MATRIX       (default 0)   — skip the content-matrix leg (reliable, needs a .deb).
#   SKIP_FROMREPO     (default 0)   — skip the from-repo leg (currently WI-971-RED by design:
#                                     outbox drain never wired for joined/created hive
#                                     harnesses; WI-259 was closed as its duplicate).
#   RUN_LOCAL_MATRIX  (default 1)   — run the full local matrix leg on a weekly cadence,
#                                     once P-002's bin/local-matrix.sh exists (no-op until then).
#   MATRIX_TTL_H      (default 144) — spacing between local-matrix runs (6 days).
#   GATE_DISPLAY      (default 250) — Xvfb display base (matrix uses N, from-repo N+2).
#   OPERATOR_MCP_URL  (default http://127.0.0.1:3070/api/mcp) — curl-MCP endpoint for EI filing.
#   GATE_NO_FILE      (default 0)   — set 1 to skip EI filing (just log the verdict).
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# LOAD_GATE default is CORE-AWARE (P-013): max(15, nproc/4). The old absolute 15 never fired on
# the 128-core fleet box (its busy-floor is ~20-30, so the gate load-skipped EVERY window and the
# release signal stayed dark) — yet 25% utilization is a fine environment for two sidecar PGs.
# The empirical rails stay honored: smokes get KILLED ~51+ on 128 cores, and the load-94 mid-run
# storm that false-failed a 30-threshold run is now handled by the STORM downgrade at verdict time
# (SKIPPED-STORM, not RED) instead of by an unreachably low admission threshold.
NPROC="$(nproc 2>/dev/null || echo 8)"
LOAD_GATE="${LOAD_GATE:-$(( NPROC / 4 > 15 ? NPROC / 4 : 15 ))}"
STORM_GATE="${STORM_GATE:-$(( NPROC * 6 / 10 ))}"
REBUILD="${REBUILD:-1}"
SKIP_MATRIX="${SKIP_MATRIX:-0}"; SKIP_FROMREPO="${SKIP_FROMREPO:-0}"
GATE_DISPLAY="${GATE_DISPLAY:-250}"; OPERATOR_MCP_URL="${OPERATOR_MCP_URL:-http://127.0.0.1:3070/api/mcp}"
GATE_NO_FILE="${GATE_NO_FILE:-0}"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
WORK="/tmp/live-fed-gate-$STAMP"; mkdir -p "$WORK"
# log → STDERR. Load-bearing (P-013 validation run 2026-07-03): run_smoke's result is read
# via $(command substitution); with log on stdout the captured value became
# "log-line\nPASS|FAIL", so `[ "$RES" = FAIL ]` could NEVER match and a genuine
# content-matrix FAIL was silently MASKED out of the verdict. journald captures both streams.
log() { echo "[live-fed-gate $(date +%H:%M:%S 2>/dev/null || true)] $*" >&2; }

# ── state + staleness (P-013): a gate that silently skips forever LOOKS green. ──
# last-green/last-run live in a tiny ops state dir. Deliberately a FILE, not PG: the gate
# must keep working when the operator/PG is down (EI filing is already best-effort curl).
STATE_DIR="${GATE_STATE_DIR:-$HOME/.papercusp/live-fed-gate}"; mkdir -p "$STATE_DIR"
GATE_SUCCESS_TTL_H="${GATE_SUCCESS_TTL_H:-22}"
GATE_STALE_DAYS="${GATE_STALE_DAYS:-3}"
now_s() { date +%s 2>/dev/null || echo 0; }
age_h() { local f="$1"; [ -f "$f" ] || { echo 999999; return; }; echo $(( ( $(now_s) - $(cat "$f" 2>/dev/null || echo 0) ) / 3600 )); }
jstr() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }
file_ei() { # <title> <body> — best-effort curl-MCP; the loud echo + $WORK logs are the fallback
  [ "$GATE_NO_FILE" = 1 ] && return 0
  local resp
  resp="$(curl -s -m 30 -X POST "$OPERATOR_MCP_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"work_items:create\",\"arguments\":{\"kind\":\"bug\",\"title\":$(jstr "$1"),\"summary\":$(jstr "$2"),\"harness\":\"papercusp\",\"severity\":\"major\",\"topics\":[\"shared-hive\",\"federation\"]}}}" 2>/dev/null || true)"
  # Verify the filing actually landed (P-013: the 2026-07-03 red filed against harness
  # "papercup" + got an SSE ':stream-open' preamble back and NO work item was created —
  # a silent-miss on the gate's core contract). An SSE body carries the JSON in data: lines.
  if printf '%s' "$resp" | grep -qa '"id":"WI-'; then
    log "EI filed OK → $(printf '%s' "$resp" | grep -oa '"id":"WI-[0-9]*"' | head -1)"
  else
    log "EI filing DID NOT CONFIRM (no WI id in response) — resp head: ${resp:0:200}"
    log "EI filing FALLBACK: verdict + logs remain in $WORK and journald; file manually if this red is real."
  fi
}
check_staleness() { # called on every non-GREEN exit path: silence must never look like green
  local green_age_h; green_age_h="$(age_h "$STATE_DIR/last-green")"
  [ "$green_age_h" -lt $(( GATE_STALE_DAYS * 24 )) ] && return 0
  local filed_age_h; filed_age_h="$(age_h "$STATE_DIR/stale-ei-filed")"
  [ "$filed_age_h" -lt $(( GATE_STALE_DAYS * 24 )) ] && return 0
  log "STALE: no GREEN gate run for ${green_age_h}h (> ${GATE_STALE_DAYS}d) — filing staleness EI"
  file_ei "live-federation-gate STALE: no green run for ${green_age_h}h — the shared-hive release signal is dark" \
    "The WI-261/P-013 standing live-federation gate has not completed a GREEN run for ${green_age_h}h (threshold ${GATE_STALE_DAYS}d). Every window either load-skipped, storm-downgraded, all-legs-skipped, or failed — the shared-hive P2P green/red signal is DARK, which must never read as green. Check: systemctl --user list-timers papercup-live-federation-gate.timer; journalctl --user -u papercup-live-federation-gate.service; state in ~/.papercusp/live-fed-gate/. Owner: shared-hive release lane (plan shared-hive-p2p-release-readiness-2026-07-03 P-013)."
  echo "$(now_s)" >"$STATE_DIR/stale-ei-filed"
}

# ── fresh-exit: hourly timer + ~daily actual run. A GREEN younger than the TTL means this
# window has nothing to do — exit instantly (before the self-test) so hourly fires cost ~0.
if [ "${GATE_FORCE:-0}" != 1 ]; then
  GREEN_AGE_H="$(age_h "$STATE_DIR/last-green")"
  if [ "$GREEN_AGE_H" -lt "$GATE_SUCCESS_TTL_H" ]; then
    log "fresh: last GREEN ${GREEN_AGE_H}h ago (< ${GATE_SUCCESS_TTL_H}h TTL) — nothing to do this window."
    echo "GATE: FRESH (green ${GREEN_AGE_H}h ago)"; exit 0
  fi
fi

# ── 0. assert-core self-test (WI-754) ──────────────────────────────────────────
# Hermetic (~2s, synthetic listeners, no .deb): prove the rig's PORT SELF-DISCOVERY
# logic (fed_probe_sidecar / fed_discover_sidecar_os in federation-asserts.sh)
# BEFORE spending minutes on heavy smokes. A broken assert core makes every smoke a
# confusing RED — catch that class here with a clear message. It adds no real load,
# so it runs on EVERY invocation, ahead of the load gate. (selftest SKIPs cleanly
# when python3/curl are absent → never a false RED.)
if [ "${GATE_SKIP_SELFTEST:-0}" != 1 ]; then
  if bash "$DESKTOP_DIR/bin/lib/federation-asserts.selftest.sh" >"$WORK/selftest.log" 2>&1; then
    log "assert-core self-test PASS (port self-discovery)"
  else
    log "assert-core self-test FAILED — federation-asserts.sh port discovery is broken; see $WORK/selftest.log"
    sed 's/^/  /' "$WORK/selftest.log" >&2
    echo "GATE: RED (assert-core self-test failed — fix federation-asserts.sh before trusting the smokes)"
    exit 1
  fi
fi

# ── 1. load gate ──────────────────────────────────────────────────────────────
LOAD1="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)"
if awk "BEGIN{exit !($LOAD1 > $LOAD_GATE)}"; then
  log "SKIP: 1-min load $LOAD1 > LOAD_GATE $LOAD_GATE — smokes get killed under load; retry next window (not a failure)."
  check_staleness
  echo "GATE: SKIPPED (load $LOAD1 > $LOAD_GATE)"; exit 0
fi
log "load $LOAD1 OK (<= $LOAD_GATE); proceeding."

# ── 2. fresh artifact: rebuild sidecar from HEAD, then REPACK a .deb (content-matrix needs a .deb;
#       from-repo uses the sidecar directly). $GATE_DEB short-circuits to a prebuilt .deb. ───────
FAIL_BUILD=0
if [ -z "${GATE_DEB:-}" ]; then
  if [ "$REBUILD" = 1 ]; then
    log "rebuilding sidecar from HEAD…"
    ( cd "$DESKTOP_DIR" && bash bin/build-desktop-sidecar.sh ) >"$WORK/build.log" 2>&1 || { FAIL_BUILD=1; log "BUILD FAILED — $WORK/build.log"; }
  fi
  grep -qaF 'grantEpochKeysToMembers on admit' "$DESKTOP_DIR/src-tauri/sidecar/serve.mjs" 2>/dev/null \
    || log "WARN: fresh serve.mjs lacks the Seam-2 grant-on-admit string — re-key legs may false-RED."
  if [ "$SKIP_MATRIX" != 1 ] && [ "$FAIL_BUILD" != 1 ]; then
    BASE_DEB="$(ls -t "$DESKTOP_DIR"/src-tauri/target/release/bundle/deb/Papercusp_*_amd64.deb /tmp/*/Papercusp_integrated.deb 2>/dev/null | head -1)"
    if [ -n "$BASE_DEB" ]; then
      GATE_DEB="$WORK/Papercusp_gate.deb"
      ( cd "$WORK" && mkdir -p pkg && dpkg-deb -R "$BASE_DEB" pkg \
          && rm -rf pkg/usr/lib/Papercusp/sidecar && cp -r "$DESKTOP_DIR/src-tauri/sidecar" pkg/usr/lib/Papercusp/sidecar \
          && dpkg-deb -b pkg "$GATE_DEB" ) >"$WORK/repack.log" 2>&1 \
        && log "repacked fresh .deb (base=$BASE_DEB)" || { log "repack FAILED ($WORK/repack.log) — skipping content-matrix"; GATE_DEB=""; SKIP_MATRIX=1; }
    else
      log "no base .deb to repack — skipping content-matrix leg"; SKIP_MATRIX=1
    fi
  fi
fi

# ── 3. run the smokes ─────────────────────────────────────────────────────────
# PASS iff an `OVERALL: PASS` line exists in the smoke output.
# DISCOVERY-RETRY: the from-repo flow discovers via cupboard-off DHT gossip, which lands
# only ~50% of the time per attempt (no cupboard service → directory-only). A single run
# would false-RED the gate half the time on a flake, not a regression — so we re-run (up to
# DISCOVERY_ATTEMPTS, default 3) ONLY when the failure is `discovered=FAIL` (the flake), never
# on a real post-discovery failure. ~3 attempts ⇒ ~88% chance discovery lands. Each attempt is
# load-gated implicitly (the whole gate already passed the load check; a flake adds little).
run_smoke() {  # <label> <script> <deb-or-empty> <extra-env...>
  local label="$1" script="$2" deb="$3"; shift 3
  local out="$WORK/$label.out" attempts="${DISCOVERY_ATTEMPTS:-3}" i res
  for i in $(seq 1 "$attempts"); do
    log "running $label (attempt $i/$attempts) …"
    ( cd "$DESKTOP_DIR/.." && env "$@" bash "papercusp-desktop/bin/$script" ${deb:+"$deb"} ) >"$out" 2>&1 || true
    if grep -qaE 'OVERALL: PASS' "$out" 2>/dev/null; then echo PASS; return; fi
    # Retry ONLY on a discovery flake; a real post-discovery RED is a genuine result — keep it.
    if grep -qaE 'discovered=FAIL' "$out" 2>/dev/null && [ "$i" -lt "$attempts" ]; then
      log "$label: discovered=FAIL (cupboard-off DHT flake) — retrying"; cp "$out" "$out.attempt$i" 2>/dev/null; continue
    fi
    break
  done
  echo FAIL
}

MATRIX_RES="SKIPPED"
if [ "$SKIP_MATRIX" != 1 ]; then
  MATRIX_RES="$(run_smoke content-matrix two-instance-content-matrix-smoke.sh "${GATE_DEB:-}" \
    PAPERCUSP_SMOKE_DISPLAY="$GATE_DISPLAY" DISCOVERY_RETRIES=100)"
  log "content-matrix → $MATRIX_RES"
fi
# The from-repo leg runs WITNESS_PROBE=1 + the re-key flag so it also exercises the AK
# owner-enforcement + the device-filtered C-001 re-key cut (K0-K3) — the re-key was the 3rd
# green-rig/red-binary bug (A-003, WI-259, WI-280), all hermetically-green but live-red, so the
# live gate must cover them too. (Currently REDs on WI-971 by design — outbox drain never wired
# for joined/created hive harnesses; WI-259 was closed as its duplicate and WI-280/WI-1666 are
# resolved. Goes green when WI-971 lands.)
FROMREPO_RES="SKIPPED"
if [ "$SKIP_FROMREPO" != 1 ]; then
  FROMREPO_RES="$(run_smoke from-repo two-instance-hive-from-repo-smoke.sh "" \
    HIVE_SMOKE_MODE=sidecar PAPERCUSP_SMOKE_DISPLAY="$((GATE_DISPLAY + 2))" DISCOVERY_RETRIES=100 \
    PAPERCUSP_FLAG_PAPERCUSP_HIVE_REKEY=1 WITNESS_PROBE=1)"
  log "from-repo+witness → $FROMREPO_RES"
fi

# ── 3b. local-matrix leg (P-013 fold-in; activates when P-002's local-matrix.sh lands) ──
# Runs the full containerized 8-scenario matrix on a WEEKLY cadence once the one-command
# wrapper exists (bin/local-matrix.sh, P-002 of shared-hive-p2p-release-readiness-2026-07-03).
# Contract: exit 0 = matrix green. No-op until the wrapper exists.
# SEQUENCING (per the plan item: "+ (once green) the local matrix on cadence"): the matrix
# leg piggybacks ONLY on a window whose content-matrix smoke PASSED — running the heavy,
# newly-landed matrix on a window whose cheap smoke already failed just burns the box and
# pollutes the verdict (exactly what the 2026-07-03 validation run showed).
MATRIXFULL_RES="SKIPPED"
if [ "${RUN_LOCAL_MATRIX:-1}" = 1 ] && [ "$MATRIX_RES" = PASS ] && [ -e "$DESKTOP_DIR/bin/local-matrix.sh" ]; then
  if [ "$(age_h "$STATE_DIR/last-matrix-green")" -ge "${MATRIX_TTL_H:-144}" ]; then
    log "running local-matrix (weekly cadence) …"
    if ( cd "$DESKTOP_DIR/.." && bash "papercusp-desktop/bin/local-matrix.sh" ) >"$WORK/local-matrix.out" 2>&1; then
      MATRIXFULL_RES="PASS"; echo "$(now_s)" >"$STATE_DIR/last-matrix-green"
    else
      MATRIXFULL_RES="FAIL"
    fi
    log "local-matrix → $MATRIXFULL_RES"
  fi
fi

# ── 4. verdict ────────────────────────────────────────────────────────────────
REDS=()
[ "$FAIL_BUILD" = 1 ] && REDS+=("sidecar-build")
[ "$MATRIX_RES" = FAIL ] && REDS+=("content-matrix")
[ "$FROMREPO_RES" = FAIL ] && REDS+=("from-repo")
[ "$MATRIXFULL_RES" = FAIL ] && REDS+=("local-matrix")
SUMMARY="content-matrix=$MATRIX_RES from-repo=$FROMREPO_RES local-matrix=$MATRIXFULL_RES build=$([ "$FAIL_BUILD" = 1 ] && echo FAIL || echo OK)"
log "VERDICT: $SUMMARY"
echo "$(now_s)" >"$STATE_DIR/last-run"

# All legs skipped ⇒ NOT green (the vacuous-pass trap): nothing was proven this window.
if [ "$MATRIX_RES" = SKIPPED ] && [ "$FROMREPO_RES" = SKIPPED ] && [ "$MATRIXFULL_RES" = SKIPPED ] && [ "$FAIL_BUILD" != 1 ]; then
  log "all smoke legs SKIPPED — nothing proven; NOT recording a green."
  check_staleness
  echo "GATE: SKIPPED (no legs ran — $SUMMARY)"; exit 0
fi

if [ ${#REDS[@]} -eq 0 ]; then
  echo "$(now_s)" >"$STATE_DIR/last-green"; rm -f "$STATE_DIR/stale-ei-filed"
  echo "GATE: GREEN — $SUMMARY"; exit 0
fi

# Storm downgrade: if the box got SATURATED mid-run, a FAIL is likelier starvation than a
# regression (the exact false-RED seen when a fleet storm hit load 94 mid-run) — downgrade
# to SKIPPED-STORM, no EI, retry next window. A real regression re-fails on a calm window.
LOAD1_END="$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0)"
if awk "BEGIN{exit !($LOAD1_END > $STORM_GATE)}"; then
  log "STORM: load rose to $LOAD1_END (> STORM_GATE $STORM_GATE) during the run — downgrading RED(${REDS[*]}) to SKIPPED (starvation, not signal)."
  check_staleness
  echo "GATE: SKIPPED-STORM (load $LOAD1_END; would-be-red: ${REDS[*]})"; exit 0
fi

echo "GATE: RED (${REDS[*]}) — $SUMMARY ; logs in $WORK"

# ── 5. file an EI on RED (best-effort curl-MCP; the loud echo + $WORK logs are the fallback) ─
TITLE="live-federation-gate RED: ${REDS[*]} failed on the packaged binary ($STAMP)"
BODY="Automated live-federation gate (WI-261/P-013) caught a RED on the real binary the hermetic suite would not (green-rig/red-binary class). Failing legs: ${REDS[*]}. Verdict: $SUMMARY. Logs: $WORK/*.out. Owner: shared-hive release lane. NOTE: a from-repo RED is EXPECTED while WI-971 (outbox drain never wired for joined/created hive harnesses; WI-259 closed as its dup) is open; a content-matrix, local-matrix, or build RED is a NEW regression — investigate."
file_ei "$TITLE" "$BODY"
check_staleness
exit 1

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
#   LOAD_GATE         (default 30)  — SKIP (not fail) if /proc/loadavg 1-min exceeds this.
#                                     The smokes get killed under load (51+ on a 128-core box).
#   REBUILD           (default 1)   — rebuild the sidecar from HEAD first (test current code).
#   GATE_DEB          (unset)       — use this prebuilt .deb instead of rebuild+repack.
#   SKIP_MATRIX       (default 0)   — skip the content-matrix leg (reliable, needs a .deb).
#   SKIP_FROMREPO     (default 0)   — skip the from-repo leg (currently WI-259-RED by design).
#   GATE_DISPLAY      (default 250) — Xvfb display base (matrix uses N, from-repo N+2).
#   OPERATOR_MCP_URL  (default http://127.0.0.1:3070/api/mcp) — curl-MCP endpoint for EI filing.
#   GATE_NO_FILE      (default 0)   — set 1 to skip EI filing (just log the verdict).
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# LOAD_GATE default is CONSERVATIVE (15): the smokes' cupboard-off DHT discovery degrades and
# false-REDs well BELOW the run-kill threshold (~51), and a gate run itself ADDS ~2 PGs of load —
# so it must only fire on a genuinely quiet box (a fleet infra storm pushed this box to 94 during
# a 30-threshold run, which both false-failed AND worsened the contention). Raise it only for a
# dedicated/idle host. Better to SKIP and retry next window than false-RED or pile onto a busy box.
LOAD_GATE="${LOAD_GATE:-15}"; REBUILD="${REBUILD:-1}"
SKIP_MATRIX="${SKIP_MATRIX:-0}"; SKIP_FROMREPO="${SKIP_FROMREPO:-0}"
GATE_DISPLAY="${GATE_DISPLAY:-250}"; OPERATOR_MCP_URL="${OPERATOR_MCP_URL:-http://127.0.0.1:3070/api/mcp}"
GATE_NO_FILE="${GATE_NO_FILE:-0}"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
WORK="/tmp/live-fed-gate-$STAMP"; mkdir -p "$WORK"
log() { echo "[live-fed-gate $(date +%H:%M:%S 2>/dev/null || true)] $*"; }

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
# live gate must cover them too. (Currently REDs on WI-259/WI-280 by design; goes green when both land.)
FROMREPO_RES="SKIPPED"
if [ "$SKIP_FROMREPO" != 1 ]; then
  FROMREPO_RES="$(run_smoke from-repo two-instance-hive-from-repo-smoke.sh "" \
    HIVE_SMOKE_MODE=sidecar PAPERCUSP_SMOKE_DISPLAY="$((GATE_DISPLAY + 2))" DISCOVERY_RETRIES=100 \
    PAPERCUSP_FLAG_PAPERCUSP_HIVE_REKEY=1 WITNESS_PROBE=1)"
  log "from-repo+witness → $FROMREPO_RES"
fi

# ── 4. verdict ────────────────────────────────────────────────────────────────
REDS=()
[ "$FAIL_BUILD" = 1 ] && REDS+=("sidecar-build")
[ "$MATRIX_RES" = FAIL ] && REDS+=("content-matrix")
[ "$FROMREPO_RES" = FAIL ] && REDS+=("from-repo")
SUMMARY="content-matrix=$MATRIX_RES from-repo=$FROMREPO_RES build=$([ "$FAIL_BUILD" = 1 ] && echo FAIL || echo OK)"
log "VERDICT: $SUMMARY"
[ ${#REDS[@]} -eq 0 ] && { echo "GATE: GREEN — $SUMMARY"; exit 0; }
echo "GATE: RED (${REDS[*]}) — $SUMMARY ; logs in $WORK"

# ── 5. file an EI on RED (best-effort curl-MCP; the loud echo + $WORK logs are the fallback) ─
if [ "$GATE_NO_FILE" != 1 ]; then
  jstr() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }
  TITLE="live-federation-gate RED: ${REDS[*]} failed on the packaged binary ($STAMP)"
  BODY="Automated live-federation gate (WI-261) caught a RED on the real binary the hermetic suite would not (green-rig/red-binary class). Failing legs: ${REDS[*]}. Verdict: $SUMMARY. Logs: $WORK/*.out. Owner: federation/shared-hive lane. NOTE: a from-repo RED is EXPECTED while WI-259 is open; a content-matrix or build RED is a NEW regression — investigate."
  resp="$(curl -s -m 30 -X POST "$OPERATOR_MCP_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"work_items:create\",\"arguments\":{\"kind\":\"bug\",\"title\":$(jstr "$TITLE"),\"summary\":$(jstr "$BODY"),\"harness\":\"papercup\",\"severity\":\"major\",\"topics\":[\"shared-hive\",\"federation\"]}}}" 2>/dev/null || true)"
  log "EI filing → ${resp:0:200}"
fi
exit 1

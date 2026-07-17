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
#   RED_REFILE_H      (default 24)  — RED-EI dedup window (EI-8385-class fix, 2026-07-09):
#                                     this gate runs hourly and every prior version filed a
#                                     BRAND NEW work_items:create bug on every single RED run —
#                                     30+ duplicate "live-federation-gate RED: content-matrix
#                                     failed…" bugs piled up over 3 days for the SAME unresolved
#                                     regression (WI-3358..WI-3477+), because the title embeds a
#                                     run timestamp so no title-similarity guard ever caught them
#                                     as duplicates. Mirrors the STALE path's existing
#                                     stale-ei-filed marker: file once, then suppress re-filing
#                                     for this window (cleared immediately on the next GREEN, so
#                                     a genuine fix is never hidden behind a stale suppression).
set -uo pipefail
DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# LOAD_GATE default is SATURATION-BASED (WI-5319 / plan D-003): max(15, 85% of nproc).
# History: the old absolute 15 never fired on the 128-core fleet box; nproc/4=32 and then
# 3*nproc/8=48 each still sat below the fleet-era operating floor — on 2026-07-17 the box ran
# 1-min load 40–120 ALL DAY and the 19:04 hourly window self-skipped at 48.78 vs gate 48, so
# the timer effectively never fired (the exact "gate never runs" class P-013 exists to kill).
# Owner directive (plan p2p-public-release-remaining-lanes-2026-07-16 D-003): load is not a
# reason to withhold verification — engineer isolation instead. That isolation now exists:
# local-matrix.sh pins each frame to a reserved cpuset (+ elevated cpu-shares), so host load
# no longer starves the frames' node main threads (run 174333 forensics: 18×30s substrate
# boot timeouts / 10 late-adopts / event-loop p99 1.48s on an UNPINNED rig-b). Admission now
# skips only near true saturation, where even reserved cores can't be kept clear.
NPROC="$(nproc 2>/dev/null || echo 8)"
LOAD_GATE="${LOAD_GATE:-$(( NPROC * 85 / 100 > 15 ? NPROC * 85 / 100 : 15 ))}"
# STORM downgrade moves with it (0.6n → 0.9n): with pinned frames, host loadavg is a weak
# starvation proxy — the honest starvation signal is event-loop-lag inside the frame
# serve.logs (grep '[event-loop-lag]'), which the verdict reader checks per WI-5319. Keep
# the downgrade only as a last-resort guard at genuine saturation.
STORM_GATE="${STORM_GATE:-$(( NPROC * 9 / 10 ))}"
REBUILD="${REBUILD:-1}"
SKIP_MATRIX="${SKIP_MATRIX:-0}"; SKIP_FROMREPO="${SKIP_FROMREPO:-0}"
# ?superuser=1 REQUIRED (WI-1861 follow-up): a bare /api/mcp rejects projected tool calls with
# invalid_request_context (needs harness/workspace/role/run/spawn params or superuser) — the
# 13:00 red's EI filing died on exactly this and only the loud fallback saved the verdict.
GATE_DISPLAY="${GATE_DISPLAY:-250}"; OPERATOR_MCP_URL="${OPERATOR_MCP_URL:-http://127.0.0.1:3070/api/mcp?superuser=1}"
GATE_NO_FILE="${GATE_NO_FILE:-0}"
# SUPERUSER BEARER (P-013 follow-up, WI-1841): `?superuser=1` alone is NOT sufficient — the
# handler also requires `Authorization: Bearer <token>` matching ~/.papercusp/superuser-token
# (see packages/operator-core/lib/superuser-token.ts). Without it every EI filing 403s with
# superuser_invalid_bearer/invalid_request_context and silently falls back to log-only (verified
# live on 2026-07-03: both the 12:03 and a manual repro hit this). GATE_SUPERUSER_TOKEN_PATH lets
# a non-default install override the path; missing/short token → empty bearer → same graceful
# fallback as before (never fatal).
GATE_SUPERUSER_TOKEN_PATH="${GATE_SUPERUSER_TOKEN_PATH:-$HOME/.papercusp/superuser-token}"
GATE_SUPERUSER_BEARER="$(cat "$GATE_SUPERUSER_TOKEN_PATH" 2>/dev/null | tr -d '[:space:]' || true)"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
WORK="/tmp/live-fed-gate-$STAMP"; mkdir -p "$WORK"
# Run-dir retention (WI-3087, 2026-07-05): this gate leaked ~3.5GB per heavy run (the
# dpkg-deb -R unpacked pkg/ tree + the repacked gate .deb were never cleaned) — 67 dirs /
# 111GB of /tmp by the time it filled the root disk. Keep only the newest
# GATE_KEEP_RUNS run dirs (this one included; logs+deb of recent runs stay for EI
# debugging); pkg/ is additionally removed right after a successful repack below.
GATE_KEEP_RUNS="${GATE_KEEP_RUNS:-5}"
ls -dt /tmp/live-fed-gate-* 2>/dev/null | tail -n +$(( GATE_KEEP_RUNS + 1 )) | xargs -r rm -rf --
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
RED_REFILE_H="${RED_REFILE_H:-24}"
now_s() { date +%s 2>/dev/null || echo 0; }
age_h() { local f="$1"; [ -f "$f" ] || { echo 999999; return; }; echo $(( ( $(now_s) - $(cat "$f" 2>/dev/null || echo 0) ) / 3600 )); }
jstr() { printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"; }
file_ei() { # <title> <body> — best-effort curl-MCP; the loud echo + $WORK logs are the fallback
  [ "$GATE_NO_FILE" = 1 ] && return 0
  local resp
  local -a auth_hdr=()
  if [ -n "$GATE_SUPERUSER_BEARER" ]; then
    auth_hdr=(-H "authorization: Bearer $GATE_SUPERUSER_BEARER")
  else
    log "WARN: no superuser bearer at $GATE_SUPERUSER_TOKEN_PATH — EI filing will 403 (superuser_invalid_bearer); falling back to log-only."
  fi
  resp="$(curl -s -m 30 -X POST "$OPERATOR_MCP_URL" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' "${auth_hdr[@]}" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"work_items:create\",\"arguments\":{\"kind\":\"bug\",\"title\":$(jstr "$1"),\"summary\":$(jstr "$2"),\"harness\":\"papercusp\",\"severity\":\"major\",\"topics\":[\"shared-hive\",\"federation\"]}}}" 2>/dev/null || true)"
  # Verify the filing actually landed (P-013: the 2026-07-03 red filed against harness
  # "papercup" + got an SSE ':stream-open' preamble back and NO work item was created —
  # a silent-miss on the gate's core contract). An SSE body carries the JSON in data: lines,
  # and the tool result is a JSON STRING nested inside that envelope, so its own quotes come
  # back backslash-escaped (`\"id\":\"WI-123\"`), not bare (`"id":"WI-123"`) — a bare-quote
  # grep NEVER matches an SSE response and every successful filing still logged as unconfirmed
  # (WI-1841 verification, 2026-07-03: manually confirmed the work item WAS created — WI-1897 —
  # while this check said DID NOT CONFIRM). The `\\?` makes each quote's backslash optional so
  # this matches both the SSE-escaped and a plain-JSON transport.
  local id_match
  id_match="$(printf '%s' "$resp" | grep -oaE '\\?"id\\?":\\?"WI-[0-9]+' | head -1)"
  if [ -n "$id_match" ]; then
    log "EI filed OK → $(printf '%s' "$id_match" | grep -oaE 'WI-[0-9]+')"
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
skip_cleanup() { # SKIP/FRESH exits carry no diagnostic value — drop the near-empty run dir so
  # hourly SKIP windows don't rotate real RED/GREEN evidence dirs out of GATE_KEEP_RUNS
  # retention (observed 2026-07-16: five consecutive load-SKIP windows evicted BOTH diagnostic
  # run dirs of that day's RED within ~5h). The dir is kept if anything beyond selftest.log
  # landed in it (e.g. a prod-port-guard trip is evidence).
  find "$WORK" -mindepth 1 ! -name selftest.log 2>/dev/null | grep -q . || rm -rf "$WORK"
}

# ── fresh-exit: hourly timer + ~daily actual run. A GREEN younger than the TTL means this
# window has nothing to do — exit instantly (before the self-test) so hourly fires cost ~0.
if [ "${GATE_FORCE:-0}" != 1 ]; then
  GREEN_AGE_H="$(age_h "$STATE_DIR/last-green")"
  if [ "$GREEN_AGE_H" -lt "$GATE_SUCCESS_TTL_H" ]; then
    log "fresh: last GREEN ${GREEN_AGE_H}h ago (< ${GATE_SUCCESS_TTL_H}h TTL) — nothing to do this window."
    skip_cleanup
    echo "GATE: FRESH (green ${GREEN_AGE_H}h ago)"; exit 0
  fi
fi

# ── 0a. prod-port guard (EI-11342, 2026-07-13) ─────────────────────────────────
# A rig-owned process must NEVER hold a production operator port. Incident (14:48–14:55Z):
# a packaged sidecar spawned under this gate lost its per-instance port override, fell back
# to the baked default 3070, and won the bind race against a mid-restart papercup-dev-api —
# prod crash-looped on EADDRINUSE and every fleet MCP call died with superuser_invalid_bearer
# until the squatter was killed by hand. This guard kills any RIG-OWNED listener on a prod
# port within seconds. Ownership test = cgroup membership (this service) OR a cwd/cmdline
# under a rig dir — a non-rig holder is prod itself and is never touched. NOTE: this is the
# rig-level recurrence guard; the ROOT-CAUSE half of EI-11342 (the packaged sidecar must fail
# loudly instead of falling back to the prod default port) stays open for the desktop lane.
PROD_PORTS="${GATE_PROD_PORTS:-3070 3170 3270}"
GUARD_TRIP_FILE="$WORK/prod-port-guard.tripped"
guard_prod_ports() { # <when-label> — kill rig-owned listeners on prod ports; record any trip
  local when="$1" p pid pids owned
  for p in $PROD_PORTS; do
    pids="$(ss -ltnpH "sport = :$p" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true)"
    for pid in $pids; do
      owned=0
      grep -qa 'live-federation-gate' "/proc/$pid/cgroup" 2>/dev/null && owned=1
      if [ "$owned" = 0 ]; then
        { readlink -f "/proc/$pid/cwd" 2>/dev/null; tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null; } \
          | grep -qaE "papercusp-lane-[a-z0-9-]*-fed|$WORK" && owned=1
      fi
      if [ "$owned" = 1 ]; then
        log "PROD-PORT GUARD ($when): rig-owned pid=$pid is LISTENING on prod :$p (EI-11342 class) — killing it. cmd: $(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null | head -c 200)"
        echo "$when :$p pid=$pid" >>"$GUARD_TRIP_FILE"
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
      fi
    done
  done
  return 0
}
guard_prod_ports preflight
# Continuous sweep: a squat mid-smoke must die within seconds, not at leg end — the
# incident's damage window was the smoke's own multi-minute runtime. Reaped on exit.
( while :; do sleep "${GATE_PORT_GUARD_INTERVAL_S:-15}"; guard_prod_ports sweep; done ) &
GUARD_SWEEP_PID=$!
trap 'guard_prod_ports exit-trap; kill "$GUARD_SWEEP_PID" 2>/dev/null || true' EXIT
# An external kill (unit TimeoutStartSec, manual systemctl stop) must NEVER end a run
# silently: the 2026-07-17 00:30 run was systemd-killed mid-local-matrix with no GATE:
# line, so watchers greping verdicts waited forever and the red-EI/state machinery never
# ran. Emit a distinct TERMINATED verdict (not RED — an external kill is not federation
# signal) with whatever leg statuses exist; the EXIT trap still reaps the port guard.
on_external_term() {
  echo "GATE: TERMINATED (external signal — unit timeout or manual stop; legs at kill: content-matrix=${MATRIX_RES:-?} from-repo=${FROMREPO_RES:-?} local-matrix=${MATRIXFULL_RES:-?} build=$([ "${FAIL_BUILD:-0}" = 1 ] && echo FAIL || echo OK)) ; logs in ${WORK:-?}"
  exit 143
}
trap on_external_term TERM INT

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
  if [ "${GATE_FORCE:-0}" = 1 ]; then
    # GATE_FORCE means FORCE (WI-1861 follow-up): a forced run is an ATTENDED validation —
    # skip only the unattended-admission gate; the mid-run STORM downgrade still protects
    # the verdict if the box saturates while the smokes run.
    log "load $LOAD1 > LOAD_GATE $LOAD_GATE but GATE_FORCE=1 — proceeding anyway (storm downgrade still armed)."
  else
    log "SKIP: 1-min load $LOAD1 > LOAD_GATE $LOAD_GATE — smokes get killed under load; retry next window (not a failure)."
    check_staleness
    skip_cleanup
    echo "GATE: SKIPPED (load $LOAD1 > $LOAD_GATE)"; exit 0
  fi
else
  log "load $LOAD1 OK (<= $LOAD_GATE); proceeding."
fi

# ── 1b. GitHub credentialed-REST preflight (2026-07-16 outage class) ───────────
# The smokes create/publish hives from REAL GitHub repos using the smoke accounts'
# tokens (fetchGithubRepoMeta repo-id lookup, resolveOwner attestation). On
# 2026-07-16 GitHub's edge served HTML 503 to ALL credentialed REST from this box
# for hours while anonymous requests, /rate_limit, and git-over-HTTPS all kept
# working — so the box looked healthy, but every run burned ~25 min into a false
# RED that mimics a code regression (announced=False, publish.memberLinks=0).
# Probe the exact call class the smokes need (authenticated REST read of the
# fixture repo) and SKIP loudly — like the load gate — when it is down:
# environmental, not a failure. check_staleness still runs, so a persistent
# outage trips the staleness EI instead of looking green.
if [ "${GATE_SKIP_GH_PREFLIGHT:-0}" != 1 ]; then
  GH_PREFLIGHT_USER="${GATE_GH_USER:-papercupai}"
  GH_PREFLIGHT_TOKEN="$(gh auth token --user "$GH_PREFLIGHT_USER" 2>/dev/null || true)"
  if [ -z "$GH_PREFLIGHT_TOKEN" ]; then
    # No token is a local misconfig, not the outage class — let the smoke surface it.
    log "WARN: no gh token for $GH_PREFLIGHT_USER — cannot preflight credentialed GitHub REST; proceeding."
  else
    GH_CODE=000
    for _try in 1 2 3; do
      GH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 \
        -H "Authorization: Bearer $GH_PREFLIGHT_TOKEN" \
        https://api.github.com/repos/octocat/Hello-World 2>/dev/null || echo 000)"
      [ "$GH_CODE" = 200 ] && break
      sleep 10
    done
    if [ "$GH_CODE" != 200 ]; then
      if [ "${GATE_FORCE:-0}" = 1 ]; then
        log "credentialed GitHub REST unhealthy (HTTP $GH_CODE) but GATE_FORCE=1 — proceeding anyway."
      else
        log "SKIP: credentialed GitHub REST unhealthy (HTTP $GH_CODE for $GH_PREFLIGHT_USER after 3 tries) — smokes would false-RED (announced=False/memberLinks=0); retry next window (not a failure)."
        check_staleness
        skip_cleanup
        echo "GATE: SKIPPED (github-api-unhealthy HTTP $GH_CODE)"; exit 0
      fi
    else
      log "credentialed GitHub REST OK (200 for $GH_PREFLIGHT_USER); proceeding."
    fi
  fi
fi

# ── 2. fresh artifact: rebuild sidecar from HEAD, then REPACK a .deb (content-matrix needs a .deb;
#       from-repo uses the sidecar directly). $GATE_DEB short-circuits to a prebuilt .deb. ───────
FAIL_BUILD=0
if [ -n "${GATE_DEB:-}" ] && [ ! -f "$GATE_DEB" ]; then
  log "WARN: GATE_DEB=$GATE_DEB does not exist — ignoring stale override and rebuilding/repacking if enabled."
  GATE_DEB=""
fi
if [ -z "${GATE_DEB:-}" ]; then
  if [ "$REBUILD" = 1 ]; then
    # Build PROVENANCE (WI-1861): the build reads the LIVE shared working tree, not committed
    # HEAD — a fleet peer's mid-write edit can be captured ("torn-tree build") and produce a
    # red no commit ever contained (the 11:53 2026-07-03 'blueprint invalid' red is the type
    # specimen: unreproducible at the next build, byte-identical blueprints). Stamp HEAD + the
    # dirty-file count so every verdict is attributable and a torn-tree red is diagnosable.
    GIT_HEAD="$(cd "$DESKTOP_DIR/.." && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
    GIT_DIRTY="$(cd "$DESKTOP_DIR/.." && git status --porcelain 2>/dev/null | wc -l || echo '?')"
    log "rebuilding sidecar from working tree (HEAD=$GIT_HEAD, dirty-files=$GIT_DIRTY)…"
    echo "head=$GIT_HEAD dirty=$GIT_DIRTY ts=$(date -Is)" >"$WORK/provenance"
    ( cd "$DESKTOP_DIR" && bash bin/build-desktop-sidecar.sh ) >"$WORK/build.log" 2>&1 || { FAIL_BUILD=1; log "BUILD FAILED — $WORK/build.log"; }
  fi
  grep -qaF 'grantEpochKeysToMembers on admit' "$DESKTOP_DIR/src-tauri/sidecar/serve.mjs" 2>/dev/null \
    || log "WARN: fresh serve.mjs lacks the Seam-2 grant-on-admit string — re-key legs may false-RED."
  if [ "$SKIP_MATRIX" != 1 ] && [ "$FAIL_BUILD" != 1 ]; then
    CARGO_TARGET_ROOT="${CARGO_TARGET_DIR:-$HOME/.cargo-target}"
    BASE_DEB="$(ls -t \
      "$DESKTOP_DIR"/src-tauri/target/release/bundle/deb/Papercusp*_amd64.deb \
      "$CARGO_TARGET_ROOT"/release/bundle/deb/Papercusp\ GUI_*_amd64.deb \
      "$CARGO_TARGET_ROOT"/release/bundle/deb/Papercusp_*_amd64.deb \
      /tmp/*/Papercusp_integrated.deb 2>/dev/null | head -1)"
    if [ -n "$BASE_DEB" ]; then
      GATE_DEB="$WORK/Papercusp_gate.deb"
      ( cd "$WORK" && mkdir -p pkg && dpkg-deb -R "$BASE_DEB" pkg \
          && APPDIR="$(find pkg/usr/lib -maxdepth 1 -mindepth 1 -type d | head -1)" && rm -rf "$APPDIR/sidecar" && cp -r "$DESKTOP_DIR/src-tauri/sidecar" "$APPDIR/sidecar" \
          && dpkg-deb -b pkg "$GATE_DEB" && rm -rf pkg ) >"$WORK/repack.log" 2>&1 \
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
# DISPLAY-BUSY (WI-1977): fed_fresh_display (federation-asserts.sh) refuses a busy Xvfb
# display with `FATAL: :$num busy — set PAPERCUSP_SMOKE_DISPLAY to a free one` rather than
# ever sharing a peer's display. The gate's own fixed GATE_DISPLAY default (250, +2=252 for
# from-repo) is ALSO the number a human/agent reproducing a gate red picks when they want an
# EXACT match (an "evidence pair" left intentionally running for a debugging thread) — so an
# hourly timer run can collide with a legitimate, long-lived evidence pair that has nothing to
# do with a real regression. Unlike the discovery flake above, retrying buys nothing (the
# display stays busy for as long as the OTHER process holds it) — classify it as a resource
# contention SKIP, never a RED, matching this file's existing storm-downgrade / load-gate-skip
# philosophy (a busy resource is starvation, not signal).
run_smoke() {  # <label> <script> <deb-or-empty> <extra-env...>
  local label="$1" script="$2" deb="$3"; shift 3
  local out="$WORK/$label.out" attempts="${DISCOVERY_ATTEMPTS:-3}" i res
  for i in $(seq 1 "$attempts"); do
    log "running $label (attempt $i/$attempts) …"
    ( cd "$DESKTOP_DIR/.." && env "$@" bash "papercusp-desktop/bin/$script" ${deb:+"$deb"} ) >"$out" 2>&1 || true
    if grep -qaE 'OVERALL: PASS' "$out" 2>/dev/null; then echo PASS; return; fi
    if grep -qaE 'busy — set PAPERCUSP_SMOKE_DISPLAY to a free one' "$out" 2>/dev/null; then
      log "$label: display busy (a long-lived pair — likely evidence for another investigation — already holds it) — SKIPPING, not a regression"
      echo SKIPPED-BUSY; return
    fi
    # Retry ONLY on a discovery flake; a real post-discovery RED is a genuine result — keep it.
    if grep -qaE 'discovered=FAIL' "$out" 2>/dev/null && [ "$i" -lt "$attempts" ]; then
      log "$label: discovered=FAIL (cupboard-off DHT flake) — retrying"; cp "$out" "$out.attempt$i" 2>/dev/null; continue
    fi
    # Retry a BOOT-READINESS flake (WI-3734, 2026-07-10): an EMPTY-body "create failed" /
    # "B join failed" — curl got NO response content at all, not even a JSON error body —
    # is the signature of firing a live API call against a sidecar that fed_wait_api
    # accepted (incl. via its "legacy liberal accept" fallback) before it actually
    # finished booting (embedded-PG init + ~400 migrations under load), NOT a protocol
    # regression: a genuine create/join failure always returns actual JSON error content
    # after the colon (see two-instance-content-matrix-smoke.sh:157/276). Confirmed live
    # on this fleet's high-load box (2026-07-10 12:42 + 13:38 runs): both hit this exact
    # empty-body signature on attempt 1 and were never retried — this class fell through
    # every existing safety net (load-gate admission checks only the START load; the
    # end-of-run STORM downgrade only fires if load is STILL high at verdict time, not
    # transiently high mid-boot; this discovery-flake retry only matched a different
    # signature) and reached the gate's verdict as a bare content-matrix=FAIL. Mirrors the
    # discovery-flake retry above exactly — same rationale, same bounded attempts budget.
    if grep -qaE '✗ (create|B join) failed: *$' "$out" 2>/dev/null && [ "$i" -lt "$attempts" ]; then
      log "$label: empty-body create/join failure (sidecar boot-readiness flake, not a protocol regression) — retrying"; cp "$out" "$out.attempt$i" 2>/dev/null; continue
    fi
    break
  done
  echo FAIL
}
# True iff a leg's result string is any flavor of "nothing proven" (SKIPPED / SKIPPED-BUSY).
is_skip_result() { case "$1" in SKIPPED*) return 0 ;; *) return 1 ;; esac; }

MATRIX_RES="SKIPPED"
if [ "$SKIP_MATRIX" != 1 ]; then
  MATRIX_RES="$(run_smoke content-matrix two-instance-content-matrix-smoke.sh "${GATE_DEB:-}" \
    PAPERCUSP_SMOKE_DISPLAY="$GATE_DISPLAY" DISCOVERY_RETRIES=100)"
  # TEMPORARY MITIGATION — known-red carve-out, re-scoped 2026-07-03 after the WI-971
  # differential (evidence: WI-971 thread post 49980, live attempt-5 pair):
  #   · backfill / backfill-late reds = WI-1942 (receive-side historical-catch-up LATENCY;
  #     send side verified clean — A drains seeds instantly). The smoke's phase-6b
  #     late-recheck discriminates latency (phase-5 red / 6b green) from death (both red);
  #     BOTH classes stay carved out because WI-1942 is filed + owned, and a known
  #     latency-class miss must not block the regressions this gate exists to catch.
  #   · incr-B→A reds = were a SMOKE artifact (WS_B pre-join mis-derive, fixed in the
  #     smoke) + the joiner home-view drain gap (join-hive.ts 2c′, landed 2026-07-03
  #     ~14:12). Kept in the carve-out ONLY until the post-fix verify run lands —
  #     NARROW this regex to the backfill classes alone once WI-971 closes, and remove
  #     the whole block when WI-1942 closes.
  # Downgrade a FAIL to PASS-971 ONLY when the run got past join AND every hard ✗ line
  # is exactly these signatures — an incr-A→B miss, a create/join fail, or any other ✗
  # stays a genuine RED.
  if [ "$MATRIX_RES" = FAIL ] && grep -qa '✓ B joined' "$WORK/content-matrix.out" 2>/dev/null; then
    # EI-8385-class fix (2026-07-09): `grep -c PATTERN FILE || echo 0` is a classic bash
    # double-output trap — `grep -c` ALWAYS prints a count (even "0") but exits 1 when
    # that count is zero, so on a zero-match run BOTH the "0" grep already printed AND
    # the `|| echo 0` fallback fire, leaving X_TOTAL/X_OTHER as a TWO-LINE "0\n0" string.
    # `[ "$X_OTHER" -eq 0 ]` then dies with "integer expression expected" (visible in
    # journalctl as `line N: [: 0\n0: integer expression expected`), the `if` never
    # matches, and a content-matrix FAIL that fully qualifies for the documented PASS-971
    # carve-out below is left as a genuine RED every single run — the actual root cause
    # behind the WI-3358/WI-3477 duplicate-bug-storm this file's RED-EI dedup masked but
    # never fixed. Use `|| true` (adds no output) + a param-expansion default (covers the
    # file-missing case, where grep exits 2 with no output at all) so each var is always
    # exactly one clean integer line.
    X_TOTAL="$(grep -ac '✗' "$WORK/content-matrix.out" 2>/dev/null || true)"; X_TOTAL="${X_TOTAL:-0}"
    X_OTHER="$(grep -a '✗' "$WORK/content-matrix.out" 2>/dev/null | grep -acvE '(backfill(-late)?|incr-B→A) +NEVER crossed' || true)"; X_OTHER="${X_OTHER:-0}"
    if [ "$X_TOTAL" -ge 1 ] && [ "$X_OTHER" -eq 0 ]; then
      MATRIX_RES="PASS-971"
      log "content-matrix FAIL downgraded → PASS-971: all $X_TOTAL hard-fails match the documented known-red classes (backfill/backfill-late = WI-1942 latency; incr-B→A = WI-971 fix landed, verify pending); everything else green. NOT a clean pass."
    fi
  fi
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
if [ "${RUN_LOCAL_MATRIX:-1}" = 1 ] && { [ "$MATRIX_RES" = PASS ] || [ "$MATRIX_RES" = PASS-971 ]; } && [ -e "$DESKTOP_DIR/bin/local-matrix.sh" ]; then
  if [ "$(age_h "$STATE_DIR/last-matrix-green")" -ge "${MATRIX_TTL_H:-144}" ]; then
    log "running local-matrix (weekly cadence) …"
    # Pass the gate's freshly-repacked .deb — without it the leg's default_deb()
    # picks the newest PREBUILT bundle, which can be days stale (the 2026-07-16 RED
    # ran a Jul-11 deb against current-tree expectations and its own WARN said so).
    if ( cd "$DESKTOP_DIR/.." && bash "papercusp-desktop/bin/local-matrix.sh" ${GATE_DEB:+--deb="$GATE_DEB"} ) >"$WORK/local-matrix.out" 2>&1; then
      MATRIXFULL_RES="PASS"; echo "$(now_s)" >"$STATE_DIR/last-matrix-green"
    else
      MATRIXFULL_RES="FAIL"
      # WI-2381 carve-out (mirrors content-matrix's PASS-971): seat_offer + spawn_request are
      # DOCUMENTED known-red on the live rig (WI-2381, open since 2026-07-04 — the 'default'
      # workspace refuses the seat allotment, and the cross-frame substrate apply breaks under
      # a concrete workspace; triaged as a dedicated rig investigation). If a COMPLETED run
      # (final scoreboard present — a killed/truncated run never prints it) failed ONLY on that
      # documented set, downgrade to PASS-2381 so the leg still catches NEW scenario regressions
      # without permanently blocking gate green. Loudly NOT a clean pass.
      if grep -q 'LIVE FEDERATION MATRIX' "$WORK/local-matrix.out" && grep -q '^OVERALL: FAIL' "$WORK/local-matrix.out"; then
        MX_FAILED="$(awk '/LIVE FEDERATION MATRIX/{t=1} t && $1=="FAIL"{print $2}' "$WORK/local-matrix.out" | sort -u)"
        MX_UNEXPECTED="$(printf '%s\n' "$MX_FAILED" | grep -vE '^(seat_offer|spawn_request)$' || true)"
        if [ -n "$MX_FAILED" ] && [ -z "$MX_UNEXPECTED" ]; then
          MATRIXFULL_RES="PASS-2381"
          echo "$(now_s)" >"$STATE_DIR/last-matrix-green"
          log "local-matrix FAIL downgraded → PASS-2381: all failing scenarios ($(printf '%s' "$MX_FAILED" | tr '\n' ' ')) are the documented WI-2381 known-red set. NOT a clean pass."
        fi
      fi
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
# EI-11342: a prod-port squat by a rig-owned process invalidates the run AND is itself a
# red-worthy defect (an instance bound the wrong port ⇒ whatever that instance "proved" is void).
if [ -s "$GUARD_TRIP_FILE" ]; then
  REDS+=("prod-port-squat")
  log "PROD-PORT GUARD tripped during this run (EI-11342): $(tr '\n' '; ' <"$GUARD_TRIP_FILE")"
fi
SUMMARY="content-matrix=$MATRIX_RES from-repo=$FROMREPO_RES local-matrix=$MATRIXFULL_RES build=$([ "$FAIL_BUILD" = 1 ] && echo FAIL || echo OK)"
log "VERDICT: $SUMMARY"
echo "$(now_s)" >"$STATE_DIR/last-run"

# All legs skipped ⇒ NOT green (the vacuous-pass trap): nothing was proven this window.
# is_skip_result() also matches SKIPPED-BUSY (WI-1977: a display-contention skip is still a
# skip for this purpose — nothing was proven, whether by load-gate SKIPPED or a busy display).
if is_skip_result "$MATRIX_RES" && is_skip_result "$FROMREPO_RES" && is_skip_result "$MATRIXFULL_RES" && [ "$FAIL_BUILD" != 1 ]; then
  log "all smoke legs SKIPPED — nothing proven; NOT recording a green."
  check_staleness
  echo "GATE: SKIPPED (no legs ran — $SUMMARY)"; exit 0
fi

if [ ${#REDS[@]} -eq 0 ]; then
  echo "$(now_s)" >"$STATE_DIR/last-green"; rm -f "$STATE_DIR/stale-ei-filed" "$STATE_DIR/red-ei-filed" "$STATE_DIR/red-ei-legs"
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
# Dedup (RED_REFILE_H, see header): only file once per window per still-red condition —
# this gate runs hourly and an unresolved regression stays red for days, so without this a
# new bug work-item minted every run buries the ONE that actually needs fixing under dozens
# of timestamp-only duplicates. Cleared on the next GREEN (above), so a real fix is never
# hidden behind a stale suppression, and re-fires after RED_REFILE_H even while still red so
# a forgotten/dropped tracking item doesn't go dark forever.
TITLE="live-federation-gate RED: ${REDS[*]} failed on the packaged binary ($STAMP)"
BODY="Automated live-federation gate (WI-261/P-013) caught a RED on the real binary the hermetic suite would not (green-rig/red-binary class). Failing legs: ${REDS[*]}. Verdict: $SUMMARY. Logs: $WORK/*.out. Owner: shared-hive release lane. NOTE: a from-repo RED is EXPECTED while WI-971 (outbox drain never wired for joined/created hive harnesses; WI-259 closed as its dup) is open; a content-matrix, local-matrix, or build RED is a NEW regression — investigate."
RED_MARKER="$STATE_DIR/red-ei-filed"
# Dedup is PER failing-leg-set, not global (2026-07-16: a brand-new local-matrix
# RED was silently suppressed for 12h under the marker of an already-fixed
# content-matrix RED — a distinct regression got no tracking item). Same legs
# within the window ⇒ suppress; different legs ⇒ a new condition ⇒ file.
RED_LEGS_MARKER="$STATE_DIR/red-ei-legs"
red_marker_age_h="$(age_h "$RED_MARKER")"
prev_legs="$(cat "$RED_LEGS_MARKER" 2>/dev/null || true)"
if [ "$red_marker_age_h" -lt "$RED_REFILE_H" ] && [ "$prev_legs" = "${REDS[*]}" ]; then
  log "RED already tracked (EI filed ${red_marker_age_h}h ago for same legs '${REDS[*]}', < RED_REFILE_H ${RED_REFILE_H}h) — skipping duplicate filing. $TITLE"
else
  [ -n "$prev_legs" ] && [ "$prev_legs" != "${REDS[*]}" ] && [ "$red_marker_age_h" -lt "$RED_REFILE_H" ] \
    && log "failing-leg set changed ('$prev_legs' → '${REDS[*]}') — filing despite the ${red_marker_age_h}h-old marker."
  file_ei "$TITLE" "$BODY"
  echo "$(now_s)" >"$RED_MARKER"
  printf '%s' "${REDS[*]}" >"$RED_LEGS_MARKER"
fi
check_staleness
exit 1

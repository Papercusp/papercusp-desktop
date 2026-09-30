#!/usr/bin/env bash
# probe-session.sh — maintain a Mac-homed LIVE-1 probe SESSION so the tower has
# a roster-visible, addressable target for parity.sh legs 2+3.
#
# WHY THIS EXISTS (WI-7029, 2026-08-02)
# ------------------------------------
# parity.sh:254 discovers its wake-bridge target from the TOWER'S OWN roster:
#   SELECT owner_id FROM harness_shared.shared_session_presence
#    WHERE machine_label='<Mac>' AND last_seen_at > now() - interval '180 seconds'
# With no session homed on the Mac that query returns nothing, and legs 2+3 red
# with "no roster-visible VM-homed session … (runner/infra, not the bridge)" —
# a RUNNER fault that reads exactly like a dead wake rail.
#
# The measured cause was NOT a federation defect (WI-7029 originally said it was;
# that framing was wrong and is corrected on the item):
#   · the tower carried 3 FRESH Mac rows in harness_shared.shared_presence, so
#     PRESENCE_GOSSIP is ON in the Mac runtime, the rail is admitted and signing
#     works — device gossip Mac→tower was healthy the whole time;
#   · harness_shared.shared_session_presence had zero Mac rows because the Mac's
#     harness_shared.coord_presence had ZERO ROWS. Both tables ride the SAME
#     gated gossip topic, so the sessions frame was not broken — it was EMPTY.
# One coord:declare-intent on the Mac put a roster-visible row on the tower in
# ~2s. There is nothing to fix in the transport; the rig just needs a session.
#
# WHY A LOOP AND NOT A ONE-SHOT
# -----------------------------
# coord_presence rows go stale. Two independent freshness windows must hold for
# the WHOLE run, and a full parity run outlives both:
#   · 180s — parity.sh's target discovery (above);
#   · 120s — fed_assert_presence_gossip's own <120s window (leg 5).
# So the row must be BEATEN, not minted once. 30s is comfortably inside both.
#
# Each beat does two distinct things — both are required:
#   1. coord:declare-intent — MINTS/refreshes the coord_presence row. This is the
#      only thing that creates one: touchActivity/touchHeartbeat are deliberate
#      no-ops when no row exists, so that one-shot HTTP callers never mint roster
#      rows (agent-liveness-heartbeat-hardening D-003, dispatch-heartbeat.ts:14-19).
#   2. coord:await-inbox — arms the standing inbox-wake await, which is what makes
#      a delivery POSSIBLE. fed_assert_wake_bridge asserts an
#      event_wake_deliveries row reaching status='delivered' for
#      coord:inbox-wake:<agent>; with no subscriber there is nothing to deliver TO
#      and the leg reds for a second runner reason. Arming is automatic at real
#      SessionStart, but a stateless mcp-call --client identity has no SessionStart
#      — measured: after declare-intent alone the newest inbox-wake await row for
#      su-live1-imac-probe was still 2026-07-16.
#
# min_sleep_sec=0 is deliberate and load-bearing: it is a per-subscriber WAKE
# FLOOR ("never re-wake within this window; a burst inside it coalesces into ONE
# wake"). Left at the default standing floor it can swallow the drill's probe
# wake, reddening leg 2 for a reason indistinguishable from a dead bridge.
#
# ROSTER VISIBILITY IS NOT WAKEABILITY (WI-7029, measured 2026-08-02)
# ---------------------------------------------------------------------
# Beating presence makes the probe ADDRESSABLE — coord:send resolves it and the
# wake crosses to the Mac — but it does NOT make it WAKEABLE. A stateless
# `mcp-call --client` identity has no session, so captureWakeHandleForOwner
# (events/await/handle.ts:33) finds no adv_sessions row and stamps a NULL wake
# handle. wake-executor.ts:1369-1389 then finds no handle, finds no live psu-pty
# socket, sees presence FRESH — and PARKS:
#     status='parked'  last_error='no wake handle; presence live — inbox only'
# That is a real delivery outcome, not a bridge fault, and it reds leg 2 forever.
#
# The fix is to give the probe a handle the executor can actually act on.
# handle.ts:27-31 takes a plan-run handle straight from `plan_run_id` (no
# validation), and wake-executor.ts:1392-1406 resumes it via
# resumePlanRunForWake → status='delivered' channel='plan-run-resume'.
# So: the probe needs a plan run THAT EXISTS ON THE MAC. Name the Mac plan with
# PCUSP_PROBE_PLAN_SLUG; `start` reads its runs through `plans:runs` and either
# validates PCUSP_PROBE_PLAN_RUN_ID against them or picks the newest settled run.
#
# ⚠ NO DEFAULT RUN ID (WI-10004115, measured 2026-09-30). This used to default to
# run 1. After the VM re-joined fresh its plan_runs table was EMPTY, so every
# probe wake sat status='pending' with last_error 'plan run 1 not found': a red
# leg 2 indistinguishable from a dead wake bridge. `start` now refuses an id that
# does not exist on the Mac, instead of arming a handle that can never resume.
#
# ⚠ MINTING A FRESH RUN: the old recipe (plans:new then plans:launch) is REFUSED
# for any new plan — the acceptance-BAR start gate lets only a positively
# identified LEGACY plan launch without declared BARs
# (acceptance-bar-lifecycle-evaluator.ts, "Only a positively identified legacy
# plan may bypass the contract"). plans:new also date-suffixes the slug, so read
# the slug it RETURNS. Reuse a plan that already has a run on the Mac; with none,
# run `PCUSP_PROBE_PLAN_RUN_ID=none` (addressable-only, leg 2 parks) and track the
# fixture-mint gap on its work-item rather than faking a handle.
#
# ⚠ The run must NOT be left in status='running': markPlanRunResumed
# (plans/runs.ts:279-287) claims only `WHERE status <> 'running'`, so a wake
# against a running row returns "already running — wake skipped" (an ERROR
# outcome, not a delivery). A settled run — `failed` included — is claimable.
#
# ⚠ SCOPE LIMIT, state it whenever you quote a green leg 2: plan-run-wake.ts:36-54
# fires executePlanAgentTurn FIRE-AND-FORGET and returns ok:true immediately, so
# 'delivered' proves the wake CROSSED and the Mac CLAIMED + DISPATCHED a turn —
# it does NOT prove the turn ran. On this rig it provably cannot: the Mac has
# zero gateway accounts and org-disabled local Claude credentials (fact
# `mac-rig-has-no-llm-credentials`), so the dispatched turn always fails.
#
# Usage:  bin/vm-rig/probe-session.sh [start|stop|status]
# Env:    PCUSP_VM_SSH             ssh target (default aviweiss@172.31.44.2)
#         PCUSP_PARITY_PROBE_AGENT probe identity (default su-live1-imac-probe)
#         PCUSP_PROBE_BEAT_SEC     beat interval (default 30)
#         PCUSP_PROBE_WAIT_SEC     max tower-roster convergence wait (default 180)
#         PCUSP_PROBE_POLL_SEC     tower-roster poll cadence (default 3)
#         PCUSP_PROBE_PLAN_SLUG    Mac-side plan whose runs supply the wake handle.
#                                  Required unless PCUSP_PROBE_PLAN_RUN_ID=none.
#         PCUSP_PROBE_PLAN_RUN_ID  Mac-side plan_runs id → a plan-run WAKE HANDLE.
#                                  Must exist under PCUSP_PROBE_PLAN_SLUG and not
#                                  be 'running'; unset ⇒ the newest settled run of
#                                  that plan. 'none' ⇒ addressable but NOT wakeable
#                                  (leg 2 reds 'parked'). NO numeric default.
set -uo pipefail

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
AGENT="${PCUSP_PARITY_PROBE_AGENT:-su-live1-imac-probe}"
BEAT="${PCUSP_PROBE_BEAT_SEC:-30}"
WAIT_SEC="${PCUSP_PROBE_WAIT_SEC:-180}"
POLL_SEC="${PCUSP_PROBE_POLL_SEC:-3}"
PLAN_RUN="${PCUSP_PROBE_PLAN_RUN_ID:-}"
PLAN_SLUG="${PCUSP_PROBE_PLAN_SLUG:-}"
TOWER_DSN="${PCUSP_TOWER_DSN:-postgresql://harness_admin:harness_admin_pwd@127.0.0.1:5432/papercusp}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$HERE/deploy.sh"

REMOTE_LOOP="/tmp/live1-probe-session-loop.sh"
PIDFILE="/tmp/live1-probe-session.pid"
LOG="/tmp/live1-probe-session.log"

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$VM")

# The Mac machine_label parity.sh derives: <hostname with . → _>-<ssh user>.
vm_machine_label() {
  local host user
  host="$("${SSH[@]}" 'hostname' 2>/dev/null | tr -d '[:space:]')"
  user="${VM%%@*}"
  printf '%s-%s' "$(printf '%s' "$host" | tr '.' '_')" "$user"
}

tower_row() { # echo "<age_seconds>" for the freshest probe row on the TOWER, else empty
  psql "$TOWER_DSN" -tA -c \
    "SELECT round(extract(epoch from (now()-last_seen_at)))
       FROM harness_shared.shared_session_presence
      WHERE owner_id='$AGENT' ORDER BY last_seen_at DESC LIMIT 1;" 2>/dev/null | tr -d '[:space:]'
}

# Resolve PLAN_RUN to a plan run that EXISTS on the Mac and is not 'running'
# (WI-10004115). Prints the reason and returns non-zero instead of arming a
# handle that can never resume. Sets PLAN_RUN (empty for the explicit 'none').
resolve_plan_run() {
  case "$PLAN_RUN" in
    none)
      PLAN_RUN=""
      echo "probe-session: PCUSP_PROBE_PLAN_RUN_ID=none — addressable but NOT wakeable (leg 2 will park)"
      return 0 ;;
    '') ;;
    0|*[!0-9]*)
      echo "FATAL: PCUSP_PROBE_PLAN_RUN_ID must be a positive integer or 'none' (got '$PLAN_RUN')" >&2
      return 2 ;;
  esac
  if [ -z "$PLAN_SLUG" ]; then
    echo "FATAL: PCUSP_PROBE_PLAN_SLUG is unset. Name the Mac plan whose run is the wake handle," >&2
    echo "       or set PCUSP_PROBE_PLAN_RUN_ID=none to run addressable-only (leg 2 parks)." >&2
    return 2
  fi
  case "$PLAN_SLUG" in
    -*|*[!a-z0-9-]*)
      echo "FATAL: PCUSP_PROBE_PLAN_SLUG must be a plan slug [a-z0-9-] (got '$PLAN_SLUG')" >&2
      return 2 ;;
  esac
  local runs_json out
  runs_json="$("${SSH[@]}" "/tmp/vmcall.sh plans:runs '{\"harness\":\"papercusp\",\"slug\":\"$PLAN_SLUG\"}' --client '$AGENT' --workspace papercusp-workspace --harness papercusp" 2>/dev/null)"
  if ! out="$(RUNS_JSON="$runs_json" WANT="$PLAN_RUN" SLUG="$PLAN_SLUG" node -e '
    const raw = process.env.RUNS_JSON || "";
    const want = process.env.WANT;
    const slug = process.env.SLUG;
    const fail = (m) => { console.log("FATAL: " + m); process.exit(1); };
    let doc;
    try { doc = JSON.parse(raw.slice(raw.indexOf("{"))); }
    catch { fail(`could not read plans:runs for "${slug}" on the Mac (reply: ${raw.slice(0, 200) || "<empty>"}); check the VM operator with bin/vm-rig/diag.sh`); }
    if (doc.error) fail(`plans:runs refused for "${slug}" on the Mac: ${doc.error} ${doc.message || ""}`);
    const runs = Array.isArray(doc.runs) ? doc.runs : [];
    const list = runs.map((r) => `${r.id}:${r.status}`).join(", ") || "none";
    if (want) {
      const run = runs.find((r) => String(r.id) === want);
      if (!run) fail(`plan run ${want} does not exist on the Mac under "${slug}" (runs: ${list}); arming it would park every wake with last_error "plan run ${want} not found"`);
      if (run.status === "running") fail(`plan run ${want} is status=running; markPlanRunResumed claims only a settled run, so every wake would be skipped as already running`);
      console.log(String(run.id));
    } else {
      const run = runs.find((r) => r.status !== "running");
      if (!run) fail(`plan "${slug}" has no settled run on the Mac (runs: ${list}); set PCUSP_PROBE_PLAN_RUN_ID=none to run addressable-only`);
      console.log(String(run.id));
    }
  ')"; then
    echo "$out" >&2
    return 1
  fi
  PLAN_RUN="$out"
}

stop_remote() {
  # Kill by RECORDED PID only. Never `pkill -f <pattern>`: that has twice killed
  # the owner's live desktop and peers' processes, and on the rig it would also
  # match this very ssh command's own argv.
  "${SSH[@]}" "
    if [ -f '$PIDFILE' ]; then
      p=\$(cat '$PIDFILE' 2>/dev/null)
      if [ -n \"\$p\" ] && kill -0 \"\$p\" 2>/dev/null; then
        kill \"\$p\" 2>/dev/null
        for i in 1 2 3 4 5; do kill -0 \"\$p\" 2>/dev/null || break; sleep 1; done
        kill -0 \"\$p\" 2>/dev/null && kill -9 \"\$p\" 2>/dev/null
        echo \"stopped pid=\$p\"
      else
        echo 'no live pid in pidfile'
      fi
      rm -f '$PIDFILE'
    else
      echo 'no pidfile'
    fi" 2>&1
}

case "${1:-start}" in
  stop)
    echo "probe-session: stopping on $VM"
    stop_remote
    ;;

  status)
    echo "probe-session: agent=$AGENT vm=$VM"
    "${SSH[@]}" "
      if [ -f '$PIDFILE' ]; then
        p=\$(cat '$PIDFILE');
        if kill -0 \"\$p\" 2>/dev/null; then echo \"  mac loop: ALIVE pid=\$p\"; else echo \"  mac loop: DEAD (stale pidfile pid=\$p)\"; fi
      else echo '  mac loop: not started (no pidfile)'; fi
      echo \"  mac log tail:\"; tail -3 '$LOG' 2>/dev/null | sed 's/^/    /'" 2>&1
    age="$(tower_row)"
    if [ -n "$age" ]; then
      echo "  tower roster: $AGENT visible, ${age}s old $([ "$age" -lt 120 ] 2>/dev/null && echo '(FRESH — legs 2+3 runnable)' || echo '(STALE >120s)')"
    else
      echo "  tower roster: $AGENT NOT PRESENT — legs 2+3 will red on target discovery"
    fi
    ;;

  start)
    case "$WAIT_SEC" in
      ''|0|*[!0-9]*) echo "FATAL: PCUSP_PROBE_WAIT_SEC must be a positive integer" >&2; exit 2 ;;
    esac
    case "$POLL_SEC" in
      ''|0|*[!0-9]*) echo "FATAL: PCUSP_PROBE_POLL_SEC must be a positive integer" >&2; exit 2 ;;
    esac
    WAIT_TRIES=$(( (WAIT_SEC + POLL_SEC - 1) / POLL_SEC ))

    # A VM reboot clears /tmp. Restore exact, hash-verified checked-in helpers
    # through the canonical deploy seam before retaining the fatal preflight as
    # the detector for an unreachable VM or a failed/corrupt install.
    if ! "${SSH[@]}" 'test -x /tmp/vmcall.sh && test -f /tmp/mcp-call.mjs' 2>/dev/null; then
      echo "probe-session: VM reboot cleared /tmp helpers; restoring through $DEPLOY"
      "$DEPLOY" "$VM" || true
    fi
    if ! "${SSH[@]}" 'test -x /tmp/vmcall.sh && test -f /tmp/mcp-call.mjs' 2>/dev/null; then
      echo "FATAL: /tmp/vmcall.sh or /tmp/mcp-call.mjs still missing on $VM after automatic deploy." >&2
      exit 1
    fi

    # Resolve the wake handle BEFORE touching the running loop, so a refusal
    # leaves any existing probe session as it was.
    resolve_plan_run || exit $?

    echo "probe-session: agent=$AGENT beat=${BEAT}s vm=$VM plan=${PLAN_SLUG:-none} plan_run=${PLAN_RUN:-none (NOT wakeable — leg 2 will park)} admission_wait=${WAIT_SEC}s"

    stop_remote >/dev/null 2>&1

    tmp="$(mktemp)"
    cat > "$tmp" <<'LOOP_EOF'
#!/bin/bash
# live1-probe-session-loop.sh — pushed by bin/vm-rig/probe-session.sh. Beats a
# Mac-homed coord_presence row + the standing inbox-wake await so the TOWER has
# a fresh, addressable, WAKEABLE target for parity.sh legs 2+3. See the
# controller script for the full rationale (WI-7029).
AGENT="$1"; BEAT="$2"; PLAN_RUN="${3:-}"
WS="papercusp-workspace"; H="papercusp"
# The arm payload must carry plan_run_id on EVERY beat, not just the first.
# armInboxWake re-captures the handle each call (inbox-wake-arm.ts:73-76) and
# upserts the ONE standing row, so a later beat that omitted it would overwrite
# the plan-run handle back to NULL and silently return the probe to 'parked'.
ARM_ARGS='{"note":"LIVE-1 parity probe target — idle by design (WI-7029)","min_sleep_sec":0}'
if [ -n "$PLAN_RUN" ]; then
  ARM_ARGS="{\"note\":\"LIVE-1 parity probe target — idle by design (WI-7029)\",\"min_sleep_sec\":0,\"plan_run_id\":$PLAN_RUN}"
fi
while :; do
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  /tmp/vmcall.sh coord:declare-intent \
    "{\"intent\":\"LIVE-1 parity probe target (WI-7029) — Mac-homed presence for parity.sh legs 2+3\"}" \
    --client "$AGENT" --workspace "$WS" --harness "$H" >/dev/null 2>&1
  rc1=$?
  # min_sleep_sec=0: never let the standing wake FLOOR coalesce away the drill's probe wake.
  /tmp/vmcall.sh coord:await-inbox "$ARM_ARGS" \
    --client "$AGENT" --workspace "$WS" --harness "$H" >/dev/null 2>&1
  rc2=$?
  echo "$ts beat declare=$rc1 arm=$rc2 planrun=${PLAN_RUN:-none}"
  sleep "$BEAT"
done
LOOP_EOF
    scp -q -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$tmp" "$VM:$REMOTE_LOOP"
    rm -f "$tmp"

    # Fully detach: nohup alone dies with the ssh session (same lesson as
    # boot-headless-current.sh) — perl setsid survives it.
    "${SSH[@]}" "
      chmod +x '$REMOTE_LOOP'
      : > '$LOG'
      perl -e '\$SIG{HUP}=\"IGNORE\"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,\"<\",\"/dev/null\"); exec @ARGV or die' -- \
        /bin/bash '$REMOTE_LOOP' '$AGENT' '$BEAT' '$PLAN_RUN' >> '$LOG' 2>&1 &
      sleep 3
      p=\$(pgrep -f 'live1-probe-session-loop.sh' | head -1)
      echo \"\${p:-}\" > '$PIDFILE'
      echo \"launched pid=\${p:-?}\"" 2>&1

    # Verify the ONLY thing that matters: a FRESH row on the TOWER. A live pid on
    # the Mac proves the loop runs, not that gossip crossed the machine boundary.
    # A healthy gossip channel can take longer than one minute to converge after
    # a cold sidecar restart. The old fixed 20×3s window false-failed a live loop:
    # it exited at 60s while the unchanged probe became fresh shortly afterward.
    # Default to the target-discovery horizon (180s), keep it operator-tunable,
    # and remain hard-bounded so a genuinely dead producer still fails loudly.
    echo "  waiting up to ${WAIT_SEC}s for the row to reach the tower roster…"
    for ((i = 1; i <= WAIT_TRIES; i += 1)); do
      age="$(tower_row)"
      if [ -n "$age" ] && [ "$age" -lt 120 ] 2>/dev/null; then
        echo "  ✓ tower roster: $AGENT fresh (${age}s) — legs 2+3 have a target"
        exit 0
      fi
      sleep "$POLL_SEC"
    done
    echo "  ✗ $AGENT never became fresh on the tower within ${WAIT_SEC}s" >&2
    echo "    the remote loop may still be converging; run '$0 status' before classifying this as a transport failure" >&2
    echo "    mac-side log:" >&2
    "${SSH[@]}" "tail -10 '$LOG'" 2>&1 | sed 's/^/      /' >&2
    exit 1
    ;;

  *)
    echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac

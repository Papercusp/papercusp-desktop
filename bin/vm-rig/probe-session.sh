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
# So: mint a plan run ON THE MAC once, then pass its id here.
#
#   /tmp/vmcall.sh plans:new    '{"harness":"papercusp","slug":"…","force":true}'
#   /tmp/vmcall.sh plans:launch '{"harness":"papercusp","slug":"…","await":false}'
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
#         PCUSP_PROBE_PLAN_RUN_ID  Mac-side plan_runs id → a plan-run WAKE HANDLE.
#                                  Unset ⇒ addressable but NOT wakeable (leg 2
#                                  reds 'parked'). Default 1 (the run minted for
#                                  plan live1-wake-bridge-probe-2026-08-02).
set -uo pipefail

VM="${PCUSP_VM_SSH:-aviweiss@172.31.44.2}"
AGENT="${PCUSP_PARITY_PROBE_AGENT:-su-live1-imac-probe}"
BEAT="${PCUSP_PROBE_BEAT_SEC:-30}"
PLAN_RUN="${PCUSP_PROBE_PLAN_RUN_ID:-1}"
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
    echo "probe-session: agent=$AGENT beat=${BEAT}s vm=$VM plan_run=${PLAN_RUN:-none (NOT wakeable — leg 2 will park)}"

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
    echo "  waiting for the row to reach the tower roster…"
    for i in $(seq 1 20); do
      age="$(tower_row)"
      if [ -n "$age" ] && [ "$age" -lt 120 ] 2>/dev/null; then
        echo "  ✓ tower roster: $AGENT fresh (${age}s) — legs 2+3 have a target"
        exit 0
      fi
      sleep 3
    done
    echo "  ✗ $AGENT never became fresh on the tower within 60s" >&2
    echo "    mac-side log:" >&2
    "${SSH[@]}" "tail -10 '$LOG'" 2>&1 | sed 's/^/      /' >&2
    exit 1
    ;;

  *)
    echo "usage: $0 [start|stop|status]" >&2; exit 2 ;;
esac

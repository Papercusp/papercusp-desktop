#!/usr/bin/env bash
# Tauri's `beforeDevCommand` runs unconditionally on every `npm run dev`.
#
# release-pipeline-resilience P-010 (owner-approved OWN-PORT option,
# 2026-06-10): `npm run dev` must load the LOCAL working tree, not whatever
# happens to own the shared dev-box ports. The systemd operators own
# :3070 (green release) and :3170 (fleet staging — restarted by agents at
# will), so the desktop session gets its OWN working-tree Hono operator on
# a dedicated port (:3270 by default, PTY WS on :3274) that nothing else
# restarts. Mirrors papercup-staging-api's invocation (.env.local sourced,
# background workers/DBOS routines OFF — the green :3070 owns those).
#
# If :3270 is already bound (an earlier `tauri dev` session's operator),
# starting a second one fails with EADDRINUSE and aborts the Tauri build —
# this wrapper skips the spawn and the running process becomes the operator
# backend for this Tauri session.
#
# EI-142 (P-054): when this wrapper DOES spawn the dev stack, it must also
# reap it. tauri-cli only kills THIS wrapper process on exit — the
# npm → node → tsx tree it spawned used to be orphaned to PID 1,
# leaving stale dev servers behind after every `tauri dev` session.
# The stack now runs in its own process group (setsid) with two layers of
# reaping:
#   1. an EXIT/INT/TERM/HUP trap (covers a clean wrapper shutdown), and
#   2. a detached watchdog that survives even a SIGKILL'd wrapper: it polls
#      the wrapper PID and TERM-then-KILLs the dev-stack group once the
#      wrapper is gone.
set -euo pipefail

PORT="${OPERATOR_DEV_PORT:-3270}"
# PTY WS data plane: +4, not +1 — :3271..:3273 are squatted by dev-box
# tooling (socat relays); 3274 verified free at authoring.
PTY_PORT="${OPERATOR_DEV_PTY_PORT:-$((PORT + 4))}"
# The working-tree Hono host on the dedicated port. PLAN_RENDER/timers/
# autoloop stay off — the green/staging operators own those. DBOS ROUTINES is
# ON (owner-enabled 2026-06-16): the desktop runs the claim-guarded routines
# tick (hive watchdogs + Queen wake), so the Queen can execute on this HEALTHY
# operator when :3070 is saturated. SAFE because claimDueRoutine's conditional
# next_fire_at advance guarantees single-fire across operators — no double
# git-sync/deploy. AUTOLOOP stays OFF (not claim-guarded → would double-drive
# the pipeline). Revert PAPERCUSP_DBOS_ROUTINES=0 to restore request-only.
# NOTE (WI-3042): no `exec` here — the supervision loop below re-runs this
# command after a non-zero exit (the memory-watchdog recycle path), and an
# `exec` would replace the loop shell on the first iteration, killing the loop.
# NOTE (WI-3556, 2026-07-09): PAPERCUSP_CLUSTER=0 is PINNED. Agent sessions
# inherit the release host's env (PAPERCUSP_CLUSTER=16 on the 128-core box);
# without the pin an agent-launched `tauri dev` forked 16 tsx request workers
# (~500% CPU each → host load >1000). The dev host must be single-process
# anyway: it carries the PTY WS plane, which is incompatible with clustering
# (hono-host.ts P3-2 note).
# NOTE (EI-8817/EI-8818): PAPERCUSP_CLUSTER_WORKERS=0 is ALSO pinned — it takes
# precedence over PAPERCUSP_CLUSTER in resolveClusterWorkers, so an
# inherited/caller-set CLUSTER_WORKERS silently bypasses the CLUSTER=0 pin above
# regardless of its value (that is exactly how the 2026-07-09 storm recurred an
# hour after the CLUSTER=0 pin — a caller had set CLUSTER_WORKERS=1). The '1' ⇒
# AUTO (~15 workers on the tower) semantics that made THAT specific value land on
# a fork storm is now fixed in resolveClusterWorkers itself ('1' means exactly one
# worker) — this explicit =0 pin stays anyway as defense-in-depth: it is still
# correct for CLUSTER_WORKERS to win over CLUSTER, so an agent that sets
# CLUSTER_WORKERS to ANY nonzero value here would still shadow this pin.
DEFAULT_DEV_CMD="cd ../apps/operator && set -a && if [ -f .env.local ]; then . ./.env.local; fi && set +a && env PAPERCUSP_HONO_PORT=$PORT PAPERCUSP_PTY_WS_PORT=$PTY_PORT PAPERCUSP_CLUSTER=0 PAPERCUSP_CLUSTER_WORKERS=0 PAPERCUSP_BACKGROUND_WORKERS=0 PAPERCUSP_DBOS_ENABLE=1 PAPERCUSP_DBOS_TIMERS=0 PAPERCUSP_DBOS_ROUTINES=1 PAPERCUSP_DBOS_AUTOLOOP=0 PAPERCUSP_DBOS_PLAN_RENDER=0 DBOS__VMID=desktop-dev-$PORT npx tsx bin/hono-host.ts"
# Test seam: lets the reaper mechanics be exercised with a harmless
# long-running command instead of booting the real dev stack.
DEV_CMD="${OPERATOR_DEV_CMD:-$DEFAULT_DEV_CMD}"

# Detection — prefer ss (always present on Linux), fall back to lsof.
in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -tlnH "sport = :$PORT" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1
  else
    # No tooling — try to bind via Bash's /dev/tcp; success means we'd collide.
    (exec 3<>/dev/tcp/127.0.0.1/"$PORT") 2>/dev/null && exec 3<&- && return 0
    return 1
  fi
}

if in_use; then
  echo "[tauri] operator already serving on :$PORT — reusing"
  # `beforeDevCommand` reuse path: exit immediately so Tauri proceeds to
  # spawn its native window pointing at the existing dev server. We did not
  # start that server, so we also don't reap it.
  exit 0
fi

echo "[tauri] starting operator dev server on :$PORT"
# New session + process group so the whole npm → node → tsx tree is a
# single kill target (`kill -- -$GROUP`). Do NOT trust `$!` as the group id:
# util-linux setsid only execs in place when the spawned pid is not already
# a group leader — when it FORKS instead, `$!` is the exited setsid and the
# group kill silently no-ops, orphaning the stack. The inner shell's `$$` IS
# the session leader in both cases, so it reports the true group through a
# pidfile instead of assuming the exec-in-place fast path.
GROUP_FILE="$(mktemp -t dev-operator-group.XXXXXX)"
# Supervision parity with systemd Restart=always (WI-3042): the hono-host
# memory-watchdog recycles a leaked host by EXITING NON-ZERO and expects a
# supervisor to bring up a fresh low-RSS process — systemd does that for
# :3070/:3170, but nothing did here, so a recycle left the desktop dead
# behind a "window will reconnect automatically" recovery page forever.
# Restart on non-zero exit (3s backoff); a graceful stop (exit 0 — e.g. the
# SIGTERM connection-drain path) still ends the session. Each iteration runs
# in a subshell so DEV_CMD's `cd` starts from the same cwd every time.
setsid bash -c 'echo "$$" > "$1"; shift
  while :; do
    ( eval "$1" ); code=$?
    [ "$code" -eq 0 ] && exit 0
    echo "[tauri] operator dev server exited code=$code — restarting in 3s (WI-3042 supervision)" >&2
    sleep 3
  done' _ "$GROUP_FILE" "$DEV_CMD" &
CHILD=$!
GROUP=""
for _ in $(seq 1 50); do
  GROUP="$(cat "$GROUP_FILE" 2>/dev/null || true)"
  [ -n "$GROUP" ] && break
  sleep 0.1
done
rm -f "$GROUP_FILE"
GROUP="${GROUP:-$CHILD}"

reap() {
  kill -TERM -- "-$GROUP" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 -- "-$GROUP" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL -- "-$GROUP" 2>/dev/null || true
}
trap reap EXIT INT TERM HUP

# Watchdog: its own session too, so nothing that kills our group takes it
# down before it can reap. It exits as soon as the dev-stack group is gone.
setsid bash -c '
  wrapper="$1"; child="$2"
  while kill -0 "$wrapper" 2>/dev/null; do sleep 1; done
  kill -TERM -- "-$child" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 -- "-$child" 2>/dev/null || exit 0
    sleep 0.1
  done
  kill -KILL -- "-$child" 2>/dev/null || true
' dev-operator-watchdog "$$" "$GROUP" >/dev/null 2>&1 &

# Block for the dev stack's lifetime (tauri-cli treats a long-running
# beforeDevCommand as the dev server and pings devUrl for readiness).
# In the forked-setsid case $CHILD exits immediately while the stack lives
# on in $GROUP — keep blocking on the group so the wrapper's exit (and its
# EXIT-trap reap) only happens once the stack itself is gone.
wait "$CHILD" || true
while kill -0 -- "-$GROUP" 2>/dev/null; do sleep 1; done

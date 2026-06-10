#!/usr/bin/env bash
# Tauri's `beforeDevCommand` runs unconditionally on every `npm run dev`.
# If the operator dev stack is already serving on :3055 (e.g. started via
# `bin/overmind-all start` or an earlier `tauri dev` instance), starting a
# second one fails with EADDRINUSE and aborts the Tauri build. This wrapper
# skips the spawn when port 3055 is already bound; the running process
# becomes the operator backend for this Tauri session.
#
# EI-142 (P-054): when this wrapper DOES spawn the dev stack, it must also
# reap it. tauri-cli only kills THIS wrapper process on exit — the
# npm → node → vite/hono tree it spawned used to be orphaned to PID 1,
# leaving stale :3055 Vite servers behind after every `tauri dev` session.
# The stack now runs in its own process group (setsid) with two layers of
# reaping:
#   1. an EXIT/INT/TERM/HUP trap (covers a clean wrapper shutdown), and
#   2. a detached watchdog that survives even a SIGKILL'd wrapper: it polls
#      the wrapper PID and TERM-then-KILLs the dev-stack group once the
#      wrapper is gone.
set -euo pipefail

PORT="${OPERATOR_DEV_PORT:-3055}"
# Test seam: lets the reaper mechanics be exercised with a harmless
# long-running command instead of booting the real dev stack.
DEV_CMD="${OPERATOR_DEV_CMD:-npm --prefix .. run dev:operator}"

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
# New session + process group so the whole npm → node → vite/hono tree is a
# single kill target (`kill -- -$CHILD`). The backgrounded process is never
# our group leader, so util-linux setsid execs in place without forking and
# $! is the group leader's pid. `exec` keeps bash out of the tree.
setsid bash -c "exec $DEV_CMD" &
CHILD=$!

reap() {
  kill -TERM -- "-$CHILD" 2>/dev/null || true
  for _ in $(seq 1 50); do
    kill -0 -- "-$CHILD" 2>/dev/null || return 0
    sleep 0.1
  done
  kill -KILL -- "-$CHILD" 2>/dev/null || true
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
' dev-operator-watchdog "$$" "$CHILD" >/dev/null 2>&1 &

# Block for the dev stack's lifetime (tauri-cli treats a long-running
# beforeDevCommand as the dev server and pings devUrl for readiness).
wait "$CHILD"

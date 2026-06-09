#!/usr/bin/env bash
# Tauri's `beforeDevCommand` runs unconditionally on every `npm run dev`.
# If the operator dev server is already serving on :3055 (e.g. started via
# `bin/overmind-all start` or an earlier `tauri dev` instance that didn't
# clean up), starting a second one fails with EADDRINUSE and aborts the
# Tauri build. This wrapper skips the spawn when port 3055 is already
# bound; the running process becomes the operator backend for this Tauri
# session.
set -euo pipefail

PORT="${OPERATOR_DEV_PORT:-3055}"

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
  # `beforeDevCommand` blocks the Tauri startup until this exits. Exit
  # immediately so Tauri proceeds to spawn its native window pointing at
  # the existing dev server.
  exit 0
fi

echo "[tauri] starting operator dev server on :$PORT"
exec npm --prefix .. run dev:operator

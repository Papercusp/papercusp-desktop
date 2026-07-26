#!/usr/bin/env bash
# boot-headless-current.sh — run the rig VM's operator from a TOWER-BUILT
# current serve.mjs (composed dir /Users/aviweiss/rig-sidecar-current), against
# the installed app bundle's darwin native deps + node runtime.
#
# WHY (WI-4070 endgame, 2026-07-17): the installed Jul-11 bundle was built
# MID-rename (still queries harness_shared.hive* → loadHivePubkey null → cannot
# sign → outbound federation dead), and dev-source extracts from the bundle's
# own source.tar.zst so it can never be newer. Until a fresh mac app build is
# cut, current code must arrive as a tower-built esbuild bundle: see
# build-desktop-sidecar.sh's serve.mjs recipe with ALL @embedded-postgres
# platforms externalized (they resolve from the composed node_modules).
#
# The composed dir (built by the deploy step on the tower):
#   rig-sidecar-current/serve.mjs      ← tower-built, current tree
#   rig-sidecar-current/db-sql/        ← current migrations
#   rig-sidecar-current/prompts/       ← current prompts
#   rig-sidecar-current/node_modules/  ← per-entry symlinks → app bundle's
#       node_modules (darwin natives), + @embedded-postgres/darwin-x64 →
#       the bundle's nested embedded-postgres-server copy
set -uo pipefail

APP="/Applications/Papercusp Server.app"
SIDECAR="$APP/Contents/Resources/sidecar"
CUR="/Users/aviweiss/rig-sidecar-current"
SHARED="/Users/aviweiss/.papercusp-workspaces/.shared"
REAL_HOME="/Users/aviweiss"
NODE="$SIDECAR/bin/node"
SERVE="$CUR/serve.mjs"
LOG="/tmp/serve-current.log"
PIDFILE="/tmp/serve-current.pid"
HONO_PORT="${PAPERCUSP_HONO_PORT:-3070}"

for f in "$NODE" "$SERVE" "$CUR/db-sql" "$CUR/node_modules" "$CUR/sql"; do
  [ -e "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

# --- GUARD (2026-07-26): $CUR/sql must be the LOCKS migration set, NOT the main one.
# The composed dir carries TWO distinct sql dirs and they are easy to swap:
#   $CUR/db-sql  → the MAIN papercusp migrations (000-baseline + 6xx), consumed
#                  via PAPERCUSP_PG_SQL_DIR by serve's embedded-PG boot runner.
#   $CUR/sql     → the ~21-file LOCKS set (001-bootstrap … 0NN-*), consumed by
#                  @papercusp/locks' su-lock-store, whose SQL_DIR is
#                  `dirname(import.meta.url)/sql`. In an ESBUILD BUNDLE that
#                  collapses to the bundle's own directory — i.e. THIS dir —
#                  so whatever sits at $CUR/sql IS the locks migration set.
# When the main set was copied here by mistake, locks bootstrap tried to apply
# 000-baseline.sql to the `papercusp_su` side-DB, which has no extensions, and
# died on `type "public.vector" does not exist`. The whole txn rolls back, so
# ensureBootstrap throws and FILE LOCKING + git-sync locks are dead rig-wide
# ("[git-sync] lock infra unavailable"). Silent apart from that one line.
# Refresh with: rsync -a libs/papercusp/packages/locks/src/sql/ <vm>:$CUR/sql/
if [ -e "$CUR/sql/000-baseline.sql" ] || [ ! -e "$CUR/sql/001-bootstrap.sql" ]; then
  echo "FATAL: $CUR/sql is not the locks migration set." >&2
  echo "  expected 001-bootstrap.sql (locks); found $(ls "$CUR"/sql/*.sql 2>/dev/null | wc -l) files$([ -e "$CUR/sql/000-baseline.sql" ] && echo ', including 000-baseline.sql — that is the MAIN set, wrong dir')." >&2
  echo "  fix: rsync -a libs/papercusp/packages/locks/src/sql/ \"\$VM:$CUR/sql/\"" >&2
  exit 1
fi

# --- stop any prior rig operator variant (bundle / dev-source / current)
for pf in /tmp/serve-headless.pid /tmp/serve-devsource.pid "$PIDFILE"; do
  if [ -f "$pf" ]; then
    op=$(cat "$pf" 2>/dev/null)
    if [ -n "${op:-}" ] && kill -0 "$op" 2>/dev/null; then
      echo "stopping operator pid=$op ($pf)…"; kill "$op" 2>/dev/null
      for i in $(seq 1 10); do kill -0 "$op" 2>/dev/null || break; sleep 1; done
      kill -0 "$op" 2>/dev/null && kill -9 "$op" 2>/dev/null
    fi
  fi
done
for i in $(seq 1 10); do
  curl -fsS -m 2 "http://127.0.0.1:${HONO_PORT}/api/health" >/dev/null 2>&1 || break
  sleep 1
done

# --- env: bundle-variant parity; current db-sql/prompts; bundle resources else
export HOME="$REAL_HOME"; export USERPROFILE="$REAL_HOME"
export PATH="$SIDECAR/bin:$PATH"
export PAPERCUSP_SIDECAR_BIN="$SIDECAR/bin"
export PAPERCUSP_HONO_PORT="$HONO_PORT"
export PAPERCUSP_BIND_HOST="127.0.0.1"
export HOSTNAME="127.0.0.1"
export NODE_ENV="production"
export PAPERCUSP_SERVE_UI="1"
export PAPERCUSP_HARNESS_DIR="$SIDECAR/harness"
export PAPERCUSP_TEMPLATES_DIR="$SIDECAR/templates"
export PAPERCUSP_RUBRICS_DIR="$SIDECAR/rubrics"
export PAPERCUSP_DESKTOP="1"
export PAPERCUSP_DBOS_ENABLE="1"
export PAPERCUSP_DBOS_ROUTINES="1"
export PAPERCUSP_DBOS_ORCHESTRATOR="1"
export PAPERCUSP_SHARED_OPERATOR="1"
export PAPERCUSP_OPERATOR_BASE="http://localhost:${HONO_PORT}"
export PAPERCUSP_SPA_DIST="$SIDECAR/spa"
export PAPERCUSP_DOCS_ROOT="$SIDECAR/internal-docs"
export PAPERCUSP_PROMPTS_DIR="$CUR/prompts"
export PAPERCUSP_PG_PORT="${PAPERCUSP_PG_PORT:-18213}"
export PAPERCUSP_PG_DATA_DIR="$SHARED/embedded-pg-data"
export PAPERCUSP_PG_SQL_DIR="$CUR/db-sql"
export PAPERCUSP_SEED_DIR="$APP/Contents/Resources/seed"
export PAPERCUSP_PG_SEED_PATH="$SIDECAR/db-seed.tar.gz"
export PAPERCUSP_IDENTITY_DIR="$SHARED/.papercusp/identity"
export PAPERCUSP_ANNOUNCE_IDENTITY_CACHE="$SHARED/.papercusp/local-announce-identity.json"
export PAPERCUSP_WORKSPACES_ROOT="/Users/aviweiss/.papercusp-workspaces"
export PAPERCUSP_IPC_ENABLE="1"
export PAPERCUSP_DHT_BOOTSTRAP="${PAPERCUSP_DHT_BOOTSTRAP:-172.31.44.1:49838}"
# EI-13317 forensics ride the per-attempt dial trace (peer-dial-registry.ts) —
# keep it armed by default on the rig so a reboot never silently drops the
# evidence stream (su-71c69's reverse-leg legs depend on it).
export HGDIALDEBUG="${HGDIALDEBUG:-1}"

echo "boot-current: serve=$SERVE"
echo "boot-current: PG_DATA_DIR=$PAPERCUSP_PG_DATA_DIR  PG_SQL_DIR=$PAPERCUSP_PG_SQL_DIR"
echo "boot-current: DHT=$PAPERCUSP_DHT_BOOTSTRAP  PORT=$PAPERCUSP_HONO_PORT"

# --- fully detach (perl setsid; nohup alone dies with the ssh session)
: > "$LOG"
cd "$CUR" || exit 1
perl -e '$SIG{HUP}="IGNORE"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,"<","/dev/null"); exec @ARGV or die "exec: $!"' -- \
  "$NODE" "$SERVE" --ensure >>"$LOG" 2>&1 </dev/null &
sleep 2
pid="$(pgrep -f 'serve.mjs --ensure' | head -1)"
echo "${pid:-}" > "$PIDFILE"
echo "LAUNCHED (detached, current) serve.mjs --ensure pid=${pid:-?} log=$LOG"
sleep 3
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "STILL-ALIVE after ~5s. Poll $LOG + :${HONO_PORT}/api/health."
else
  echo "DIED early — see $LOG:" >&2; tail -40 "$LOG" >&2; exit 1
fi

#!/usr/bin/env bash
# boot-headless-devsource.sh — start the rig VM's operator from the DEV-SOURCE
# tree (current code) instead of the packaged Papercusp Server.app bundle.
#
# WHY THIS EXISTS (WI-4070, 2026-07-17): an installed app bundle can be OLDER
# than the shared DB's schema — the Jul-11 bundle still queried pre-mig-557
# harness_shared.hive* tables against a post-557 DB, so loadHivePubkey returned
# null → the VM could not SIGN → outbound federation dead while inbound catch-up
# worked. The lazy hive-owner-key-health sweep (~5min post-boot) is where the
# relation errors surface — a boot-time "0 relation errors" grep is a FALSE
# GREEN. Dev-source (kept fresh by the WI-5066 re-extract) carries current code;
# this variant runs serve.ts from it against the SAME identity/PG/DHT state so
# federation can be verified on healed code while the app bundle awaits rebuild.
#
# Usage (on the tower):
#   scp bin/vm-rig/boot-headless-devsource.sh aviweiss@172.31.44.2:/tmp/
#   ssh aviweiss@172.31.44.2 'bash /tmp/boot-headless-devsource.sh'
set -uo pipefail

APP="/Applications/Papercusp Server.app"
SIDECAR="$APP/Contents/Resources/sidecar"        # only for the bundled node runtime
SHARED="/Users/aviweiss/.papercusp-workspaces/.shared"
DEVSRC="$SHARED/dev-source"
REAL_HOME="/Users/aviweiss"
NODE="$SIDECAR/bin/node"
TSX="$DEVSRC/node_modules/tsx/dist/cli.mjs"
SERVE_TS="$DEVSRC/apps/operator/bin/serve.ts"
LOG="/tmp/serve-devsource.log"
PIDFILE="/tmp/serve-devsource.pid"
HONO_PORT="${PAPERCUSP_HONO_PORT:-3070}"

for f in "$NODE" "$TSX" "$SERVE_TS"; do
  [ -e "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

# --- replace any bundle-variant operator (it is the stale code being swapped out)
for pf in /tmp/serve-headless.pid "$PIDFILE"; do
  if [ -f "$pf" ]; then
    op=$(cat "$pf" 2>/dev/null)
    if [ -n "${op:-}" ] && kill -0 "$op" 2>/dev/null; then
      echo "stopping existing operator pid=$op ($pf)…"
      kill "$op" 2>/dev/null
      for i in $(seq 1 10); do kill -0 "$op" 2>/dev/null || break; sleep 1; done
      kill -0 "$op" 2>/dev/null && kill -9 "$op" 2>/dev/null
    fi
  fi
done
# wait for the port to free
for i in $(seq 1 10); do
  curl -fsS -m 2 "http://127.0.0.1:${HONO_PORT}/api/health" >/dev/null 2>&1 || break
  sleep 1
done

# --- env: same identity / PG / DHT state as the bundle boot; in-repo resource
# resolution (no bundle-dir overrides — serve.ts dev paths find them in-tree).
export HOME="$REAL_HOME"
export PATH="$SIDECAR/bin:$PATH"
export PAPERCUSP_HONO_PORT="$HONO_PORT"
export PAPERCUSP_BIND_HOST="127.0.0.1"
export HOSTNAME="127.0.0.1"
export PAPERCUSP_OPERATOR_BASE="http://localhost:${HONO_PORT}"
export PAPERCUSP_DESKTOP="1"
export PAPERCUSP_SHARED_OPERATOR="1"
export PAPERCUSP_DBOS_ENABLE="1"
export PAPERCUSP_DBOS_ROUTINES="1"
export PAPERCUSP_DBOS_ORCHESTRATOR="1"
export PAPERCUSP_IPC_ENABLE="1"
export PAPERCUSP_PG_PORT="${PAPERCUSP_PG_PORT:-18213}"
export PAPERCUSP_PG_DATA_DIR="$SHARED/embedded-pg-data"
export PAPERCUSP_IDENTITY_DIR="$SHARED/.papercusp/identity"
export PAPERCUSP_ANNOUNCE_IDENTITY_CACHE="$SHARED/.papercusp/local-announce-identity.json"
export PAPERCUSP_WORKSPACES_ROOT="/Users/aviweiss/.papercusp-workspaces"
export PAPERCUSP_DHT_BOOTSTRAP="${PAPERCUSP_DHT_BOOTSTRAP:-172.31.44.1:49838}"

echo "boot-devsource: HOME=$HOME  DEVSRC=$DEVSRC"
echo "boot-devsource: PG_DATA_DIR=$PAPERCUSP_PG_DATA_DIR  DHT=$PAPERCUSP_DHT_BOOTSTRAP  PORT=$PAPERCUSP_HONO_PORT"

# --- fully detach (perl setsid; see boot-headless.sh for why nohup alone dies)
: > "$LOG"
cd "$DEVSRC" || exit 1
perl -e '$SIG{HUP}="IGNORE"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,"<","/dev/null"); exec @ARGV or die "exec: $!"' -- \
  "$NODE" "$TSX" "$SERVE_TS" --ensure >>"$LOG" 2>&1 </dev/null &
sleep 2
pid="$(pgrep -f 'serve.ts --ensure' | head -1)"
echo "${pid:-}" > "$PIDFILE"
echo "LAUNCHED (detached, dev-source) serve.ts --ensure pid=${pid:-?} log=$LOG"
sleep 3
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "STILL-ALIVE after ~5s. Poll $LOG + :${HONO_PORT}/api/health."
else
  echo "DIED early — see $LOG:" >&2; tail -40 "$LOG" >&2; exit 1
fi

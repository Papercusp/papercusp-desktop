#!/usr/bin/env bash
# boot-headless.sh — start the rig VM's operator sidecar (serve.mjs --ensure)
# HEADLESSLY, without a GUI/Aqua login, when the packaged "Papercusp Server.app"
# LaunchAgent can't fire (the WI-4070 / EI-13010 silent-loginwindow-death class:
# kcpassword drift blocks auto-login and Secure Token blocks any headless reset,
# so a human GUI login is otherwise the only recovery).
#
# WHY THIS IS SAFE (no federation-state pollution): the shared sidecar runs under
# the REAL user HOME (workspaces.rs workspaces_root() doc: "runs under the real
# user HOME ... NOT a per-workspace dir"). This script is meant to run ON the VM
# as `aviweiss`, whose $HOME is already /Users/aviweiss — the SAME process HOME
# the GUI app's spawn_serve sets — and it points PAPERCUSP_IDENTITY_DIR at the
# SAME shared identity dir, so serve loads the SAME device identity + workspace
# scope + embedded-PG data + dev-source the GUI app would. It is NOT a second
# peer. The env below mirrors papercusp-desktop/src-tauri/src/main.rs spawn_serve
# (the native/macOS, non-WSL, release path) 1:1.
#
# Usage (on the tower):   bin/vm-rig/deploy.sh has already been designed to push
#   the rig driver; to boot the operator headlessly:
#     scp bin/vm-rig/boot-headless.sh aviweiss@172.31.44.2:/tmp/boot-headless.sh
#     ssh aviweiss@172.31.44.2 'bash /tmp/boot-headless.sh'
#   then poll /tmp/serve-headless.log and the operator port.
#
# It REFUSES to double-boot: if an operator is already reachable it exits 0
# without spawning (serve --ensure would reuse-and-exit anyway, but we short
# out first so a concurrent GUI login always wins).
set -uo pipefail

APP="/Applications/Papercusp Server.app"
SIDECAR="$APP/Contents/Resources/sidecar"
RES="$APP/Contents/Resources"
SHARED="/Users/aviweiss/.papercusp-workspaces/.shared"
REAL_HOME="/Users/aviweiss"
NODE="$SIDECAR/bin/node"
PRELOAD="$SIDECAR/sidecar-preload.js"
SERVE="$SIDECAR/serve.mjs"
LOG="/tmp/serve-headless.log"
PIDFILE="/tmp/serve-headless.pid"
HONO_PORT="${PAPERCUSP_HONO_PORT:-3070}"

# --- sanity: required artifacts present -------------------------------------
for f in "$NODE" "$SERVE" "$PRELOAD"; do
  [ -e "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

# --- refuse double-boot -----------------------------------------------------
if curl -fsS -m 4 "http://127.0.0.1:${HONO_PORT}/api/health" >/dev/null 2>&1; then
  echo "ALREADY-UP: an operator answers :${HONO_PORT}/api/health — NOT spawning (concurrent GUI/other boot wins)."
  exit 0
fi
if pgrep -f "serve.mjs --ensure" >/dev/null 2>&1; then
  echo "ALREADY-RUNNING: a 'serve.mjs --ensure' process exists — NOT spawning a second one."
  pgrep -fl "serve.mjs --ensure" || true
  exit 0
fi

# --- env: mirror spawn_serve (native/macOS release path) --------------------
export HOME="$REAL_HOME"
export USERPROFILE="$REAL_HOME"
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
export PAPERCUSP_PROVISION_ENV_OPERATORS="1"
export PAPERCUSP_SHARED_OPERATOR="1"
export PAPERCUSP_OPERATOR_BASE="http://localhost:${HONO_PORT}"
export PAPERCUSP_SPA_DIST="$SIDECAR/spa"
export PAPERCUSP_DOCS_ROOT="$SIDECAR/internal-docs"
export PAPERCUSP_PROMPTS_DIR="$SIDECAR/prompts"
export PAPERCUSP_PG_PORT="${PAPERCUSP_PG_PORT:-18213}"
export PAPERCUSP_PG_DATA_DIR="$SHARED/embedded-pg-data"
export PAPERCUSP_PG_SQL_DIR="$SIDECAR/db-sql"
export PAPERCUSP_SEED_DIR="$RES/seed"
export PAPERCUSP_PG_SEED_PATH="$SIDECAR/db-seed.tar.gz"
export PAPERCUSP_SOURCE_ARCHIVE="$SIDECAR/source.tar.zst"
export PAPERCUSP_DEV_SOURCE_DIR="$SHARED/dev-source"
export PAPERCUSP_IDENTITY_DIR="$SHARED/.papercusp/identity"
export PAPERCUSP_ANNOUNCE_IDENTITY_CACHE="$SHARED/.papercusp/local-announce-identity.json"
export PAPERCUSP_WORKSPACES_ROOT="/Users/aviweiss/.papercusp-workspaces"
export PAPERCUSP_IPC_ENABLE="1"
# The federation bootstrap peer — the ONE var the LaunchAgent injects (not
# spawn_serve). Without it the VM boots isolated and every probe fails looking
# like a federation regression (README gotcha).
export PAPERCUSP_DHT_BOOTSTRAP="${PAPERCUSP_DHT_BOOTSTRAP:-172.31.44.1:49838}"

echo "boot-headless: HOME=$HOME"
echo "boot-headless: sidecar=$SIDECAR"
echo "boot-headless: PG_DATA_DIR=$PAPERCUSP_PG_DATA_DIR  DEV_SOURCE_DIR=$PAPERCUSP_DEV_SOURCE_DIR"
echo "boot-headless: DHT_BOOTSTRAP=$PAPERCUSP_DHT_BOOTSTRAP  HONO_PORT=$PAPERCUSP_HONO_PORT"

# --- spawn FULLY DETACHED (survive the ssh session closing) ------------------
# A plain `nohup ... &` is NOT enough here: when the ssh session that ran this
# script closes, macOS signals the session's whole process group, and serve
# catches the SIGTERM and cleanly shuts PG down (observed: a graceful
# "database system is shut down" seconds after launch, WI-4070 verify run).
# perl POSIX::setsid (fork, parent exits, child setsid) puts serve in its OWN
# session with no controlling terminal, immune to the ssh teardown. macOS ships
# perl but NOT setsid(1), so perl is the portable detacher.
: > "$LOG"
perl -e '$SIG{HUP}="IGNORE"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,"<","/dev/null"); exec @ARGV or die "exec: $!"' -- \
  "$NODE" --require "$PRELOAD" "$SERVE" --ensure >>"$LOG" 2>&1 </dev/null &
# the perl parent forks+exits; discover the real detached node pid
sleep 2
pid="$(pgrep -f 'serve.mjs --ensure' | head -1)"
echo "${pid:-}" > "$PIDFILE"
echo "LAUNCHED (detached) serve.mjs --ensure pid=${pid:-?} log=$LOG pidfile=$PIDFILE"
# brief settle so the caller sees an early crash immediately
sleep 3
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "STILL-ALIVE after ~5s (booting; PG start + migration check may take a while). Poll $LOG + :${HONO_PORT}/api/health."
else
  echo "DIED early — see $LOG below:" >&2
  tail -40 "$LOG" >&2
  exit 1
fi

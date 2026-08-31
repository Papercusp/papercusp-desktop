#!/usr/bin/env bash
# boot-headless-wsl.sh — run the WINDOWS VM's rig operator inside its WSL distro
# (papercup-runtime) from a TOWER-BUILT current sidecar bundle
# (/home/papercup/rig-sidecar-current — the src-tauri/sidecar dir, tar'd over).
#
# WHY (WI-5211, 2026-07-17): the owner-directed 3-machine fleet drill needs a
# current-tree operator on the Windows VM. The packaged "Papercusp Server" app
# keeps its sidecar on the Windows side and wasn't running; WSL is linux-x64 —
# the SAME platform as the tower — so unlike the mac rig (boot-headless-current.sh,
# which must compose tower JS onto darwin natives) the tower's whole sidecar dir
# works verbatim: bundled node v24 runtime, linux natives, embedded-postgres.
#
# Layout expected at $CUR (== src-tauri/sidecar, minus source.tar.zst/env-sidecars):
#   serve.mjs  bin/node  db-sql/  prompts/  harness/  templates/  rubrics/
#   spa/  internal-docs/  node_modules/  db-seed.dump  [seed/ — hive seed,
#   transferred separately: corestore + epoch-keys.json]
#
# Run (from the tower):
#   ssh -i ~/.ssh/papercup-vm-win -p 2223 user@127.0.0.1 \
#     "wsl -d papercup-runtime -u papercup -e bash /home/papercup/boot-headless-wsl.sh"
#
# WSL gotchas (vs the mac runbook, mem0 6c1274aa — its 4 verification traps all
# still apply: lazy relation-error grep >=6min, bundle-vintage signing asymmetry,
# data-layer origin='remote' federation probe, orphaned-children sweep):
#   - WSL keeps the distro alive only while a user process runs — the detached
#     serve.mjs IS that process; if it dies the distro may idle-stop.
#   - The perl-setsid detach is still required: wsl.exe closing its session
#     otherwise takes the child with it (same class as the macOS ssh-close kill).
#   - DHT: the isolated bootstrap 172.31.44.1:49838 (tower macbr0) is reachable
#     from WSL through the Windows NAT — override PAPERCUSP_DHT_BOOTSTRAP to
#     point elsewhere.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Seed is a sibling resource of sidecar in packaged layouts. Resolve it through
# the shared manifest-checked helper so a wrong Windows app path cannot poison
# the WSL boot with a foreign/empty seed.
# shellcheck source=/dev/null
source "$HERE/seed-resource-root.sh"

CUR="${PAPERCUSP_RIG_DIR:-/home/papercup/rig-sidecar-current}"
REAL_HOME="/home/papercup"
SHARED="$REAL_HOME/.papercusp-workspaces/.shared"
NODE="$CUR/bin/node"
SERVE="$CUR/serve.mjs"
LOG="/tmp/serve-current.log"
PIDFILE="/tmp/serve-current.pid"
HONO_PORT="${PAPERCUSP_HONO_PORT:-3070}"

for f in "$NODE" "$SERVE" "$CUR/db-sql" "$CUR/node_modules"; do
  [ -e "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

# --- stop any prior rig operator
if [ -f "$PIDFILE" ]; then
  op=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "${op:-}" ] && kill -0 "$op" 2>/dev/null; then
    echo "stopping operator pid=$op…"; kill "$op" 2>/dev/null
    for i in $(seq 1 10); do kill -0 "$op" 2>/dev/null || break; sleep 1; done
    kill -0 "$op" 2>/dev/null && kill -9 "$op" 2>/dev/null
  fi
fi
for i in $(seq 1 10); do
  curl -fsS -m 2 "http://127.0.0.1:${HONO_PORT}/api/health" >/dev/null 2>&1 || break
  sleep 1
done

# --- env: mirrors boot-headless-current.sh, all paths inside $CUR
export HOME="$REAL_HOME"; export USERPROFILE="$REAL_HOME"
export PATH="$CUR/bin:$PATH"
export PAPERCUSP_SIDECAR_BIN="$CUR/bin"
export PAPERCUSP_HONO_PORT="$HONO_PORT"
export PAPERCUSP_BIND_HOST="127.0.0.1"
export HOSTNAME="127.0.0.1"
export NODE_ENV="production"
export PAPERCUSP_SERVE_UI="1"
export PAPERCUSP_HARNESS_DIR="$CUR/harness"
export PAPERCUSP_TEMPLATES_DIR="$CUR/templates"
export PAPERCUSP_RUBRICS_DIR="$CUR/rubrics"
export PAPERCUSP_DESKTOP="1"
export PAPERCUSP_DBOS_ENABLE="1"
export PAPERCUSP_DBOS_ROUTINES="1"
export PAPERCUSP_DBOS_ORCHESTRATOR="1"
export PAPERCUSP_SHARED_OPERATOR="1"
export PAPERCUSP_OPERATOR_BASE="http://localhost:${HONO_PORT}"
export PAPERCUSP_SPA_DIST="$CUR/spa"
export PAPERCUSP_DOCS_ROOT="$CUR/internal-docs"
export PAPERCUSP_PROMPTS_DIR="$CUR/prompts"
export PAPERCUSP_PG_PORT="${PAPERCUSP_PG_PORT:-18213}"
export PAPERCUSP_PG_DATA_DIR="$SHARED/embedded-pg-data"
export PAPERCUSP_PG_SQL_DIR="$CUR/db-sql"
if PAPERCUSP_SEED_DIR="$(resolve_seed_resource_dir "$CUR" "$CUR" "${PAPERCUSP_SERVER_APP:-}" 2>/dev/null)"; then
  export PAPERCUSP_SEED_DIR
else
  unset PAPERCUSP_SEED_DIR
fi
export PAPERCUSP_PG_SEED_PATH="$CUR/db-seed.dump"
[ -s "$PAPERCUSP_PG_SEED_PATH" ] || export PAPERCUSP_PG_SEED_PATH="$CUR/db-seed.tar.gz"
export PAPERCUSP_PG_RESTORE_BIN="$CUR/bin/pg_restore"
export PAPERCUSP_IDENTITY_DIR="$SHARED/.papercusp/identity"
export PAPERCUSP_ANNOUNCE_IDENTITY_CACHE="$SHARED/.papercusp/local-announce-identity.json"
export PAPERCUSP_WORKSPACES_ROOT="$REAL_HOME/.papercusp-workspaces"
export PAPERCUSP_IPC_ENABLE="1"
export PAPERCUSP_DHT_BOOTSTRAP="${PAPERCUSP_DHT_BOOTSTRAP:-172.31.44.1:49838}"
# EI-13317 forensics: keep the per-attempt dial trace armed by default (see
# boot-headless-current.sh) — a reboot must never silently drop the evidence.
export HGDIALDEBUG="${HGDIALDEBUG:-1}"

echo "boot-wsl: serve=$SERVE node=$($NODE --version 2>/dev/null)"
echo "boot-wsl: PG_DATA_DIR=$PAPERCUSP_PG_DATA_DIR  PG_SQL_DIR=$PAPERCUSP_PG_SQL_DIR"
echo "boot-wsl: DHT=$PAPERCUSP_DHT_BOOTSTRAP  PORT=$HONO_PORT  SEED=${PAPERCUSP_SEED_DIR:-none}"

# --- fully detach (perl setsid; a plain child dies when wsl.exe's session closes)
: > "$LOG"
cd "$CUR" || exit 1
perl -e '$SIG{HUP}="IGNORE"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,"<","/dev/null"); exec @ARGV or die "exec: $!"' -- \
  "$NODE" "$SERVE" --ensure >>"$LOG" 2>&1 </dev/null &
sleep 2
pid="$(pgrep -f 'serve.mjs --ensure' | head -1)"
echo "${pid:-}" > "$PIDFILE"
echo "LAUNCHED (detached, wsl) serve.mjs --ensure pid=${pid:-?} log=$LOG"
sleep 3
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  echo "STILL-ALIVE after ~5s. Poll $LOG + :${HONO_PORT}/api/health."
else
  echo "DIED early — see $LOG:" >&2; tail -40 "$LOG" >&2; exit 1
fi

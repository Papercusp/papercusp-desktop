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

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# All rig launchers use the same manifest-checked bundle/resource-root resolver;
# never trust a stale hard-coded /Applications path as a seed authority.
# shellcheck source=/dev/null
if [[ ! -r "$HERE/seed-resource-root.sh" ]]; then
  echo "FATAL: missing required seed resolver: $HERE/seed-resource-root.sh" >&2
  exit 1
fi
source "$HERE/seed-resource-root.sh"

APP="/Applications/Papercusp Server.app"
SIDECAR="$APP/Contents/Resources/sidecar"
REAL_HOME="${PAPERCUSP_RIG_HOME:-/Users/aviweiss}"
CUR="${PAPERCUSP_RIG_SIDECAR_DIR:-${REAL_HOME}/rig-sidecar-current}"
SHARED="${PAPERCUSP_RIG_SHARED_ROOT:-${REAL_HOME}/.papercusp-workspaces/.shared}"
NODE="$SIDECAR/bin/node"
SERVE="$CUR/serve.mjs"
LOG="/tmp/serve-current.log"
PIDFILE="/tmp/serve-current.pid"
HONO_PORT="${PAPERCUSP_HONO_PORT:-3070}"

# A deploy uploads a complete payload to a sibling staging directory and
# invokes this script with --stage. With no --stage this remains a restart-only
# command for an already composed payload.
STAGE=""
CLEANUP_CONTROL=""
SELF_TEST=0
LAUNCHD_RUN=0
STOP_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --stage)
      [ "$#" -ge 2 ] || { echo "FATAL: --stage requires a directory" >&2; exit 2; }
      STAGE="$2"
      shift 2
      ;;
    --cleanup-control)
      [ "$#" -ge 2 ] || { echo "FATAL: --cleanup-control requires a file" >&2; exit 2; }
      CLEANUP_CONTROL="$2"
      shift 2
      ;;
    --self-test)
      SELF_TEST=1
      shift
      ;;
    --launchd-run)
      LAUNCHD_RUN=1
      shift
      ;;
    --stop-only)
      STOP_ONLY=1
      shift
      ;;
    *)
      echo "FATAL: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [ "$LAUNCHD_RUN" = "1" ] && { [ "$STOP_ONLY" = "1" ] || [ -n "$STAGE" ]; }; then
  echo "FATAL: --launchd-run cannot be combined with --stop-only or --stage" >&2
  exit 2
fi

cleanup_control() {
  [ -n "$CLEANUP_CONTROL" ] && rm -f "$CLEANUP_CONTROL" 2>/dev/null || true
}
trap cleanup_control EXIT

validate_payload() {
  local root="$1" require_stamp="${2:-0}" f expected_max expected_count actual_max actual_count
  for f in "$root/serve.mjs" "$root/db-sql" "$root/node_modules" "$root/node_modules/@papercusp/embedded-postgres-server/src/migration-runner.js" "$root/sql" "$root/prompts"; do
    [ -e "$f" ] || { echo "FATAL: staged payload is missing $f" >&2; return 1; }
  done
  if [ "$require_stamp" = "1" ]; then
    for f in "$root/BUILD-STAMP.txt" "$root/PAYLOAD-MANIFEST.sha256"; do
      [ -s "$f" ] || { echo "FATAL: staged payload is missing $f" >&2; return 1; }
    done
  fi
  if [ -e "$root/sql/000-baseline.sql" ] || [ ! -e "$root/sql/001-bootstrap.sql" ]; then
    echo "FATAL: staged payload sql/ is not the locks migration set" >&2
    return 1
  fi
  [ -e "$root/db-sql/000-baseline.sql" ] \
    || { echo "FATAL: staged payload db-sql/ is not the main migration set" >&2; return 1; }
  actual_max="$(find "$root/db-sql" -maxdepth 1 -type f -name '*.sql' -exec basename {} \; \
    | grep -oE '^[0-9]+' | sort -n | tail -1)"
  actual_count="$(find "$root/db-sql" -maxdepth 1 -type f -name '*.sql' | wc -l | tr -d ' ')"
  if [ "$require_stamp" = "1" ]; then
    expected_max="$(sed -n 's/^dbSqlHighest=//p' "$root/BUILD-STAMP.txt" | tail -1)"
    expected_count="$(sed -n 's/^dbSqlCount=//p' "$root/BUILD-STAMP.txt" | tail -1)"
    [ -n "$expected_max" ] && [ -n "$expected_count" ] \
      || { echo "FATAL: BUILD-STAMP.txt lacks dbSqlHighest/dbSqlCount" >&2; return 1; }
    [ "$actual_max" = "$expected_max" ] && [ "$actual_count" = "$expected_count" ] \
      || { echo "FATAL: staged db-sql shape differs from BUILD-STAMP.txt" >&2; return 1; }
    if command -v shasum >/dev/null 2>&1; then
      (cd "$root" && shasum -a 256 -c PAYLOAD-MANIFEST.sha256 >/dev/null) \
        || { echo "FATAL: staged payload hash verification failed" >&2; return 1; }
    elif command -v sha256sum >/dev/null 2>&1; then
      (cd "$root" && sha256sum -c PAYLOAD-MANIFEST.sha256 >/dev/null) \
        || { echo "FATAL: staged payload hash verification failed" >&2; return 1; }
    else
      echo "FATAL: no SHA-256 verifier is available for the staged payload" >&2
      return 1
    fi
  fi
}

# cp -a preserves the rig's absolute namespace symlinks into the installed app.
# Replace each linked container in the PRIVATE candidate with a shallow directory
# of links before writing below it. Native dependencies keep resolving in place;
# package source replacement can no longer mutate the installed app or backup.
detach_linked_directory() {
  local directory="$1" source entry
  if [ -L "$directory" ]; then
    source="$(cd "$directory" && pwd -P)" || return 1
    rm -f "$directory" || return 1
    mkdir "$directory" || return 1
    for entry in "$source"/* "$source"/.[!.]* "$source"/..?*; do
      [ -e "$entry" ] || [ -L "$entry" ] || continue
      ln -s "$entry" "$directory/$(basename "$entry")" || return 1
    done
  else
    mkdir -p "$directory" || return 1
  fi
}

overlay_payload() {
  local candidate="$1" stage="$2" subtree
  cp -a "$stage/serve.mjs" "$candidate/serve.mjs.new"
  mv -f "$candidate/serve.mjs.new" "$candidate/serve.mjs"
  for subtree in db-sql sql prompts; do
    rm -rf "$candidate/$subtree"
    cp -a "$stage/$subtree" "$candidate/$subtree"
  done
  # Refresh the externalized package's JS sources without deleting the
  # candidate's nested darwin native dependency tree.
  for subtree in node_modules node_modules/@papercusp node_modules/@papercusp/embedded-postgres-server; do
    detach_linked_directory "$candidate/$subtree" || return 1
  done
  rm -f "$candidate/node_modules/@papercusp/embedded-postgres-server/package.json"
  cp "$stage/node_modules/@papercusp/embedded-postgres-server/package.json" \
    "$candidate/node_modules/@papercusp/embedded-postgres-server/package.json"
  rm -rf "$candidate/node_modules/@papercusp/embedded-postgres-server/src"
  cp -a "$stage/node_modules/@papercusp/embedded-postgres-server/src" \
    "$candidate/node_modules/@papercusp/embedded-postgres-server/src"
  if [ -d "$stage/node_modules/@papercusp/embedded-postgres-server/bin" ]; then
    rm -rf "$candidate/node_modules/@papercusp/embedded-postgres-server/bin"
    cp -a "$stage/node_modules/@papercusp/embedded-postgres-server/bin" \
      "$candidate/node_modules/@papercusp/embedded-postgres-server/bin"
  fi
  cp -a "$stage/BUILD-STAMP.txt" "$candidate/BUILD-STAMP.txt"
  cp -a "$stage/PAYLOAD-MANIFEST.sha256" "$candidate/PAYLOAD-MANIFEST.sha256"
}

write_self_test_manifest() {
  local root="$1"
  (
    cd "$root" || exit 1
    if command -v shasum >/dev/null 2>&1; then
      find serve.mjs BUILD-STAMP.txt db-sql sql prompts \
        node_modules/@papercusp/embedded-postgres-server/package.json \
        node_modules/@papercusp/embedded-postgres-server/src \
        -type f -print0 \
        | LC_ALL=C sort -z \
        | xargs -0 shasum -a 256 > PAYLOAD-MANIFEST.sha256
    else
      find serve.mjs BUILD-STAMP.txt db-sql sql prompts \
        node_modules/@papercusp/embedded-postgres-server/package.json \
        node_modules/@papercusp/embedded-postgres-server/src \
        -type f -print0 \
        | LC_ALL=C sort -z \
        | xargs -0 sha256sum > PAYLOAD-MANIFEST.sha256
    fi
  )
}

prepare_candidate() {
  local current="$1" stage="$2" candidate="$3"
  rm -rf "$candidate"
  cp -a "$current" "$candidate"
  overlay_payload "$candidate" "$stage" || return 1
  validate_payload "$candidate" 1
}

swap_payload() {
  local current="$1" candidate="$2" backup="$3"
  mv "$current" "$backup" || return 1
  if ! mv "$candidate" "$current"; then
    mv "$backup" "$current" || true
    return 1
  fi
}

rollback_payload() {
  local current="$1" backup="$2" failed="$3"
  if [ -d "$current" ]; then
    mv "$current" "$failed" || return 1
  fi
  mv "$backup" "$current"
}

run_filesystem_self_test() {
  local root current stage candidate backup failed external
  root="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-sidecar-selftest.XXXXXX")" || return 1
  current="$root/current"
  stage="$root/stage"
  candidate="$root/candidate"
  backup="$root/backup"
  failed="$root/failed"
  external="$root/external-papercusp"
  mkdir -p "$current/db-sql" "$current/sql" "$current/prompts" \
    "$current/node_modules/@papercusp/embedded-postgres-server/src"
  mkdir -p "$stage/db-sql" "$stage/sql" "$stage/prompts" \
    "$stage/node_modules/@papercusp/embedded-postgres-server/src"
  mkdir -p "$external/embedded-postgres-server/src"
  printf '%s\n' '{"name":"embedded-postgres-server"}' \
    > "$external/embedded-postgres-server/package.json"
  printf '%s\n' old > "$external/embedded-postgres-server/src/migration-runner.js"
  rm -rf "$current/node_modules/@papercusp"
  ln -s "$external" "$current/node_modules/@papercusp"
  printf '%s\n' old > "$current/serve.mjs"
  printf '%s\n' new > "$stage/serve.mjs"
  printf '%s\n' '{"name":"embedded-postgres-server"}' \
    > "$stage/node_modules/@papercusp/embedded-postgres-server/package.json"
  printf '%s\n' 'export function migrationTransactionChunks(ddl) { return [ddl]; }' \
    > "$stage/node_modules/@papercusp/embedded-postgres-server/src/migration-runner.js"
  printf 'stamp\ndbSqlHighest=000\ndbSqlCount=1\n' > "$stage/BUILD-STAMP.txt"
  : > "$current/sql/001-bootstrap.sql"
  : > "$stage/sql/001-bootstrap.sql"
  : > "$stage/db-sql/000-baseline.sql"
  write_self_test_manifest "$stage" || { rm -rf "$root"; return 1; }
  validate_payload "$stage" 1 || { rm -rf "$root"; return 1; }

  printf '%s\n' tampered >> "$stage/serve.mjs"
  if validate_payload "$stage" 1 >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: staged hash mismatch was admitted" >&2
    rm -rf "$root"
    return 1
  fi
  printf '%s\n' new > "$stage/serve.mjs"
  write_self_test_manifest "$stage" || { rm -rf "$root"; return 1; }

  rm -f "$stage/db-sql/000-baseline.sql"
  write_self_test_manifest "$stage" || { rm -rf "$root"; return 1; }
  if validate_payload "$stage" 1 >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: empty/wrong db-sql shape was admitted" >&2
    rm -rf "$root"
    return 1
  fi
  : > "$stage/db-sql/000-baseline.sql"
  write_self_test_manifest "$stage" || { rm -rf "$root"; return 1; }

  prepare_candidate "$current" "$stage" "$candidate" || { rm -rf "$root"; return 1; }
  [ "$(cat "$candidate/serve.mjs")" = new ] || { rm -rf "$root"; return 1; }
  [ "$(cat "$candidate/node_modules/@papercusp/embedded-postgres-server/src/migration-runner.js")" != old ] \
    || { echo "SELF-TEST FAIL: candidate package source was not refreshed" >&2; rm -rf "$root"; return 1; }
  [ "$(cat "$external/embedded-postgres-server/src/migration-runner.js")" = old ] \
    || { echo "SELF-TEST FAIL: linked installed package was mutated" >&2; rm -rf "$root"; return 1; }
  swap_payload "$current" "$candidate" "$backup" || { rm -rf "$root"; return 1; }
  [ "$(cat "$current/serve.mjs")" = new ] || { rm -rf "$root"; return 1; }
  rollback_payload "$current" "$backup" "$failed" || { rm -rf "$root"; return 1; }
  [ "$(cat "$current/serve.mjs")" = old ] || { rm -rf "$root"; return 1; }
  [ "$(cat "$failed/serve.mjs")" = new ] || { rm -rf "$root"; return 1; }
  rm -rf "$root"
  echo "SELF-TEST PASS: staged validation rejects missing/tampered payloads and swap/rollback preserves the previous payload"
}

if [ "$SELF_TEST" = "1" ]; then
  run_filesystem_self_test
  exit $?
fi

for f in "$NODE" "$SERVE" "$CUR/db-sql" "$CUR/node_modules" "$CUR/sql" "$CUR/prompts"; do
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

# --- stop the exact current operator and optionally stage a new payload
#
# The old restart path swept every process whose command line contained
# serve.mjs. That was unsafe on the rig because the operator intentionally
# creates a staging sibling, and it offered no atomic rollback boundary. This
# path resolves the one recorded operator PID, validates its command line, and
# refuses to launch if the port is still held by an untracked process.
# --- exact-owner stop and optional staged payload preparation
DEPLOY_ID=""
CANDIDATE=""
BACKUP=""
FAILED=""
SWAPPED=0

if [ -n "$STAGE" ]; then
  case "$STAGE" in
    "$CUR".incoming.*) ;;
    *) echo "FATAL: --stage must be a sibling incoming directory under $CUR" >&2; exit 2 ;;
  esac
  validate_payload "$STAGE" 1 || exit 1
  DEPLOY_ID="$(date -u +%Y%m%dT%H%M%SZ).$$"
  CANDIDATE="${CUR}.candidate.${DEPLOY_ID}"
  BACKUP="${CUR}.backup.${DEPLOY_ID}"
  FAILED="${CUR}.failed.${DEPLOY_ID}"
  echo "preparing staged payload: $STAGE"
  prepare_candidate "$CUR" "$STAGE" "$CANDIDATE" || exit 1
fi

stop_pid() { # pid, label — TERM, wait, then KILL (observed twice: TERM ignored)
  local op="$1" label="$2" i
  kill -0 "$op" 2>/dev/null || return 0
  echo "stopping operator pid=$op ($label)…"
  kill "$op" 2>/dev/null
  for i in $(seq 1 10); do kill -0 "$op" 2>/dev/null || break; sleep 1; done
  if kill -0 "$op" 2>/dev/null; then
    echo "  pid=$op ignored SIGTERM — SIGKILL"; kill -9 "$op" 2>/dev/null; sleep 1
  fi
}

# Exact-owner resolution — catches a stale discovery PID without a broad sweep.
# Identity is resolved from operator.json or the exact current PID file below;
# never sweep the process table for a matching command line.

process_cmdline() {
  ps -o command= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//'
}

process_executable() {
  lsof -nP -a -p "$1" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

is_current_operator_pid() {
  local op="$1" cmd exe
  case "$op" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$op" 2>/dev/null || return 1
  cmd="$(process_cmdline "$op")"
  case "$cmd" in
    "$NODE"*"$SERVE"*--ensure*) return 0 ;;
    "$NODE"*"$SIDECAR/serve.mjs"*) return 0 ;;
  esac
  # macOS ps may collapse argv[0] to the executable basename (`node`) even
  # though lsof retains the exact mapped binary. Accept that display only when
  # BOTH the executable and serve path bind to this installed/current payload.
  exe="$(process_executable "$op")"
  [ "$exe" = "$NODE" ] || return 1
  case "$cmd" in
    *"$SERVE"*--ensure*) return 0 ;;
    *"$SIDECAR/serve.mjs"*) return 0 ;;
  esac
  return 1
}

pid_from_file() {
  local file="$1" op
  [ -f "$file" ] || return 1
  op="$(sed -nE 's/^[[:space:]]*([0-9]+).*/\1/p' "$file" | head -1)"
  is_current_operator_pid "$op" || return 1
  printf '%s\n' "$op"
}

# EI-22367240585613586: launchd's failed-start loop can overwrite the discovery
# record and PID file while a prior Tauri-owned Server operator still owns the
# port. Recover only from a UNIQUE listener whose mapped node executable and
# serve argv both validate above; this is still exact-owner resolution, never a
# broad process-table sweep.
pid_from_unique_port_owner() {
  local listener count parent parent_exe
  listener="$(lsof -nP -iTCP:"$HONO_PORT" -sTCP:LISTEN -t 2>/dev/null | sort -u)"
  [ -n "$listener" ] || return 1
  count="$(printf '%s\n' "$listener" | wc -l | tr -d ' ')"
  [ "$count" = 1 ] || return 1
  is_current_operator_pid "$listener" || return 1
  parent="$(ps -o ppid= -p "$listener" 2>/dev/null | tr -d ' ')"
  parent_exe="$(process_executable "$parent")"
  case "$parent_exe" in
    "$APP/Contents/MacOS/"*) printf '%s\n' "$parent" ;;
    *) printf '%s\n' "$listener" ;;
  esac
}

resolve_current_operator_pid() {
  local op parent parent_cmd discovery="$REAL_HOME/.papercusp/operator.json"
  if [ -f "$discovery" ]; then
    op="$(sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$discovery" | head -1)"
    if is_current_operator_pid "$op"; then
      parent="$(ps -o ppid= -p "$op" 2>/dev/null | tr -d ' ')"
      parent_cmd="$(process_cmdline "$parent")"
      case "$parent_cmd" in
        *"Papercusp Server.app/Contents/MacOS"*) printf '%s\n' "$parent" ;;
        *) printf '%s\n' "$op" ;;
      esac
      return 0
    fi
  fi
  pid_from_file "$PIDFILE" || pid_from_unique_port_owner
}

stop_owned_operator() {
  local owner live i
  owner="$(resolve_current_operator_pid || true)"
  if [ -n "$owner" ]; then
    stop_pid "$owner" "exact operator owner from discovery/PID file"
  else
    echo "no tracked current operator PID; refusing broad process-table matching"
  fi
  for i in $(seq 1 30); do
    live="$(resolve_current_operator_pid || true)"
    [ -n "$live" ] || return 0
    if [ "$live" != "$owner" ]; then
      stop_pid "$live" "exact operator child after parent teardown"
    fi
    sleep 1
  done
  return 1
}

wait_for_port_free() {
  local tries="${1:-30}" i
  for i in $(seq 1 "$tries"); do
    lsof -nP -iTCP:"$HONO_PORT" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    sleep 1
  done
  return 1
}

stop_owned_operator || { echo "FATAL: exact current operator did not stop" >&2; exit 1; }

# Hard gate: a still-held port means something we could not identify owns the
# operator. Launching anyway is what produced the split-brain — fail loudly.
if ! wait_for_port_free 30; then
  echo "FATAL: port ${HONO_PORT} is still held after exact-owner stop — refusing to start a second operator." >&2
  lsof -nP -iTCP:"${HONO_PORT}" -sTCP:LISTEN >&2
  exit 1
fi

if [ "$STOP_ONLY" = "1" ]; then
  rm -f "$PIDFILE"
  echo "STOPPED: exact current-payload operator is offline and :${HONO_PORT} is free"
  exit 0
fi

if [ -n "$STAGE" ]; then
  if ! swap_payload "$CUR" "$CANDIDATE" "$BACKUP"; then
    echo "FATAL: atomic payload swap failed; previous payload was restored" >&2
    exit 1
  fi
  SWAPPED=1
  echo "active payload swapped atomically: $CUR (backup $BACKUP)"
fi

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
# SSH/headless launches intentionally outlive the shell that invoked them.
# The packaged Tauri launcher sets this to 1; this supported headless boundary
# opts out explicitly so the detached process does not self-terminate when SSH
# closes.
export PAPERCUSP_PARENT_DEATH_WATCH="0"
export PAPERCUSP_HOME="$REAL_HOME/.papercusp"
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
if PAPERCUSP_SEED_DIR="$(resolve_seed_resource_dir "$SIDECAR" "$APP/Contents/Resources" "$APP" "$CUR" 2>/dev/null)"; then
  export PAPERCUSP_SEED_DIR
else
  unset PAPERCUSP_SEED_DIR
fi
export PAPERCUSP_PG_SEED_PATH="$SIDECAR/db-seed.dump"
[ -s "$PAPERCUSP_PG_SEED_PATH" ] || export PAPERCUSP_PG_SEED_PATH="$SIDECAR/db-seed.tar.gz"
export PAPERCUSP_PG_RESTORE_BIN="$SIDECAR/bin/pg_restore"
export PAPERCUSP_IDENTITY_DIR="$SHARED/.papercusp/identity"
export PAPERCUSP_ANNOUNCE_IDENTITY_CACHE="$SHARED/.papercusp/local-announce-identity.json"
export PAPERCUSP_WORKSPACES_ROOT="$REAL_HOME/.papercusp-workspaces"
export PAPERCUSP_IPC_ENABLE="1"
export PAPERCUSP_DHT_BOOTSTRAP="${PAPERCUSP_DHT_BOOTSTRAP:-172.31.44.1:49838}"
# EI-21151075708883534: swarm.ts's readEffectiveDhtBootstrapRaw()/readExpectedDhtBootstrap()
# fall back to these two marker files precisely so an env-less relaunch (e.g. a macOS
# Server.app self-relaunch via LaunchServices, which does not inherit its LaunchAgent's
# EnvironmentVariables — EI-8893) still resolves the ISOLATED rig bootstrap instead of
# silently joining the PUBLIC DHT. The env var above always wins when present, so this write
# is a no-op for THIS boot's own routing — it exists purely to survive the NEXT, env-less one.
# Nothing else in the tree provisions these files, so without this write the marker never
# exists and the fallback path silently drops the host onto the public DHT (measured 2026-08-22,
# WI-4070: weeks of zero peer discovery misdiagnosed as a dead rig / network fault).
mkdir -p "$REAL_HOME/.papercusp"
printf '%s' "$PAPERCUSP_DHT_BOOTSTRAP" > "$REAL_HOME/.papercusp/dht-bootstrap.tmp" \
  && mv "$REAL_HOME/.papercusp/dht-bootstrap.tmp" "$REAL_HOME/.papercusp/dht-bootstrap"
printf '%s' "$PAPERCUSP_DHT_BOOTSTRAP" > "$REAL_HOME/.papercusp/expected-dht-bootstrap.tmp" \
  && mv "$REAL_HOME/.papercusp/expected-dht-bootstrap.tmp" "$REAL_HOME/.papercusp/expected-dht-bootstrap"
# EI-13317 forensics ride the per-attempt dial trace (peer-dial-registry.ts) —
# keep it armed by default on the rig so a reboot never silently drops the
# evidence stream (su-71c69's reverse-leg legs depend on it).
export HGDIALDEBUG="${HGDIALDEBUG:-1}"
# EI-18740968796318403: the swarm CONNECTION close path (swarm.ts churnDbg —
# ageMs / precededByError / UDX wire counters) is env-gated, which is why the
# rig showed 1,192 `peer_connected` in 20min against ZERO logged disconnects:
# the teardowns were invisible, not absent. Connections here live ~1s, taking
# every pot-git hello channel down with them, so the close REASON is the whole
# diagnosis. Same rationale as HGDIALDEBUG above — armed by default so a reboot
# never silently drops the evidence stream. Cheap: ~1 line/sec at rig churn
# rates, and only for the first topic on each socket (`!alreadyLoggedSocket`).
export PAPERCUSP_SWARM_CHURN_DEBUG="${PAPERCUSP_SWARM_CHURN_DEBUG:-1}"

echo "boot-current: serve=$SERVE"
echo "boot-current: PG_DATA_DIR=$PAPERCUSP_PG_DATA_DIR  PG_SQL_DIR=$PAPERCUSP_PG_SQL_DIR"
echo "boot-current: DHT=$PAPERCUSP_DHT_BOOTSTRAP  PORT=$PAPERCUSP_HONO_PORT"

# --- fully detach (perl setsid; nohup alone dies with the ssh session)
#
# LOG ROTATION (EI-18754979589749712, 2026-07-27). This was `: > "$LOG"`, which
# TRUNCATED the log on every boot. That single line is why the cause of death of
# the 2026-07-26 22:35 process is permanently unrecoverable: it died, something
# relaunched it, and the relaunch erased the only evidence of why. A crash log is
# worth the most at exactly the moment the next boot destroys it — and because
# the supervisor relaunches automatically, the destructive boot always follows
# the crash immediately. Keep one generation; at ~15MB/40min that costs nothing.
if [ -s "$LOG" ]; then
  mv -f "$LOG" "$LOG.1" 2>/dev/null || true
  echo "boot-current: previous run's log preserved at $LOG.1"
fi
: > "$LOG"
cd "$CUR" || exit 1

# HEAP-SNAPSHOT-ON-OOM (EI-18754979589749712). The sidecar has died of
# "JavaScript heap out of memory" at the ~4288MB V8 limit leaving only a native
# stack trace, which names the GC frame (MinorGCJob → Heap::CollectGarbage →
# FatalProcessOutOfMemory) but NOT the retainer — so every diagnosis so far has
# been a plausible story rather than evidence. --heapsnapshot-near-heap-limit
# makes V8 write a heap snapshot as it approaches the limit; its dominator tree
# names the retaining object graph directly.
#
# Count is 1, not 2: steady-state RSS here is ~1.2GB against the 4.2GB limit, so
# a near-limit snapshot is multi-GB and the rig's data volume has ~34GB free.
# One snapshot answers the question; two risk filling the disk during a crash.
#
# Deliberately NOT paired with a raised --max-old-space-size: enlarging the heap
# would suppress the very event we need to capture, and 1.2GB steady-state
# against a 4.2GB ceiling means this is a genuine leak, not a tight margin.
# Snapshots land in CWD ($CUR) as Heap.<date>.<pid>.<seq>.heapsnapshot — NOT in
# ~/.papercusp/heap-snapshots/, which is a DIFFERENT, unrelated capture system
# (event-loop-lag-monitor.ts's heap-snapshot-on-high-RSS, gated OFF by default
# behind PAPERCUSP_HEAP_SNAPSHOT/PAPERCUSP_FULL_HEAP_SNAPSHOT and never armed
# here). WI-6264 traced a "no snapshot fired" report to exactly this mismatch:
# the investigator checked ~/.papercusp/heap-snapshots/ (the conventional
# location for the OTHER system) and found only a stale unrelated file, while
# this flag's own output — when it did fire — would have been sitting in $CUR
# the whole time. Sweep any snapshot(s) left by a just-crashed prior boot into
# the canonical dir now, before the new process claims $CUR, so the next
# investigation finds them where it will actually look.
HEAP_SNAPSHOT_DIR="$REAL_HOME/.papercusp/heap-snapshots"
mkdir -p "$HEAP_SNAPSHOT_DIR" 2>/dev/null || true
shopt -s nullglob
for f in "$CUR"/Heap.*.heapsnapshot; do
  mv -f "$f" "$HEAP_SNAPSHOT_DIR/" 2>/dev/null \
    && echo "boot-current: swept prior heap snapshot to $HEAP_SNAPSHOT_DIR/$(basename "$f")"
done
shopt -u nullglob

# Write the detached child PID before exec. Process-table matching is inherently
# ambiguous when the operator deliberately has a staging sibling; this PID file
# is owned by the launcher and is checked against the command line before it is
# ever used for a stop.
LAUNCHED_PID=""
payload_build_sha() {
  local sha
  sha="$(sed -n 's/^sha=\([^[:space:]]*\).*/\1/p' "$CUR/BUILD-STAMP.txt" 2>/dev/null | head -1)"
  case "$sha" in
    ''|unknown|*[!A-Za-z0-9._-]*) echo "FATAL: missing/invalid current payload build SHA" >&2; return 1 ;;
  esac
  printf '%s\n' "$sha"
}

launch_operator() {
  local i pid="" build_sha
  build_sha="$(payload_build_sha)" || return 1
  export PAPERCUSP_BUILD_SHA="$build_sha"
  rm -f "$PIDFILE"
  PAPERCUSP_LAUNCH_PIDFILE="$PIDFILE" perl -e \
    '$SIG{HUP}="IGNORE"; exit 0 if fork; use POSIX; POSIX::setsid(); open(STDIN,"<","/dev/null"); open(my $fh, ">", $ENV{PAPERCUSP_LAUNCH_PIDFILE}) or die "pidfile: $!"; print $fh "$$\n"; close $fh; exec @ARGV or die "exec: $!"' -- \
    "$NODE" --heapsnapshot-near-heap-limit=1 "$SERVE" --ensure >>"$LOG" 2>&1 </dev/null &
  for i in $(seq 1 20); do
    pid="$(sed -nE 's/^[[:space:]]*([0-9]+).*/\1/p' "$PIDFILE" 2>/dev/null | head -1)"
    [ -n "$pid" ] && break
    sleep 1
  done
  if ! is_current_operator_pid "$pid"; then
    echo "DIED before exact PID capture — see $LOG:" >&2
    tail -40 "$LOG" >&2
    return 1
  fi
  LAUNCHED_PID="$pid"
  echo "LAUNCHED (detached, current) serve.mjs --ensure pid=$pid log=$LOG"
}

launch_operator_under_launchd() {
  local build_sha
  build_sha="$(payload_build_sha)" || return 1
  export PAPERCUSP_BUILD_SHA="$build_sha"
  rm -f "$PIDFILE"
  printf '%s\n' "$$" > "$PIDFILE"
  echo "LAUNCHED (launchd-supervised, current) serve.mjs --ensure pid=$$ log=$LOG"
  exec "$NODE" --heapsnapshot-near-heap-limit=1 "$SERVE" --ensure >>"$LOG" 2>&1
}

wait_for_health() {
  local timeout="${PAPERCUSP_RESTART_HEALTH_TIMEOUT_SEC:-180}" i expected_sha command discovery_pid health health_sha
  expected_sha="$(payload_build_sha)" || return 1
  case "$LAUNCHED_PID" in ''|*[!0-9]*) return 1 ;; esac
  case "$timeout" in ''|*[!0-9]*) timeout=180 ;; esac
  [ "$timeout" -gt 0 ] || return 1
  for i in $(seq 1 "$timeout"); do
    # An old app can win the singleton race while the staged process exits.
    # A healthy stranger must never discard the rollback payload.
    kill -0 "$LAUNCHED_PID" 2>/dev/null || return 1
    command="$(process_cmdline "$LAUNCHED_PID")"
    case "$command" in
      *"$SERVE"*--ensure*)
        discovery_pid="$(sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$REAL_HOME/.papercusp/operator.json" 2>/dev/null | head -1)"
        if [ "$discovery_pid" = "$LAUNCHED_PID" ] \
          && [ "$(process_executable "$LAUNCHED_PID")" = "$NODE" ] \
          && lsof -nP -a -p "$LAUNCHED_PID" -iTCP:"$HONO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
          health="$(curl -fsS -m 2 "http://127.0.0.1:${HONO_PORT}/api/health" 2>/dev/null)" || health=""
          health_sha="$(printf '%s' "$health" | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
          [ "$health_sha" = "$expected_sha" ] && return 0
        fi
        ;;
    esac
    sleep 1
  done
  return 1
}

rollback_deployment() {
  local tracked="${1:-}" pid
  pid="$tracked"
  [ -n "$pid" ] || pid="$(pid_from_file "$PIDFILE" || true)"
  if [ -n "$pid" ] && is_current_operator_pid "$pid"; then
    stop_pid "$pid" "failed staged operator"
  fi
  wait_for_port_free 30 || {
    echo "FATAL: failed staged operator still owns port $HONO_PORT" >&2
    return 1
  }
  rollback_payload "$CUR" "$BACKUP" "$FAILED" || {
    echo "FATAL: could not restore backup payload $BACKUP" >&2
    return 1
  }
  SWAPPED=0
  cd "$CUR" || return 1
  echo "staged health check failed; restored previous payload (failed copy: $FAILED)"
  launch_operator || return 1
  if wait_for_health; then
    echo "ROLLBACK HEALTHY: previous payload is serving on :$HONO_PORT"
    return 0
  fi
  echo "FATAL: rollback payload also failed health check; see $LOG" >&2
  tail -60 "$LOG" >&2
  return 1
}

if [ "$LAUNCHD_RUN" = "1" ]; then
  launch_operator_under_launchd
fi

if ! launch_operator; then
  if [ "$SWAPPED" = "1" ]; then
    rollback_deployment || exit 2
    exit 1
  fi
  exit 1
fi

if ! wait_for_health; then
  echo "HEALTH CHECK FAILED for pid=$LAUNCHED_PID — see $LOG" >&2
  tail -60 "$LOG" >&2
  if [ "$SWAPPED" = "1" ]; then
    rollback_deployment || exit 2
    exit 1
  fi
  exit 1
fi

if [ "$SWAPPED" = "1" ]; then
  rm -rf "$BACKUP" "$STAGE"
  echo "DEPLOY HEALTHY: staged payload is active; backup and incoming payload removed"
else
  echo "HEALTHY: current payload is serving on :$HONO_PORT"
fi

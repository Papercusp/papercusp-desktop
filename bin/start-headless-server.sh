#!/bin/sh
# Direct entrypoint in the portable Linux archive. The caller owns its state.
set -eu
umask 077
root=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd)
sidecar=$root/sidecar
: "${PAPERCUSP_HOME:=$root/state}"
: "${PAPERCUSP_PG_DATA_DIR:=$PAPERCUSP_HOME/pgdata}"
: "${PAPERCUSP_WORKSPACES_ROOT:=$PAPERCUSP_HOME/workspaces}"
export PAPERCUSP_HOME PAPERCUSP_PG_DATA_DIR PAPERCUSP_WORKSPACES_ROOT
export PAPERCUSP_SIDECAR_DIR="$sidecar" PAPERCUSP_DESKTOP=1 PAPERCUSP_SERVE_UI=0
export PAPERCUSP_BIND_HOST=127.0.0.1 PAPERCUSP_DISABLE_DOGFOOD_HIVE=1
export PAPERCUSP_PG_HOST_CREDENTIALS=1 PAPERCUSP_PG_SQL_DIR="$sidecar/db-sql"
export PAPERCUSP_PG_RESTORE_BIN="$sidecar/bin/pg_restore"
if [ -f "$sidecar/db-seed.dump" ]; then export PAPERCUSP_PG_SEED_PATH="$sidecar/db-seed.dump"; fi
export PAPERCUSP_HARNESS_DIR="$sidecar/harness" PAPERCUSP_RUBRICS_DIR="$sidecar/rubrics"
export PAPERCUSP_TEMPLATES_DIR="$sidecar/templates" PAPERCUSP_GOAL_PACKAGES_DIR="$sidecar/goal-packages"
export PAPERCUSP_PROMPTS_DIR="$sidecar/prompts" PAPERCUSP_DOCS_ROOT="$sidecar/internal-docs"
export OTEL_SDK_DISABLED=true
PATH="$sidecar/bin:$PATH"
export PATH
mkdir -p "$PAPERCUSP_HOME" "$PAPERCUSP_WORKSPACES_ROOT"
exec "$sidecar/bin/node" "$sidecar/serve.mjs" "$@"

#!/bin/bash
# Run ON the Mac VM directly (or pipe over ssh). This mounts a DMG read-only
# and restores the SAME logical database seed into TWO fresh PGDATA dirs.
# A schema-only pass is insufficient: WI-39304 requires the two initdb-created
# system_identifier values to differ, proving no physical cluster was cloned.
# Keep collecting diagnostics after a failed assertion, then return a real
# verdict so a transcript cannot masquerade as a passing release gate.
FAILURES=0
# Test-only escape hatch used by verification-script-verdict-guard.test.js.  It
# proves this script can emit FAIL without touching a real Mac or DMG.
if [ "${MAC_VM_VERDICT_TEST_FAIL:-0}" = "1" ]; then
  FAILURES=1
  echo "  FAIL  synthetic failure requested by the verdict guard"
  echo "VERDICT: FAIL (1 failed assertion(s))"
  exit 1
fi
pass() { echo "  PASS  $*"; }
fail() { echo "  FAIL  $*"; FAILURES=$((FAILURES+1)); }
emit_verdict() {
  echo
  echo "================ VERDICT ================"
  if [ "$FAILURES" -gt 0 ]; then
    echo "VERDICT: FAIL ($FAILURES failed assertion(s))"
    echo "=========================================="
    exit 1
  fi
  echo "VERDICT: PASS (logical seed restored twice with distinct cluster identities)"
  echo "=========================================="
  exit 0
}
DMG="$1"
[ -n "$DMG" ] || DMG="$PAPERCUSP_MAC_SEED_DMG"
[ -n "$DMG" ] || DMG=$(ls -t "$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/"*.dmg 2>/dev/null | head -1)
WORK=/tmp/seedtest.$$
mkdir -p "$WORK"

echo "=== 1. mount fresh DMG ==="
MNT=$(hdiutil attach "$DMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
echo "mount=$MNT"
APP=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
SIDE="$APP/Contents/Resources/sidecar"
SEED="$SIDE/db-seed.dump"
echo "seed=$(ls -la "$SEED" 2>/dev/null | awk '{print $5}') bytes"
if [ -n "$MNT" ] && [ -d "$MNT" ]; then pass "fresh DMG mounted"; else fail "could not mount fresh DMG ($DMG)"; fi
if [ -s "$SEED" ]; then pass "DMG contains a non-empty logical database seed"; else fail "DMG logical database seed is missing or empty"; fi

echo; echo "=== 2. locate bundled logical-restore runtime ==="
NODE="$SIDE/bin/node"
[ -x "$NODE" ] || NODE=$(find "$SIDE" -type f -name node -perm -111 2>/dev/null | head -1)
PSQL="$SIDE/bin/psql"
PGRESTORE="$SIDE/bin/pg_restore"
SERVER="$SIDE/node_modules/@papercusp/embedded-postgres-server/bin/embedded-postgres-server.mjs"
[ -f "$SERVER" ] || SERVER=$(find "$SIDE" -path '*/embedded-postgres-server/bin/embedded-postgres-server.mjs' 2>/dev/null | head -1)
if [ -x "$NODE" ] && [ -x "$PSQL" ] && [ -x "$PGRESTORE" ] && [ -f "$SERVER" ]; then
  pass "DMG contains node, psql, pg_restore, and embedded server"
else
  fail "DMG logical-restore runtime is incomplete"
fi
MAGIC=$(head -c 5 "$SEED" 2>/dev/null)
if [ "$MAGIC" = "PGDMP" ] && "$PGRESTORE" --list "$SEED" >/dev/null 2>&1; then
  pass "db-seed.dump is a readable pg_dump custom archive"
else
  fail "db-seed.dump is not a readable PGDMP archive"
fi

SYS1=""; SYS2=""; MIG1=""; MIG2=""
boot_one() { # label port
  label="$1"; port="$2"
  data="$WORK/pgdata-$label"; home="$WORK/home-$label"; log="$WORK/boot-$label.log"
  mkdir -p "$data" "$home"
  echo; echo "=== 3.$label restore logical seed into independent PGDATA on :$port ==="
  env HOME="$home" PATH="$SIDE/bin:/usr/bin:/bin" \
    PAPERCUSP_PG_DATA_DIR="$data" PAPERCUSP_PG_PORT="$port" \
    PAPERCUSP_PG_DB_NAME=papercusp PAPERCUSP_PG_SQL_DIR="$SIDE/db-sql" \
    PAPERCUSP_PG_SEED_PATH="$SEED" PAPERCUSP_PG_RESTORE_BIN="$PGRESTORE" \
    PAPERCUSP_PG_DEBUG=1 "$NODE" "$SERVER" >"$log" 2>&1 &
  pid=$!
  ready=0; result=""
  for _ in $(seq 1 80); do
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    result=$(PGPASSWORD=postgres "$PSQL" -h 127.0.0.1 -p "$port" -U postgres -d papercusp -tAc \
      "select (select system_identifier::text from pg_control_system()) || '|' || (select count(*)::text from harness_shared.schema_migrations)" 2>/dev/null)
    if printf '%s' "$result" | grep -Eq '^[0-9]+\|[1-9][0-9]*$'; then ready=1; break; fi
    sleep 0.5
  done
  sysid=$(printf '%s' "$result" | cut -d'|' -f1)
  migrations=$(printf '%s' "$result" | cut -d'|' -f2)
  if [ "$ready" = "1" ]; then
    pass "install $label served with system_identifier=$sysid and migrations=$migrations"
    if [ "$label" = "one" ]; then SYS1="$sysid"; MIG1="$migrations"; else SYS2="$sysid"; MIG2="$migrations"; fi
  else
    fail "install $label did not expose a fully migrated database"
    tail -20 "$log"
  fi
  if grep -q 'logical seed restored' "$log" && ! grep -q 'logical seed failed' "$log"; then
    pass "install $label used the logical restore path"
  else
    fail "install $label did not prove successful logical restore"
    tail -20 "$log"
  fi
  if ! grep -Eq "^[[:space:]]*lc_(messages|monetary|numeric|time)[[:space:]]*=[[:space:]]*'(en_|C\.UTF-8)" "$data/postgresql.conf" 2>/dev/null; then
    pass "install $label postgresql.conf carries no non-portable runtime locale"
  else
    fail "install $label postgresql.conf carries a non-portable locale"
  fi
  kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

if [ -s "$SEED" ] && [ -x "$NODE" ] && [ -x "$PSQL" ] && [ -x "$PGRESTORE" ] && [ -f "$SERVER" ]; then
  boot_one one 5599
  boot_one two 5600
fi

echo; echo "=== 4. compare independent install identities ==="
if [ -n "$SYS1" ] && [ -n "$SYS2" ] && [ "$SYS1" != "$SYS2" ]; then
  pass "one logical seed produced distinct system identifiers: $SYS1 != $SYS2"
else
  fail "two installs did not produce distinct system identifiers"
fi
if [ -n "$MIG1" ] && [ "$MIG1" = "$MIG2" ] && [ "$MIG1" -gt 100 ] 2>/dev/null; then
  pass "both installs expose the same complete migration-ledger cardinality ($MIG1)"
else
  fail "migration ledgers are missing, incomplete, or inconsistent"
fi

echo; echo "=== 5. cleanup ==="
[ -n "$MNT" ] && hdiutil detach "$MNT" >/dev/null 2>&1 && echo "detached DMG"
rm -rf "$WORK" && echo "cleaned $WORK"
emit_verdict

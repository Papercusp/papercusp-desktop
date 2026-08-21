#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Isolated fresh-user runtime provisioning test (NON-DISRUPTIVE — touches no running instance).
# Proves: the fresh DMG's shipped seed is a valid PG18 cluster with locale=C (the fix) and the
# full migrated schema, i.e. a NEW user's first boot provisions a working DB from it.
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
  echo "VERDICT: PASS (fresh seed runtime assertions passed)"
  echo "=========================================="
  exit 0
}
DMG="$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Papercusp GUI_0.0.2_x64.dmg"
WORK=/tmp/seedtest.$$
DATA="$WORK/pgdata"
SOCK="$WORK/sock"
mkdir -p "$WORK" "$SOCK"

echo "=== 1. mount fresh DMG ==="
MNT=$(hdiutil attach "$DMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
echo "mount=$MNT"
APP=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
SIDE="$APP/Contents/Resources/sidecar"
SEED="$SIDE/db-seed.tar.gz"
echo "seed=$(ls -la "$SEED" 2>/dev/null | awk '{print $5}') bytes"
if [ -n "$MNT" ] && [ -d "$MNT" ]; then pass "fresh DMG mounted"; else fail "could not mount fresh DMG ($DMG)"; fi
if [ -s "$SEED" ]; then pass "DMG contains a non-empty database seed"; else fail "DMG database seed is missing or empty"; fi

echo; echo "=== 2. locate bundled postgres binaries ==="
PGBIN=$(find "$SIDE" -type f -name postgres 2>/dev/null | head -1)
INITDB=$(find "$SIDE" -type f -name initdb 2>/dev/null | head -1)
PSQL=$(find "$SIDE" -type f -name psql 2>/dev/null | head -1)
echo "postgres=$PGBIN"
echo "psql=$PSQL"
if [ -x "$PGBIN" ] && [ -x "$PSQL" ]; then pass "DMG contains executable postgres and psql binaries"; else fail "DMG is missing executable postgres/psql binaries"; fi

echo; echo "=== 3. unpack seed into clean PGDATA ==="
tar xzf "$SEED" -C "$WORK" 2>/dev/null
# seed may unpack as pgdata/ or as bare cluster files — find PG_VERSION
PGV=$(find "$WORK" -maxdepth 3 -name PG_VERSION 2>/dev/null | head -1)
if [ -n "$PGV" ]; then DATA=$(dirname "$PGV"); else DATA=""; fi
echo "unpacked cluster dir=$DATA"
echo "PG_VERSION=$(cat "$PGV" 2>/dev/null)"
if [ -n "$PGV" ] && [ -f "$DATA/postgresql.conf" ] && [ -f "$DATA/pg_hba.conf" ]; then
  pass "seed unpacked as a PostgreSQL cluster"
else
  fail "seed did not unpack as a complete PostgreSQL cluster"
fi
echo "--- locale in postgresql.conf (THE FIX: expect C, not C.UTF-8) ---"
LOCALE_LINES=$(grep -iE '^\s*(lc_|default_text_search|cluster_name)' "$DATA/postgresql.conf" 2>/dev/null | head)
printf '%s\n' "$LOCALE_LINES"
if printf '%s\n' "$LOCALE_LINES" | grep -qE '(^|[=[:space:]])C([[:space:]]|$)'; then pass "seed locale configuration is C"; else fail "seed locale configuration does not prove C"; fi
echo "--- pg_hba local auth method ---"
grep -vE '^\s*#|^\s*$' "$DATA/pg_hba.conf" 2>/dev/null | head -6

echo; echo "=== 4. start postgres on isolated socket + query migrated schema ==="
chmod 700 "$DATA" 2>/dev/null
if [ -x "$PGBIN" ]; then
  "$PGBIN" -D "$DATA" -k "$SOCK" -c listen_addresses='' -p 5599 >"$WORK/pg.log" 2>&1 &
  PGPID=$!
else
  PGPID=""
fi
# wait up to 20s for readiness
READY=0
for i in $(seq 1 40); do
  [ -x "$PSQL" ] && "$PSQL" -h "$SOCK" -p 5599 -U postgres -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 && { READY=1; break; }
  # try harness_admin / template1 too
  [ -x "$PSQL" ] && "$PSQL" -h "$SOCK" -p 5599 -U harness_admin -d postgres -tAc 'SELECT 1' >/dev/null 2>&1 && { READY=1; break; }
  sleep 0.5
done
if [ "$READY" = "1" ]; then pass "seeded postgres accepted a readiness query"; else fail "seeded postgres did not become ready within 20s"; fi
echo "--- pg.log tail ---"; tail -5 "$WORK/pg.log"
echo "--- try queries (whichever superuser the seed uses) ---"
MIGRATIONS_OK=0
for U in postgres harness_admin; do
  R=$("$PSQL" -h "$SOCK" -p 5599 -U "$U" -d postgres -tAc "select count(*) from harness_shared.schema_migrations" 2>&1)
  echo "user=$U -> $R"
  printf '%s\n' "$R" | grep -Eq '^[[:space:]]*[1-9][0-9]*[[:space:]]*$' && MIGRATIONS_OK=1
done
if [ "$MIGRATIONS_OK" = "1" ]; then pass "seed exposes a non-empty migrated schema"; else fail "seed schema_migrations query did not return a positive count"; fi
echo "--- databases present ---"
DBS=$("$PSQL" -h "$SOCK" -p 5599 -U postgres -d postgres -tAc "select datname from pg_database order by 1" 2>&1)
printf '%s\n' "$DBS" | head
if printf '%s\n' "$DBS" | grep -q 'postgres'; then pass "postgres database is present"; else fail "postgres database listing is unavailable"; fi

echo; echo "=== 5. cleanup ==="
# graceful stop
PGCTL=$(find "$SIDE" -type f -name pg_ctl 2>/dev/null | head -1)
[ -n "$PGCTL" ] && [ -n "$DATA" ] && "$PGCTL" -D "$DATA" -m immediate stop >/dev/null 2>&1
[ -n "$PGPID" ] && kill "$PGPID" 2>/dev/null
sleep 1; [ -n "$PGPID" ] && kill -9 "$PGPID" 2>/dev/null
[ -n "$MNT" ] && hdiutil detach "$MNT" >/dev/null 2>&1 && echo "detached DMG"
rm -rf "$WORK" && echo "cleaned $WORK"
emit_verdict

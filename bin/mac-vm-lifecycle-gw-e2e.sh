#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Lifecycle relaunch (#22) + real gateway model call (#21) E2E. Bounded, single-shot.
# Keep collecting diagnostics after a failed probe, then return a real verdict so
# callers cannot mistake this transcript for a passing gate.
FAILURES=0
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
  echo "VERDICT: PASS (lifecycle + gateway assertions passed)"
  echo "=========================================="
  exit 0
}

PSQL="/Applications/Papercusp Server.app/Contents/Resources/sidecar/bin/psql"
sysid() { "$PSQL" "$1" -tAc "select system_identifier from pg_control_system();" 2>/dev/null | tr -d ' '; }
migct() { "$PSQL" "$1" -tAc "select count(*) from harness_shared.schema_migrations;" 2>/dev/null | tr -d ' '; }
readurl() { python3 -c "import json;print(json.load(open('$HOME/.papercusp/embedded-pg.json'))['url'])" 2>/dev/null; }

echo "=== BEFORE relaunch ==="
URL1=$(readurl); echo "pg url1(port): $(echo "$URL1" | grep -oE ':[0-9]+/' )"
SYS1=$(sysid "$URL1"); MIG1=$(migct "$URL1")
echo "system_identifier BEFORE = $SYS1 ; migrations = $MIG1"
STARTED1=$(python3 -c "import json;print(json.load(open('$HOME/.papercusp/embedded-pg.json')).get('startedAt'))" 2>/dev/null)
echo "embedded-pg startedAt BEFORE = $STARTED1"
[ -n "$URL1" ] && pass "embedded PG URL is readable before relaunch" || fail "could not read embedded-pg.json before relaunch"
[ -n "$SYS1" ] && pass "system_identifier is readable before relaunch" || fail "could not read system_identifier before relaunch"
[ -n "$MIG1" ] && pass "schema migration count is readable before relaunch" || fail "could not read schema migration count before relaunch"

echo
echo "=== QUIT both apps (lifecycle) ==="
osascript -e 'tell application id "com.papercusp.gui" to quit' 2>/dev/null
osascript -e 'tell application id "com.papercusp.server" to quit' 2>/dev/null
sleep 4
pkill -f 'Papercusp GUI.app/Contents/MacOS' 2>/dev/null
pkill -f 'Papercusp Server.app/Contents/MacOS' 2>/dev/null
pkill -f 'Papercusp Server.app/Contents/Resources/sidecar' 2>/dev/null
sleep 4
echo "papercusp procs after quit: $(ps aux | grep -icE '[P]apercusp')"
echo "embedded-pg.json still present (data survived quit): $([ -f "$HOME/.papercusp/embedded-pg.json" ] && echo yes || echo NO)"

echo
echo "=== SEED owner-authorized credential (for the real gateway call) ==="
mkdir -p "$HOME/.claude"
if [ -f /tmp/box-cred.json ]; then cp /tmp/box-cred.json "$HOME/.claude/.credentials.json" && echo "seeded ~/.claude/.credentials.json ($(wc -c < "$HOME/.claude/.credentials.json") bytes)"; else echo "NO /tmp/box-cred.json — skipping seed"; fi

echo
echo "=== RELAUNCH GUI ==="
open "/Applications/Papercusp GUI.app"
echo "waiting for operator boot (up to 200s)..."
OPPORT=""
for i in $(seq 1 100); do
  sleep 2
  for P in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i node | grep -oE '127.0.0.1:[0-9]+' | grep -oE '[0-9]+$' | sort -u); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$P/api/health" 2>/dev/null)
    if [ "$code" = "200" ]; then OPPORT="$P"; break; fi
  done
  [ -n "$OPPORT" ] && { echo "operator UP on :$OPPORT after ~$((i*2))s (2nd boot)"; break; }
done
if [ -z "$OPPORT" ]; then
  echo "operator did NOT come back within 200s"
  fail "operator did not come back within 200s"
else
  pass "operator came back on :$OPPORT"
fi

echo
echo "=== AFTER relaunch: reuse check ==="
sleep 3
URL2=$(readurl); echo "pg url2(port): $(echo "$URL2" | grep -oE ':[0-9]+/' )"
SYS2=$(sysid "$URL2"); MIG2=$(migct "$URL2")
STARTED2=$(python3 -c "import json;print(json.load(open('$HOME/.papercusp/embedded-pg.json')).get('startedAt'))" 2>/dev/null)
echo "system_identifier AFTER = $SYS2 ; migrations = $MIG2 ; startedAt AFTER = $STARTED2"
if [ -n "$SYS1" ] && [ "$SYS1" = "$SYS2" ]; then echo "REUSE VERDICT: ✅ SAME physical DB (system_identifier identical) — seed REUSED, NOT re-provisioned"; else echo "REUSE VERDICT: ⚠ system_identifier changed ($SYS1 -> $SYS2) — DB was re-provisioned!"; fi
if [ -n "$SYS1" ] && [ -n "$SYS2" ] && [ "$SYS1" = "$SYS2" ]; then
  pass "relaunch reused the same physical DB"
else
  fail "relaunch did not prove physical DB reuse (before='$SYS1', after='$SYS2')"
fi

echo
echo "=== #21 REAL gateway model call through the relaunched app's :8788 ==="
for i in $(seq 1 20); do gw=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8788/healthz 2>/dev/null); [ "$gw" = "200" ] && break; sleep 2; done
echo ":8788/healthz = $gw"
if [ "$gw" = "200" ]; then pass "gateway health is ready"; else fail "gateway health did not return 200"; fi
echo "--- POST /v1/messages (claude-haiku-4-5) via the app gateway ---"
RESP=$(curl -s --max-time 40 -X POST http://127.0.0.1:8788/v1/messages \
  -H 'content-type: application/json' -H 'anthropic-version: 2023-06-01' \
  -d '{"model":"claude-haiku-4-5-20251001","max_tokens":32,"messages":[{"role":"user","content":"Reply with exactly: LIFECYCLE-GW-OK"}]}' 2>/dev/null)
echo "gateway response (first 500c): $(printf %s "$RESP" | head -c 500)"
echo "MODEL TEXT: $(printf %s "$RESP" | python3 -c "import sys,json;
try:
 d=json.load(sys.stdin); print(''.join(b.get('text','') for b in d.get('content',[])) or d.get('error',{}).get('message','(no text)'))
except Exception as e: print('(parse fail)')" 2>/dev/null)"
MODEL_TEXT=$(printf %s "$RESP" | python3 -c "import sys,json;
try:
 d=json.load(sys.stdin); print(''.join(b.get('text','') for b in d.get('content',[])))
except Exception: print('')" 2>/dev/null)
if [ "$MODEL_TEXT" = "LIFECYCLE-GW-OK" ]; then
  pass "gateway model call returned the expected text"
else
  fail "gateway model call did not return the expected text (got='${MODEL_TEXT:-empty}')"
fi

echo
echo "=== SCRUB owner-authorized credential ==="
rm -f "$HOME/.claude/.credentials.json" /tmp/box-cred.json && echo "scrubbed ~/.claude/.credentials.json + /tmp/box-cred.json"
echo "=== DONE ==="
emit_verdict

#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Launch the FRESH build's bundled gateway sidecar standalone on macOS (test port 8799),
# using the running instance's harness env for PG (read-only pool load) and a throwaway HOME
# holding this box's copied credential bundle (→ file: credentialRef, no keychain ACL).
set +e
SERVE=$(cat /tmp/gw_serve.txt 2>/dev/null)
NODE=$(cat /tmp/gw_node.txt 2>/dev/null)
echo "SERVE=$SERVE"
echo "NODE=$NODE"
[ -f "$SERVE" ] || { echo "FATAL: serve.mjs missing (DMG unmounted?) — re-run prep2"; exit 1; }

# throwaway HOME with the copied credential bundle
export GWHOME=/tmp/gwtest-home
mkdir -p "$GWHOME/.claude"
cp /tmp/gwcred.json "$GWHOME/.claude/.credentials.json" 2>/dev/null
chmod 600 "$GWHOME/.claude/.credentials.json"
echo "cred bundle bytes=$(wc -c < "$GWHOME/.claude/.credentials.json" 2>/dev/null)"

# resolve the running instance's embedded PG admin URL from its discovery file (read-only pool load)
DBURL=$(python3 -c "import json;print(json.load(open('/Users/aviweiss/.papercusp/embedded-pg.json'))['url'])" 2>/dev/null)
echo "HARNESS_ADMIN_DATABASE_URL host:port=$(printf '%s' "$DBURL" | sed -E 's#.*@##; s#/.*##')"
[ -z "$DBURL" ] && { echo "FATAL: could not read embedded-pg.json url"; exit 1; }

pkill -f 'PAPERCUSP_GATEWAY_PORT=8799' 2>/dev/null
LOG=/tmp/gw8799.log
: > "$LOG"
echo "=== launching gateway sidecar on :8799 ==="
HOME="$GWHOME" \
HARNESS_ADMIN_DATABASE_URL="$DBURL" \
PAPERCUSP_HARNESS_DIR=/Applications/Papercusp \
PAPERCUSP_WORKSPACES_ROOT=/Users/aviweiss/.papercusp-workspaces \
PAPERCUSP_GATEWAY_SIDECAR_MODE=1 \
PAPERCUSP_GATEWAY_PORT=8799 \
PAPERCUSP_GATEWAY_SUPERVISE=0 \
nohup "$NODE" "$SERVE" >"$LOG" 2>&1 &
GWPID=$!
echo "gateway pid=$GWPID"

echo "=== poll :8799/healthz (up to 30s) ==="
UP=0
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8799/healthz 2>/dev/null)
  if [ "$code" = "200" ]; then UP=1; echo "healthz 200 after ${i} tries"; break; fi
  sleep 0.5
done
echo "--- log tail ---"; tail -30 "$LOG"
echo "--- /healthz body ---"; curl -s --max-time 4 http://127.0.0.1:8799/healthz 2>/dev/null | head -c 1200; echo
echo "--- /admin/config (resolved account) ---"; curl -s --max-time 4 http://127.0.0.1:8799/admin/config 2>/dev/null | head -c 1500; echo
echo "UP=$UP GWPID=$GWPID"

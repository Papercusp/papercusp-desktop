#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Non-disruptive inspection of the currently-running Papercusp instance on the Mac VM.
set +e
echo "=== running node/operator proc (app bundle path) ==="
ps aux | grep -iE 'node .*Papercusp' | grep -v grep | head -3 | sed -E 's/  +/ /g' | cut -c1-200

echo; echo "=== listening TCP ports (operator dynamic port lives here) ==="
lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep -iE 'node|postgres' | awk '{print $1, $9}' | sort -u | head -20

echo; echo "=== app logs (newest) ==="
LOG=$(ls -t "$HOME/Library/Logs"/*apercusp*/*.log 2>/dev/null | head -1)
[ -z "$LOG" ] && LOG=$(ls -t "$HOME/Library/Application Support"/*apercusp*/*.log "$HOME/Library/Application Support"/*apercusp*/logs/*.log 2>/dev/null | head -1)
echo "log=$LOG"
if [ -n "$LOG" ]; then
  echo "--- build sha / version / port / pg / seed lines ---"
  grep -iE 'sha|version|listening on|health|:31[0-9]{3}|:15[0-9]{3}|postgres|initdb|seed|ready|RouteError' "$LOG" 2>/dev/null | tail -25
fi

echo; echo "=== probe operator /health on candidate ports ==="
for P in $(lsof -iTCP -sTCP:LISTEN -nP 2>/dev/null | grep node | grep -oE '127.0.0.1:[0-9]+|:[0-9]{4,5}' | grep -oE '[0-9]{4,5}' | sort -u); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "http://127.0.0.1:$P/api/health" 2>/dev/null)
  echo "port $P /api/health -> $code"
done

echo; echo "=== embedded PG: which data dir + locale of the running cluster ==="
ps aux | grep -E 'postgres.*-D' | grep -v grep | grep -oE '\-D [^ ]+' | head -1

#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
set +e
BASE="$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg"
echo "=== available fresh DMGs ==="
ls -la "$BASE"/*.dmg 2>/dev/null | awk '{print $5, $NF}'

echo; echo "=== mount SERVER DMG (holds the full operator+gateway sidecar) ==="
SRVDMG=$(ls -t "$BASE"/*Server*.dmg 2>/dev/null | head -1)
MNT=$(hdiutil attach "$SRVDMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
echo "SRVDMG basename=$(basename "$SRVDMG")"
echo "MNT=$MNT"
APP=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
echo "APP=$APP"
SERVE=$(find "$APP/Contents/Resources/sidecar" -maxdepth 3 -name 'serve.mjs' 2>/dev/null | head -1)
NODE=$(find "$APP/Contents/Resources/sidecar" -maxdepth 3 -type f -name 'node' 2>/dev/null | head -1)
echo "SERVE=$SERVE"
echo "NODE=$NODE"
if [ -n "$SERVE" ]; then
  echo "serve.mjs size=$(wc -c < "$SERVE") bytes"
  echo "gateway-mode markers in serve.mjs: $(grep -c 'PAPERCUSP_GATEWAY_SIDECAR_MODE' "$SERVE") / runGatewaySidecarMain: $(grep -c 'runGatewaySidecarMain' "$SERVE")"
fi
printf '%s' "$MNT"  > /tmp/gw_mnt.txt
printf '%s' "$SERVE" > /tmp/gw_serve.txt
printf '%s' "$NODE"  > /tmp/gw_node.txt

echo; echo "=== running operator sidecar env (pid 26433) — DATABASE_URL captured to /tmp/gw_dburl (not echoed) ==="
for PID in 26433 26445 26431; do
  DBU=$(ps eww "$PID" 2>/dev/null | tr ' ' '\n' | grep -E '^DATABASE_URL=' | head -1 | cut -d= -f2-)
  if [ -n "$DBU" ]; then echo "found DATABASE_URL on pid $PID"; printf '%s' "$DBU" > /tmp/gw_dburl; break; fi
done
if [ -s /tmp/gw_dburl ]; then
  echo "DATABASE_URL host:port = $(sed -E 's#.*@##; s#/.*##' /tmp/gw_dburl)"
  echo "DATABASE_URL db = $(sed -E 's#.*/##; s#\?.*##' /tmp/gw_dburl)"
else
  echo "NO DATABASE_URL in those pids; dumping candidate env keys from 26433:"
  ps eww 26433 2>/dev/null | tr ' ' '\n' | grep -iE '^(DATABASE|PG|HARNESS|WORKSPACE|PAPERCUSP_WORKSPACE|PAPERCUSP_HARNESS)' | sed -E 's#//[^@]*@#//[REDACTED]@#' | head -20
fi

echo; echo "=== workspace id + harness from operator env ==="
ps eww 26433 2>/dev/null | tr ' ' '\n' | grep -iE '^(PAPERCUSP_WORKSPACE|WORKSPACE_ID|PAPERCUSP_HARNESS|HARNESS_SLUG)=' | head
echo "done"

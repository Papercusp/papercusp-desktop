#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Read-only prep inspection for the non-disruptive fresh-gateway macOS test.
set +e
echo "=== A. fresh DMG bundled node + serve.mjs ==="
DMG=$(ls -t "$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/"*GUI*.dmg 2>/dev/null | head -1)
echo "DMG=$DMG"
MNT=$(hdiutil attach "$DMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
echo "MNT=$MNT"
APP=$(ls -d "$MNT"/*.app 2>/dev/null | head -1)
SIDE="$APP/Contents/Resources/sidecar"
echo "serve.mjs=$(ls -la "$SIDE/bin/serve.mjs" 2>/dev/null | awk '{print $5, $9}')"
echo "bundled node=$(ls -la "$SIDE/bin/node" 2>/dev/null | awk '{print $9}')"
echo "gateway serve.ts divert marker present in serve.mjs:"
grep -c 'PAPERCUSP_GATEWAY_SIDECAR_MODE\|runGatewaySidecarMain' "$SIDE/bin/serve.mjs" 2>/dev/null
# stash the mount path for the run step
echo "$MNT" > /tmp/gw_mnt.txt
echo "$SIDE" > /tmp/gw_side.txt

echo; echo "=== B. running Server sidecar env (DATABASE_URL / workspace / port) ==="
# find the running operator sidecar node pid (the serve.mjs one)
SPID=$(ps aux | grep -iE 'Papercusp Server.*sidecar.*node .*serve' | grep -v grep | awk '{print $2}' | head -1)
[ -z "$SPID" ] && SPID=$(ps aux | grep -iE 'Papercusp Server.*Resources/sidecar' | grep -v grep | grep -iE 'node ' | grep -v postgres | awk '{print $2}' | head -1)
echo "server sidecar pid=$SPID"
ps eww "$SPID" 2>/dev/null | tr ' ' '\n' | grep -iE '^DATABASE_URL=|^HARNESS_ADMIN|^PGPORT=|^PAPERCUSP_WORKSPACE|^WORKSPACE_ID=|^PAPERCUSP_HARNESS' | sed -E 's/(password|:[^@:]+@)/[REDACTED]@/' | head
echo "--- (DATABASE_URL host/port only, secret masked) ---"
ps eww "$SPID" 2>/dev/null | tr ' ' '\n' | grep -iE '^DATABASE_URL=' | sed -E 's#//[^@]*@#//[REDACTED]@#' | head

echo; echo "=== C. VM existing ~/.claude ==="
ls -la "$HOME/.claude/.credentials.json" 2>/dev/null || echo "no ~/.claude/.credentials.json on VM"
ls -d "$HOME/.claude" 2>/dev/null && ls "$HOME/.claude" 2>/dev/null | head

echo; echo "=== D. leave DMG mounted for run step (path in /tmp/gw_mnt.txt) ==="
echo "done"

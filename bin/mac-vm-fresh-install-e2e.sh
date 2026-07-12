#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# Fresh-install E2E of the HEAD Mac build (WI-3101 #14). Bounded, single-shot.
# Replaces the stale /Applications install with the fresh DMGs, launches the GUI, and verifies:
#   operator boots (dynamic /api/health 200) · SPA renders (not RouteErrorBoundary) ·
#   gateway auto-supervised on :8788 (REQ A gold proof) · offline seed provisioned.
set +e
# Bundle dir differs by build flavor: release builds are universal-apple-darwin,
# fast-iter test builds are x86_64-apple-darwin. Auto-pick whichever has the
# NEWEST GUI dmg (override with MAC_E2E_BUNDLE_BASE).
TGT="$HOME/papercup-build-mac/papercup/papercusp-desktop/src-tauri/target"
if [ -n "$MAC_E2E_BUNDLE_BASE" ]; then
  BASE="$MAC_E2E_BUNDLE_BASE"
else
  BASE=$(ls -t "$TGT"/universal-apple-darwin/release/bundle/dmg/*GUI*.dmg \
               "$TGT"/x86_64-apple-darwin/release/bundle/dmg/*GUI*.dmg 2>/dev/null \
         | head -1 | xargs -I{} dirname {})
fi
echo "BASE=$BASE"
GUIDMG=$(ls -t "$BASE"/*GUI*.dmg 2>/dev/null | head -1)
SRVDMG=$(ls -t "$BASE"/*Server*.dmg 2>/dev/null | head -1)
echo "GUIDMG=$(basename "$GUIDMG")  SRVDMG=$(basename "$SRVDMG")"

echo "=== 1. quit running instance (kills the idle leftover psu session) ==="
osascript -e 'tell application "Papercusp GUI" to quit' 2>/dev/null
osascript -e 'tell application "Papercusp Server" to quit' 2>/dev/null
sleep 3
pkill -f 'Papercusp GUI.app/Contents/MacOS' 2>/dev/null
pkill -f 'Papercusp Server.app/Contents/MacOS' 2>/dev/null
pkill -f 'Papercusp Server.app/Contents/Resources/sidecar' 2>/dev/null
sleep 3
echo "remaining papercusp procs: $(ps aux | grep -iE '[P]apercusp' | wc -l | tr -d ' ')"

echo "=== 2. remove stale installs + LaunchServices unregister (WI-2903 collision guard) ==="
LSR=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister
for app in "/Applications/Papercusp GUI.app" "/Applications/Papercusp Server.app" "/Applications/Papercusp.app"; do
  [ -e "$app" ] && { "$LSR" -u "$app" 2>/dev/null; rm -rf "$app" && echo "removed $app"; }
done

echo "=== 3. install fresh DMGs → /Applications ==="
for DMG in "$SRVDMG" "$GUIDMG"; do
  MNT=$(hdiutil attach "$DMG" -nobrowse -readonly -mountrandom /tmp 2>/dev/null | grep -oE '/tmp/[^ ]+$' | tail -1)
  APP=$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)
  cp -R "$APP" /Applications/ && echo "installed $(basename "$APP")"
  hdiutil detach "$MNT" >/dev/null 2>&1
done
echo "=== 4. strip quarantine (unsigned Gatekeeper) + re-register ==="
xattr -dr com.apple.quarantine "/Applications/Papercusp GUI.app" 2>/dev/null
xattr -dr com.apple.quarantine "/Applications/Papercusp Server.app" 2>/dev/null
"$LSR" -f "/Applications/Papercusp Server.app" 2>/dev/null
"$LSR" -f "/Applications/Papercusp GUI.app" 2>/dev/null

echo "=== 5. launch GUI ==="
open "/Applications/Papercusp GUI.app"
echo "launched; waiting for operator boot (up to 200s)..."

OPPORT=""; SPA=""; HB=""
for i in $(seq 1 100); do
  sleep 2
  # discover node-listened ports, probe /api/health
  for P in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i node | grep -oE '127.0.0.1:[0-9]+|:[0-9]{4,5}' | grep -oE '[0-9]{4,5}' | sort -u); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$P/api/health" 2>/dev/null)
    if [ "$code" = "200" ]; then OPPORT="$P"; break; fi
  done
  [ -n "$OPPORT" ] && { echo "operator UP on :$OPPORT after ~$((i*2))s"; break; }
done

if [ -n "$OPPORT" ]; then
  echo "--- /api/health ---"; curl -s --max-time 4 "http://127.0.0.1:$OPPORT/api/health" 2>/dev/null | head -c 400; echo
  echo "--- SPA root HTML (first 600 chars; expect app shell, NOT RouteErrorBoundary/hit-an-error) ---"
  HTML=$(curl -s --max-time 6 "http://127.0.0.1:$OPPORT/" 2>/dev/null)
  echo "$HTML" | head -c 600; echo
  echo "SPA markers: root_div=$(echo "$HTML" | grep -c 'id=\"root\"\|id=\"app\"\|<div id') script_module=$(echo "$HTML" | grep -c 'type=\"module\"') error_card=$(echo "$HTML" | grep -ciE 'RouteErrorBoundary|hit an error|Importing a module script failed')"
else
  echo "operator did NOT reach /api/health 200 within 200s"
fi

echo "=== 6. REQ A gold proof: gateway auto-supervised by the real app on :8788 ==="
for i in $(seq 1 20); do
  gw=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8788/healthz 2>/dev/null)
  [ "$gw" = "200" ] && break; sleep 2
done
echo ":8788/healthz = $gw"
[ "$gw" = "200" ] && curl -s --max-time 4 http://127.0.0.1:8788/healthz 2>/dev/null | head -c 300; echo

echo "=== 7. embedded PG (fresh seed provisioned) ==="
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i postgres | awk '{print $1, $9}' | head -3
cat "$HOME/.papercusp/embedded-pg.json" 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print('embedded-pg port',d.get('port'),'pid',d.get('pid'))" 2>/dev/null
echo "=== DONE ==="
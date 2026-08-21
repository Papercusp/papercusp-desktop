#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# WI-3139 verification: relaunch the GUI N times and assert it STAYS ALIVE +
# no NEW wry nil-URL panic. Old build (pre-fix) crashed 3/3 here.
# Detection:
#   - GUI process = 'Papercusp GUI.app/Contents/MacOS' pid must be live after boot
#     (crash killed the GUI Rust main thread but left Server+operator running,
#      so operator /api/health alone is NOT sufficient).
#   - byte-offset diff on ~/.papercusp/logs/gui.log → count only NEWLY appended
#     'panicked at' lines this iteration.
# This script emits a machine-readable verdict.  The checks intentionally keep
# running after a failure so the operator gets the complete relaunch picture;
# `emit_verdict` at the end is the only exit path.
GUILOG="$HOME/.papercusp/logs/gui.log"
N=3
PASS=0
FAILURES=0

emit_verdict() {
  echo
  echo "================ VERDICT ================"
  if [ "$FAILURES" -gt 0 ]; then
    echo "VERDICT: FAIL ($FAILURES failed relaunch(es))"
    echo "=========================================="
    exit 1
  fi
  echo "VERDICT: PASS ($N/$N relaunches survived)"
  echo "=========================================="
  exit 0
}

guipid() { pgrep -f 'Papercusp GUI.app/Contents/MacOS' 2>/dev/null | head -1; }
ophealth() {
  for P in $(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -i node | grep -oE '127.0.0.1:[0-9]+' | grep -oE '[0-9]+$' | sort -u); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$P/api/health" 2>/dev/null)
    [ "$code" = "200" ] && { echo "$P"; return; }
  done
}

echo "=== baseline: GUI pid=$(guipid)  gui.log bytes=$( [ -f "$GUILOG" ] && wc -c < "$GUILOG" || echo NA) ==="

for i in $(seq 1 $N); do
  echo
  echo "########## RELAUNCH $i/$N ##########"
  # --- quit both apps (full relaunch — matches the crash repro) ---
  osascript -e 'tell application id "com.papercusp.gui" to quit' 2>/dev/null
  osascript -e 'tell application id "com.papercusp.server" to quit' 2>/dev/null
  sleep 4
  pkill -f 'Papercusp GUI.app/Contents/MacOS' 2>/dev/null
  pkill -f 'Papercusp Server.app/Contents/MacOS' 2>/dev/null
  pkill -f 'Papercusp Server.app/Contents/Resources/sidecar' 2>/dev/null
  sleep 4
  echo "after quit: gui pid=$(guipid) (expect empty); procs=$(ps aux | grep -icE '[P]apercusp')"

  # --- record gui.log offset BEFORE launch (app quit → file idle) ---
  OFF=$( [ -f "$GUILOG" ] && wc -c < "$GUILOG" | tr -d ' ' || echo 0 )

  # --- relaunch ---
  echo "open GUI (offset=$OFF)..."
  open "/Applications/Papercusp GUI.app"

  # --- wait for operator boot (proves it got far enough to matter), up to 120s ---
  OPPORT=""
  for t in $(seq 1 60); do
    sleep 2
    OPPORT=$(ophealth)
    [ -n "$OPPORT" ] && { echo "operator UP on :$OPPORT after ~$((t*2))s"; break; }
    # if GUI already died, stop waiting — it crashed
    [ -z "$(guipid)" ] && { echo "!! GUI process GONE at ~$((t*2))s — likely crashed"; break; }
  done

  # settle past the webview-URL race window, then assert
  sleep 6
  GP=$(guipid)
  if [ -f "$GUILOG" ]; then NEWPANIC=$(tail -c +$((OFF+1)) "$GUILOG" | grep -c 'panicked at'); else NEWPANIC=0; fi
  echo "--- iteration $i result: GUI pid='$GP'  operator=':${OPPORT:-DOWN}'  new_wry_panics=$NEWPANIC ---"
  if [ -n "$GP" ] && [ "$NEWPANIC" = "0" ]; then
    echo "✅ RELAUNCH $i: GUI ALIVE, no panic"
    PASS=$((PASS+1))
  else
    echo "❌ RELAUNCH $i: FAILED (pid='$GP', new_panics=$NEWPANIC)"
    echo "--- newly appended gui.log this iteration ---"
    [ -f "$GUILOG" ] && tail -c +$((OFF+1)) "$GUILOG" | grep -A2 -iE 'panic|wry' | head -20
  fi
done

echo
echo "================ VERDICT ================"
echo "RELAUNCHES SURVIVED: $PASS / $N"
if [ "$PASS" = "$N" ]; then
  echo "✅✅✅ WI-3139 FIX CONFIRMED — GUI survives all relaunches (was 0/$N before fix)"
else
  FAILURES=$((N-PASS))
  echo "⚠ FIX INCOMPLETE — $FAILURES/$N relaunch(es) still failed"
fi
echo "=== final gui.log tail ==="; tail -6 "$GUILOG" 2>/dev/null
emit_verdict

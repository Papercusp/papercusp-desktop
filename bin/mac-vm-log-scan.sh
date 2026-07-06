#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# WI-3133 dim-6 / WI-3139 corroboration: scan EVERY app log surface for panics
# and hard errors after a run. Run AFTER the relaunch verification so the logs
# reflect the fixed build's steady state. Bounded, read-only, single-shot.
set +e
LOGDIR="$HOME/.papercusp/logs"
echo "=== log surfaces present ==="
ls -la "$LOGDIR" 2>/dev/null | tail -n +2
echo

# Rust panics anywhere = hard fail (this is what WI-3139 was).
echo "=== (A) RUST PANICS across all logs (must be 0) ==="
PANICS=$(grep -rEl "panicked at|thread '.*' panicked" "$LOGDIR" 2>/dev/null)
if [ -n "$PANICS" ]; then
  echo "❌ PANICS FOUND in: $PANICS"
  grep -rEn "panicked at|thread '.*' panicked" "$LOGDIR" 2>/dev/null | tail -20
else
  echo "✅ no rust panics in any log"
fi
echo

# operator/gateway/gui hard errors (filter known-benign noise).
echo "=== (B) hard ERROR/FATAL lines (excluding known-benign) ==="
grep -rEn "FATAL|Error:|ERROR|unhandledRejection|uncaughtException|EADDRINUSE|MODULE_NOT_FOUND" "$LOGDIR" 2>/dev/null \
  | grep -viE "fatal: not a git repository|\[durable-spawn\] HTTP 400|favicon|DevTools|deprecat" \
  | tail -30
echo "(above = residual errors to eyeball; empty = clean)"
echo

# crash/exit markers for the GUI + server processes.
echo "=== (C) unexpected process-exit / crash markers ==="
grep -rEn "abort trap|Segmentation|SIGSEGV|SIGABRT|crashed|exited with code [1-9]|non-zero exit" "$LOGDIR" 2>/dev/null | tail -15
echo "(empty = no crash markers)"
echo

# macOS-level crash reports for our binary (DiagnosticReports).
echo "=== (D) macOS crash reports for papercusp-desktop (last 3) ==="
ls -t "$HOME/Library/Logs/DiagnosticReports/"*papercusp* 2>/dev/null | head -3 || echo "(none — good)"
echo "=== DONE log-scan ==="

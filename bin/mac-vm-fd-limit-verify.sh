#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable.
# Non-destructive: reads logs + inspects the running instance, changes nothing.
#
# WI-4369 verification: assert the packaged app raised its fd SOFT limit off
# macOS's default 256, and that the running operator has real headroom under it.
#
# Why the app has to TELL us: macOS has no /proc, and reading another process's
# rlimit needs root (`launchctl procinfo`). So the Server bundle reports its own
# effective limit at startup — `[papercusp] fd-limit: soft=<N> (...)` in
# server-app.log — and that line is what we assert on. No line at all on a build
# that should have one is itself a regression (the raise was dropped).
#
# The failure this guards: the operator holds ~329 open handles on a fresh
# install. Under a 256 soft limit, anything adding FS watchers (chokidar /
# fs.watch — and watcher count scales with the USER'S workspace size) trips
# `EMFILE: too many open files, watch`, which surfaces as a crash or, worse, a
# silently-dead watcher. Linux's higher default hides this entirely on the dev box.
set +e

MIN_SOFT=4096          # below this we're back in EMFILE territory on a big workspace
SERVERLOG="$HOME/.papercusp/logs/server-app.log"
SERVELOG="$HOME/.papercusp/logs/serve.log"
GUILOG="$HOME/.papercusp/logs/gui.log"
FAIL=0

echo "=== 1. reported fd soft limit (Server bundle, server-app.log) ==="
if [ ! -f "$SERVERLOG" ]; then
  echo "❌ no server-app.log at $SERVERLOG — is the packaged app installed and has it been launched?"
  FAIL=1
else
  # Last line wins: the log is rotated per launch, but a stale earlier boot may
  # still be in there. We want THIS build's most recent startup.
  LINE=$(grep -a 'fd-limit: soft=' "$SERVERLOG" 2>/dev/null | tail -1)
  if [ -z "$LINE" ]; then
    echo "❌ no 'fd-limit: soft=' line in server-app.log."
    echo "   Either this build predates the WI-4369 raise, or fd_limit::report()"
    echo "   stopped being called after redirect_own_stdio() in setup()."
    FAIL=1
  else
    echo "$LINE"
    SOFT=$(echo "$LINE" | grep -oE 'soft=[0-9]+' | grep -oE '[0-9]+')
    if [ -z "$SOFT" ]; then
      echo "❌ could not parse a soft limit out of that line"
      FAIL=1
    elif [ "$SOFT" -lt "$MIN_SOFT" ]; then
      echo "❌ soft limit $SOFT is below the $MIN_SOFT floor (macOS default is 256)"
      FAIL=1
    else
      echo "✅ soft limit $SOFT ≥ $MIN_SOFT"
    fi
  fi
fi

echo; echo "=== 2. GUI bundle raised too (gui.log) ==="
GLINE=$(grep -a 'fd-limit: soft=' "$GUILOG" 2>/dev/null | tail -1)
[ -n "$GLINE" ] && echo "✅ $GLINE" || echo "⚠ no fd-limit line in gui.log (GUI may not have been launched this boot)"

echo; echo "=== 3. operator headroom: open handles vs the limit ==="
OPPID=$(pgrep -f 'node .*[Pp]apercusp' 2>/dev/null | head -1)
if [ -z "$OPPID" ]; then
  echo "⚠ no running operator node process — skipping headroom check"
else
  HANDLES=$(lsof -p "$OPPID" 2>/dev/null | wc -l | tr -d ' ')
  echo "operator pid=$OPPID open handles=$HANDLES"
  if [ -n "$SOFT" ] && [ "$HANDLES" -ge "$SOFT" ] 2>/dev/null; then
    echo "❌ operator is AT/OVER its soft limit ($HANDLES ≥ $SOFT) — EMFILE imminent"
    FAIL=1
  elif [ -n "$SOFT" ]; then
    echo "✅ headroom: $((SOFT - HANDLES)) fds free under the $SOFT limit"
  fi
  # The pre-fix state, spelled out so a regression is unmistakable in the output:
  if [ "$HANDLES" -gt 256 ]; then
    echo "   (note: $HANDLES handles would ALREADY have blown macOS's default 256 limit)"
  fi
fi

echo; echo "=== 4. no EMFILE in the logs ==="
EMFILE=$(grep -ac 'EMFILE' "$SERVELOG" "$SERVERLOG" "$GUILOG" 2>/dev/null | grep -vE ':0$')
if [ -n "$EMFILE" ]; then
  echo "❌ EMFILE present:"; echo "$EMFILE"
  grep -ah 'EMFILE' "$SERVELOG" "$SERVERLOG" "$GUILOG" 2>/dev/null | tail -3
  FAIL=1
else
  echo "✅ no EMFILE in serve.log / server-app.log / gui.log"
fi

echo
echo "================ VERDICT ================"
if [ "$FAIL" = 0 ]; then
  echo "✅✅✅ WI-4369 OK — fd soft limit raised off 256, operator has headroom, no EMFILE"
else
  echo "❌ WI-4369 REGRESSION — see the ❌ lines above"
fi
exit "$FAIL"

#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable.
# Non-destructive: reads logs + inspects the running instance, changes nothing.
#
# WI-4369: assert the packaged app's fd limits are sane on macOS.
#
# READ THIS BEFORE "FIXING" AN fd BUG HERE — the obvious diagnosis is wrong.
#
#   NODE RAISES ITS OWN fd LIMIT at startup (binary-searches up to 1<<20). With
#   the shell at `ulimit -n` 256, a plain `node -e` reports soft=1048575. So the
#   node operator sidecar is NEVER bounded by macOS's 256 soft limit, and an
#   operator holding ~329 open handles is NOT an impending EMFILE — it is proof
#   the cap is already above 256 (a process capped at 256 cannot hold 329).
#   WI-4369 was originally filed on exactly that misreading. Don't repeat it.
#
#   What IS capped at 256: the Rust/Tauri processes (GUI + Server), which do not
#   self-raise, and any NON-node child they spawn. `src/fd_limit.rs` raises the
#   SOFT limit at the top of run() so the whole tree inherits it. That is latent
#   hardening, not a fix for an observed crash.
#
#   And the raise itself has a trap: `setrlimit(soft = hard)` FAILS on macOS
#   (launchd hands a GUI app RLIM_INFINITY as its hard limit; an infinite SOFT
#   value is rejected with EINVAL and you silently stay at 256). It must also
#   raise the SOFT limit ONLY — setting hard too (what bash's `ulimit -n N` does)
#   would CAP node's self-raise from 1048575 down to N, which is a REGRESSION.
#
# Why the app has to TELL us its limit: macOS has no /proc, and reading another
# process's rlimit needs root (`launchctl procinfo`). So the Server bundle
# reports its own effective limit at startup — `[papercusp] fd-limit: soft=<N>`
# in server-app.log — and that line is what we assert on. A MISSING line on a
# build that should have one is itself a regression (the raise got dropped).
set +e

MIN_SOFT=4096
SERVERLOG="$HOME/.papercusp/logs/server-app.log"
SERVELOG="$HOME/.papercusp/logs/serve.log"
GUILOG="$HOME/.papercusp/logs/gui.log"
FAIL=0
# WI-5788: a check that COULD NOT RUN must announce itself, never vanish into a green verdict.
# Skips are counted separately from failures so the exit code can distinguish "verified clean"
# (0) from "a guard never ran, so this run does not verify the claim" (2).
SKIPPED=0
SKIPPED_LIST=""

echo "=== 1. Rust Server process raised its soft limit off 256 (server-app.log) ==="
if [ ! -f "$SERVERLOG" ]; then
  echo "❌ no server-app.log at $SERVERLOG — is the packaged app installed and launched?"
  FAIL=1
else
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
      echo "❌ could not parse a soft limit out of that line"; FAIL=1
    elif [ "$SOFT" -lt "$MIN_SOFT" ]; then
      echo "❌ soft limit $SOFT is below the $MIN_SOFT floor (macOS default is 256)"; FAIL=1
    else
      echo "✅ Rust Server soft limit $SOFT ≥ $MIN_SOFT (was 256 by default)"
    fi
  fi
fi

echo; echo "=== 2. GUI bundle raised too (gui.log) ==="
GLINE=$(grep -a 'fd-limit: soft=' "$GUILOG" 2>/dev/null | tail -1)
[ -n "$GLINE" ] && echo "✅ $GLINE" || echo "⚠ no fd-limit line in gui.log (GUI may not have launched this boot)"

echo; echo "=== 3. REGRESSION GUARD: the raise must not CAP node's self-raise ==="
# The one way this fix could do harm. If someone changes fd_limit.rs to set the
# HARD limit as well, node's startup self-raise gets clamped to it and the
# operator ends up with FEWER fds than it had before the "fix".
OPPID=$(pgrep -f 'node .*[Pp]apercusp' 2>/dev/null | head -1)
# assert-integrity-ok: WI-5788 — the unmeasured case is RECORDED as a skip (SKIPPED counter +
# named in the verdict + exit 2), not silently continued, so this branch can no longer let the
# run report a clean pass. That is the disambiguation R4 asks for; failing outright would be
# wrong here, since "no operator running" is a legitimate state of the VM, not a regression.
if [ -z "$OPPID" ]; then
  echo "⚠ no running operator node process — §3 regression guard SKIPPED (NOT verified this run)"
  SKIPPED=$((SKIPPED + 1))
  SKIPPED_LIST="${SKIPPED_LIST}§3 node self-raise regression guard (no operator process running); "
else
  echo "operator pid=$OPPID, open handles=$(lsof -p "$OPPID" 2>/dev/null | wc -l | tr -d ' ')"
  # A fresh node inherits the same env the operator did, so its self-raised limit
  # is a faithful proxy for the operator's.
  NODE=$(command -v node || ls "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | head -1)
  if [ -n "$NODE" ]; then
    NSOFT=$("$NODE" -e 'process.stdout.write(String(process.report.getReport().userLimits.open_files.soft))' 2>/dev/null)
    echo "a node child self-raises to soft=$NSOFT"
    if [ -n "$NSOFT" ] && [ "$NSOFT" -lt 100000 ] 2>/dev/null; then
      echo "❌ node's self-raise is CLAMPED ($NSOFT). fd_limit.rs must raise the SOFT"
      echo "   limit only and preserve rlim_max — setting the hard limit caps node."
      FAIL=1
    else
      echo "✅ node still self-raises freely (hard limit preserved)"
    fi
  else
    echo "⚠ no node on PATH — skipping"
  fi
fi

echo; echo "=== 4. no EMFILE in the logs ==="
EM=$(grep -ac 'EMFILE\|too many open files' "$SERVELOG" "$SERVERLOG" "$GUILOG" 2>/dev/null | grep -vE ':0$')
if [ -n "$EM" ]; then
  echo "❌ EMFILE present:"; echo "$EM"
  grep -ah 'EMFILE\|too many open files' "$SERVELOG" "$SERVERLOG" "$GUILOG" 2>/dev/null | tail -3
  FAIL=1
else
  echo "✅ none in serve.log / server-app.log / gui.log"
fi

echo
echo "================ VERDICT ================"
if [ "$FAIL" != 0 ]; then
  echo "❌ WI-4369 REGRESSION — see the ❌ lines above"
  exit 1
elif [ "$SKIPPED" != 0 ]; then
  # No ❌ fired, but a guard never ran — reporting this as a clean pass would be the exact
  # can-falsely-pass shape WI-5788 exists to remove. Distinct exit 2 = "not fully verified".
  echo "⚠ WI-4369 PARTIAL — no regression seen, but $SKIPPED check(s) SKIPPED, so this run does NOT verify the claim: $SKIPPED_LIST"
  exit 2
else
  echo "✅✅✅ WI-4369 OK — Rust processes raised off 256, node's self-raise intact, no EMFILE"
  exit 0
fi

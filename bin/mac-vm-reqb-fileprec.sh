#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# DECISIVE REQ B test: does `claude` honor $CLAUDE_CONFIG_DIR/.credentials.json (a FILE) on macOS,
# or only the login Keychain? Uses THIS box's VALID bundle (proven working via the gateway) so a
# "works" result means file-precedence; a "/login" result means keychain-only. No Keychain ACL needed.
# Keep both controls observable, then return a real verdict.  Printing a result
# while exiting 0 made this verification unusable as release evidence.
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
  echo "VERDICT: PASS (REQ-B file precedence confirmed)"
  echo "=========================================="
  exit 0
}

CLAUDE=$(find "/Applications/Papercusp Server.app/Contents/Resources/sidecar/meridian-host/node_modules/@anthropic-ai/claude-code-darwin-x64" -name claude -type f 2>/dev/null | head -1)
echo "CLAUDE=$CLAUDE"
if [ -x "$CLAUDE" ]; then
  echo "version: $("$CLAUDE" --version 2>&1 | head -1)"
  pass "bundled Claude executable is present"
else
  echo "version: unavailable"
  fail "bundled Claude executable is missing"
fi

DIR=/tmp/cctest-reqb
rm -rf "$DIR"; mkdir -p "$DIR"
cp /tmp/gwcred.json "$DIR/.credentials.json" 2>/dev/null
chmod 600 "$DIR/.credentials.json"
echo "seeded fork creds bytes=$(wc -c < "$DIR/.credentials.json" 2>/dev/null)"
if [ -s "$DIR/.credentials.json" ]; then pass "fork credentials file is present"; else fail "fork credentials file is missing or empty"; fi

echo "=== A. claude -p with CLAUDE_CONFIG_DIR fork holding a VALID file bundle ==="
if [ -x "$CLAUDE" ]; then
  OUT=$(CLAUDE_CONFIG_DIR="$DIR" HOME=/tmp/cctest-home-reqb "$CLAUDE" -p "Reply with exactly: CCFILE-OK" --model claude-haiku-4-5-20251001 2>&1)
else
  OUT=""
fi
echo "$OUT" | sed -E "s/sk-ant-[A-Za-z0-9_-]{8,}/sk-ant-[REDACTED]/g" | head -20
echo "--- exit signal: contains CCFILE-OK? ---"
if echo "$OUT" | grep -q "CCFILE-OK"; then
  echo "RESULT=FILE_PRECEDENCE_CONFIRMED (claude read the fork file)"
  pass "Claude honored the fork credentials file"
else
  echo "RESULT=NOT_FROM_FILE (login/err — see output above)"
  fail "Claude did not return CCFILE-OK from the fork credentials file"
fi

echo; echo "=== B. control: SAME but with NO creds file in the fork (empty fork) ==="
DIR2=/tmp/cctest-reqb-empty; rm -rf "$DIR2"; mkdir -p "$DIR2"
if [ -x "$CLAUDE" ]; then
  OUT2=$(CLAUDE_CONFIG_DIR="$DIR2" HOME=/tmp/cctest-home-reqb2 "$CLAUDE" -p "Reply with exactly: CCFILE-OK" --model claude-haiku-4-5-20251001 2>&1)
else
  OUT2=""
fi
echo "$OUT2" | sed -E "s/sk-ant-[A-Za-z0-9_-]{8,}/sk-ant-[REDACTED]/g" | head -12
if echo "$OUT2" | grep -q "CCFILE-OK"; then
  fail "empty fork unexpectedly produced CCFILE-OK"
else
  pass "empty fork did not produce a file-credential success"
fi

echo; echo "=== cleanup ==="
rm -rf "$DIR" "$DIR2" /tmp/cctest-home-reqb /tmp/cctest-home-reqb2
echo done
emit_verdict

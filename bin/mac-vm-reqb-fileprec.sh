#!/bin/bash
# Run ON the Mac VM directly (ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -s' < FILE),
# or from a checkout already rsynced there (mac-verify-build.sh does this rsync). Idempotent / re-runnable
# unless noted DESTRUCTIVE below.
# DECISIVE REQ B test: does `claude` honor $CLAUDE_CONFIG_DIR/.credentials.json (a FILE) on macOS,
# or only the login Keychain? Uses THIS box's VALID bundle (proven working via the gateway) so a
# "works" result means file-precedence; a "/login" result means keychain-only. No Keychain ACL needed.
set +e
CLAUDE=$(find "/Applications/Papercusp Server.app/Contents/Resources/sidecar/meridian-host/node_modules/@anthropic-ai/claude-code-darwin-x64" -name claude -type f 2>/dev/null | head -1)
echo "CLAUDE=$CLAUDE"
echo "version: $("$CLAUDE" --version 2>&1 | head -1)"

DIR=/tmp/cctest-reqb
rm -rf "$DIR"; mkdir -p "$DIR"
cp /tmp/gwcred.json "$DIR/.credentials.json" 2>/dev/null
chmod 600 "$DIR/.credentials.json"
echo "seeded fork creds bytes=$(wc -c < "$DIR/.credentials.json" 2>/dev/null)"

echo "=== A. claude -p with CLAUDE_CONFIG_DIR fork holding a VALID file bundle ==="
OUT=$(CLAUDE_CONFIG_DIR="$DIR" HOME=/tmp/cctest-home-reqb "$CLAUDE" -p "Reply with exactly: CCFILE-OK" --model claude-haiku-4-5-20251001 2>&1)
echo "$OUT" | sed -E "s/sk-ant-[A-Za-z0-9_-]{8,}/sk-ant-[REDACTED]/g" | head -20
echo "--- exit signal: contains CCFILE-OK? ---"
echo "$OUT" | grep -q "CCFILE-OK" && echo "RESULT=FILE_PRECEDENCE_CONFIRMED (claude read the fork file)" || echo "RESULT=NOT_FROM_FILE (login/err — see output above)"

echo; echo "=== B. control: SAME but with NO creds file in the fork (empty fork) ==="
DIR2=/tmp/cctest-reqb-empty; rm -rf "$DIR2"; mkdir -p "$DIR2"
OUT2=$(CLAUDE_CONFIG_DIR="$DIR2" HOME=/tmp/cctest-home-reqb2 "$CLAUDE" -p "Reply with exactly: CCFILE-OK" --model claude-haiku-4-5-20251001 2>&1)
echo "$OUT2" | sed -E "s/sk-ant-[A-Za-z0-9_-]{8,}/sk-ant-[REDACTED]/g" | head -12

echo; echo "=== cleanup ==="
rm -rf "$DIR" "$DIR2" /tmp/cctest-home-reqb /tmp/cctest-home-reqb2
echo done

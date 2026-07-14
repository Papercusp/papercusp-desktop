#!/usr/bin/env bash
# UserPromptSubmit hook — TURN-START CTRL TRANSITION + MEMORY DELTA
# (agent-operability P-014; memory-delivery-unification P-003a).
#
# On every submitted prompt in a psu session, fetch the next one-shot compact
# CTRL transition plus a SMALL high-precision memory delta from the local
# operator (/api/agent-mcp/turn-start-memory):
# the one admission pipeline runs with queryContext = this prompt, under the
# session-epoch dedup (P-002, port 'turn-start') — so anything already
# surfaced this epoch (the initialize prelude, an orient recall, a claim
# port) is never re-paid, and only NEWLY-relevant memories land.
#
# Posture (mirrors the provenance hook): psu sessions only (PAPERCUSP_SID),
# FAIL-OPEN — never blocks a prompt, never exits non-zero, hard 2.5s wall so
# a slow/down operator costs nothing but this hook's own silence. Unlike the
# provenance hook this one DOES call the operator (an embed cannot be local);
# that is why it is a SEPARATE hook — provenance stays local-only by design.
#
# PAPERCUSP_TURN_START_MEMORY=off disables only memory recall. CTRL transitions
# remain enabled: a memory preference must never hide a safety-critical mode /
# loop / route transition.

set -euo pipefail

if [ -z "${PAPERCUSP_SID:-}" ]; then
  exit 0
fi
INPUT=$(cat)

# Fail-open backstop: any uncaught crash injects nothing and allows the turn.
python3 - "$PAPERCUSP_SID" "$INPUT" <<'PYEOF' || exit 0
import json, os, sys, urllib.request

sid, raw = sys.argv[1], sys.argv[2]
try:
    data = json.loads(raw)
except Exception:
    sys.exit(0)
prompt = data.get('prompt') or ''
if not isinstance(prompt, str):
    sys.exit(0)

base = (os.environ.get('PAPERCUSP_OPERATOR_URL') or 'http://localhost:3070').rstrip('/')
body = json.dumps({
    'owner': sid,
    'prompt': prompt[:4000],
    'workspace': os.environ.get('PAPERCUSP_WORKSPACE') or '',
    'harness': os.environ.get('PAPERCUSP_HARNESS_SLUG') or '',
    'memoryEnabled': os.environ.get('PAPERCUSP_TURN_START_MEMORY', 'on') != 'off',
}).encode('utf-8')

# localhost operator: never via egress http(s)_proxy (502s the local call).
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))
req = urllib.request.Request(
    base + '/api/agent-mcp/turn-start-memory',
    data=body,
    headers={'Content-Type': 'application/json'},
    method='POST',
)
try:
    with urllib.request.urlopen(req, timeout=2.5) as res:
        payload = json.loads(res.read().decode('utf-8'))
except Exception:
    sys.exit(0)

text = payload.get('text') if isinstance(payload, dict) else ''
if not isinstance(text, str) or not text.strip():
    sys.exit(0)

print(json.dumps({
    'hookSpecificOutput': {
        'hookEventName': 'UserPromptSubmit',
        'additionalContext': text,
    },
}))
PYEOF

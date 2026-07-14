#!/usr/bin/env bash
# SessionStart / SessionEnd hook — report a worker's session LIFECYCLE into the
# cross-CLI ACTIVITY BRIDGE (papercusp-worker-integration-2026-06-04, D-003). The
# lifecycle counterpart of posttooluse-activity-report.sh: a crisp "worker appeared /
# left" marker (kind='lifecycle') for the pui fleet view, rather than inferring it
# from activity silence.
#
# SHARED by Claude AND Codex (the cc/ contract). One script handles both events: it
# reads `hook_event_name` from stdin (SessionStart → "▶ session started";
# SessionEnd / Stop → "■ session ended"). Same psu-gate + DETACHED fire-and-forget +
# fail-open + always-empty-stdout discipline as the activity hook.
#
# Attached: Claude `SessionStart` + `SessionEnd` settings.json entries; Codex
# hooks.json (best-effort — codex's lifecycle event coverage is a subset, so it's
# inert if codex doesn't fire them, which is fine).

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"

if [ -z "${PAPERCUSP_SID:-}" ] || [ ! -s "$TOKEN_PATH" ]; then
  exit 0
fi

TOKEN=$(cat "$TOKEN_PATH")
INPUT=$(cat)
AGENT="${PAPERCUSP_AGENT:-}"

report() {
  python3 - "$INPUT" "$OPERATOR_URL" "$TOKEN" "$PAPERCUSP_SID" "$AGENT" <<'PYEOF'
import json, sys, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

raw, operator_url, token, owner, agent = sys.argv[1:6]
HTTP_TIMEOUT = 3

try:
    ev = json.loads(raw)
except Exception:
    sys.exit(0)
if not isinstance(ev, dict):
    sys.exit(0)

name = (ev.get('hook_event_name') or ev.get('hookEventName') or '').strip()
# Map the event → a lifecycle summary. SessionStart = appeared; SessionEnd / Stop =
# left. Anything else: ignore (we only mark the two endpoints).
if name == 'SessionStart':
    summary = '▶ session started'
elif name in ('SessionEnd', 'Stop'):
    summary = '■ session ended'
else:
    sys.exit(0)

args = {
    'owner': owner,
    'kind': 'lifecycle',
    'summary': summary,
    'session_id': ev.get('session_id') or ev.get('sessionId') or '',
    'cwd': ev.get('cwd') or '',
}
if agent:
    args['agent'] = agent

body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
                   'params': {'name': 'activity:report', 'arguments': args}}).encode()
req = urllib.request.Request(
    operator_url.rstrip('/') + '/api/mcp?superuser=1&client=' + urllib.parse.quote(owner, safe=''),
    data=body,
    headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json',
             'Accept': 'application/json, text/event-stream'},
    method='POST')
try:
    urllib.request.urlopen(req, timeout=HTTP_TIMEOUT).read()
except Exception:
    sys.exit(0)
PYEOF
}

if [ -n "${PAPERCUSP_ACTIVITY_SYNC:-}" ]; then
  report >/dev/null 2>&1 || true
else
  ( report >/dev/null 2>&1 & ) >/dev/null 2>&1 || true
fi
exit 0

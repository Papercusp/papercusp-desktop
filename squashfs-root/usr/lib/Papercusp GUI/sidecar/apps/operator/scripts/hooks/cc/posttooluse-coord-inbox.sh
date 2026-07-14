#!/usr/bin/env bash
# PostToolUse hook — surface NEW coord:inbox messages to a psu agent
# mid-turn, riding the agent's own tool cadence instead of asking the
# model to remember to poll. Fires after EVERY tool call (matcher "*"),
# so an agent learns about a peer's message before its NEXT step rather
# than only at session start.
#
# Why a hook and not a prompt instruction: an LLM has no reliable
# wall-clock sense between tool calls and silently drops "check every N
# minutes" discipline. The system riding the tool stream is the reliable
# realization of "check often" — see the design discussion in the SU
# engineer playbook / agent-insights. NO throttle by request: we always
# run the check; the cost is one indexed coord:inbox round-trip to the
# local operator per tool call, and we fail open fast.
#
# Scope guard: runs ONLY in a psu session (PAPERCUSP_SID set + su-token
# present). A plain `claude`/`codex` in any other repo on this machine —
# even with the su-token installed — has no PAPERCUSP_SID, so it bails
# instantly. owner == PAPERCUSP_SID, the SAME id the -su wrapper bakes
# into the agent's MCP `?client=`, so the hook reads the right inbox.
#
# Dedup: a per-owner local cursor (coord-cursor-<owner>.json) holds the
# last-seen ts. FIRST run seeds the cursor to "now" and injects NOTHING
# (existing inbox is already shown at session start); only messages that
# arrive AFTER then are injected, exactly once. The cursor is keyed by
# PAPERCUSP_SID (per-launch), so a fresh session never re-shows old mail
# — no PG watermark round-trip needed here.
#
# Output contract (Claude Code PostToolUse): exit 0 with
#   { "hookSpecificOutput": { "hookEventName": "PostToolUse",
#       "additionalContext": "..." } }
# injects context for the model's next step WITHOUT a `decision` (so the
# tool result stands and the model is not stopped). Exit 0 + no stdout =
# no-op. We NEVER block a tool and NEVER exit non-zero on coord trouble.

set -euo pipefail

OPERATOR_URL="${PAPERCUSP_OPERATOR_URL:-http://localhost:3070}"
TOKEN_PATH="${HOME}/.papercusp/superuser-token"
CACHE_DIR="${PAPERCUSP_LOCKS_CACHE_DIR:-${HOME}/.papercusp/locks-cache}"

# psu-session gate + install gate. PAPERCUSP_SID is exported only by the
# `-su` launch wrapper; its absence means "not a psu session" → do nothing.
if [ -z "${PAPERCUSP_SID:-}" ] || [ ! -s "$TOKEN_PATH" ]; then
  exit 0
fi

mkdir -p "$CACHE_DIR"
chmod 700 "$CACHE_DIR" 2>/dev/null || true

TOKEN=$(cat "$TOKEN_PATH")
INPUT=$(cat)

# Fail-open backstop: any uncaught crash in the body ALLOWS the turn to
# proceed with no injection (a coord blip must never wedge a tool).
python3 - "$INPUT" "$OPERATOR_URL" "$TOKEN" "$PAPERCUSP_SID" "$CACHE_DIR" <<'PYEOF' || exit 0
import json, os, re, sys, time, urllib.request, urllib.parse
urllib.request.install_opener(urllib.request.build_opener(urllib.request.ProxyHandler({})))  # localhost operator: never via egress http(s)_proxy (502s the local call -> false fail-open)

raw, operator_url, token, owner, cache_dir = sys.argv[1:6]

# Connect timeout kept short: this runs after every tool call, so a slow
# or restarting operator must not add latency. No retry (cf. the lock
# hook's restart retry) — a missed coord check is harmless; it lands on
# the next tool call.
HTTP_TIMEOUT = 4
# Capping / formatting now live server-side in coord:inbox's `injection`
# renderer (the hook is a dumb pipe), so no per-hook caps here.


def now_iso():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def cursor_path():
    safe = re.sub(r'[^A-Za-z0-9._-]', '_', owner)[:120]
    return os.path.join(cache_dir, f'coord-cursor-{safe}.json')


def read_cursor():
    try:
        with open(cursor_path()) as f:
            v = json.load(f)
        s = v.get('since_ts')
        return s if isinstance(s, str) and s else None
    except Exception:
        return None


def write_cursor(ts):
    try:
        p = cursor_path()
        tmp = p + '.tmp-' + str(os.getpid())
        with open(tmp, 'w') as f:
            f.write(json.dumps({'since_ts': ts}))
        os.replace(tmp, p)
    except Exception:
        pass


def noop():
    sys.exit(0)


# FIRST run this session: seed the cursor to now and inject nothing. The
# session-start coord:inbox (driven by the MCP server instructions) has
# already shown the existing backlog; we only want NEW arrivals.
since_ts = read_cursor()
if since_ts is None:
    write_cursor(now_iso())
    noop()


def call_inbox():
    args = {'since_ts': since_ts}
    body = json.dumps({
        'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call',
        'params': {'name': 'coord:inbox', 'arguments': args},
    }).encode()
    req = urllib.request.Request(
        operator_url.rstrip('/') + '/api/mcp?superuser=1&client='
        + urllib.parse.quote(owner, safe=''),
        data=body,
        headers={
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
        },
        method='POST',
    )
    resp = urllib.request.urlopen(req, timeout=HTTP_TIMEOUT)
    return resp.read().decode('utf-8', errors='replace')


try:
    raw_resp = call_inbox()
except Exception:
    noop()  # operator unreachable / slow → fail open, try again next tool.

# Parse the first JSON-RPC result from a JSON or text/event-stream body
# (mirrors the lock hook's SSE-tolerant parse).
result = None
for line in raw_resp.splitlines():
    line = line.strip()
    if not line or line.startswith('event:'):
        continue
    if line.startswith('data:'):
        line = line[5:].strip()
    try:
        cand = json.loads(line)
        if isinstance(cand, dict) and 'result' in cand:
            result = cand['result']
            break
    except Exception:
        pass

if not result:
    noop()

inner = None
for item in (result.get('content') or []):
    if item.get('type') == 'text':
        try:
            inner = json.loads(item['text'])
            break
        except Exception:
            continue

if not isinstance(inner, dict):
    noop()

entries = inner.get('entries')
if not isinstance(entries, list) or not entries:
    # No NEW coord entries. agent-managed-compaction P-015: still surface the ≥80% LOUD
    # context gauge so a heads-down session (native Bash/Read/Edit only, which never calls
    # a coord tool) sees its own usage — the zero-new-mail / zero-MCP-call gap that caused
    # the 2026-07-02 auto-compaction (EI-6597). Server-rendered (`context_gauge`), so this
    # stays a dumb pipe; below 80% it is null and we no-op exactly as before. No cursor
    # advance here (there are no entries to mark shown).
    gauge = inner.get('context_gauge')
    if isinstance(gauge, str) and gauge.strip():
        json.dump({'hookSpecificOutput': {
            'hookEventName': 'PostToolUse',
            'additionalContext': gauge,
        }}, sys.stdout)
    sys.exit(0)

# Advance the cursor past EVERY returned entry (not just the rendered ones) so a
# message is never injected twice. `summary.newest_ts` is the server's max-ts
# over the returned set; fall back to iterating entries if absent.
summary = inner.get('summary') or {}
newest = summary.get('newest_ts') if isinstance(summary, dict) else None
if not (isinstance(newest, str) and newest):
    newest = since_ts
    for e in entries:
        ts = e.get('ts')
        if isinstance(ts, str) and ts > newest:
            newest = ts
write_cursor(newest)

# DUMB PIPE (token-efficient-coord-injection D-003/P-008): the server renders the
# positional `[coord+N]` block once (coord-schema.renderInjection); this hook just
# echoes it into Claude's additionalContext + keeps the cursor. The glyph key +
# footer live once in the psu prompt legend, not per-injection — so no formatting,
# capping, or footer here.
injection = inner.get('injection')
if not isinstance(injection, str) or not injection.strip():
    noop()

json.dump({'hookSpecificOutput': {
    'hookEventName': 'PostToolUse',
    'additionalContext': injection,
}}, sys.stdout)
sys.exit(0)
PYEOF

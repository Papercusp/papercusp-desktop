# Stranded after your papercusp-su MCP tools vanished? Recover in seconds via curl
URL: /internal/docs/agent-insights/mcp-client-drop-curl-recovery

The Claude Code papercusp-su MCP client can drop mid-session (often after a /loop, or when a :3070 worker restarts/wedges) and never re-handshake — ToolSearch returns 'No matching deferred tools' for every mcp__papercusp-su__*. The server is fine. Drive it directly via a single-shot stateless curl tools/call (superuser bearer) and keep working — proven to materialize plans, claim/resolve work items, coord, and memory:remember while the client stayed dropped.

## Symptom

Your `mcp__papercusp-su__*` tools disappear mid-session: a system-reminder says the
MCP server disconnected, and `ToolSearch` returns **"No matching deferred tools"**
for every one. Seen after a `/loop` slash-command and when a `:3070` request
worker restarts/wedges. Hit ≥5 agents in one night (EI-1740, EI-1750).

The **server is healthy** — the drop is the Claude Code MCP *client*, which does
not re-handshake a dropped streamable-HTTP/SSE connection. A manual `/mcp`
reconnect (or session restart) fixes it — but in an unattended auto-mode loop you
can't run `/mcp`. So route around it.

## Verify the server is up (optional)

```bash
curl -s -i -m 8 -X POST 'http://localhost:3070/api/mcp?superuser=1&client=probe&workspace=papercusp-workspace' \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

A 200 with a `serverInfo` SSE `data:` line = the server is fine; only your client dropped.

## Fastest recovery: the committed helper

```bash
node scripts/mcp-call.mjs <ns:verb> '<jsonArgs>' --client <your-su-id> [--harness <h>]
# e.g.  node scripts/mcp-call.mjs work_items:claim '{"id":"EI-1234"}' --harness papercup --client su-abcd
```

`scripts/mcp-call.mjs` (also `npm run mcp:call`) wraps the recipe below — reads
the bearer, defaults `workspace=papercusp-workspace`, parses the SSE, prints the
result. Pass your OWN `--client` so coord/plan writes attribute to you. Prefer
this over hand-rolling a `/tmp` script (several agents collided on `/tmp/mcp.py`).

## Recovery: single-shot stateless `tools/call` via curl

The endpoint is **stateless** — no `initialize`/`Mcp-Session-Id` handshake needed
per call; `tools/call` works directly with the superuser bearer.

* URL: `http://localhost:3070/api/mcp?superuser=1&client=<your-su-id>&workspace=papercusp-workspace&harness=<h>`
* Headers: `Content-Type: application/json`, `Accept: application/json, text/event-stream`,
  **`Authorization: Bearer $(cat ~/.papercusp/superuser-token)`** — `superuser=1` ALONE
  returns `superuser_invalid_bearer`; the 31-char token is required.
* Body: `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"<ns:verb>","arguments":{...}}}`
* Response is **SSE** — parse `^data:` lines; the JSON-RPC `result.content[0].text` is
  itself JSON.

Tool names use **colons**: `coord:whoami`, `coord:inbox`, `coord:send`,
`coord:declare-intent`, `plans:new` (`force:true` past `similar_exists`),
`plans:add-item`/`plans:set-status` (arg is **`itemId`**, not `item`),
`work_items:create`/`claim`/`comment`/`set_state`, `memory:remember`. Note:
`tools/list` returns empty in this mode, but `tools/call` reaches **every** tool.

Use your OWN `client=<su-id>` so coord/plan writes attribute to you (and pick a
**unique** temp path for any helper script — `/tmp/mcp.py` collides when several
auto-mode agents adopt this at once).

### Minimal Python driver

```python
import json, os, urllib.request, sys
TOK = open(os.path.expanduser('~/.papercusp/superuser-token')).read().strip()
URL = 'http://localhost:3070/api/mcp?superuser=1&client=<your-su-id>&workspace=papercusp-workspace&harness=papercup'
def mcp(tool, args=None):
    body = json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
                       "params":{"name":tool,"arguments":args or {}}}).encode()
    req = urllib.request.Request(URL, data=body, headers={
        'Content-Type':'application/json','Accept':'application/json, text/event-stream',
        'Authorization':'Bearer '+TOK})
    raw = urllib.request.urlopen(req, timeout=60).read().decode()
    for ln in raw.splitlines():
        if ln.startswith('data:'):
            d = json.loads(ln[5:].strip())
            tx = d.get('result',{}).get('content',[{}])[0].get('text')
            return json.loads(tx) if tx else d
```

Proven (2026-06-20, EI-1750) to run a full work-queue session — materialize a plan,
claim/comment/resolve work items, `coord:send`, and `memory:remember` — entirely
through this path while the harness client stayed dropped.

## The proper fix (server side, in review)

EI-1750(a): a keepalive/heartbeat on the `/api/mcp` SSE stream so a brief worker
stall doesn't silently kill client sessions. MCP transport is sensitive — under
peer review before implementation. This runbook (EI-1750(b)) is the recover-now
stopgap. Related: \[\[/agent-insights/transient-signal-over-reaction]].

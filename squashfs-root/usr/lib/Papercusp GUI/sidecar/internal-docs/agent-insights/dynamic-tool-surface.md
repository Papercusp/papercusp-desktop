# The dynamic tool surface — small seed + expand on demand
URL: /internal/docs/agent-insights/dynamic-tool-surface

How a seeded MCP session grows its tool list at runtime (tools:find → tools/list_changed → client re-fetch) instead of choosing between focus, token cost, and reachability. Plus tools:invoke, the universal reachability hatch. Retires the "static ?tools= trim strands the long tail" caveat.

## The problem — a trilemma

The superuser MCP catalog is \~580 tools / \~140k tokens. Three costs compete, and
every **static** approach can only buy two:

1. **Reachability** — a client can only *call* a tool it received in `tools/list`
   (OMP returns `toolNotFound`; a trimmed session's `search_tool_bm25` returns
   only the received set).
2. **Token cost** — sending all \~580 schemas is \~140k tokens every turn — billed
   *and* attention-diluting — **even on a big-context model** (Codex).
3. **Focus** — a weak model handed \~580 choices hallucinates tool names.

Static `?tools=core` bought token+focus but stranded the \~530-tool tail. The full
catalog bought reachability but paid token+focus. **The dynamic surface buys all
three.**

## The mechanism — a growable seed

`?tools=<core spine>` on the MCP URL is no longer a hard cap; it's a **seed
floor** that grows at runtime:

1. **Seed.** `role-launch-spec` / `psu-launcher` bake `?tools=<CORE_MCP_TOOL_NAMES>`
   into the session's MCP URL. The core spine includes `tools:find` (discover) and
   `tools:invoke` (call-anything).
2. **Track.** On the first `tools/list`, `getSessionSurface(uiClientId, seed)`
   (`tool-allowlist.ts`) creates a **mutable per-session set**, keyed by the su
   session identity (`uiClientId` = `x-papercusp-client` header / `client=` / the
   transport session id). It's the floor for that connection.
3. **Grow.** When the model calls `tools:find("<intent>")`, the handler calls
   `ctx.activateTools(hits)` → `activateSessionTools` adds the matched names to the
   session set **and** fires `notifications/tools/list_changed`.
4. **Re-fetch.** A `listChanged`-capable client re-fetches `tools/list`,
   `getSessionSurface` returns the grown set, and the surfaced tools are now
   callable — natively, no indirection.

`MCP_SERVER_CAPABILITIES` declares `tools: { listChanged: true }` — the flag the
client checks before it will act on the notification.

### The universal hatch — `tools:invoke`

`tools:invoke { name, args }` dispatches to ANY projected tool server-side, under
the caller's OWN context (via `ctx.dispatchTool` → `dispatchProjectedToolToMcp`),
so it's gated **exactly** as a direct call — a router, not a privilege bypass. It
reaches the whole catalog even on a client that never grows its own tool list, so
`tools:find` (get the name+schema) → `tools:invoke` (call it) works regardless of
`list_changed` support.

## Per-client — heterogeneous by design

| Client     | Mechanism                                          | Notes                                                                                                                                                                                                                                      |
| ---------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OMP**    | dynamic surface (`list_changed`)                   | **Verified live**: `refreshServerTools` re-fetches on the notification, rebuilds + installs the callable set. Seeds by default (its weak-model default; `psu-launcher`).                                                                   |
| **Codex**  | seed + `tools:invoke` (+ dynamic if it re-fetches) | Seeds **by default on any tier** for the token-cost win (`role-launch-spec`, `input.agent==='codex'`). Recognizes `list_changed`; `tools:invoke` guarantees reachability regardless. `contextSize:'full'` opts back into the full catalog. |
| **Claude** | native **ToolSearch** — untouched                  | NOT default-seeded. ToolSearch is the same defer-then-activate pattern client-side and better for Claude (no round-trip). It never gets a seed on frontier tiers, so no `list_changed` is fired at it.                                     |

The mechanism is **gated by seed-presence**: no `?tools=` ⇒ `getSessionSurface`
returns `null` (full catalog, no surface tracked) ⇒ `activateSessionTools` no-ops
⇒ no notification. That's why Claude-on-frontier is automatically untouched.

## Verified (2026-07-01, live against :3170)

A full round-trip over the real streamable-HTTP transport:

* `capabilities.tools.listChanged === true`
* seeded `tools/list` = exactly the 3-tool seed
* `tools:find("set a feature flag")` → `activated:true`, surfaced `flags:set` + 4 more
* **`notifications/tools/list_changed` delivered on `tools:find`'s response stream** (the #1 risk — notifications ride the per-request event-stream, same as `emit`/`progress`; SSE transport stays disabled)
* re-fetched `tools/list` = 8 tools (3 seed + 5 surfaced)
* a mid-session-surfaced tool dispatched server-side (reachability end-to-end)

## Gotchas

* **The notification rides the per-request stream**, not a persistent SSE
  channel (`disableSse: true` — no Redis). It's fired via the same
  `sendNotification` as `emit`/`progress`, but **not** gated on a `progressToken`
  (it's session-level). The surfaced tool becomes callable on the *next* turn — a
  1-turn latency that matches the natural find→call flow.
* **Session key = `uiClientId`**, resolved identically in `tools/list`
  (`spawnRes.ctx.uiClientId`) and the tool ctx (`spawn.uiClientId`). A session
  without a stable id falls back to static behavior (the seed can't grow).
* **The seed is an invariant floor** — every `tools/list` re-adds it, so a config
  change that widens the seed only widens the floor; growth is preserved.
* **Per-session state is ephemeral** (an in-memory Map, the per-connection
  exception to the Postgres storage policy), swept on a lazy TTL + hard cap.
* **`activateSessionTools` only grows an already-seeded session** — an un-seeded
  (full-catalog / Claude) session has no entry, so activation and the notification
  both no-op. This is the D-005 guarantee, enforced by construction.

# The MCP tool surface dominates prompt-cache cost via Meridian
URL: /internal/docs/agent-insights/mcp-tool-surface-prompt-cache

Every Anthropic call through Meridian inlines all connected MCP tool schemas (~62k tokens, mostly papercusp-su). That base is re-created on any cache miss — the dominant token cost. Defer tools and pin the tools/list manifest.

## What

Agents reach Anthropic as `OMP → Meridian (:3456) → @anthropic-ai/claude-agent-sdk → api.anthropic.com`. Meridian holds the conversation as an SDK session and, **per turn, expands the request \~5×**: the client sends \~17k tokens, but the SDK inlines Claude Code's \~30k-char system prompt **plus every connected MCP tool schema** — measured at **288 tools ≈ 62k tokens, of which 246 are `papercusp-su`** (its full endpoint catalog, projected via `?superuser=1`). This \~62k base rides on **every** request, even a one-line follow-up.

The captured base (62,272 tok) matches the recurring `cache_read = 62,011` fingerprint in Meridian's `/telemetry/requests`.

## Why it matters

Cost is driven by cache **creation** (writes), not request size. In a real 24h sample, **\~5 of 22 turns = \~75% of spend**, each reusing the \~62k base from cache but **re-creating 150–380k tokens** of accumulated history on top. A cache write costs \~12.5× a read, so concentrated busts dwarf everything else.

Busts are **reconnect-driven**: the SDK fetches `tools/list` once per connection, so when the operator hot-reloads while you're adding tools, the SDK reconnects, re-fetches a now-larger catalog, the inlined catalog bytes shift, and the whole prefix re-creates. (`papercusp-su` correctly does *not* emit `tools/list_changed`, so it's not notification-driven.)

Ruled out — a red herring: the `x-anthropic-billing-header` `cch=` hash in `system[0]` changes every request, but Anthropic excludes that block from the cache key, so it does **not** bust.

## How to apply

1. **Keep the MCP surface lean and stable.** Each tool schema is a permanent per-request tax; a flapping/reconnecting server re-creates the entire base. Don't hot-reload the operator during an expensive live session.
2. **Defer tools.** The Claude Agent SDK supports `ENABLE_TOOL_SEARCH=true` (only names inline, schemas fetched on demand) — measured **67.8k → 24.8k tok/request (−63%)**. Note: Meridian hardcodes this to `"false"` on the non-passthrough path, *suppressing* the SDK's own deferral.
3. **Pin the `tools/list` manifest** (commit `955ce391`): `packages/agent-mcp/src/tool-manifest.ts` freezes the exposed surface so a reconnect returns byte-identical bytes — adding tools during dev no longer busts a live session. Regenerate deliberately with `packages/agent-mcp/snapshot-tools.sh`, then restart the operator. Set `$AGENT_MCP_TOOL_MANIFEST` or `~/.papercusp/tool-manifest.json`; absent ⇒ expose all (no-op). Hand-edit the manifest down to curate the surface and shrink the base further.

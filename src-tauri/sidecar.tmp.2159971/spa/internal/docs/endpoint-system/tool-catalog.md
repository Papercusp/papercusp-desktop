# Tool catalog
URL: /internal/docs/endpoint-system/tool-catalog

Every projected tool — built-in (defineTool) and plugin-contributed — exposed across HTTP and MCP transports. Counts in this page are approximate snapshots; agents should use `agent_tools:list` for the live, role-filtered view.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

import { Aside } from '@astrojs/starlight/components';

## Live source of truth

This page is a snapshot. The runtime catalog is always at:

```bash
$ curl http://localhost:3070/api/plugins/tools | jq
```

…and visible in the dashboard at `/settings/plugins/tools`.

Every tool here is callable on **both** transports:

* **HTTP**: `POST /api/plugins/<...>` (plugin tools) or `POST /api/agent-tools/<...>` (built-ins)
* **MCP**: through the orchestrator-baked `.mcp.json` URL or the [superuser-mode](./superuser-mode) `?superuser=1` endpoint

## Built-in tools (\~340)

Tools registered via `defineTool`, primarily from `packages/operator-core/lib/agent-tools/` (read-side tools live in `packages/agent-mcp/src/tools/`). They run with a principal (bearer-resolved) and have direct PG access via `ctx.tx`. This page is a hand-curated subset; for the full live grouping (every group → verbs → capabilities) see the generated **Tool catalog (grouped)** reference page (`reference/tool-catalog`, projected from the `defineTool` registry by `scripts/gen-doc-tool-catalog.ts`).

### `harness:*` (12)

List, get, status, plan reviews, phase paths, markdown index, escalation, health, list\_features, pending\_reviews, etc. — read views into a workspace's harness state. (Doc-retrieval for a harness is **not** here — it lives on context-aware `docs:*`, or `cross_harness:docs_*` for explicit-slug queries from outside.)

### `operator:*` (27)

The operator surface: scans, audit, dispatch, dedup, voice prefs, conv-voice, credentials status, scanner bootstrap/reset, decisions, preferences, multi-workspace view, budget, pause sentinel, voice/spend summary, etc.

### `messages:*` (4)

Cross-harness messaging: `inbox`, `outbox`, `send`, `dismiss`.

### `features:*` (5)

`get`, `history`, `search`, `list_related`, `tag_vocabulary`.

### `tasks:*` (3)

`list`, `get`, `create`.

### `roles:*` (4)

`list`, `get`, `firing_on`, `known`.

### `cross_harness:*` (10)

`inbox`, `outbox`, `supervisor_notes`, `recent_activity`, `docs_outline`, `docs_get`, `docs_search`, `plans_list`, `plans_get`, `plans_search` — the docs\_\* / plans\_\* variants take an explicit `harnessSlug` (and optional `workspaceId`) for engineers querying a specific harness from outside its context. See [docs retrieval](/internal/docs/agents/docs-retrieval).

### `docs:*` (3)

`outline`, `get`, `search` — **context-aware**: returns the caller's harness docs when `ctx.harnessSlug` is set, the Papercusp engineering reference otherwise. Backed by `@papercusp/docs-engine`. See [docs retrieval](/internal/docs/agents/docs-retrieval).

### `projects:*` (4)

`list`, `get`, `spec_revision`, `spec_revisions`.

### `artifacts:*` (4)

`load`, `save`, `append`, `delete` — PG-canonical text artifacts (`harness_text_artifacts`).

### `plugins:*` (4)

`runtime_status`, `invoke_action`, `fire_event`, `tui_panes`.

### Pairs (2 each)

* `intel:*` — `spawn_tree`, `artifacts` (Intel panel data)
* `goals:*` — `list`, `get`
* `snapshots:*` — `list`, `get`
* `autoloop:*` — `status`, `control`

### Singletons

| Tool                        | Description                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents:list`               | Active agent sessions                                                                                                                                                                                       |
| `agent_tools:list`          | Introspection: every projected tool with `{capability, roles, allowed, reason}` for the caller's ctx. The "what can I call?" primitive — pass `onlyAllowed: false` to also see denied tools with the reason |
| `audit:list`                | Audit log (recent actions)                                                                                                                                                                                  |
| `actions:recent`            | Recent agent actions                                                                                                                                                                                        |
| `dev:hello-card`            | Phase E mcp-ui fixture (verifies UI rendering)                                                                                                                                                              |
| `hooks:known`               | Static hook-event allowlist                                                                                                                                                                                 |
| `issues:list`               | Pending issues                                                                                                                                                                                              |
| `notifications:recent`      | Recent notifications                                                                                                                                                                                        |
| `omp:config`                | Read/set OMP CLI config keys                                                                                                                                                                                |
| `pending_events:list`       | Pending hook events                                                                                                                                                                                         |
| `papercusp:list_workspaces` | Discovery helper for [superuser](./superuser-mode) shells                                                                                                                                                   |
| `search:query`              | Cross-resource search (tasks, goals, projects, audit, messages)                                                                                                                                             |
| `wiki:backlinks`            | Find markdown files referencing `[[target]]`                                                                                                                                                                |

## Plugin tools (36)

In-repo plugins under `libs/papercusp/plugins/<name>/`. They run without a principal (URL-baked spawn context); gates: role allowlist, capability tier, per-window quota.

### `@papercupai/repomix` (1)

| Tool           | What                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `repomix.pack` | Pack a project (or subset) into a single LLM-friendly XML doc. ≤50k chars inline; >50k written to `.papercusp/scratch/`. |

### `@papercupai/gitnexus-bridge` (13)

Code-graph queries proxied to a long-lived `gitnexus mcp` subprocess. Tools registered dynamically via `getDynamicTools()`.

| Tool                      | What                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| `gitnexus.list_repos`     | List indexed repos with stats (files, nodes, edges, communities, processes) |
| `gitnexus.context`        | Repo overview + entrypoints                                                 |
| `gitnexus.query`          | Natural-language query → ranked processes + symbols + timing                |
| `gitnexus.cypher`         | Raw Cypher against the graph                                                |
| `gitnexus.detect_changes` | Diff vs last index, surface impacted regions                                |
| `gitnexus.impact`         | Find downstream impact of a symbol/file                                     |
| `gitnexus.api_impact`     | API-surface change impact                                                   |
| `gitnexus.route_map`      | HTTP routes + handlers                                                      |
| `gitnexus.tool_map`       | MCP tools + handlers                                                        |
| `gitnexus.shape_check`    | Validate input/output shapes against types                                  |
| `gitnexus.rename`         | Symbol-aware rename plan (read-only suggestion)                             |
| `gitnexus.group_list`     | List logical code groups                                                    |
| `gitnexus.group_sync`     | Re-sync a group's membership                                                |

### `@papercupai/orchestrator-spawn` — **retired (2026-06-06)**

The Phase-9 "spawn agents as tool calls" plugin was never installed (its `/api/plugins/orchestrator/spawn` path 404'd) and is now retired — moved to `libs/papercusp/_retired/orchestrator-spawn-plugin/` and superseded by `packages/operator-core/lib/fleet/operator-spawn.ts`. Spawn agents via the built-in `fleet:*` tools (`fleet:spawn`, `fleet:supervise`, `fleet:tree`, …) instead.

### `@papercupai/firecrawl-bridge` (3)

Managed scrape via Firecrawl API. Requires `FIRECRAWL_API_KEY`.

| Tool                | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `firecrawl.scrape`  | Single-page scrape → markdown + HTML + metadata        |
| `firecrawl.extract` | JSON-schema-driven structured extraction across N URLs |
| `firecrawl.map`     | Crawl a domain and return all reachable URLs           |

### `@papercupai/code2prompt` (2)

Diff-aware reviewer prompts via the `code2prompt` CLI.

| Tool               | What                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `code2prompt.diff` | Build a review prompt from a git diff vs `last_accepted_feature_sha`                            |
| `code2prompt.pack` | Build a review prompt from a path + template (`code-review`, `security-audit`, `refactor-prep`) |

### `@papercupai/fetch-plus` (1)

URL → clean markdown via Jina Reader (`r.jina.ai/`). Optional `JINA_API_KEY` for higher rate limits.

| Tool                     | What                                                      |
| ------------------------ | --------------------------------------------------------- |
| `fetch_plus.fetch_clean` | Fetch a URL, strip nav/ads/junk, return readable markdown |

### `@papercupai/design-phase` (12)

First-party plugin for the design-spec workflow. Built by another agent; documented elsewhere.

## Search-provider keys

Not tools — env vars. Set in `/settings/api-keys` → "Search providers"; orchestrator injects the decrypted env into every spawned agent's `process.env`. 14 supported providers:

```
TAVILY_API_KEY, PERPLEXITY_API_KEY, BRAVE_API_KEY, JINA_API_KEY,
MOONSHOT_SEARCH_API_KEY (Kimi), ANTHROPIC_API_KEY (search), GEMINI_API_KEY,
CODEX_API_KEY, ZAI_API_KEY, EXA_API_KEY, PARALLEL_API_KEY, KAGI_API_KEY,
SYNTHETIC_API_KEY, SEARXNG_ENDPOINT (+ TOKEN / BASIC_USERNAME / BASIC_PASSWORD)
```

## How to invoke

### From an OMP shell ([superuser-mode](./superuser-mode))

```
omp> call mcp__papercusp-su__papercusp:list_workspaces
omp> call mcp__papercusp-su__gitnexus:list_repos
omp> call mcp__papercusp-su__repomix:pack with target_dir /tmp/some-repo
```

### From curl (HTTP transport)

```bash
TOK=$(cat ~/.papercusp/superuser-token)

# Plugin tools — under /api/plugins/<plugin>/<tool>
curl -X POST "http://localhost:3070/api/plugins/repomix/pack?superuser=1&workspace=default&harness=sheets" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -d '{"include":["README*"]}'

# Plugin tools — wildcard workspace (per-call ?workspace= override or arg)
curl -X POST "http://localhost:3070/api/plugins/gitnexus/list_repos?superuser=1" \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d '{}'

# Built-in tools — under /api/agent-tools/<group>/<verb> (require principal bearer, not superuser bearer)
curl -X POST "http://localhost:3070/api/agent-tools/intel/spawn_tree" \
  -H "Authorization: Bearer <principal-bearer>" -H "Content-Type: application/json" \
  -d '{"harness":"sheets","limit":10}'
```

### From MCP transport

```bash
curl -X POST "http://localhost:3070/api/mcp?superuser=1" \
  -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"papercusp:list_workspaces","arguments":{}}}'
```

## Discovering schemas at runtime

Every tool's `inputSchema` is JSON Schema (Zod 4 → `z.toJSONSchema`). Browse them:

```bash
$ curl -s http://localhost:3070/api/plugins/tools | jq '.tools[] | {name, inputSchema}'
```

Or pretty-printed in the dashboard at `/settings/plugins/tools`.

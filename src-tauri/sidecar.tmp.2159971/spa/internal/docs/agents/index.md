# Agents — overview
URL: /internal/docs/agents/index

How the Operator (voice), Oracle (chat), and Pi (terminal) agents fit together in Papercusp.

import { Aside } from '@astrojs/starlight/components';

Papercusp has three first-class agent surfaces, each tuned for a different latency / depth tradeoff.

## The three agents

| Agent        | Surface                           | Latency budget      | Best for                                                                             |
| ------------ | --------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| **Operator** | Voice (always-on, push-to-talk)   | `<300ms` TTFB       | Reflexive UI control, fast questions about state, conversational delegation          |
| **Oracle**   | Chat tab in the harness dashboard | `<2s`               | Free-form chat, navigation, dispatch to existing chats                               |
| **Pi**       | Terminal panel in the dashboard   | n/a (terminal pace) | Code analysis, file reads, long-running coding tasks via `claude` / `omp` subprocess |

## Architectural split: fast voice + deep delegation

The Operator's voice layer is intentionally a **fast router**, not a deep brain. When the user asks something simple ("is the harness running?", "open the operator panel"), voice handles it directly with sub-300ms latency. When the user asks something deep ("explain how authentication works in this repo", "what should I work on next?"), voice **delegates to a coding agent** via a single tool, which spawns `omp -p` (default, via Meridian + Claude Max) or `claude -p` (when `AGENT_BACKEND=claude-code`) with the full agent-mcp tool surface — file reads, code analysis, multi-step planning.

The architecture is documented in detail in the [Action Registry plan](/internal/docs/agents/action-registry).

## Voice provider

Voice runs through **ElevenLabs Conversational AI** with **Claude Haiku 4.5** as the underlying LLM (BYO LLM via the agent platform). OpenAI Realtime is supported as a manual fallback.

ElevenLabs is the primary voice provider as of the v5 plan. See [§6 of the
Action Registry plan](/internal/docs/agents/action-registry) for the rationale and §8
for the integration shape.

## What lives where

* **Tool catalog** (what each agent can do): the [Action Registry](/internal/docs/agents/action-registry) — single typed source of truth with shims that emit transport-specific tool defs (MCP, ElevenLabs Conv AI, OpenAI Realtime SDK).
* **Docs retrieval surfaces** (how agents read documentation): [Docs retrieval](/internal/docs/agents/docs-retrieval) — the `@papercusp/docs-engine` package, the three doc surfaces (public, engineering, per-harness), the context-aware `docs:*` tools, and the `cross_harness:docs_*` family for out-of-harness inspection.
* **Audit trail**: `harness_shared.agent_actions` (full) + `harness_shared.agent_queries` (sampled). Surfaced in the harness dashboard's "Agent activity" sub-tab.
* **Conversation memory**: `harness_shared.delegates` table (read/written via `delegated-tasks`) — voice agent picks which delegated session a delegation lands in via auto-injected context. (The table kept its old `claude_sessions_*` constraint names after the rename.)

When agents (or humans) build new panels, status indicators, or any
component that reads from Postgres / the operator backend, **default to
`useSyncQuery({queryName, args})` from `@papercusp/sync`**. Don't roll a
new `fetch + setInterval` poll, and don't open a raw `EventSource` for
query data — both fragment the architecture and forfeit the library's
push semantics, IDB caching, and reconnect resilience.

The full guidance + escape-hatch criteria + 3-step migration recipe
lives at [Data Sync → overview](/internal/docs/data-sync). Read that callout
before authoring new data fetching code.

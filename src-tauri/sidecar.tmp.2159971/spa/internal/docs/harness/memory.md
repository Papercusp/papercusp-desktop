# Memory
URL: /internal/docs/harness/memory

The three memory layers — curator-maintained harness working memory, the semantic memory store behind memory:*, and procedural knowledge in agent-insights — and what carries live state instead.

"Memory" in Papercusp is three different systems with three different jobs.
Confusing them causes drift, so the boundaries are the point of this page.

## 1. Harness working memory (curator-maintained files)

Each harness keeps a small, bounded set of memory files under
`.papercusp/memory/` — the direct descendants of the first-generation design:

* **`raw.md`** — append-only one-liner observations; any role writes here
  without coordination.
* **`MEMORY.md`** — the curated mission-scoped store (\~200-line bound),
  merged from raw observations by the curator.
* **`summary.md`** — hard-capped at 40 lines / \~800 tokens and **auto-injected
  into every pipeline spawn's prompt** (it rides the cacheable preamble of
  `prompt-build.ts` — see
  [Why prompt-cache-dominant](/internal/docs/harness/decisions/prompt-cache)).
* **`identity/<role>.md`** — per-role lessons that carry *across* missions;
  the orchestrator mirrors them into Postgres
  (`harness_shared.identity_files`) via `POST /api/internal/identity-snapshot`,
  making PG the durable, queryable copy.

Only the [curator](/internal/docs/harness/decisions/curator) compacts or
deletes these; everyone else appends.

## 2. Semantic memory (`memory:*` — the cross-client store)

Durable facts that should survive sessions and be recalled by *every* client
(Claude / Codex / OMP / spawned agents) live in the semantic memory store
behind the `memory:remember` / `memory:search` / `memory:list` /
`memory:forget` / `memory:update` tools.

* **Canonical store:** Postgres — `harness_shared.memory_canonical`
  (embedded rows; `last_surfaced_at` powers injection dedup).
* **Swappable backend:** the store core is the generic `@papercusp/memory`
  lib behind a `MemoryBackend` seam; the operator registers concrete
  backends in `packages/operator-core/lib/memory/configure.ts` — `mem0`
  (the canonical PG store), `claude-file` (the `~/.claude` topic-file
  store), and **`hybrid`**, which fuses the claude-file lexical leg with the
  mem0 cosine leg via cosine-gated reciprocal-rank fusion; hybrid **writes**
  always delegate to the mem0 leg, so PG stays canonical.
* **Live selection:** which backend serves is an operator-wide setting
  (`harness_shared.operator_settings`, key `memory_backend`), changeable
  from the settings UI with no restart; resolution is persisted setting →
  `PAPERCUSP_MEMORY_BACKEND` → `mem0`
  (`packages/operator-core/lib/memory/backend-selection.ts`).
* **Injection:** relevant memories are surfaced into a session pre-turn
  (`packages/operator-core/lib/memory/injection.ts`), with a per-session
  watermark over `last_surfaced_at` so the same memory isn't re-pushed
  turn after turn.

Scoping: pass a `harness_slug` for project facts; omit it for personal
facts. Client-local file memories (e.g. Claude Code's topic files) are a
per-client layer — the shared store is the one every agent recalls from.

## 3. Procedural knowledge (agent-insights)

Runbooks — "how X works / how to not lose an hour on Y" — are **docs, not
memory rows**: PR-reviewed MDX under
[agent-insights](/internal/docs/agent-insights). Short facts go to semantic
memory; multi-step explanations go here.

## What is NOT memory: live state

In-flight state belongs to its own systems, never to a memory store:
work items carry task state, **coord** carries presence/intents/handoffs,
plans carry decisions (projected by `rationale:feed`). The legacy instinct
"write it to a file so the next role sees it" maps today to "write it to the
durable store the next spawn queries" — see
[Storage policy](/internal/docs/system/storage-policy).

## Choosing the right layer

| You have…                                  | Put it in                                         |
| ------------------------------------------ | ------------------------------------------------- |
| A one-liner observation mid-mission        | `.papercusp/memory/raw.md` (curator will file it) |
| A durable preference / convention / gotcha | `memory:remember` (semantic store)                |
| A multi-step runbook                       | an agent-insights page                            |
| Task progress, blockers, hand-offs         | the work item / coord — not memory                |
| A design decision                          | the plan's `## Decisions` (D-NNN)                 |

# Overview
URL: /internal/docs/agent-spawning/overview

What agent spawning is, why we built it, and when to use it.

## The one-line version

One agent launches another via the `fleet:*` MCP tools — `fleet:spawn` to launch, `fleet:tree` to watch, `fleet:cancel` to abort — and the parent gets a `spawnId` back immediately. The child runs to completion in the background; the parent inspects the tree later or moves on (and is woken on the child's death — see [Lifecycle](/internal/docs/agent-spawning/lifecycle)). Lineage threads through `parent_spawn_id` so the Intel panel shows the full tree.

## Why this exists

Before Phase 9, the orchestrator was the only thing that could launch agents. Every architect→worker, scoper→validator, debugger→validator step ran through the main loop's decision turn. That's right for the canonical lifecycle, but two patterns kept hitting the wall:

* **Architect fan-out.** "These three features are independent — let's run F-001, F-002, F-003 in parallel" — required either three orchestrator iterations in series or a custom branch in main-loop.ts. Now: three `fleet:spawn` calls, return immediately, inspect with `fleet:tree` later.
* **Reviewer kicking a re-architect.** Reviewer notices an architectural mismatch mid-review. Pre-Phase 9: write an issue, hope architect picks it up next iteration. Post-Phase 9: `fleet:spawn { role: 'architect', extras: ['REVIEW_NOTE=...'] }` — synchronous-looking, no main-loop trip.

## How it differs from the orchestrator's main loop

|              | Main loop                                   | spawn primitive                                                                  |
| ------------ | ------------------------------------------- | -------------------------------------------------------------------------------- |
| Driver       | `runMainLoop` decision-turn → invoke        | A `fleet:spawn` tool call from any allowlisted coord role                        |
| Sync?        | Sequential (one role at a time)             | Parallel (multiple spawns concurrent, up to the fleet concurrency ceiling)       |
| Duration cap | Per-role timeout in `invoke()`              | Same per-spawn (`INVOKE_TIMEOUT_MS`) — but parent doesn't wait                   |
| Context      | Walks `decisions` table, computes next verb | Caller passes `role` + `feature` + `chunk` directly                              |
| Telemetry    | `decisions` + `tool_invocations`            | `spawned_agents` (durable nursery) + `tool_invocations` (with `parent_spawn_id`) |

The main loop still owns the canonical "what should this harness do next" decision. `fleet:spawn` is the lower-level primitive an agent reaches for when it knows what it wants to launch and just needs to launch it.

## Where you read about how it works

* [Lifecycle](/internal/docs/agent-spawning/lifecycle) — spawn → inspect → cancel; status transitions; cross-restart durability + orphan reclaim via PG
* [Allowlist & caps](/internal/docs/agent-spawning/allowlist-and-caps) — who can spawn whom; the concurrency ceiling
* [Schema](/internal/docs/agent-spawning/schema) — `spawned_agents` + `tool_invocations_spawn_tree` (baseline + migrations 146/174)
* [Observability](/internal/docs/agent-spawning/observability) — Intel panel's Spawns sub-tab; useful PG queries for the tree
* [Limits](/internal/docs/agent-spawning/limits) — what the spawn primitive doesn't do, what's deferred

## Where it lives in code

| Component                                                               | File                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Spawn engine (the one `fleet:spawn` chokepoint)                         | `packages/operator-core/lib/fleet/operator-spawn.ts`                                                                                 |
| `fleet:spawn` / `fleet:tree` / `fleet:cancel` tools                     | `packages/operator-core/lib/agent-tools/fleet/{spawn,tree,cancel}.ts`                                                                |
| Durable nursery read/write (`recordSpawn`, `finishSpawn`, `getSubtree`) | `packages/operator-core/lib/fleet/{spawn-tree,pg-stores}.ts`                                                                         |
| Background child invoke (subprocess + SIGTERM/SIGKILL)                  | `packages/operator-core/lib/dbos/orchestrator-runner.ts:spawnInvokeOnce`                                                             |
| Wake-parent-on-child-death                                              | `packages/operator-core/lib/fleet/parent-wake.ts`                                                                                    |
| Orphan reclaim + heartbeat (concurrency ceiling)                        | `packages/operator-core/lib/fleet/spawn-reclaim.ts`                                                                                  |
| `spawned_agents` table + spawn-tree view (DDL)                          | `libs/papercusp/libs/db/sql/000-baseline.sql` (+ migrations `146-fleet-supervision.sql`, `174-spawned-agents-heartbeat-reclaim.sql`) |
| Per-spawn URL params (parse)                                            | `packages/agent-mcp/src/spawn-context.ts:parseRequestContext` (re-exported as `buildHttpSpawnContext`)                               |
| `.mcp.json` writer + HMAC signing                                       | `libs/papercusp/packages/orchestrator/src/spawn-mcp.ts` + `packages/operator-core/lib/spawn-signing.ts`                              |

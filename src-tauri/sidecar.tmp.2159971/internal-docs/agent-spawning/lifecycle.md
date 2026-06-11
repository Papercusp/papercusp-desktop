# Lifecycle
URL: /internal/docs/agent-spawning/lifecycle

The fleet flow — spawn → inspect → cancel — including status transitions, cross-restart durability, orphan reclaim, and what happens when things fail.

## The three tools

Every spawn flows through the `fleet:*` surface — launch with `fleet:spawn`, watch with `fleet:tree`, abort with `fleet:cancel`.

```
                       ┌──────────────────────────┐
                       │  fleet:spawn             │
                       │  → returns spawn_id      │
                       │  → status='running'      │
                       └──────────┬───────────────┘
                                  │
                                  │ background spawnInvokeOnce()
                                  ↓
                       ┌──────────────────────────┐     ┌──────────────────────────┐
parent  ─ fleet:tree → │  status: running         │ ←── │  child agent runs        │
        ─ fleet:tree → │  status: running         │     │  (invoke-once subprocess)│
        ─ fleet:tree → │  status: done|failed     │ ←── │  child exits             │
                       └──────────────────────────┘     └──────────────────────────┘
                                  │                                   │
        ─ fleet:cancel → abortController.abort()         (parent woken on child death —
                       SIGTERM (then SIGKILL after 2s)    wakeParentOnChildDeath)
                       status flips to 'cancelled'
```

Unlike a poll loop, a parent doesn't have to keep checking: when a child reaches a terminal status, `wakeParentOnChildDeath` fires the parent's inbox-wake key (with the death notice + output tail), so a sleeping parent re-wakes on its own. `fleet:tree` is for on-demand inspection of the subtree, not mandatory polling.

## `fleet:spawn { harness?, role, feature?, chunk?, brief?, extras? }`

What happens server-side (in `spawnAgentInHarness`):

1. **Role sanity.** The role must be a known `AGENT_ROLES` member or a plugin-namespaced role (`group:role`); a typo fails loud before booting an agent. `role="worker"` requires a `chunk` (spawn a scoper first to chunk the feature).
2. **Harness resolution.** An explicit `harness` slug wins; with none, a single-harness workspace is the unambiguous default. Anything ambiguous or unregistered fails loud. The project dir must exist on disk.
3. **Orphan reclaim, then concurrency check.** Stale-heartbeat rows from a dead operator host are reclaimed (freeing the ceiling) before the live `running`/`restarting` count is compared against the fleet concurrency ceiling (`maxSimultaneousAgents`, default 16). Over the ceiling is a **queue+await**, not a silent drop: the result carries an `await_event` key the caller sleeps on (`events:await`), ending its turn and retrying the spawn when a slot frees.
4. **PG row written** to `harness_shared.spawned_agents` with `status='running'`, `session_owner = spawnId`, and the child's lock `coordination_domain`. Indexed for fast lookups + the reclaim sweep.
5. **AbortController registered** in this host's module-level `Map<spawnId, AbortController>` (`localSpawnAborts`), and the heartbeat loop is started so the row's `heartbeat_at` stays fresh while the child lives.
6. **`spawnInvokeOnce()` fires in the background** as a Promise — *not awaited*. The caller gets the spawn result back immediately.
7. **The promise's `.then`/`.catch`/`.finally`** flips the PG row to `done`/`failed`/`cancelled`, announces the freed slot, and wakes the parent.

The spawn's umbilical: the durable `s-…` spawnId is threaded into the child's env (`PAPERCUSP_SPAWN_ID`) so its signed MCP URL carries a stable `client=`/owner — the same id recorded as `session_owner`, so a bee's coord messages, its file-lock owner, and `fleet:cancel`'s release target all line up.

Return result:

```json
{
  "ok": true,
  "spawn_id": "s-1778408605532-16080170",
  "harness": "sheets",
  "project_dir": "/path/to/project",
  "error": null,
  "next": "fleet:tree { spawn_id } to watch; fleet:cancel { spawn_id } to abort."
}
```

An over-ceiling rejection returns `ok:false` with `error` and an `await_event` key. A pre-launch failure (unknown role/harness, cap) is **recorded** as a `status='failed'` nursery row (the failed `spawn_id` is returned) rather than silently dropped.

## `fleet:tree { spawn_id }`

Reads the durable subtree rooted at a node directly from `spawned_agents` (via `getSubtree`) — every descendant with its status, owner, role, and the work it serves — plus the completion gate (`can_complete` / `open_children`: whether the root has any live child).

Status field is the single source of truth:

| Status       | Meaning                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `running`    | Promise hasn't resolved yet. AbortController is live (on the launching host).                                      |
| `restarting` | Supervised restart in flight (one\_for\_one / one\_for\_all / rest\_for\_one). Counts as ACTIVE.                   |
| `done`       | Promise resolved, child subprocess exited with code 0.                                                             |
| `failed`     | Non-zero exit code, the invoke threw, OR a stale-heartbeat orphan was reclaimed.                                   |
| `cancelled`  | Aborted via `fleet:cancel` (or the subtree flip).                                                                  |
| `reaped`     | Legacy terminal status for a startup-swept orphan; today orphans are reclaimed to `failed` by the heartbeat sweep. |

Each node also carries `feature`, `plan_item`, `owner` (`session_owner`), and `restart_strategy`. Per-node `depth` is the lineage depth within the queried subtree (root = 0). Terminal-row detail (`exit_code`, `output_tail`, `error_message`) lives on the `spawned_agents` row directly — query it or read it off the death-notice payload the parent is woken with.

## `fleet:cancel { spawn_id, reason? }`

A single transitive cancel — there is no in-memory-vs-PG fork in the tool contract. Cancelling a node fans cancellation **down the entire subtree**:

1. **Durable half** (`cancelSubtree`). Every active descendant's row is flipped to `status='cancelled'` in one transaction, and each one's work-item / plan-item claims + file/resource locks are released immediately — instead of waiting minutes for N leases to expire independently.
2. **In-process half** (EI-40). For each cancelled spawn this host launched, the held `AbortController` is triggered: SIGTERM the child's process group, then SIGKILL after a 2-second grace if it hasn't exited. Spawns launched by *another* operator process aren't locally tracked — their rows are still flipped, and the heartbeat-staleness sweep reclaims the orphaned OS process when its host stops heartbeating.

The result reports `cancelled` (the spawn ids), `processes_aborted`, `already_terminal`, and the released-claim/lock counts.

## Status transitions

```
   ┌─────────────┐  ←→  ┌──────────────┐
   │   running   │      │  restarting  │  (supervised restart; still ACTIVE)
   └──┬───┬───┬──┘      └──────────────┘
      │   │   │
   .then  .catch  abort()
      │   │   │
   ┌──↓─┐ │   ┌─↓─────┐
   │done│ │   │failed │ ← also: stale-heartbeat orphan reclaimed here
   └────┘ │   └───────┘
          │
       ┌──↓──────┐
       │cancelled│
       └─────────┘
```

`running` and `restarting` are the two ACTIVE statuses; `done | failed | cancelled | reaped` are terminal. Once a row is terminal it stays there — no re-runs (a supervised restart is a fresh attempt, not a terminal-row revival). `reaped` is a legacy terminal status: today an orphaned row is reclaimed to `failed`, not `reaped`.

## Cross-restart durability

| Action            | Pre-restart spawn (this host)                             | Post-restart spawn (prior host)                                                                |
| ----------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `fleet:tree`      | ✅ reads the PG row                                        | ✅ reads the PG row (the nursery is fully durable)                                              |
| concurrency count | ✅ counted live                                            | ✅ counted until reclaimed                                                                      |
| `fleet:cancel`    | ✅ durable flip **+** real SIGTERM (local AbortController) | ⚠️ durable flip only — no local handle to kill the OS process; the heartbeat sweep reclaims it |

A `running` row whose launching operator host died is no longer left to zombie forever. The live host heartbeats `heartbeat_at` for its in-flight spawns; once a row's heartbeat goes stale past `RECLAIM_STALE_MS` (5 min), the reclaim sweep (`reclaimOrphanedSpawns`, run opportunistically on each spawn and periodically) flips it to `status='failed'` with an explanatory `error_message` and frees the concurrency ceiling. That sweep also wakes the dead child's parent.

## What runs in the child

`spawnInvokeOnce` (`packages/operator-core/lib/dbos/orchestrator-runner.ts`) launches the child as a detached subprocess (its own process group, so a group-kill reaps the wrapper + invoke-once + agent together on cancel/timeout) — the same invoke-once code path the harness uses. The engine threads:

| Passed to the child         | Source                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `project.path` (cwd)        | `resolveProject(harness)` — the registered harness's project dir                          |
| `role`                      | the spawn input's `role`                                                                  |
| `extras[]`                  | the input's `extras`, with `FEATURE_ID=<id>` / `CHUNK_ID=<id>` appended when set          |
| `PAPERCUSP_SPAWN_ID`        | the durable `s-…` spawnId (the umbilical — becomes the child's stable MCP `client`/owner) |
| `PAPERCUSP_PARENT_SPAWN_ID` | the parent's spawnId, when this spawn has a parent (lineage)                              |
| `QUEEN_BRIEF`               | the spawn input's `brief`, when set (P-060) — injected into the bee's prompt              |
| pipeline env                | `buildPipelineExtraEnv` (workspace, harness, idempotency key, PG DSN)                     |

The orchestrator's `spawn-mcp.ts` writes a per-child, HMAC-signed `.mcp.json` (`packages/operator-core/lib/spawn-signing.ts`) with the per-spawn URL params, including `parent_spawn` set to the parent's spawnId — so any tool calls the child makes carry `parent_spawn_id` automatically. (See [Schema](/internal/docs/agent-spawning/schema#url-plumbing--the-spawn-params) for the full param list.)

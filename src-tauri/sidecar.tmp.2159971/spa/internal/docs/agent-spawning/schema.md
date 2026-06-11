# Schema
URL: /internal/docs/agent-spawning/schema

The two PG tables that back the spawn primitive — `spawned_agents` (the durable mirror) and `tool_invocations_spawn_tree` (the recursive lineage view).

## `harness_shared.spawned_agents` — baseline (+ migrations 146, 174)

One row per spawn launch — the durable nursery. Written by the spawn engine (`recordSpawn` / `finishSpawn`); read by `fleet:tree`, the concurrency-ceiling count, and the Intel panel.

The table is defined in `000-baseline.sql`; the supervision columns (`session_owner` … `cancelled_at`) were added by `146-fleet-supervision.sql` and the durability columns (`heartbeat_at`) by `174-spawned-agents-heartbeat-reclaim.sql`.

```sql
CREATE TABLE harness_shared.spawned_agents (
  -- baseline columns
  spawn_id              TEXT PRIMARY KEY,
  workspace_id          TEXT NOT NULL,
  harness_slug          TEXT NOT NULL,
  parent_spawn_id       TEXT NULL,
  parent_role           TEXT NOT NULL,
  child_role            TEXT NOT NULL,
  feature_id            TEXT NULL,
  chunk_id              TEXT NULL,
  run_id                TEXT NOT NULL,
  status                TEXT NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at           TIMESTAMPTZ NULL,
  duration_ms           BIGINT NULL,
  exit_code             INT NULL,
  output_tail           TEXT NULL,
  error_message         TEXT NULL,
  cancel_requested      BOOLEAN NOT NULL DEFAULT false,
  -- 146-fleet-supervision: structured-concurrency / supervision
  session_owner         TEXT NULL,          -- coord/lock owner (== spawn_id for fleet spawns)
  coordination_domain   TEXT NOT NULL DEFAULT 'default',
  plan_slug             TEXT NULL,
  item_id               TEXT NULL,
  restart_strategy      TEXT NOT NULL DEFAULT 'one_for_one',  -- one_for_one|one_for_all|rest_for_one
  restart_count         INT NOT NULL DEFAULT 0,
  restart_window_start  TIMESTAMPTZ NULL,
  cancel_reason         TEXT NULL,
  cancelled_at          TIMESTAMPTZ NULL,
  -- 174-spawned-agents-heartbeat-reclaim: orphan reclaim
  heartbeat_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Status values

`running | restarting | done | failed | cancelled | reaped`

`running` and `restarting` are ACTIVE (counted against the concurrency ceiling); the rest are terminal. Orphaned active rows are reclaimed to `failed`; `reaped` is a legacy status no current path writes.

### Indexes

```sql
spawned_agents_parent_idx           -- (workspace_id, parent_spawn_id) — child enumeration + recursive joins
spawned_agents_recent_idx           -- (workspace_id, harness_slug, started_at DESC) — Intel panel feed
spawned_agents_running_idx          -- (workspace_id, status) WHERE status='running'
spawned_agents_session_owner_idx    -- (workspace_id, session_owner) — owner→spawn lookup for cancel/release (146)
spawned_agents_active_heartbeat_idx -- (heartbeat_at) WHERE status IN ('running','restarting') — orphan-reclaim sweep (174)
```

A check constraint (`spawned_agents_restart_strategy_chk`, added by migration 146) restricts `restart_strategy` to `one_for_one | one_for_all | rest_for_one`.

### RLS

Same workspace-scoped policy as every other `harness_shared` table — `spawned_agents_workspace_isolation`: reads/writes require the `app.workspace_id` GUC to match the row's `workspace_id` (`USING`/`WITH CHECK (workspace_id = current_setting('app.workspace_id', true))`). The org PG client (`getOrgPg`) sets the GUC per connection on every operation.

### Lifecycle hooks on the row

| When                                                  | What                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `spawnAgentInHarness` records a spawn (`recordSpawn`) | `INSERT` with `status='running'`, `session_owner`, `coordination_domain`                |
| Background invoke resolves (`finishSpawn`)            | `UPDATE` with status (`done`/`failed`), duration, exit\_code, output\_tail              |
| Background invoke rejects / aborts                    | `UPDATE` with status='failed' (or 'cancelled' if the signal aborted), error\_message    |
| `fleet:cancel` subtree flip (`cancelSubtree`)         | `UPDATE` every active descendant to status='cancelled' (one txn) + release claims/locks |
| Live host heartbeat (`heartbeatSpawns`)               | `UPDATE heartbeat_at = now()` for in-flight spawns, every 60s                           |
| Orphan reclaim sweep (`reclaimOrphanedSpawns`)        | Stale-heartbeat active rows → `status='failed'` + reason, freeing the ceiling           |

### `heartbeat_at` + reclaim — the durability mechanism

A `running`/`restarting` row whose launching operator host dies would otherwise count against the concurrency ceiling forever (the old `cancel_requested` "v2 watcher" idea — a `pid` column + a SIGTERM-by-pid watcher — was never built and is superseded by this). Instead:

1. The live host bumps `heartbeat_at` every `SPAWN_HEARTBEAT_INTERVAL_MS` (60s) for its in-flight spawns.
2. A row un-heartbeated past `RECLAIM_STALE_MS` (5 min) is presumed orphaned (host dead).
3. The reclaim sweep — opportunistic on each spawn + periodic — flips it to `status='failed'` with a reason and frees the ceiling slot (and wakes the dead child's parent).

`cancel_requested` survives in the schema but is informational; the reclaim path, not a pid watcher, is what un-wedges the ceiling cross-restart.

## `harness_shared.tool_invocations_spawn_tree` — baseline view

A view, not a table. Recursive CTE over `tool_invocations` joining each row to its ancestors via `parent_spawn_id`.

```sql
CREATE VIEW harness_shared.tool_invocations_spawn_tree AS
WITH RECURSIVE chain AS (
  -- Roots: spawns with no parent
  SELECT
    id, workspace_id, harness_slug, plugin_name, tool_name, role,
    feature_id, chunk_id, run_id, spawn_id, parent_spawn_id,
    window_key, invoked_at, duration_ms, status,
    output_ref, output_size, error_message,
    0 AS depth,
    spawn_id::text AS root_spawn_id
  FROM harness_shared.tool_invocations
  WHERE parent_spawn_id IS NULL OR parent_spawn_id = ''
  UNION ALL
  -- Children, joined via parent → ancestor's spawn_id
  SELECT
    t.*, c.depth + 1, c.root_spawn_id
  FROM harness_shared.tool_invocations t
  JOIN chain c
    ON t.parent_spawn_id = c.spawn_id
   AND t.workspace_id = c.workspace_id
   AND c.depth < 16
)
SELECT * FROM chain;
```

### What's in vs what's not

This view is **per-tool-call**, not per-spawn. Each row is one MCP tool invocation; the view tells you "tool X was called by spawn Y, whose root is spawn Z, at depth N."

It's not the same as `spawned_agents`:

|                                       | `spawned_agents`                                                                  | `tool_invocations_spawn_tree`                     |
| ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Granularity                           | One row per spawn launch                                                          | One row per tool call by a child agent            |
| When written                          | At `spawn()` call time + on resolve                                               | When child makes any MCP tool call                |
| Includes spawns that called no tools? | ✅                                                                                 | ❌                                                 |
| Cross-spawn `depth`                   | derived at query time from `parent_spawn_id` (`getSubtree`) — not a stored column | ✅ in-view (recursive lineage)                     |
| Used by                               | `fleet:tree`, the concurrency count, durability                                   | `intel:spawn_tree` / Intel panel's Spawns sub-tab |

You query `spawned_agents` to answer "what spawns happened?". You query `tool_invocations_spawn_tree` to answer "what did each spawn DO?".

### Joining the two

To get every spawn launch with its child tool calls flattened:

```sql
SET app.workspace_id = 'default';

SELECT
  s.spawn_id,
  s.child_role,
  s.status                                    AS spawn_status,
  s.duration_ms                               AS spawn_dur_ms,
  count(t.id)                                 AS tool_calls,
  count(t.id) FILTER (WHERE t.status='ok')    AS tool_calls_ok,
  count(t.id) FILTER (WHERE t.status='error') AS tool_calls_err
FROM harness_shared.spawned_agents s
LEFT JOIN harness_shared.tool_invocations t
  ON t.parent_spawn_id = s.spawn_id
 AND t.workspace_id   = s.workspace_id
WHERE s.harness_slug = 'sheets'
  AND s.started_at > now() - interval '24 hours'
GROUP BY s.spawn_id, s.child_role, s.status, s.duration_ms
ORDER BY s.started_at DESC;
```

That's the canonical "what happened to each spawn" feed.

## URL plumbing — the spawn params

When a spawn fires, the orchestrator's `spawn-mcp.ts` writes a per-child `.mcp.json` with these query params on the operator URL — and HMAC-signs them (`spawn-signing.ts`) so the dispatcher can verify the envelope:

| Param          | Required | Source                          | Purpose                                                      |
| -------------- | -------- | ------------------------------- | ------------------------------------------------------------ |
| `harness`      | ✅        | `ctx.harnessSlug`               | Path resolution + telemetry attribution                      |
| `workspace`    | ✅        | `ctx.workspaceId`               | RLS scoping for everything                                   |
| `role`         | ✅        | child role                      | Tool quota windows + role gating                             |
| `run`          | ✅        | parent's `runId`                | Inherited; per-run quota windows                             |
| `spawn`        | ✅        | new `spawnId`                   | Unique per-spawn telemetry attribution                       |
| `feature`      | optional | spawn input `featureId`         | Feature attribution in tool\_invocations                     |
| `chunk`        | optional | spawn input `chunkId` (workers) | Worker chunk-window quotas                                   |
| `parent_spawn` | optional | parent's `spawnId`              | The lineage edge — this is what makes the spawn-tree work    |
| `client`       | optional | UI client id / spawn owner      | Default `ui:dispatch` target when invoked from a browser tab |

(The signature also covers an `exp` expiry param; required vs optional is enforced by `parseRequestContext`.)

The agent process loads this `.mcp.json` and every MCP request it makes thereafter carries those params. The framework parses them in `parseRequestContext` (exported as `buildHttpSpawnContext`, `packages/agent-mcp/src/spawn-context.ts`), populates `ctx.parentSpawnId`, and the dispatcher records it as `parent_spawn_id` on every `tool_invocations` row.

That's the entire mechanism. No agent code needs to know about spawning; the URL params do all the work.

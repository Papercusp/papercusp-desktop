# Telemetry
URL: /internal/docs/endpoint-system/telemetry

Every tool call lands in `harness_shared.tool_invocations`. Schema, queries, and the Phase 9 spawn-lineage forward-look.

## The single table

`harness_shared.tool_invocations` is where every projected-tool call goes. One row per dispatch attempt, regardless of transport, regardless of outcome. The table originally shipped in migration 046 (now folded into the squashed `000-baseline.sql`, with the original at `libs/papercusp/libs/db/sql/archive/046-tool-invocations.sql`); later migrations added the `args_json` / `transport` / `event_count` / `metadata_json` / `principal_*` columns and two views (below).

```sql
CREATE TABLE harness_shared.tool_invocations (
  id              BIGSERIAL PRIMARY KEY,
  workspace_id    TEXT NOT NULL,
  harness_slug    TEXT NOT NULL,
  plugin_name     TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  role            TEXT NOT NULL,
  feature_id      TEXT NULL,
  chunk_id        TEXT NULL,
  run_id          TEXT NULL,
  spawn_id        TEXT NOT NULL,
  parent_spawn_id TEXT NULL,                 -- Phase 9 lineage
  window_key      TEXT NOT NULL,             -- 'chunk:<id>' or 'run:<id>'
  invoked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms     INT NULL,
  status          TEXT NOT NULL,             -- enum below
  output_ref      TEXT NULL,                 -- papercusp://scratch/... URI for large outputs
  output_size     BIGINT NULL,
  error_message   TEXT NULL,
  args_json       JSONB NULL,                -- the call's input args (truncated past 32 KB)
  transport       TEXT NULL,                 -- 'http' | 'mcp' | 'ipc' | 'in_process'
  event_count     INT NULL,                  -- number of ctx.emit calls during the run
  metadata_json   JSONB NULL,                -- ctx.metadata() payload + reaction cause-chain
  principal_kind        TEXT NULL,           -- Principal audit fields (bearer/MCP path only;
  principal_auth_method TEXT NULL,           -- NULL → surfaces as 'unknown' in /dev)
  principal_trust       TEXT NULL
);
```

The squashed schema also ships two views over the table: `tool_invocations_artifacts` (successful calls that wrote a scratch `output_ref` — feeds the Intel Pack/Diff sub-tabs) and `tool_invocations_spawn_tree` (recursive `parent_spawn_id` lineage, `depth=0` for roots).

Two indexes:

* `tool_invocations_quota_idx` on `(workspace_id, tool_name, role, window_key) WHERE status='ok'` — partial index, makes the dispatcher's quota read O(log n) per call.
* `tool_invocations_telemetry_idx` on `(workspace_id, harness_slug, invoked_at DESC)` — feed for Intel UI's recent-activity panel.

## The status enum

| Status             | Meaning                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `ok`               | Function returned successfully. Counts against quota.                                                                        |
| `error`            | Function threw. Doesn't count against quota. `error_message` populated.                                                      |
| `timeout`          | Dispatcher's AbortController fired before function returned.                                                                 |
| `quota-exceeded`   | Pre-dispatch quota check rejected. Function never ran.                                                                       |
| `role-not-allowed` | Pre-dispatch role check rejected. Function never ran. Also covers the `missing_capability` denial (both map to this status). |
| `invalid-input`    | Function threw a typed input-validation error (`invalid_input`).                                                             |

Add a new status only by editing the dispatcher; do not let tool functions return arbitrary status values.

## Reading the table

The table has RLS — every read needs `app.workspace_id` set first:

```sql
SELECT set_config('app.workspace_id', 'default', false);
SELECT tool_name, role, status, duration_ms, error_message
FROM harness_shared.tool_invocations
WHERE invoked_at > now() - interval '1 hour'
ORDER BY invoked_at DESC;
```

`harness_admin` is `BYPASSRLS` and sees every workspace; `harness_app` is RLS-bound and sees only the configured workspace.

## Useful queries

### Per-tool success rate this run

```sql
SET app.workspace_id = 'default';
SELECT
  tool_name,
  count(*) FILTER (WHERE status='ok') AS ok,
  count(*) FILTER (WHERE status='error') AS errors,
  count(*) FILTER (WHERE status='timeout') AS timeouts,
  count(*) FILTER (WHERE status='quota-exceeded') AS quota_hits
FROM harness_shared.tool_invocations
WHERE run_id = 'r-2026-05-10-001'
GROUP BY tool_name
ORDER BY count(*) DESC;
```

### What did role X do in this run

```sql
SELECT invoked_at, plugin_name, tool_name, status, duration_ms
FROM harness_shared.tool_invocations
WHERE run_id = 'r-2026-05-10-001' AND role = 'architect'
ORDER BY invoked_at;
```

### Quota near-limits (architect at 4/5)

```sql
SELECT tool_name, role, window_key, count(*) AS used
FROM harness_shared.tool_invocations
WHERE status = 'ok' AND window_key LIKE 'run:%'
GROUP BY tool_name, role, window_key
HAVING count(*) >= 4;
```

### Slowest calls

```sql
SELECT tool_name, role, duration_ms, output_size, invoked_at
FROM harness_shared.tool_invocations
WHERE status = 'ok' AND duration_ms > 5000
ORDER BY duration_ms DESC
LIMIT 20;
```

### Failed calls with messages

```sql
SELECT invoked_at, tool_name, role, status, substring(error_message, 1, 200)
FROM harness_shared.tool_invocations
WHERE status IN ('error', 'timeout')
ORDER BY invoked_at DESC
LIMIT 20;
```

## Output reference for large results

Tools that produce a large result write it to the scratch tree at `~/.papercusp/scratch/<workspace>/<toolName>/<runId>/<basename>` and return `outputRef` as a `papercusp://scratch/<workspace>/<toolName>/<runId>/<basename>` URI (see `scratch-uri.ts`); the dispatcher persists it to the `output_ref` column. The body of the tool result still includes a small sample + the ref. Repomix uses this pattern; expect code2prompt and any future packing tools to do the same.

This keeps the table queryable without bloating it with 1MB+ payloads.

## `parent_spawn_id` lineage

`parent_spawn_id` captures the spawn-of-spawn relationship: a child call's rows reference the parent's `spawn_id`. It is **now populated** (not the always-`null` placeholder it once was) on two paths:

* The `parent_spawn` spawn-URL param, parsed into `ctx.parentSpawnId` by the MCP transport (`routes/transport/_mcp-handler.ts`). The fleet spawner (`fleet/operator-spawn.ts` + `fleet/parent-wake.ts`) is what threads it through — superseding the never-installed, now-retired `@papercupai/orchestrator-spawn` plugin.
* The event-reaction cause chain (`lib/events/dispatch-reaction.ts` sets `parentSpawnId` to the triggering call's `spawnId`).

The `harness_shared.tool_invocations_spawn_tree` view (recursive CTE over `parent_spawn_id`, `depth=0` for roots) already exists for querying this lineage.

## How the row is written

`recordTelemetry` runs in the `finally` of `runDispatchStack` (`dispatch-stack.ts`) on every termination path and calls the host-injected `deps.recordInvocation` — whose Papercusp implementation (`recordInvocationImpl` in `packages/operator-core/lib/projected-tool-deps.ts`) does the actual `INSERT`:

* After every successful tool execution: insert `(status='ok', duration_ms, output_size, ...)`.
* After every thrown error: insert `(status='error', duration_ms, error_message)`.
* After a quota check rejection: insert `(status='quota-exceeded', error_message='quota X/Y for role Z in window W')`. Function did not run.
* After a role rejection: insert `(status='role-not-allowed', error_message)`. Function did not run.

Best-effort: every insert is wrapped in try/catch. A PG outage doesn't break the dispatcher; the call still resolves, but the row is lost. The HTTP catch-all logs a warning when this happens.

The `app.workspace_id` GUC is set before every insert via `SELECT set_config('app.workspace_id', $1, true)` — never `SET LOCAL = $1` (PG doesn't accept binds in SET, audit-2 silently broke this for two days before we caught it).

## Where to read in code

* Schema: `libs/papercusp/libs/db/sql/000-baseline.sql` (original at `archive/046-tool-invocations.sql`)
* Quota read + insert (shared across all three transports): `packages/operator-core/lib/projected-tool-deps.ts` — the single `PROJECTED_DEPS` object (`readQuotaStateImpl` + `recordInvocationImpl`), passed to the plugins / agent-tools / transport Hono routes under `packages/operator-core/lib/endpoint-route/routes/` (and the IPC server `libs/generic/ipc-endpoint-server/src/server.ts`)
* Telemetry orchestration: `recordTelemetry` in `libs/generic/tooldef/src/dispatch-stack.ts`
* Window-key + ceiling computation: host-injected `computeQuotaWindow` (engine default `libs/generic/tooldef/src/dispatch-types.ts:defaultComputeQuotaWindow`; Papercusp policy `packages/agent-mcp/src/quota-policy.ts:papercuspComputeQuotaWindow`)

## Future Intel-tab queries

The planned `/harness/<slug>?tab=intel` page reads `tool_invocations` for the four sub-tabs:

* **Spawns** — tree of `spawn_id → parent_spawn_id` to visualize agent lineage
* **Pack** — recent `repomix.pack` / `code2prompt.pack` calls per feature
* **Diff** — `code2prompt.diff` results linked from feature panel
* **Graph** — gitnexus query/context/impact (when the GitNexus bridge ships)

The current schema supports all of these without modification — and some already shipped: the `tool_invocations_spawn_tree` and `tool_invocations_artifacts` views back the Spawns / Pack / Diff data, with read routes under `packages/operator-core/lib/endpoint-route/routes/harness/` (`intel-spawn-tree.ts`, `intel-artifacts.ts`). The remaining work is query views, not new tables.

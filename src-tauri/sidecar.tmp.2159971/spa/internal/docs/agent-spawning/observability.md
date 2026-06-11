# Observability
URL: /internal/docs/agent-spawning/observability

How to see what spawns happened — Intel panel, useful PG queries, and what you can't see (yet).

## Intel panel — Spawns sub-tab

The harness dashboard's **Intel** modal (open via the command palette → "Intel — tool-invocation telemetry", or `?intel=1` URL param) has a **Spawns** sub-tab that's the primary visual surface.

What you see:

* Every `tool_invocations` row scoped to the current harness, last 24h
* `· `-prefixed indent shows depth (parent\_spawn\_id chain) — depth 0 is at the left margin, depth 1 is `· toolName`, depth 2 is `· · toolName`, …
* Status filter chips at the top (ok / error / timeout / quota-exceeded / role-not-allowed)
* Per-row: when, tool, role, status, duration, output size + ref, feature/chunk attribution, spawnId
* Auto-refreshes every 30s while the panel is open; manual refresh button

The view is built from `harness_shared.tool_invocations_spawn_tree`, so depth>0 rows appear automatically when a spawned child agent makes its own tool calls.

## PG queries

### Recent spawns with their outcome

```sql
SET app.workspace_id = 'default';

SELECT
  spawn_id,
  parent_role || '→' || child_role  AS edge,
  status,
  EXTRACT(EPOCH FROM (finished_at - started_at))::int AS dur_s,
  exit_code,
  feature_id,
  substring(coalesce(error_message, output_tail, ''), 1, 80) AS detail
FROM harness_shared.spawned_agents
WHERE harness_slug = 'sheets'
  AND started_at > now() - interval '24 hours'
ORDER BY started_at DESC
LIMIT 20;
```

### Children of a specific spawn

```sql
SELECT
  spawn_id,
  child_role,
  status,
  duration_ms,
  exit_code,
  started_at
FROM harness_shared.spawned_agents
WHERE parent_spawn_id = 's-1778408605532-16080170'
ORDER BY started_at;
```

### Full lineage tree from a root

The `tool_invocations_spawn_tree` view does this recursively. Filter to a `root_spawn_id`:

```sql
SELECT
  depth,
  repeat('  ', depth) || tool_name AS indented,
  role,
  status,
  duration_ms,
  invoked_at
FROM harness_shared.tool_invocations_spawn_tree
WHERE root_spawn_id = 's-1778408605532-16080170'
ORDER BY invoked_at;
```

### Spawn fan-out per role

Who spawns a lot? Who never spawns?

```sql
SELECT
  parent_role,
  count(*) AS total,
  count(*) FILTER (WHERE status='done')      AS done,
  count(*) FILTER (WHERE status='failed')    AS failed,
  count(*) FILTER (WHERE status='cancelled') AS cancelled,
  count(*) FILTER (WHERE status='reaped')    AS reaped
FROM harness_shared.spawned_agents
WHERE started_at > now() - interval '7 days'
GROUP BY parent_role
ORDER BY total DESC;
```

### Spawn pairs (caller → child distribution)

```sql
SELECT
  parent_role,
  child_role,
  count(*) AS n,
  avg(duration_ms)::int AS avg_dur_ms
FROM harness_shared.spawned_agents
WHERE started_at > now() - interval '7 days'
  AND status = 'done'
GROUP BY parent_role, child_role
ORDER BY n DESC;
```

### Spawns that hit a cap

```sql
SELECT spawn_id, error_message, started_at
FROM harness_shared.spawned_agents
WHERE status = 'failed' AND error_message LIKE 'spawn rejected:%'
ORDER BY started_at DESC;
```

Validation/resolution-rejected spawns (unknown role, `worker` without a chunk,
an unregistered harness) **do** land here: the engine records them durably as a
`status='failed'` row with the reason in `error_message` (via
`recordFailedAttempt`), so the rejection is visible in `fleet:tree` rather than
a silent `console.warn`. The `error_message` is a plain-text `spawn rejected: …`
string, not a typed `spawn_*` code — match on `'spawn rejected:%'` instead.
(Over-*ceiling* attempts are queue+await, not a hard reject, and also record a
`failed` row carrying the wake-key hint.)

### Concurrent spawn pressure

```sql
SELECT
  date_trunc('minute', started_at) AS minute,
  count(*) AS launched,
  count(*) FILTER (WHERE status='running') AS still_running
FROM harness_shared.spawned_agents
WHERE started_at > now() - interval '1 hour'
GROUP BY 1
ORDER BY 1 DESC;
```

If `still_running` is consistently near the fleet ceiling
(`maxSimultaneousAgents`, default 16, clamped ≤ 64), raise the cap
(`operator:rate_limit_config`) or stagger launches.

### Output-tail one-liner

For a finished spawn:

```sql
SELECT output_tail
FROM harness_shared.spawned_agents
WHERE spawn_id = 's-1778408605532-16080170';
```

Returns the last 2 KB of the child's stdout. Truncated by design — the full stream lives in the orchestrator's per-spawn `.jsonl` log file.

## What you cannot see (yet)

| Thing                                                   | Why                                               | When                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The child agent's full stdout                           | We only persist the last 2 KB                     | Read the per-spawn `.jsonl` directly: `<projectDir>/.papercusp/logs/<runId>-<spawnId>.jsonl` |
| Per-spawn token cost                                    | Not persisted on `spawned_agents`                 | Available in `harness_shared.agent_runs_consolidated` joined by `runId`                      |
| Cancellation reason                                     | Plugin-side cancel just sets `status='cancelled'` | Acceptable today; future enhancement                                                         |
| Cross-restart cancel — did the OS process actually die? | We have no way to confirm                         | The `reaped` status flags this honestly                                                      |

## Built-in tools for agents

Agents themselves can read the same telemetry — useful when an architect wants to know whether to spawn another worker (would it exceed cap?) or wants to summarize what it's already done.

* `intel:spawn_tree` — recursive view feed
* `intel:artifacts` — pack/diff outputs

Both require bearer auth (built-ins, `intel:read` capability). Use `/api/agent-tools/intel/spawn_tree` over HTTP from the dashboard, or `intel:spawn_tree` via MCP from a spawned agent.

# 5. State model (Postgres-backed)
URL: /internal/docs/spec/state



Each install gets its own Postgres schema (e.g., `harness_papercup`, `harness_my_app`).
The schema is part of the substrate contract:

Implementation note: this is the original per-install-schema design.
The shipped substrate consolidated these into a single
harness\_shared schema whose tables are keyed by
install\_slug / workspace\_id (the
\*\_consolidated tables + per-harness views — see
storage-policy).
goals and pending\_events exist with
substantially the columns below; the iteration unit shipped as
work\_items — a union view
(discriminated by item\_kind) over the base tables
harness\_features\_consolidated (feature / research-task /
chunk) and engineer\_issues (bug / change / task) — not a
tasks table, and there is no standalone audit /
task\_status type by these names. The SQL below is the design
illustration, not the live DDL.

```
-- Each install has these tables (substrate-owned):

CREATE TABLE goals (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  body          text,                   -- why this goal? strategic context
  parent_id     text REFERENCES goals(id),
  budget_cents  bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id            text PRIMARY KEY,
  parent_id     text REFERENCES tasks(id),
  goal_id       text NOT NULL REFERENCES goals(id),
  title         text NOT NULL,
  status        task_status NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  estimated_cost_cents  bigint,
  -- Atomic checkout fields:
  taken_by      text,
  taken_at      timestamptz,
  expires_at    timestamptz,
  -- Audit:
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE issues (
  id            text PRIMARY KEY,
  task_id       text REFERENCES tasks(id),
  body          text NOT NULL,
  filed_by      text NOT NULL,           -- which validator role
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pending_events (
  id            text PRIMARY KEY,
  kind          text NOT NULL,           -- 'routine' | 'webhook' | 'api' | 'completion'
  target_role   text NOT NULL,
  payload       jsonb,
  due_at        timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  consumed_at   timestamptz,
  consumed_by   text
);

CREATE TABLE audit (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  actor         text NOT NULL,            -- which role
  kind          text NOT NULL,
  payload       jsonb NOT NULL
);

-- Plus per-install custom tables under the same schema, declared via plugin manifest.
```

### 5.1 Goal-ancestry queries

Worker prompts are injected with the full task lineage so they always see "why am I doing this?":

```
CREATE FUNCTION task_lineage(task_id text)
  RETURNS TABLE(level int, kind text, id text, title text) AS $$
  WITH RECURSIVE chain AS (
    SELECT 0 AS level, 'task'::text AS kind, id, title, parent_id, goal_id
      FROM tasks WHERE id = task_id
    UNION ALL
    SELECT level + 1, 'task', t.id, t.title, t.parent_id, t.goal_id
      FROM tasks t JOIN chain c ON t.id = c.parent_id
  )
  SELECT level, kind, id, title FROM chain
  UNION ALL
  SELECT 99, 'goal', g.id, g.title FROM goals g
    JOIN (SELECT goal_id FROM chain ORDER BY level DESC LIMIT 1) c ON g.id = c.goal_id;
$$ LANGUAGE sql;

-- Worker prompt injection:
-- ## Why this matters (your goal lineage)
-- - Task: Implement OAuth login flow
--   - because → Set up authentication system (parent task)
--     - because → Build user management module (parent task)
--       - because → GOAL: Ship habit-tracker mobile app to TestFlight by EOM
```

### 5.2 Atomic task checkout

```
-- Worker's checkout query — atomic by definition.
-- Concurrent workers each get a different row.
UPDATE tasks
   SET status = 'in_progress',
       taken_by = $worker_id,
       taken_at = now(),
       expires_at = now() + interval '30 minutes',
       attempts = attempts + 1
 WHERE id = (
   SELECT id FROM tasks
    WHERE status IN ('todo', 'failing')
      AND taken_by IS NULL
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED        -- ← the magic
 )
RETURNING *;

-- Orphan recovery: every tick, the substrate releases stale checkouts:
UPDATE tasks SET taken_by = NULL, taken_at = NULL
 WHERE expires_at < now() AND status = 'in_progress';
```

### 5.3 Hard-stop budget enforcement

```
-- Inside accept_proposal handler — atomic Postgres transaction:
BEGIN;

  -- Lock the goal to serialize concurrent accepts:
  SELECT * FROM goals WHERE id = $goal_id FOR UPDATE;

  -- Sum currently committed costs:
  WITH committed AS (
    SELECT COALESCE(SUM(estimated_cost_cents), 0) AS total
      FROM tasks
     WHERE goal_id = $goal_id
       AND status NOT IN ('cancelled', 'rejected')
  )
  SELECT (g.budget_cents - c.total) AS remaining
    FROM goals g, committed c
   WHERE g.id = $goal_id;

  -- If remaining < proposed cost, ROLLBACK and reject.
  -- Otherwise, INSERT the new task with the cost estimate.

COMMIT;
```

This is enforced in the substrate before the orchestrator can dispatch worker roles, so director agents
physically cannot bypass via direct API.

# Zero (sync layer)
URL: /internal/docs/data-sync/zero

How a Postgres row becomes a row in your React component, in real time.

:::danger\[Zero is being retired — historical reference]
Zero / zero-cache / ZQL named-queries / WebSocket push is **on the retirement
path**. The shipping desktop app uses **SSE-primary** sync (the `:3070` Hono
host pushes invalidate/update over Postgres `LISTEN/NOTIFY`); zero-cache is
**not run** on desktop. Treat this page as historical reference. Source of
truth: `apps/operator/providers/HarnessZeroProvider.tsx` (transport-selection
doc-comment) + the root `CLAUDE.md` deployment-model section.
:::

## The pipeline end-to-end

```
Postgres                     zero-cache              browser
────────                     ──────────              ───────
INSERT/UPDATE  ──logical──►  diff broadcast  ──WS──► useQuery cache
DELETE          replication                          → React re-render
```

1. A backend writer (an API route, a hook, an agent) writes to Postgres.
2. `zero-cache-harness` (systemd unit) tails the `zero_harness` logical
   replication slot.
3. It diffs the change against connected clients' query results and
   pushes only the affected rows over WebSocket.
4. Each browser client's `@rocicorp/zero` materialized view updates and
   any `useQuery(...)` hook reading that view re-renders.

There is no polling. There is no `refetch()` after mutate. The mutation
goes to Postgres and the panel updates because of step 3.

## Reading from Zero in a panel

```tsx
'use client';

import { useSyncQuery } from '@papercusp/sync';
import type { SnapshotConsolidatedRow } from '@papercusp/zero-harness';

export default function SnapshotsPanel({ slug }: { slug: string }) {
  const { data: rows } = useSyncQuery<SnapshotConsolidatedRow>({
    queryName: 'snapshotsConsolidated.bySlug',
    args: { harnessSlug: slug },
  });
  // rows is SnapshotConsolidatedRow[]; map to your domain shape if needed
}
```

Three things to know:

* **`useSyncQuery` returns an object**, not a tuple:
  `{ data, loading, fetching, transport, invalidate, error }` (see
  `SyncQueryResult` in `libs/generic/sync/src/types.ts`). `data` is always
  an array (never `undefined`); for most panels you only need `data`.
  (Raw `@rocicorp/zero`'s `useQuery` returns a `[results, info]` 2-tuple —
  but in this stack you call the `@papercusp/sync` wrapper, not Zero
  directly.)
* **The provider must be mounted upstream**. `HarnessZeroProvider`
  (`apps/operator/providers/HarnessZeroProvider.tsx`) wraps every
  `/harness/*` route in a `<SyncProvider>`. Used outside a provider,
  `useSyncQuery` does **not** throw — it returns
  `{ data: undefined, loading: false, error: null }` so app-chrome
  components mounted above the provider don't crash; branch on the result
  and supply your own fallback if you need live data there.
* **Data arrives over time**. On first render `data` is empty and the
  query hasn't completed. Don't gate on `data.length === 0` to mean
  "empty data" — distinguish "no rows yet, sync in progress" from
  "actually empty" via the `loading` flag if it matters.

## Writing to Zero — there is no Zero write

Zero is a read-side layer. You **do not** write through Zero in our
stack. Mutations go through normal HTTP API routes that write to
Postgres directly. Zero notices the change via logical replication.

If you need a write to feel "instant" before the round-trip, the
existing pattern is:

1. Update local component state (optimistic).
2. `POST /api/...` to write to PG.
3. When the Zero update arrives, the optimistic state and the synced
   state should match — the `useQuery` result will simply confirm the
   change.

If they diverge (the API rejected the write), revert your optimistic
update on the API error path.

## Schema-qualified vs unqualified table names

Zero pulls tables out of a Postgres `PUBLICATION` (`zero_harness`).
As of Migration 032, all per-harness data (`harness_features`,
`harness_issues`, `agent_runs`, `harness_snapshots`) lives in
`harness_shared.*_consolidated` tables keyed on `harness_slug`. The
per-harness schemas (`harness_<slug>`) now contain auto-updatable
VIEWs for back-compat with writers that pre-date the consolidation.

Zero exposes the consolidated tables as four slug-agnostic queries:

* `featuresConsolidated.bySlug(slug)`
* `issuesConsolidated.bySlug(slug)`
* `agentRunsConsolidated.bySlug(slug)` (or `.recent(slug)`)
* `snapshotsConsolidated.bySlug(slug)`

Adding a new harness no longer requires adding anything to the Zero
schema. The slug becomes a regular row value at install time.

Other tables in `harness_shared` (e.g. `harness_phases`,
`harness_decisions`) carry `harness_slug` as a column — see
[Schema conventions](/internal/docs/data-sync/schema).

## TIMESTAMPTZ arrives as `number`, not `string`

If your row has a `ts TIMESTAMPTZ` column and you declare it in the Zero
schema as `string()`, the `zero-cache` will throw
`SchemaVersionNotSupported`, take down the WebSocket, and **every panel
in that schema goes dark**.

The correct declaration is:

```ts
import { table, string, number } from '@rocicorp/zero';

const harnessSnapshots = table('harness_snapshots').columns({
  snapshotId: string(),
  ts: number(),       // ✓ not string()
  iterNum: number(),
  // …
});
```

`ts` arrives as epoch milliseconds. If your component needs a Date object,
convert at the boundary: `new Date(Number(row.ts))`.

This is the single most expensive bug in the codebase to debug because
the failure mode is "all my panels are blank" rather than "this one
column is wrong." Always check the column type when adding a new table.

## Adding a new table to Zero

End-to-end checklist when you add a new table to a per-harness schema:

1. Add the column to `bin/scaffold-harness-schema.sh` (template DDL).
2. Run scaffold against existing harnesses or rely on the auto-scaffold
   that fires from `POST /api/harness/projects`.
3. `ALTER PUBLICATION zero_harness ADD TABLE harness_xxx.harness_<name>;`
   for each existing harness (or use the regenerate-view script).
4. Add the table to `libs/zero-harness/src/schema.ts` with the right
   column types — pay attention to TIMESTAMPTZ → `number()`.
5. Add a query factory to `libs/zero-harness/src/queries.ts`.
6. Add a key helper (`slugToXxxKey`) if it's per-harness.
7. Bump the schema version in `libs/zero-harness/src/schema.ts`.
8. Restart `zero-cache-harness` (`systemctl --user restart
   zero-cache-harness` or via `service` MCP).

If you skip step 7, clients will keep their cached old schema and your
new column won't appear.

## Replication slot recovery

If `zero-cache-harness` won't start with "replication slot in use" —

1. The DB rename (April 2026) left orphaned connections on the old slot.
2. Find the holder: `SELECT pid, application_name FROM
   pg_stat_replication WHERE slot_name = 'zero_harness';`
3. Terminate it: `SELECT pg_terminate_backend(<pid>);`
4. Or, if `postgres_app` is the orphan holder, restart it.

Documented because it's bitten us twice.

## Schema-version errors

`SchemaVersionNotSupported: server expected version N, got version M` →
client and zero-cache disagree on schema version. Causes:

1. You changed `schema.ts` without bumping the version.
2. A second `@rocicorp/zero` package exists in the dep tree
   (`apps/papercusp/node_modules/@rocicorp/zero` was the historical
   offender — it must be symlinked to the workspace root copy or every
   `useQuery` call throws `Query does not implement QueryInternals`).
3. zero-cache is running an old build.

Always check (2) first when the symptoms appear after a fresh `npm
install`.

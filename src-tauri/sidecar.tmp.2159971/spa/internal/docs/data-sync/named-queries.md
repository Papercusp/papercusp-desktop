# Named queries
URL: /internal/docs/data-sync/named-queries

The shared catalog of queries every panel reads from.

:::danger\[Zero is being retired — historical reference]
Zero / zero-cache / ZQL named-queries / WebSocket push is **on the retirement
path**. The shipping desktop app uses **SSE-primary** sync (the `:3070` Hono
host pushes invalidate/update over Postgres `LISTEN/NOTIFY`); zero-cache is
**not run** on desktop. Treat this page as historical reference. Source of
truth: `apps/operator/providers/HarnessZeroProvider.tsx` (transport-selection
doc-comment) + the root `CLAUDE.md` deployment-model section.
:::

## Why named queries

Every Zero query the harness UI runs is registered in
`libs/zero-harness/src/queries.ts`. The reason is twofold:

1. **Type safety end-to-end** — both the panel calling
   `queries.snapshotsConsolidated.bySlug({ harnessSlug })` and the
   `zero-cache` resolving the query reference the same TypeScript
   definition. Adding a column adds it to the row type. Renaming a column
   breaks the panel at compile time.
2. **A surface area that's easy to grep** — when an agent asks "what does
   the harness sync from Postgres?" the answer is: open `queries.ts`. The
   registry is a single `defineQueries({ ... })` call organized into
   namespaces, and it is the entire surface.

## How a named query is wired

Each entry is a `defineQuery(...)` under a namespace inside one
`defineQueries({ ... })` call. A query with arguments takes a Zod schema
for its args plus a resolver that returns ZQL:

```ts
import { defineQueries, defineQuery } from '@rocicorp/zero';
import { z } from 'zod';
import { zql } from './schema';

export const queries = defineQueries({
  snapshotsConsolidated: {
    bySlug: defineQuery(
      z.object({ harnessSlug: z.string() }),
      ({ args: { harnessSlug } }) =>
        zql.snapshotsConsolidated.where('harnessSlug', harnessSlug).orderBy('ts', 'desc'),
    ),
  },
});
```

Two non-obvious things:

* **`args` is an object, validated by Zod** — e.g.
  `{ harnessSlug }`, `{ id }`. The arg names come from the
  `z.object({ ... })` you declare. (Passing a bare array will fail
  validation on the server and the query returns nothing.) This matches
  the `useSyncQuery({ queryName, args })` call site, whose `args` is also
  a plain object.
* **Queries are namespaced** — you reference
  `queries.<namespace>.<name>` (e.g. `queries.snapshotsConsolidated.bySlug`),
  not a flat top-level name.

## The current catalog

The registry has grown well past a single flat list — it is a
`defineQueries({ ... })` call with **60+ namespaces** (`projects`,
`auditLog`, `messages`, the four `*Consolidated` entities, the per-table
`harness*` and `operator*` namespaces, the `org*` department tables, …).
**`libs/zero-harness/src/queries.ts` is the canonical list** — read it
there rather than trusting an inline copy that will drift.

The four core per-harness entities are now slug-agnostic consolidated
tables in `harness_shared`, each read by a `.bySlug` query keyed on
`harnessSlug` (a column, not a schema name):

| Query                                         | Returns         | Args              |
| --------------------------------------------- | --------------- | ----------------- |
| `featuresConsolidated.bySlug`                 | `FeatureRow[]`  | `{ harnessSlug }` |
| `issuesConsolidated.bySlug`                   | `IssueRow[]`    | `{ harnessSlug }` |
| `agentRunsConsolidated.bySlug` (or `.recent`) | `AgentRunRow[]` | `{ harnessSlug }` |
| `snapshotsConsolidated.bySlug`                | `SnapshotRow[]` | `{ harnessSlug }` |
| `projects.all` / `projects.byId`              | `ProjectRow[]`  | (none) / `{ id }` |
| `messages.recent`                             | `MessageRow[]`  | `{ limit }`       |

Adding a new harness no longer adds a query — the slug is a regular row
value. When you add a *new* entry, update both `queries.ts` and
`schema.ts` together.

## Adding a new named query

```ts
// libs/zero-harness/src/queries.ts
export const queries = defineQueries({
  // …existing namespaces
  myNewThing: {
    bySlug: defineQuery(
      z.object({ harnessSlug: z.string() }),
      ({ args: { harnessSlug } }) =>
        zql.myNewThing.where('harnessSlug', harnessSlug),
    ),
  },
});
```

Then in your panel, read it through the `@papercusp/sync` wrapper:

```tsx
const { data: rows } = useSyncQuery<MyNewThingRow>({
  queryName: 'myNewThing.bySlug',
  args: { harnessSlug: slug },
});
```

You also need:

1. The table declared in `libs/zero-harness/src/schema.ts`.
2. The schema version bumped (`schemaVersion` in same file).
3. The table added to the `zero_harness` Postgres publication for each
   harness that has it.
4. `zero-cache-harness` restarted.

If you forget any of these the query returns 0 rows silently.

## "Query does not implement QueryInternals"

This error means the panel's `@rocicorp/zero` package and the one Zero
instantiated against are different copies. Every `useQuery` call throws
it.

Standard fix in our tree (force a single `@rocicorp/zero` copy by
removing the duplicate and symlinking it to the workspace-root copy):

```bash
# from the app that owns the duplicate copy
rm -rf node_modules/@rocicorp/zero
ln -s ../../node_modules/@rocicorp/zero node_modules/@rocicorp/zero
```

Why this exists: an app's `package.json` declaring `@rocicorp/zero` as a
direct dep can make npm resolve it into a private `node_modules` copy when
workspace hoisting decides not to hoist. Symlinking forces a single copy.

If a fresh app you're scaffolding hits this, check whether its
`package.json` declares `@rocicorp/zero` directly — prefer consuming it
transitively from `@papercusp/zero-harness`. (The historical offender,
`apps/papercusp`, no longer exists; the live `@rocicorp/zero` declarations
are in `apps/operator`, `libs/zero-harness`, and the zero-cache-server.)

## Cross-harness queries (views)

`harness_features_consolidated` is a trigger-maintained table in
`harness_shared` that mirrors every per-harness `harness_features` table
under one roof. The trigger fires on insert/update/delete in any
per-harness `harness_features` and keeps the consolidated table in sync.

Why a trigger-maintained table and not a Postgres view? Because Zero
publications can't include views — they require base tables for
logical replication.

The cross-harness `/features` page reads from this table, with no
slug arg, via the `featuresConsolidated` named query. That replaced an
older polling implementation; the page is now real-time.

If you need another cross-harness aggregation, the recipe is:

1. Add a base table in `harness_shared`.
2. Add triggers on every per-harness source table to maintain it.
3. Add to the `zero_harness` publication.
4. Register a named query with no slug arg.

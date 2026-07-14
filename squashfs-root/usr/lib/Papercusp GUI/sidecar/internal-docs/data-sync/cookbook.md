# Cookbook
URL: /internal/docs/data-sync/cookbook

Copy-paste recipes for the most common panel-building tasks.

:::danger\[Zero is fully decommissioned, not merely retired — historical reference]
Zero / zero-cache / ZQL named-queries is **gone from the tree**, not just
off the transport path — `zero-decommission-2026-06-20` removed
`@rocicorp/zero` from every `package.json` and deleted the
`@papercusp/zero-harness` package (`libs/zero-harness` no longer exists as a
directory). The `@papercusp/zero-harness` imports in the recipes below are
**illustrative of the old pattern only** and will not resolve if copy-pasted.
The shipping app uses **SSE for every runtime** — desktop Tauri shell *and*
plain browser — where the operator sidecar's `:3070` host pushes
invalidate/update over Postgres `LISTEN/NOTIFY`; zero-cache is **not run** at
all. `POLLING` exists only as a degraded last-resort fallback, and the WebSocket
transport still lives in `@papercusp/sync` but Papercusp no longer selects it.
Treat this whole page as historical reference for the shape of the old
recipes — for the CURRENT recipe (sync-resolver v2 + SSE), see the
[Data Sync overview](/internal/docs/data-sync) instead. Source of truth:
`apps/operator/providers/HarnessSyncProvider.tsx` (transport-selection
doc-comment, hardcoded `syncType="SSE"`) + the root `CLAUDE.md` deployment-model
section.
:::

## Recipe 1: New panel reading from an existing Zero table

The 80% case. You want to render an existing per-harness table as a new
panel.

```tsx
'use client';

import { useMemo } from 'react';
import { RichGrid, type ColumnDef } from '@papercusp/grid-core';
import type { SnapshotsConsolidatedRow } from '@papercusp/zero-harness';
import { useSyncQuery } from '@papercusp/sync';

interface Props {
  slug: string;
  onSelect?: (id: string) => void;
}

export default function MySnapshotsPanel({ slug, onSelect }: Props) {
  // `useSyncQuery<T>` types T as the ROW element; `.data` is `T[]`.
  // `args` is a named object, not a positional array. The `bySlug` query's
  // Zod arg schema is `{ harnessSlug: string }` — the key must be
  // `harnessSlug`, not `slug`, or the query receives no filter.
  const { data: rows } = useSyncQuery<SnapshotsConsolidatedRow>({
    queryName: 'snapshotsConsolidated.bySlug',
    args: { harnessSlug: slug },
  });

  const columns = useMemo<ColumnDef<SnapshotsConsolidatedRow>[]>(() => [
    {
      key: 'when', header: 'When', width: 1.3,
      sortKey: 'ts', defaultSortDir: 'desc',
      render: ({ row }) => new Date(Number(row.ts)).toLocaleString(),
    },
    {
      key: 'iter', header: 'Iter', width: 0.4, align: 'right',
      sortKey: 'iterNum',
      render: ({ row }) => row.iterNum,
    },
  ], []);

  return (
    <RichGrid<SnapshotsConsolidatedRow>
      rows={rows}
      columns={columns}
      getRowId={(r) => r.snapshotId}
      onRowClick={(r) => onSelect?.(r.snapshotId)}
      inline
    />
  );
}
```

:::note\[The consolidated row types are plural]
The schema exports the **plural** forms — `SnapshotsConsolidatedRow`,
`FeaturesConsolidatedRow`, `IssuesConsolidatedRow`, `AgentRunsConsolidatedRow`.
The singular names re-exported by the `@papercusp/zero-harness` barrel
(`SnapshotConsolidatedRow`, …) do not resolve to a declared type — import the
plural name from the schema.
:::

## Recipe 2: Migrating an existing `.map()` list to RichGrid

Source pattern (anti-pattern in this codebase):

```tsx
{items.map((item) => (
  <div key={item.id} className="row">
    <span>{item.id}</span>
    <span>{item.name}</span>
    <span>{item.status}</span>
  </div>
))}
```

Migration:

```tsx
import { useMemo } from 'react';
import { RichGrid, type ColumnDef } from '@papercusp/grid-core';

const columns = useMemo<ColumnDef<Item>[]>(() => [
  { key: 'id', header: 'ID', width: 1, sortKey: 'id',
    render: ({ row }) => row.id },
  { key: 'name', header: 'Name', width: 3, sortKey: 'name',
    render: ({ row }) => row.name },
  { key: 'status', header: 'Status', width: 1, sortKey: 'status',
    render: ({ row }) => row.status },
], []);

return (
  <RichGrid<Item>
    rows={items}
    columns={columns}
    getRowId={(i) => i.id}
    inline
  />
);
```

Steps in order:

1. Add `import { RichGrid, type ColumnDef } from '@papercusp/grid-core'`.
2. Build a `columns` array, one entry per visible field. Wrap in
   `useMemo`.
3. Replace the `.map()` block with `<RichGrid …>`.
4. Move per-row click handler from each row to `onRowClick`.
5. Drop the manual loading + error CSS (RichGrid renders its own header
   even when rows is empty; provide a sibling empty-state component if
   you need a friendlier message).

## Recipe 3: Adding a new column to an existing Zero-synced table

:::caution\[Per-harness tables are being retired]
The per-harness-table model below predates the consolidation migrations.
The canonical stores are now the `harness_shared.*_consolidated` tables —
writers should target those directly (see the
`COMMENT ON harness_features_consolidated` in `000-baseline.sql`), and Zero
exposes only the `*Consolidated.bySlug` / `*Consolidated.all` queries
(the per-harness named queries — `featuresSheets`, `issuesOrg`, … — were
removed; see the comment in `libs/zero-harness/src/queries.ts`). Add columns
to the consolidated table (Recipe 5) rather than to per-harness tables.
:::

The per-harness table names are **not** uniformly `harness_<table>` —
several (e.g. `feature_audit`, `agent_runs`) carry no `harness_` prefix.
The published per-harness tables are `harness_features`, `feature_audit`,
`harness_issues`, `harness_proposals`, `agent_runs`, `harness_snapshots`
(plus `messages`, `supervisor_notes`); see the publication list in
`bin/scaffold-harness-schema.sh` and `libs/zero-harness/src/schema.ts`.

```sql
ALTER TABLE harness_<slug>.harness_snapshots
  ADD COLUMN new_col text;
```

For each existing harness, repeat. Then:

1. Update the per-harness template SQL (the file `bin/scaffold-harness-schema.sh`
   `sed`-substitutes `{{SCHEMA}}` into and runs) so future harnesses get it —
   the column DDL lives in the template, not in the shell script itself.
2. Update `libs/zero-harness/src/schema.ts` — add `new_col: string()`
   (or the right type — beware TIMESTAMPTZ).
3. The publication already includes the table; the new column flows
   automatically.
4. Restart `zero-cache-harness`.
5. Update consumers (`useSyncQuery` results now include `new_col`).

## Recipe 4: Adding a new table to all harnesses

Bigger lift. Steps:

1. Add the `CREATE TABLE` DDL to the **per-harness template SQL** (the
   file `bin/scaffold-harness-schema.sh` renders via `sed
   "s/{{SCHEMA}}/$schema/g"`), and add the table to the publication list
   in the scaffold script's `add_to_zero_publication` array. The script
   itself contains no DDL — it only substitutes the schema name into the
   template and runs it.
2. Run scaffold against every existing harness:
   ```bash
   for slug in $(psql -tAc "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'harness\_%'" | sed 's/^harness_//'); do
     bin/scaffold-harness-schema.sh "$slug"
   done
   ```
3. Add the table to `libs/zero-harness/src/schema.ts` (register it in the
   `createSchema({ tables: [...] })` list).
4. Add a query factory to `queries.ts`.
5. Add a `slugToXxxKey` helper to `queries.ts`.
6. Restart `zero-cache-harness`.

## Recipe 5: Cross-harness consolidated table

When you need to render data across all harnesses (e.g. global feature
list).

1. Create a new base table in `harness_shared`:
   ```sql
   CREATE TABLE harness_shared.harness_<name>_consolidated (
     harness_slug text,
     <column>     <type>,
     -- …
     PRIMARY KEY (harness_slug, <pk>)
   );
   ```

2. For each per-harness source table, add an `AFTER INSERT/UPDATE/DELETE`
   trigger that maintains the consolidated table.

3. Add the consolidated table to the `zero_harness` publication.

4. Register a no-arg named query:
   ```ts
   <name>Consolidated: () => z.query.<name>Consolidated,
   ```

5. Register the table in `schema.ts` and restart zero-cache.

`harness_features_consolidated` is the working example to copy.

## Recipe 6: Mutations that update Zero panels

You want a button that inserts a row and have every connected client see
it appear.

```tsx
async function addNote() {
  const res = await fetch('/api/harness/<slug>/notes', {
    method: 'POST',
    body: JSON.stringify({ text: 'hello' }),
    headers: { 'content-type': 'application/json' },
  });
  if (!res.ok) {
    toast.error('add note failed');
    return;
  }
  // No reload, no refetch. Zero will broadcast the new row in <100ms.
}
```

The API route writes to PG. Zero broadcasts. `useSyncQuery` re-renders. Done.

If you want optimistic UI before the round-trip, hold the new row in
component state and clear it when the Zero query result reflects the
real one. Don't try to write through Zero — that's not how this stack
works.

## Recipe 7: Per-row action buttons

Buttons inside a column cell that need to **not** trigger the row's
`onRowClick`:

```tsx
{
  key: 'action',
  header: '',
  width: 0.6,
  align: 'right',
  render: ({ row }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleDelete(row.id);
      }}
    >
      delete
    </button>
  ),
}
```

The `e.stopPropagation()` is required.

## Recipe 8: Selected-row highlight

`getRowBg` is called with `(row, rowIndex, isSelected)` — RichGrid already
tracks whether a row is selected (from its own internal state, or from the
controlled `selectedRowIds`/`onSelectedRowIdsChange` pair if you pass them):

```tsx
const [selectedId, setSelectedId] = useState<string | null>(null);

const getRowBg = (row: Row, _rowIndex: number, isSelected: boolean) =>
  row.id === selectedId ? '#1f2937' : undefined;

<RichGrid
  rows={rows}
  columns={columns}
  getRowId={(r) => r.id}
  onRowClick={(r) => setSelectedId(r.id)}
  getRowBg={getRowBg}
  inline
/>
```

Return `undefined` (not `'transparent'`) to fall back to RichGrid's own
default striping/hover background rather than overriding it outright. For a
checkbox-style multi-select rather than a single active row, skip the manual
`selectedId` state entirely: pass `selectable` (or a controlled
`selectedRowIds`/`onSelectedRowIdsChange` pair) and read the built-in
`isSelected` argument in `getRowBg` instead of comparing ids yourself.

`apps/operator/app/adv/harnesses/WorkItemsPanel.tsx` is a current live
example of RichGrid with this exact `getRowBg` selected-row pattern; the
retired `SnapshotsPanel.tsx` (see Reference panels below) shows the older,
pre-dock version of the same idea.

## Recipe 9: PG-mirrored filesystem store

Use this when a filesystem JSON file must remain authoritative — e.g. an
external CLI writes it, or a runtime loader reads it by path — but you
also want cross-harness queries and Zero subscriptions over the same
data.

The pattern in three parts:

**1. The PG table** is a derived index of the JSON. Same schema, plus
`updated_at`. Add to the `zero_harness` publication.

```sql
CREATE TABLE harness_shared.plugin_enables (
  harness_slug   text NOT NULL,
  plugin_slug    text NOT NULL,
  version        text NOT NULL,
  config_hash    text NOT NULL DEFAULT '',
  enabled_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (harness_slug, plugin_slug)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON harness_shared.plugin_enables TO harness_app;
GRANT SELECT ON harness_shared.plugin_enables TO harness_zero;
ALTER PUBLICATION zero_harness ADD TABLE harness_shared.plugin_enables;
```

**2. A mirror helper.** Reads the JSON for one harness/scope, upserts
matching rows, deletes orphans. This is the function every writer calls.

```ts
// packages/operator-core/lib/plugin-enables-pg.ts
import { getOrgPg } from '@papercusp/db-org';

export async function mirrorHarness(harness: string): Promise<void> {
  const file = await readEnabled(harness);                  // read JSON
  const enabled = file?.enabled ?? {};
  const { sql } = getOrgPg();
  for (const [pluginSlug, meta] of Object.entries(enabled)) {
    await sql`
      INSERT INTO harness_shared.plugin_enables
        (harness_slug, plugin_slug, version, config_hash, enabled_at, updated_at)
      VALUES (${harness}, ${pluginSlug}, ${meta.version}, ${meta.configHash},
              ${meta.enabledAt}, now())
      ON CONFLICT (harness_slug, plugin_slug) DO UPDATE
        SET version = EXCLUDED.version,
            config_hash = EXCLUDED.config_hash,
            updated_at = now()
    `;
  }
  // Delete rows for plugins removed from the JSON
  const slugs = Object.keys(enabled);
  if (slugs.length === 0) {
    await sql`DELETE FROM harness_shared.plugin_enables WHERE harness_slug = ${harness}`;
  } else {
    await sql`
      DELETE FROM harness_shared.plugin_enables
      WHERE harness_slug = ${harness} AND plugin_slug NOT IN ${sql(slugs)}
    `;
  }
}
```

**3. Hook every writer.** After each successful JSON write — direct or
via subprocess — call the mirror. Best-effort: a mirror failure logs but
does not fail the API call.

```ts
// in the API route that calls the CLI
const r = await spawn(PAPERCUSP_BIN, ['plugin', 'enable', slug, '--harness', h]);
if (r.code === 0) {
  try { await mirrorHarness(h); } catch (e) {
    console.warn('[plugins/enable] PG mirror failed for', h, e);
  }
}
```

**4. Backfill + drift recovery.** Provide a script that reads ALL JSONs
and re-syncs PG. It runs on a fresh checkout, after a direct CLI run
that bypassed the operator API, or whenever you suspect drift.

```js
// scripts/backfill-plugin-enables.mjs
// Same logic as mirrorHarness, run for every harness directory.
// Idempotent: re-running on already-synced data is a no-op.
```

### When to pick this pattern over PG-canonical

| Pick PG-canonical (Recipe 1-2) when | Pick PG-mirror (this) when                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| You own every writer                | A third-party process or runtime path writes the JSON and you can't change it |
| The data has no on-disk consumer    | A loader reads the JSON file at runtime by path                               |
| Atomicity of write matters          | The JSON is the operational source of truth and PG is a query-side index      |

Reference implementations:

* `packages/operator-core/lib/plugin-enables-pg.ts` (papercusp CLI is the writer)
* `packages/operator-core/lib/plugin-configs-pg.ts` (substrate plugin loader reads JSON at runtime)

## Recipe 10: Where to put a new panel

| Panel scope                                                  | Location                                                                                                                                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabular data for one harness, shown in the harness dashboard | `apps/operator/app/harness/<Name>Panel.tsx`                                                                                                                                                                                               |
| Dock panel in the per-harness workbench                      | A `Real<Name>Panel.tsx` under `apps/operator/app/harness/dock/`, registered with `panelRegistry.register('data:<name>', Real<Name>Panel)` in `dock/sample-panels.tsx` (see `RealFeaturesPanel.tsx` / `RealIssuesPanel.tsx` for the shape) |
| Cross-harness panel (global view)                            | `apps/operator/app/<route>/<Name>Panel.tsx`                                                                                                                                                                                               |

The live `apps/operator` harness UI is dock-based
(`apps/operator/app/harness/[slug]/HarnessDockShell.tsx`); wire a new panel in
as a dock panel rather than into a monolithic tab switcher. There is no
single `DepartmentHarnessDashboard.tsx` anymore — that file moved to the
**retired** `libs/papercusp/_retired/apps-web/app/harness/` tree when the
dock rewrite shipped (the `MemoryEntriesGrid` component it once hosted is
gone entirely, not just moved); treat it as historical reference only, not a
live extension point.

## Reference panels

When in doubt, copy the structure from one of these live RichGrid
consumers:

* `apps/operator/app/adv/harnesses/WorkItemsPanel.tsx` — sortable/filterable
  RichGrid with `getRowBg` selected-row highlighting and resizable columns.
* `apps/operator/app/harness/[slug]/projects/ProjectsList.tsx` — RichGrid
  with `onRowClick` navigation, a small, focused table.

The following now live in the **retired**
`@papercusp/web` surface (`libs/papercusp/_retired/apps-web/app/harness/`)
but still show the canonical RichGrid + sync wiring from before the dock
rewrite:

* `…/web/app/harness/SnapshotsPanel.tsx` — small, single per-harness table,
  sortable + per-row delete.
* `…/web/app/harness/issues/IssuesList.tsx` — RichGrid, multi-state row,
  with `rowProps` legacy-class workaround.
* `…/web/app/harness/ProposalsPanel.tsx` — inline mutation actions.

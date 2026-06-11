# Pitfalls
URL: /internal/docs/data-sync/pitfalls

Specific failure modes that have silently broken every panel in a schema. Read before debugging.

These are catalogued because each one cost real time. If a panel is
behaving wrong, work down this list before you start changing code.

:::note\[Some entries are zero-cache–era]
Zero / zero-cache / ZQL is on the retirement path — the shipping desktop app
uses **SSE-primary** sync (the operator sidecar pushes invalidate/update over
Postgres `LISTEN/NOTIFY`); **zero-cache is not run**. The zero-cache–specific
items below (publication membership, port collisions, replication slots, the
`SchemaVersionNotSupported` cache) are kept as historical reference. The
RichGrid / `useSyncQuery` / `rowProps` gotchas (#1, #4, #8) are current and
still apply.
:::

## 1. `render: (row) =>` instead of `render: ({ row }) =>`

**Symptom**: every cell in the column renders blank or shows
`[object Object]`.

**Why**: `ColumnDef.render` is called with a context object
`{ row, rowIndex, rowBg, isSelected }`, not the row itself. TypeScript
accepts both signatures because the context structurally satisfies many
row shapes. (Same gotcha applies to `rowProps` and `cellStyle`, which also
receive this ctx.)

**Fix**: destructure `{ row }` from the argument.

```ts
render: ({ row }) => row.name,   // ✓
render: (row) => row.name,       // ✗ row is the ctx; row.name is undefined
```

## 2. PG `TIMESTAMPTZ` declared as `string()` in Zero schema

**Symptom**: `SchemaVersionNotSupported` in `zero-cache` logs.
WebSocket dies. **Every panel using that schema goes blank.** Reload
doesn't help.

**Why**: Zero deserializes `TIMESTAMPTZ` as epoch-ms `number`. If the
schema declares it as `string()`, validation fails for every row and
the cache disconnects.

**Fix**: declare as `number()`.

```ts
ts: number(),   // ✓
ts: string(),   // ✗ — kills the WS for the whole schema
```

This has bitten us at least three times. **Always check the column type
before declaring a TIMESTAMPTZ field.**

## 3. Two copies of `@rocicorp/zero` in the dep tree

**Symptom**: `Query does not implement QueryInternals` thrown from
every `useQuery` call.

**Why**: a sub-app declared `@rocicorp/zero` directly in its
`package.json` and npm hoisted it into `apps/<name>/node_modules`. The
panel's import resolves to the local copy; Zero's runtime resolves to
the workspace root copy. Two distinct module instances → instanceof
fails → `QueryInternals` mismatch.

**Fix**: symlink the inner copy to the workspace root.

```bash
cd apps/<name>
rm -rf node_modules/@rocicorp/zero
ln -s ../../../node_modules/@rocicorp/zero node_modules/@rocicorp/zero
```

Then preferably remove the direct dep from the sub-app's
`package.json` so the next `npm install` doesn't reintroduce it.

## 4. Legacy class with `display: grid` in `rowProps`

**Symptom**: cells render on top of each other; the whole grid looks
collapsed.

**Why**: `RichGrid` uses CSS Grid for its cell layout. If `rowProps`
returns a `className` that has its own `display: grid`, the two
grids fight.

**Fix**: override with inline `style: { display: 'block' }`. (`rowProps`
receives the cell-render ctx — destructure `{ row }` if you need it.)

```tsx
rowProps={({ row }) => ({
  className: 'h-issue',
  style: { display: 'block' },
})}
```

## 5. Schema change not reflected on clients

**Symptom**: you changed `schema.ts` (added a column, renamed one,
changed a type), restarted `zero-cache`, and clients still see the old
shape — or worse, throw `SchemaVersionNotSupported`.

**Why**: clients cache the schema and the cache wasn't invalidated.

> **Historical.** Older `@rocicorp/zero` carried an explicit `schemaVersion`
> constant you bumped on every change. The current schema
> (`libs/zero-harness/src/schema.ts` → `createSchema({ tables: [...] })`)
> has **no** `schemaVersion` field — that knob is gone. A change there is
> registered by adding/editing the table in the `tables` list and restarting
> zero-cache; if a stale shape persists, clear the client's cached schema.

## 6. Forgot to add the table to the Postgres publication

**Symptom**: the named query returns `[]` always, even though
`SELECT * FROM harness_<slug>.harness_<table>` shows rows.

**Why**: the table isn't in the `zero_harness` publication, so logical
replication isn't broadcasting it.

**Fix**:

```sql
ALTER PUBLICATION zero_harness ADD TABLE harness_<slug>.harness_<table>;
```

…then restart `zero-cache-harness` so it re-reads the publication
membership.

## 7. zero-cache port collisions

**Symptom**: zero-cache logs "address already in use" on `:4849` or
`:4850`.

**Why**: the shop zero-cache (different DB, different config) defaults
its change-streamer port to `ZERO_PORT + 1 = 4849`, which collides with
the harness zero-cache main port.

**Fix**: set `ZERO_CHANGE_STREAMER_PORT=4847` on the shop zero-cache
unit. The current allocation is:

| Port | Service                         |
| ---- | ------------------------------- |
| 4849 | harness zero-cache main         |
| 4850 | harness change-streamer         |
| 4847 | shop change-streamer (override) |

## 8. Sync hook outside the provider

**Symptom**: a panel using `useSyncQuery` shows no data and never loads —
`data` is `undefined`, `loading` is `false`. Or, if you used
`useSyncPrefetch` / `useSyncContext` instead, a thrown
`useSyncQuery must be used within a <SyncProvider>`.

**Why**: the component is mounted above the `SyncProvider` wrapper.
`useSyncQuery` is **tolerant** — outside a provider it returns
`{ data: undefined, loading: false, error: null }` instead of throwing (so
chrome rendered at the root layout doesn't crash). The throwing variants are
`useSyncContext` and `useSyncPrefetch`.

**Fix**: ensure your panel is mounted inside the provider tree. In the
operator the provider is `RootSyncProvider` (which wraps
`HarnessZeroProvider`), mounted near the root layout, so most components are
already inside it — see `apps/operator/app/_components/RootSyncProvider.tsx`.
If a panel renders above it, hoist the provider or branch on the empty result
and supply your own fallback (REST poll, prefetch cache).

## 9. JSON ledger out of sync with PG

> **Historical.** The `projects` JSON-ledger and its
> `loadProjects()`/`saveProjects()` accessors have been **removed** — the
> functions no longer exist in the tree, and the `apps/papercup` projects
> surface they backed was retired. Kept as a cautionary pattern.

**Symptom**: a PG-backed accessor returns rows that don't match what the UI
shows (or vice versa).

**Why**: a "PG mirror" pattern where a JSON file is primary and PG is
best-effort — both were sources of truth and some code paths wrote to one
and not the other; the file always drifts ahead.

**Fix**: PG is canonical. Do not adopt the file-primary / PG-mirror pattern
for app-level state — go full PG (the storage-policy rule). If you must keep
a file authoritative for a real reason, drive every writer through one mirror
helper plus a backfill/drift-recovery script (see the cookbook's
*PG-mirrored filesystem store* recipe).

## 10. dev:web vs dev:operator confusion

> **Retired (2026-05-30).** `apps/web` (the `@papercup/web` public site) was moved to
> `_retired/papercup/` and dropped from the workspace; the `dev:web` script no longer
> exists. Kept for reference. The operator (`:3055`) is the **Vite** SPA — see the **Fix** note.

**Symptom**: edits to `apps/web/...` don't take effect after restart.

**Why**: `dev:web` serves `apps/web/.next/standalone/server.js`, **not**
a dev server. To see source changes you need `npm run build` (full
rebuild — never `npx next build`, which skips the static-asset copy).

**Fix**: rebuild apps/web. The operator (`:3055`) uses the **Vite** dev
server (`@papercusp/operator-vite`) and picks up source changes via HMR;
only the legacy `apps/web` Next standalone is the static-build outlier.

## 11. Replication slot stuck after DB rename

**Symptom**: `zero-cache-harness` won't start; logs show "replication
slot in use."

**Fix**:

```sql
SELECT pid, application_name FROM pg_stat_replication
  WHERE slot_name = 'zero_harness';
SELECT pg_terminate_backend(<pid>);
```

If `postgres_app` is the holder, restart it.

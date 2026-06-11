# Adding a query to the Zero-free sync resolver
URL: /internal/docs/agent-insights/adding-a-sync-query

How to add a new useSyncQuery name to the v2 dispatcher. ~15 LOC drizzle entry, registry-style, no ZQL. Pairs with the reactive-table insight.

## What

The operator serves `useSyncQuery({ queryName: '<name>' })` reads
through a switch-on-name dispatcher at
`packages/operator-core/lib/sync-resolver/index.ts`. Each entry is a small
async function that takes validated args and returns a flat row
array. Adding a query is purely additive — \~15 LOC, no client-side
changes needed for the dispatcher itself.

This replaced the legacy `@rocicorp/zero`-coupled ZQL resolver in
P-022 (cutover commits `164671ed` + earlier batches). The legacy
resolver is gone; this dispatcher is the only path.

## When to use it

Add an entry when:

* A UI component needs to subscribe to a PG-backed read with
  `useSyncQuery` and the queryName isn't already registered.
* You're moving a route from manual fetch + setInterval polling to
  push-driven reactivity.

Don't add an entry for:

* One-shot reads that don't need invalidation. Use a regular fetch
  * `useAsyncJson` or similar.
* Writes. The dispatcher is read-only; mutations stay on
  `POST /api/...` routes and fire `notifySyncInvalidate(...)` after
  the write succeeds.

## Recipe

### Step 1: confirm the table exists in drizzle's generated schema

The dispatcher uses `@papercusp/db-org`'s `generated` table registry
for column → camelCase conversion. Check that your table is there:

```bash
grep "^export const yourTableNameInHarnessShared" \
  libs/papercusp/libs/db/src/schema/generated.ts
```

If missing: regenerate the schema via the drizzle generator, or add
the table via `ensure-schema.ts` / a SQL migration first.

### Step 2: add a registry entry

Open `packages/operator-core/lib/sync-resolver/index.ts`. Each entry has
this shape (mirrors the legacy ZQL chain):

```ts
'yourQueryName.byScope': {
  argsSchema: z.object({
    harnessSlug: z.string(),
    limit: z.number().int().positive().max(500).default(50),
  }),
  resolve: async (args) => {
    const { harnessSlug, limit } = args as { harnessSlug: string; limit: number };
    const { getOrgPg, generated } = await import('@papercusp/db-org');
    const { desc, eq } = await import('drizzle-orm');
    const t = generated.yourTableNameInHarnessShared;
    const { db } = getOrgPg();
    return (await db
      .select()
      .from(t)
      .where(eq(t.harnessSlug, harnessSlug))
      .orderBy(desc(t.updatedAt))
      .limit(limit)) as unknown[];
  },
},
```

Key points:

* **`argsSchema`**: a zod schema. Validation runs before `resolve`.
  Bad args throw → route handler returns 400.
* **`resolve`** returns `unknown[]` — a FLAT row array. If your
  existing data helper returns `{rows: [...]}`, unwrap it here.
* **Dynamic `import()`** of `@papercusp/db-org` + `drizzle-orm` keeps
  the registry module lightweight and avoids cycles. The lazy import
  is per-call but the loader caches; no perf cost in practice.
* **`as unknown[]`** at the return — drizzle's `select()` returns
  rich types; the dispatcher contract is `unknown[]`. The cast is
  intentional.

### Step 3: add the bridge entry (P-067)

Open `packages/operator-core/lib/sync-resolver/table-to-query-names.ts`.
Add a line in `TABLE_TO_QUERY_NAMES` mapping your PG table to the
new queryName:

```ts
'harness_shared.your_table_name': ['yourQueryName.byScope'],
```

This makes the PG trigger producer (P-018 `emit_change_notify`) fire
your camelCase invalidation when ANY write touches the table —
including raw SQL, MCP-tool writes, or migrations that bypass app
code. Without this bridge, only app-code `notifySyncInvalidate`
calls reach your subscribers.

If multiple queries scope on the same table (e.g. `byHarness` +
`byFeature` over the same chunk plans), list both:

```ts
'harness_shared.harness_chunk_plans': [
  'chunkPlans.byHarness',
  'chunkPlans.byFeature',
],
```

### Step 4: update the registry-count assertion

Open `packages/operator-core/lib/sync-resolver/index.test.ts`. Bump the
running-count assertion (`expect(knownQueryNamesV2()).toHaveLength(N)`)
and add the new name to the closest batch assertion. The count
assertion exists so future drift surfaces: a registry entry added
without the corresponding test update is treated as suspicious.

Same in `table-to-query-names.test.ts` — bump the
`allBridgedQueryNames()).toHaveLength(N)` assertion.

**If the name you're migrating is in the `FORWARD_DEFINED` set**
(advance-mapped before its v2 entry existed — see
[forward-defined-registry-entries insight](/internal/docs/agent-insights/forward-defined-registry-entries)),
**remove it from `FORWARD_DEFINED` in the same commit**. The sanity
assertion ("forward-defined names are NOT in v2") will fail otherwise
and tell you to do this; doing it as part of the migration commit
keeps the drift signal accurate.

### Step 5: verify

```bash
cd packages/operator-core
npx vitest run lib/sync-resolver/    # 33+ tests
npx tsc --noEmit                     # check for type regressions
```

Optional live verification against running operator:

```bash
curl "http://127.0.0.1:3070/api/zero-harness/rest-query?name=yourQueryName.byScope&args=$(python3 -c 'import json,urllib.parse; print(urllib.parse.quote(json.dumps({\"harnessSlug\":\"sheets\"})))')"
```

You should see `{"rows":[...], "version":"..."}` with the expected
row shape.

## Why this design (not just calling notifySyncInvalidate on each write)

Two complementary producers run side by side:

| Producer                                              | Trigger                                       | Use it for                                                             |
| ----------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| `notifySyncInvalidate(name, args, data?)` in app code | Application write paths                       | Fine-grained intentional notifies with optional row payload            |
| PG `emit_change_notify` trigger                       | Every INSERT/UPDATE/DELETE on attached tables | Catch-all for raw SQL, MCP-tool writes, agent-direct edits, migrations |

Together they cover both planned writes (app code) and any other
write (trigger). The 90s dedupe window in `sync-sse.ts` collapses
the inevitable overlap so subscribers see one event per (name, args)
per dedupe window.

The bridge (P-067, `table-to-query-names.ts`) is what makes the
trigger producer reach the camelCase consumers. Without it, the
trigger fires `harness_shared.your_table.changed` and clients
subscribed to `yourQueryName.byScope` see no match.

## When to NOT add to this dispatcher

Some reads don't fit the registry shape:

* **Multi-table joins / aggregates**: legacy ZQL had limited join
  support too. Build a regular REST endpoint (e.g. `/api/admin/...`)
  and fire `notifySyncInvalidate` from the route.
* **File-system reads** (e.g. plans-admin's markdown loading):
  these aren't PG rows; the dispatcher's `getOrgPg` shape doesn't
  apply. Use `useAsyncJson` + push invalidation via
  `notifySyncInvalidate('plans.list', ...)` from the file-watcher.
* **Per-row scoped reads** (`one()` instead of an array): drizzle's
  `.limit(1)` returns a single-element array, which matches the
  dispatcher contract. The client unwraps `rows[0]`. Don't try to
  return a non-array — the SSE adapter expects `unknown[]`.

## Related

* `packages/operator-core/lib/sync-resolver/index.ts` — the dispatcher
* `packages/operator-core/lib/sync-resolver/table-to-query-names.ts` — the P-067 bridge
* [Adding a reactive table](/internal/docs/agent-insights/adding-a-reactive-table) — the producer side (PG trigger + `notifySyncInvalidate`)
* `packages/operator-core/lib/sync-sse.ts` — the LISTEN handler + SSE fan-out

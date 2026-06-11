# Data Sync overview
URL: /internal/docs/data-sync/index

How harness UI panels read from Postgres in real time via Zero + RichGrid.

:::danger\[Zero is being retired — historical reference]
Zero / zero-cache / ZQL named-queries / WebSocket push is **on the retirement
path**. The shipping desktop app uses **SSE-primary** sync (the `:3070` Hono
host pushes invalidate/update over Postgres `LISTEN/NOTIFY`); zero-cache is
**not run** on desktop. Treat this page as historical reference. Source of
truth: `apps/operator/providers/HarnessZeroProvider.tsx` (transport-selection
doc-comment) + the root `CLAUDE.md` deployment-model section.
:::

import { Aside } from '@astrojs/starlight/components';

**For any new component that reads server state, default to
`useSyncQuery({queryName, args})` from `@papercusp/sync`.** Don't roll a
new `fetch + setInterval` poll. Don't open a raw `EventSource` for
query data.

The library is the single audited path: SSE/WS push, payload-on-
invalidate, REST refetch fallback, observability shim
(`window.__sync_metrics__`), reconnect resilience. Each parallel poll
or ad-hoc EventSource forks all of that and accumulates as drift.

**Genuine exceptions** (you may roll your own integration):

* **Streaming-by-nature payloads** — log tails, terminal output,
  command-runner progress, LLM token streams. These are byte streams,
  not query data; raw `EventSource` is the right tool. See the existing
  uses in `OperatorPanel`, `BranchActionRunner`, `ProvisionStream`,
  `HarnessDashboard`'s log stream, `PiPanel` (pty).
* **Pure UI timers** — `setNow(Date.now())` for relative-time refresh,
  `setInterval` for animation steps. No fetch, not data sync.
* **Mobile (`apps/operator-mobile/`)** — uses its own pure-HTTP +
  EventSource path with `usePolledList` and `sync-stream.ts` for
  per-device JWT scoping and battery-aware visibility pause. New mobile
  consumers stay on that pattern.

If you think you have another reason to bypass the library, **surface
it as a question first** instead of forking quietly. Drift here costs
real CPU, battery, and latency that the user only sees as "the app feels
sluggish."

**The migration template** (3-line summary):

1. **Read** — add a resolver entry in
   `packages/operator-core/lib/sync-resolver/index.ts` (the **Zero-free**
   dispatcher): `'queryName.variant': { argsSchema, resolve }` returning a flat
   row array. Prefer the structured DB projection if one exists (e.g. read
   `harness_plans.items` jsonb rather than re-parsing markdown). The legacy
   `libs/zero-harness/src/queries.ts` ZQL path is **retired** — do not add there.
2. **Write** — at the write site (the REST route / `defineTool` handler, or a
   watcher), fire `notifySyncInvalidate('queryName.variant', args)` from
   `packages/operator-core/lib/sync-sse.ts` after the write commits. For an
   optimistic write surface use `useSyncMutate('group.verb', restFallback)`;
   with Zero retired it takes the REST fallback, and the invalidate above is
   what pushes the new state back to subscribers.
3. **Component** — `const { data } = useSyncQuery({queryName, args})`. Done.

Full recipe in the [Cookbook](/internal/docs/data-sync/cookbook); the Zero-free
dispatcher's per-entry recipe is in the
[adding-a-sync-query](/internal/docs/agent-insights/adding-a-sync-query) insight.

## What this section covers

This is a reference for agents and humans building UI panels in the harness
operator (`apps/operator/app/harness/`) and the Papercup demo
(`apps/papercup/`). Read this **before** you wire a new panel to data.

The stack is two layered conventions, not a single library:

1. **Zero** ([rocicorp.dev/zero](https://rocicorp.dev/zero)) — the reactive
   sync layer. Postgres is the source of truth. A `zero-cache` process
   tails logical replication and broadcasts changes to every connected
   client. Clients call `useQuery(...)` and re-render when the underlying
   row changes — no polling, no manual refetch.
2. **RichGrid** (`@restart/grid-core`, mirrored at
   `papercupai/papergrid`) — the column-driven grid renderer every tabular
   panel uses. It accepts plain rows + a `ColumnDef[]`, handles sorting,
   row click, row styling, and (optionally) virtual rendering. It does
   **not** know about Zero — the panel passes Zero query results as the
   `rows` prop.

These two are intentionally orthogonal:

* A panel can use **Zero without RichGrid** (e.g. card or feed UX —
  `ArchitectInbox`).
* A panel can use **RichGrid without Zero** (e.g. data that comes from a
  one-shot REST call — `ProjectsList`, the harness `[slug]/projects` page).
* The default for a new tabular panel that displays Postgres-backed data
  is **both**.

## Why this exists

Before this stack was in place, every panel had its own list-rendering
code (a `<table>` or a `.map()` over `<div>`s), its own polling loop, its
own optimistic-update logic, and its own bug about "stale data after a
mutation." Migrating to RichGrid + Zero collapses all of that into:

```tsx
const [results] = useQuery(queries.snapshots(slug));
return <RichGrid rows={results.map(rowToSnapshot)} columns={columns} getRowId={s => s.id} inline />;
```

Mutations write directly to Postgres (via a normal `POST /api/...` route);
Zero notices the change and pushes it to every connected client within
\~50ms.

## Where each piece lives

| Concern                                | Package                   | Path                                                |
| -------------------------------------- | ------------------------- | --------------------------------------------------- |
| RichGrid component + `ColumnDef` types | `@papercusp/grid-core`    | `libs/generic/papergrid/grid-core/src/RichGrid.tsx` |
| Zero schema definitions                | `@papercusp/zero-harness` | `libs/zero-harness/src/schema.ts`                   |
| Named-query catalog                    | `@papercusp/zero-harness` | `libs/zero-harness/src/queries.ts`                  |
| Sync hooks (`useSyncQuery`, …)         | `@papercusp/sync`         | `libs/generic/sync/src/SyncContext.ts`              |
| Sync provider for harness app          | local                     | `apps/operator/providers/HarnessZeroProvider.tsx`   |
| `zero-cache` process (retired)         | systemd unit              | `zero-cache-harness.service`                        |
| Postgres database                      | server                    | `papercusp` DB on `:5432`                           |

## Reading order for new contributors

1. [RichGrid](/internal/docs/data-sync/richgrid) — the renderer; learn this first
   because it's the smaller, self-contained surface.
2. [Zero](/internal/docs/data-sync/zero) — how a row in Postgres becomes a row in
   your component.
3. [Named queries](/internal/docs/data-sync/named-queries) — how to add a new query
   to the shared catalog.
4. [Schema conventions](/internal/docs/data-sync/schema) — per-harness Postgres
   schemas, `harness_shared` cross-harness views, publications.
5. [Pitfalls](/internal/docs/data-sync/pitfalls) — non-obvious issues that have
   silently broken every panel in a schema. Read this before debugging.
6. [Cookbook](/internal/docs/data-sync/cookbook) — copy-paste recipes for the most
   common panel-building tasks.

## Source-of-truth files

When the docs and the code disagree, the code wins. The docs are kept in
sync best-effort, but the canonical references are:

* `libs/generic/papergrid/grid-core/src/RichGrid.tsx` — props, `ColumnDef` shape
* `libs/zero-harness/src/queries.ts` — every query name and its args
* `libs/zero-harness/src/schema.ts` — every published table and its
  Zero-side type
* `apps/operator/app/adv/harnesses/useHarnessData.ts` — a live consumer
  reading the consolidated queries via `useSyncQuery` (`featuresConsolidated.bySlug`,
  `issuesConsolidated.bySlug`, `agentRunsConsolidated.bySlug`)

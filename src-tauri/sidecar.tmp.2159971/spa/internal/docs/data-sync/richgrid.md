# RichGrid
URL: /internal/docs/data-sync/richgrid

Column-driven grid renderer; the only tabular UI primitive in the harness.

:::danger\[Zero is being retired — historical reference]
Zero / zero-cache / ZQL named-queries / WebSocket push is **on the retirement
path**. The shipping desktop app uses **SSE-primary** sync (the `:3070` Hono
host pushes invalidate/update over Postgres `LISTEN/NOTIFY`); zero-cache is
**not run** on desktop. Treat this page as historical reference. Source of
truth: `apps/operator/providers/HarnessZeroProvider.tsx` (transport-selection
doc-comment) + the root `CLAUDE.md` deployment-model section.
:::

## When to reach for RichGrid

Use RichGrid for any panel that renders a list of rows where each row has
the same columnar structure. It replaces every `<table>` and every
hand-rolled `.map() => <div className="row">` in the codebase.

Do **not** use RichGrid for:

* Card-grid feeds where each card shows a different shape
  (`ArchitectInbox`).
* Kanban / column-board layouts (`BoardView`).
* Master-detail explorers where the "list" is actually a sidebar to an
  embedded editor (`MemoryBrowser`, `IdentityPanel`,
  `PromptsTab`, `CollectionTab`).
* Image galleries (`ScreenshotsPanel`).
* Timeline / chronological streams (`PulseFeed`,
  `FeatureTimelinePanel`).

If you find yourself adding a "second row of metadata under each grid
row" you're probably building one of the above and should use a card
layout instead.

## Minimal usage

```tsx
import { RichGrid, type ColumnDef } from '@papercusp/grid-core';

interface Snapshot {
  id: string;
  ts: number;
  iterNum: number;
}

const columns: ColumnDef<Snapshot>[] = [
  { key: 'when', header: 'When', width: 1.3, sortKey: 'ts',
    render: ({ row }) => fmtTs(row.ts) },
  { key: 'iter', header: 'Iter', width: 0.4, align: 'right',
    sortKey: 'iterNum',
    render: ({ row }) => row.iterNum },
];

<RichGrid<Snapshot>
  rows={snapshots}
  columns={columns}
  getRowId={(s) => s.id}
  onRowClick={(s) => setSelected(s)}
  inline
/>
```

That's the entire surface for \~80% of panels.

## Column definition

```ts
interface ColumnDef<Row> {
  key: string;             // unique within the column array
  header: ReactNode;       // string or arbitrary JSX
  headerText?: string;     // plain-text header for the print mirror + copy payload
  width: number | string;  // number → fr track (1 = 1fr); string → fixed/minmax track
  align?: 'left' | 'center' | 'right';
  sortKey?: string;        // upstream sort field name; emitted via onSortChange
  defaultSortDir?: 'asc' | 'desc';
  render: (ctx: CellRenderContext<Row>) => ReactNode;
  toCopyText?: (row: Row) => string;  // plain-text cell value for print/copy
  cellStyle?: CSSProperties | ((ctx: CellRenderContext<Row>) => CSSProperties);
  headerClassName?: string;
}

// ctx passed to render / cellStyle / rowProps:
interface CellRenderContext<Row> {
  row: Row;
  rowIndex: number;
  rowBg: string;
  isSelected: boolean;
}
```

### `render` receives a context object, not a row

This trips up agents and humans equally. The signature is:

```ts
render: ({ row }) => ...   // ✓ correct
render: (row) => ...       // ✗ wrong — row is actually the ctx, every cell renders empty
```

TypeScript accepts both forms because the ctx object structurally satisfies
"the row shape plus extra fields" in many cases. The grid will silently
render blank cells. **Always destructure `{ row }`.**

### Width is `fr` units, not pixels

`width: 1.3` means 1.3 fractions of the available width. The grid uses
CSS Grid's `grid-template-columns: repeat-fr` under the hood. Pixel widths
are not supported by design — content adapts to the panel's container.

### Sort key

`sortKey` is a string — the upstream field name the data source should
sort by (`sortKey: 'ts'`). It is **not** a deriving function; the grid
passes the string back to you via `onSortChange`, it does not read the row.

Sort is **controlled**: a column's header is only clickable when it has a
`sortKey` *and* you pass `onSortChange`. RichGrid does not sort the data
itself — it emits a `SortState` (`{ column, dir }` or `null`) and you apply
it. Clicking cycles `defaultSortDir` → opposite → unsorted (`null`). Wire it
with the `applySort` helper:

```tsx
const [sortState, setSortState] = useState<RichGridSortState | null>(null);
const sortedRows = useMemo(() => applySort(rows, sortState), [rows, sortState]);

<RichGrid
  rows={sortedRows}
  sortState={sortState}
  onSortChange={setSortState}
  ...
/>
```

For large datasets, push the sort into the data source (SQL `ORDER BY`,
Zero `.orderBy(...)`) instead of `applySort`.

## Common props

| Prop                         | Type                                                 | Notes                                                                                                                  |
| ---------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `rows`                       | `Row[]`                                              | Source data (legacy/non-virtual mode). Memoize upstream if mapping from sync results.                                  |
| `columns`                    | `ColumnDef<Row>[]`                                   | Wrap in `useMemo` to avoid rebuilding on every render.                                                                 |
| `getRowId`                   | `(row: Row) => string`                               | Required. Used as React key + selection set.                                                                           |
| `onRowClick`                 | `(row: Row, index, e) => void`                       | Optional. Whole row becomes click target.                                                                              |
| `getRowBg`                   | `(row, rowIndex, isSelected) => string \| undefined` | Per-row background override; return `undefined` to fall back to default striping.                                      |
| `rowProps`                   | `(ctx: CellRenderContext<Row>) => HTMLAttributes`    | Per-row class/style — **receives the ctx, not the row** (use `ctx.row`). **See pitfall below.**                        |
| `inline`                     | `boolean`                                            | Skip the outer flex + scroll wrapper; render header/body as siblings for parent-owned scroll. Almost always pass this. |
| `virtualMode`                | `{ virtualizer, totalRows, rowAt }`                  | Opt-in virtualization. Pass instead of `rows`; flip on for >500 rows.                                                  |
| `empty`                      | `ReactNode`                                          | Shown when rows is empty / virtual total is 0.                                                                         |
| `sortState` / `onSortChange` | `SortState \| null` / `(next) => void`               | Controlled sort — see above.                                                                                           |

## Pitfall: `rowProps` + a CSS class with `display: grid`

If `rowProps` returns `{ className: 'h-issue' }` and the legacy class has
its own `display: grid`, that grid clashes with RichGrid's internal cell
grid and every cell renders on top of itself.

Fix: override with inline `style: { display: 'block' }` (note `rowProps`
receives the cell-render ctx, so destructure `ctx.row` if you need the row):

```tsx
rowProps={({ row }) => ({
  className: 'h-issue', // legacy
  style: { display: 'block' },
})}
```

The retired `IssuesList.tsx` (`libs/papercusp/apps/web/app/harness/issues/`)
is the original example of this pattern.

## Patterns: per-row action buttons

Action buttons in a column need `e.stopPropagation()` if the row also has
`onRowClick`, otherwise a click on the button will also fire the row
handler:

```tsx
{
  key: 'action',
  header: '',
  width: 0.6,
  align: 'right',
  render: ({ row }) => (
    <button
      onClick={(e) => { e.stopPropagation(); onRemove(row.id); }}
    >
      delete
    </button>
  ),
}
```

## Patterns: virtual rows

For grids that may show >500 rows (audit logs, agent runs across years),
pass `virtualMode` (a `{ virtualizer, totalRows, rowAt }` object) **instead
of** `rows`. You own the TanStack virtualizer + the windowed `rowAt(index)`
lookup; `rowAt` may return `undefined` for not-yet-loaded rows, in which
case RichGrid renders `renderLoadingRow` (or a "loading…" line). Row sizing
defaults to `rowMinHeight` (36px); override per grid if rows are taller.

## Multi-expand

RichGrid supports per-row expanded detail via `renderExpandedRow` plus an
expansion-key prop. The caller fully owns the expanded-state — RichGrid does
not toggle on click. Use `expandedRowKey` (single id) or `expandedRowKeys`
(a `ReadonlySet<string>` for multiple rows; the two are unioned):

```tsx
<RichGrid
  rows={features}
  columns={columns}
  getRowId={f => f.id}
  expandedRowKeys={expanded}
  renderExpandedRow={(row) => <FeatureDetail feature={row} />}
/>
```

Multiple rows can be expanded simultaneously when you pass `expandedRowKeys`.

## Testing a migrated panel

After migrating from a hand-rolled list:

1. Visual: open `localhost:3055/harness/<slug>` and confirm columns line
   up. If a cell is blank, check the `render: (row) =>` vs `({ row })`
   bug above first.
2. Sort: click each header with a `sortKey` and confirm direction
   indicator updates.
3. Click: confirm `onRowClick` fires (and that buttons inside cells stop
   propagation).
4. Empty state: rows = `[]` should render the grid header with no
   content; provide a sibling empty-state component if the panel needs
   one.

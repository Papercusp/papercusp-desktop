# Performance — rules every agent must follow
URL: /internal/docs/performance

Render, bundle, network, layout, and measurement guidelines distilled from the apps that feel fastest, plus concrete anti-patterns from real audits of this codebase. Apply to all new code.

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

import { Aside } from '@astrojs/starlight/components';

**Every agent must read this page before changing code in this repo.** "It works" isn't the same as "it's fast." This page captures (a) practices from apps users consider best-in-class — Linear, Notion, Vercel, Figma, Discord, Stripe — and (b) **real anti-patterns we've shipped** that have caused production slowdowns. The "What not to do" section near the bottom is **load-bearing**: it lists specific traps with measured impact and the correct alternative. If a pattern in your change matches one of those traps, change the approach before continuing.

A focused perf audit on `/harness` reduced warm TTFB from **18.7s to 83ms (225×)** across 14 commits. Eight separate slow endpoints were reduced to two repeating root patterns (serial fs/PG in loops; repeated reads of the same file). A new rule **A15** covers the request-scoped readJson cache pattern that produced the last 100× speedup. The "Audit findings" table further down shows every endpoint's before/after with the fix applied. Two `<body>`-frozen incidents during the session are also captured under **A8** (duplicate React keys → infinite Fast Refresh loop) and **A10** (Radix `pointer-events` leak on `<body>`).

## What "fast" actually means here

The targets are stricter than the typical web app baseline:

| Metric                                        | Target                                    | Why                                                 |
| --------------------------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Time to interactive (TTI) on the harness page | \< 1.5 s on a warm cache                  | Operators sit on this page all day                  |
| Frame rate during list updates / animation    | 60fps minimum, 120fps when transform-only | Anything below 60 feels sluggish                    |
| Re-renders per keystroke in a 50-row form     | ≤ 1 per field                             | Anything more is a re-render storm                  |
| Bundle delta per new feature                  | \< 10 KB gzip / route                     | Death-by-a-thousand-cuts kills warm-cache TTI       |
| Web Vitals (LCP / INP / CLS)                  | "Good" (2.5s / 200ms / 0.1)               | Google's standard; passes user perception threshold |

You can verify the first three locally with React DevTools' Profiler. The last two need Lighthouse or Web Vitals in production.

## Lessons from the apps that feel fastest

| App          | What they do                                                                                                                                                                                                                                         | What you can copy                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Linear**   | Local-first sync — every action mutates the local store first, then syncs to the server in the background. Zero "loading…" spinners on normal operations. Fine-grained subscriptions: components only re-render when *their slice* of state changes. | Use Zero (`useSyncQuery`) the way it's already wired. Optimistic UI for every mutation. Don't subscribe to whole tables when one row is enough. |
| **Notion**   | Block-level memoization in the editor — every block is a `React.memo` with a stable identity, and they avoid re-rendering ancestors when a block changes. Service worker for offline. View Transitions API for sidebar nav.                          | Memoize list items by stable key. Use `React.memo` + `areEqual` on FeatureList row, IssuesList row, ProposalsPanel item.                        |
| **Vercel**   | Server Components by default; `'use client'` only at leaves. Streaming SSR with Suspense boundaries around slow data. Edge-runtime for routes that don't need Node.                                                                                  | Default new pages to RSC. Move `'use client'` to the smallest possible component. Wrap data-fetching pieces in `<Suspense>`.                    |
| **Figma**    | UI is React (chrome only). The canvas is custom Rust→WebAssembly. They explicitly *don't* try to make React fast enough for the design surface — they use the right tool for the right surface.                                                      | When you have a hot rendering loop (canvas, graph), don't reach for React. Drop down to imperative DOM / canvas / WebGL.                        |
| **Discord**  | Virtualized chat list. Workers for syntax highlighting and search indexing. Replaced setState chains with Flux to avoid double-renders.                                                                                                              | Virtualize any list > 50 rows (`@tanstack/react-virtual` already in deps). Move CPU-heavy work off the main thread (Web Workers).               |
| **Stripe**   | Inline critical CSS. Defer all non-critical JS. `preconnect` to API hosts. Prerender hot paths.                                                                                                                                                      | Use Next.js's built-in `priority` on above-the-fold images. `<link rel="preconnect">` for cross-origin APIs (Anthropic, Cloudflare, etc.).      |
| **Airtable** | Virtualized grid. WebWorker for formula compute. Optimistic UI everywhere.                                                                                                                                                                           | Same patterns. We already use `RichGrid` virtualization — keep it.                                                                              |
| **GitHub**   | Turbo (HTML over the wire) for many surfaces, replacing SPA. View Transitions for navigation. Aggressive HTTP caching.                                                                                                                               | Don't make a hot path SPA-only when SSR + native nav would do. Use View Transitions for cross-route animations.                                 |

## Hard rules — must follow

These are non-negotiable. CI / review will reject violations.

### 1. Default to Server Components

Next.js App Router lets you write Server Components (RSC) by default. **Don't add `'use client'` unless the file actually needs browser APIs / hooks / event handlers.** Server Components ship zero JS to the browser; they're free.

When you do need a client component, push `'use client'` to the **leaf**, not the route. Example:

```tsx
// Wrong — every server-rendered child of /reports also ships to the browser
'use client';
export default function ReportsPage() { ... }

// Right — only the chart is client-rendered; the surrounding page stays server-only
export default function ReportsPage() {
  return (
    <Layout>
      <ReportSummary />            {/* RSC */}
      <ReportChart data={data} />  {/* this one has 'use client' */}
    </Layout>
  );
}
```

### 2. Virtualize any scrollable list of more than \~50 items

Rendering 1000 DOM nodes for a list the user only sees 20 of is wasted work. Use [`@tanstack/react-virtual`](https://tanstack.com/virtual) (already a dependency). `RichGrid` already handles this for the feature/issues lists; copy that pattern for any new long list.

**Anti-pattern**: rendering all rows and relying on `overflow: auto` to "hide" the off-screen ones. The DOM is still there, paint cost is still there.

### 3. Memoize list-row components by stable key

Every row in a virtualized list should be `React.memo`-wrapped with an `areEqual` that compares the row data identity (not deep equality). The parent shouldn't re-render the row when something elsewhere in the list changes.

```tsx
const FeatureRow = React.memo(function FeatureRow({ row }: { row: Feature }) {
  return <div>...</div>;
}, (prev, next) => prev.row === next.row);
```

Pair with **stable identity** in the data layer — Zero's `useSyncQuery` returns the same object reference for unchanged rows. If you map the data into new objects on every render, memoization is useless.

### 4. Animate only `transform` and `opacity` (and `filter` sparingly)

These are GPU-composited; the browser handles them off the main thread. Animating `width`, `height`, `top`, `left`, `padding`, `margin`, `font-size`, or any size-affecting property forces layout + paint on every frame and torches your frame rate.

```tsx
// Wrong — animates layout
<div style={{ transition: 'width 200ms', width: open ? 320 : 0 }} />

// Right — animates the GPU-composited transform
<div style={{ transition: 'transform 200ms', transform: open ? 'translateX(0)' : 'translateX(-100%)' }} />
```

If you absolutely need to animate size, use `motion`'s `layout` prop, which uses FLIP under the hood (compute the start/end rects, animate the *transform* between them — not the size).

### 5. Never animate inside a `useEffect` that depends on a frequently-changing value

Animation effects with unstable deps trigger re-render storms. If you find yourself writing `useEffect(() => { setTimeout(...) }, [openCount])`, you're about to fire one timeout per render. Use `motion`'s declarative API (`animate` prop) instead.

### 6. `'use client'` files cannot import server-only code

If a file has `'use client'`, you can't import `lib/db.ts`, `lib/credentials.ts`, or anything in `app/api/`. The build will tree-shake, but the boundary check might not. Keep client/server-only types and functions in separate files; cross via API routes.

### 7. Don't add a dependency you'll only use once

A 50 KB lib for a single gradient effect is not a fair trade. Open the bundle analyzer (`ANALYZE=true npm run build`) before adding any dep over \~5 KB gzip and prove it's worth the cost. If the team has a stalwart utility (e.g. `tw-animate-css` for animations, `lucide-react` for icons), use it instead of pulling a parallel one.

### 8. Always test under "Slow 4G" + "4× CPU throttle" in DevTools

What feels fine on your M3 Pro is unusable on a $300 Chromebook. The harness page is an internal tool — most of the audience is on developer hardware — but the muscle memory matters because it surfaces real perf regressions you'd otherwise miss.

## Soft rules — should follow

### 9. `React.memo`, `useMemo`, `useCallback` — only when measured to help

Premature memoization adds maintenance cost and rarely helps. The exceptions:

* Components in a virtualized list (always memo).
* Components that pass props down a deep tree (memo + stable refs).
* Computations > 1 ms (useMemo). Profile first.

For everything else, React's reconciler is fast enough. Don't `useCallback` every event handler "just in case."

### 10. Use `useDeferredValue` and `useTransition` for slow updates

If a search input filters a 500-row table, the typing should feel snappy and the filtering can lag a few ms. Wrap the filter in `useDeferredValue(query)`; the input updates immediately, the table updates when there's an idle frame.

### 11. Co-locate slow data fetches with `<Suspense>` boundaries

A page that needs both a fast and a slow data source should stream — the fast part renders, the slow part shows a skeleton. Don't block the whole page on the slowest fetch.

```tsx
<Page>
  <FastHeader />
  <Suspense fallback={<SlowChartSkeleton />}>
    <SlowChart />
  </Suspense>
</Page>
```

### 12. Use `<Image>` from `next/image` for any non-icon image

Next handles responsive sizes, AVIF/WebP serving, lazy loading, and proper aspect-ratio CSS. Hand-rolling `<img>` skips all of that and produces a guaranteed CLS regression.

### 13. Move heavy CPU work to a Web Worker

Anything > 50 ms of synchronous JS work blocks user input. Examples that should be in a worker, not the main thread:

* Markdown / code highlighting (we currently do this on main thread — known TODO)
* JSON-Schema → form converter for huge schemas
* Search index building
* CSV / large-payload parsing

The pattern: `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`.

### 14. Lazy-load above-the-fold-but-not-critical features

Plugin tabs in Config aren't visible until the user clicks Config. Tutorial dock isn't visible until invoked. Use `next/dynamic` for these:

```tsx
const ProposalsPanel = dynamic(() => import('./ProposalsPanel'), { ssr: false });
```

Reduces initial bundle for the harness page; the chunk loads when needed.

### 15. Prefer CSS `contain` and `content-visibility` for off-screen work

Tabs that are open but not visible (because their `data-state="inactive"`) still cost layout/paint. Tell the browser to skip them:

```css
.h-tab-content[data-state="inactive"] {
  content-visibility: auto;          /* skip rendering when off-screen */
  contain-intrinsic-size: 800px 600px; /* reserve space so scroll position doesn't jump */
}
```

## Animation rules

Adopting the [animation strategy](#) (see also `lib/forms` style guide for forms):

| Need                                        | Use                                     | Reach for it because                                                                                                                                     |
| ------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal / popover / dropdown / tab open/close | **CSS keyframes on Radix `data-state`** | Native compositor; zero JS cost. The `--ease-out` / `--ease-in` / `--dur-fast` / `--dur-normal` / `--dur-slow` tokens in `globals.css` are the standard. |
| List item add / remove / reorder            | **`@formkit/auto-animate`**             | One-line `useAutoAnimate`. WAAPI direct; zero React re-renders.                                                                                          |
| Counter tweens, choreography, drag, layout  | **`motion`**                            | WAAPI-backed since v10. `<motion.div>`, `AnimatePresence`, `LayoutGroup`.                                                                                |
| Cross-route page transitions                | **`next-transition-router`**            | The shared `RouteTransitionProvider` centralizes navigation choreography and route lifecycle handling.                                                   |
| **Don't use**                               | GSAP, Theatre, react-spring, popmotion  | Either overkill, abandoned, or duplicates of what we already have.                                                                                       |

**Reduced-motion is mandatory**:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

For motion-driven JS animations, wrap the dashboard tree in `<MotionConfig reducedMotion="user">`.

## Network / data rules

### 16. Use the local cache before the network

Zero (`useSyncQuery`) gives us local-first reads. Don't bypass it with `fetch` for data that's already in the replica. Spinners on data we already have are a UX bug.

### 17. Pre-fetch the next likely route

If clicking the harness picker is going to navigate to a different harness, `<Link prefetch>` (default in App Router) loads its JS chunk before the click. Make sure your `Link` components stay as `Link`s and aren't replaced with `router.push` (which doesn't prefetch).

### 18. Cache server responses appropriately

`Cache-Control: max-age=...` on idempotent GET endpoints. SWR semantics where appropriate. Zero takes care of most of this for harness data; keep it consistent for new endpoints.

### 19. `preconnect` to cross-origin API hosts

For Anthropic, Cloudflare, Chatwoot, etc., add `<link rel="preconnect" href="https://api.anthropic.com">` in `app/layout.tsx`. Buys you 100–300 ms on the first request.

## Layout / paint rules

### 20. Avoid layout thrash (read → write → read in the same frame)

Reading geometry (`offsetWidth`, `getBoundingClientRect`) after writing styles forces synchronous layout. Batch reads first, then writes.

```tsx
// Wrong — alternates read and write, forces layout each iteration
items.forEach(el => {
  const w = el.offsetWidth;       // read
  el.style.width = `${w * 2}px`;  // write (forces layout next read)
});

// Right
const widths = items.map(el => el.offsetWidth);  // batch reads
items.forEach((el, i) => el.style.width = `${widths[i] * 2}px`);  // batch writes
```

### 21. Use `transform: translate3d(0,0,0)` to promote heavy elements to their own layer

Only for confirmed-hot elements (a moving canvas, a live-updating chart). Don't sprinkle it everywhere — too many compositor layers tank GPU memory.

### 22. Avoid box-shadows on scrolling elements

Box-shadow forces re-paint on every scroll frame. If you need a shadow on a sticky header, animate via `transform: translateZ(0)` + a static shadow, or use `filter: drop-shadow` which is sometimes composited.

## Measurement — how to know if you broke it

### 23. Use React DevTools Profiler before claiming "it's fast"

Record an interaction. Look at:

* Number of components rendered
* Total render time per commit
* Wasted renders (rendered but result was unchanged)

Target: \< 5 ms per commit on the warm path. If it's > 16 ms, you're below 60fps.

### 24. Run Lighthouse on the harness page weekly

Targets:

* Performance score ≥ 90
* LCP \< 2.5 s
* INP \< 200 ms
* CLS \< 0.1
* TBT \< 300 ms

If any drops, fix it before merging the next feature.

### 25. Use the Performance tab for animation issues

When an animation feels janky:

1. Open Performance tab in Chrome DevTools.
2. Record the interaction.
3. Look at the Frames row. Anything not green (i.e. frames > 16 ms) is dropped.
4. Check the Main row for tasks > 50 ms (long tasks block input).
5. Check the GPU row to confirm transforms/opacity are composited.

### 26. Bundle analyzer before merging a dep

`ANALYZE=true npm run build` (Next.js built-in via `@next/bundle-analyzer`). Look at the route's chunk for unexpected size. Anything > 100 KB on a single route is suspect.

## Anti-patterns we've fallen into before — frontend

These are real frontend regressions we've shipped and reverted:

1. **Spinning loaders for data we already have locally** — fixed for IssuesList in 2026-05-02 (now shows "No issues" instead of spinner). If you find another, kill the spinner.
2. **Using `setState` in a tight loop instead of batching** — caused chat panel scroll jank. Pattern: collect updates, set once.
3. **Importing the entire `lodash` for one helper** — pulled in 70 KB gzip. Use `lodash-es` per-function, or just write the helper inline (most "lodash helpers" are 3 lines).
4. **Animating `height`/`width` on a panel slide** — caused dropped frames. Switched to `transform: translateY`.
5. **Not memoizing RichGrid rows** — caused 200ms commits when status changed in any row. Added `React.memo`.
6. **Fetching the same plugin manifest from 12 components** — Zero deduplicates this for us; trust the cache.

## What NOT to do — server-side / data layer

The 2026-05-03 perf audit found these patterns *had been shipped* and were causing the dashboard's TTFB to be \~19 seconds on localhost. Each one is now in the "do not repeat" list:

### A1. Don't `await` filesystem operations in a serial `for` loop

If you read N files sequentially, **Next.js dev mode adds \~150ms per `fs.readFile`** (HMR file-tracking instrumentation wraps every fs call). 68 files × 150ms = 10 seconds **just from the loop shape**. The same code in plain Node is 14ms.

```ts
// ❌ Wrong — measured 10.9s in Next.js dev for 68 files
for (const h of harnesses) {
  const raw = await fs.readFile(join(dir, h, 'config.json'), 'utf8');
  out[h] = JSON.parse(raw);
}

// ✅ Right — same files, ~150ms (10× speedup, single-call latency)
const results = await Promise.all(harnesses.map(async (h) => {
  const raw = await fs.readFile(join(dir, h, 'config.json'), 'utf8');
  return [h, JSON.parse(raw)] as const;
}));
const out = Object.fromEntries(results);
```

**Why this matters even in production**: it's still wasteful, just less catastrophically so. Always parallelize independent fs reads.

### A2. Don't open one Postgres pool per slug in a serial loop

`getHarnessPg(slug)` opens a postgres-js pool with `max=1` per harness. With \~70 registered projects, calling `getHarnessPg(p.slug)` in a loop opens 70 sequential connections × \~80ms each = **5+ seconds per request**. Found at `harness.get('/projects')` — used to fire every 30s via autoloop AND every dashboard load.

```ts
// ❌ Wrong — sequential pool opens
for (const p of projects) {
  const sql = getHarnessPg(p.slug);
  const row = await sql`SELECT 1 FROM ...`;
}

// ✅ Right — Promise.all parallelizes the pool warmup, OR
//          better yet: single admin-pool query that fans across schemas
const results = await Promise.all(projects.map(p => {
  const sql = getHarnessPg(p.slug);
  return sql`SELECT 1 FROM ...`;
}));
```

**Best**: use the cross-harness `harness_shared.harness_features_consolidated` view (one admin pool, one query) instead of N per-harness pool opens. See [memory: harness\_features cross-harness view](#).

### A3. Don't introduce a heavy and a lite endpoint and have hot paths use the heavy one

`/api/harness/projects` does N×PG-pool-open enrichment per project; `/api/harness/projects/lite` returns the same shape minus the enrichment. Audit found **5+ seconds per call**, hit on every harness page load (including SSR) and every 30-second autoloop tick. A `/lite` endpoint is a smell signal: anywhere a callsite uses the heavy version "just in case," it likely doesn't need the enrichment. Default to lite, justify each upgrade.

### A4. Don't shell out to `psql` / `pg_dump` from runtime code

Replaced with `postgres-js` + `@electric-sql/pglite-tools` in 2026-05-03 (commits `a979073`, `0915a96`, `599755d`). Lint guard at `libs/papercusp-export-state/src/no-psql-shellout.test.ts` blocks regressions. **If you find yourself wanting `spawn('psql', ...)`**, you almost certainly want postgres-js's `sql.unsafe(text)` for SQL apply or `sql\`COPY ... TO STDOUT\`.readable()`for COPY. The only allowlisted exception is`pg-dump.ts`(gated dev fallback) — see memory`project\_psql\_bundling\_deferred.md\`.

### A5. Don't put module-init side effects inside catch-all route handlers

`apps/operator/app/api/[[...route]]/route.ts` has `mountPluginApiRoutes(plugins).then(log)` at module top level. The work is cached via `globalThis`, but **the `.then(log)` always runs**, and Next.js dev mode re-evaluates the module per request, producing log spam (`[plugin-mount] mounted=4 skipped=6 errors=2` repeated dozens of times). Move side effects behind a "first request" guard, not module top-level.

### A6. Don't use `<details>` to gate "lazy" rendering

Native `<details>` keeps its children **mounted in the DOM regardless of `open`**; the browser only toggles visibility. A `<details>`-wrapped 21-row × 100-`<option>` table costs the same as an always-open one. Use the `LazyDetails` component (`apps/operator/app/_components/LazyDetails.tsx`) which actually defers child mount until first toggle-open.

```tsx
// ❌ Wrong — children render even when collapsed
<details>
  <summary>Per-role voices</summary>
  <RoleVoicesTable {...} />  {/* mounts immediately */}
</details>

// ✅ Right — children mount only after first open
<LazyDetails summary="Per-role voices">
  <RoleVoicesTable {...} />
</LazyDetails>
```

### A7. Don't poll on a 500ms cadence "for safety"

Polling cadences should match the data's actual change rate. A 500ms poll for system-voice-list arrival (changes once per page lifetime) is wasted CPU at best, render storm at worst. Cap at 5 attempts then stop. For ongoing polling (action log, scoper-result), use 4s while-something-active / 30s otherwise.

### A8. Don't push the same id twice into a render-key list

```tsx
cs.push({ id: 'replan', ... });   // unified non-destructive replan
// ...
cs.push({ id: 'replan', ... });   // legacy destructive variant — DUPLICATE
```

This **freezes the dashboard**: React's "two children with same key" Console Error fires Next.js's error overlay, which fires Fast Refresh full-reload, which re-renders → same error → infinite loop. Real incident on 2026-05-03; took the dashboard offline. Always grep for `id: 'YOUR_ID'` and `key="YOUR_KEY"` before adding to a registered-list pattern.

### A9. Don't dynamic-import inside a hot loop

```ts
for (const p of projects) {
  const fs = await import('node:fs/promises').then(m => m);  // wrong — per-iteration
  await fs.readFile(...);
}
```

Module imports are cached but the `.then()` chain in a loop still adds promise-microtask overhead per iteration. Hoist all dynamic imports to module scope or hoist them above the loop.

### A10. Radix Dialog focus-trap leaks `pointer-events` — guard with `!important`

Radix's Dialog/cmdk/Modal mount sets two inline styles for focus-scope
locking, and **doesn't always remove them on close**:

1. **`pointer-events: auto` on `Dialog.Content`** — meant to override an
   ancestor's `pointer-events: none`. Leftover after close → the closed
   dialog intercepts every click on the page (`<html> intercepts pointer
   events` is the verdict-cli signature).
2. **`pointer-events: none` on `<body>`** — meant to focus-trap users
   inside the dialog. Leftover after close → the *entire page* is
   unclickable until full reload; appears to the user as "totally frozen."

Both have the same fix: `!important` on the override CSS so the
leftover inline style cannot win. We've hit each one separately:

```css
/* Override the dialog-element leak (first incident: .h-cmd) */
.h-cmd[data-state="closed"] { pointer-events: none !important; }

/* Override the body-element leak (second incident, second freeze) */
html, body { pointer-events: auto !important; }
```

Dialogs still trap focus correctly via `aria-modal` / `aria-hidden` on
their portal overlays, so neither override weakens modal UX — they just
unfreeze the page when the lock leaks.

### A11. Don't fan out from N `useEffect` hooks fetching the same endpoint

The audit captured `/checkpoints` ×2, `/reviews` ×3, `/agents` ×2 in a single dashboard load — one fetch per `useEffect`-mount, no dedup. Each request also pays a 1-2s baseline overhead in Next.js dev mode. Cumulative: 30-60s of wasted server work on page load.

**Pattern to use**: one `useSyncQuery` in a parent component, propagate via context or props. Or migrate to Zero (already wired for many of these tables).

### A12. Don't ship `experimental` Next.js config for features the version doesn't recognize

`experimental.turbopackFileSystemCacheForDev: false` was set for a Next 15 Turbopack bug. Next 16 doesn't recognize it (`⨯ turbopackFileSystemCacheForDev` at boot). Audit before retaining flag-style configs across major Next upgrades; remove ones that show up as `⨯` in the dev log.

### A17. Don't fetch the same per-slug data N times in a Promise.all that varies by sub-key

The `/api/harness/<slug>/phases` handler ran `parseFeatures(scopedProject)` inside `Promise.all(PHASE_ORDER.map((p) => computePhaseInfo(...)))`. The features query returns the same data for all 3 phases (slug doesn't change), but the per-harness PG pool's `max=1` cap meant each Promise.all branch sat in a queue waiting for a connection. Three sequential 5s queries in flight = 15s.

Fix: hoist invariant fetches OUT of the per-iteration loop. One query, pass the result to all branches.

```ts
// ❌ Wrong — each branch issues its own per-slug PG query, serializing
//             on the per-harness pool's max=1 cap.
const out = await Promise.all(PHASE_ORDER.map((p) =>
  computePhaseInfo(project, p)  // calls parseFeatures(slug) internally
));

// ✅ Right — fetch once, pass through.
const features = await parseFeatures(project);
const out = await Promise.all(PHASE_ORDER.map((p) =>
  computePhaseInfo(project, p, features)
));
```

Sounds obvious in isolation but easy to miss when the per-iteration helper hides the fetch. Same pattern as A15 (request-scoped cache) but at a higher level — A15 dedupes WITHIN a single resolveEnv-style helper; A17 dedupes ACROSS calls to the same helper that share an invariant input.

### A18. Don't pin per-process caches to module scope without a globalThis sentinel

Caches declared `const __cache = new Map()` at module top level look durable but **reset every time Next.js dev re-evaluates the module** (visible as repeated `[plugin-mount]` log lines on the catch-all route). The cache key looks like a key but it's effectively per-request because the Map itself is re-allocated.

Fix: pin the cache on `globalThis` so HMR / module re-eval reuses the same Map.

```ts
// ❌ Wrong — Map gets recreated on every module re-eval (Next.js dev
//             with the [[...route]] catch-all does this per request)
const __costCache = new Map<string, CacheEntry>();

// ✅ Right — pinned to globalThis; survives module re-eval
const __cacheKey = '__papercuspCostCache';
type CacheGlobals = { [__cacheKey]?: Map<string, CacheEntry> };
const __costCache: Map<string, CacheEntry> = (() => {
  const g = globalThis as CacheGlobals;
  if (!g[__cacheKey]) g[__cacheKey] = new Map();
  return g[__cacheKey]!;
})();
```

This is the durable-cache idiom Next.js itself uses for things like the Postgres connection pool. Use it for any Map/cache you want to survive across requests in dev mode.

### A19. Don't shell-walk `/proc` per request without a cache

Walking `/proc` to find live processes (e.g., to compute `alive` state for a harness) means N+ sync `readFileSync` calls per request, where N is the total process count on the host (4000+ on a busy dev box). In standalone Node this is \~50-100ms; under Next.js dev's fs instrumentation it can be 5-10 seconds.

Fix: 5-second `globalThis`-pinned cache (alive state doesn't need sub-second freshness).

```ts
// ✅ Right — same shape as A18, with a TTL
type ScanCacheEntry = { ts: number; value: ScanResult };
const KEY = '__papercuspProcScanCache';
function scanProcs(): ScanResult {
  const g = globalThis as { [KEY]?: ScanCacheEntry };
  const now = Date.now();
  const cached = g[KEY];
  if (cached && now - cached.ts < 5000) return cached.value;
  const result = doExpensiveScan();
  g[KEY] = { ts: now, value: result };
  return result;
}
```

For dashboard "is this thing running?" status indicators, 5 seconds is well within the user's tolerance. Don't force the user to wait fresh-data each tick.

### A16. Don't enforce a minimum-visible debounce on a progress indicator

A page-transition library was integrated with `bprogress` to show a
loading bar during route changes. Two constants in `RouteLink.tsx` +
`RouteProgressProvider.tsx` controlled how the bar behaved:

```ts
// ❌ Wrong — measured: every nav showed the bar 3s minimum, regardless of
//             how fast the route actually loaded. With Next.js dev's
//             cold-compile (~3s), perceived nav was 6+s.
const ROUTE_PROGRESS_MIN_VISIBLE_MS = 3000;
const ROUTE_PROGRESS_FALLBACK_MS    = 8000;

// ✅ Right — bar reflects actual pending state; gone the instant the
//            route lands. Cuts ~3s off every navigation.
const ROUTE_PROGRESS_MIN_VISIBLE_MS = 0;
const ROUTE_PROGRESS_FALLBACK_MS    = 1500;
```

A "minimum-visible debounce" on a progress bar conflates two things:

* **Anti-flicker** (the bar shouldn't appear and disappear within a
  single frame for instant routes) — `bprogress` already debounces
  sub-frame transitions internally, so this isn't the caller's job.
* **Padding the perceived load time** (showing the bar longer than
  reality so the user "feels" something happened) — this is the
  *opposite* of useful. The bar lingering after content lands looks
  like a stuck navigation.

Always let the progress indicator reflect actual state. If you find
yourself adding `MIN_VISIBLE_MS` to a polling/loading UI element,
that's the smell.

Same shape applies to spinners (don't show them for >150ms after the
data arrives) and skeletons (swap them out the moment the real content
is ready, not on a fade-timer).

### A15. Don't read the same JSON file repeatedly within one request

Even after parallelizing per-A1, hot endpoints often read the **same** plugin-config or env-config file multiple times in one request. The `/branch/<x>/actions` endpoint discovered this: a manifest with 5 env entries from `@papercupai/cloudflare-pages.json` would do 5 separate `fs.readFile` calls. Multiply by N actions per request and you have NM redundant reads.

Fix: pass a request-scoped `Map<string, Promise<unknown>>` cache through to all the resolution helpers; first reader populates, subsequent readers reuse the same Promise.

```ts
// ❌ Wrong — same file read M times within one resolveEnv call,
//             and again × N for each of N actions in the parent loop
async function resolveEnv(manifest, args) {
  for (const [name, src] of Object.entries(manifest.env)) {
    if (src.from === 'plugin') {
      const cfg = await readJson(`plugin-configs/${src.plugin}.json`); // ← reads again every entry
      ...
    }
  }
}

// ✅ Right — request-scoped cache, awaitable Promise stored once
async function resolveEnv(manifest, args: { readCache?: Map<string, Promise<unknown>> }) {
  const cache = args.readCache ?? new Map();
  const cachedReadJson = (path) => {
    let p = cache.get(path);
    if (!p) { p = readJson(path); cache.set(path, p); }
    return p;
  };
  // ...all entries now share the cache; same path = same Promise = one read
}

// Caller passes ONE Map across N parallel resolveEnv invocations:
const envReadCache = new Map<string, Promise<unknown>>();
await Promise.all(actions.map(a => resolveEnv(a.manifest, { ..., readCache: envReadCache })));
```

Measured: `/branch/<x>/actions` 1.5–3s → 30–590ms (warm 30ms; \~100× per-request speedup on the read fan-out).

The pattern generalizes to any "look up a config field" path called repeatedly per request: pass a Map; let the first reader pay the cost; let everyone else reuse the Promise.

## What NOT to do — agent / API design

### A13. Don't expose unbounded query tools to AI agents

Tools like `query(sql: string)` or `getUsers(ids: int[])` invite N+1 disasters and unbounded cost. Per [the agent-vs-API analysis](https://...), bounded intent-level tools (`getUserActivityForFeature(featureId)`) are strictly better: cost is provable, and agent reasoning about what to do becomes shorter.

### A14. Don't return data without `_meta` annotations on agent-facing endpoints

If an agent calls your endpoint, include observable cost in the response so it can self-correct:

```json
{
  "data": [...],
  "_meta": {
    "tookMs": 47,
    "cacheHit": true,
    "dbRows": 12,
    "hint": "this is the 14th call to /users/<id>/orders this turn — consider /users/orders?ids="
  }
}
```

The `hint` field is the high-leverage one — server has cross-call context the agent doesn't.

## Audit findings — measured (2026-05-03)

The following measurements were taken on `localhost:3055/harness` during a fresh visit. All on localhost (no network latency); all should be a small fraction of these numbers.

| Endpoint / metric                         | Before any fix | After all fixes | Fix(es) applied                                                           |
| ----------------------------------------- | -------------- | --------------- | ------------------------------------------------------------------------- |
| Initial page TTFB (warm)                  | 18.7s          | **83ms**        | sum of all fixes below                                                    |
| Initial domReady (warm)                   | 21.9s          | **116ms**       | sum of all fixes below                                                    |
| `/api/plugins/enabled` (4KB)              | 18-26s         | **92ms**        | A1: parallelize fs reads                                                  |
| `/api/harness/projects`                   | 5-8s           | **2.6s**        | A1+A9: parallelize fs reads + merge passes                                |
| `/api/harness/projects/lite`              | n/a (added)    | **0.15-0.6s**   | A3: hot paths migrated to /lite                                           |
| `/api/harness/<slug>/log/stream?tail=500` | 6.6s           | **0.3-2s**      | tail-only file read + batched SSE write                                   |
| `/api/harness/<slug>/branch/<x>/actions`  | 6-10s          | **30-590ms**    | A1+A15: parallelize discovery + dedup'd resolveEnv reads via shared cache |
| `/api/templates`                          | slow (loop)    | **53ms**        | A1: parallelize template manifest scan                                    |
| Dashboard freeze ("7 issues")             | infinite loop  | **clean**       | A8: dedup'd `replan` key                                                  |
| Click responsiveness                      | 5s timeout     | **instant**     | A10: Radix `pointer-events: none !important`                              |

**Compounded result: \~225× speedup on warm-cache TTFB (18.7s → 83ms); the dashboard now feels native on localhost.** Patterns codified into a CI-enforced lint test at `packages/operator-core/lib/perf-anti-patterns.test.ts` — see "Compliance" below.

### Recurring patterns observed across all the fixes

Eight separate slow endpoints reduced to **two** root patterns:

1. **Serial fs/PG reads in a loop** (A1, A2, A9) — eight callsites, each producing 5–25s of dead time. `Promise.all` collapses them to single-call latency. The fact that this happened EVERYWHERE (operator, libraries, deeply nested) is a signal that the synchronous-mental-model leaks into async code by default. Treat **any new** loop-with-await as suspect.

2. **Repeated reads of the same file/config within one request** (A15) — even after parallelizing, the *same file* gets read N times when N actions reference it. A request-scoped Map cache turns N×M reads into N+1.

A third pattern is harder to catch but biggest in absolute pain:

3. **Radix focus-trap inline-style leaks** (A10) — twice in one session, the page went "totally frozen" because Radix left a `pointer-events` inline style on a DOM element after the dialog closed. Both leaks were on different elements (`.h-cmd` and `<body>`) but had the same root: Radix lifecycle bugs we don't control. The fix is always `!important` on the override CSS; trust the dialog's `aria-modal` for actual focus-trap semantics.

### What this session demonstrated

* **20-second mystery endpoints are usually one of the patterns above.** Don't reach for "Next.js dev mode is just slow"; instrument the handler with `t0/t1` markers, find the actual bottleneck, parallelize.
* **The `/lite` endpoint pattern is a smell.** If you have `/things` and `/things/lite`, every callsite using `/things` "just in case" is overpaying. Default to `/lite`; justify each upgrade.
* **Lint guards beat memory.** Patterns added to `perf-anti-patterns.test.ts` are caught at CI time. Patterns that only live in this doc require humans to remember.
* **The BASELINE ratchet works.** Started at 9 grandfathered offenders, now at 1. The stale-baseline check forces the list to shrink as fixes land, so this isn't "permanent debt" — it's a queue.

## Compliance — how to use this page

**Before any change**:

1. Read this page once if you haven't (subsequent reads can skim the "What NOT to do" sections as a checklist).
2. If your change matches an A1–A15 anti-pattern, **change the approach** before writing the code.
3. If you find a NEW pattern that should be in this list, add it as A16+ with measurement, then add a corresponding rule to the lint test if it's regex-detectable.

### Automated guard

`packages/operator-core/lib/perf-anti-patterns.test.ts` is a vitest CI guard that codifies the regex-detectable rules. As of the latest update, it covers:

| Rule   | What it catches                                                          |
| ------ | ------------------------------------------------------------------------ |
| **A1** | `for { … await fs.readFile … }` — serial fs reads in a loop              |
| **A2** | `for { … getHarnessPg(…) … }` — per-slug PG pool open in a loop          |
| **A4** | `spawn('psql' / 'pg_dump', …)` — runtime shell-out to PG client binaries |
| **A6** | `<details>` wrapping a heavy JSX component (use `LazyDetails`)           |
| **A7** | `setInterval(…, 500)` — 500 ms "safety" polling                          |
| **A9** | `for { … await import("…") … }` — dynamic import inside a hot loop       |

Rules NOT regex-detectable (and so checked manually / via runtime symptoms): A3, A5, A8, A10, A11, A12, A13, A14, A15.

### Ratchet pattern

The test ratchets via a `BASELINE` constant — existing offenders are grandfathered, only NEW occurrences fail CI. The baseline shrinks over time as offenders are fixed; a paired stale-baseline check forces the list to actually shrink (BASELINE entries that no longer match real hits also fail the test).

Current BASELINE — 1 reasoned exception:

```ts
A7: app/settings/voice/page.tsx   (justified — bounded 5-attempt cap on
                                   SpeechSynthesis.voiceschanged detection, total ≤ 2.5s)
```

(The earlier A1 `plugin-runtime` and A6 `OperatorPanel.tsx` entries are gone: the Next
plugin-runtime route was retired — its successor
`lib/endpoint-route/routes/plugin-runtime/catchall.ts` carries inline `// perf:allow A1`
directives instead — and `OperatorPanel.tsx` was deleted with the scanner card stream.)

To intentionally allow a single line, append `// perf:allow A<N> <reason>` to it.

### Before merging

1. **Run the perf guard**: `cd packages/operator-core && npx vitest run lib/perf-anti-patterns.test.ts`
2. **Test the affected endpoint** with `time curl http://localhost:3055/<your-endpoint>` — should match the targets at the top of this page (localhost endpoints should be a small fraction of stated network latencies).
3. **Verify no new issues in the `/harness` page console** via verdict-cli:
   ```
   verdict goto http://localhost:3055/harness && verdict console error
   ```
4. **Watch the dev server log** for new `⚠ Fast Refresh full reload` lines — those signal the duplicate-key issue we fixed in A8. Also watch for `[plugin-mount]` log spam, which signals A5 module re-evaluation.
5. **If the page goes "totally frozen"**: it's almost certainly A10 — either inline `pointer-events: auto` left on a closed Radix dialog (covers clicks) or inline `pointer-events: none` left on `<body>` (entire page unclickable). Both fixes are `!important` overrides; see A10 for the snippets.

## Cheat sheet — what to do, in order

When you're about to write or change a component:

1. Can it be a Server Component? **Default to yes.**
2. If client, can the `'use client'` boundary be smaller?
3. Will it render in a list of more than 50 items? **Virtualize and memoize.**
4. Does it have an animation? **CSS first; auto-animate for lists; motion last.**
5. Does it fetch data? **Use Zero or `<Suspense>`. Optimistic on mutations.**
6. Did you measure with React DevTools Profiler? **Do it before merging.**

Adopting these is what makes the difference between "okay app" and "feels like Linear." Every rule on this page came from a real regression we've shipped or fixed; none of them are speculative.

## See also

* [Library reference](/internal/docs/design/libraries) — the canonical libs
* [Gotchas](/internal/docs/design/gotchas) — sharp edges in the existing UI
* React docs: [`memo`](https://react.dev/reference/react/memo), [`useMemo`](https://react.dev/reference/react/useMemo), [`useDeferredValue`](https://react.dev/reference/react/useDeferredValue), [`useTransition`](https://react.dev/reference/react/useTransition), [`Suspense`](https://react.dev/reference/react/Suspense)
* Next.js: [optimizing](https://nextjs.org/docs/app/building-your-application/optimizing)
* Web Vitals: [INP](https://web.dev/articles/inp), [LCP](https://web.dev/articles/lcp), [CLS](https://web.dev/articles/cls)

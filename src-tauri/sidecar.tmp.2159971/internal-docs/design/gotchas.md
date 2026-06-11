# Gotchas, performance, and migration anti-patterns
URL: /internal/docs/design/gotchas

Sharp edges, perf budgets, and traps caught during the original migration.

import { Aside } from '@astrojs/starlight/components';

This page collects the non-obvious things — "I would have stepped on this if you hadn't told me" — found during the multi-phase library migration of the harness page. Skim before making UI changes.

## The `data-state` vs `aria-selected` trap (Radix Tabs)

When you use `@radix-ui/react-tabs` without an associated `<Tabs.Content>` for each trigger, **Radix only sets `aria-selected="true"` on the active trigger — it does NOT set `data-state="active"`.** Reason: with no `<Tabs.Content>`, there's nothing to "open"; Radix considers the tab semantically selected but not "active".

This bites when you write CSS like:

```css
.h-tab[data-state="active"] {
  background: var(--bg-3);
}
```

…and your styling silently never fires.

**Fix:** target `aria-selected="true"` instead.

```css
/* For tabs without Tabs.Content (filter pills + imperative content render) */
.h-tab[aria-selected="true"] {
  background: var(--bg-3);
}

/* For tabs WITH Tabs.Content */
.my-tab[data-state="active"] {
  background: var(--bg-3);
}
```

`harness.css` has examples of both at the bottom.

## Native `title=` is fine in grid cells, NOT on actions

The "no native title=" rule is a soft rule, not a hard one.

**Use `<Tooltip label>` for action elements** — buttons, status badges, IconButtons, anywhere the user might hover for a hint about what clicking does.

**Use native `title=` for grid-cell truncation tooltips** — when you have thousands of `<RichGrid>` rows and each cell wants "show full text on hover when truncated". Wrapping every cell in a Radix Tooltip mounts thousands of portals + listeners and noticeably hits scroll performance. Native `title=` is browser-built-in, free, and accessible-enough for data hover.

A tell that you should use native `title=`: the value is dynamic and per-row (`title={row.title}`), not a static label. Static action-button hints almost always belong in `<Tooltip>`.

## Native `<details>` is fine for content disclosure, NOT for interactive components

The HR6 "never `<details>`" rule is for *interactive* disclosure widgets — the kind that need shared focus styles, animation, and ARIA state with the rest of the harness. For **content disclosure** (prose, diagnostic dumps, debug help text — anything the user reads but doesn't act on), native `<details>` is the better primitive:

* It lazy-mounts its `<summary>` content until first open. Radix `<Collapsible>` mounts children eagerly, so wrapping a heavy renderer (Monaco, MarkdownPreview, JSON tree) in Collapsible pays the render cost on every page load even when collapsed.
* Browser Ctrl+F finds text inside collapsed `<details>` on modern Chromium (`hidden-until-found`). Collapsible content is `display:none` and invisible to find-in-page.
* Browsers auto-expand all `<details>` on print. Collapsible needs JS to expand before print.

Approved content-disclosure `<details>` sites:

* `app/_components/WslOnboardingGate.tsx` — diagnostics dump on the setup overlay
* `app/support/page.tsx` — help text
* `app/settings/api-keys/page.tsx` — provider help text
* `app/settings/user/memory/page.tsx` — embed-mode help
* `app/settings/voice/page.tsx` — debug precedence matrix
* `app/_components/LazyDetails.tsx` — explicit lazy-mount wrapper, by design
* `app/harness/dock/PinnedIssuePanel.tsx` — JSON-notes dump + body sections
* `app/harness/dock/PinnedFeaturePanel.tsx` — JSON-metadata + notes dumps
* `app/dev/_components/SessionsTab.tsx` — transcript JSON dump
* `app/dev/_components/TablesTab.tsx` — table-row JSON dumps
* `app/_components/SetupWizard/StepAutoUpdate.tsx` — release-notes prose

A tell that `<details>` is correct: the content is prose (or auto-generated text), the user doesn't tab/select inside it, and rendering it costs real work (Monaco, MarkdownPreview, a long log dump). Interactive disclosures — collapsible form sections, per-row expanders inside lists where you want shared animation and focus management — still use `<Collapsible>`.

## Native checkbox / radio / range — `accent-color` is the carve-out, NOT the migration

`globals.css` applies `accent-color: var(--accent)` to native `<input type="checkbox|radio|range">`. This makes the OS-rendered control's tint match the app accent without breaking semantics — a strict improvement, never a workaround.

**Do not read this as "native checkboxes are fine now."** HR2 is still absolute for harness UI: use `<Checkbox>`. The wrapper exposes `indeterminate` declaratively, gives us a stable `data-state` hook, and owns focus styling. None of that comes from `accent-color`.

The carve-out is narrow: native checkboxes that legitimately can't be wrapped (markdown task lists rendered via `MarkdownPreview`, low-priority radio groups where a `<RadioGroup>` would be overkill, range sliders that are bespoke per-site anyway). When in doubt, wrap.

## Floating widgets that pin to a viewport corner are NOT centered Modals

A few surfaces — the Deck (`OperatorChatSidebar`, the fixed-left full-height `.operator-panel` chat) and `OracleDock` (the chat dock) — are floating, viewport-anchored panels with their own bespoke animations (GSAP, `motion` `AnimatePresence`, HUD overlays). They're not centered modals (Modal would yank them to screen-center and add a backdrop), not anchored Popovers (no trigger to align to), and not side Drawers (they don't slide in from the edge).

For these, the correct pattern is a hand-written `role="dialog"` + `aria-label` on the container, with positioning + animation owned by the component. HR1 doesn't apply here; the rule's intent ("focus management + escape handling come from the wrapper") doesn't fit a panel that lives forever on screen and toggles open/closed via its own state machine. Treat the Deck and OracleDock as the canonical exceptions; if you add a new floating-corner-widget pattern, document it next to them.

## Radix Select doesn't allow empty-string values

`<Select value="">` is reserved by Radix Select to mean "no value selected" — same as `<Select value={undefined}>`. If your business logic uses `''` as a real value (e.g., "default mode"), Radix Select will display the placeholder when you actually mean to display "default".

**Fix:** translate at the boundary.

```tsx
<Select
  value={mode || '_default'}
  onChange={(v) => setMode(v === '_default' ? '' : v)}
  options={[{ value: '_default', label: 'default' }, { value: 'ceo', label: 'ceo' }]}
/>
```

Use a sentinel like `'_default'` that's guaranteed not to collide with a real value, and translate in `onChange`.

## Vaul drawer needs an explicit Title

Radix Dialog's accessibility check warns if you don't render a `<Dialog.Title>`. Vaul reuses the Dialog primitive internally and inherits the same check. Always include a sr-only Title:

```tsx
<Drawer.Title style={{
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
}}>
  Feature {feature.id}
</Drawer.Title>
```

## Modal overlay click vs ESC

Radix Dialog's outside-click is implemented as a `pointerdown` event on the overlay, not a `click`. If you're writing tests that "click outside to close", dispatch a `pointerdown` event, not a `click`:

```js
const overlay = document.querySelector('[data-state=open][role!=dialog]');
overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
```

ESC works as expected via `keydown`.

## Tooltip needs real pointer events to fire

When testing tooltips programmatically, synthetic `MouseEvent('mouseenter')` doesn't trigger Radix Tooltip's open state. You need real pointer events from a browser-driver (Playwright `page.hover()` works; `verdict hover @e18` works).

This is a Radix design choice (focus on real input intent, not synthetic dispatches) — there's no workaround beyond using a real driver.

## cmdk groups hide automatically when filtering

When the user types in `<Command.Input>`, cmdk filters items by their `value` prop. If a `<Command.Group>` ends up with zero matching children, cmdk **hides the entire group, including the heading.** This is the right UX, but if you're testing or debugging, your group's heading vanishing is expected behavior, not a bug.

Use `<Command.Group hidden={false}>` to force-show, or check the `[hidden]` attr in DevTools.

## Performance budget — what's reasonable

These are the numbers we measured after the original migration. Use them as floors; if your change makes any of these significantly worse, investigate.

| Interaction                                       | Dev mode         | Production target |
| ------------------------------------------------- | ---------------- | ----------------- |
| Cold page load (HTTP `time_total`)                | 0.87 – 1.21s     | \< 200ms          |
| Inner tab switch (e.g., Inbox All → Threads)      | \~150ms          | \~50ms            |
| Command palette open (Dialog mount + cmdk wiring) | \~314ms          | \~100ms           |
| Modal open/close cycle                            | \~100ms          | \~30ms            |
| Memory after 10 modal open/close cycles           | 0 KB heap growth | 0 KB heap growth  |

If you're adding a new modal or a new heavy panel and tab switches start feeling sluggish (>300ms in dev), check:

1. Are you mounting heavy children eagerly when the modal closes? Use lazy / dynamic imports or guard rendering with `{open && <…/>}`.
2. Did you wrap a frequently-rendered grid cell in `<Tooltip>`? See "Native `title=` is fine in grid cells".
3. Did a useEffect get added that runs every render? Check deps.

## Bundle-size budget

The original migration added \~55 KB gzipped to the harness route's JS payload. Library-by-library:

| Library                       | Gzipped |
| ----------------------------- | ------- |
| `@radix-ui/react-tooltip`     | \~5 KB  |
| `@radix-ui/react-dialog`      | \~10 KB |
| `@radix-ui/react-tabs`        | \~5 KB  |
| `@radix-ui/react-select`      | \~12 KB |
| `@radix-ui/react-checkbox`    | \~3 KB  |
| `@radix-ui/react-collapsible` | \~3 KB  |
| `vaul`                        | \~6 KB  |
| `cmdk`                        | \~10 KB |

If you find yourself reaching for a NEW library not in this list, ask first. Most cases the existing set covers — see the [decision matrix](/internal/docs/design).

## Per-field-settings pages — don't reach for RHF

If you're looking at `/settings/voice`, `/settings/backups`, `/settings/operator`, or any other settings page where each control persists independently (no Submit button, no atomic "save the whole form" gesture), **do not migrate it to `useFormWith`**. That conflates the page's model with what RHF was built for. Use `useDebouncedSave(value, persist)` per field instead — full pattern is in [libraries: Form patterns](/internal/docs/design/libraries#form-patterns--picking-the-right-model).

Symptoms that mean you've picked the wrong pattern:

* You're calling `getValues()` from a "Test microphone" / "Test connection" button just to read the user's current draft.
* You wrote a custom `watch()` + debounce on top of RHF to re-create auto-save semantics.
* `isDirty` is permanently `false` even though the user clearly made changes (because you've manually flushed each one).

If any of those, stop and switch to `useDebouncedSave`. HR1/HR2/HR3/HR6 still apply — the `<Modal>` / `<Checkbox>` / `<Select>` / `<Collapsible>` wrappers are still required. You're only opting out of RHF's central form-state model.

## CSS-token lint catches undefined `var(--X)` references

Every `var(--X)` reference in a `.tsx` file must resolve to a token defined in `app/globals.css`, `app/_semantic.css`, or `app/_brand-primitives.css` — or be in the runtime-allowlist (`--radix-*`, `--op-chat-w`).

The lint lives at `app/_lints/css-tokens.test.ts` and runs as part of the operator's unit test suite. When it fails the error message lists every undefined token + the files using it, plus the canonical operator vocabulary to map to (`--bg`, `--bg-2`, `--bg-3`, `--fg`, `--fg-dim`, `--fg-mute`, `--border`, `--accent`, `--good`, `--warn`, `--bad`, etc.).

**Common regressions the lint catches:**

* shadcn vocabulary leaking in: `--card`, `--muted-foreground`, `--foreground`
* Tailwind-aliased semantic names: `--danger`, `--ok`, `--success`
* Inverted re-use of swept names: `--text-1`, `--text-2`, `--text-3`, `--pc-*`
* Starlight tokens in operator code: `--sl-color-*`

**If you legitimately need a new token:** define it in `app/_semantic.css` (regenerated from `design-tokens/` via `npm run tokens`) or in `app/globals.css :root` for a one-off semantic alias. Don't add it to the runtime allowlist unless a framework genuinely sets it at runtime.

## Migration anti-patterns

Things we did wrong during the migration and had to back out — don't repeat:

*Historical note: the operator has since migrated off Next.js/Turbopack to a
Vite SPA (TanStack Router) + Hono host. The Turbopack-, `.next/`-, and
`next/dynamic()`-specific items below are kept as migration history; they no
longer describe the live build (use Vite's own dynamic-import / lazy patterns
now), but the non-Next items (the regex/stack-walker and the Radix
`data-state` one) still apply.*

* **Don't write a Python regex that captures `.+?` between `<div>` tags.** Self-closing `<div/>` tags throw off the depth counter. Use a stack-based walker that distinguishes `<div ... />` from `<div ...>`.

* **Don't add a `tsconfig.json` to a sub-package to fix `.js`-extension resolution under Turbopack.** Turbopack doesn't honor sub-package tsconfigs for files outside the project's own `tsconfig.json` `include`. We tried; it didn't help. The actual fix was a local copy at `apps/operator/lib/...` that bypassed the package barrel.

* **Don't delete `.next/` to force a recompile.** The dev server gets wedged because it can't find its build manifests. Touch a source file or restart the server entirely instead.

* **Don't rely on `await import()` to lazy-load.** Turbopack statically traces dynamic imports too. To genuinely defer, you need either (a) the library lazy-loaded via Next.js's `dynamic()`, or (b) a constructed import path (`new Function('s', 'return import(s)')`) — but (b) is fragile and we ended up not needing it.

* **Don't compare `data-state` on Radix Tabs triggers when there's no `<Tabs.Content>`.** Compare `aria-selected`. (Repeating because this is the most subtle one.)

## When the agent population is large

Multiple agents working on the same files concurrently is normal here. The harness is the substrate's most-edited surface. Best practices:

1. **Run an audit before you start.** `grep -lE "from './Tooltip'"` etc. tells you which files use which library. If your file isn't in the list and the pattern says it should, that's a regression to fix.

2. **Run an audit after you finish.** Re-grep. If a file you edited dropped its `Tooltip` import while you were adding new functionality, you reintroduced native `title=` or stripped a wrap by accident.

3. **Don't blanket-replace.** A Python script that mass-removes `<Tooltip>` wrappers (because some IDE auto-import suggested them as redundant) will silently revert dozens of files. We've seen this happen.

4. **When in doubt, look at a working example.** The "where to look" table on the [overview page](/internal/docs/design) lists a canonical example for each pattern.

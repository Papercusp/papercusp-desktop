# Library reference
URL: /internal/docs/design/libraries

Per-library notes — what we use it for, why this one, version, install location.

import { Aside } from '@astrojs/starlight/components';

All libraries below are installed in `apps/operator/package.json` and resolved through the monorepo root `node_modules`. Total bundle delta from the migration was \~55 KB gzipped across the harness routes, all tree-shakable.

## `@radix-ui/react-tooltip`

**What:** Hover/focus tooltip primitive. WAI-ARIA `tooltip` role, focus-aware, touch-friendly, keyboard-navigable.

**Why this one:** Radix is the de facto standard for headless UI primitives in React. Same family as `@radix-ui/react-hover-card` already in the codebase, so peer-deps align automatically. Maintained by WorkOS, used by Vercel, Linear, and most of the React ecosystem. Tiny (\~5 KB gzipped) and tree-shakable.

**Why not `react-tooltip`?** Older, heavier, less accessible. Why not native `title=`? See [gotchas](/internal/docs/design/gotchas) — it has UX problems we lived through.

**Wrapper:** `app/harness/Tooltip.tsx` exports `<Tooltip label={...}>{trigger}</Tooltip>`. Returns the trigger unchanged when `label` is falsy. Trigger receives `asChild` so the underlying button/span keeps its DOM identity.

**Provider:** Wrapped once in the Vite SPA root (`apps/operator-vite/src/routes/__root.tsx`) with `delayDuration={150} skipDelayDuration={300}` — opens after 150ms, but consecutive tooltips open instantly within 300ms of the last close (keeps quick scans fast).

## `@radix-ui/react-dialog`

**What:** Modal dialog primitive. Provides focus trap, focus restoration on close, scroll lock, portal rendering, and ESC + outside-click handling.

**Why this one:** Same Radix family. The hand-rolled alternatives we tried (`<div role="dialog" aria-modal>`) consistently lost focus trap on tab cycling, missed scroll lock on iOS, and raced ESC against other listeners. Dialog gives us all four for free.

**Wrapper:** `app/harness/Modal.tsx` matches the harness's centered-modal visual (rgba(0,0,0,0.75) overlay, fixed inset, content centered, \~zIndex 60). Accepts `contentStyle` for sizing, `overlayStyle` to tweak backdrop, `zIndex` for stacking. Always provide `title` (sr-only renders if `srOnlyTitle`) for screen readers.

**Programmatic close:** `onOpenChange={(o) => { if (!o) onClose(); }}`. To prevent ESC or outside-click closing: `closeOnEscape={false}` / `closeOnOutsideClick={false}`.

## `vaul`

**What:** Drawer primitive (right/left/bottom/top slide-in panels). Drag-to-dismiss, focus trap, scroll lock, ARIA — all handled.

**Why this one:** Built by Emil Kowalski (Vercel design engineer). Drag gestures and momentum are surprisingly hard to get right; vaul does. We use it for the right-side feature peek panel (`FeaturePeekPanel.tsx`) and the issue detail panel (`issues/IssueDetail.tsx`).

**Why not Radix Dialog with `direction`?** Radix doesn't have a slide direction concept; you'd hand-roll the transform. vaul is dialog-equivalent for drawers and shipped specifically for this use case.

**Usage:** `<Drawer.Root open onOpenChange direction="right"><Drawer.Portal><Drawer.Overlay/><Drawer.Content>…</Drawer.Content></Drawer.Portal></Drawer.Root>`. Always include `<Drawer.Title className="sr-only">` for accessibility.

## `cmdk`

**What:** Command palette primitive. Built by Paco Coursey (Vercel). Powers the launchers in Linear, Raycast, Vercel's dashboard, and many others.

**Why this one:** Hand-rolling a command palette means re-implementing fuzzy filtering, keyboard nav (↑/↓/Enter/Escape), focus management, group rendering, virtualization, and accessibility. cmdk does all of that out of the box. We pair it with `@radix-ui/react-dialog` for the shell.

**Usage:** `<Dialog.Root><Command label loop shouldFilter><Command.Input/><Command.List><Command.Empty/><Command.Group heading="…"><Command.Item value onSelect>…</Command.Item></Command.Group></Command.List></Command>`. The `value` on each Item is what cmdk fuzzy-searches.

**File:** `CommandPalette.tsx` — the harness ⌘K palette.

## `@radix-ui/react-tabs`

**What:** Tab primitive. Real ARIA tablist + tab + tabpanel.

**Why this one:** Same Radix family. Handles activation modes (automatic vs manual), keyboard nav (arrows, home/end), and `aria-selected` automatically.

**Two usage patterns:**

1. **Real tabs with content panels** — wrap each panel in `<Tabs.Content value="…">`. Radix sets `data-state="active"` on the trigger when the matching content is open. See `BrainstormFull.tsx`.

2. **Filter pills (shared content)** — render content imperatively based on `Tabs.Root`'s `value` (no `<Tabs.Content>`). Radix only sets `aria-selected="true"` (not `data-state`). See `ArchitectInbox.tsx`, `ProposalsPanel.tsx`, `HarnessDashboard.tsx` (9-tab nav).

If your tabs render content imperatively (no `<Tabs.Content>`), Radix only flips `aria-selected`, not `data-state`. Bridge with `[aria-selected="true"]` selectors in `harness.css`. See [gotchas](/internal/docs/design/gotchas) for the trap.

## `@radix-ui/react-select`

**What:** Single-select dropdown primitive. Renders a button trigger + portaled listbox.

**Why this one:** Native `<select>` is OS-themed (white-on-macOS, blue-highlight-on-Windows) and ignores our dark theme. Radix Select gives us full control: themed trigger, portal-positioned listbox that handles viewport edges, proper keyboard search ("type-ahead"), `<optgroup>` analog (`<Select.Group>` + `<Select.Label>`), and `<ItemIndicator>` for the current selection.

**Wrapper:** `app/harness/Select.tsx` exports `<Select value onChange options>` with a flat options array. For grouped options (like the project picker with org/department/coding sections), inline Radix Select directly — see `HarnessDashboard.tsx`.

Radix Select reserves `value=""` to mean "no value selected". If your business logic uses `''` as a sentinel for "default mode", map to a non-empty string at the boundary: `value={mode || '_default'} onChange={(v) => setMode(v === '_default' ? '' : v)}`. See `DepartmentHarnessDashboard.tsx`'s mode select.

## Native `<input>` + `<textarea>` (styled via `globals.css` baseline)

**What:** The operator app's `globals.css` adds a `:where(input, textarea)` baseline so every unwrapped native input picks up the same dark-theme look as the `<Select>` trigger: `var(--bg-2)` background, `var(--border)` border, `border-radius: 4`, font-size 12, `4px 8px` padding. Focus state gets an accent-tinted ring.

**Why this one:** Inputs are scattered across hundreds of sites; migrating every one to a wrapper would be high-churn for low marginal value. A single CSS rule with `:where(...)` specificity 0 fixes the visual problem in one place — any site with an inline style or class wins, so bespoke surfaces (marketplace search, OracleDock composer, etc.) keep their custom look.

**Selector list** (intentionally narrow): `input[type=text|number|email|search|tel|url|password|date|time|datetime-local]`, untyped `<input>`, and `<textarea>`. Excluded: `checkbox`/`radio` (use `<Checkbox>`), `range`/`color`/`file` (bespoke widgets), `submit`/`button` (button styling).

**Number-input spinner buttons** are suppressed app-wide. Numeric input still works; the up/down arrows just stop drawing.

## `<Button>` wrapper + native baseline

In-page buttons get a solid/tinted fill, a 1px border, and readable text — **no** embossed bevel, raised drop-shadow/glow, hover-lift, or "sheen" gradient. Hover/active changes colour, not elevation. See [Buttons](/internal/docs/design#buttons) for the recipe and anti-patterns (this is hard rule 9). On `/adv` a scoped `.pc-advshell__body` rule enforces it; the top tab strip is exempt.

**What:** `globals.css` adds a baseline for native `<button>` so unwrapped action buttons (Save, Add override, Clear, Cancel, +Filter, etc.) pick up the same dark-theme look as the `<Select>` trigger. The `<Button>` wrapper at `app/harness/Button.tsx` layers on three variants for the cases where more emphasis is needed:

* `variant="primary"` — filled accent for the page's primary CTA
* `variant="destructive"` — red tint for delete / clear / forget actions
* `variant="ghost"` — transparent until hovered, for low-emphasis chrome

**When to use which:**

* Most action buttons should be **unwrapped** — the global baseline already styles them.
* Use `<Button variant="primary">` for the **one** save/submit button on a page. Don't sprinkle primary buttons everywhere; the variant is for the dominant action.
* Use `<Button variant="destructive">` whenever the button triggers `useConfirmDialog({ destructive: true })` — the visual and the confirm modal both signal "this is dangerous."
* Use `<Button variant="ghost">` for icon-only buttons in toolbars or for "Cancel" in a modal footer where you want the primary button to dominate.

```tsx
import { Button } from '@/app/harness/Button';

<Button variant="primary" onClick={handleSubmit}>Save</Button>
<Button variant="destructive" onClick={handleDelete}>Delete forever</Button>
<Button>Cancel</Button>  {/* baseline neutral */}
<Button variant="ghost"><X size={12}/></Button>
```

The wrapper forwards refs and spreads all native button props. `type` defaults to `"button"` so you don't accidentally submit a form.

**The variant classes** (`.pc-btn-primary`, `.pc-btn-destructive`, `.pc-btn-ghost`) can also be applied directly to a native `<button>` if you don't want the wrapper — same visual result.

## `<TextInput>` + `<TextArea>` wrappers

**What:** Canonical text-entry wrappers at `app/harness/TextInput.tsx`. Re-exports `<input>` / `<textarea>` with the baseline style plus first-class `leading` and `trailing` slots.

**Why use the wrapper:**

* You need a leading or trailing element inside the bordered container (icon, prefix, unit, clear-x button).
* You want the canonical class hook (`.pc-text-input`) for future restyling.
* You want to opt out of any inline-style cascade a parent might be applying.

**When the baseline is enough:** simple `<input type="text" value … onChange …>` lines — the global CSS rule already styles them. Don't introduce the wrapper just to look identical to surrounding inputs.

**Don't override the baseline with inline styles.** Applying `style={{ background, border, borderRadius, padding }}` to an `<input>` or `<textarea>` drifts the look away from the canonical baseline (and away from every other input in the harness). If you need a different look in one place, reach for `<TextInput>` and document the deviation; if you need it everywhere, change the baseline in `globals.css`. A page-local `inputStyleSmall` const that re-states `background: 'var(--bg-3)'` is the failure mode this rule names.

```tsx
import { TextInput, TextArea } from '@/app/harness/TextInput';

<TextInput
  type="number"
  value={n}
  onChange={(e) => setN(Number(e.target.value))}
  min={1}
  max={64}
  style={{ width: 64 }}
/>

<TextInput
  type="search"
  placeholder="filter…"
  value={q}
  onChange={(e) => setQ(e.target.value)}
  leading={<SearchIcon size={12} />}
  trailing={q && <button onClick={() => setQ('')}>×</button>}
/>

<TextArea
  value={body}
  onChange={(e) => setBody(e.target.value)}
  rows={6}
  placeholder="Notes…"
/>
```

The wrapper forwards refs and spreads all native props.

## Native checkbox / radio / range — `accent-color` baseline

**What:** `globals.css` adds `accent-color: var(--accent)` to native `<input type="checkbox|radio|range">`. The native control's tint (checkmark fill, radio dot, slider track + thumb) recolors to the app accent without breaking the OS rendering or accessibility semantics.

**Why this exists alongside HR2:** the wrapper is still required for harness interactive UI (HR2 explicit). This is the baseline for native controls that *legitimately can't* be wrapped:

* `<input type="checkbox">` inside `MarkdownPreview` (rendered from text — the React wrapper isn't reachable)
* Native radios in low-priority sites (`/settings/backups` cadence/retention pickers, `/settings/agent` backend picker, `SetupWizard` channel selector) — there's no `<RadioGroup>` wrapper because the cost/benefit doesn't justify one for \~5 sites
* `<input type="range">` (voice TTS rate, chat scale, sketch brush size) — bespoke per-site; `accent-color` is the cross-cutting tint

**No wrapper for radios.** Considered. Rejected: \~5 sites, no indeterminate / multi-state need, no a11y issue with native radios, and Radix `react-radio-group` would still need bespoke styling per site to match the harness theme. Native + `accent-color` is enough.

## `@radix-ui/react-checkbox`

**What:** Checkbox primitive. Supports `checked={true | false | 'indeterminate'}`.

**Why this one:** Native `<input type="checkbox">` can't render the indeterminate state declaratively (you have to set `el.indeterminate = true` after mount, awkward in React). It also fights the dark theme and uses OS check styling. Radix renders a `<button role="checkbox">` with a `<Checkbox.Indicator>` slot we control.

**Wrapper:** `app/harness/Checkbox.tsx` exports `<Checkbox checked onChange indeterminate>`. We use lucide `Check` for the checked state and `Minus` for indeterminate.

**Grid cells:** When using inside a `RichGrid` row render, wrap with `<span onClick={(e) => e.stopPropagation()}>` so clicking the checkbox doesn't trigger the row's click handler. See `FeatureList.tsx`, `ProposalsPanel.tsx`.

## `@radix-ui/react-collapsible`

**What:** Disclosure primitive (single-section show/hide).

**Why this one:** Same Radix family. Native `<details>` works but doesn't share our focus styles or animation system, and doesn't compose with controlled state cleanly. Collapsible takes `open` + `onOpenChange` like the rest of our Radix primitives.

**Usage:** `<Collapsible.Root open={isOpen} onOpenChange={setIsOpen}><Collapsible.Trigger asChild><button>label</button></Collapsible.Trigger><Collapsible.Content>…</Collapsible.Content></Collapsible.Root>`.

**Files:** `CheckpointBanner.tsx` (per-row Collapsible with state map), `DepartmentHarnessDashboard.tsx` (replaces 3 `<details>` blocks).

## `@radix-ui/react-hover-card`

**What:** Rich hover-triggered popover (different from Tooltip — designed for multi-line content, links, badges).

**Why this one:** Same Radix family. Used in `FeatureLink.tsx` for the on-hover feature info card. If you find yourself wanting a Tooltip but with non-text content, switch to HoverCard.

## `@papercusp/grid-core` — `RichGrid`, `GridTable`, `DataGridShell`

**What:** Three grid components for tabular data. Pick by what cells need to do — see the [decision matrix](/internal/docs/design#grids--richgrid-vs-gridtable-vs-datagridshell).

**Built-in print + copy support** (RichGrid, default-on):

* **Print fidelity** — RichGrid renders a hidden native `<table>` next to the grid (`data-rg-print-mirror`). On `@media print`, the virtualized div tree is hidden and the table mirror shows. Browser handles pagination + repeating `<thead>`. No virtualization-snapshot truncation, full dataset prints.
* **Ctrl+C → TSV + HTML payload** — when the grid root has keyboard focus, Ctrl+C copies the current row selection (or all rows if none selected) to the clipboard as both TSV (`text/plain`) and `<table>` markup (`text/html`). Excel / Sheets / Numbers paste it as cells; plain text editors get TSV.
* **Ctrl+A** — selects every row (so the next Ctrl+C copies everything).

To make this work, provide a `toCopyText: (row) => string` on each `ColumnDef` whose cell has meaningful text. For columns that are pure affordance (action buttons, icons), omit `toCopyText` — the column copies empty for each row.

If a column's `header` is JSX, also provide `headerText: 'Plain header'` so the print mirror and the TSV/HTML payloads have a string to use.

```tsx
<RichGrid
  columns={[
    {
      key: 'name',
      header: 'Name',
      width: 2,
      toCopyText: (r) => r.name,    // ← required for print/copy fidelity
      render: ({ row }) => <strong>{row.name}</strong>,
    },
    {
      key: 'status',
      header: <span>● Status</span>,  // JSX header
      headerText: 'Status',           // ← string for print + TSV header
      width: 1,
      toCopyText: (r) => r.status,
      render: ({ row }) => <StatusPill status={row.status} />,
    },
    {
      key: 'actions',
      header: '',
      width: 1,
      // No toCopyText — column copies empty (it's pure affordance).
      render: ({ row }) => <button>Edit</button>,
    },
  ]}
  rows={rows}
  getRowId={(r) => r.id}
/>
```

**Opting out:**

* `disablePrintMirror` — skip the print mirror entirely. Use for grids where Ctrl+P printing isn't a real workflow and you want to skip the extra render.
* `disableCopySupport` — fall back to native browser text selection on Ctrl+C. Use for grids where rich-content cells (custom inputs, multi-line cells) make TSV mapping meaningless.

**Virtual mode caveat:** in `virtualMode` the print mirror needs the full dataset, which the virtualizer doesn't have. Pass `printRows={fullDataset}` to enable; otherwise the print mirror is skipped silently.

**Internals:** print mirror CSS is injected once globally per page on first mount; the helpers live in `libs/generic/papergrid/grid-core/src/copy-payloads.ts` and have unit tests covering header text resolution, HTML escaping, TSV escaping, and the full payload build.

## `sonner`

**What:** Toast notification system. Lightweight, accessible, themeable.

**Why this one:** Built by Emil Kowalski (same author as vaul). Replaces every `window.alert()` we used to have. Single global `<Toaster>` mount in the Vite SPA root (`apps/operator-vite/src/routes/__root.tsx`); call `toast.success()`, `toast.error()`, or `toast.info()` from anywhere.

**Why not `react-hot-toast` or `react-toastify`?** sonner has the cleanest API, smallest bundle, and best dark-theme defaults. `react-toastify` has a heavy CSS bundle. `react-hot-toast` is fine but the API is less pleasant.

**Common usage:**

```tsx
import { toast } from 'sonner';

// Success
toast.success('phases created');
// Error with description
toast.error('setup failed', { description: error.message });
// Info / promise / etc.
toast('quote draft saved');
```

## `lucide-react`

**What:** Icon set. Tree-shakable, ESM-first, \~1500 icons.

**Why this one:** Forked from Feather Icons, actively maintained, consistent stroke-width, easy to swap. Replaces the 100+ inline `<svg>` icons we had before. Each icon is a separate import: `import { Check, X, ChevronRight } from 'lucide-react'`.

**Sizing convention:** `<Check size={11} />` for inline pills, `<Check size={13} />` for buttons, `<Check className="h-3 w-3" />` works too. Use `strokeWidth={1.75}` to match the harness's existing visual weight; the default `strokeWidth={2}` looks slightly bolder.

**Brand logos kept as inline SVG:** Google, Facebook, Apple, Visa, Mastercard, Amex, Discover. Not in lucide; can't be replaced by a generic icon.

## Form patterns — picking the right model

Three submission models, three corresponding patterns. Pick by **how the page persists**, not "does it have validation."

### 1. Single-submit form

The user fills N fields, clicks one Submit button, the whole form is validated and persisted as one atomic transaction. Use **`react-hook-form` + `useFormWith(zodSchema)`** (or `makeAjvResolver` for plugin JSON Schemas).

*Canonical sites:* `/login`, `/signup`, `/installed/templates/<slug>/edit`, `/snapshots/<id>/fork`.

See [`react-hook-form` below](#react-hook-form--hookformresolvers--ajv--zod) for the wrappers, schema dialect choice, and migration recipe.

### 2. Per-field auto-save settings page

Each control is its own atomic unit. Toggle a switch → it saves. Pick a select value → it saves. There is no "Submit." This is the **macOS System Preferences / iOS Settings / GitHub user-settings** shape — the right model for a collection of independent preferences.

Use independent `useState` per field and **`useDebouncedSave(value, persist)`** from `app/harness/useDebouncedSave.tsx`.

```tsx
'use client';
import { useState } from 'react';
import { useDebouncedSave } from '@/app/harness/useDebouncedSave';
import { Checkbox } from '@/app/harness/Checkbox';
import { Select } from '@/app/harness/Select';

export function VoiceSettings({ initial }: { initial: VoiceConfig }) {
  const [engine, setEngine]       = useState(initial.engine);
  const [autoSubmit, setAutoSubmit] = useState(initial.autoSubmit);

  const { saving, lastSavedAt } = useDebouncedSave(
    { engine, autoSubmit },
    async (v) => { await fetch('/api/voice/config', { method: 'POST', body: JSON.stringify(v) }); },
  );

  const testMic = () => {
    // Reads draft state directly — no getValues() bridge needed.
    runMicTest({ engine, autoSubmit });
  };

  return (
    <>
      <Select value={engine} onChange={setEngine} options={ENGINE_OPTS} />
      <Checkbox checked={autoSubmit} onChange={setAutoSubmit} />
      <button onClick={testMic}>Test microphone</button>
      <SaveIndicator saving={saving} lastSavedAt={lastSavedAt} />
    </>
  );
}
```

*Canonical sites:* `/settings/voice`, `/settings/backups`, `/settings/operator`, `/settings/personalization`.

**HR1/HR2/HR3/HR6 still apply.** The wrappers (`<Modal>`, `<Checkbox>`, `<Select>`, `<Collapsible>`) are still required — you're only opting out of RHF's centralized form-state model, not the harness primitives.

**Why not RHF here?** Forcing RHF onto this pattern means re-creating with `watch()` + debounce + manual `handleSubmit` what `useState` + `useDebouncedSave` does in one line. `isDirty` is meaningless when every change is its own atomic save. Test/preview buttons would need `getValues()` indirection to read what's already sitting in plain state vars. The model fights you.

### 3. Wizard flow

Multi-step with progress, each step its own slice of state, the whole flow persisted at the end (or in chunks at step boundaries). Use **RHF per step**, with the step's local Zod slice, plus a parent state coordinator.

*Canonical site:* `app/_components/SetupWizard`.

### Exceptions (none of the three patterns)

* **Single-textarea chat composers** (`ChatPanel`, `OracleDock`, `SupportAgentPanel`, `ArchitectInbox` idea draft, `OperatorNoteForm`). One field with custom IME/keyboard handling — plain `useState`.
* **Monaco code editors** (`SpecEditor`, `ManifestSpecEditor`). They edit text files, not form fields.

***

## `react-hook-form` + `@hookform/resolvers` + `ajv` + `zod`

**What:** Form-state management. RHF owns input registration / dirty tracking / submit handling; the resolvers package bridges to Zod (for forms whose schema we control) or Ajv (for forms whose schema is plugin-author-supplied JSON Schema).

**Why this one:** After a freshness pass on the React form-library landscape (rjsf, jsonforms, formily, formisch, autoform, tanstack-form), `react-hook-form` was the clear winner for our constraints — \~33 KB / 11 KB gzip, zero runtime deps, uncontrolled inputs (minimal re-renders), SSR-compatible behind a `"use client"` boundary, and — critically — a first-class Ajv resolver that handles the per-plugin JSON Schemas without forcing plugin authors to migrate to Zod/Valibot. Same library covers both internal forms (Zod schemas we author) and dynamic plugin-config forms (Ajv against third-party schemas), so the team learns one form mental model. See `apps/operator/lib/forms/README.md` for the per-PR migration recipe.

**Wrappers:** `apps/operator/lib/forms/`:

* `useFormWith(zodSchema)` — wraps `useForm` with `zodResolver` and exposes a tighter `{ register, submit, errors, isSubmitting, isDirty, ... }`. Use this for any form whose schema you own.
* `<FormField label error description>` — labelled input wrapper with inline `FieldError`/string error rendering. Matches the existing CSS-variable styling.
* `<SubmitButton pending>` — disabled-while-submitting button bound to `isSubmitting`.
* `makeAjvResolver(jsonSchema)` — pre-registers `ajv-formats` (so `email`, `uri`, `date-time`, etc. resolve). Use with vanilla `useForm`, not `useFormWith`. Required for any form that consumes plugin-author JSON Schema (the per-plugin Config tab, `/settings/plugins`).

**When to use which schema dialect:**

| Schema source                                                                   | Resolver      | Helper                                                                    |
| ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- |
| Schema is yours to define (settings page, login, internal admin form)           | `zodResolver` | `useFormWith(ZodSchema)`                                                  |
| Schema is a Zod schema already imported from `lib/validators.ts` (server-side)  | `zodResolver` | `useFormWith(SharedZod)` — single source of truth, no client/server drift |
| Schema is JSON Schema from a third party (plugin manifests in `papercusp.json`) | `ajvResolver` | `useForm({ resolver: makeAjvResolver(schema) })`                          |

**When NOT to use RHF:**

* **Per-field auto-save settings pages.** Use `useDebouncedSave` — see [Form patterns above](#form-patterns--picking-the-right-model).
* **Single textarea + Cmd-Enter chat composers** (`ChatPanel`, `OracleDock`, `SupportAgentPanel`, `ArchitectInbox` idea draft, `OperatorNoteForm`). One field with custom IME/keyboard handling — RHF adds boilerplate without buying validation, dirty tracking, or perf.
* **Monaco code editors** (`SpecEditor`, `ManifestSpecEditor`). Those edit text files, not form fields. RHF doesn't model code editors.
* **Radix native form primitives** when there's no validation logic. A plain `<select>` with one option doesn't need a form library.

**Common pattern for AI agents writing new forms here:**

```tsx
'use client';
import { z } from 'zod';
import { useFormWith, FormField, SubmitButton } from '@/lib/forms';

const Schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});
type FormData = z.infer<typeof Schema>;

export function SomeForm() {
  const { register, submit, errors, isSubmitting } = useFormWith(Schema);
  const onSubmit = async (data: FormData) => {
    await fetch('/api/...', { method: 'POST', body: JSON.stringify(data) });
  };
  return (
    <form onSubmit={submit(onSubmit)}>
      <FormField label="Name" required error={errors.name}>
        <input {...register('name')} />
      </FormField>
      <FormField label="Email" required error={errors.email}>
        <input type="email" {...register('email')} />
      </FormField>
      <SubmitButton pending={isSubmitting}>Save</SubmitButton>
    </form>
  );
}
```

**For non-native inputs** (MarkdownEditor, custom widgets that take `value`/`onChange` directly instead of a `ref` + native event), use RHF's `Controller`:

```tsx
import { Controller } from 'react-hook-form';
import { useFormWith } from '@/lib/forms';

const { control, submit, errors } = useFormWith(Schema, { defaultValues: { content: '' } });
return (
  <form onSubmit={submit(onSubmit)}>
    <Controller
      control={control}
      name="content"
      render={({ field }) => (
        <MarkdownEditor value={field.value} onChange={field.onChange} />
      )}
    />
  </form>
);
```

**Do not** introduce `formik`, `@rjsf/core`, `@jsonforms/react`, `uniforms`, or `@formily/react`. They were all considered and rejected in favour of RHF — adding any of them creates two parallel form systems.

## `motion` + `@formkit/auto-animate` (+ `gsap` for the route warp)

**What:** The animation stack. Two general-purpose libraries that complement each other (**use them together, not as alternatives**), plus `gsap` for the one bespoke route-transition warp.

* **`motion`** (the rebrand of `framer-motion` — same engine, same author) — the general-purpose React animation lib. WAAPI-backed since v10, so transforms run on the native compositor. \~41 KB gzip.
* **`@formkit/auto-animate`** — purpose-built for one job: animate when children of an element are added, removed, or reordered. Drop-in via `useAutoAnimate()`. WAAPI direct, zero React re-renders. \~3 KB gzip.
* **`gsap`** — drives the single "jump-gate" route warp in `RouteTransitionProvider.tsx`. (This replaced `next-transition-router`, which was dropped in the TanStack Router migration — it serialised navigation through one in-flight transition and swallowed clicks, so on TSR it was pure overhead. The warp is now a capture-phase click listener on the two jump-gate anchors that plays a GSAP overlay; everything else navigates via plain TanStack `<Link>`.)

**The rule of three** (memorize this):

| Need                                                                           | Reach for                                                                                   | Why                                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modal / popover / dropdown / tab open + close                                  | **CSS** with `[data-anim="pop"]` / `[data-anim="fade"]` keyed off Radix `data-state="open"` | Native compositor, zero JS cost, no library import. Tokens live in `globals.css` (`--ease-*`, `--dur-*`).                                                       |
| **List item add / remove / reorder**                                           | **`auto-animate`**                                                                          | One-line `useAutoAnimate()` ref. Don't reach for `motion.li` + `AnimatePresence` — it's more code, more re-renders, same visual result.                         |
| Counter tweens, choreography, drag, `layout` shifts, `whileHover` / `whileTap` | **`motion`**                                                                                | `useMotionValue` + `animate()` for counters; `<motion.div layout>` for FLIP layout; gestures via `<motion.div drag>`.                                           |
| The one cross-route "jump-gate" warp (`/` ⇄ `/adv`)                            | **`gsap`** via `RouteTransitionProvider`                                                    | A capture-phase click listener intercepts only the two jump-gate anchors and plays the GSAP overlay; all other navigation is plain TanStack `<Link>` (instant). |

**Don't use** for app UI: `@theatre/core`, `@react-spring/web`, `popmotion`. They're either overkill, abandoned, or duplicates of what `motion` covers in our context. `gsap` is in the tree but is reserved for the single jump-gate route warp above — reach for `motion` / CSS / `auto-animate` for everything else, not GSAP.

**RichGrid lists are NOT auto-animate targets.** `FeatureList`, `IssuesList`, `ProposalsPanel`, and any other `RichGrid`-backed list use `useVirtualizer` — `auto-animate` would fight virtualization (animating every scroll). Animations there should target row-level data changes (status pulse, color transition) not row mount/unmount.

**Reduced motion:** the data-state CSS animations all honor `prefers-reduced-motion`. For `motion` JS animations, wrap the dashboard in `<MotionConfig reducedMotion="user">`. Anything else needs an explicit `useReducedMotion()` check.

**Wrappers / patterns:**

* `[data-anim]` attribute selectors: see top of `app/globals.css`. Apply to any Radix `Content` or other element that exposes `data-state="open|closed"`.
* `useAutoAnimate` hook: `import { useAutoAnimate } from '@formkit/auto-animate/react'`. Call it once per dynamic-list parent; spread the returned ref onto the parent element.
* `motion`: `import { motion, AnimatePresence } from 'motion/react'` (or `framer-motion`; identical). `AnimatePresence` for exit animations on unmount; `motion.div layout` for FLIP between layouts.

**Reference docs:** [Performance — animation rules](/internal/docs/design/performance#animation-rules) (the canonical short answer for "should I add an animation here?").

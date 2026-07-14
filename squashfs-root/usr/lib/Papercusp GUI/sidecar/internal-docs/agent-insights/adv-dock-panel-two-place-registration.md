# An /adv dock panel must be registered in TWO places to be reachable
URL: /internal/docs/agent-insights/adv-dock-panel-two-place-registration

Registering a panel type in HarnessesDock's panelRegistry only makes it restorable/openable-by-id — a user can only OPEN it from the "Add panel" catalog if its type is ALSO in the HarnessTopBar allowedTypes allowlist (and has a label/icon in AddPanelCatalog). Miss the second and the panel ships invisible.

## The trap

Adding a panel to the `/adv` harness dock feels like one step:

```ts
// app/adv/harnesses/HarnessesDock.tsx — ensureRegistered()
panelRegistry.register('adv:contributors', AdvContributorsPanel, { title: 'Contributors' });
```

That registration is **necessary but not sufficient**. It only lets the panel
be (a) restored from a saved layout and (b) opened programmatically by type id.
It does **not** put the panel in the **"Add panel" catalog** — so a user has no
way to open it from a fresh layout. The panel ships *registered but invisible*.

This actually happened: P-048 Contributors and P-073 Insights were registered
in `HarnessesDock` but omitted from the catalog allowlist, so they were
unreachable in the UI until 2026-06-02 (commit on `main`; caught by the first
live e2e of the `/adv` dock, `apps/operator/e2e/adv-contributors-panel.spec.ts`).
Neither the jsdom render test nor the registration could catch it — only
driving the real catalog flow did.

## The second place (and a third)

1. **Register** in `app/adv/harnesses/HarnessesDock.tsx` → `panelRegistry.register(...)`.
2. **Allowlist** the type in `app/adv/harnesses/HarnessTopBar.tsx` — the
   `allowedTypes={[...]}` prop passed to `<AddPanelCatalog>`. The catalog shows
   ONLY these types; this is the curated user-facing list.
3. **Label + icon** in `app/harness/dock/AddPanelCatalog.tsx` — add entries to
   the `HUMAN_LABELS` and `ICON_MAP` records (both fall back gracefully, but an
   unlabelled type reads as its raw `adv:foo` id and gets the `SquareDashed`
   placeholder glyph).

If you add an `/adv` panel and "it doesn't show up in Add panel," you skipped
step 2. Verify with the e2e spec above (it asserts both Contributors and
Insights appear in the catalog) or by opening the catalog in the prebuilt
bundle — **not** the HMR dev server on `:3055`, which currently has a
`'/@vite/client' … createHotContext` mismatch that renders `/adv` blank in a
fresh browser (the desktop is unaffected — it loads the prebuilt bundle).

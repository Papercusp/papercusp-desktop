# How the papercusp-workspace + papercup-self-registration boot path works
URL: /internal/docs/agent-insights/dogfood-bootstrap

Two fire-and-forget bootstrap helpers run on every operator boot to make Papercusp dogfood itself — sentinel workspace ensure + papercup repo auto-register. Idempotent + non-disruptive to existing installs.

import { Aside } from '@astrojs/starlight/components';

## What

Two helpers make Papercusp dogfood itself:

1. **`ensurePapercuspWorkspace()`** — guarantees a workspace called
   `papercusp-workspace` (literal name) exists in the workspace
   registry. Idempotent.
2. **`registerPapercupHarness()`** — if running from the papercup
   source repo, auto-registers it as a harness named `papercup`
   inside that sentinel workspace, `state: private`. Idempotent
   * no-op for packaged installs.

Together: Papercusp dogfoods itself.
The user finds `papercup` in their harness dropdown when they
switch to `papercusp-workspace` — no manual `harness create` step.

Files:

* `packages/operator-core/lib/harness/papercusp-workspace.ts`
* `packages/operator-core/lib/harness/register-papercup.ts`
* `apps/operator/scripts/run-dogfood-bootstrap.ts` (one-shot manual driver)

**Update (2026-06):** The original boot wiring was
`apps/operator/instrumentation-node.ts` (the Next.js instrumentation hook),
which is **retired** along with the Next standalone operator. The two helper
modules moved from `apps/operator/lib/harness/` to
`packages/operator-core/lib/harness/`. As of this audit there is **no live
boot-time caller** of `ensurePapercuspWorkspace()` / `registerPapercupHarness()`
in the operator source — they are exercised only by the one-shot driver
`apps/operator/scripts/run-dogfood-bootstrap.ts` (npm `verify:dogfood-bootstrap`)
and their unit tests. Run the driver manually to flip dogfooding on; the rest of
this page (sentinel name, the scoped-write trick, `detectPapercupRoot`) is still
accurate.

## Why two helpers, not one

They do different things:

* **`ensurePapercuspWorkspace`** writes to
  `~/.papercusp-workspaces/registry.json` (file-backed) — the user's
  list of workspaces.
* **`registerPapercupHarness`** writes to PG
  (`harness_shared.harness_registry`) **scoped to** the sentinel
  workspace (not the active workspace) — the harness list within
  that workspace.

Splitting them keeps each helper testable in isolation. The bootstrap
calls them in order: sentinel ensure → register papercup as harness.

## The "scoped to the sentinel workspace, not active" trick

When you have multiple workspaces, the harness registry is per-
workspace: each workspace has its own list of harnesses. The
operator's existing `saveHarnessRegistry()` defaulted to writing to
the **active** workspace.

If P-024 wrote to the active workspace, it would silently dump
`papercup` into whichever workspace the user happened to be looking
at — usually `default`. Bad: pollutes the user's workspace.

The fix (commit `b53185ee`): add an optional `workspaceId` param to
`saveHarnessRegistry()` (additive, 100% back-compat across 52 call
sites). The dogfood bootstrap passes `PAPERCUSP_WORKSPACE_ID`
explicitly so the write lands in the sentinel workspace regardless
of which one is active.

A symmetric `wsOverride?` was already on `readOperatorState`; this
just closes the API asymmetry at the underlying `writeOperatorState`
helper.

## How the papercup-root auto-detector works

`detectPapercupRoot(start)` in `register-papercup.ts` walks UP from
the given directory looking for both markers:

```ts
existsSync(join(dir, 'apps', 'operator', 'package.json'))
  && existsSync(join(dir, 'libs', 'papercusp', 'package.json'))
```

Two markers because either alone could be coincidental in unrelated
projects. Both together pin the directory to "this is the papercup
repo." Bounded to 8 levels up so it can't unbounded-walk a weird
filesystem.

Returns `null` for packaged desktop installs where neither marker
exists — the bootstrap silently skips with a `state: 'skipped'`
result.

## When you touch this code

* **Renaming the sentinel** (`papercusp-workspace` → anything else)?
  Bad idea: many future surfaces (Cupboard, plan dogfood docs,
  multi-machine reconciliation) hardcode the name as a stable
  reference. The constant is in `papercusp-workspace.ts` for the
  one place that needs it; don't make it a per-install variable.
* **Changing the markers** in `detectPapercupRoot`? Be conservative —
  the two-marker rule was chosen specifically to avoid false
  positives. Adding a 3rd marker is fine; removing one is risky.
* **Adding a 3rd bootstrap helper** (e.g. auto-register sub-harnesses
  for papercup's submodules)? Add it to the one-shot driver
  (`run-dogfood-bootstrap.ts`), alongside the existing two. Keep
  each helper idempotent.

## Verifying it works without restarting the operator

There's a one-shot driver at
`apps/operator/scripts/run-dogfood-bootstrap.ts`:

```bash
cd apps/operator && npx tsx scripts/run-dogfood-bootstrap.ts
```

Runs the same code paths the boot path runs. Prints the registry +
PG state. Useful when:

* You just made a change to the bootstrap helpers and want to
  verify it works against the live PG.
* The running operator predates your changes (memory rule:
  don't restart the user's running dev server). The script
  exercises your new code without touching the operator process.
* You're debugging a "papercup isn't showing up in the dropdown"
  symptom and want to confirm the PG row is there.

Sample output:

```
=== STEP 1: ensurePapercuspWorkspace ===
workspace entry: id=papercusp-workspace, name=papercusp-workspace, createdAt=...
workspaces total: 6, current: default
✓ sentinel 'papercusp-workspace' present in registry
=== STEP 2: registerPapercupHarness ===
state: already-registered
path: /home/marsh-office/papercupai-workspace/papercup
=== STEP 3: verify PG row ===
harness_registry@papercusp-workspace: 1 projects
  - papercup  →  /home/marsh-office/papercupai-workspace/papercup
✓ papercup registered in sentinel workspace
=== PASS — dogfooding flipped on ===
```

## Related

* `packages/operator-core/lib/harness/classify-tree.ts` — the 5-rule classifier
  for nested `.git` entries; uses the same `existsSync`-on-markers
  pattern. See [the classifier insight](/internal/docs/agent-insights/harness-tree-classifier).
* v5 plan Phase 1a P-014 (workspace bootstrap) + Phase 4 P-024
  (papercup self-registration).
* `packages/operator-core/lib/workspace-registry.ts` — the underlying file-
  backed registry helpers.
* `packages/operator-core/lib/operator-state-pg.ts` — `readOperatorState` /
  `writeOperatorState` with optional `wsOverride` for per-workspace
  scoping.

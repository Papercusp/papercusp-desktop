# Configuration
URL: /internal/docs/harness/config

Where harness configuration lives today — blueprint shape + declared params, the PG-stored instance layer delivered via HARNESS_CONFIG_JSON, and the effective-config overlay.

The first-generation harness was configured by one hand-edited
`.harness/config.json`. Today configuration is split into two layers with a
declared, validated surface between them — and **the config file is gone**.

## The two layers

**1. The blueprint (the shape).** A harness is instantiated from a blueprint
(`libs/papercusp/packages/harness/blueprints/<id>/blueprint.yaml`), which
declares the *shape*: roles, spine, triggers, gates, dispatch policy, plus

* **`knobs`** — shape-level defaults (e.g. the coding blueprint sets
  `harnessKind: coding`, `requiresRepo: true`, `debuggerThreshold: 3`), and
* **`params`** — the *declared tunables*: a keyed record where each key is a
  dot-path into the instance config (`debugger.threshold`,
  `parallelWorkers.useChunkLoop`, `parallelWorkers.workingStateCheck`, …)
  carrying `label` / `type` / `min`/`max` / `options` / `default` / `group` /
  `affects` / `description`. Params **union across `extends`**: `base`
  declares the universal ones (dispatch, backend); a child blueprint adds its
  own (the coding blueprint's worker/typecheck/debugger knobs are
  coding-only). Schema: `libs/papercusp/packages/orchestrator/src/blueprint/schema.ts`.

**2. The instance config (the overrides).** Per-harness values live in the
**workspace-PG store**, not in a file. At spawn time the operator assembles
the instance config and delivers it solely via the `HARNESS_CONFIG_JSON` env
transport — `.papercusp/config.json` is **deprecated to zero and not read**
(`deprecate-harness-config-json-2026-06-06`; the `harness:migrate-config-json`
tool exists to absorb a legacy file into the PG store).

## How the effective config resolves

`effective-config.ts` overlays blueprint knobs **under** the instance config —
instance overrides always win, merged by a deep-merge where nested objects
merge recursively and scalars/arrays replace. The overlay carries only the
residual knob keys (`promptOverrides`, `aiBackend`, `parallelWorkers`,
`scoper`, `snapshotRetention`); already-migrated knobs (`maxCostUsd`,
`debuggerThreshold`, dispatch concurrency) have their own resolution paths
and are deliberately excluded so nothing double-applies.

## Reading and writing configuration

The schema-driven layer in
`libs/papercusp/packages/orchestrator/src/blueprint/params.ts` is the one
supported read/write path:

* **`resolveParamViews`** — the current effective value for each declared
  param (instance override if present, else the param's `default`).
* **`validateParamPatch`** — rejects keys that aren't declared (no arbitrary
  config writes), type/range/option-checks each value, and **skips `secret`
  params** — secrets route through the credential store, never the config.
* **`applyParamPatch`** — writes the validated patch at each dot-path,
  dropping values equal to their default so the stored instance config stays
  minimal.

Because param keys *are* the historical config paths, no data migration was
needed — existing overrides already sit at the declared key-paths; they're
now declared + validated rather than freeform.

The UI for all of this is the schema-driven **harness settings panel**
(`BlueprintSettingsPanel`, gated by the `papercusp-blueprint-aware-settings`
[flag](/internal/docs/posthog/feature-flags)): it introspects the harness's
blueprint `params` and renders controls per declared group — which is why a
research or gym harness shows its own tunables instead of a hardcoded coding
form.

## Mapping from the legacy config (for old-timers)

| Legacy `.harness/config.json` field  | Today                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `models.<role>` / backend choice     | `aiBackend.*` (residual overlay key; per-param declared)                                                |
| `promptOverrides.<role>`             | survives as a residual overlay key                                                                      |
| `debugger.threshold`                 | declared param `debugger.threshold` (blueprint knob default 3)                                          |
| `parallelWorkers.*`                  | declared params (`useChunkLoop`, `workingStateCheck`, …)                                                |
| `snapshotRetention`                  | residual overlay key                                                                                    |
| `smokeTest.*`                        | gate machinery exists, runner not yet ported — see [Smoke-test gate](/internal/docs/harness/smoke-test) |
| `checkpoints.*`                      | retired — `CHECKPOINT` finalizes as escalation; milestone gates are `needs-human` plan items            |
| `branchIsolation.*` / lane worktrees | retired with the run-loop — see [Worktrees & isolation](/internal/docs/harness/worktrees)               |

## Related

* [Roles](/internal/docs/harness/roles) — what the blueprint's spine wires
* [Storage policy](/internal/docs/system/storage-policy) — why the instance
  layer is PG, not a file

# The autoloop is the routines engine now (Pot operator + self-declared wake)
URL: /internal/docs/agent-insights/autoloop-is-the-routines-engine

After autoloop-pot-operator-rebuild, there is no setInterval autoloop ticker — the DBOS routines engine fires each harness's blueprint-declared schedule, and a Pot operator decides its own next wake via pot:declare-wake. autoloop:control flips routine rows, not a timer.

## What

`autoloop-pot-operator-rebuild-2026-06-05` removed the legacy in-process
`setInterval` autoloop and reframed the whole loop around two ideas:

1. **The autoloop IS the durable routines engine** — not a process-local
   timer. A harness's autoloop is its blueprint-declared schedule
   (`triggers.schedule` → `bp-schedule-*` routine rows, materialized at
   `harness:create`). The routines workflow fires those rows; there is no
   `setInterval` anywhere in `packages/operator-core/lib/autoloop.ts`.
2. **The Pot operator decides its own next wake** — there is no cadence
   trigger for the operator (D-002). Before ending a turn it calls
   `pot:declare-wake` to set a *time*, an *event-subscription*, or
   *nothing*; the manual/event fire target is `pot:wake`.

If your mental model is still "a ticker loops every N seconds and fires the
director," it's wrong post-2026-06-05. The loop is event/schedule-driven and
durable (survives restarts, no double-fire).

## Why it matters / the load-bearing facts

* **`autoloop:control` flips routine rows, not a timer.** `pause`/`resume`
  toggle the `bp-schedule-*` routine rows' `active` column (durable,
  cross-process). `reset-errors` zeroes `consecutive_errors` in
  `autoloop_state`, closing the P-009 backoff circuit. There is no
  in-process handle to clear.
* **Error-backoff is real and READ at the fire point (P-009).**
  `autoloop.ts` exports `evaluateFireGate` / `checkFireGate` / `recordFire`.
  `routines-workflow.ts` calls `checkFireGate` *before* firing a role and
  `recordFire(...,'ok'|'error')` after — so a repeatedly-failing director
  gets exponential backoff and, at `circuitThreshold()` consecutive errors,
  the circuit OPENS (one attempt per `backoffCapSec()` window) until a fix +
  `autoloop:control reset-errors`. `consecutive_errors` used to be
  written-but-never-read; now it gates.
* **Enablement = the blueprint, not a flag or `director-config.json`.** A
  harness autoloops because its blueprint declares a schedule + a `dispatch:`
  policy (concurrency/priority/readiness/costCap/safetyCeiling — see
  `coding.yaml`/`research.yaml`). There is no `autoLoop:true` flag and the
  old `.papercusp/director-config.json` is detached.
* **The Pot is a real blueprint.** `blueprints/pot/blueprint.yaml`
  (`extends: base`, decider = the `operator` role) is the 14th built-in and
  a *launch* blueprint (fired via `system:blueprint-run` / the invoke route),
  not a feature pipeline. `blueprint:catalog` lists it with `launchable:true`.
* **`pot:declare-wake` has REPLACE semantics** (like `coord:declare-intent`):
  each call describes the *whole* next wake; omitted parts are cleared.
  Time wakes are clamped to a wake floor (`floorSec`, default 60) so a
  confused operator can't spin; event wakes register a persisted
  `@papercusp/rules` reaction rule that fires `pot:wake` on match;
  `pot:wake` is floor-debounced (a burst collapses to one wake; `force`
  overrides).

## The operator's superpower (discovery → create)

The Pot chooses what to run via `blueprint:catalog` (built-in + installed
tiers; per-entry decider/roles/spineModel/triggers/dispatch; abstract
parents like `base` flagged `abstract`, broken ones kept as
`{id,tier,error}`) → `blueprint:validate`/`extend` → `harness:create`. The
`operator` role carries the caps for all of these — granted both in
`OPERATOR_CAPS` (provision.ts) AND `BLUEPRINT_ROLE_CAPS['operator']`
(role-principal-caps.ts). The second is load-bearing: provisioning without
`force` is a no-op on an existing principal row, so a pre-rebuild operator
row would otherwise lack the new caps.

## Gotcha: harness read tools were org-table-only

`harness:list` / `harness:status` historically read ONLY
`harness_shared.projects` (the org/department table). A harness created via
`harness:create` writes the **registry** (`harness_shared.harness_registry`),
so its own read-back returned "not found" — the Pot could create a harness
it then couldn't see. Both tools now read the registry first (merged with
`projects` for budget/status enrichment; org-only rows kept as
`source:'project'`). If you add another "what harnesses exist?" surface,
read the registry, not just `projects`.

## Related

* `packages/operator-core/lib/autoloop.ts` — the fire-gate + backoff state machine (no setInterval).
* `packages/operator-core/lib/dbos/routines-workflow.ts` — where `checkFireGate`/`recordFire` gate the fire.
* `packages/operator-core/lib/agent-tools/pot/{declare_wake,wake,status}.ts` — the self-declared-wake surface.
* `packages/operator-core/lib/agent-tools/blueprint/catalog.ts` — the blueprint discovery tool.
* `packages/agent-mcp/src/tools/harness/{list,status,registry-read}.ts` — the registry-aware harness read tools.
* Plan `autoloop-pot-operator-rebuild-2026-06-05` — the full design + decisions (D-001..D-009).

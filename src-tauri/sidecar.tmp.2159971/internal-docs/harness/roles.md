# Roles — the operational reference
URL: /internal/docs/harness/roles

Every built-in agent role — where it's defined, where its persona lives, and when it fires.

This is the operational reference for agent roles: what exists *now*, where
each is defined, and when each fires. For the spec-level model (the four core
roles and install shapes) see [The four core roles](/internal/docs/spec/roles).

## The registry

**`AGENT_ROLES`** in `packages/agent-mcp/src/role-config.ts` is the single
runtime source of truth for built-in role ids — tool `roles:` allowlists,
quota keys, and `byRole` guidance all key off it. The set is open: plugins
contribute namespaced `<plugin>:<role>` ids at runtime.

The built-ins, grouped as the file orders them:

| Group         | Roles                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pipeline      | `scoper` · `architect` · `worker` · `validator` · `reviewer` · `debugger` · `documenter` · `curator`                                                                                                                                                                                                  |
| Chat surfaces | `operator` · `oracle`                                                                                                                                                                                                                                                                                 |
| Hive          | `bee` (the generic "do this task" agent — no pipeline spine, no chunk requirement) · `planner` (interactive plan-authoring session)                                                                                                                                                                   |
| Cross-cutting | `orchestrator` · `promote` · `security-reviewer` · `infra-reviewer` · `crosscheck` · `ui-qa` · `auditor` (read-only adversarial screen for remote-authored features) · `merge-resolver` (git-sync conflict resolution) · `release-manager` (deploy go/no-go) · `sentinel` (read-mostly fleet watcher) |

Two adjacent ids that are *not* agent roles: **`brain`**
(`BRAIN_PRINCIPAL_ROLE`) is an RBAC role on the operator's own *principal* —
"only the brain approves spawns" is enforced at the dispatch layer, never
carried by a spawned agent — and the per-feature **director** is a persona
(`prompts/director.md`) that emits the decision verbs
(`NEXT_WORKER` / `NEXT_ARCHITECT` / `NEXT_VALIDATOR` / `DONE` / `ESCALATE`;
see [Decision telemetry](/internal/docs/harness/decisions-timeline)) rather
than an `AGENT_ROLES` entry.

## Personas and layered resolution

Spawn personas live at `libs/papercusp/packages/harness/prompts/<role>.md`,
layered with `base/<role>.md` plus kind/department overrides per the
resolution rules in that directory's `README.md`. The directory carries more
personas than `AGENT_ROLES` lists — blueprint-specific roles (`researcher`,
`research-director`, `gym-director`, `migration-director`, `transformer`,
`judge`, …) are resolved by their blueprints. Chat roles (`operator`,
`oracle`) are assembled differently — by
`packages/operator-core/lib/prompt-assembly.ts` from
`apps/operator/prompts/<role>.persona.md` + the generated tools catalog.

## When pipeline roles fire (the `coding` blueprint)

The blueprint (`libs/papercusp/packages/harness/blueprints/coding/blueprint.yaml`)
declares the wiring:

* **Spine:** `scoper → architect → worker → validator → reviewer →
  documenter → curator` — each work item's kind/state determines the next
  role; the spine's `deriveNext` interpreter consumes the director's
  decision verbs.
* **Reactive overlay:** the `debugger` fires *before a worker retry* once a
  feature accrues `knobs.debuggerThreshold` failed attempts — read-only
  root-cause notes for the next worker.
* **Opt-in quality gates:** `tester` / `security` / `crosscheck` / `ui-qa`,
  e.g. `NEXT_CROSSCHECK` re-validates a pass with a different model.
* **Finalize recipe:** `onDone: [curator, postCuratorOutputs, documenter,
  archive]`; `onEscalate: [curator]` — the curator always runs on terminal
  outcomes (see [Why a curator](/internal/docs/harness/decisions/curator)).

Other blueprints are different shapes on the same engine — `blueprint:catalog`
lists what each one runs.

## How a role spawn happens

The DBOS pipeline (`packages/operator-core/lib/dbos/`) dispatches each role
as a fresh one-shot agent process (see
[Why fresh contexts](/internal/docs/harness/decisions/fresh-contexts)),
built from the same `buildRoleLaunchSpec`
(`packages/operator-core/lib/role-launch-spec.ts`) that powers interactive
role sessions (`psu --role <role> [--feature F-NNN]`) — one prompt/tools/
feature/backend spec, two entry points.

## Role disciplines that survive from the first generation

Verified in the current persona files:

* **Validator: default-reject.** "Your default is *reject*. The worker has to
  earn approval" (`prompts/validator.md`).
* **Validator: the evidence rule.** Every positive claim must quote
  executable evidence (an HTTP body, a DB row, a log line — "something that
  could not exist without the feature being present"); a claim with no
  producible evidence is `[FAIL]`, overriding any "looks reasonable"
  intuition (`prompts/validator.md`, "EVIDENCE RULE").
* **Curator: sole memory compactor.** Only the curator deletes/compacts
  harness memory ([details](/internal/docs/harness/decisions/curator)).

The first-generation "role design rules" — one job per role, read-mostly
where possible, default-skeptical gates — are visible throughout the current
registry (the `auditor` and `sentinel` are explicitly read-only/read-mostly
by design, per their `role-config.ts` entries).

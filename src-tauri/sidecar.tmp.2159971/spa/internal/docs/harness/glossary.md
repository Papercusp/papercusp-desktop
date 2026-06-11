# Glossary (harness runtime)
URL: /internal/docs/harness/glossary

The runtime terms you meet working with a live harness, each traceable to the defining code.

Runtime terms, alphabetical, each pointing at its defining code. For
spec-level/product vocabulary (Install, Goal, Plugin, marketplace `kind`, …)
see [Vocabulary](/internal/docs/spec/vocabulary); for the user-facing brand
lexicon (Hive/Queen/bee display strings) see the `papercusp-the-hive`
[flag](/internal/docs/posthog/feature-flags) — those are presentation-layer
names over the code terms below.

**Bee** · The generic "do this task" agent of the hive blueprint — carries no
pipeline spine and no chunk requirement, unlike `worker`. —
`packages/agent-mcp/src/role-config.ts`

**Blueprint** · A harness's declarative shape: roles, spine, triggers, gates,
dispatch policy, `knobs`, and declared `params`. Built-ins extend `base`. —
`libs/papercusp/packages/harness/blueprints/`, schema in
`libs/papercusp/packages/orchestrator/src/blueprint/schema.ts`

**Brain** · The RBAC *principal* role marking the operator's own
orchestration intelligence — gates spawn-approval tools at the dispatch
layer. Not an agent role. — `role-config.ts :: BRAIN_PRINCIPAL_ROLE`

**Chunk** · A feature-family work-item kind: a feature sub-unit sized for one
worker turn, executed by the worker chunk loop (per-chunk file locks + a
typecheck gate). — `packages/operator-core/lib/work-items.ts`

**Claim / lease** · Taking ownership of a work item (`work_items:claim`); a
live lease with a dead holder is an *orphaned claim*, surfaced by
`fleet:assignments`.

**Curator** · The memory-compaction pipeline role; the only role that deletes
harness memory. — [Why a curator](/internal/docs/harness/decisions/curator)

**Decision verb** · The single verb a deciding agent emits per iteration
(`NEXT_WORKER` / `NEXT_ARCHITECT` / `NEXT_VALIDATOR` / `DONE` / `ESCALATE`);
interpreted by the blueprint spine. —
[Decision telemetry](/internal/docs/harness/decisions-timeline)

**Director** · The persona that emits per-feature decision verbs in the
durable pipeline. A prompt file, not an `AGENT_ROLES` id. —
`libs/papercusp/packages/harness/prompts/director.md`

**Dispatch** · The blueprint-declared policy for when/what the engine runs
next; concurrency knobs resolve via their own path (not the effective-config
overlay). — `blueprints/*/blueprint.yaml`

**Effective config** · Blueprint knobs overlaid *under* the per-harness
instance config (instance wins). —
[Configuration](/internal/docs/harness/config)

**Escalation** · A pipeline finalizing with `ESCALATE`: the `on-escalate`
hook fires and the `onEscalate` recipe (default: curator) runs; the harness
surfaces the reason for a human. —
`packages/operator-core/lib/dbos/orchestrator-finalize.ts`

**Feature** · The classic feature-family work-item kind (`F-NNN`), routed
through the coding blueprint's spine. — `work-items.ts`

**Finalize recipe** · The blueprint's `gates.finalize` step list run on
terminal outcomes (`onDone` / `onEscalate`). —
`blueprints/coding/blueprint.yaml`

**Ghost** · A deciding-agent output that fails to parse as a known decision
verb; tracked as a rate and a health signal (`low_ghost_rate`). —
`packages/operator-core/lib/harness-readers.ts`

**Harness** · One managed work pipeline (repo + work queue + runs),
instantiated from a blueprint; slug-identified.

**Hook** · An out-of-band shell script at `.papercusp/hooks/<name>.sh` run at
pipeline boundaries. — [Lifecycle hooks](/internal/docs/harness/hooks)

**Identity file** · `identity/<role>.md` — cross-mission per-role lessons,
PG-mirrored to `harness_shared.identity_files`. —
[Memory](/internal/docs/harness/memory)

**Instance config** · Per-harness overrides stored in workspace-PG and
delivered via the `HARNESS_CONFIG_JSON` env transport; `.papercusp/config.json`
is deprecated and not read. — `libs/papercusp/packages/orchestrator/src/effective-config.ts`

**Knobs** · Shape-level defaults a blueprint declares (e.g.
`debuggerThreshold: 3`). — `blueprints/coding/blueprint.yaml`

**Params** · A blueprint's *declared tunables*, keyed by instance-config
dot-paths, unioned across `extends`; the schema-driven settings layer
validates writes against them. — `blueprint/params.ts`

**Phase** · One of up to three worktrees per project — `staging` (the main
path), `testing`, `production` (sibling `<path>--<phase>` checkouts). —
`packages/operator-core/lib/harness-phases.ts`

**Planner** · An interactive plan-authoring session role (drafts one plan via
`plans:*`); not the spec-level Planner pipeline role. — `role-config.ts`

**Queen** · The steering intelligence of a hive/Pot — schedules, places, and
prioritizes work (the role the lexicon surfaces as "Queen"); distinct from
the watching `sentinel`. — `role-config.ts` (sentinel entry)

**Redundancy / replica** · BOINC-style multi-dispatch of one work item to
independent replicas with a judge step
(`work_items:set_redundancy` / `claim_replica` / `judge_redundancy`);
feature-family only.

**Role** · A named agent function with its own persona + tool surface. The
runtime registry is `AGENT_ROLES`. —
[Roles](/internal/docs/harness/roles)

**Run / spawn** · One agent invocation: the spawn is the envelope (workspace

* harness + role + work item + signed MCP URL), the run is the execution;
  tracked in `harness_shared.spawned_agents`.

**Sentinel** · The read-mostly fleet watcher (stuck spawns, lock hogs, coord
staleness); its only writes are alarms. — `role-config.ts`

**Spine** · The blueprint's declared role-routing model; the `deriveNext`
interpreter maps (state, decision verb) → next action. —
`libs/papercusp/packages/orchestrator/src/blueprint/derive-next.ts`

**Summary memory** · `.papercusp/memory/summary.md` — curator-maintained,
40-line cap, auto-injected into every pipeline spawn. —
[Memory](/internal/docs/harness/memory)

**Task** · An issue-family work-item kind recording delegated work; excluded
from the default `issues:*` listing. — `work-items.ts`

**Work item** · The unified unit of work, one type discriminated by `kind`:
feature family (`feature` / `research-task` / `chunk`) + issue family
(`bug` / `change` / `task`), served by the `work_items` UNION view over the
per-kind tables (migration 159). — `packages/operator-core/lib/work-items.ts`

**Workspace** · One Papercusp install: many harnesses, one PG database, one
credential set.

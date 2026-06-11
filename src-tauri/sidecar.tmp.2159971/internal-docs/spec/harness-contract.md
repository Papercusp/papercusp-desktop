# 3. The harness contract
URL: /internal/docs/spec/harness-contract



Every Papercusp harness, at minimum, satisfies these contracts:

### 3.1 Structured-state-only

All state lives in a Postgres schema (per-harness or per-install). Any role, invoked from a fresh process, can read the full state and produce the same decisions. The schema is part of the spec.

### 3.2 Fresh context per role

Every role invocation is a fresh LLM call with no prior conversation. The system prompt is the role's prompt file. The user prompt is generated from the current state. This is non-negotiable for the substrate; drift across iterations is what kills long-running agents.

### 3.3 Named decisions, named roles

Each role's output is one of a small set of structured decisions. The per-harness decider role
(the director in the coding blueprint) chooses between `NEXT_WORKER`, `NEXT_VALIDATOR`,
blueprint-declared verbs (`NEXT_ARCHITECT`, `NEXT_SCOPER`, …),
`DONE`, `ESCALATE`, `IDLE`. The validator sets each task's status to{' '}
`passed` or `failing`. No free-form "what should I do next?" — every iteration ends with a decision verb.

Implemented. The decision vocabulary is `DECISION_VERBS` in
`libs/papercusp/packages/orchestrator/src/decision-parse.ts`; each blueprint maps its verbs to actions in
its `spine.edges` (`libs/papercusp/packages/harness/blueprints/<id>/blueprint.yaml`), interpreted by the
pure `deriveNext` (`.../src/blueprint/derive-next.ts`). The global orchestrator
(`packages/operator-core/lib/dbos/orchestrator-loop.ts`) is the deterministic code selector that starts a
durable per-feature pipeline; the LLM decider that emits these verbs is the per-feature `director` role.

### 3.4 Append-only audit

Every iteration writes to an audit table. The audit is the durable record;
UIs reconstruct state from it. Curator roles may compact older entries but never silently delete them.

### 3.5 Goal-traceable tasks

Every task has a parent — either another task or the install's top-level goal. Recursive lineage queries
let any role ask "why am I doing this?" and get an answer that goes all the way to the mission. Adopted from
Paperclip; structurally enforced rather than prompt-injected.

### 3.6 Atomic task checkout

Workers acquire tasks via Postgres `FOR UPDATE SKIP LOCKED`. Multiple workers running in parallel each get
a different task atomically. Tasks have an `expires_at` on checkout for orphan recovery.

Implemented. Atomic checkout lives in `packages/operator-core/lib/work-items.ts`
(`FOR UPDATE SKIP LOCKED`); the work-item table is `harness_shared.harness_features_consolidated`, which
carries `taken_by` / `taken_at` / `expires_at` plus the `parent_id` / `goal_id` lineage columns (§3.5).

### 3.7 Hard-stop budget enforcement

Each install has a budget at the install level and per-project. The substrate enforces atomic budget checks at the
accept-proposal layer: if currently committed costs + proposed cost > remaining budget, the operation is
rejected before any LLM call fires. Implemented in a Postgres transaction so concurrent accepts can't both pass the check.

# Role & persona registry
URL: /internal/docs/reference/role-registry

The built-in agent roles (AGENT_ROLES) joined with their spawn personas. Generated from role-config.ts + the harness persona files.


> **Generated — do not edit by hand.** Run `npm run gen:doc-projections` (or `npm run gen:doc-role-registry`).
> Source: `scripts/gen-doc-role-registry.ts`. Part of `starlight-projection-generators-2026-06-05` (Brief 29).

# Role & persona registry

A **role** is what kind of agent a spawn is. `AGENT_ROLES` is the runtime source of truth for the built-in role ids (tool `roles:` allowlists, `byRole` guidance, quotas); a role's **persona** is its spawn prompt at `libs/papercusp/packages/harness/prompts/<role>.md`. Not every role has a persona (operator/oracle are chat surfaces), and many personas are blueprint deciders/helpers that are not themselves `AGENT_ROLES` entries.

Sources: `packages/agent-mcp/src/role-config.ts` (22 built-in roles) + `libs/papercusp/packages/harness/prompts/*.md` (41 personas).

## Built-in roles (`AGENT_ROLES`)

These ids appear in tool `roles:` allowlists, `rolesQuota` keys, and `byRole` guidance overrides. The set is open — plugins contribute `<plugin>:<role>` ids at runtime.

| Role | Persona | Summary |
|---|---|---|
| `scoper` | ✓ | You are the **SCOPER** in a multi-agent harness. You translate "what we want" |
| `architect` | ✓ | You are the **ARCHITECT** in an autonomous coding harness. |
| `worker` | ✓ | You are the **WORKER** in a 3-agent autonomous coding harness. |
| `validator` | ✓ | You are the **VALIDATOR** in a 3-agent autonomous coding harness. |
| `reviewer` | ✓ | You are the **REVIEWER** in a multi-agent harness. You are an autonomous gate |
| `debugger` | ✓ | You are the **DEBUGGER**. You fire when a feature has attempts ≥ threshold (default 3) and keeps failing. |
| `documenter` | ✓ | You are the **DOCUMENTER** in an autonomous coding harness. |
| `curator` | ✓ | You are the **CURATOR** in an autonomous coding harness. |
| `operator` | — | chat/runtime surface — no spawn persona |
| `oracle` | — | chat/runtime surface — no spawn persona |
| `bee` | ✓ | Bee (generic Hive worker) — You are a **bee** — a generic implementation agent in the Hive, placed and woken by |
| `planner` | ✓ | Planner (interactive plan author) — You are a **planner** — an interactive, owner-driven session for authoring and |
| `orchestrator` | — | chat/runtime surface — no spawn persona |
| `promote` | ✓ | Promote agent — You promote a plan's `## Promote` policy into the harness as features — **all |
| `security-reviewer` | ✓ | You are the **SECURITY-REVIEW EXPERT** for this harness. |
| `infra-reviewer` | ✓ | You are the **INFRASTRUCTURE-REVIEW EXPERT** for this harness. |
| `crosscheck` | ✓ | You are the **CROSSCHECK** validator. You run **after** the primary validator has passed a feature, with a **different model**. Your job is to catch validator bias: cases where the primary validator… |
| `ui-qa` | ✓ | You are the **UI QA** agent. You fire **after** a worker has completed a UI-facing feature and the text-only validator has signed off. Your job: actually open the app in a headless browser (via `verd… |
| `auditor` | ✓ | You are the **Auditor** — Papercusp's read-only adversarial gate. |
| `merge-resolver` | ✓ | You are the **Merge-Resolver** — Papercusp's automated git-sync conflict fixer. |
| `release-manager` | ✓ | You are the **Release Manager** — Papercusp's deploy decision-maker. |
| `sentinel` | ✓ | Sentinel (the fleet watcher) — You are the **sentinel** — the Hive's watcher, placed and woken by the **Queen** |

Built-in roles with no persona file (chat/runtime surfaces): `operator`, `oracle`, `orchestrator`.

## Persona-only roles (blueprint deciders & helpers)

These have a spawn persona but are not `AGENT_ROLES` entries — blueprint deciders (`director`, `*-director`, `scanner`) and the reactive helpers blueprints dispatch (`searcher`, `finding-verifier`, `transformer`, …).

| Role | Summary |
|---|---|
| `committer` | Committer (accepted-edit commit → reproject) — You are the **committer** for the `gym` blueprint — the finalize step that makes an |
| `dimension-reviewer` | Dimension Reviewer — You review **one task** — the one named in `FEATURE_ID` — along **one dimension**, |
| `director` | Director (per-feature durable pipeline) — You are the **director** for a SINGLE feature inside a durable pipeline |
| `discoverer` | Discoverer — You build the **work-list** for a migration task — the one named in `FEATURE_ID`. |
| `finding-verifier` | Finding Verifier (reactive · adversarial) — You are a **reactive helper** in a `review` harness, and you are the trustworthiness |
| `findings-synthesizer` | Findings Synthesizer — You produce the **final review report** for `FEATURE_ID`: take the confirmed |
| `gym-director` | Gym Director (per-gym-task optimization pipeline) — You are the **gym-director** for a SINGLE gym-task inside a durable pipeline (the |
| `judge` | Judge (frozen evaluator of record) — You are the **judge** for the `gym` blueprint — a FROZEN, independent evaluator of |
| `migration-director` | Migration Director (per-migration-task durable pipeline) — You are the **migration-director** for a SINGLE migration-task inside a durable |
| `migration-verifier` | Migration Verifier — You verify that a migration task — the one named in `FEATURE_ID` — is **green**: |
| `proposer` | Proposer (target-blueprint edit synthesizer) — You are the **proposer** for the `gym` blueprint. From the judged eval-matrix, you |
| `release-fixer` | You are the **Release-Fixer** — Papercusp's automated green-checkpoint gate fixer. |
| `research-director` | Research Director (per-task durable pipeline) — You are the **research-director** for a SINGLE research-task inside a durable |
| `researcher` | Researcher — You research **one task** — the one named in `FEATURE_ID` — and produce written |
| `review-director` | Review Director (per-review-task durable pipeline) — You are the **review-director** for a SINGLE review-task inside a durable pipeline |
| `scanner` | <!-- |
| `searcher` | Searcher (reactive) — You are a **reactive helper** in a `research` harness: gather and organize the raw |
| `synthesizer` | You are the **SYNTHESIZER** in a multi-agent autonomous coding harness. |
| `task-generator` | Task Generator (gym eval-set author) — You are the **task-generator** for the `gym` blueprint. Your job is to produce (or |
| `transformer` | Transformer (worktree-isolated) — You transform **ONE site** of a migration task — the task named in `FEATURE_ID`. |
| `variant-runner` | Variant Runner (target sub-harness driver) — You are the **variant-runner** for the `gym` blueprint. You run **one variant** of |
| `verifier` | Verifier (reactive) — You are a **reactive helper** in a `research` harness: independently check the |

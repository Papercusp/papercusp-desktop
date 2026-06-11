# Blueprint catalog
URL: /internal/docs/reference/blueprint-catalog

The built-in harness blueprints — each a declarative harness shape (work-item kind, spine decider, roles, dispatch policy, gates). Generated from the blueprint.yaml source of truth.


> **Generated — do not edit by hand.** Run `npm run gen:doc-projections` (or `npm run gen:doc-blueprint-catalog`).
> Source: `scripts/gen-doc-blueprint-catalog.ts`. Part of `starlight-projection-generators-2026-06-05` (Brief 29).

# Blueprint catalog

A **blueprint** is a harness's declarative shape — its work-item kind, the role spine the engine routes work through (`deriveNext`), its dispatch/concurrency policy, and its finalize gates. Concrete blueprints `extends: base`. The operator instantiates a harness from one of these (`harness:create` / `blueprint:extend`).

Source: `libs/papercusp/packages/harness/blueprints/<id>/blueprint.yaml` (16 concrete + 2 abstract).

## Built-in blueprints

| Blueprint | Extends | Work item | Decider | Dispatch | Roles | Description |
|---|---|---|---|---|---|---|
| `audit` | base | audit-task (`AUD`) | auditor | inherited | 1 | The G2 user-protection gate: a read-only adversarial auditor screens a remote-authored feature and emits an admit/reject verdict; a reject quarantines the feature behind a blocker escalation until a human resolves it. |
| `bee` | single-agent | task (`BEE`) | bee | inherited | 1 | Launch one generic Hive worker (the `bee` role) — a plain implementation agent the Queen places ranked work + a brief onto. Decoupled from the pipeline guards (no chunk, no spine); the brief rides `extras`, the persona is prompts/bee.md. A bee is kind:'harness' (NOT a hive). |
| `coding` | base | feature (`F`) | director | concurrency 4, plan-order | 11 | The default coding harness: a per-feature director drives scoper → architect → worker → validator → reviewer → documenter → curator, with opt-in quality gates (tester / security / crosscheck / ui-qa). |
| `deliberate` | base | decision (`DLIB`) | — | inherited | 0 | Resolve a decision via the uncertainty ladder: ask the owner, then a diverse vote if unanswered, then a curated escalation if the vote is split. |
| `deploy` | single-agent | deploy-run (`DEP`) | release-manager | inherited | 1 | The release-gate deploy launch: the release-manager agent reviews the gathered deploy plan + staged migrations, makes the go/no-go call, runs the deploy, reads health, and decides rollback. Opus-4.8 @ xhigh — the blast radius is the fleet. |
| `gym` | base | gym-task (`G`) | gym-director | inherited | 6 | A meta-harness that optimizes another harness's blueprint: a gym-director drives generate-tasks → run-target-variant (sub-harness) → judge → propose → A/B-gate → accept (commit the target blueprint). The target declares its own gym rubric. |
| `hive` | base | hive-wake (`POT`) | operator | inherited | 2 | The Hive/Hive operator — the Queen in charge of the bee fleet. Wakes on its own self-declared schedule (or an event it subscribed to), surveys the work frontier and bee slots, places ranked tasks onto bees (free slot / graceful-evict+fresh / warm-inject), attaches situational briefs, and declares its next wake. Two roles, both carrying the full Queen role (two-plane coordination, steer-don't-dispatch): the `operator` (the canonical full-role judgment layer, the default decider) and the `queen` (the same role with the dial turned toward placement automation). |
| `implement` | single-agent | improvement (`IMP`) | worker | inherited | 1 | Auto-implement an eligible captured improvement (kind=bug): reproduce, fix with a regression test, keep it self/inline-sized; lands via the release gate. Flag-gated OFF + seeded inactive. |
| `merge-resolution` | single-agent | merge-conflict (`MRG`) | merge-resolver | inherited | 1 | Resolve a git-sync auto-merge conflict: a merge-resolver agent redoes the merge fresh on main, resolves, commits, leaves the tree clean, and does not push. |
| `migration` | base | migration-task (`M`) | migration-director | concurrency 4 | 4 | A migration/codemod harness: a migration-director drives a discoverer (find all sites matching the pattern), a worktree-isolated transformer (transform ONE site), and a verifier (tests/build green per site + overall) — safe large mechanical change. |
| `release-fix` | single-agent | release-fix (`RFX`) | release-fixer | inherited | 1 | Fix a green-checkpoint gate failure: a release-fixer agent reads the checkpoint log, reproduces the failing test to classify regression-vs-flake, then fixes the code or removes a proven flake (hermetic / tier-out / accountable quarantine), leaves the tree clean, and does not push. |
| `research` | base | research-task (`R`) | research-director | concurrency 1 | 4 | A minimal research harness: a research-director drives a single researcher per research-task, with searcher/verifier as reactive helpers. Repo-less. |
| `review` | base | review-task (`RV`) | review-director | inherited | 4 | A review/audit harness: a review-director drives one dimension-reviewer per review dimension, an adversarial finding-verifier refutes each finding before it counts, and a findings-synthesizer dedups + ranks the survivors into one report. |
| `scan` | single-agent | scan-run (`SCAN`) | scanner | inherited | 1 | Proactive workspace scan: the scanner sweeps for latent problems + improvement opportunities no agent flagged and captures each as a tracked work-item (kind=change\|improvement) into the self-improvement triage backlog. |
| `sentinel` | single-agent | task (`SENTINEL`) | sentinel | inherited | 1 | Launch one fleet WATCHER (the `sentinel` role) — the read-mostly observer split out of the overloaded operator (D-004). It sweeps fleet liveness, the coord substrate, and harness health, and raises alarms via coord:escalate/send. It never acts (no spawn/cancel/mutate) — the Queen steers, the sentinel watches. |
| `vote` | base | decision (`VOTE`) | — | inherited | 2 | Decide between options via a diverse-lens, confidence-weighted vote: one voter per lens + an advocate arguing against the lead; resolve decisively or escalate a curated split to the human. |

### Abstract (not directly runnable)

| Blueprint | Description |
|---|---|
| `base` | Abstract base blueprint — common knobs + defaults. Not directly runnable; extended by concrete blueprints. |
| `single-agent` | Abstract parent for single-role run-to-done launches — the shared single-role spine (one decider role + DONE/ESCALATE/IDLE edges + inline planner) plus the governed + durable launch contract. Not directly runnable; extended by implement / scan / merge-resolution / deploy. |

## Details

### `audit`

The G2 user-protection gate: a read-only adversarial auditor screens a remote-authored feature and emits an admit/reject verdict; a reject quarantines the feature behind a blocker escalation until a human resolves it.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `audit-task` (id prefix `AUD`)
- **Spine decider:** `auditor` (maxTurns 10)
- **Planner:** inline
- **Roles (1):** `auditor`

### `base`

Abstract base blueprint — common knobs + defaults. Not directly runnable; extended by concrete blueprints.

- **Version:** 0.1.0

### `bee`

Launch one generic Hive worker (the `bee` role) — a plain implementation agent the Queen places ranked work + a brief onto. Decoupled from the pipeline guards (no chunk, no spine); the brief rides `extras`, the persona is prompts/bee.md. A bee is kind:'harness' (NOT a hive).

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `task` (id prefix `BEE`)
- **Spine decider:** `bee` (maxTurns 80)
- **Roles (1):** `bee`

### `coding`

The default coding harness: a per-feature director drives scoper → architect → worker → validator → reviewer → documenter → curator, with opt-in quality gates (tester / security / crosscheck / ui-qa).

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `feature` (id prefix `F`)
- **Spine decider:** `director` (maxTurns 200)
- **Planner:** features-import
- **Dispatch:** concurrency 4, plan-order
- **Finalize gates:** done: curator → postCuratorOutputs → documenter → archive; escalate: curator
- **Roles (11):** `director`, `scoper`, `architect`, `worker`, `validator`, `debugger` (reactive), `documenter`, `curator`, `security-reviewer` (reactive), `crosscheck` (reactive), `ui-qa` (reactive)

### `deliberate`

Resolve a decision via the uncertainty ladder: ask the owner, then a diverse vote if unanswered, then a curated escalation if the vote is split.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `decision` (id prefix `DLIB`)

### `deploy`

The release-gate deploy launch: the release-manager agent reviews the gathered deploy plan + staged migrations, makes the go/no-go call, runs the deploy, reads health, and decides rollback. Opus-4.8 @ xhigh — the blast radius is the fleet.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `deploy-run` (id prefix `DEP`)
- **Spine decider:** `release-manager` (maxTurns 20)
- **Roles (1):** `release-manager`

### `gym`

A meta-harness that optimizes another harness's blueprint: a gym-director drives generate-tasks → run-target-variant (sub-harness) → judge → propose → A/B-gate → accept (commit the target blueprint). The target declares its own gym rubric.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `gym-task` (id prefix `G`)
- **Spine decider:** `gym-director` (maxTurns 100)
- **Planner:** inline
- **Finalize gates:** done: committer
- **Roles (6):** `gym-director`, `task-generator`, `variant-runner`, `judge`, `proposer`, `committer`

### `hive`

The Hive/Hive operator — the Queen in charge of the bee fleet. Wakes on its own self-declared schedule (or an event it subscribed to), surveys the work frontier and bee slots, places ranked tasks onto bees (free slot / graceful-evict+fresh / warm-inject), attaches situational briefs, and declares its next wake. Two roles, both carrying the full Queen role (two-plane coordination, steer-don't-dispatch): the `operator` (the canonical full-role judgment layer, the default decider) and the `queen` (the same role with the dial turned toward placement automation).

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `hive-wake` (id prefix `POT`)
- **Spine decider:** `operator` (maxTurns 50)
- **Planner:** inline
- **Roles (2):** `operator`, `queen`

### `implement`

Auto-implement an eligible captured improvement (kind=bug): reproduce, fix with a regression test, keep it self/inline-sized; lands via the release gate. Flag-gated OFF + seeded inactive.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `improvement` (id prefix `IMP`)
- **Spine decider:** `worker`
- **Roles (1):** `worker`

### `merge-resolution`

Resolve a git-sync auto-merge conflict: a merge-resolver agent redoes the merge fresh on main, resolves, commits, leaves the tree clean, and does not push.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `merge-conflict` (id prefix `MRG`)
- **Spine decider:** `merge-resolver` (maxTurns 20)
- **Roles (1):** `merge-resolver`

### `migration`

A migration/codemod harness: a migration-director drives a discoverer (find all sites matching the pattern), a worktree-isolated transformer (transform ONE site), and a verifier (tests/build green per site + overall) — safe large mechanical change.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `migration-task` (id prefix `M`)
- **Spine decider:** `migration-director` (maxTurns 200)
- **Planner:** inline
- **Dispatch:** concurrency 4
- **Roles (4):** `migration-director`, `discoverer`, `transformer`, `migration-verifier`

### `release-fix`

Fix a green-checkpoint gate failure: a release-fixer agent reads the checkpoint log, reproduces the failing test to classify regression-vs-flake, then fixes the code or removes a proven flake (hermetic / tier-out / accountable quarantine), leaves the tree clean, and does not push.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `release-fix` (id prefix `RFX`)
- **Spine decider:** `release-fixer` (maxTurns 30)
- **Roles (1):** `release-fixer`

### `research`

A minimal research harness: a research-director drives a single researcher per research-task, with searcher/verifier as reactive helpers. Repo-less.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `research-task` (id prefix `R`)
- **Spine decider:** `research-director` (maxTurns 30)
- **Planner:** inline
- **Dispatch:** concurrency 1
- **Roles (4):** `research-director`, `researcher`, `searcher` (reactive), `verifier` (reactive)

### `review`

A review/audit harness: a review-director drives one dimension-reviewer per review dimension, an adversarial finding-verifier refutes each finding before it counts, and a findings-synthesizer dedups + ranks the survivors into one report.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `review-task` (id prefix `RV`)
- **Spine decider:** `review-director` (maxTurns 40)
- **Planner:** inline
- **Roles (4):** `review-director`, `dimension-reviewer`, `finding-verifier` (reactive), `findings-synthesizer`

### `scan`

Proactive workspace scan: the scanner sweeps for latent problems + improvement opportunities no agent flagged and captures each as a tracked work-item (kind=change\|improvement) into the self-improvement triage backlog.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `scan-run` (id prefix `SCAN`)
- **Spine decider:** `scanner` (maxTurns 30)
- **Roles (1):** `scanner`

### `sentinel`

Launch one fleet WATCHER (the `sentinel` role) — the read-mostly observer split out of the overloaded operator (D-004). It sweeps fleet liveness, the coord substrate, and harness health, and raises alarms via coord:escalate/send. It never acts (no spawn/cancel/mutate) — the Queen steers, the sentinel watches.

- **Extends:** `single-agent`
- **Version:** 0.1.0
- **Work item:** `task` (id prefix `SENTINEL`)
- **Spine decider:** `sentinel` (maxTurns 40)
- **Roles (1):** `sentinel`

### `single-agent`

Abstract parent for single-role run-to-done launches — the shared single-role spine (one decider role + DONE/ESCALATE/IDLE edges + inline planner) plus the governed + durable launch contract. Not directly runnable; extended by implement / scan / merge-resolution / deploy.

- **Extends:** `base`
- **Version:** 0.1.0
- **Planner:** inline

### `vote`

Decide between options via a diverse-lens, confidence-weighted vote: one voter per lens + an advocate arguing against the lead; resolve decisively or escalate a curated split to the human.

- **Extends:** `base`
- **Version:** 0.1.0
- **Work item:** `decision` (id prefix `VOTE`)
- **Roles (2):** `voter`, `advocate`

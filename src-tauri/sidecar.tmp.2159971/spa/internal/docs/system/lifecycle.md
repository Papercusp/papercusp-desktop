# Project lifecycle — idea to completion
URL: /internal/docs/system/lifecycle

Authoritative walkthrough of how a project moves through the harness, traced from the live code (not stale prior docs).

import { Aside } from '@astrojs/starlight/components';

# Project lifecycle — from idea to completion

The harness *drivers* this page traces — bash `run.sh` and the TS run-loop
(`runMainLoop` / `main-loop.ts` / `bin/run.ts`) — are **retired**. The TS
run-loop cluster is archived at `libs/papercusp/_retired/orchestrator-run-loop/`
(plan `archive-legacy-orchestrator-deadcode-2026-06-06`; git tag
`legacy-orchestrator-run-loop-retired-2026-06-06`). The **live pipeline is the
DBOS durable orchestrator** (`packages/operator-core/lib/dbos/` — the decision
verbs now dispatch from `orchestrator-decide.ts`). The *conceptual* flow below
(scoper → worker → validator → reviewer, decision verbs, feature statuses,
hooks) still largely holds — the DBOS pipeline reuses `invoke.ts`, `lanes.ts`,
and the chunk-loop — but every `main-loop.ts` / `run.sh` code reference on this
page points at archived code. Trust the concepts, not the line numbers.

**The operator-side path references on this page have also drifted.** Live
operator code moved out of `apps/operator/lib/*` into
`packages/operator-core/lib/*` (e.g. `expirable-registry.ts`,
`harness-status-sweep.ts`, `expirable-registrations.ts`, `harness-fs-watcher.ts`,
`plugin-host-runtime.ts`, `harness-registry.ts` are all under
`packages/operator-core/lib/` now), and the monolithic Next-style
`apps/operator/app/api/_hono/harness.ts` was retired — the harness API is now
split into focused Hono handlers under
`packages/operator-core/lib/endpoint-route/routes/**`, so the `harness.ts:NNN`
line citations below no longer resolve. A few cited files
(`identity-files-watcher.ts`, `pm-dispatch.ts`, `claude-chat-stream.ts`,
`expert-dispatcher.ts`) no longer exist at all. Treat the directory/file
citations on this page as conceptual landmarks, not literal paths.

**The per-harness-schema storage model is also retired.** Stage 1 and the
"State summary" section below describe provisioning a per-harness Postgres
schema `harness_<slug>` with \~11 physical tables from a
`002-per-harness-template.sql` template. That model was **consolidated** into
slug-keyed shared tables under `harness_shared` (migrations 116–121,
`harness-state-storage-unification-2026-06-01` D-007): the per-harness
`agent_chats` / `feature_audit` / `supervisor_notes` / `directive_summaries` /
`messages` / `executed_actions` physical tables became
`harness_shared.*_consolidated` tables (some surfaced as auto-updatable views),
and the per-harness `config_token` + `harness_proposals` tables were dropped
(`token_index` and `harness_proposals_shared` are authoritative). The template
file no longer exists, and `bin/scaffold-harness-schema.sh` still points at it
(stale). The cross-harness slug-keyed `harness_shared` tables
(`harness_features_consolidated`, `harness_proposals_shared`, …) are live; the
*per-harness physical schema* (and the `harness_features_all` UNION view
regenerated over it) is the part that's gone.

This document is the **authoritative walkthrough** of how a project moves through the
harness, traced from the actual codebase as of 2026-05-06. Earlier docs in this tree
may be out of date; trust this one and the code references it cites.

## Mental model in one paragraph

The user has an idea. They turn it into a `SPEC.md` (the single source of intent).
A **harness** wraps that project — a per-project Postgres schema + a `.papercusp/`
directory + a registered slug. When they hit "start", the harness driver (`run.sh` by default; the
TS port at `libs/papercusp/packages/orchestrator/` runs instead when
`PAPERCUSP_USE_TS_ORCHESTRATOR=1`) boots an
**autonomous loop** of LLM agents: a **scoper** decomposes the spec into features,
the **reviewer** runs once at pre-loop time (`MODE=plan`) to gate the scoper's
output, then the loop alternates an **orchestrator** agent (which decides what
should happen next) with a **worker** (writes code) and **validator** (runs
tests). When a feature has been retried `debugger.threshold` times (default 3),
the **NEXT\_WORKER** handler invokes the **debugger** inline before re-running the worker. State lives in Postgres

* a few markdown files. The loop terminates when every feature is `passed` and
  a final `DONE` decision fires; plugins (`afterDone` hooks) take care of shipping.

Code reference: `libs/papercusp/packages/orchestrator/` (TS) and `libs/papercusp/packages/harness/run.sh` (bash, default).

***

## Stage 0 — User has an idea

**Where this lives:** outside the system. The user knows what they want to build.

If the idea is half-formed, they have **two pre-spec surfaces** in the operator UI to
explore it before committing to a SPEC.md:

| Surface             | URL                                                                                                            | What it does                                                                                                                                                                                        | Persists to                                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brainstorm chat** | `/harness/<slug>?panel=brainstorm`                                                                             | Conversational LLM partner that explores, suggests analogues, challenges assumptions. Can emit `\`\`\`promote:spec\`\`\``/`\`\`\`promote:feature\`\`\``/`\`\`\`promote:issue\`\`\`\` action blocks. | Brainstorm scratchpad **PG-canonical** in `harness_shared.harness_brainstorm` (Migration 033), with `.papercusp/brainstorm.{md,canvas.json,mindmap.json}` as a dual-written file mirror so the orchestrator subprocess can read it. |
| **Architect chat**  | `/harness/<slug>` — embedded inside the **Inbox panel** of the dashboard via `<ArchitectInbox><ArchitectChat>` | More structured — Socratic clarifying questions, proposes concrete `proposal:SPEC.md` or `proposal:contract` diff blocks the user can accept.                                                       | On accept: writes `harness_shared.harness_project_files` (Migration 034) for SPEC.md / validation-contract.md / config.json (PG-canonical, file-mirror) via `POST /:slug/architect/apply`.                                          |

Both are backed by `runClaudeChat` (`apps/operator/lib/claude-chat-stream.ts`),
which spawns the configured agent CLI (`claude -p` or `omp -p` per `AGENT_BACKEND`).

The `promote:*` action-block parser lives at `apps/operator/app/api/_hono/harness.ts:5556`
in `harness.post('/:slug/brainstorm/promote', ...)`. It routes:

* `target: 'feature'` → appends to `.papercusp/features.json` as `F-IDEA-<NNN>` — note: this is the **one writer that hasn't been migrated** to the API yet. Per Stage 2.5, scoper + validator now POST to `/api/harness/<slug>/features/import`; brainstorm/promote still writes the file directly. PG ingestion of those F-IDEA entries happens via run.sh's import shim on the next launch.
* `target: 'spec'` → updates `SPEC.md` via `harness_shared.harness_project_files` (Migration 034); the file mirror is dual-written for editor convenience.
* `target: 'issue'` → appends to `.papercusp/issues.json` (file-canonical; mirrored to per-harness `harness_issues` PG via `syncIssuesToPg`).

**Output of Stage 0:** a `SPEC.md` in the project root. The operator's
`POST /:slug/launch` route requires this — without it, the run aborts with a 400.

***

## Stage 1 — Harness creation

The user **registers a project** (an existing dir on disk) as a harness. Three entry points:

| Entry point                                   | Route                                                                     | What gets created                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Manually-typed slug + path in the operator UI | `POST /api/harness/projects`                                              | Register slug → path mapping; provision PG schema                               |
| From a saved template                         | `POST /api/templates/<slug>/<version>/install`                            | Materialise template files into a target dir, then `POST /api/harness/projects` |
| From a marketplace snapshot                   | `POST /api/marketplace/install` or `POST /api/snapshots/[id]/instantiate` | Fork a snapshot into a fresh harness                                            |

The handler at `apps/operator/app/api/_hono/harness.ts:714` (`harness.post('/projects', ...)`) does:

1. **Register the slug.** Adds `{ slug, path }` to the per-workspace registry at `<workspace-root>/registry.json` via `loadRegistry()` / `saveRegistry()` in `apps/operator/lib/harness-registry.ts`. The legacy `~/.restart-harness-projects.json` is CLI-only; operator code ignores it.
2. **Provision the PG schema.** Runs `bin/scaffold-harness-schema.sh <slug>`, which applies `libs/papercusp/libs/db/sql/002-per-harness-template.sql` against `harness_<slug.replace(/-/g,'_')>`. This creates 11 tables (`harness_features`, `harness_issues`, `harness_snapshots`, `agent_runs`, `agent_chats`, `feature_audit`, `messages`, `directive_summaries`, `executed_actions`, `config_token`, `supervisor_notes`), installs `sync_consolidated_trg` on `harness_features` (mirrors INSERT/UPDATE/DELETE into `harness_shared.harness_features_consolidated`), and adds the schema's tables to the `zero_harness` Postgres publication. *Caveat: the code passes `cwd=/home/marsh-office/Restart` (stale); the script actually lives at `papercupai-workspace/papercup/bin/`.*
3. **Regenerate the cross-harness UNION view.** Runs `scripts/regenerate-harness-features-view.sh`, rewriting `harness_shared.harness_features_all` as `UNION ALL` across every per-harness `harness_features` table (read-only cross-harness aggregator).
4. **Returns** `{ ok, project, provisioning }` — UI uses `provisioning[]` for per-stage success/failure.

**Output of Stage 1:** a slug + project directory + per-harness Postgres schema, ready to receive features.

***

## Stage 2 — Pre-loop bootstrap (planning)

User clicks **"Start"** in the operator dashboard or runs `~/autonomous-harness/run.sh` directly.

`POST /api/harness/<slug>/launch` (`harness.ts:1978`) calls `launchRun(project)` which
spawns `bash -c "nohup <run.sh> >> /tmp/harness-<slug>.log 2>&1 &"`. The script's
own preflight (run.sh:start) does:

1. **Resolve env** — `HARNESS_DIR` / `PROJECT_DIR` / `STATE_DIR=$PROJECT_DIR/.papercusp` / `LOG_DIR=$STATE_DIR/logs`. Reads `phase` from `.papercusp/config.json` (defaults `staging`). Picks `$AGENT_CMD` (or legacy `$CLAUDE`) and `$AGENT_BACKEND` (claude-code or omp; auto-inferred from binary name).
2. **Ensure directories** — at startup, `mkdir -p $STATE_DIR $LOG_DIR` (run.sh:138). Other subdirectories (`memory/`, `proposals/`, `experts/`, `worktrees/`, `screenshots/`, `archives/`, `debug/`, `logs/hooks/`) are created **lazily on first use**, not all up front.
3. **Pre-loop gate** (`pre-loop.ts:runPreLoop` in TS, run.sh:1574-1601 in bash): if `.papercusp/validation-contract.md` is missing OR no features exist, invoke the **scoper** with `MODE=initial`. The scoper reads `SPEC.md` (canonical in `harness_shared.harness_project_files`, Migration 034; file mirror at project root) and writes:

   * `.papercusp/validation-contract.md` — the acceptance bar (markdown-formatted invariants the validator will enforce). PG-canonical in `harness_shared.harness_project_files.contract` (Migration 034); the file is a dual-written mirror.
   * `.papercusp/features.json` — array of `{id, title, status:'todo', attempts:0, claims:[]}` features (transient staging file; see Stage 2.5)

   *Backend divergence: bash `features_exist()` (run.sh:1083) checks `harness_features` PG via `psql`; TS `state.ts:featuresExist` (line 32) checks `features.json` on disk. Re-running an already-scoped harness in TS mode without features.json present will re-fire the scoper.*
4. **Plan-review gate** (formerly "plan-gate"): invoke the **reviewer** with `MODE=plan`. Reviewer reads SPEC.md + scoper output and writes `.papercusp/plan-review.md` with `VERDICT: accept | accept-with-notes | reject | unknown`. The file is mirrored to `harness_shared.harness_plan_review` by the operator's fs-watcher; both the operator prompt builder (`loadHarnessPlanReviews`) and the mobile-intervention watcher read PG, not the file. On `reject`, run.sh exits 7 — no work begins. On `accept-with-notes`, the loop proceeds and the `PlanReviewBanner` (operator UI) surfaces the notes for the human to act on.
5. **Ensure docs** (`bin/ensure-docs.sh`): scaffold the per-harness docs dir if missing.
6. **Auto-checkpoints**: per `config.checkpoints.types`, write `.papercusp/checkpoint-<name>.md` markers so the orchestrator can pause for human approval on configured boundaries.
7. **Worktree prune**: if `branchIsolation.useWorktrees`, garbage-collect stale per-feature git worktrees from previous runs.

**Output of Stage 2:** mission state ready — SPEC.md + validation-contract.md + features (in features.json AND mirrored to `harness_features` PG via the run.sh import shim) + plan-review\.md verdict + (optional) checkpoint markers.

### Stage 2.5 — features.json status (mostly dead, fallback only)

The scoper prompt was migrated 2026-05-01 (see the migration note at the top of
`libs/papercusp/packages/harness/prompts/scoper.md`): it now POSTs directly to
`/api/harness/<slug>/features/import` which writes to PG with INSERT…ON CONFLICT
semantics. The validator prompt is also migrated and explicitly says
"never write to features.json directly".

A **legacy fallback** still exists: if an agent writes `.papercusp/features.json`
anyway, run.sh has a shim that imports it to PG. But the preferred (and now
default-prompted) path is the API endpoint. Treat features.json as essentially
retired in agent flow; the file may still be created by the scoper for snapshot
parity (snapshots include it in their tarball).

***

## Stage 3 — The main loop

run.sh / orchestrator-TS (selected by `PAPERCUSP_USE_TS_ORCHESTRATOR=1`) iterates up to `MAX_ITERATIONS` (default 200):

```
// TS: for (let iteration = 1; iteration <= maxIterations; iteration++) — main-loop.ts:162
// bash: while [ $iteration -lt $MAX_ITERATIONS ] — semantic equivalent
for iteration in 1..MAX_ITERATIONS:
  log("── iteration $iteration ──")
  decision = invoke(primaryRole)   // default 'orchestrator'; configurable via config.primaryRole
  case decision:
    DONE → handleDone(); exit 0
    IDLE → sleep 30s; continue
    ESCALATE <reason> → handleEscalate(); fires on-escalate hook,
                        runs curator (TRIGGER=escalate),
                        notify_event escalate, exit 3.
                        Note: the LLM writes escalation.md as part of
                        its decision (per orchestrator.md §E); the
                        handler only logs.
    CHECKPOINT <name> [message] → handleCheckpoint(); writes
                                  .papercusp/checkpoint-<name>.md and
                                  EXITS the loop with code 8. To
                                  resume: `touch checkpoint-<name>.md.granted`
                                  + re-run. Not a pause — it's a
                                  terminal exit waiting for human grant.
    NEXT_WORKER <fid> [N=k] → handleNextWorker(); routes through 1 of 4 paths:
                        single (max=1) / parallel-lane / competition / adaptive.
                        Adaptive mode reads N from the verb (e.g. NEXT_WORKER F-001 N=2)
                        and validates against the configured tier vocabulary
                        (global, edited at /settings/orchestrator). N=1 acts
                        like lane mode; N>1 acts like competition. ALSO fires
                        the debugger BEFORE the worker if
                        attempts >= debugger.threshold (default 3)
                        AND .papercusp/debug/<fid>.md doesn't exist yet
    NEXT_WORKER_CEO_MODE → CEO-mode worker (self-prompt expansion)
    NEXT_VALIDATOR <fid> → handleNextValidator() — drains lanes, runs validator,
                           updates feature status. Does NOT fire the debugger.
    NEXT_TESTER → handleSimpleInvoke('tester')
    NEXT_SECURITY → handleSimpleInvoke('security-reviewer')
    GENERATE_TESTS → handleSimpleInvoke('test-writer')
    NEXT_MONITOR → handleSimpleInvoke('monitor')   (production phase)
    NEXT_ARCHITECT → handleNextArchitect()
    CONVERTED → log + idle (orchestrator converted issues to fix-features)
    FEATURE_FREEZE <phase> → log + idle
    RUN_TESTS → handleRunTests()
    READY_FOR_PROD → graduate-to-production hook
    NEXT_HARNESS <child-slug> --role=<role> → cross-harness dispatch
    default → exit 4 (unparsable-decision; reachable for verbs that are in
              DECISION_VERBS but lack a switch case, currently
              NEXT_PROJECT_MANAGER and NEXT_SUMMARIZER)
  sleep iterationSleep (default 2s)
end
```

Code: `libs/papercusp/packages/orchestrator/src/main-loop.ts` — `switch (parsed.verb)` at line 265, 17 explicit case branches.

**Exit codes by branch:** `DONE`=0, `IDLE`=continues, `ESCALATE`=3, `CHECKPOINT`=8, `default`=4. Non-terminal branches (`READY_FOR_PROD`, `CONVERTED`, `FEATURE_FREEZE`, etc.) just log + continue.

### Concrete walk-through — one mission, many iterations

You hit "Start" on the `sheets` harness. That's **one mission**. During that mission, this happens:

```
beforeMissionStart fires            ← mission begins
── iteration 1 ──                   ← iteration 1: orchestrator says "NEXT_WORKER F-001"
                                     worker runs, takes 90 seconds
                                     iteration 1 ends
[sleep 2s — iterationSleepMs]
── iteration 2 ──                   ← iteration 2: orchestrator says "NEXT_VALIDATOR F-001"
                                     validator runs, takes 30 seconds
                                     iteration 2 ends
[sleep 2s]
── iteration 3 ──                   ← orchestrator says "NEXT_WORKER F-002"
...
── iteration 87 ──                  ← orchestrator says "DONE"
                                     handleDone runs, fires afterDone hook
                                     handleDone returns terminal MainLoopExit
                                     ← mission ends (exit 0, "done")
```

One mission, 87 iterations, \~2 hours of wall-clock time, \~12 features shipped.

A **mission** is the entire `runMainLoopBody` execution; an **iteration** is one trip through the for-loop. Iterations are nested inside the mission — they're not different *kinds* of things, they're different scales.

**Verb-set divergence between backends:**

|                                    | Bash (run.sh)                                                   | TS (main-loop.ts)                         |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| Recognized verbs                   | 20                                                              | 19                                        |
| Handled verbs                      | 20                                                              | 17 (other 2 fall to default → exit 4)     |
| Bash-only                          | `NEXT_EXPERT` @2186, `NEXT_FEEDBACK` @2204, `NEXT_SCOPER` @2228 | —                                         |
| TS-only (recognized but unhandled) | —                                                               | `NEXT_PROJECT_MANAGER`, `NEXT_SUMMARIZER` |

An agent emitting `NEXT_EXPERT` works in bash but is ignored by TS. One emitting `NEXT_PROJECT_MANAGER` is exit-4'd by TS and treated as unparsed by bash.

**Important**: `NEXT_DEBUGGER` is **not** a decision verb. The debugger role is invoked from inside the **`NEXT_WORKER` handler** (`handleNextWorker` in main-loop.ts:438–456 — the comment in code reads "Optional debugger before the worker.") when a feature has hit the `debugger.threshold` attempts AND `.papercusp/debug/<fid>.md` doesn't exist yet. The flow is: validator returns failing → orchestrator decides `NEXT_WORKER F-001` again → handleNextWorker runs the debugger first, then re-runs the worker. Don't expect the orchestrator agent to emit `NEXT_DEBUGGER` directly, and don't look for the debugger fire-point inside handleNextValidator — it isn't there.

### How an agent runs (`invoke()`)

This is the universal subprocess primitive. Code: `invoke.ts:invoke` (TS) and `run.sh:invoke()` (bash).

For each role invocation:

1. **Resolve prompt file** — 4-tier lookup, first match wins (per `prompt-resolve.ts:candidatesFor` and `run.sh:1229-1262`): `harness/prompts/<phase>/departments/<dept>/<role>.md` → `harness/prompts/<phase>/<role>.md` → `harness/prompts/department/<role>.md` (legacy, only when `phase=department`) → `harness/prompts/<role>.md` (root fallback). The `prompts/base/` directory contains role *base files* that prompts elsewhere `cat` in by hand — it is **not** part of the lookup chain.
2. **Compose prompt** (per `prompt-build.ts:54+ buildPrompt`, in order):
   * **Substrate context** — Tier 1 (this harness's slug + parent harness if any) + Tier 2 (sibling harnesses) + Tier 3 (templates available) + bounded supervisor inbox. Fetched via `fetchSubstrateContext` in invoke.ts:362; goes BEFORE the role prompt so role instructions can refer to "the parent harness above". Empty string on fetch failure.
   * Base prompt content (the resolved `<role>.md` file)
   * User-edited prompt overrides (`config.json#promptOverrides.<role>`)
   * `.papercusp/memory/summary.md` (curated cross-iteration learnings — populated by the curator). PG-canonical in `harness_shared.harness_text_artifacts` (Migration 035); the file is a dual-written mirror so the orchestrator subprocess can read it. **Skipped for the curator role** to avoid feedback loop.
   * Per-role identity at `<harness-package>/identity/<role>.md` (cross-mission patterns the curator maintains). PG-mirrored in `harness_shared.identity_files` (Migration 041) by the operator's `identity-files-watcher`; the operator UI's IdentityPanel reads PG, but the orchestrator subprocess still reads the file at prompt-build time.
   * Runtime-context footer: extras (e.g. `FEATURE_ID=F-001`, `MODE=initial`), cwd (or worktree path), project root, state dir, run ID, and a memory-discipline reminder telling the role to append a one-line observation to `.papercusp/memory/raw.md` if it learned anything actionable. The file is dual-written from `harness_shared.harness_text_artifacts` (Migration 035) when written via the operator UI; subprocess writes (LLM Edit/Write tool) update the file directly and the fs-watcher catches up. **The memory-discipline reminder is omitted for the curator role.**
3. **Run ID:** `<unix-ts>-<role>[-<featureId>]`
4. **CWD:** project root, OR a per-feature git worktree if branch-isolation + worktrees are enabled (avoids workers stomping each other).
5. **Spawn** the agent CLI with backend-specific flags:
   * **claude:** `claude -p --output-format stream-json --verbose --include-partial-messages` ; prompt → stdin
   * **omp (in-loop, orchestrator's invoke.ts):** appends `--mode json --no-session` (`streamFormatFlags` in invoke.ts) ; prompt → tmpfile → `@<path>` positional arg ; stdin closed
   * **omp (chat surfaces, libs/papercup-shared/src/agent/chat-stream.ts):** appends `-p --mode json` plus `--no-session` (only when no `sessionId` opt is set) plus `--no-skills --no-rules` (chat surfaces don't want plugin/skill chatter); same `@<path>` prompt-file pattern. The chat-stream's flag set differs from the orchestrator's because chat surfaces tune for a single-turn predictable response, not a tool-using agent loop.
   * Both backends honour per-role `--model` from `config.json#models.<role>` (or env `AGENT_MODELS` JSON).
6. **Stream capture:** stdout → `<runId>.jsonl`, stderr → `<runId>.err`. The terminal `result` event (claude) or `message_end` (omp) yields the final assistant text → written to `<runId>.out`.
7. **Decision parse:** for the **primary role** (`config.primaryRole`, default `'orchestrator'`; org/department harnesses sometimes set this to `coordinator`), the `.out` body is regexp'd by `decision-parse.ts` to extract the last `DECISION_VERB [arg]` line. Other roles' `.out` is read by their callers as freeform text or parsed for action blocks.
8. **Hooks** — three distinct categories fire around an invoke():

   **User hooks** (fixed set, fire from `runHook()` in main-loop.ts):

   * Pre/post for spawned subprocesses only: `pre-worker`@467, `post-worker`@496, `pre-validator`@556, `post-validator`@588 (+ `pre-worker`@759, `post-worker`@780 in parallel-lane path).
   * Other lifecycle hooks: `on-smoke-pass`@366, `on-smoke-fail`@369, `on-competition-start`@648, `on-competition-won`@875, `on-escalate`@922, `on-checkpoint-fired`@983 (also pre-loop.ts:159).
   * No `pre-`/`post-` hooks exist for orchestrator/scoper/reviewer/debugger/curator/etc. — adding a `pre-curator` script will silently no-op.

   **Plugin lifecycle hooks** — fired from two places:

   * **Operator Hono routes** call `firePluginLifecycle` for UI-driven transitions: `beforeMissionStart` (POST /launch, harness.ts:1999), `onFeaturePassed` (PATCH features → passed, harness.ts:1410), `onProposalAccepted` (POST proposals/:id/accept, harness.ts:3258).
   * **Orchestrator** (run.sh and TS main-loop.ts) shells out to the `papercusp-fire-hook` CLI for loop-internal transitions. TS fires 7 hooks: `onLoad`@114, `beforeMissionStart`@160, `onPostOrchestrator`@167, `onPostWorker`@509, `onPostValidator`@601, `afterDone`@393, `onUnload`@118 (in `finally` so it runs on abort). Bash fires the same set minus the TS-only `onLoad`/`onUnload`.

   **Event-bus events** — plugins can subscribe via `events:listen:<name>` capability; see plugin manifests for available events.

### Per-feature workflow

Typical happy path for one feature:

1. **orchestrator** → emits `NEXT_WORKER F-001`
2. **worker** runs. First, `handleNextWorker` flips status to `in_progress` and bumps `attempts` (main-loop.ts:476). The worker then reads SPEC.md + claim list for F-001 + recent issues, writes code, and at completion sets status to **`validating`** (per `prompts/worker.md` "Definition of done", via `PATCH /api/harness/<slug>/features/<id>`). The `in_progress` write is the orchestrator's; the `validating` write is the worker's.
3. **orchestrator** → emits `NEXT_VALIDATOR F-001`
4. **validator** runs → executes acceptance scripts from `validation-contract.md`, writes pass/fail. On fail: appends to `.papercusp/issues.md` + sets feature status `failing`
5. If `failing`: orchestrator → `NEXT_WORKER F-001` again → `handleNextWorker` first fires the **debugger** (when `attempts >= config.debugger.threshold` (default 3) and no `.papercusp/debug/<fid>.md` exists yet), then re-invokes the worker
6. If still failing after debugger: orchestrator escalates → `NEXT_ARCHITECT F-001` for re-plan, or eventually `ESCALATE`
7. On pass: orchestrator picks next feature

A typical feature ships in 5–15 iterations. Total cost is tracked in `total_cost_usd`
fields across the .jsonl logs and surfaces via `cost-cap.ts` — over budget triggers
SIGTERM on the entire process group.

### Roles catalogue (live as of 2026-05-06)

Prompt files at `libs/papercusp/packages/harness/prompts/`. The "When invoked" column is verified by grep against `main-loop.ts`, `run.sh`, and the operator API tree.

**In-loop roles (called by main-loop.ts or run.sh during iteration):**

| Role                  | When invoked                                                                                                                                                                                                                               | Reads                                                               | Writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **scoper**            | pre-loop step 1 (`MODE=initial`) when contract or features missing; also on `POST /:slug/replan`                                                                                                                                           | SPEC.md                                                             | POSTs `/api/harness/<slug>/features/import` (PG); writes `.papercusp/validation-contract.md` (PG-mirrored to `harness_project_files.contract`)                                                                                                                                                                                                                                                                                                                                                                                         |
| **reviewer**          | pre-loop step 1.5 (`MODE=plan`) — **only here**, not on completion                                                                                                                                                                         | scoper output, SPEC.md                                              | `.papercusp/plan-review.md` (`VERDICT: …`) — PG-mirrored to `harness_shared.harness_plan_review` by fs-watcher                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **orchestrator**      | every loop iteration                                                                                                                                                                                                                       | `.papercusp/` state, recent run.log, memory                         | last-line decision verb (one of 19 in `DECISION_VERBS`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **worker**            | `NEXT_WORKER` (single / parallel-lanes / competition path)                                                                                                                                                                                 | SPEC.md, feature claims, recent issues                              | project code; PATCHes `/api/harness/<slug>/features/<id>` for status changes                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **validator**         | `NEXT_VALIDATOR`                                                                                                                                                                                                                           | validation-contract.md, feature claims                              | `harness_features.status` via PATCH; `.papercusp/issues.md` (PG-canonical in `harness_text_artifacts`, Migration 035; file mirror); POSTs `/api/harness/<slug>/issues/append-pending` per finding                                                                                                                                                                                                                                                                                                                                      |
| **debugger**          | invoked inline by the **`NEXT_WORKER` handler** (`handleNextWorker` in main-loop.ts:438–456) BEFORE the worker runs, when `attempts ≥ debugger.threshold` (default 3) AND `.papercusp/debug/<fid>.md` doesn't exist (one-shot per feature) | failing feature's issues, recent worker output                      | code (fix attempts), `.papercusp/debug/<fid>.md` marker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **architect**         | `NEXT_ARCHITECT` decision (in-loop)                                                                                                                                                                                                        | SPEC.md, contract, features, issues                                 | proposals — emits fenced `proposal:contract` / `proposal:SPEC.md` blocks in stdout (parsed per `prompts/architect.md` line 55+); the orchestrator extracts those blocks and writes `.papercusp/proposals/<id>.md`; `apps/operator/lib/harness-fs-watcher.ts` then mirrors the file into `harness_shared.harness_proposals_shared`. There is **no** `POST /api/harness/<slug>/proposals` endpoint — only `GET /:slug/proposals`, `GET /:slug/proposals/:id`, and `POST /:slug/proposals/:id/accept` / `…/reject` (harness.ts:3189–3290) |
| **curator**           | on `DONE` (`TRIGGER=done`) and on `ESCALATE` (`TRIGGER=escalate`)                                                                                                                                                                          | `.papercusp/memory/raw.md` (PG-canonical, Migration 035 dual-write) | `memory/summary.md`, `memory/MEMORY.md` (both PG-canonical via Migration 035), role identity files (PG-mirrored via Migration 041)                                                                                                                                                                                                                                                                                                                                                                                                     |
| **documenter**        | on `DONE` (`TRIGGER=done`)                                                                                                                                                                                                                 | feature docs, issues, summary                                       | per-harness docs dir                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **ui-qa**             | invoked **automatically by run.sh:2105** post-worker, when feature has any `VAL-UI-*` claim AND `verdict` CLI is on PATH (NOT via `NEXT_TESTER`)                                                                                           | `auto_screenshot_post_worker` output                                | `UIQA_PASS`/`UIQA_FAIL` line; on fail, run.sh sets feature status `failing`                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **crosscheck**        | invoked from run.sh:2040 inside the validator handler when `config.crosscheck.enabled = true` (currently bash-only — TS port doesn't fire it)                                                                                              | feature claims                                                      | second-opinion verdict line                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **security-reviewer** | `NEXT_SECURITY`                                                                                                                                                                                                                            | code diff for feature                                               | security verdict                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

**Out-of-loop roles (invoked by operator code, not by the main loop):**

| Role                         | Invoked by                                                                    | Notes                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **architect** (chat surface) | `runClaudeChat` from `/api/harness/<slug>/architect/chat` (`harness.ts:5259`) | conversational variant of the in-loop architect role                       |
| **scanner**                  | `runClaudeChat` from `/api/agent-mcp/operator-scan`                           | OS-level workspace scan; writes suggestion JSON cards back to the operator |
| **project\_manager**         | `apps/operator/lib/pm-dispatch.ts` on `pm_due` events                         | scheduled spec-revision proposals                                          |
| **expert**                   | `apps/operator/lib/expert-dispatcher.ts` (POST `/:slug/experts/dispatch`)     | one-shot autonomous role dispatched from the /experts panel                |

**Roles with prompt files but no live invocation path** (verify before relying on them):

| Role                                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **infra-reviewer**                       | Live, but only via the **expert** path (not in main-loop). Has `prompts/infra-reviewer.md` + `prompts/infra-reviewer.role.json` registering it with the role-registry. Reachable via human dispatch (`POST /:slug/experts/dispatch` → `experts.ts:411` → `dispatchExpert`) or auto-trigger (`expert-triggers.ts` on configured `role.alwaysFireOn` events). The scoper prompt recommends it as a consultant for infra-touching changes. |
| **summarizer**                           | `NEXT_SUMMARIZER` is in `DECISION_VERBS` but lacks a switch case in main-loop.ts — falls to default and exits 4. Prompt file exists but the verb is effectively dead.                                                                                                                                                                                                                                                                   |
| **feedback**                             | prompt file exists but `agent-chats.ts:73` explicitly excludes it (`if (role === 'feedback') return false`). Likely a dead role from an earlier design.                                                                                                                                                                                                                                                                                 |
| **tester**, **test-writer**, **monitor** | Phase-scoped. Invoked from `main-loop.ts` via `handleSimpleInvoke(...)` for `NEXT_TESTER` / `GENERATE_TESTS` / `NEXT_MONITOR`. Prompts at `prompts/testing/{tester,test-writer}.md` and `prompts/production/monitor.md` — resolve only when `config.json#phase` matches. No root-level fallback, so invocation outside the matching phase fails at prompt-resolve. The staging-phase orchestrator is unlikely to emit these verbs.      |

`identity/<role>.md` files (cross-mission) are maintained by the curator across runs. PG-mirrored to `harness_shared.identity_files` (Migration 041) by `apps/operator/lib/identity-files-watcher.ts`; the operator UI's IdentityPanel reads PG, but the orchestrator subprocess at `prompt-build.ts:87` still reads the file directly per role contract.

***

## Stage 4 — Live monitoring (parallel to Stage 3)

While the loop runs, the operator UI surfaces live state:

| UI surface                                | Code                                                 | Data source                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HarnessDashboard** at `/harness/<slug>` | `app/harness/HarnessDashboard.tsx`                   | Six Zero subscriptions: `features<HarnessName>.all` (e.g. `featuresSheets.all`) for the work queue, `agentRuns<HarnessName>.all` (reads per-harness `agent_runs`), `proposalsShared.byHarness` (cross-harness `harness_shared.harness_proposals_shared`), `harnessStatus.byHarness`, `pendingReviews.byHarness`, `harnessLanes.byHarness`. Sub-components subscribe further (IssuesList → `issues<HarnessName>.all`, SnapshotsPanel → `snapshots<HarnessName>.all`). |
| **Run log tail**                          | rendered inside `HarnessDashboard.tsx` (\~line 2509) | SSE: `GET /api/harness/:slug/log/stream?phase=…&tail=500` (route at `harness.ts:1809`) — streams structured events from `.papercusp/logs/run.log.jsonl`. (A separate `GET /:slug/stream` at `harness.ts:1654` tails the plain `run.log` text — used by other surfaces, not the dashboard.)                                                                                                                                                                           |
| **Plan review banner**                    | `app/harness/PlanReviewBanner.tsx`                   | `GET /:slug/plan-review` (file content) + `GET /:slug/plan-review/sse` for change events                                                                                                                                                                                                                                                                                                                                                                             |
| **Proposals panel**                       | `app/harness/ProposalsPanel.tsx`                     | Zero query `proposalsShared.byHarness` reading `harness_shared.harness_proposals_shared` (cross-harness shared table — NOT per-harness). Accept/reject via `POST /:slug/proposals/:id/accept` and `POST /:slug/proposals/:id/reject`                                                                                                                                                                                                                                 |
| **Issues list**                           | `app/harness/issues/IssuesList.tsx`                  | Zero query `issues<HarnessName>.all` (camelCase per-harness, e.g. `issuesSheets.all`, `issuesOrgRd.all`)                                                                                                                                                                                                                                                                                                                                                             |
| **Feature list**                          | `app/harness/FeatureList.tsx`                        | Zero query `features<HarnessName>.all` (camelCase per-harness, e.g. `featuresSheets.all`) — canonical UI read path post-2026-04-27 PG migration                                                                                                                                                                                                                                                                                                                      |
| **Recent agents**                         | dashboard panel                                      | Zero query `agentRuns<HarnessName>.all` (e.g. `agentRunsSheets.all`); reads per-harness `agent_runs` (no `harness_` prefix)                                                                                                                                                                                                                                                                                                                                          |
| **Snapshots panel**                       | `app/harness/SnapshotsPanel.tsx`                     | Zero query `snapshots<HarnessName>.all`                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Recent actions popover**                | chrome-mounted `RecentActionsCenter`                 | Zero query `userActions.byHarness` (or REST poll fallback off-/harness routes; see `OperatorActionLog.tsx`)                                                                                                                                                                                                                                                                                                                                                          |
| **Oracle dock**                           | `app/_components/OracleDock.tsx`                     | global concierge — runs `runClaudeChat` with the Oracle MCP server attached, can navigate / dispatch agents / list chats                                                                                                                                                                                                                                                                                                                                             |

### Human in the loop, optional

The user can intervene at any iteration without stopping the loop:

* **Edit features manually** via `FeatureEditor` — `PATCH /:slug/features/<id>` (writes PG directly).
* **Edit SPEC.md or validation-contract.md** — agents pick up the change on next iteration.
* **Trigger /replan** — `POST /:slug/replan` (harness.ts:3321) records a `replan` user\_action and kicks off `invokeScoperBackground(project, 'replan')`. *Note: a duplicate handler at harness.ts:3654 with backup-on-overwrite semantics is unreachable (Hono dispatches the first registration); treat as latent dead code.*
* **Accept/reject proposals** — `POST /:slug/proposals/:id/accept` and `POST /:slug/proposals/:id/reject` (architect / scoper proposed changes await human approval).
* **Dispatch experts** via `/experts` panel — `POST /:slug/experts/dispatch` calls `expert-dispatcher.ts:dispatchExpert()` which runs a one-shot autonomous role outside the main loop, lockfile-guarded, recorded as a user\_action row.
* **Inter-agent messages** are stored in the per-harness `messages` table (created by the schema template), not as on-disk files.

***

## Stage 5 — Completion

The orchestrator emits `DONE` when every feature in `harness_features` has status `passed` and validation-contract.md acceptance has been demonstrated.

`handleDone()` (`main-loop.ts:342`, with bash equivalent in run.sh) runs in this order:

1. **Smoke-test gate** — if `config.smokeTest.enabled` AND `smokeTest.onDone`, run the configured smoke test (a bash script).
   * On **pass**: fires the `on-smoke-pass` user hook, then continues to step 2.
   * On **fail**: fires `on-smoke-fail`, returns `{terminal: false, reason: 'idle'}` (TS) / `continue`s the loop (bash) — **steps 2–6 below are SKIPPED** in this case. No feature is "reopened"; the orchestrator just gets another iteration to decide what to do next.
2. **Curator** — `invoke('curator', TRIGGER=done)` — distils the run's `memory/raw.md` into `memory/summary.md` and updates per-role `identity/<role>.md` cross-mission notes.
3. **Documenter** — `invoke('documenter', TRIGGER=done, FEATURE_ID=-)` — generates user-facing docs for the project.
4. **(Optional, bash only) Scoper in proposal mode** — if `config.proposals.enabled` AND `config.proposals.afterDone` (or legacy `product.enabled` / `product.triggerOnDone`): `invoke('scoper', MODE=proposal)` to propose next-phase features. Reviewer can auto-approve via `proposals.autoApply` (default true). The TS port skips this — see `main-loop.ts:390` ("Skipping optional scoper-on-done + archive-on-done — minor polish.").
5. **(Optional, bash only) Archive-on-done** — if `config.archiveOnDone=true`: `tar czf .papercusp/archives/<unix-ts>-done.tar.gz -C $STATE_DIR --exclude=archives .`. TS port skips this.
6. **Plugin lifecycle** — `firePluginHook({hookName: 'afterDone', ...})` shells out to `papercusp-fire-hook` CLI; iterates installed plugins, invokes any with an `afterDone` hook. Plugins can also subscribe to the `mission-done` event-bus event via the `events:listen:mission-done` capability.

   Live plugin set in `libs/papercusp/plugins/` and their event subscriptions:

   | Plugin                                                                   | Event subscriptions                                                     |
   | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
   | `@papercupai/cloudflare-pages`                                           | `mission-done` → publishes to Cloudflare Pages                          |
   | `@papercupai/jira-sync`                                                  | `feature-passed`, `feature-failed`, `proposal-accepted`, `mission-done` |
   | `@papercupai/linear-sync`                                                | same four as jira-sync                                                  |
   | `@papercupai/notion-export`                                              | `mission-done` (action: `exportMission`)                                |
   | `@papercupai/slack-notifier`                                             | `mission-done`, `action-failed`                                         |
   | `@papercupai/fumadocs`, `pi-coding`, `postgres-manager`, `vscode-server` | none — UI tabs / manual actions only                                    |

   *briefings is not a plugin* — it's a separate app at `Restart/apps/briefings`; the `afterDone` hook can't reach it directly.
7. **Notify** — `notify_event('done', 'Mission complete: all features passed after N iterations')`.
   * TS (`log.ts:33`): appends `[ts] body` to `<eventsDir>/done.log` and writes `EVENT done: …` into run.log.
   * Bash: runs `$NOTIFY <kind> <message> <project-dir>` if `$NOTIFY` is set (e.g. `pushnotify`, `slack-send`); otherwise just logs.
   * Neither path posts to an operator notification API. No notification card auto-appears in the UI.
8. **Exit 0.**

The operator's harness page reflects completion via Zero subscriptions to `harness_features` (all rows now `status='passed'`), `agent_runs` (final curator/documenter rows visible), and `userActions` (any `mission.done`-related user\_action rows the operator wrote separately).

***

## Failure / escalation paths

Any of these can short-circuit the happy path:

| Path                         | Trigger                                                                                                                          | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan rejected**            | reviewer writes `VERDICT: reject` in plan-review\.md                                                                             | Pre-loop exits 7 with reason "plan-rejected"; user must edit SPEC.md and re-launch                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Stuck feature**            | feature `attempts >= debugger.threshold` (default 3); after debugger fires once, further failures lead to architect/escalate     | Orchestrator emits `NEXT_ARCHITECT` for replan, or eventually `ESCALATE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ESCALATE**                 | orchestrator decision after exhausting options                                                                                   | LLM writes `.papercusp/escalation.md` (per orchestrator.md §E), then prints `ESCALATE <reason>`. handleEscalate fires `on-escalate` hook, runs curator (`TRIGGER=escalate`), notify\_event, exits 3. The **supervisor cron** (`bin/supervisor.sh`, suggested `0 */6 * * *`; user owns the actual crontab) wakes periodically, reads escalation.md + recent logs, decides: unblock / expand spec / ping human. *Note: escalation.md is also written system-side by run.sh:1620 / pre-loop.ts:87 on plan-reviewer reject — that path exits 7, not 3.* |
| **Cost cap exceeded**        | `cost-cap.ts` (or `run.sh:check_cost_cap`) sums each `.jsonl`'s last `total_cost_usd` per iteration; exceeds `config.maxCostUsd` | Clean **exit 6** (not SIGTERM); `notify_event cost-cap` fires. Soft warn at `config.maxCostUsdWarnThreshold` \* cap (default 0.8, dedup'd by `.papercusp/.cost-warn-fired` sentinel). Optional `config.maxCostUsdAutoPause=true` SIGSTOPs the process at warn threshold; `/api/harness/<slug>/unpause` SIGCONTs it.                                                                                                                                                                                                                                 |
| **Timeout**                  | per-role `config.timeouts.<role>` exceeded                                                                                       | invoke() returns rc=124; orchestrator treats as failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Smoke test fails on done** | `smokeTest.onDone` script exits non-zero                                                                                         | Feature reopens, loop continues                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Manual stop**              | user kills the process or hits "Stop" in UI                                                                                      | `POST /:slug/stop` walks `/proc`, matches processes whose cwd starts with `project.path` AND whose cmdline contains `autonomous-harness/run.sh` or `/harness/run.sh`, then SIGTERMs each                                                                                                                                                                                                                                                                                                                                                            |

***

## State summary — what lives where

### Postgres (canonical, queryable)

Per-harness schema `harness_<slug.replace(/-/g,'_')>` — 11 tables created from `libs/papercusp/libs/db/sql/002-per-harness-template.sql`:

* `harness_features` — feature rows. Columns: `harness_slug`, `feature_id`, `title`, `summary`, `status`, `attempts`, `claims` (TEXT — JSON-encoded array of claim strings), `notes`, `metadata` (JSONB), `kind`, `project_id`, `expected_cost_cents`, `tags` (JSONB), `needs_human_review`, `ts`, `created_ts`, `updated_ts`, `parent_id` + `goal_id` (goal-ancestry — cross-schema FK), `taken_by` + `taken_at` + `expires_at` (atomic checkout via FOR UPDATE SKIP LOCKED), `deprecation_reason` (set when `status='deprecated'`)
* `harness_issues` — validator + crosscheck + ui-qa issues
* `harness_snapshots` — snapshot metadata (snapshot tarballs stay on disk)
* `agent_runs` — per-invocation metadata: role, feature, run\_id, cost, tokens, exit code (full stdout stays on disk in `.jsonl`). **Note**: name is `agent_runs`, NOT `harness_agent_runs`
* `agent_chats` — per-harness chat thread metadata (per-feature agent-chat surface)
* `feature_audit` — append-only audit trail of feature mutations
* `messages` — inter-agent / user-to-agent messages
* `directive_summaries` — summaries of operator directive cards
* `executed_actions` — record of actions executed against this harness
* `config_token` — per-harness config tokens
* `supervisor_notes` — supervisor cron notes table

Cross-harness shared schema `harness_shared`:

* `delegates` — Claude/agent conversation sessions for the voice layer + Oracle dock (column `agent_backend` distinguishes claude-code vs omp post-Wave-3 of the omp routing migration)
* `user_actions` — user-initiated long-running actions. Actual `kind` values in code (verified by grep over `recordUserAction(slug, '<kind>'` calls): `replan`, `cleanup` (both in `harness.ts`), `snapshot.create` / `snapshot.publish` / `snapshot.fork` (snapshots routes), `branch.action` (branch action-run route), `expert.dispatch` (`expert-dispatcher.ts:154`). No `plugin.install` kind exists today, despite older comments referencing it. (The `consolidate` kind was retired alongside the route — `cleanup` covers the intent.)
* `harness_proposals_shared` — **proposals live here**, NOT in a per-harness `harness_proposals` table. Single shared table; ProposalsPanel reads `proposalsShared.byHarness(slug)`.
* `harness_features_all` — UNION ALL **view** across every per-harness `harness_features` table; rebuilt by `scripts/regenerate-harness-features-view.sh` whenever a new per-harness schema is added.
* `harness_features_consolidated` — **trigger-maintained mirror table** of every per-harness `harness_features` row. Maintained in real-time by `sync_consolidated_trg` (template line 54): `INSERT … ON CONFLICT DO UPDATE` on AFTER INSERT/UPDATE, `DELETE` on AFTER DELETE. Trigger function: `harness_shared.sync_features_consolidated()` in `001-shared.sql`.
  * **Columns** (PK `(harness_slug, feature_id)` + 21 mirrored): `title`, `summary`, `status`, `attempts`, `claims`, `notes`, `metadata`, `kind`, `project_id`, `expected_cost_cents`, `tags`, `needs_human_review`, `ts`, `created_ts`, `updated_ts`, `parent_id`, `goal_id`, `taken_by`, `taken_at`, `expires_at`. **Not mirrored:** `deprecation_reason`.
  * **Indexes**: `(status)`, `(needs_human_review)`, `(harness_slug)`, `(updated_ts DESC)`.
  * **Read path**: Zero queries `featuresConsolidated.all` / `.bySlug` / `.needsReview` (queries.ts:292) — the cross-harness Features grid subscribes here, distinct from the regenerated `harness_features_all` UNION view.

All UI reads go through Zero-synced named queries (`libs/zero-harness/src/queries.ts`),
which subscribe to the publication `zero_harness` on the `papercusp` Postgres database.

### Filesystem (transient + append-only blobs)

Most per-project text/structured artifacts have been pulled into Postgres. The on-disk file is retained as a dual-written mirror because the orchestrator subprocess (run.sh / TS main-loop) reads role contracts directly from disk per the role-prompt files in `libs/papercusp/packages/harness/prompts/`. Operator UI code reads PG.

**Storage policy reference:** `/internal/docs/system/storage-policy` documents the PG-by-default rule and the dual-write pattern.

`.papercusp/` per-project — by category:

**PG-canonical, file mirror (operator UI reads PG; orchestrator/curator subprocess reads the file):**

| File                                                                     | PG location                                                                                                                                                                                                                                    | Migration |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `config.json`                                                            | `harness_shared.harness_project_files.config`                                                                                                                                                                                                  | 034       |
| `validation-contract.md`                                                 | `harness_shared.harness_project_files.contract`                                                                                                                                                                                                | 034       |
| `brainstorm.md`, `brainstorm.canvas.json`, `brainstorm.mindmap.json`     | `harness_shared.harness_brainstorm` (content / canvas / mindmap columns)                                                                                                                                                                       | 033       |
| `memory/raw.md`, `memory/summary.md`, `memory/MEMORY.md`                 | `harness_shared.harness_text_artifacts` (rel\_path key)                                                                                                                                                                                        | 035       |
| `issues.md`                                                              | `harness_shared.harness_text_artifacts`                                                                                                                                                                                                        | 035       |
| `escalation.md`                                                          | `harness_shared.harness_text_artifacts`                                                                                                                                                                                                        | 035       |
| `supervisor-notes.md`                                                    | `harness_shared.harness_text_artifacts` (Migration 035, round 18 dual-write fix). Also mirrored to `harness_shared.harness_escalations.supervisor_notes` column by `harness-fs-watcher.ts` for the operator's escalations panel (legacy view). | 035       |
| `prompts/<role>.md`, `worker-log.md`, etc. (any free-form text artifact) | `harness_shared.harness_text_artifacts`                                                                                                                                                                                                        | 035       |

The `.papercusp/config.json` notes the phase/dept/models/timeouts/smokeTest/branchIsolation/checkpoints/autoScreenshot/debugger-threshold/cost-cap settings. **Plugin enables are NOT here** — those live at `~/.papercusp/harnesses/<slug>/enabled-plugins.json` (CLI-authoritative) and mirror to `harness_shared.plugin_enables` via `plugin-enables-pg.ts`.

**File-canonical, PG-mirrored (the file is the source of truth for the worker; PG mirror serves operator UI):**

| File                   | PG mirror                                 | Mirror mechanism                                                                                |
| ---------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `plan-review.md`       | `harness_shared.harness_plan_review`      | `harness-fs-watcher.ts`                                                                         |
| `pending-issues.jsonl` | `harness_shared.harness_pending_issues`   | fs-watcher; ids without explicit `id` synthesized as `PENDING-<n>` to match the operator reader |
| `issues.json`          | per-harness `harness_issues` table        | `syncIssuesToPg` called by every operator-side write                                            |
| `proposals/<id>.md`    | `harness_shared.harness_proposals_shared` | fs-watcher (mirror 6 in `harness-fs-watcher.ts`)                                                |

**Largely retired (legacy fallback only):**

* `features.json` — scoper + validator prompts migrated 2026-05-01 to the `/api/harness/<slug>/features/import` and `/features/<id>` PATCH endpoints. run.sh keeps a legacy "features.json → psql" import shim for back-compat. Snapshots may still include this file in their tarball for restore parity.

**File-only by design (legitimate file usage per the storage policy):**

* `events/<eventName>.log` — append-only log per event-kind (`done`, `escalate`, `cost-cap`, `cost-warn`, `checkpoint`, `max-iter`, etc.). Written by `notifyEvent`/`notify_event`. Per-event files keep the body separately from `logs/run.log` so a downstream supervisor can grep for events of one kind without scanning the full log.
* `.cost-warn-fired` — sentinel file (zero-byte) created the first time the soft cost-cap warn fires this mission; prevents duplicate warns on subsequent iterations. (O\_EXCL-style sentinel — file existence is the contract.)
* `experts/runs/<safeName>-ua-<userActionId>.log` — expert run output. `safeName` is the role id with `:`, `/`, and `@` replaced by `_` (matters for plugin-contributed roles like `@scope/role:variant`); `userActionId` is the row id from `user_actions` created at dispatch time (`expert-dispatcher.ts:158`).
* `logs/run.log` — plain-text append-only iteration log written by `log()` in both run.sh + orchestrator's `log.ts`. The legacy SSE `/:slug/stream` endpoint tails this; the dashboard does not.
* `logs/run.log.jsonl` — structured-event log written by run.sh (path defined at run.sh:143 as `LOG_JSONL`). The dashboard's run-log panel tails this via `/:slug/log/stream` (harness.ts:1809). Rotated to `run.log.jsonl.<N>.gz` at `PAPERCUSP_LOG_ROTATE_BYTES` threshold.
* `logs/<runId>.{jsonl,out,err,prompt.md}` — per-invocation stream-json log, extracted final assistant text (parsed by orchestrator for next decision), stderr capture, and (omp only) the assembled prompt.
* `snapshots/<id>.tar.gz` — snapshot tarballs (paths.ts:38-46). Read via `readManifestFromTarball` (snapshot-discovery.ts:101). Per-capture scratch at `.papercusp/snapshot-staging/`. Metadata in `harness_snapshots` PG table.
* `archives/<ts>-done.tar.gz` — `.tar.gz` of state-dir snapshots created on `archiveOnDone` (run.sh:1820); read by the operator's archives panel.
* `screenshots/<feature-id>-<unix-ts>.png` — auto-captured by `auto_screenshot_post_worker` (run.sh:848-868) when `config.autoScreenshot.enabled=true` AND `autoScreenshot.url` is set AND `verdict` CLI is on PATH. Keyed on feature ID + timestamp.
* `worktrees/<feature-id>/` — per-feature git worktrees if branch-iso enabled.
* `debug/<fid>.md` — debugger one-shot marker; presence prevents the debugger from re-firing on the same feature.

`SPEC.md` lives at the project root, not in `.papercusp/`. It's the user-authored intent file. Now PG-canonical in `harness_shared.harness_project_files.spec` (Migration 034); the file mirror is dual-written for editor convenience and so the worker subprocess can read it.

### User registry + global config

* `<workspace-root>/registry.json` — per-workspace slug → path registry (read by every API route via `loadRegistry()` in `apps/operator/lib/harness-registry.ts`). Bootstrap-class file (needed before PG is reachable). `~/.restart-harness-projects.json` is a legacy global file written only by the CLI for transition compat; operator code ignores it.
* `~/.papercusp-workspaces/<workspaceId>/.papercusp/` — per-workspace operator state (credentials, oracle config, agent config, plugin configs, plugin data).
  * **Credentials** (operator API keys, voice creds, marketplace tokens, publish creds, trust store) are PG-canonical in `harness_shared.operator_*` tables and **encrypted at rest** via pgcrypto (Migration 027 + 028).
  * **Plugin OAuth tokens** at `~/.papercusp/harnesses/<slug>/plugin-configs/<plugin>.json` are file-canonical because the substrate plugin loader reads them synchronously and cannot decrypt; the PG mirror at `harness_shared.plugin_configs` is encrypted (Migration 039), and the on-disk file is mode 0600.
  * **Most other operator state** (operator\_credentials, operator\_voice\_credentials, operator\_paused, oauth\_nonces, mobile\_pair\_tokens, operator\_rate\_limit, cooldown\_marks, profile state) lives in PG; see `/internal/docs/system/storage-policy` for the full list.
* `~/.papercusp-workspaces/registry.json` — active workspace selection (bootstrap).
* `~/.papercusp/db-encryption-key` — symmetric key (32 random bytes, base64, mode 0600) for the pgcrypto encryption-at-rest. Override via `PAPERCUSP_DB_ENCRYPTION_KEY`.
* `<papercuspRoot>/agent/config.json` — agent backend selection (claude-code | omp | auto), custom command, per-role model overrides; written by `/settings/agent` UI.

***

## Cleanup of ephemeral state

Several tables hold "this thing is happening right now" state that has to disappear when it's no longer true. Two distinct mechanisms handle this, split by signal kind.

### TTL-based: `apps/operator/lib/expirable-registry.ts`

For state with a clear "lease until" semantic. Writers set `expires_at` on every write; the registry runs a single 30-second sweep loop that DELETEs (or in `harness_status`'s case, flips status to `stalled`) any row whose `expires_at` is in the past. One `setInterval`, declarative registrations, no per-table sweep code.

Registered tables (manifest at `expirable-registrations.ts`):

| Table                                | Lease                          | On expire                                           | Notes                                                                      |
| ------------------------------------ | ------------------------------ | --------------------------------------------------- | -------------------------------------------------------------------------- |
| `harness_shared.operator_scan_locks` | 60s                            | delete                                              | Was lazy-deleted on next acquire; now also actively reaped                 |
| `harness_shared.operator_claims`     | 90s                            | delete                                              | Previously had no sweeper at all — accumulated until manually overwritten  |
| `harness_shared.harness_status`      | 5min, refreshed each iteration | mark-status `running`→`stalled`, write `updated_at` | unix-ms `expires_at` column populated by `POST /:slug/orchestrator/status` |
| `papercusp_auth.magic_link_requests` | per-row, unix-ms               | delete                                              | 15-min auth tokens                                                         |
| `papercusp_auth.sessions`            | per-row, unix-ms               | delete                                              | 30-day sessions, hourly cadence (no rush)                                  |

Adding a new TTL table: schema gets `expires_at`, writers compute `now() + lease`, one `registerExpirable()` line. No new sweep code, no new interval, no new file.

Future migration: when pg\_cron is installed, each registered sweep becomes one `pg_cron.schedule(...)` call; writers don't change.

### PID-liveness: `apps/operator/lib/harness-status-sweep.ts`

For state owned by a long-running process where TTL would force a heartbeat. Run.sh's `pg_write_lane` records the PID; the sweeper drops rows whose recorded PID no longer exists in `/proc`. Used for:

* `harness_shared.harness_lanes` — per-iteration lane state. Workers can run an hour+ on a single invoke; PID-based liveness means no bash heartbeat plumbing needed.
* per-harness `agent_runs.running` — same reasoning; the sweeper flips `running=false` when the recorded PID is gone.

Lanes also have a 24h age fallback for legacy rows that pre-date PID capture. As long as a row has a PID and that PID is alive, it's not swept regardless of age.

### What goes where

The split rule: **TTL when there's a clear lease and the writer can refresh on its own cadence; PID-liveness when the writer is a long-running process that already exists in `/proc`.** Filesystem-paired tables (the 20+ DELETE statements in `harness-fs-watcher.ts`) are a third category — the file is the source of truth and chokidar handles cleanup; not a sweep at all.

***

## Where to look for X

| If you want to understand…      | Read this                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The orchestrator decision verbs | `libs/papercusp/packages/orchestrator/src/decision-parse.ts`                                                                                                                                                                                                     |
| The 17-branch dispatcher        | `libs/papercusp/packages/orchestrator/src/main-loop.ts:265` (the `switch (parsed.verb)`; first case at 266)                                                                                                                                                      |
| How an agent gets spawned       | `libs/papercusp/packages/orchestrator/src/invoke.ts` and `libs/papercusp/packages/harness/run.sh:invoke()`                                                                                                                                                       |
| Pre-loop bootstrap              | `libs/papercusp/packages/orchestrator/src/pre-loop.ts:runPreLoop`                                                                                                                                                                                                |
| What happens on DONE            | `libs/papercusp/packages/orchestrator/src/main-loop.ts:handleDone` (line 342)                                                                                                                                                                                    |
| Role prompts                    | `libs/papercusp/packages/harness/prompts/<role>.md` (or `staging/<role>.md` for phase-specific overrides)                                                                                                                                                        |
| Cross-mission identities        | `libs/papercusp/packages/harness/identity/<role>.md` (file-canonical for orchestrator subprocess; PG-mirrored to `harness_shared.identity_files` via Migration 041 for operator UI reads)                                                                        |
| All API routes                  | `apps/operator/app/api/_hono/harness.ts` (mostly), `apps/operator/app/api/agent-mcp/*` (operator-scan, delegate-chat, agent-config), `apps/operator/app/api/agent-config/*` (settings)                                                                           |
| Chat-stream backend             | `apps/operator/lib/claude-chat-stream.ts` (operator wrapper) → `libs/papercup-shared/src/agent/chat-stream.ts` (shared runtime)                                                                                                                                  |
| Schema + Zero queries           | `libs/zero-harness/src/{schema,queries}.ts`                                                                                                                                                                                                                      |
| Per-harness PG provisioning     | `bin/scaffold-harness-schema.sh` + SQL template `libs/papercusp/libs/db/sql/002-per-harness-template.sql`                                                                                                                                                        |
| Plugin lifecycle                | `apps/operator/lib/plugin-host-runtime.ts` (operator: `firePluginLifecycle` + `ServerActionRegistry`); `libs/papercusp/packages/orchestrator/src/plugin-hooks.ts` (orchestrator-side); `packages/plugin-loader/bin/fire-hook.ts` (the `papercusp-fire-hook` CLI) |
| Cleanup of ephemeral state      | `apps/operator/lib/expirable-registry.ts` (TTL) + `apps/operator/lib/harness-status-sweep.ts` (PID-liveness); declarative manifest at `apps/operator/lib/expirable-registrations.ts`                                                                             |

***

## Caveats — what's currently in flux

These reflect known in-progress migrations as of 2026-05-06; expect them to drift:

* **`features.json` is mostly retired.** UI reads from PG; the **scoper** (2026-05-01) and **validator** prompts have both been migrated to the API (`/api/harness/<slug>/features/import` and `/features/<id>` PATCH respectively). run.sh's "features.json → psql" import shim still works as a legacy fallback for any agent prompt that hasn't been migrated, but the file is no longer the canonical write path.
* **TS orchestrator port is feature-flagged off** (`PAPERCUSP_USE_TS_ORCHESTRATOR=1`); bash `run.sh` is the default. The TS port covers Stage 5a parallel-lane + competition workers, but is **not** a strict superset of bash — known divergences:

  * TS doesn't recognize `NEXT_EXPERT` / `NEXT_FEEDBACK` / `NEXT_SCOPER` (3 bash-only verbs).
  * TS recognizes `NEXT_PROJECT_MANAGER` / `NEXT_SUMMARIZER` in DECISION\_VERBS but has no switch case (exit 4); bash doesn't recognize either.
  * `crosscheck` fires only in bash.
  * TS fires plugin lifecycle hooks `onLoad` / `onUnload`; bash doesn't.
  * TS `state.ts:featuresExist` reads `features.json` on disk (legacy); bash `features_exist()` queries `harness_features` PG (canonical post-2026-05-01).

  For harnesses that lean on `NEXT_EXPERT` etc., TS will silently drop those decisions — backend choice matters.
* **`AGENT_BACKEND=omp` is opt-in.** Default backend is still `claude-code`. The omp routing migration is fully shipped but unverified at scale; `/settings/agent` lets you flip per-workspace.
* **Doc files in this tree may be stale.** Several mention `features.json` as the canonical source — that's no longer true. Trust this lifecycle doc + the code over older specs.
* **Storage policy supersedes earlier "files everywhere" wording.** As of 2026-05-07, durable mutable state defaults to Postgres; files remain only for bootstrap, code/contracts, locks/sentinels, append-only logs, and substrate-read contracts (where the orchestrator subprocess needs to read directly). See `/internal/docs/system/storage-policy` for the full rule.
* **Voice tool aliasing.** `delegate_to_claude` and `delegate_to_agent` both map to the same handler (Wave 3 of the omp migration); EL agents may reference either name.

For a one-page summary of recent migrations and their commit hashes, see
`/home/marsh-office/.claude/projects/-tmp/memory/project_omp_routing_migration.md`
and `/home/marsh-office/.claude/projects/-tmp/memory/project_filesystem_to_pg_migration.md`.

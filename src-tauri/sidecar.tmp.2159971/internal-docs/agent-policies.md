# Agent policies
URL: /internal/docs/agent-policies

Binding rules for engineer-collaborator agents working on Papercusp. Plan first, verify before claiming done, scope discipline, and when to update docs.

import { Aside } from '@astrojs/starlight/components';

This page is binding for every agent reached via `papercusp-su` —
Claude Code, OMP, Codex, Gemini, anything else. The engineer-
collaborator playbook (`papercusp-su-<profile>.tools.md`) is *how* to work;
this page is *what's allowed*. Where this page conflicts with a
workflow in tools.md, this page wins.

## 0. Where you fit

You are an agent **working with the engineers building Papercusp**.
Admin privileges across every workspace, every harness, every plugin,
every tool surface. That's a senior-engineer mandate, not a license
to flail. The rules below exist because each one cost real time in a
previous session.

Your context window is your scarcest resource. This page + the
playbook are the only context that auto-loads; everything else
(files, doc pages, tool catalogs, search results) is lazy — pull it
in when you need it, let it fall off when you don't. If you've been
corrected twice on the same thing in one session, the context is
cluttered, not the rules. Start fresh.

## 1. The Explore → Plan → Code → Verify loop

The canonical shape of every non-trivial task. Treat the four phases
as distinct, named, and ordered.

1. **Explore.** Read the relevant code, docs, and tests. No edits.
   Form a mental model of what's there before deciding what to
   change. For research-heavy exploration, delegate to a fresh
   subagent / sub-session so the findings come back as a summary and
   your main context stays clean.
2. **Plan.** Write a short description of what you'll change, where,
   and how you'll verify it. Present it to the user. **Wait for
   review.** Exempt: one-line bug fixes, copy tweaks, trivial renames
   — if you could describe the diff in one sentence, skip the plan.
3. **Code.** Make the change. Follow §6 (scope discipline) — do what
   the plan said, no more.
4. **Verify.** See §3. Until the verification you committed to in the
   plan actually succeeds, the task is not done.

For larger features, **start a fresh session for the Code phase** with
the plan as the only inherited context. A clean slate executes a
written spec better than an old session can.

## 2. Solution shape — think up, then look outward

Before you write any code, in the Plan phase, run two checks:

### Abstract up

Ask: *is the problem in front of me a specific instance of a more
general problem this codebase will face again?* If yes, the right
solution is often one level up — a helper, a utility, a refactor of
the shared layer — instead of a one-off patch at the call site.

* **Propose the abstraction in your plan** with a one-line tradeoff:
  "Could solve this just in `foo.ts` (5 lines), but the same shape
  comes up in `bar.ts` and `baz.ts`; abstracting to
  `utils/normalizeX.ts` adds 25 lines once and removes 30 across the
  three callers."
* **Don't silently refactor.** §6 (scope discipline) still applies —
  abstraction proposals get user approval before they ship.
* **Three instances is the threshold.** Two looks accidental; three
  is a pattern. Don't generalize off one.
* **A worse abstraction is worse than no abstraction.** If you can't
  name the general problem in one sentence, the abstraction isn't
  ready.

### Look outward

If the problem you're solving is one most projects have hit — date
parsing, retry / backoff, schema validation, debounce, fuzzy match,
diffing, ID generation, password hashing, rate limiting, SSE
multiplexing, etc. — there is almost certainly a battle-tested
library for it. Before rolling your own:

1. **Check what the project already uses** for adjacent problems
   (see §7 Reuse before adding). Often the answer is already in
   `package.json`.
2. **If nothing in the project fits**, propose a library to the
   user. Don't install silently. Present:
   * What it does and how heavily it's used (weekly downloads,
     maintained-this-year, top-tier user).
   * Size on disk + transitive dep count (use `npm view <pkg>
     dist.unpackedSize` and `npm ls --all <pkg>`).
   * License (anything non-permissive needs explicit OK).
   * The 20-line alternative — what rolling our own would look like
     and what we'd give up.
3. **Let the user pick.** Their answer might be "use it" or "the
   20-line version is fine" or "we already have X that's 80% there."

The failure modes this catches:

* Hand-rolled date math that's wrong on DST boundaries when
  `date-fns` is two lines away.
* Custom retry loops without jitter when `p-retry` exists.
* Bespoke "small JSON schema" validation when `zod` is already in
  the tree.

## 3. Verify before claiming done

A passing typecheck is not a working feature. Before you say "done":

* **For tool / API changes**: run the specific test that covers the
  change. If no test exists, write one or call the endpoint with
  curl and read the response.
* **For UI changes**: open the page in the running Tauri dev shell
  (`cd papercusp-desktop && npm run dev`), exercise the changed
  path, and watch for console errors. Mention what you actually
  clicked.
* **For schema / migration changes**: apply the migration locally
  and verify the queries that touch it.
* **For docs changes**: hit the docs route and confirm it renders.
* **Always**: run the project's lint + typecheck before yielding.
  For Papercup that's `npm run typecheck && npm run lint` from the
  repo root or the relevant `apps/<name>/`. If those fail, the
  change isn't done.

If you can't verify a change for some reason (no dev server, no test
infrastructure for that surface), **say so explicitly**. "Typecheck
passes, couldn't run UI" is honest; "Done" without verification is
not.

## 4. Address root cause, not symptoms

When a test fails, a build breaks, an assertion fires, an error
surfaces — fix the *cause*, not the visible symptom. Specifically:

* **Don't modify a test to make it pass** unless the test itself is
  wrong. Tests are the spec; the code is the thing under test.
* **Don't `catch` and swallow an exception** that's telling you
  something broke.
* **Don't add a flag, env var, or feature toggle to skip the check.**
  Find what's actually wrong.
* **Don't `git checkout -- file` away the diff** as a "clean slate"
  shortcut when you should be investigating why it changed.

If after a real investigation you decide the symptom-level fix is
correct (e.g. the upstream is wrong, the test was over-specified),
say so explicitly in the PR — "I'm treating X as the root because Y."
That's a different thing from quietly papering over.

## 5. Pre-alpha freedom

Papercusp is pre-alpha — **no users, no production.** That gives you
the luxury to break things continuously until the system is right.
Pick the right fix *now*; don't ship awkward compromises to preserve
compatibility with a future that hasn't been built yet.

In practice:

* **Redesign APIs that are wrong** instead of layering on top of
  them.
* **Rename identifiers when the old name is confusing** — don't keep
  deprecation aliases "for one release cycle."
* **Do schema migrations now** if they're correct, not when usage
  forces your hand.
* **Refactor architecture** when foundational decisions are wrong,
  not when they're load-bearing.
* **Pick the *best* tool / library**, not the safe one. License +
  tree compatibility are footnotes, not vetoes.

Surface what you're changing so the user knows; don't ask permission
to do it well.

## 6. Scope discipline

A bug fix is a bug fix. A refactor is a refactor. **Don't bundle.**

* **Don't add features, refactor, or introduce abstractions beyond
  what the task requires.** A bug fix doesn't need surrounding
  cleanup; a one-shot operation doesn't need a helper.
* **Don't design for hypothetical future requirements.** Three
  similar lines is better than a premature abstraction.
* **No half-finished implementations.** If you can't finish the
  work, revert the partial change before committing.
* **No "while I'm here" wins.** Tempting changes in adjacent code
  get their own PR.

## 7. Reuse before adding

Before reaching for a new library, framework, pattern, or
abstraction, **check the codebase isn't already using one**.

* `grep` `package.json` / `Cargo.toml` / `pyproject.toml`.
* Look at imports in a neighbor file.
* Check `docs/design` and `docs/data-sync` for the project's chosen
  libraries — those pages exist precisely so this question has an
  answer.

If the project has a pattern for the thing you need, use it; if not,
**ask before introducing a new one.** This catches the "agent pulls
in `lodash` when the repo already uses `radash`" failure mode and
its cousins.

Same rule applies one level up: if a new tool or pattern emerges
from your work and you're unsure where it belongs, surface it as a
question before forking. Drift in the established patterns compounds
fast.

## 8. Coordinate edits across SU agents

Multiple OMP / Claude Code / Codex / Gemini shells may be running at
once, each driving its own SU agent. Before any edit:

1. Always call `locks:acquire { paths, intent, wait: { max_sec: 300 } }`
   for the files you're about to touch.
2. On busy: wait, retry, pivot, or surface to the user — never stomp.
3. Release on completion. Heartbeat at the halfway mark for edits
   expected to take >15 min.

Prevention over reconciliation: cheaper to wait 30 seconds for a file
to free than to discover at merge time that two agents wrote different
fixes for the same bug.

The cooperative tool surface is universal across host CLIs. **Claude
Code** users additionally get enforcement via a `PreToolUse` hook
that refuses contested `Edit`/`Write`/`MultiEdit` automatically.
OMP / Codex / Gemini agents currently rely on the playbook discipline
above — they will stomp if their host CLI lacks a hook. Treat their
participation as best-effort coordination; the system is fully
enforced only when every concurrent CLI has a hook.

When a contention surfaces to the user, **show both intents** (yours
and the holder's) so the user can decide. "Agent X has `lib/foo.ts`
for 'fix typo in comment'; I want to do 'refactor entire auth module';
should I wait or pivot?" — both intents in one sentence.

See the [`locks:*` tool reference](#) and the engineer-collaborator
playbook (`papercusp-su-<profile>.tools.md`) for the full workflow.

## 9. Confirm before destructive actions

Admin tier bypasses role checks, so destructive verbs are reachable
from your shell. **Confirm out loud before any write-side tool call**
(`flags:set`, `panel_dispatch_card` at tier-high, scanner
resets, mutating a harness, dropping a table, force-pushing).

A "yes" from an earlier turn does **not** carry across topics —
engineering conversations move fast, intent shifts fast. If five
turns have passed since the user authorized something, ask again.

The only writes that are pre-authorized: anything you've already
committed by name to in the same plan that produced this turn's
work.

## 10. Don't paper over missing context

If the user names a harness, feature, slug, or workspace you don't
have, **ask**. Don't pick an arbitrary default and proceed. A wrong
workspace can mean mutations land in the wrong PG schema, and the
user won't see the silent miss until much later.

Same for ambiguous instructions. "Fix the issue with the panel" with
no slug is the user telling you they haven't said enough — ask which
panel, ask which harness.

## 11. Comments

**Default to writing no comments.** Only add one when the WHY is
non-obvious: a hidden constraint, a subtle invariant, a workaround
for a specific bug, behavior that would surprise a reader.

* Don't explain WHAT the code does — well-named identifiers already
  do that.
* Don't reference the current task or fix — those belong in the PR
  description and rot as the codebase evolves.
* Don't write multi-paragraph docstrings or multi-line comment
  blocks. One short line max.

Same rule for git messages: subject line says what changed; body
explains why if it's not obvious from the diff.

## 12. Where new code goes

The repo has settled on a few patterns. Follow them; don't fork.

| You're building…                                  | Use                                                                    | Don't roll                                                                | Canonical reference                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| A new panel reading server state                  | `useSyncQuery({queryName, args})`                                      | `fetch + setInterval`, raw `EventSource` for query data                   | [Data Sync](/internal/docs/data-sync)                           |
| New durable state                                 | Postgres, via `operator-state-pg.ts` or `getOrgPg()`                   | JSON files, module-scoped `Map`s                                          | [Storage policy](/internal/docs/system/storage-policy)          |
| UI state (tabs, panels open, selections, filters) | `nuqs` (`useQueryState`)                                               | `useState` for anything user-meaningful                                   | tools.md                                                        |
| A modal / drawer / select / checkbox / tooltip    | The wrapper from `app/harness/`                                        | Hand-rolled `<div role="dialog">`, native `<select>`, `title=` on actions | [Design — library guide](/internal/docs/design)                 |
| A tabular list                                    | `RichGrid` / `GridTable` / `DataGridShell` from `@papercusp/grid-core` | Hand-rolled `<table>`                                                     | [Design — library guide](/internal/docs/design)                 |
| A form                                            | RHF + zod for single-submit; `useDebouncedSave` for auto-save          | Mixing the two; rolling your own state machine                            | [Design — library guide](/internal/docs/design) §7              |
| A new tool callable by agents                     | `defineTool` (built-in) or plugin manifest, pick via decision rule     | Bypassing the projection registry                                         | [Writing a tool](/internal/docs/endpoint-system/writing-a-tool) |
| Cross-app messaging                               | HTTP / SSE / in-process call, then persist to PG                       | Polling PG as a transport                                                 | tools.md "DB is not a transport"                                |

## 13. Performance bar

Hard targets — CI/review rejects violations:

* Harness-page TTI \< 1.5 s on warm cache.
* ≤ 1 re-render per keystroke in a 50-row form.
* Bundle delta \< 10 KB gzip per route per feature.
* 60 fps minimum during list updates.

Full rules + the audit anti-pattern catalog at
[Performance — rules every agent must follow](/internal/docs/performance).
Read it before any non-trivial UI/data change. The "What not to do"
section near the bottom is load-bearing.

## 14. Testing

Before you write a test, run a test, or touch test infrastructure,
**read [Testing strategy](/internal/docs/testing)**. The three-layer model,
which runner for which layer, the per-project `TESTING.md` discovery
protocol, the affected-graph rule, and the visual-regression
workflow are all there. Skipping that page means re-inventing
testing conventions the rest of the codebase has already settled.

Three layers per project — unit, integration, E2E. Conventions and
which runner per layer live at [Testing strategy](/internal/docs/testing).
Specifically:

* **Don't mock the database in integration tests.** Mocked tests
  have passed while real migrations were broken; we've been bitten.
* **Don't ship a feature without running its tests locally.** Even
  trivial-looking changes that "couldn't possibly break X" break X.
* **No shared mutable state between tests.** Each test gets its own
  testcontainer / its own PG schema.
* **Agents discover relevant tests by reading per-project
  `TESTING.md`.** Don't run the whole suite if affected-graph
  testing covers your change — see the testing page for the
  discovery protocol.

## 15. Operational hygiene

* **Batch independent tool calls.** When two reads, two searches, or
  two greps don't depend on each other, fire them in one response.
  Sequential calls only when the next one needs the previous result.
* **Pass non-interactive flags** (`--yes`, `-y`, `--non-interactive`,
  `--no-input`) on every shell command. Assume there is no TTY user
  to answer prompts. `npm install` becomes `npm install --yes`; `gh`
  commands take `--yes`; etc.
* **After any plugin manifest edit or tool handler change**, hot-
  reload the projection registry:
  ```bash
  curl -X POST http://localhost:3070/api/plugins/host/refresh
  ```
  (See [Endpoint system → Operations](/internal/docs/endpoint-system/operations).)
* **After editing a role's `persona.md` / `tools.md` /
  `defineTool({ guidance })`**, prompt-assembly auto-reloads in dev
  (`PAPERCUSP_RELOAD_PROMPTS=1` is the dev default). No restart
  needed.
* **After editing this page, a `papercusp-su-<profile>.tools.md` base
  playbook, or a `papercusp-su.<client>.md` overlay**, re-run
  `install-standalone-mcp.sh` to re-render the per-client playbooks and
  refresh the `psu` launcher (the old `omp-su` / `claude-su` / `codex-su`
  wrappers are retired — `psu` assembles playbook + MCP + flags per launch). (See
  [Superuser mode → Per-client wrappers](/internal/docs/endpoint-system/superuser-mode#per-client-wrappers-and-playbooks).)

## 16. Commits, branches, PRs

* **Work on `main` directly** in the `papercup/` checkout. No
  worktrees, no feature branches for engineer-collaborator work.
  PRs off branch names like `<author>-<topic>-<date>` when you do
  want a branch.
* **One PR per logical change.** Doc edits that explain a change
  ship *in the same PR* as the change. Standalone doc fixes ship on
  their own.
* **Commit messages**: subject line says what; body says why if it's
  non-obvious. No "WIP" commits on `main`.
* **No `--no-verify`** to bypass commit hooks. Fix the underlying
  failure.
* **Don't force-push** branches that other people have based work
  on. Coordinate first.
* **Prefer CLI tools to raw HTTP** when talking to external
  services. `gh` for GitHub, `psql` for direct PG when no documented
  verb fits, `aws` / `gcloud` for cloud, etc. CLI tools are the most
  context-efficient path and avoid unauthenticated rate-limit hits.

## 17. When to update documentation

The trigger is **plan completion**, not every commit.

Update docs when:

* A **feature plan reaches "done"** (PR merges, the user agrees the
  work is complete) AND the change touches user-facing or
  contract-level behavior. "Contract-level" means: a public API, a
  CLI flag, a tool signature, a config knob, a wire format, a
  documented invariant.
* A **schema migration** changes a table that's documented.
* A **convention shifts** (a new pattern becomes the default, an old
  pattern is retired).
* A **bug fix reveals a documented invariant was wrong** (the bug
  existed because the doc lied — fix both).

**Skip the doc update** when:

* The change is a bug fix that restores documented behavior.
* The change is an internal refactor with no API/contract effect.
* The change is to test infrastructure, dev tooling, or CI.
* The change is a WIP commit on the way to plan completion (one doc
  update at the end, not per-commit).

**How to update**:

1. Identify the affected docs section before you start the work.
   (`docs:outline` if you don't know which.)
2. Draft the doc change as part of the same PR as the code change.
   Doc edits are 30 seconds in the right PR and a separate task in
   a wrong one.
3. Set the page's `sidebar.order` frontmatter (and, for a new
   section, its `astro.config.mjs` sidebar entry) if you're adding a
   new page — sidebar order matters.
4. If the dev server is running, hit `/docs/<section>/<slug>` and
   confirm the render before merging.

The **documenter role** inside the harness handles the
docs/features/F-NNN page automatically after validator passes. For
engineer-collaborator work outside the harness, you are the
documenter — the rules above are yours.

## 18. Plans and project history

**Plans are PG-canonical (`harness_shared.harness_plans`), browsed +
written via `plans:*` tools** (markdown rendered on demand; the
`docs/plans/*.md` files were removed — plans-pg-canonical-migration-2026-06-03).
This is the canonical home for any non-trivial design document,
implementation plan, RFC, or proposal that has been reviewed or is
awaiting review. Format spec at
`/internal/docs/spec/plan-format`; plan tracking spec is the
`agent-plan-tracking-2026-05-20` plan itself
(`plans:get { slug: 'agent-plan-tracking-2026-05-20' }`).

Drop a plan here when any of these apply:

* The plan is being reviewed by a human before implementation.
* The plan spans multiple sessions, agents, or weeks.
* The plan represents a decision that other agents will need to look
  back on ("why did we choose X over Y?").
* The work touches multiple subsystems or shifts a convention.

File naming: `<short-kebab-case-topic>-<YYYY-MM-DD>.md`. Examples
already in the tree: `llm-testing-framework-2026-05-14.md`,
`bespoke-card-improvements-2026-05-13.md`,
`desktop-native-transport-2026-05-12.md`. Date is when authored;
superseding plans get a new file rather than overwriting.

### The `plans:*` tool surface

Don't `find` the directory by hand. Use the tools:

* `plans:list` — directory with title, status, `effectiveStatus` item
  counts, and `## Now` next-action line.
* `plans:get { slug }` — full parsed structure.
* `plans:items { actionable: true }` — pickable items across plans
  (effectiveStatus === 'todo', blockers resolved).
* `plans:items { needsHuman: true }` — the human's inbox.
* `plans:search { query }` — keyword search across scoped sections.
* `plans:lint` — validate before claiming a plan-doc edit is done;
  legacy files (no/malformed frontmatter) are exempt.

Writes are tool-mediated: `plans:new` / `set-status` / `set-now` /
`add-decision` / `add-item` / `set-content` / `set-content-chunk`.
Each acquires a `locks:*` lock around the real plan write; ID allocation
(D-NNN, P-NNN) is serialized so parallel callers produce non-colliding
sequential ids.

For large whole-plan writes, **use `plans:set-content-chunk`** instead
of a giant `plans:set-content` payload. Send `begin` with the
`plans:get` `contentHash`, `append` chunks under 24k characters, then
`commit`. Anthropic/tool-call errors on large plan writes often happen
before the Papercusp tool receives the request, so chunking must happen
at the caller/tool-call level.

### Item importance (always set it)

Every plan item carries an **importance** — a 4th axis orthogonal to
status: `urgent | high | normal | low` (default `normal`, written as an
`importance:` keyword, parsed like `blocked-by:`). `plans:add-item`
**requires** it; change it later with `plans:set-importance`. It drives
the Planning-tab sort/badges, the push threshold (≥ `high`), and the
orchestrator's halt-on-`urgent`. Full spec:
[plan-format §Importance](/internal/docs/spec/plan-format#importance).

Set it from **consequences, not feeling** — *"what breaks, and how
fast, if a human never sees this / if it's picked up last?"*:

* **urgent** — progress is fully blocked, or acting without a human
  risks harm (repeated failures after the debugger ran, an
  irreversible / production-affecting approval, a security or data-loss
  risk, a release gate). Interrupt the human now.
* **high** — a real decision is needed and this thread is paused until
  it's answered; should be seen today.
* **normal** *(default)* — needed, nothing is stuck, normal cadence.
* **low** — informational, or there's a safe default to proceed with.

When torn between two adjacent levels pick the higher — **except**
never inflate a routine approval to `urgent`. Crying wolf trains the
human to ignore the badge, which is worse than a missed `normal`.

### This directory is the project history

When the user asks "remember when we were working on X?" or "what
did we decide about Y?", **`plans:search { query }` is the first
move**. Most non-trivial decisions in the codebase have a plan doc
that records:

* What was proposed.
* What feedback shifted it.
* What got built vs. what got deferred.
* Open questions at the time.

Plans get superseded but rarely deleted. A retired plan is annotated
in its frontmatter as `status: superseded` with optional
`superseded-by: <slug>` — never silently dropped. Move to
`apps/operator/docs/plans/archive/` once nothing actively references
it; `plans:list { includeArchived: true }` still surfaces them.

When reading an older plan (>2 months), check the date — partial
staleness is common. Cross-reference against current code before
treating any plan as authoritative.

### Legacy plans

Plans that pre-date the format spec (no frontmatter or malformed
frontmatter) are listed by `plans:list` with `status: 'unknown'` and
no item counts. They're readable via `plans:get` (returns prose).
Convert one to the new format only when you're actively working on
the plan; lint exempts legacy files so day-one CI is green.

## 19. Agent insights

**An "agent insight" is a hard-won, non-obvious fact about this
codebase that any future agent would benefit from knowing.** Insights
live at `apps/operator-docs/src/content/docs/agent-insights/<slug>.mdx` and are
part of the rendered engineering reference site at `/internal/docs/agent-insights`.

### When to write one

* You hit a non-obvious failure mode and figured out the root cause.
  Future agents shouldn't have to rediscover it.
* You learned that an apparent pattern is actually wrong (e.g.,
  "agent reaches for `lodash` when the repo already uses `radash`").
* You found a subtle invariant in the code that isn't documented
  anywhere.
* You discovered that an external system (PG, Zero, a specific
  library) has a quirk this codebase has to work around.

### When NOT to write one

* The fix lives in code and is self-explanatory there. Insights are
  for things that *can't* be in code (cross-cutting facts, "looks
  fine but isn't" warnings, library quirks).
* The thing is documented elsewhere in `/docs/`. Update the existing
  doc; don't fork.
* The information is one-session-specific (current task state, what's
  in flight). That belongs in conversation, not in the knowledge
  base.

### Format

Frontmatter:

```yaml
---
title: <Short title — what's the fact?>
description: <one-line summary>
discovered: 2026-05-14
tags: [pg, migrations, sql]
status: active   # active | superseded | retired
---
```

Body: three short sections.

1. **What.** The fact, in one paragraph.
2. **Why it matters.** The failure mode it prevents, with a citation
   to the incident or commit that revealed it.
3. **How to apply.** What an agent should *do differently* given this
   knowledge.

Keep it short. Insights are scannable. If yours is over 50 lines, it's
probably actually a docs page in disguise — write a real doc instead.

### Reading insights

* **At session start**, run `docs:outline` and skim the
  `agent-insights/` section. They're typically fewer than 30 across
  the project; the collection absorbs in seconds.
* **When investigating a confusing failure**, search insights first
  (`docs:search` with the symptom). Many "weird bugs" already have an
  insight written.
* **Insights compound.** As the project matures, each new agent
  benefits from every prior agent's hard-won lessons. Contributing
  back is part of the job.

### Maintaining

* An insight that becomes obsolete (codebase changed, library
  upgraded) gets its frontmatter `status` changed to `superseded` or
  `retired`. Keep the file for history; the index hides retired ones.
* An insight that's wrong gets fixed in place, with a note at the
  bottom: `**Corrected YYYY-MM-DD:** <what changed>`.
* An insight that overlaps with another should be merged. Surface
  this; don't silently duplicate.

Don't wait for the user to ask. If a thing would have saved you an
hour, write it; the next agent will thank you.

## 20. Where to find context

Before any non-trivial investigation, in cheap-to-expensive order:

1. **Agent insights** — `docs:outline` and `docs:get` for the
   `agent-insights/` section (§19). Cheap; often answers "is this a
   known gotcha?"
2. **Plans** — `plans:*` tools over PG (`harness_shared.harness_plans`) (§18).
   Authoritative for "what were we trying to do?" and "what did we
   decide?"
3. **Search the wikis** — `search:fulltext` for keyword;
   `search:semantic` for paraphrased. Scope to `escalations`,
   `turns`, `decisions`, `brainstorm`.
4. **Audit log** — `audit:list` for recent events in the relevant
   harness.
5. **Git history** — `git log -p` on the relevant path.
   Authoritative for "what changed when and why" — docs lag, code is
   the truth.
6. **The docs** — `docs:outline` then `docs:get`. Authoritative for
   intent; lags the code by design.

Don't speculate from training-data memory of Papercusp internals —
nothing about this codebase was in your pretraining.

## 21. When in doubt, ask

The cost of one short clarifying question is small. The cost of
correct-looking work in the wrong direction is large. Ask:

* When the user names a thing you don't have a slug / id for.
* When two reasonable interpretations of the request lead to
  different changes.
* Before any destructive action whose authorization is more than \~5
  turns stale.
* Before introducing a new dependency, a new pattern, or a new
  cross-cutting abstraction.

One sentence. Then wait. Then proceed.

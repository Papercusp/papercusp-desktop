# Repo conventions — the long form
URL: /internal/docs/system/repo-conventions

The full detail behind CLAUDE.md's pointers — deployment model, retired surfaces, borrowable libs, branch/commit discipline, two-port model, database topology, test infrastructure.

# Repo conventions — the long form

> `CLAUDE.md` at the repo root carries the **invariants + pointers** every agent
> loads on every session. This page carries the **long-form detail** behind those
> pointers (moved here 2026-06-10, plan `token-usage-reduction-audit-2026-06-09`
> P-004). If a rule here contradicts CLAUDE.md, CLAUDE.md wins — update both.

## Deployment model — desktop is the product

**Source of truth: `apps/operator/providers/HarnessZeroProvider.tsx` lines 6–19**
(the "Transport selection by deployment context" doc-comment).

The shipping target is the **Tauri desktop app**, and it is also the only
supported test surface. The old `next dev` / `bin/prod` standalone webapp path
(running `apps/operator` directly and opening `localhost:3055` in a browser) is
**retired as of 2026-05-14** — the `apps/operator/bin/{dev,prod}` standalone
entrypoints are gone (the root `bin/dev`/`bin/prod`, which boot the Vite SPA +
Hono host and invoke no Next, remain), and a `PreToolUse` hook blocks browser nav
to its ports.

`cd papercusp-desktop && npm run dev` boots embedded Postgres (writes
`~/.papercusp/embedded-pg.json`), starts the operator sidecar against it, applies
pending SQL migrations, and opens the Tauri webview. There is no "just the
webapp" mode.

Internal ports (do not open in a browser; the desktop drives them):

* `:3055` — the operator's **Vite** dev server (TanStack-Router SPA,
  `@papercusp/operator-vite`) consumed by the Tauri webview. **Next.js is
  retired** for the operator (`next dev`/`next start` blocked). ⚠ But
  `apps/operator/app/**` is **NOT** dead code — operator-vite still imports its
  live page implementations from there via the `@/app` alias + `next/*` compat
  shims (verified 2026-06-01; see plan `finish-next-removal-2026-06-01`).
* `:3070` — operator harness sidecar API + these docs at `/internal/docs`.

### Transport / persistence by deployment context

| Concern            | Desktop (production)                                                                    | Browser (test/dev)                                                  |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Sync transport     | **SSE primary** (`/api/zero-harness/sse` pushes invalidate/update via PG LISTEN/NOTIFY) | Zero WS primary, SSE fallback, polling as floor                     |
| Persistence        | embedded-pg (real PG 17 via libs/papercusp/packages/embedded-postgres-server)           | Same — embedded-pg, NOT pglite                                      |
| zero-cache process | **Not run** — operator sidecar serves SSE itself                                        | Production zero-cache service from docker-compose.papercup.prod.yml |
| Runtime detection  | `window.__TAURI_INTERNALS__` + server-side `/api/desktop/version` fingerprint           | Neither present                                                     |
| Override for tests | `localStorage.harnessSyncTransport = 'SSE'` to force desktop path in browser            | `'WEBSOCKETS'` to force browser path                                |

**Stale docs to mistrust** (cross-checked 2026-05-11):

* `libs/generic/sync/PASS_2_1_DECISION.md` (2026-05-06) declared "stop SSE" —
  **SUPERSEDED 2026-05-07** by the HarnessZeroProvider decision to make SSE
  primary on desktop. The doc has a header banner now but is otherwise frozen.
* `libs/generic/sync/src/transports/sse/SSEAdapter.tsx`'s old header claimed "no
  current consumer, preserved-but-frozen" — corrected to reflect production use.
* Any code comment or memory note that says "Zero WS is primary everywhere" or
  "SSE is dead" predates 2026-05-07 and is wrong for desktop.
* Older text saying native PG was renamed `papercusp_legacy` to make standalone
  boots fail loudly is **stale** — native `papercusp` on `:5432` is alive and is
  the dev box's substrate (see Database topology below).

**When designing new sync-touching features:** desktop SSE is the path that
matters. Browser WS is a fallback that lets developers test in a normal browser.
If a feature only works under WS, it's incomplete for production.

## Retired / preserved-not-active surfaces

Some code is **retired but deliberately kept** in the tree for reference — not
deleted, not deployed, not tested, and not to be extended. Agents repeatedly
mis-read these as active because they still look like workspaces, carry deploy
config, or have recent commits. **Treat everything in this list as dead:** do not
write tests for it, wire new code to it, or "revive" it without an explicit ask.

| Surface                                                                                                                                                                                                                                                                        | Location                                                                                                                                           | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Restore                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@papercup/web` — papercupai.com public site                                                                                                                                                                                                                                   | `_retired/papercup/`                                                                                                                               | Retired 2026-05-30. Dropped from the workspace glob + root scripts; `docker-compose.papercup.prod.yml` + `Dockerfile.papercup` bannered (preserved, not deployed).                                                                                                                                                                                                                                                                                                                                              | `_retired/papercup/RESTORE.md` + git tag `papercup-web-retired-2026-05-30`                                                       |
| Standalone operator webapp (`apps/operator` opened on `:3055` in a browser)                                                                                                                                                                                                    | `apps/operator` — run **only** via the Tauri shell                                                                                                 | Retired 2026-05-14; a `PreToolUse` hook blocks browsing its ports.                                                                                                                                                                                                                                                                                                                                                                                                                                              | n/a — the operator still ships, just not as a standalone webapp                                                                  |
| `libs/zero-harness` — Zero ZQL schema/queries                                                                                                                                                                                                                                  | `libs/zero-harness`                                                                                                                                | On the Zero-retirement path; the ZQL package has **0 live importers** (only dead surfaces reference it: `libs/papercup-shared/**/*View.tsx` + the retired `@papercusp/web`). **Migrate off, don't add tests.**                                                                                                                                                                                                                                                                                                  | n/a                                                                                                                              |
| `libs/papercup-db` — fictional-org demo schema                                                                                                                                                                                                                                 | `libs/papercup-db`                                                                                                                                 | Demo data; only consumed by `_retired/papercup` + a vendored submodule. Deletion candidate.                                                                                                                                                                                                                                                                                                                                                                                                                     | n/a                                                                                                                              |
| `libs/holepunch-spike` — P2P spike                                                                                                                                                                                                                                             | `libs/holepunch-spike`                                                                                                                             | Phase-0 spike. **NOT zero-importers** — its `holepunch.d.ts` shim surface is implemented by `apps/operator/lib/sync/hyperbee/swarm.ts` and wired into \~10 orchestrator files (feature-claim, distributed-claim, instrumentation-node, …), so it is not a safe delete as-is.                                                                                                                                                                                                                                    | n/a                                                                                                                              |
| `libs/papercup-shared/**/*View.tsx`                                                                                                                                                                                                                                            | `libs/papercup-shared`                                                                                                                             | The read-only `*View.tsx` components render the retired web surface; the non-view helpers (e.g. `_admin-paths`) are still shared and live.                                                                                                                                                                                                                                                                                                                                                                      | n/a                                                                                                                              |
| Legacy `@papercusp/orchestrator` run-loop (`runMainLoop` + the `pre-loop`/`synthesizer`/`actions-block`/`checkpoints(-pg)`/`snapshot-state`/`snapshots-pg`/`mission-state-pg`/`dispatches-pg`/`distributed-claim-fetch` cluster + `bin/run.ts`, plus `git.ts`/`branch-iso.ts`) | `libs/papercusp/_retired/orchestrator-run-loop/` (+ superproject `_retired/orchestrator-run-loop/apps-operator-test/` for the 4 integration tests) | Retired 2026-06-06 (`archive-legacy-orchestrator-deadcode`). 0 live importers; superseded by the DBOS pipeline. Barrel + 4 package.json subpath exports pruned; the `cost-cap.ts`→`mission-state-pg` cross-edge severed (cost-cap is now FS-only). `lint:no-retired` guards against re-imports + a reappearing `/api/plugins/orchestrator/spawn` fetch.                                                                                                                                                         | `libs/papercusp/_retired/orchestrator-run-loop/RESTORE.md` + submodule git tag `legacy-orchestrator-run-loop-retired-2026-06-06` |
| `@papercupai/orchestrator-spawn` plugin (never installed)                                                                                                                                                                                                                      | `libs/papercusp/_retired/orchestrator-spawn-plugin/`                                                                                               | Retired 2026-06-06. Superseded by `fleet/operator-spawn.ts`; its `/api/plugins/orchestrator/spawn` path 404'd.                                                                                                                                                                                                                                                                                                                                                                                                  | `libs/papercusp/_retired/orchestrator-spawn-plugin/RESTORE.md`                                                                   |
| The harness-snapshot system (`@papercusp/export-state` FS-tarball lib + `snapshots:*` tools + `/api/snapshots/*` routes + the Cupboard `kind=snapshot` path + worker R2 blob store + the `SNAPSHOTS` flag + `snapshot_index` PG table)                                         | `_retired/snapshot-system/`                                                                                                                        | Retired 2026-06-09 (`retire-snapshots-instance-spec`). A monolithic-era abstraction; its jobs re-homed — distribution→blueprints, backup→git+PG, reproducible clone→the lightweight `InstanceSpec` (`packages/operator-core/lib/instance-spec/`, capture/boot/vary). `@papercusp/export-state` dropped from the workspace glob + lockfile; migration 199 drops `snapshot_index`. NOT the legacy `harness_snapshots(_consolidated)` iteration-snapshot tables (still live). `lint:no-retired` guards re-imports. | `_retired/snapshot-system/RESTORE.md` + git tag `snapshot-system-retired-2026-06-09`                                             |

**Convention for retiring-but-keeping a surface:** (1) move it under `_retired/`
— this drops it from the `apps/*` / `packages/*` workspace globs so npm, the
affected-test runner, knip, and nx stop treating it as live (the structural
signal that fools agents, not a prose note); (2) remove its root `package.json`
scripts and banner any deploy config — **preserve, don't delete**; (3) add a
`RESTORE.md` in the moved directory with the exact re-wiring steps + the
last-active commit, and cut a `git tag <name>-retired-<date>` restore point;
(4) add a row to the table above. Restoration is then `git mv _retired/<x> <orig>` + re-apply the RESTORE.md steps.

## Borrowable libraries — generic, domain-free, reusable anywhere

A growing set of our libraries carry **zero Papercusp/Restart domain coupling** —
any project can borrow them. Where a host-specific value is needed it's injected
through a small seam (a `configure*()` call or a prop); Papercusp maps its own
domain onto that seam in the operator, so the lib itself names no consuming app.

**The catalog is `BORROWABLE.md` at the repo root** (generated — `npm run
gen:borrowable`; source of truth `scripts/gen-borrowable-catalog.mjs`). It lists
each borrowable lib with its description + repo, grouped by domain, plus a
"reusable with host wiring" section for libs that keep a Papercusp tie-in by
design (`locks`, `coordination`, `backup`, `docs-engine`, `host-platform`).
As of 2026-05-31, **every borrowable lib is its own standalone (private)
submodule under `libs/generic/*` → `github.com/Papercusp/<name>`** — the
borrowable submodules were physically regrouped there, and the borrowable
in-repo `packages/*` libs (rrf, search, memory, ipc-framing, ipc-endpoint-server,
desktop-ipc, rate-limit, plan-parser, embedded-pg-discovery) were promoted to
their own private repos. Only the kept-tie-in libs stay in `packages/` / `libs/`.
Consumers import by package name (`@papercusp/<name>`), so the location is
transparent. When you make a lib generic — or notice domain coupling leaking into
one — add/adjust it in the generator and re-run. See
`papercusp-systems-abstraction-2026-05-29`.

**Generic-first — write it in `libs/generic` from the start, don't migrate it
later.** A genuinely domain-free algorithm (a textbook concurrency /
distributed-systems / data-structure core: a supervision tree, fencing tokens, a
topological sort, a token-bucket rate limiter, φ-accrual, a saga…) **must START
as `libs/generic/<name>` behind a `configure*()`/port seam** — not written inside
`packages/operator-core/lib` to be extracted in a later pass. The 2026-06-05
audit (`generalize-libs-to-generic-2026-06-05`) found a large batch of exactly
that debt and had to migrate \~12 cores out of the app; the discipline below stops
it re-accruing:

* **`npm run lint:generic-first`** (advisory; `:all` for a full-tree sweep) flags
  a *substantial, zero-coupling* file that *names a generic CS concept* and
  landed in `operator-core/lib` / `apps/operator/lib`, and nudges it toward
  `libs/generic`. It's informational by default (like `lint:knip` — it advises,
  never gates), since the signal is a heuristic. Both signals are required on
  purpose: structural decoupling alone flags \~200 files, so the concept name is
  the precision filter.
* A genuinely app-local file whose concept keyword is incidental (e.g.
  "backpressure" describing browser audio buffering) goes in the `ALLOW` set in
  `scripts/check-generic-first.mjs` — don't silence the whole lint.
* The seam pattern itself:
  [generalizing-a-lib-host-seam-pattern](/internal/docs/agent-insights/generalizing-a-lib-host-seam-pattern).

## Branch + commit discipline — the long form

The branch model since the staging→main cutover
(`staging-branch-pipeline-2026-06-06`):

* **`staging`** — the integration branch / agent firehose. The repo at
  `/home/marsh-office/papercupai-workspace/papercup` is the canonical shared
  checkout and **must always have `staging` checked out**. Other agents
  (paperclip, the operator UI, dev servers, the harness fleet) all assume this.
  Branch-switching there breaks them all.
* **`main`** — the GREEN branch. It only ever **fast-forwards** to a `staging`
  commit that passed the green-checkpoint suite (run in an isolated checkout).
  **Nothing and no one pushes `main` directly** — not you, not git-sync; only the
  green-checkpoint automation advances it. A fresh clone of `origin/main` is
  always a tested state, and the live `:3070` operator auto-serves it.

We deliberately run one shared tree rather than many diverging worktrees: it's
simpler, and it spares everyone the merge-reconciliation tax later. The tradeoff
is a messy history — your work gets swept into other agents' commits and theirs
into yours — and that's expected and fine. Coordinate through **`locks:*`** (a
`PreToolUse` hook claims files per-edit automatically; call `locks:acquire` by
hand only for a multi-file change held across several edits) and **`coord:*`**
(`coord:declare-intent` announces what you're working on; handoffs + messages).

**Symptoms that you've forgotten the branch rule:**

* `git status` shows `On branch <not-staging>` in the shared checkout — switch
  back to `staging` immediately and recover any in-flight work via `git stash`.
* Paperclip starts editing files that look stale or wrong — it almost certainly
  thinks it's on a different branch than you.
* Dev/prod servers start serving 404s or HMR-error pages for routes that exist
  on disk — branch divergence between server and source.

**git-sync owns commit + push.** A background routine commits the whole shared
tree (every agent's work) and merges + pushes it to **`origin/staging`** on a
schedule — the superproject **and** every submodule (each to its own default
branch). You never `git add` / `git commit` / `git push`; just leave your work in
the tree and it lands on origin within a few minutes. Don't stash, branch, or
scope pathspecs to isolate "your" diff — there are no per-agent commits; the
routine packages whatever's in the tree. An auto-merge conflict it can't take is
resolved by a `merge-resolver` agent, not you. The per-edit file-lock hook still
serializes concurrent edits to the same file.

From `staging`, work reaches `main` automatically: **green-checkpoint** (hourly)
runs the suite on staging HEAD in an isolated checkout and fast-forwards `main`
when green; **release-trigger** (every 15 min) then auto-deploys green `main` to
the live `:3070` operator (drain → swap → migrate → restart → health-check,
auto-rollback). Your change being "in the tree" means it reaches `origin/main` +
the live host as soon as the suite is green — and NOT before. The `/admin/git`
tab shows the whole pipeline. Pause the routine only via `UPDATE
harness_shared.routines SET active=false WHERE name='git-sync'`. Design:
`git-sync-auto-commit-2026-06-03` + `staging-branch-pipeline-2026-06-06`.

(Submodules are unchanged: each stays on its own default branch. The
staging→main gate applies to the superproject; `main` only advances to staging
commits whose pinned submodule SHAs passed the suite, so green `main` always
resolves to a tested combination.)

## The two-port model — where a server-side edit goes live

**Server-side code has no hot-reload.** The **Hono host** (`bin/hono-host.ts` —
the MCP tools, the `lib/endpoint-route` handlers, and everything in
`apps/operator/lib/**` they import) runs under `tsx` with no file-watch. How an
edit goes live depends on which host:

* **`:3070` (`papercup-dev-api`) is the GREEN/stable operator** — it runs from
  the separate **release checkout** (`papercupai-workspace/papercup-release`),
  pinned to the green **`main` branch**. Restarting it just reboots the same
  green snapshot; **your `staging` edits are invisible to it** until the
  auto-serve pipeline carries them (green-checkpoint hourly FF, then
  release-trigger ≤15 min auto-deploy). A manual `npx tsx
  apps/operator/lib/release/deploy-cli.ts --execute` still works for an immediate
  deploy. See `apps/operator/lib/release/README.md`.
* **`:3170` (`papercup-staging-api`) is the staging operator** — it runs from
  the integration tree (the `staging` branch). To test a server-side edit live:
  `systemctl --user restart papercup-staging-api.service`, then probe `:3170`.
* **The Tauri dev shell** spawns its own operator from the integration tree —
  reloading the desktop shell picks up `staging` edits in that context.

(The `:3055` **Vite** dev server *does* hot-reload its own routes/components.)
The tell that you're testing stale server code: a probe lands in the *old* place
— e.g. during the coord FS→PG cutover a `coord:send` kept writing `coord/*.jsonl`
instead of Postgres because the host hadn't reloaded. Probe where the write
actually lands; if it's stale, restart the *right* host (or deploy) and re-probe
before trusting any result.

## Database topology — the long form

The **shipping** product is a desktop app backed by **embedded Postgres**
(`embedded-postgres-server`, per-harness instance), discovered through
`~/.papercusp/embedded-pg.json`. That remains the product direction, and code
must keep working under it.

**Reality on the standing dev box (verified 2026-06-01): the operator runs
against NATIVE Postgres `papercusp` on `localhost:5432`, not embedded-pg.**
`apps/operator/.env.local` pins
`DATABASE_URL=postgresql://harness_admin:…@localhost:5432/papercusp`; the `:5432`
cluster holds the live databases `papercusp` (operator), `papercusp_su`, and
`papercusp_test`; **no embedded-pg is running** here. The old claim that native
`papercusp` was renamed `papercusp_legacy` is **stale/false**.

Practical implications:

* **Never hardcode `localhost:5432`.** Resolve the admin DSN through
  `getHarnessAdminUrl()` so a code path works whether the box is on embedded-pg
  (discovery file) or the native-PG `DATABASE_URL` override.
* **SQL migrations** in `libs/papercusp/libs/db/sql/<NNN>-*.sql` are applied
  automatically by the embedded-pg boot runner
  (`libs/papercusp/packages/embedded-postgres-server/src/migration-runner.js`).
  Native `:5432` has **no** auto-runner.
* ⚠ **A raw `psql "$DATABASE_URL" -f <file>` runs the DDL but does NOT record
  the migration in `harness_shared.schema_migrations`** — only the RUNNER
  records. An applied-but-unrecorded migration stays "pending" to the runner
  forever: the deploy's migrate step re-runs it every deploy, and an idempotent
  re-run that contends for a lock (e.g. `ALTER … ENABLE ROW LEVEL SECURITY` on a
  live table) trips the deploy's 15s `lock_timeout` and ROLLS BACK — this wedged
  the whole fleet's deploys for \~1h on 2026-06-09 (migration `208-scout-ticks`,
  applied out-of-band, unrecorded). Apply via the runner (`db:migrate`, which
  records atomically) — or, if you must use `psql -f`, append `INSERT INTO
  harness_shared.schema_migrations (filename, sha256) VALUES ('<NNN>-….sql',
  '<sha256-of-file-contents>')` in the same transaction.
* **Don't add features that only make sense against native PG** (cross-database
  queries, `pg_extension` not available in embedded-pg, OS-level pg tooling). If
  embedded-pg can't run it, the product can't ship it.

See [storage policy](/internal/docs/system/storage-policy) for the PG-by-default
rule, the acceptable-file-uses list, and the two-axes model (runtime
store-of-record vs sync authority).

## Test infrastructure — the long form

* Test runner: **Vitest 4** (all layers). Shared config:
  `@papercusp/test-config` exports `defineVitestConfig`, `getTestPg` /
  `withTestSchema` (testcontainers-node Postgres), and `setupMsw` / `msw`.
* Integration tests get a per-file Postgres schema (`t_<hex>`) on a reused
  `postgres:16-alpine` testcontainer. **Docker must be running locally** for
  integration tests. Run `npm run test:doctor` to verify your environment.
* CI: per-PR `.github/workflows/test.yml` runs the affected unit + integration
  suites (results as a PR comment via JUnit); nightly
  `.github/workflows/test-nightly.yml` runs everything.
* **Property-based tests:** use `fast-check` for invariant-style tests where
  examples undercount — encoders/decoders, slug rewrites, hash canonicalisation,
  validator predicates. Pattern: `<source>.property.test.ts` colocated with
  source. See `libs/papercup-shared/src/_admin-paths.property.test.ts`.
* **knip** (`npm run lint:knip`, `:fix` to auto-remove): runs in CI
  **informationally** — never gates a merge. False positives live in
  `knip.json`'s `ignoreDependencies` allow-list.
* **Flaky-test quarantine:** `quarantine.txt` at the repo root, one entry per
  line as `<workspace-name>::<file>`. Quarantined workspaces still run in CI but
  their failures don't gate the merge. A PR that touches a quarantined test's
  source must either de-quarantine it or document why it stays.
* **Test secrets:** `TEST_<SERVICE>_KEY` naming, stored in GH Actions repository
  secrets. Do **not** check live keys into fixtures.
* The affected-test walker (`scripts/affected-tests.mjs`) diffs against
  `origin/main`, maps changed files to npm workspaces, computes the
  reverse-dependency closure, and runs every affected workspace's `test` (and
  optionally `test:integration`) script. If your edit touches
  `libs/papercusp/libs/db/**` (schema / migrations) → run `npm run
  test:all:integration` — schema changes affect every workspace and the
  dependency graph won't catch them. `infra/**` / `Procfile*` → no automated
  coverage; verify manually.

## Prompts are auto-generated — the long form

Every agent-facing prompt is ASSEMBLED at launch/spawn time from source files;
the text an agent receives is a rendered artifact, regenerated on the next launch
(a direct edit there is clobbered and never reaches anyone). The sources:

* **Chat-surface role prompts** (operator, oracle, …) — assembled per-launch by
  `packages/operator-core/lib/prompt-assembly.ts` from three source layers in
  `apps/operator/prompts/`: `<role>.persona.md` (behavior) + the tools catalog
  (generated from each tool's `defineTool({ guidance })`) + `<role>.tools.md`
  (cross-tool workflows). Pick the lowest layer that fits — per-tool guidance
  belongs on the `defineTool` call, not in prose.
* **psu / SU collaborator playbooks** — sources are
  `apps/operator/prompts/papercusp-su-{engineer,power}.tools.md`, rendered
  per-launch by `renderSuPlaybook`
  (`packages/operator-core/lib/desktop-install/papercusp-files.ts`), which also
  splices the repo `CLAUDE.md` in as the "Project guide" section — a
  repo-convention change belongs in CLAUDE.md and reaches every psu session
  automatically. The live `:3070` psu serves the **release checkout's** copy, so
  an edit reaches new psu launches only after the staging→green deploy carries
  it.
* **Autonomous harness spawn prompts** (scoper → worker → validator → reviewer
  …) — sources at `libs/papercusp/packages/harness/prompts/<role>.md`, layered
  with `base/<role>.md` + kind/department overrides per the resolution rules in
  that directory's `README.md`.
* **Never edit rendered outputs:** `~/.papercusp/*-collaborator*.md` (vestigial
  installer dumps, not read at launch), anything under the `papercup-release`
  checkout, or an assembled prompt captured from a live session.

In dev, prompt-source edits load immediately (`PAPERCUSP_RELOAD_PROMPTS=1`,
default in development). After editing a `<role>.tools.md`, run the sync test:
`cd packages/operator-core && npx vitest run tools-md-sync`. After a substantial
edit to the SU engineer playbook, run the behavioral suite (`npm --prefix
apps/operator run llm-test -- --target su`).

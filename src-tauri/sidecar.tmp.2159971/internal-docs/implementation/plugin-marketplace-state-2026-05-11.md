# Plugin + marketplace pipeline — state as of 2026-05-11
URL: /internal/docs/implementation/plugin-marketplace-state-2026-05-11

One-page reference for the TS plugin/template/snapshot/marketplace system as it stands today. Where the code is, what's covered by tests, what's deferred, and where to look first.

import { Aside } from '@astrojs/starlight/components';

Snapshot of the system as `tsplugin` agent left it (2026-05-11). For the
roadmap of new runtimes built on top of this (WASM, daemon, iframe),
see `papercup-native/docs/ts-plugin-system-v1-plan.md` — owned by
`@plugin` agent (Rust runtime).

Preserved as the 2026-05-11 milestone. Reading it today, note:

* The operator is now **`apps/operator/`** and its `app/api/**` routes were
  ported to **Hono routers under `packages/operator-core/lib/endpoint-route/routes/**`**;
  `apps/operator/lib/*` (e.g. `plugin-host-runtime.ts`, `plugin-grants.ts`)
  now lives under **`packages/operator-core/lib/`**. The Next route paths in
  the tables below are stale.
* The `localhost:3057` / `papercuspai.com` marketplace-api was superseded by
  the in-app **Cupboard** (`apps/operator-public`, CF Workers + Hono + D1).
* The "use git worktrees for non-main work" hard rule is **reversed** under
  the current model: the shared tree stays on `staging` and you do **not**
  branch/worktree — concurrency is serialized by the `locks:*` + `coord:*`
  systems. See the repo `CLAUDE.md` "Branch discipline" section.

## TL;DR

Three publishable kinds (`plugin`, `template`, `snapshot`) share one marketplace pipeline. Operator at `localhost:3055` serves the install/discover surface; marketplace-api at `localhost:3057` is the registry. Plugins run in-process under a two-tier capability check (manifest ∩ user-granted). Tests cover every helper and DB-backed function shipped in this session.

## Source layout

| What                                                                                    | Where                                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Plugin SDK (types, capability strings, manifest schema)                                 | `packages/plugin-sdk/`                                                                             |
| Plugin loader (manifest validate, capability check, hookbus, action registry, audit)    | `packages/plugin-loader/`                                                                          |
| Plugin host runtime in operator                                                         | `apps/operator/lib/plugin-host-runtime.ts`                                                         |
| Per-(plugin, harness) grants                                                            | `apps/operator/lib/plugin-grants.ts` + Migration `051-plugin-capability-grants.sql`                |
| Audit log (PG writer)                                                                   | `apps/operator/lib/plugin-audit-writer.ts` + Migration `052-…`                                     |
| Marketplace API routes                                                                  | `apps/operator/app/api/{marketplace,plugins,templates,snapshots,harness/[slug]/save-as-template}/` |
| Marketplace UI components                                                               | `libs/marketplace-public-ui/src/` (shared with public site)                                        |
| Operator-side marketplace pages                                                         | `apps/operator/app/marketplace/{,templates,plugins,snapshots}/`                                    |
| Operator-side installed pages                                                           | `apps/operator/app/installed/{harnesses,plugins,snapshots,templates}/`                             |
| Marketplace registry server                                                             | `../papercusp-registry/apps/marketplace-api/` (separate repo `papercupai/papercusp-registry`)      |
| CLI (`papercusp install`, `plugin enable/disable/lint/init`, `snapshot {fork,publish}`) | `libs/papercusp/packages/cli/src/`                                                                 |
| Snapshot capture / restore                                                              | `libs/papercusp-export-state/src/`                                                                 |

## What runs end-to-end today

### Plugin lifecycle

1. **Install** — `POST /api/marketplace/install-plugin { slug, version? }` shells out to `papercusp install <slug>@<version>`. **Atomic since PR #6**: downloads + extracts + validates manifest in a sibling staging dir, then renames into place. Failed download / bad tarball / manifest mismatch preserves the existing install.
2. **Enable** — `POST /api/plugins/enable { slug, harnesses[], disable? }` adds to `enabled-plugins.json` for each harness and writes the boot-time silent grant backfill.
3. **Consent** — `/installed/plugins/<slug>/permissions` renders a harnesses × capabilities grid; toggling `POST /api/plugins/grants { plugin, version, harness, capabilities, action }` mutates `harness_shared.plugin_capability_grants`. Two-tier check: every `hasCapability(ctx, cap)` ANDs manifest with the granted set.
4. **Run** — Lifecycle hooks fire from operator (`beforeMissionStart`, `mission.start`, `onFeaturePassed`, `task.passed`, `feature.completed`, `proposal.accepted`) and from `run.sh` (`beforeMissionStart`, `onPostOrchestrator`, `onPostWorker`, `onPostValidator`, `afterDone`).
5. **Action invocation** — `POST /api/plugins/[...path]` proxies through `ctx.actions.register(...)`'d handlers. Every invocation produces an audit row via `PgAuditWriter` (fail-closed — action fails if audit write fails).
6. **Update** — `GET /api/plugins/updates` diffs installed vs catalog; `/installed/plugins` shows "Update → vX.Y.Z" with new-cap re-consent prompt before bumping.
7. **Uninstall** — `POST /api/plugins/uninstall { slug }` removes the global plugin dir + disables from every harness it was enabled in.

### Template lifecycle

1. **Save** — "Save template" button on harness dashboard → `POST /api/harness/<slug>/save-as-template { slug, version, description?, author? }` forks the recipe (SPEC.md, AGENTS.md, `.papercusp/config.json`, `.papercusp/validation-contract.md` + plugin recommendations from `enabled-plugins.json`) into `~/.papercusp/templates/<slug>/<version>/`.
2. **Publish** — `POST /api/templates/<slug>/<version>/publish` tars + signs + uploads to marketplace-api.
3. **Install** — `POST /api/marketplace/install { slug, projectName, targetPath? }` scaffolds a new project. **Slug-collision recovery (PR #5)**: returns `{ code: 'project_name_taken', suggestedName: '<base>-2' }` on conflict; UI auto-offers via `confirm()`. Partial-init cleanup wipes half-scaffolded dirs on `papercusp init` failure.

### Snapshot lifecycle

1. **Capture** — `POST /api/snapshots/create` writes a tarball under `<harness>/.papercusp/snapshots/`.
2. **Publish** — `POST /api/snapshots/<id>/publish` uploads to marketplace.
3. **Fork** — `POST /api/snapshots/<id>/instantiate` (or `papercusp snapshot fork`) creates a new harness with schema rename. **Grants carry over (PR #2)**: `copyGrantsToNewHarness` copies every `(plugin, version, capability)` grant on the source harness to the new fork via `INSERT … SELECT … ON CONFLICT DO NOTHING`.
4. **Republish** — *pending*. PR-B paused per `@plugin`'s reply on coord, awaiting v1 plan greenlight (Batch G+1 bumps `SNAPSHOT_SCHEMA_VERSION` to 2).

## Hard rules in this code (don't break)

* **No TS deletion** anywhere in `apps/operator/` or `libs/papercusp/`. Set by `shared.jsonl` 2026-05-10T05:50.
* **Rust port is opt-in** via `?backend=rust`; default routes always go to TS.
* **Paperclip stomps** `apps/operator/app/harness/*` periodically. `pgrep -af paperclip` before editing harness UI; race-and-recommit if it stomps you.
* **Schema ownership**: `packages/plugin-sdk/papercusp-plugin.schema.json` is `@plugin`'s territory going forward (per their handoff on coord 2026-05-11T15:30). Transitional additions get a `kind: contract` post first.
* **Use git worktrees** for any non-main feature work — never branch-switch the canonical `papercup/` checkout while other agents may be writing.

## Test coverage

Plugin-loader tests (vitest, `packages/plugin-loader/`):

* 91 cases covering manifest validation, capability matching (incl. two-tier), hookbus isolation, action registry, semver, audit, api-factory, tools.

Operator unit tests (vitest, `apps/operator/`):

* 67 cases on pure helpers from PRs #2-#5: `isNewerVersion`, `computeCapChange`, `suggestNextFreeName`, `SLUG_RE`, `SEMVER_RE`, `explainCapability`, `tierBadgeColor`.

Operator integration tests (vitest + testcontainers PG, `apps/operator/test/`):

* 25 cases covering every public function in `lib/plugin-grants.ts`: `copyGrantsToNewHarness` (8), `grantCapabilities/revokeCapabilities/getGrantsForPluginInHarness` (11), `backfillGrantsFromEnabledPluginsAndLegacyFile` (6).

Total: **183 tests** specifically on the plugin/marketplace surface.

## What's deferred / out of scope

Documented in `/docs/spec/plugin-runtime-roadmap` (Batch F deferrals):

* Typed `ctx.kv` with quotas
* Hot-reload state preservation
* `papercusp plugin doctor` (declared-vs-used capability static analysis)

Awaiting user greenlight (Batches G/G+/H/I in `papercup-native/docs/ts-plugin-system-v1-plan.md`):

* WASM plugin runtime via `@bytecodealliance/jco`
* Subprocess daemon runtime via `bwrap`
* Sandboxed iframe UI surface
* Snapshot/template integration for the new runtimes

Out-of-band gated:

* **PR-B (snapshot republish UI)** — paused pending G+1/G+2 schema bump
* **`feat/bundle-runtime-deps`** in `papercusp-desktop` — only Claude+Meridian on-demand installer is unique; owner's call

## Key APIs at a glance

```
GET   /api/marketplace/catalog                  — proxies marketplace-api with hide-filter
POST  /api/marketplace/install                  — template/snapshot install (slug-collision aware)
POST  /api/marketplace/install-plugin           — plugin install via papercusp CLI
DELETE /api/marketplace/uninstall               — template uninstall
GET   /api/plugins/global                       — installed plugins
GET   /api/plugins/manifest?slug=<id>           — declared capabilities for consent UI
GET   /api/plugins/updates                      — installed-vs-catalog diff with capChange
GET   /api/plugins/grants?plugin=&version=&harness=
POST  /api/plugins/grants                       — toggle a (plugin, harness, cap) grant
POST  /api/plugins/enable                       — enable/disable a plugin in harness(es)
POST  /api/plugins/uninstall
POST  /api/snapshots/create
POST  /api/snapshots/<id>/publish
POST  /api/snapshots/<id>/instantiate           — fork (carries grants)
POST  /api/snapshots/<id>/retract
POST  /api/harness/<slug>/save-as-template
POST  /api/templates/<slug>/<version>/publish
```

## First places to look

* New plugin author: `/docs/spec/plugin-quickstart` — five-command flow from blank dir to published plugin.
* Plugin runtime contract: `packages/plugin-sdk/src/index.ts` — capability strings + lifecycle hook signatures.
* Capability semantics: `packages/plugin-loader/src/capabilities.ts` — wildcard matching, two-tier AND.
* Manifest schema: `packages/plugin-sdk/papercusp-plugin.schema.json` — `additionalProperties: false`.
* Lifecycle wire-up: `apps/operator/lib/plugin-host-runtime.ts` — fire-points + audit + grants integration.
* Marketplace registry: `../papercusp-registry/apps/marketplace-api/src/server.ts` — catalog, signing, retraction, SBOM.

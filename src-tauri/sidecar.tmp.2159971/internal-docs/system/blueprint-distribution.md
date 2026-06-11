# Blueprint distribution — publish, install, resolve
URL: /internal/docs/system/blueprint-distribution

How blueprints travel — the local→installed→built-in resolution tiers, the Cupboard publish/install routes, the dependencies model ({tools, packs, plugins}), and why the bundled built-ins are both the bootstrap floor AND ordinary published listings.

import { Aside } from '@astrojs/starlight/components';

A **blueprint** (the declarative shape of a harness — see the blueprint engine
in `libs/papercusp/packages/orchestrator/src/blueprint/`) is a distributable
unit: it can be published to the **Cupboard** as a `kind=blueprint` listing and
installed on any other Papercusp host. This page is the architecture of that
distribution path (plans: `official-blueprints-cupboard-publish-2026-06-05`,
`harness-blueprint-distribution-2026-06-03`,
`tool-distribution-granularity-2026-06-05`).

## The three resolution tiers

Every place a blueprint id is resolved (`extends` parents, `harness:create`,
`blueprint:validate`/`extend`, install-time validation) goes through ONE
composed resolver — `operatorResolveExtends()`
(`packages/operator-core/lib/blueprint/installed-blueprints.ts`, wrapping
`makeComposedResolveExtends` from `@papercusp/blueprint-distribution`):

| Tier          | Where                                                                                   | Wins over            |
| ------------- | --------------------------------------------------------------------------------------- | -------------------- |
| **local**     | a project's `.papercusp/blueprints/<id>/blueprint.yaml` (when a project context exists) | installed + built-in |
| **installed** | `~/.papercusp/blueprints/<id>/blueprint.yaml` (Cupboard-installed)                      | built-in             |
| **built-in**  | the bundled dir `@papercusp/harness/blueprints/<id>/`                                   | —                    |

First hit wins, so an installed copy of `review` **shadows** the bundled
`review`. The authoring tools (`blueprint:extend`, `blueprint:validate`)
resolve all three tiers — the old "parent must be a built-in" gating was an
artificial tool-level restriction, retired per D-005.

The engine must boot **without** the Cupboard (you can't fetch `base` from the
Cupboard if the Cupboard needs a blueprint to run), so the built-ins stay
bundled as the offline floor. They are **also** published as ordinary
`kind=blueprint` listings authored by the `papercupai` account (D-003) — the
official library dogfoods the exact distribution path every community
blueprint uses. "Official" means "authored by papercupai", not "exempt from
the process". The only thing removed is the un-publishable special treatment,
not the bundle.

`base` is the **abstract parent** — it has no spine of its own and only exists
to be extended; it does not schema-parse standalone (the install route reports
it as `abstract: true`).

## The dependencies model

A blueprint declares what its roles need in a top-level `dependencies:` block
(`DependenciesSchema` in the engine schema; validated by
`validateBlueprintDependencies` in
`libs/papercusp/packages/blueprint-distribution/src/blueprint-deps.ts`):

```yaml
dependencies:
  tools:   [work_items:claim, coord:send, plans:get]   # capability names
  packs:   []                                          # curated tool sets (runtime-less)
  plugins: [repomix]                                   # runtime-bearing units
```

Resolution rules (tool-distribution D-001/D-002 — a *tool* is a pack of n=1, a
*plugin* is a pack **with a runtime**):

* a declared **tool** is satisfied iff it's in the host's available-tool set
  (built-ins + tools registered by installed units); a tool provided by a
  known installable Cupboard unit is **installable** (advisory); a tool with
  no known provider is a **hard failure**;
* a declared **pack** resolves against every distribution unit (installed →
  satisfied, Cupboard → installable, neither → hard failure);
* a declared **plugin** must be installed (satisfied) or Cupboard-listed
  (installable — `init --from` and the install route's consent-gated step can
  fetch it); neither → hard failure.

This validation runs **upfront** — at `harness:create`, `init --from`, and
blueprint install — closing the old call-time-only `unknown_tool` gap.

Two sharp edges worth knowing when authoring a `dependencies:` block:

1. **Exact names only.** There is no wildcard/group expansion — `coord:*` is
   treated as a literal (unknown) tool name and hard-fails. Declare concrete
   tool names.
2. **`extends`-merge replaces arrays.** The loader's `mergeRaw` recurses into
   objects but replaces arrays wholesale, so a child's `dependencies.tools`
   **wipes** its parent's list (no union). Declare the full list per
   blueprint; don't rely on inheriting a parent's deps.

A static CI guard
(`packages/operator-core/lib/__tests__/blueprint-deps-catalog.test.ts`)
validates every bundled built-in's resolved deps against the static tool
catalog + the in-repo plugin manifests on every run — a typo'd tool name or an
unknown plugin dep fails at commit time, mirroring `tools-md-sync`'s static
catalog approach.

## Publish

`POST /api/cupboard/publish-blueprint`
(`packages/operator-core/lib/endpoint-route/routes/cupboard-publish-blueprint.ts`)
publishes a locally-resolvable blueprint as a `kind=blueprint` listing via the
**standard** listing-publish core (`publishListingToCupboard` — gh-token +
channel-2 device attestation):

```jsonc
{ "id": "review", "github_url": "https://github.com/Papercusp/blueprints" }
// optional: listing_ref (defaults to id), project_ref, title, description
```

A blueprint listing is **GitHub-repo-backed**: it points at a PUBLIC repo
whose `<listing_ref>/blueprint.yaml` is the blueprint. The official library is
the public mirror repo [`github.com/Papercusp/blueprints`](https://github.com/Papercusp/blueprints) —
one repo hosting every official blueprint as a top-level `<id>/` dir, one
Cupboard listing per blueprint (`listing_ref` = the id). The bundled sources
live in the private monorepo (`libs/papercusp/packages/harness/blueprints/`),
so the content repo is always explicit; the mirror is regenerated +
papercupai-pushed by `scripts/publish-official-blueprints.mts sync`. The Cupboard worker's standard gates apply, verified
in P0 (plan D-006):

* bearer auth + publisher attestation;
* **5 publishes/hour/user** (durable) — the official set publishes in batches;
* the repo **must be public** (authed GitHub check + repository-id match);
* dedup per (repo, kind, listing\_ref) — re-publish is idempotent;
* **no pre-publication review** — open publishing with post-facto moderation
  (reports / unlist / device-pubkey ban-list). See
  [distribution trust](/internal/docs/security/distribution-trust).

## Install / fork

`POST /api/cupboard/install-blueprint`
(`packages/operator-core/lib/endpoint-route/routes/cupboard-install-blueprint.ts`,
core: `lib/cupboard/install-blueprint-core.ts`):

```jsonc
{ "listingId": "…" }                       // resolve repo + ref from the listing
// or { "githubUrl": "https://github.com/…", "listingRef": "review" }
// optional: installPlugins: true — consent to auto-install declared plugin deps
```

The flow: shallow-clone → locate `<listing_ref>/blueprint.yaml` → schema +
semantic validation (under the composed resolver, so `extends: base` resolves
against the bundled floor) → **import-time dep-validation** → place under
`~/.papercusp/blueprints/<id>/` (the installed tier, where it shadows a
same-id built-in). The response carries `{ id, version, abstract, installedTo,
dependencies, depCheck }`.

Plugin deps are **consent-gated** (D-001): only `installPlugins: true`
fetches the declared, Cupboard-resolvable plugins; each install goes through
the normal plugin capability-grant path.

In the UI, a `kind=blueprint` Cupboard listing's **Fork** button
(`apps/operator/app/cupboard/[id]/page.tsx`) executes this route directly
(without `installPlugins` — consent stays an explicit per-plugin act; the
success toast lists what's installable).

## Browse

`GET /api/cupboard/listings?kind=blueprint` lists blueprint listings (the
operator proxies the Cupboard worker; the storefront's kind tabs are
URL-backed via nuqs `?kind=`).

## Source map

| Concern                              | Source                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composed resolver + installed dir    | `packages/operator-core/lib/blueprint/installed-blueprints.ts`                                                                                                                                                                                 |
| Pure tiered resolver                 | `libs/papercusp/packages/blueprint-distribution/src/resolve-extends-composed.ts`                                                                                                                                                               |
| Dep validator (pure)                 | `libs/papercusp/packages/blueprint-distribution/src/blueprint-deps.ts`                                                                                                                                                                         |
| Pack model (tool→provider)           | `libs/papercusp/packages/blueprint-distribution/src/pack-model.ts`                                                                                                                                                                             |
| Publish route                        | `packages/operator-core/lib/endpoint-route/routes/cupboard-publish-blueprint.ts`                                                                                                                                                               |
| Install route + core                 | `packages/operator-core/lib/endpoint-route/routes/cupboard-install-blueprint.ts`, `lib/cupboard/install-blueprint-core.ts`                                                                                                                     |
| Live pack catalog (host wiring)      | `packages/operator-core/lib/cupboard/pack-catalog.ts`                                                                                                                                                                                          |
| Static CI dep guard                  | `packages/operator-core/lib/__tests__/blueprint-deps-catalog.test.ts`                                                                                                                                                                          |
| Authoring tools                      | `packages/operator-core/lib/agent-tools/blueprint/{catalog,validate,extend,create,_resolve}.ts`                                                                                                                                                |
| Official mirror sync + batch publish | `scripts/publish-official-blueprints.mts` (`sync` regenerates [`Papercusp/blueprints`](https://github.com/Papercusp/blueprints) from the bundle; `publish [--ids a,b] [--limit N]` runs the publish route in-process, respecting the 5/hr cap) |
| Dep derivation aid                   | `scripts/derive-blueprint-deps.mjs` (derives each blueprint's tool list from its role personas — a review aid, not an auto-writer)                                                                                                             |

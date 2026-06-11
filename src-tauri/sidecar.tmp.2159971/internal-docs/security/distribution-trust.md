# Distribution trust posture
URL: /internal/docs/security/distribution-trust

The v1 trust model for distributing harnesses, blueprints, snapshots, and plugins through the Cupboard — why forking pulls a supply-chain surface, how capability-gating + install-consent contain it, what we defer, and what's explicitly out of scope.

import { Aside } from '@astrojs/starlight/components';

The **Cupboard** is one storefront with three listing kinds, each with a
different consumer action and a different trust surface:

| Kind        | Action      | Pulls code?                                                   | Trust surface                                                                        |
| ----------- | ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `harness`   | **join**    | No — joins a Hypercore swarm by topic                         | Peer/membership trust ([shared harnesses](/internal/docs/security/shared-harnesses)) |
| `blueprint` | **fork**    | **Yes** — clones the project remote + any bundled plugin code | Supply chain (this page)                                                             |
| `snapshot`  | **fork**    | **Yes** — same as blueprint                                   | Supply chain (this page)                                                             |
| `plugin`    | **install** | **Yes** — installs a distributable plugin                     | Supply chain (this page)                                                             |

This page is the trust posture for the **code-pulling** kinds — forking a
blueprint/snapshot and installing a plugin. It records the v1 decision
(`harness-blueprint-distribution-2026-06-03`, **P-009 / D-007 / D-009**) and,
importantly, what is **deferred** and what is **out of scope**.

## The supply-chain surface

Forking a blueprint or snapshot pulls the project remote *and any plugin code it
bundles*; installing a plugin pulls plugin code directly. Plugin code runs in
the operator's plugin host with access to host services (tasks, secrets, fetch,
compute). **Unconstrained, that is a classic supply-chain risk** — a published
listing could ship a plugin that reads secrets or exfiltrates over the network.

## v1 posture: capability-gate + install-consent

The v1 containment is the **existing two-tier plugin capability model** — we
reuse it rather than inventing a distribution-specific mechanism (D-009). A
plugin capability is usable **iff it is in BOTH tiers**:

1. **Tier 1 — manifest.** The plugin's `capabilities[]` (manifest) declares what
   it *could* use. Format `namespace:action[:resource]`
   (`tasks:read`, `http:fetch:*.youtube.com`, `secrets:read:YT_API_KEY`).
2. **Tier 2 — install-consent.** At install/enable the operator presents those
   caps to the user, who grants a subset. The grant set is stored in
   `harness_shared.plugin_capability_grants` (Migration 051) and loaded at
   plugin init.

The gate is `hasCapability(ctx, cap)` in
[`packages/plugin-loader/src/capabilities.ts`](https://github.com/Papercusp/plugin-loader) —
it ANDs the manifest set with the granted set (both wildcard-aware). The grants
store + loader live in the operator core (`lib/plugin-grants.ts` ·
`getGrantsForPluginInHarness`, and `lib/plugin-host-runtime.ts` ·
`loadGrantedCapsSafe`, which the operator host always populates so the runtime is
never on the legacy single-tier path; post-carve these are
`@papercusp/operator-core`).

The invariant a forked blueprint relies on: **a forked plugin can use a
capability only if it is both declared in the manifest AND consented to at
install — it can never escalate beyond either.** A tampered/forged grant set
cannot widen the manifest (tier 1 is still required), and declining consent
leaves the plugin inert. This is pinned by
`packages/plugin-loader/src/fork-install-consent.test.ts`.

The dangerous egress surfaces are gated at the boundary a forked plugin actually
hits: `makeFetchProxy` rejects any host not covered by an `http:fetch:<host>`
capability, and `makeSecretsProxy` rejects any `secrets:read:<NAME>` not granted.

### Server-capability invocation (palette)

The desktop palette's server-capability path
(`lib/capabilities/invoke.ts` · `paletteInvokeGuard` →
`invokeServerCapability`; post-carve `@papercusp/operator-core`) runs **with no
gate bypass for trust/role**: it is a plain loopback `operator` principal, a
server-side §3 admission re-check refuses non-eligible tools, and
destructive/high-risk tools require an explicit `confirmed:true`. Every call is
audited. (See D-007 in the source.)

## Publisher trust signals (Cupboard worker)

The Cupboard worker (`apps/operator-public`) surfaces *advisory* publisher
signals on each listing — they inform, they do not hard-gate (a provisional
listing is **not** an ownership claim):

* **Publisher-collaborator signal** — the publisher's GitHub permission on the
  bound repo at publish time (`publisher_permission`, Migration 002;
  `derivePublisherPermission`). The browse card shows "collaborator" vs "not a
  collaborator". A non-collaborator who can merely read a public repo reads as
  `read`.
* **Channel-2 device attestation** — an optional device-key ↔ GitHub-login gist
  binding (Migration 003), verified/revoked by the hourly indexer.
* **Operator ban-list** — `banned_publisher_pubkeys`; a banned publisher
  device pubkey's listings are filtered from browse and 404 on detail.
* **Private repos are rejected** at publish; all listings are public.

These are the same signals harness listings already carried — the
three-listing-kind merge applies them uniformly to blueprint/snapshot/plugin
listings (every kind is project-remote-backed in v1).

## Deferred (D-009) — acceptable because there are no users yet

* **Plugin signing.** No cryptographic signature on plugin code.
* **A review/curation process.** No human or automated review gate before a
  listing is publishable.

Capability-gate + install-consent is the floor; signing/review raise it later.
Revisit before there are real users installing third-party listings.

## Out of scope here (D-012)

* **Producer-side trust** — collaborator push-access to the papercupai project
  remote (who may *publish/contribute to* a project), as opposed to
  consumer-side trust (what a *forked/installed* plugin may *do*, this page).
  That surface is owned by the
  [project-centric rethink](/internal/docs/spec) and the
  distributed-coordination plans (`distributed-coordination-shared-harness-2026-06-04`).

## Summary

| Concern                            | v1                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| Forked/installed plugin capability | manifest ∩ user-consented grant (`hasCapability`)                                          |
| Consent record                     | `plugin_capability_grants` (Migration 051)                                                 |
| Network / secret egress            | per-host / per-name capability via fetch+secrets proxies                                   |
| Palette server-capability          | §3 re-check, confirm-for-destructive, no trust bypass, audited                             |
| Publisher trust                    | advisory signals (collaborator perm, device attestation, ban-list); private repos rejected |
| Signing / review                   | deferred (D-009)                                                                           |
| Producer-side push trust           | out of scope (D-012)                                                                       |

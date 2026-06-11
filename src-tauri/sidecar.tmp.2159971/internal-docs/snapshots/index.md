# Sharable infrastructure plan
URL: /internal/docs/snapshots/index

A design proposal for letting harness snapshots carry both reproducible plugin configuration and arbitrary infrastructure provisioning, so a forker can clone a complete working stack.

import { Aside } from '@astrojs/starlight/components';

The plan has been through **six rounds of external review**. Each
substantive concern has been folded in; see [Revisions](./revisions)
for the full mapping. The design is now stable enough to send for
sign-off review (round 7). Sign-off reviewers should focus on:

* Are the V1 / V1.1 / V2 cuts in [Open Questions](./open-questions) honest?
* Are the per-section LOC estimates realistic?
* Has anything been missed that would block public marketplace launch?

If round 7 returns "no substantive concerns," implementation begins.

## What problem this solves

Today, a harness snapshot captures:

* The harness's project files (code, docs, prompts)
* The harness's database state (`harness_<slug>` schema)
* Per-harness plugin configs (raw JSON in `~/.papercusp/harnesses/<slug>/plugin-configs/`)
* The set of enabled plugins (`enabled-plugins.json`)

When a user **forks** that snapshot, they get a fully working harness — *as long as* the underlying infrastructure already exists. Concretely:

* If the original harness deployed to a Cloudflare Pages project, the forker has to manually create their own Cloudflare account + token + Pages project + paste credentials before the `cloudflare-pages` plugin's actions work.
* If the original harness pushed to a GitHub repo, the forker has to manually create a PAT + a target repo before `github-repo` works.
* If the original harness used a hypothetical `aws-lambda` plugin to deploy serverless functions, the forker has to manually create the Lambda + IAM role + API gateway... none of which is captured by today's snapshot.

This makes "publish a working harness template" significantly harder than it should be. Two changes close the gap:

1. **Per-field share semantics** — plugins declare which config fields are sharable (default), which are private to the publisher (must be re-supplied), and which are credentials (must be re-authorized via OAuth or paste). The snapshot exporter respects these flags.
2. **Build scripts** — plugins can ship an executable `setup` script that the substrate runs (with full visibility) on the fork-er's host to provision the plugin's required infrastructure. Symmetric `teardown` and `verify` scripts cover uninstall and health-check.

Both changes preserve the snapshot system's current safety properties (no secret leakage; no silent code execution) while extending what a snapshot can encapsulate.

## Vision: forking a complex snapshot

After both pieces ship, the user-visible flow for forking a snapshot like
`ecommerce-stripe-aws-cloudflare` is:

```text
Forking ecommerce-stripe-aws-cloudflare → my-store
─────────────────────────────────────────────────────

  1.  Fork project files       …………………………………………………………… ✓ done (instant)
  2.  Restore harness DB schema ……………………………………………………… ✓ done (1.2s)
  3.  Apply redacted plugin configs ……………………………………………… ✓ done (instant)
  4.  Connect external accounts:

      ☐ GitHub      [ Connect with GitHub ]      ←  OAuth, no token paste
      ☐ Stripe      [ Connect with Stripe ]      ←  OAuth
      ☐ AWS         [ Paste access keys… ]       ←  no OAuth — paste
      ☐ Cloudflare  [ Paste API token… ]         ←  no OAuth — paste

  5.  Approve and run provisioning scripts:

      ☐ aws-lambda          provision-aws.sh   [Review ▶]
            Creates: 1 Lambda function, 1 API Gateway, 1 IAM role
            Estimated cost: $0–5/mo
      ☐ stripe-webhooks     provision-stripe.sh   [Review ▶]
            Creates: 1 webhook endpoint, 1 Stripe restricted-key
      ☐ cloudflare-pages    provision-cloudflare.sh   [Review ▶]
            Creates: 1 Pages project, 1 custom domain binding

      ☐ I trust this snapshot's publisher (papercupai)

      [ Approve all & run ]    [ Run one at a time ]
```

After step 5, the harness is genuinely ready to run. Every credential the user
provided is theirs; every cloud resource was provisioned with their explicit
approval; the audit log preserves what ran.

## Two-part proposal

This plan is split across two complementary mechanisms. They're orthogonal —
either could ship without the other — but together they're what unlocks
shareable arbitrary infrastructure.

| Part                  | What it does                                                                                                                                                                                            | Read more                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **Build scripts**     | Plugins declare `provision.{setup,teardown,verify}` scripts that the substrate runs on the host with full visibility, capturing output and tracking created resources for cleanup.                      | [Build scripts](./build-scripts)         |
| **Share semantics**   | Plugins flag each `configSchema` field as `secret` (credential, stripped on snapshot) / `shareable: false` (publisher-specific identifier, stripped) / default (config that travels with the snapshot). | [Share semantics](./share-semantics)     |
| **OAuth integration** | The substrate provides a generic OAuth helper so plugins can mark a credential field as `oauth: { provider, scopes }` and users get a "Connect" button instead of a paste field.                        | [OAuth integration](./oauth-integration) |

## What this plan does NOT change

To set scope expectations:

* **The plugin loader contract** — plugins still ship as a manifest + JS entry + capability declaration. Scripts are an *additional* lifecycle surface, not a replacement.
* **The capability gate** — actions and hook handlers still run inside the DI sandbox with `secrets:read:*` / `http:fetch:*` enforcement. Build scripts are a separate, opt-in escape hatch with their own consent flow, not a backdoor around the gate.
* **The snapshot tarball format** — additive only: new fields in the manifest (`requiresProvisioning: true` to signal the consent flow is needed), new files in the tarball, plus per-plugin `.shape.json` companions describing what was redacted. Old snapshots fork cleanly with the new code.
* **The harness contract** (§3 of the spec) — fresh-context roles, structured state, atomic checkout, etc. all unchanged.
* **The CLI surface** — `papercusp install`, `papercusp snapshot fork`, `papercusp plugin enable` all keep their current commands. New flags get added; nothing renames.

### Known gap, explicitly acknowledged

* **Marketplace moderation** — the current marketplace publish flow has no human-review gate. Any service-token holder can publish. Build scripts make this gap more consequential (an unsigned script from an unverified publisher is now a code-execution vector, not just a misbehaving REST integration). The mitigations in this plan — sandbox-by-default, consent dialog, static-analysis warnings, quarantine-invalidates-trust — are designed assuming the marketplace ships *without* moderation initially. A separate spec doc covering a moderation/review layer is forthcoming and is **not** part of this plan.

## High-level phasing

| Phase                            | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Approx LOC         | Sequencing                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1 (share-semantics + OAuth)** | Per-field share flags (`secret` / `shareable` / `snapshotPolicy`) + snapshot-export filtering + schema-evolution aliases (rename + removal) + plugin-version pinning + security-advisory consultation. Plus OAuth substrate, GitHub provider, `ctx.oauth.token()` helper with concurrent-refresh Promise cache, paste-PAT scope verification.                                                                                                                                                                                                                          | \~600              | Single PR. The two were originally split A → B but ship together because OAuth-acquired tokens depend on the `secret` flag for snapshot stripping. |
| **V1 (build-scripts)**           | Build-script lifecycle: SDK types, provision-runner service, OS-level sandboxing (bwrap-bundled with smoke test on Linux; sandbox-exec + signed-only on macOS), `papercusp_record_resource` helper, audit logging with per-plugin cap override, PG-based recovery contract, idempotency with scriptHash + configHash + pluginVersion, consent flow, fork-time review UI, cloudProvider presets, network-policy floor (IMDS/RFC1918), trust per-(publisher, plugin) with ownership-transfer + key-rotation handling, hook queue-and-replay, single-user-host detection. | \~1,400–1,500      | After share-semantics + OAuth.                                                                                                                     |
| **V1.1**                         | github-repo dogfood (re-implement repo creation as build script), `runAt` scheduling for hooks/routines/webhooks, `budgetCap` + AWS-Budgets helper, `compute:exec:*` vs build-scripts docs, plugin "host activity" tile, skip-teardown banner, marketplace moderation layer (separate spec).                                                                                                                                                                                                                                                                           | \~500              | Fast-follow once V1 has shipped to a vetted-publisher alpha and a real plugin author has used it.                                                  |
| **V1.1+**                        | cloudflare-pages-via-github mode, additional OAuth providers (Slack/Linear/Notion/Jira), per-tenant OAuth multi-tenancy.                                                                                                                                                                                                                                                                                                                                                                                                                                               | \~300 per provider | Demand-driven.                                                                                                                                     |
| **V2**                           | macOS Tauri-sidecar with restricted entitlements, layer-7 network-policy proxy with TLS interception, encrypted-at-rest token storage, per-cloud `budgetCap` helpers (GCP/Azure/Cloudflare), Windows sandboxing.                                                                                                                                                                                                                                                                                                                                                       | TBD                | Separate workstreams.                                                                                                                              |

V1 LOC honest total: **\~2,000–2,100 LOC** across substrate + UI. The
earlier "\~1,500 LOC" estimate was sloppy math; this version reflects
each subsystem's real footprint after rounds 3–6 added defensive
features (PG lock, smoke test, helper library, advisory checks).
Adopting `arctic` for OAuth (subject to supply-chain audit, see
[OAuth integration](./oauth-integration#library-decision-arctic-vs-roll-our-own))
trims \~150 LOC.

The V1 / V1.1 / V2 split is explicit per item in
[Open Questions](./open-questions).

### Snapshot tarball format change

V1 introduces an additive change to the snapshot tarball format:
per-plugin `.shape.json` companion files describing what was redacted.
Old snapshots (no `.shape.json`) fork cleanly under V1 — substrate
treats their fields as all-shareable for backward-compat. New snapshots
ship `.shape.json` companions; older substrates ignore them gracefully.
This is **additive**, but it's still a format change worth flagging.

## Why this is a good fit for snapshots specifically

A common alternative would be: "let plugins call `terraform apply` from inside
their action handlers." That doesn't work because:

* Action handlers run inside the DI sandbox with capability gates; they can't
  shell out to arbitrary binaries (only ones explicitly capability-granted via
  `compute:exec:<bin>`).
* Action handlers have no visible terminal pane in the UI — they return a
  result and a log slice, not a streaming xterm.
* Action handlers fire on every invocation; provisioning should fire once per
  harness lifecycle (setup at fork, teardown at uninstall, verify on boot).

The `provision.{setup,teardown,verify}` shape matches what infrastructure
genuinely is: a one-shot lifecycle event with a long-running, watch-able
execution. It also matches Homebrew's formula model, Tauri's window-trust
model, and `npm install` scripts (with the security mitigations the latter
*should* have had).

## Where to file feedback

Comments on individual sections of this plan should land in the harness's
`docs/` directory as separate `review-<topic>.md` files, or as inline
comments on the eventual PR. Once the plan is signed off, this directory
becomes the implementation reference.

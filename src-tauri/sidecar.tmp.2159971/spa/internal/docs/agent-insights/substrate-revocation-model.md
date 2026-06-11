# Substrate revocation — the trust model (read before touching admission)
URL: /internal/docs/agent-insights/substrate-revocation-model

How peer revocation works in the Model B substrate — self vs owner, the GitHub-anchored authority, the re-verify enforcement, and why it's fail-open.

import { Aside } from '@astrojs/starlight/components';

If you're about to change substrate admission/revocation, or a security review flags
something here as a "gap," read this first — several of these are **intentional** trust-model
decisions, not bugs.

## Two flavors of revocation (both enforced)

1. **Self-revocation** (`papercusp-substrate-revocation-v1-2026-06-01`). A contributor revokes
   their OWN device key (lost/rotated device). Mechanism: the device pubkey is added to that
   contributor's own `revoked_pubkeys` (a `TEXT[]` on `harness_shared.contributors`,
   replicated via the substrate). Trigger: `revokeSelfDevice` /
   `POST /api/admin/substrate/revoke-self-device` / the `substrate:revoke_self_device` MCP tool
   — guarded by `not_your_key` (you can only revoke keys in your OWN `device_attestations`).
   Enforcement: `boot.ts` seeds the admission `revoked` Set from `loadRevokedPubkeys` at startup
   (unconditional, fail-open) AND refreshes it inside every `mergeNow`.

2. **Owner-revocation** (`papercusp-substrate-revocation-v2-owner-2026-06-01`, Component A).
   Kicking out a different contributor (a bad actor). Authority is **GitHub**, not a
   papercusp-native owner: a repo admin **deletes the contributor's `user/<id>` branch** (the
   channel-2 artifact). Enforcement: `boot.ts` periodically **re-verifies admitted peers'
   channel-2** (throttled inside `mergeNow`, default \~15 min) and drops any whose binding
   conclusively `fail`s.

Model B verified a peer's channel-2 binding ONCE at admission and re-checked only PENDING
peers. An already-**admitted** peer was NEVER re-verified — so a deleted GitHub binding was
not noticed. If you see admission logic that only checks at admit-time, that gap is back.

## Why GitHub-anchored authority (not a papercusp owner gate)

Deliberate, consistent with `papercusp-trust-model-2026-05-31` + the **no-collaborator-gate**
decision + Phase-1b §8 / D-009: **GitHub is the real authority** for the thing that matters
(merging code); peer-synced state is **advisory**. An owner-signed revocation list was
considered and rejected — it reintroduces exactly the papercusp-side authority gate that
decision avoided, and the P-068 "owner" is only *provisional*/contestable. Re-verifying
channel-2 is **not** a collaborator gate; it re-applies the *same* check admission already
requires, just periodically.

## Intentional decisions a reviewer will want to "fix" (don't, without re-deciding the posture)

* **Fail-OPEN on a revocation/re-verify LOAD failure** (rev-v1 D-006, rev-v2 D-004). If the PG
  read or the GitHub API fails, admission continues WITHOUT the (new) revocation rather than
  evicting peers. Rationale: advisory substrate + GitHub-is-authority → a transient blip must
  not self-inflict a federation outage. It's **visible** (`merge_error`/`announce_error`
  events) and **self-healing** (re-checked next cycle). A channel-2-`fail` (conclusive) DOES
  drop; only transient (`pending`/api-down) keeps. Fail-secure (evict-on-failure) is the wrong
  trade here.
* **A channel-2-fail drop does NOT blocklist the pubkey.** A re-published binding is
  re-admitted by normal admission; a still-deleted binding is rejected (`binding_invalid`) —
  no flap. (Self-revocation DOES persist via `revoked_pubkeys` — that's the difference.)
* **Revocation is non-retroactive.** Ops a peer already merged remain (advisory; GitHub is
  authority). True cryptographic removal isn't a goal.

## Not built (intentional)

* **Rev-v2 Component B** — an in-app "delete a contributor's `user/<id>` branch via the GitHub
  API" trigger. It's a destructive outward-facing action + optional (a repo admin deletes the
  branch on GitHub directly; Component A enforces it). Held pending an explicit decision.
* **Un-revoke / re-instate** — YAGNI; revocation is append-only.
* **Multi-device per login** — see `phase1b-federation-limitations`.

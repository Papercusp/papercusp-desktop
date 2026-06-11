# Shared harnesses
URL: /internal/docs/security/shared-harnesses

The trust and security model for peer-to-peer shared harnesses — how identity, authorization, membership, and revocation work, what we borrow from other P2P systems, and the tradeoffs we accept intentionally.

import { Aside } from '@astrojs/starlight/components';

This page records the security model for **shared harnesses** (the peer-to-peer,
multi-engineer sync substrate), the research it rests on, and the tradeoffs we are
choosing **intentionally**. As of 2026-05-31 the substrate's trust layer is **not built** —
the model below is the agreed direction, tracked in the design memo
`apps/operator/docs/plans/papercusp-trust-model-2026-05-31.md`. Sections marked **Today**
describe the current (insecure) state; **Recommended** describes the target.

## What a shared harness is

A shared harness lets several engineers collaborate on one coding project. Shared state —
the **feature queue, pull-request status, the contributor list, and feature "claims"** —
syncs peer-to-peer over the Holepunch stack and is projected into each peer's local
Postgres:

* **Hyperswarm** — DHT peer discovery. The swarm **topic = `sha256("papercusp-substrate-v1:gh:<github_repository_id>")`**, derived from the *public* GitHub repo id, so it is **discoverable, not a secret**.
* **Hypercore** — one Ed25519-signed append-only log per device.
* **Autobase** — merges many device Hypercores into one materialized view (concurrent, eventually-consistent).

Identity is anchored to **GitHub**: each device holds an Ed25519 keypair in the OS
keychain, and a **two-channel binding** ties that pubkey to a GitHub login (an OAuth
`GET /user` re-check **plus** a GitHub-verified, device-signed commit/gist).

The single most important fact: **the authority for the one thing that truly matters —
merging code — is GitHub itself.** PRs merge through the GitHub REST API with a real user
token, so GitHub's write-access and branch-protection rules are enforced regardless of
anything that happens on the swarm.

## The trust problem

Replicated Autobase ops are **not signed, authenticated, or authorized on receipt** — the
only admission check is a schema-version filter. Because the swarm topic is derivable from
the public repo id, **any peer who can reach the DHT can join and write forged
feature/PR/contributor/claim rows into every other peer's local database.** The designed
defenses (per-op signatures, an `addWriter` admission step, a `revoked_pubkeys` drop-list,
gating on the two-channel binding) exist on paper but have **no production callers**.

Keep two threat models separate:

* **Untrustworthy local user** — every local API route is `auth: 'public'` (127.0.0.1
  only). It trusts whoever is on the desktop. Fine for a single-user desktop; not a
  shared-machine model.
* **Untrustworthy swarm peer** *(the serious one)* — public topic + unsigned ops means a
  peer can poison every other peer's local DB/UI. This is what the security layer exists to
  contain.

A code audit (2026-05-31) confirmed that **GitHub is the only authorization actually
enforced today.** Everything Papercusp layers on top — the feature state machine, the PR
"trusted authors" gate, the `completion_ref` "shipped ✓" verifier, contributor identity
signatures, and substrate op-auth — is currently dead code, unwired, or self-asserted.

## How other systems solve it

A three-pass survey of production P2P / local-first / decentralized systems. They converge
on a small primitive set: **sign every replicated write and verify it on receipt; gate
membership cryptographically; anchor identity to keys or an external authority; and accept
that true deletion is impossible in an append-only log.**

| System                              | Identity anchor                                                           | Per-op authorization                                                                                        | Membership / removal                                                                       | Verdict for Papercusp                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hypercore**                       | per-device Ed25519 key (our model)                                        | signed merkle tree per log (integrity, single-writer)                                                       | —                                                                                          | **Maps** — proves you authored *your* log, not that you're allowed                                                                                             |
| **Autobase**                        | —                                                                         | **none built in**; *"optimistic blocks should self-verify in the apply handler"*                            | `addWriter`/`removeWriter` are app calls inside `apply`                                    | **Maps / confirms the gap** — per-op verification is the app's job                                                                                             |
| **Hyperswarm / HyperDHT**           | connecting peer's Noise key                                               | Noise authenticates the *connection*, not ops                                                               | only `firewall(remotePublicKey)`                                                           | **Maps / confirms threat** — public topic; connection-auth ≠ op-auth                                                                                           |
| **blind-pairing** (Keet)            | invite secret                                                             | candidate signs with invite key; member verifies                                                            | admit-by-invite; app-evaluated `userData`                                                  | **Partial** — a ready admission handshake; put the GitHub proof in `userData`                                                                                  |
| **Radicle** *(closest analog)*      | self-sovereign `did:key` (opposite of ours)                               | **signs every write** (`refs/rad/sigref`); **rejects invalid before storing**; signed collaborative objects | delegate threshold/quorum                                                                  | **Mechanism maps, anchor doesn't** — proves the sign-and-verify-before-store pattern                                                                           |
| **Radicle COBs**                    | content-addressed                                                         | exposes each change's author → filter a bad author at view-build                                            | filter at materialization                                                                  | **Maps** — our `revoked_pubkeys` is this *local projection filter*, not network rejection                                                                      |
| **Kleppmann (BFT-CRDT)**            | —                                                                         | **signatures necessary but NOT sufficient** — a signed *equivocation* breaks version vectors                | a replicated ACL must itself be a BFT CRDT                                                 | **Decisive** — don't try to make advisory state Byzantine-trustworthy                                                                                          |
| **Keyhive / BeeKEM** (Ink & Switch) | **deliberately excludes** identity binding                                | capability chains + per-op Ed25519 sig; BeeKEM needs only **causal** order → fits Autobase                  | coordination-free removal with **real post-compromise security**                           | **Authz maps; complements (≠ replaces) the GitHub binding** — see [Keyhive](#does-keyhivebeekem-fit-our-stack)                                                 |
| **MLS / RFC 9420**                  | —                                                                         | TreeKEM epoch chain                                                                                         | needs **one linear chain of agreed Commits**; concurrent commits fork a DAG it can't merge | **Does not map** over Autobase's concurrent merge                                                                                                              |
| **Keybase** *(two-channel analog)*  | per-user signed **sigchain**; key↔GitHub via a GitHub-hosted signed proof | each link signed, `seqno` + `prev` hash                                                                     | revocation = a **signed revoke link**; sibkeys for device-loss recovery                    | **Maps — improves the binding**: model two-channel as a signed link; revoke-as-signed-statement beats a side-list                                              |
| **Sigstore / SLSA / in-toto**       | short-lived **OIDC** identity (Fulcio)                                    | keyless sig + **Rekor transparency log**; in-toto/DSSE                                                      | no revocation (short-lived certs); compromise caught by **monitoring**                     | **Partial — provenance pattern**: a signature proves *authenticated-at-a-time*, **not** authorization or "good." Confirms "shipped" must be **GitHub-derived** |
| **AT Proto `did:plc`**              | hybrid: self-cert keys + a directory                                      | signed repo commits                                                                                         | **rotation-key priority list + 72h recovery window**                                       | **Partial — recovery lesson**: for us, GitHub *is* the recovery anchor                                                                                         |
| **Nostr NIP-05**                    | pubkey ↔ `name@domain` via a `.well-known` file                           | per-event Schnorr sig                                                                                       | —                                                                                          | **Partial** — a GitHub-hosted well-known file is a lighter binding variant                                                                                     |
| **Secure Scuttlebutt**              | per-identity signed append-only feed (≈ Hypercore)                        | every message signed                                                                                        | **invite + follow-graph** bounds replication & Sybils                                      | **Partial — admission analog**: the GitHub collaborator graph is our follow-graph                                                                              |

### The decisive constraints

1. **Autobase will not authenticate ops for us** — per-op signing and `addWriter` gating
   are *our* code, in the `apply`/projection seam.
2. **Signatures are necessary but not sufficient** (Kleppmann) — a validly-admitted-then-
   malicious writer can sign false or *equivocating* rows. Full Byzantine resilience needs
   a hash-DAG causal layer we are **not** going to build.
3. **True removal / post-compromise security is impossible in an append-only multi-writer
   log** — a revoked writer's signed ops persist and replicate; "removal" means every
   honest peer drops them at projection time.
4. **A provenance signature proves authentication-at-a-time, not authorization or quality**
   (Sigstore) — so the trustworthy "shipped" signal must come from GitHub's *merge state*,
   not a self-reported receipt.
5. **GitHub already enforces the only hard authorization that matters.** This is the escape
   hatch from the unsolved Byzantine-CRDT access-control problem.

## Does Holepunch provide its own solution?

Mostly the **building blocks**, not a turnkey access-control product:

* **Hypercore** signs each log for free.
* **Autobase** gives a writer set with `addWriter`/`removeWriter`, but **you** write the
  per-op check and the admission policy in `apply`.
* **blind-pairing-core** (what Keet actually uses) is a real cryptographic invite/pairing
  handshake — admit-by-possession-of-invite-secret. This is Holepunch's native admission
  answer.
* **Hyperswarm** gives Noise-encrypted connections + a coarse `firewall(remotePublicKey)`
  reject hook.

What Holepunch deliberately leaves to the app: fine-grained capabilities (read/write/admin),
**identity binding** (always app-layer — our GitHub anchor), and **post-compromise security
on removal** (`removeWriter` stops new appends; it is not key-rotation/PCS). Of those, the
only one we actually need is identity binding — which no library provides.

**So the plan builds on Holepunch's native primitives**: per-op signature verification +
GitHub-anchored `addWriter` (via blind-pairing, GitHub proof in `userData`) + a
`revoked_pubkeys` projection drop-list.

## Does Keyhive/BeeKEM fit our stack?

Compatible *in principle*, but **not native and arguably overkill**:

* **It fits the ordering model** — BeeKEM needs only a *causal* order, which Autobase
  provides. It's the only post-compromise-secure option that works over a concurrent-merge
  log (MLS does not).
* **But it's an Automerge-ecosystem Rust library** (the `beekem` crate), not a Holepunch
  component. Adopting it means embedding that crate and running its control ops over
  Autobase — an unsupported combination, and it is **pre-alpha, unaudited, BeeKEM not
  formally proven**.
* **It couples authorization with *encryption*** (it's a continuous group key agreement).
  Our substrate data is plaintext to swarm members today; BeeKEM means encrypting group
  state with key rotation — a large shift that *buys* post-compromise security but is more
  than advisory data needs.
* **It still doesn't solve identity** — Keyhive defers human-identity binding to "a future
  layer above," i.e. our GitHub anchor regardless.

For the recommended model (advisory peer state re-derived from GitHub) we **do not need
Keyhive**. Holepunch's native primitives + the GitHub anchor are sufficient. Keyhive/BeeKEM
is a deferred upgrade **only if** a concrete requirement emerges for state that must be
*confidential to members and survive a key compromise without GitHub*.

## Recommended model — GitHub is the authority of record

1. **Authority of record = GitHub.** Every *decision-bearing* fact (did it merge, who has
   write access, real PR status, who is a contributor) is **re-derived from GitHub at the
   point of action** — never trusted from a peer.
2. **Peer-synced rows = advisory cache** (fast/offline UI), explicitly untrusted.
3. **Per-op Ed25519 signing + verify-on-receipt** in the Autobase `apply`/projection path —
   *defense-in-depth / UX integrity*, not the authority of record. **Sign sequence +
   freshness, not just content** (Radicle's 2026 replay-CVE lesson).
4. **GitHub-anchored writer admission** — `addWriter` gated on the two-channel binding
   (blind-pairing handshake, GitHub proof in `userData`) + `revoked_pubkeys` as an advisory
   projection-time drop-list.
5. **Identity binding = a Keybase-style signed link** — the GitHub-hosted device-signed
   proof is the cross-check that lets any peer detect a rewritten identity; revocation is a
   *signed* statement, not just a side list.
6. **Device-key rotation/recovery is GitHub-rooted** — losing a device means re-running the
   two-channel binding from the new device; the old key goes on `revoked_pubkeys`. GitHub
   (the account) plays `did:plc`'s "higher-authority key" recovery role.
7. **"Shipped"/provenance = GitHub-derived** — read merge state from GitHub; optionally
   record it as a signed in-toto-style attestation. Do **not** build a Rekor-style
   transparency log — GitHub already is the authority and stores attestations. (This also
   means the `completion_ref` "shipped" signal should be GitHub-derived, not a self-reported
   peer receipt.)
8. **Sybil/admission = the GitHub collaborator graph** as the allow-list (the SSB
   follow-graph analog) + the `firewall(remotePublicKey)` hook.
9. **Do not** adopt MLS or build a Byzantine-CRDT ACL.

### The advisory-vs-trusted boundary

The central decision: which synced surfaces are advisory vs must-re-derive-from-GitHub.

| Synced surface           | Advisory (peer-supplied cache)? | Decision-bearing → re-derive from GitHub?                           |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------- |
| Feature queue / status   | yes — display & coordination    | a "shipped" decision → GitHub merge state                           |
| PR status                | yes — display                   | merge / approval authority → GitHub                                 |
| Contributor list         | yes — display                   | "is X a real contributor / has write access" → GitHub collaborators |
| Feature claims           | yes — coordination/UX only      | (advisory by nature; no hard authority needed)                      |
| Completion / "shipped ✓" | no                              | **GitHub-derived only**                                             |

Anything in the right column must never be acted on from peer state alone.

## Accepted-insecurity tradeoffs

Under this model we **deliberately accept**:

1. **Public, discoverable topic** — swarm spam/DoS is *mitigated* (firewall + admission),
   not prevented.
2. **Advisory rows can be transiently forged** in local UI until per-op signing ships — and
   even after, an admitted-then-malicious writer can inject signed-but-false advisory rows
   (equivocation). Mitigation: nothing decision-bearing acts on it without GitHub
   re-derivation.
3. **No true removal / no post-compromise security** in the append-only log — revocation is
   best-effort projection filtering; the data persists and replicates.
4. **Sybil resistance is delegated to GitHub** — identity = GitHub account; only as strong
   as the two-channel binding + GitHub's account-creation friction.
5. **Per-op signatures don't defeat a signed equivocator** (Kleppmann) — accepted because
   state is advisory and GitHub-re-derived; we explicitly do not build a BFT-CRDT ACL.
6. **Identity binding inherits GitHub account integrity** — a compromised GitHub account is
   a compromised identity (the same trust root as the merge authority, so not a new
   exposure).
7. **Local API stays loopback-trusted** — a single-user-desktop model, not a shared machine.

## Phased implementation

* **Phase 1 — make peer state advisory + re-derive from GitHub.** Highest value, lowest
  risk; neutralizes the forgery surface for anything that matters. Resolves `completion_ref`
  as a GitHub-derived "shipped" signal.
* **Phase 2 — per-op Ed25519 signing + verify-on-receipt** in the `apply`/projection path
  (sign seq + content); drop unverifiable ops at projection.
* **Phase 3 — GitHub-anchored `addWriter` admission** (two-channel proof in blind-pairing
  `userData`) + `revoked_pubkeys` projection drop-list; model the binding as a signed link.
* **Phase 4 — only if a threat model demands real PCS** — Keyhive/BeeKEM membership.

## Sources & method

Three deep-research passes (web search → fetch primary sources → adversarial verification),
\~9M tokens. Passes 1–2 (50 claims verified): Holepunch repos, Radicle (Heartwood +
`radicle-cob` + LWN), ForgeFed, Kleppmann (PaPoC'22 + keynote), Ink & Switch Keyhive
notebook, RFC 9420/9750 + DMLS drafts. Pass 3 (Keybase, Sigstore/SLSA, `did:plc`, Nostr,
SSB): primary-sourced but the workflow's vote-tally step crashed, so those rows are
extracted-not-triple-verified; the two most decision-relevant (Sigstore threat model,
`did:plc` recovery) were re-confirmed by direct fetch. Full per-claim detail lives in the
design memo `apps/operator/docs/plans/papercusp-trust-model-2026-05-31.md`.

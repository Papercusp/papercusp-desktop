# Hive-scoped federation (re-key from harness → Hive identity)
URL: /internal/docs/agent-insights/hive-scoped-federation

How a shared project's substrate federates at HIVE scope, not harness scope — the Ed25519-pubkey topic re-key, per-Hive admission (revoked-pubkey union), Track A coord/presence, and Track B lock authority. Read before touching lib/hive-federation.ts, lib/authority/*, lib/sync/hyperbee/{boot,boot-all,wire-presence}.ts, or anything that resolves a swarm topic / lock authority. Includes the complete P-003 anchor inventory — every capture trigger, PEER_LOG_TAG_TO_TABLE tag, drain-routing site, and lib/authority scope-key. Plan — shared-hive-federation-2026-06-08.

import { Aside } from '@astrojs/starlight/components';

## One paragraph

Federation used to key on `harness_slug` (migs 144/150 — a pre-redesign
artifact). As of `shared-hive-federation-2026-06-08` the sharing boundary is
the **Hive** (the project = harnesses + plans + settings, identified by a stable
**Ed25519 keypair**), not the harness. A shared Hive federates its substrate over
**one topic derived from the Hive pubkey**; all of the Hive's harnesses join that
one topic, and `harness_slug` demotes to the **within-Hive component demux**. This
was a **re-key, not a rebuild** (D-003): the Model-B peer-log, projections,
Hyperswarm transport, and admission/revocation machinery are unchanged — only the
topic key + scope boundary moved. Cross-Hive (message-passing between sovereign
Hives) is deliberately **deferred** — see `phase1b-federation-limitations` and the
plan's cross-Hive design note.

**Hive** = a project (keypair-identified). **Swarm** = a deployment of a Hive to
one machine (local or cloud). **Colony** = the live agents on a Swarm. A Hive
federates across its **Swarms** — each Swarm is a peer.

## The load-bearing invariant

`harness_slug` is NOT the federation key anymore — it is the **component scope
inside** a Hive's single peer-log. The Hive pubkey is the key. Re-keying a
trigger or a projection back to `harness_slug` as the *top* unit re-breaks this
(see D-010: the migs-144/150 triggers were verified a **no-op** precisely because
`harness_slug` stays the capture/demux column while the *topic* routes content to
the Hive). When you add federated state, scope it to the Hive topic and keep
`harness_slug` as the demux — don't reintroduce harness-as-top-unit.

## Where the scope is resolved

* **`lib/hive-federation.ts`** — `resolveHiveSwarmBinding(ws, harnessSlug)` returns
  `{ kind:'hive', hive_pubkey }` when the harness belongs to a **shared** Hive,
  else `null` (caller falls back to the per-harness gh/local binding).
  `hiveHomeSlugForHarness(ws, harnessSlug)` answers "which Hive is this harness in"
  (itself if it's a `kind:'hive'` home, else its registry `hive_slug` member
  pointer) — shared by the topic re-key AND the admission/presence/authority seams.
* **Gate — only a *shared* Hive federates.** "Shared" = the owner published the
  Hive to the directory as `public`/`invite` (`getOwnedHiveMeta(...).visibility`).
  A `private`/un-published Hive stays local-only and never announces on the DHT, so
  the re-key is a **dormant, zero-risk path** for today's local hives (no privacy
  regression). The federation gate reuses directory visibility rather than minting a
  separate `federate` flag.

## Admission is per-Hive (P-006) — a UNION, fail-open

A contributor/device joins the **Hive once** and is thereby admitted to all its
member harnesses, instead of joining N harness swarms (D-004). The enforcement
seam is in **`lib/sync/hyperbee/boot.ts`** (`bootHarnessSubstrateInner`): the
revoked-pubkey set the harness boots with is the **UNION** of

* the harness-scope revocations (`loadRevokedPubkeys`, the base set), and
* the Hive-scope revocations (`loadRevokedHivePubkeys(ws, hiveHome)` from
  `lib/hive-membership-store.ts`) when `hiveHomeSlugForHarness` resolves a home —

so a contributor revoked at the **Hive grain is refused on EVERY member harness**.
The read-admission decider itself is unchanged. The hive lookup is **best-effort /
fail-open**: a failure leaves the harness-scope set intact (you stay no-worse-than
the pre-Hive behavior). Backing store: `hive_members` (mig 185) + the
`hive_members` federation projection (mig 189).

Membership **producers** (set `ProjectEntry.hive_slug`): `addHarnessToHive` /
`removeHarnessFromHive` (`agent-tools/hive/_add-member.ts`) for an existing
harness, and the `harness:create { hive }` create-time path
(`agent-tools/harness/create-hive-membership.ts`). Until something sets
`hive_slug`, a Hive has only its home and no members.

## Track A — coord content + presence

* **Content (messages / conversations / threads / work / plans / settings)** rides
  the **same peer-log P-004 re-keyed**, so it already federates Hive-scoped — no
  separate Track-A content work was needed (D-011). `hive_settings` federate as
  first-class Hive state via their own projection (mig 186).
* **Presence is the write-side keystone (P-008).** Presence is ephemeral /
  high-frequency, so it federates via an **announce loop**, not a capture trigger:
  **`lib/sync/hyperbee/wire-presence.ts`** (`wirePresenceAnnounceForHarness` →
  `startPresenceAnnounceLoop`), wired per-harness from `boot-all.ts` after the
  substrate handle returns, **gated on a joined swarm** (a private harness has no
  peers → returns `null`). Each announce is **stamped with the harness's home
  `hive_slug`** (resolved once via `hiveHomeSlugForHarness`) and projected into
  `shared_presence.hive_slug` (mig 187) — which is exactly what the Hive lock
  authority elects over.

## Track B — lock authority is the HIVE's (P-009)

File-claim / claim-lease mutual exclusion can't ride the eventually-consistent
peer-log (an exclusive through last-writer-wins split-brains), so contended
acquires serialize at a single **lock authority**. The authority is **not
elected** — it's a deterministic function of live presence:
`argmin(device_pubkey)` over fresh `shared_presence` rows (`lib/authority/lock-authority.ts`).

* `lockAuthorityFor(harnessSlug)` — harness scope (`WHERE harness_slug`).
* `lockAuthorityForHive(hiveSlug)` — Hive scope (`WHERE hive_slug`): **one authority
  across all of a Hive's Swarms**. Same `selectAuthorityFromRows` core; only the
  presence query differs.
* `routeToAuthority` / `routeToAuthorityForHive` — run local when we're the
  authority, RPC when a transport + `op.remote` exist, else **fail-open** (D-004:
  git-merge + merge-resolver is the data-safety backstop, so a distributed lock is
  an optimization, not a correctness requirement).
* `lib/authority/file-lock-routing.ts` — `routeFileLockOp(domain, op)` is the
  file-claim integration: it maps the lock's `coordination_domain` → harness →
  (if a Hive member) the Hive, and routes to the Hive authority. A
  **remote-peers-cache** fast-path makes the common single-box case a cached
  boolean, not a `shared_presence` query.

`locks:acquire` **and** `locks:release` now route their fast path through
`routeFileLockOp` (`agent-tools/locks/{acquire,release}.ts`). The boot binding —
the domain→harness→Hive resolvers (off the harness registry, sync snapshot) + the
authority-side store adapter (`adaptSuLockStore`) — is wired in
`agent-tools/locks/file-lock-authority-wiring.ts`; the authority op carries its
`coordinationDomain` on the wire so the elected authority serves the requester's
physical repo. **N=1 is a guaranteed passthrough**: with no remote peers the
remote-peers-cache short-circuits to `op.local()` (and an unmanaged domain resolves
to `null` → local), so the per-edit hot path is byte-identical to before; a fault in
the routing layer falls back to the raw local acquire (defensive). What is NOT yet
cross-machine-coherent (documented residual): the `wait` / `wake_on_grant` waiter
queue stays machine-local, and the genuine multi-machine serialization proof remains
the owner-gated 2-machine (Hetzner) run — single-box can only prove the passthrough.

## Why a no-op today, load-bearing tomorrow

The dev box runs one shared native PG, so every agent shares one `papercusp_su`
lock store and PG advisory locks already serialize — the Hive authority resolves
to `{ isSelf:true }` and routing is a direct local call. The **shipping product is
a desktop app backed by embedded-pg per machine** (see *Database topology* in the
repo CLAUDE.md): each machine then has its own lock store, so a file-claim on a
shared file genuinely needs the cross-machine authority. Correct in both worlds;
the cross-machine teeth grow in once presence federation populates remote Swarms'
`hive_slug` rows. Proven on real substrate: `two-instance-hive-authority.integration.test.ts`
(serialization across two Swarms via `routeToAuthorityForHive` + production
`routeFileLockOp`) and `hive-two-peer-federation.test.ts` (Track A content + Track
B presence federate A→B over the Hive topic on real Hyperswarm).

The *truly cross-machine* proof is layered (the plan's P-011): the substrate
holepunch + bidirectional merge is proven on REAL separate machines
(`packaged-two-instance-federation-merge`), and the Hive-federation logic is proven
at local parity here — but the combined "one Hive over two physical machines" run is
owner-gated paid infra, because **same-host holepunch does not complete at the raw
hyperswarm level for ANY topology** (`vm-federation-separate-machine-proof`), so it
genuinely needs two separate boxes.

## The re-key surface — full anchor inventory (P-003)

The complete enumeration behind the D-010 "the migs-144/150 triggers are a no-op"
invariant and the Track-B authority map above — every site that names the federation
scope. It is the *evidence* that the re-key was a topic move, not a trigger rewrite:
`harness_slug` is the **capture/demux column** everywhere, never the federation
domain. Verified against live `staging` 2026-06-08. (Origin:
`fleet-federation-reanchor-2026-06-06` P-003 — that plan is superseded by this one;
the inventory lives here because the surface it maps is live/shipped. Folded into the
plan's D-009.)

### 1 — Capture triggers (`libs/papercusp/libs/db/sql/`)

Exactly **two** functions INSERT into `substrate_outbox`: `capture_substrate_outbox()`
(`000-baseline.sql:10-53`, generic; keycol = `TG_ARGV[0]`) and its clone
`capture_hive_members_outbox()` (`189:27`, identical but reads `hive_home_slug` into
the slug column). Both write `substrate_outbox(workspace_id, harness_slug, table_name,
op, key, row, ts)` and `pg_notify('substrate_outbox', workspace_id||'::'||slug)` —
**one** NOTIFY channel. `substrate_outbox.harness_slug` is **NOT NULL** (`baseline:2524`),
so there is no operator-scope/NULL federation path by construction.

**Capture-ALL** (echo-guard only — no scope gate; `harness_slug` is always set on these
tables and rides as the demux tag):

| Table                           | keycol                      | trigger anchors                           |
| ------------------------------- | --------------------------- | ----------------------------------------- |
| `harness_features_consolidated` | `feature_id`                | baseline:5353/5357; re-stated 108/114/181 |
| `harness_issues_consolidated`   | `issue_id`                  | baseline:5355/5359; re-stated 108/114/181 |
| `contributor_usage_events`      | `event_id`                  | 108:22, 114:24/27                         |
| `harness_plans`                 | `plan_slug`                 | 125:34/39                                 |
| `plan_item_assignments`         | `fed_key` (`<plan>:<item>`) | 145:33/38                                 |

**WHEN-gated coord** (gate `harness_slug IS NOT NULL` → operator-scope rows stay local;
this is the load-bearing demux — do **not** widen it to a NULL/operator path; that was
the rejected `fleet-federation-reanchor` P-010 lean):

| Table                 | keycol        | WHEN gate                                                              | anchors        |
| --------------------- | ------------- | ---------------------------------------------------------------------- | -------------- |
| `coord_conversations` | `id`          | `scope='harness' AND harness_slug NOT NULL AND origin=local`           | 144:63/70/79   |
| `coord_threads`       | `thread_id`   | `harness_slug NOT NULL AND origin=local`                               | 149:73/79/85   |
| `coord_thread_posts`  | `post_msg_id` | + `post_msg_id NOT NULL`                                               | 149:96/103/110 |
| `coord_event_log`     | `msg_id`      | + `surface IN (messages,handoffs,escalations) AND notify_kind IS NULL` | 150:78/87/96   |

The partial fed-unique indexes carry the same `WHERE harness_slug IS NOT NULL` guard:
`coord_event_log_fed_uq` (150:71), `coord_threads_fed_uq` (149:62),
`coord_thread_posts_fed_uq` (149:66), `coord_conversations` (144).

**Hive** (already the Hive-scoped destination — writes the hive slug into the
`harness_slug` column): `hive_settings` (`setting_key`, 186:59/63), `hive_members`
(`github_user_id`, 189:73/77).

### 2 — Projection tags (`PEER_LOG_TAG_TO_TABLE`, `lib/harness-state/projection-engine.ts:28-59`)

18 tags → 14 tables; kept in lock-step with `register-all`'s
`REGISTERED_PROJECTION_TAGS` and the registry `sync:'peer-log'` set
(`checkPeerLogConsistency`). The map is content-shape — the Hive re-key does not touch
it (only the *topic* the drained ops ride changes):

`contributors`→contributors · `claims`→feature\_claims · `queue`→feature\_queue ·
`working-set`→feature\_working\_set · `features-by-id`→harness\_features\_consolidated ·
`plans-by-slug`→harness\_plans · `issues`→harness\_issues\_consolidated ·
`presence`→shared\_presence · `prs`→harness\_feature\_prs ·
`usage`→contributor\_usage\_events · `coord-conversations`→coord\_conversations ·
`coord-messages`→coord\_event\_log · `coord-threads`→coord\_threads ·
`coord-thread-posts`→coord\_thread\_posts · `item-assignments`→plan\_item\_assignments ·
`hive-settings-by-key`→hive\_settings · `hive-members`→hive\_members.

### 3 — Drain + boot routing (`lib/sync/hyperbee/`)

`outbox-drain.ts`: channel `NOTIFY_CHANNEL` (:54); the per-handle drain SELECTs
`WHERE workspace_id=… AND harness_slug=handle.harnessSlug` (:138-139) and matches the
NOTIFY payload `${ws}::${slug}` exactly (`wantPayload` :225, compared :266) — so a drain
is keyed to a concrete `(workspace, harness)`. Boot: `boot-all.ts` keys handles
`${ws}::${slug}` (:47), `getBootedHarness(ws, slug)` (:131); `boot.ts`
`BootedHarnessHandle.{workspaceId, harnessSlug}` (:159). The Hive re-key rides the topic
resolved at boot (`resolveHiveSwarmBinding`), **not** a change to these routing keys.

### 4 — `lib/authority/*` scope key

The scope-key parameter is named `harnessSlug` but is **polymorphic** — post-P-009 it
carries a hive slug too (`lock-authority.ts:426` — "the transport field is named
harnessSlug"). The harness path and its Hive twin coexist:

| File                       | harness-scope                                                                                   | Hive-scope twin                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lock-authority.ts`        | `lockAuthorityFor` :281, `routeToAuthority` :367, `queryPresenceRows`(harness\_slug) :131       | `lockAuthorityForHive`, `routeToAuthorityForHive` :411, `queryPresenceRowsForHive`(hive\_slug) :167 — shared core `selectAuthorityFromRows` :212 |
| `remote-peers-cache.ts`    | `hasRemotePeers` :43                                                                            | `hasRemoteHivePeers` :56 (key `hive:<slug>`)                                                                                                     |
| `file-lock-routing.ts`     | `DomainToHarnessSlug` :49                                                                       | `HarnessToHiveSlug` :53 → `routeFileLockOp` picks `{kind:hive\|harness}` :133-151                                                                |
| `authority-op-registry.ts` | `AuthorityOpEnvelope.harnessSlug` :27, `verifyIsAuthority` :66/85                               | same envelope; scope key carries either                                                                                                          |
| `hardened-authority.ts`    | `resolveHardenedAuthority(harnessSlug)` :83, fetch/load/save :52-55                             | generic — reused for hive                                                                                                                        |
| `peer-rpc-transport.ts`    | `PeerRpcRequest.harnessSlug` :28; `http-peer-rpc-transport.ts` serializes `{harnessSlug,…}` :91 | wire field carries the scope key                                                                                                                 |

**Both Track-B cutovers are now LANDED** (fed-reanchor P-060, 2026-06-08 — both single-box
no-ops by construction; cross-Swarm proof stays the owner-gated 2-machine run):

* **File-lock authority** — `locks:acquire` + `locks:release` route through `routeFileLockOp`
  (boot binding in `agent-tools/locks/file-lock-authority-wiring.ts`; the authority op carries
  its `coordinationDomain`). N=1 passthrough + defensive fallback. See the note above.
* **Work-item-claim lease** — the swarm router + `claim_next`/executor lease paths are fully
  wired (`register-claim-authority-ops.ts:27` installs `SwarmWorkItemClaimAuthority`); the
  owner ratified the switch by setting `PAPERCUSP_WORKITEM_CLAIM_LEASE=1` in the operator env
  (effective next restart). The CODE default stays off — that's the ratification-switch test's
  invariant + decentralized-dispatch-scaling's deterministic-test contract; env is the documented
  flip. On a single box it's a local lease (authority = self).

Legacy plan-item claims still append LWW-advisory to the own log
(`orchestrator/distributed-claim.ts`) — distinct seam, unchanged.

## Key files

| Concern                           | File                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| Hive identity (keypair → topic)   | `lib/identity/hive-keypair.ts`, `lib/sync/hyperbee/derive-swarm-topic.ts`          |
| Topic re-key / membership resolve | `lib/hive-federation.ts`                                                           |
| Per-Hive admission union          | `lib/sync/hyperbee/boot.ts`, `lib/hive-membership-store.ts`                        |
| Presence publisher (Track A)      | `lib/sync/hyperbee/wire-presence.ts`, `presence-announce.ts`                       |
| Lock authority (Track B)          | `lib/authority/lock-authority.ts`, `lib/authority/file-lock-routing.ts`            |
| Membership producers              | `agent-tools/hive/_add-member.ts`, `agent-tools/harness/create-hive-membership.ts` |

See also: `substrate-write-side-stack`, `workspace-id-pin-and-harness-membership`,
`phase1b-federation-limitations`, `vm-federation-separate-machine-proof` (why
cross-machine needs two physical boxes), `packaged-two-instance-federation-merge`
(the cross-machine substrate proof), and the plan `shared-hive-federation-2026-06-08`.

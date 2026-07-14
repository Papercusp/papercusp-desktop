# Knowledge Packs — default pot learnings, pot memory, Comb distribution
URL: /internal/docs/system/knowledge-packs

How a new pot inherits curated working wisdom, where it lives (the pot:<slug> memory pool), how packs are managed through the conflict review, and how the Comb distributes them behind operator approval.

# Knowledge Packs

> Plan of record: `learning-packs-2026-06-11` (shipped). Code anchors:
> `packages/operator-core/lib/knowledge-packs/`, `lib/memory/pot-scope.ts`,
> the `knowledge_packs:*` tool group, and the Cupboard worker migration 008.

A **knowledge pack** is a versioned, git-canonical set of *learnings* —
curated, project-transferable working wisdom. At pot creation the selected
pack is **copied** into the pot's own memory store; from then on the pot
owns every row — editable, deletable, growable — and every agent in every
member harness recalls it.

**Which pack seeds is a 3-level priority** (`pot:create`,
`_create.ts`): an explicit `knowledgePack` arg wins; else the blueprint's
declared `knowledge.pack`; else the global fallback
**`papercusp-default`** (32 learnings). So `papercusp-default` is *only*
the fallback — a pot whose blueprint declares a `knowledge.pack` seeds
that instead (see [Built-in packs](#built-in-packs-three-of-them)).

## The three load-bearing decisions

* **Copy, never live-link (D-001).** Seeded rows are ordinary mem0 rows in
  the `pot:<slug>` scope, provenance-tagged
  (`{source:'pack', pack_id, pack_version, pack_item_id}`). Injection,
  per-pot editing, uninstall, and upgrade-diff all ride existing machinery;
  a pot's store changes only by deliberate act.
* **Encode the discipline, parameterize the stack (D-002).** Pack content is
  *discovery rules* ("find how this project runs tests; use that framework"),
  never stack bindings ("use Vitest"). The Mug's first wake runs
  **convention discovery** and records the bindings as pot memories
  (`memory:remember { hive_slug }`); `applies_to` shape tags
  (`ui|service|library|cli|any`) filter what seeds.
* **Install is a merge review, never a silent union (D-003).** Installing a
  pack into a non-empty pool classifies every incoming learning into one of
  **four statuses** — `present` / `clean` / `duplicate` / `conflict`.
  `present` is the **provenance guard**: an item whose `{pack_id,
  pack_item_id}` already has a row is an unconditional no-op (skipped
  regardless of any resolution or embedding score) so a pack row is **never
  double-written** on re-install/upgrade. The other three are the
  same-pool semantic outcomes for items with no provenance row yet —
  `clean` installs; `duplicate` / `conflict` (mem0 dedup + the P-017
  conflict judge) require explicit per-item resolutions (keep existing ·
  take incoming · keep both). Defaults skip clashes: existing content
  outranks the incoming pack.

## Where things live

| Piece                  | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built-in packs         | `libs/papercusp/packages/harness/learnings/<pack-id>/` (manifest.yaml + one-learning-per-file md) — three ship: `papercusp-default`, `coding`, `work`                                                                                                                                                                                                                                                                                                                                                             |
| Comb-installed packs   | `~/.papercusp/knowledge-packs/<pack-id>/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A pot's live learnings | mem0 rows, scope `pot:<home-slug>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Pack mute state        | pot setting `knowledge-packs:disabled` (federated hive\_settings)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Seeding                | `pot:create` step 6b (flag `KNOWLEDGE_PACKS`, default ON; undo-stacked, best-effort)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Pre-turn injection     | `buildMemoryContextBlock` — pot pool resolved member→pot via the registry's `hive_slug`; token-budgeted (\~4k default, `PAPERCUSP_MEMORY_INJECT_BUDGET_CHARS`), priority user > harness > pot-organic > pot-pack; muted packs filtered                                                                                                                                                                                                                                                                            |
| Runtime recall scope   | `memory:search` default fan-out is **confined to the session's pot subtree** (P-018, `narrowHarnessSlugsToSessionHive`, `lib/memory/pot-scope.ts`). A pot-scoped agent never cross-recalls sibling pots' harness pools. Workspace-spanning sessions (`harness='*'`) and plain standalone harnesses are exempt — their fan-out is unchanged. Gated by `FLAGS.SCOPED_SUPERUSER_CLAMP`; fail-open (flag read error → full fan-out retained). `memory:list` is unaffected (it only adds explicitly-passed pot pools). |

## Built-in packs (three of them)

Three packs ship under the builtin root, each seeded by the blueprint-driven
priority above (D-010, `domain-generic-pot-architecture`):

| Pack                | Seeded for                                                                          | Shape                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `papercusp-default` | the global fallback (no blueprint `knowledge.pack`, no explicit arg) — 32 learnings | shape-conditional                                                                                |
| `coding`            | a coding pot (`extends: coding`)                                                    | shape-conditional items (`ui\|service\|library\|cli\|any`) — generic engineering discovery rules |
| `work`              | a work pot (`extends: work`)                                                        | fully `any` (repo-less) — coordination discipline + rubric-judged deliverables                   |

`coding` and `work` carry only generic *discovery rules*, never stack
bindings; project specifics belong in the per-pot override and a separate
project pack. Because a coding pot defaults to `coding` and a work pot to
`work`, `papercusp-default` is **not** seeded for those blueprints.

## Candidate-promotion loop (fleet → pack)

A recurring cross-scope friction signature (the recurrence-escalation
promotion noticing the same pain across ≥2 distinct scopes) is staged as a
`knowledge_pack_candidates` row — deduped structurally so a dismissed lesson
never re-nags, and capped (default 20 pending). The **owner** then adopts or
dismisses it (`knowledge_packs:decide_candidate`); adoption **materializes**
the item into the `fleet-lessons` pack under the installed-packs root and
bumps that pack's patch version — it **never** writes into a pot pool
directly. Pots pick the new item up only through the normal install/upgrade
conflict review (D-003) — so a candidate becomes recallable wisdom only after
two deliberate human acts. Surfaced in the Learnings view and via the
`knowledge_packs:candidates` + `knowledge_packs:decide_candidate` verbs
(self-improvement-consume-edges P-032).

## Surfaces

* **Creation:** both create flows carry the pack picker (default pack
  preselected, "none" allowed); the from-repo strip shows a real `seed` step;
  the success card links to the Learnings view.
* **Learning tab → Learnings:** per-pot view with pack badges
  (pristine/edited vs the pack), origin filter, inline edit/remove, pack
  management (install / mute / uninstall / upgrade) and the conflict-review
  cards. Backing reads: `learning.pot`, `learning.hiveList`,
  `knowledgePacks.list`.
* **Verbs:** `knowledge_packs:list / install / uninstall / set_enabled /
  upgrade / sweep / export / publish / candidates / decide_candidate` (ten).
  `sweep` re-judges the whole pool for contradictions that emerge after
  install; `upgrade` adopts a newer version's NEW items only — present rows
  are never auto-touched; `uninstall` is provenance-driven and **keeps edited
  rows by default** (only pristine pack rows — text still matching the pack's
  canonical render — are removed; `keepEdited: false` removes everything, and
  the returned `kept` list reports the edited rows preserved). The HTTP
  routes under `/api/knowledge-packs/*` do **not** map 1:1 to the verbs — they
  are `install`, `upgrade`, `uninstall`, `set-enabled`, `fetch-from-comb`,
  and `candidate-decide`; `list / sweep / export / publish / candidates` are
  MCP-only or reached through other paths.

## Comb distribution + the approval gate (D-007)

Listing kinds gained `knowledge-pack` (migration 008 added it as
`learning-pack`, renamed to `knowledge-pack` by migration 011; the runtime-less
code-tool pack, briefly named `tool-pack` by migration 008, was renamed back to
`pack` in the same release — both old wire values still parse as aliases).
**Instruction-carrying kinds — `knowledge-pack` and `blueprint` — publish
PENDING** and are publicly invisible until an allowlisted operator approves them
at `/admin/cupboard-moderation` (worker routes `/admin/pending` +
`/admin/listings/:id/review`). Submitters see their own pending listing and
any rejection reason. Code kinds (plugin/pack) keep install-time
capability consent + reactive moderation.

Install-from-Comb only **stages** a pack locally (clone → validate through
the pack parser → `~/.papercusp/knowledge-packs/`); it enters a pot solely
through the conflict review. Every learning is browsable on the listing
detail page *before* install. Publishing: `knowledge_packs:export` writes the
pack shape into a member repo (organic rows only by default), the project's
normal flow pushes it, `knowledge_packs:publish` creates the listing.

## Ops notes

* Worker migration `008_learning_pack_kind_review_status.sql` is a ONE-SHOT
  D1 rebuild (applied to production 2026-06-11; pre-008 rows grandfathered
  `approved`; the one retired `snapshot` row was removed — backup taken via
  `wrangler d1 export` first). Future rebuild migrations: **enumerate the
  live `listing_kind` values before writing the CHECK** — a forgotten legacy
  kind fails the whole batch.
* Tests live under the **Learnings** domain in the Tests tab
  (`testing-domains-registry.ts`).

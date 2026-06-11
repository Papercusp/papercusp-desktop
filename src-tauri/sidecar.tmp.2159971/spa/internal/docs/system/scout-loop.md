# The Scout loop — autonomous generative ideation
URL: /internal/docs/system/scout-loop

The Hive's generative-exploration engine — a directed, corpus-grounded ideation cycle that produces novel, bettable proposals and routes them into the existing rails. The "missing third mode" of self-improvement.

# The Scout loop

The **Scout loop** is the Hive's *generative-exploration* engine — the deliberate
creative **leap** (analogy, reframing, recombination, first-principles) that
produces broad-scope novel ideas. It is the "missing third mode" of
self-improvement: the idea queue (`improvements:capture`) is **reactive capture**
and the gym is **exploitative refinement**, but neither *generates* — neither can
surface "we should restructure X" because no single turn sees the cross-cutting
pattern.

Scout extends [self-learning-central](/internal/docs/system/) pillar 2 (the
generative source it gestured at but never built) and routes its output into the
**existing** rails rather than forking the loop. Source:
`packages/operator-core/lib/scout/`. Plan: `hive-creative-ideation-2026-06-08`.

> Named for the hive metaphor: **scout** bees explore for *new* nectar sources and
> waggle-dance the colony toward them, vs **forager** (gym) bees who exploit known
> sources.

## The cycle

A periodic, **prompt-free** pass — the corpus digest is the trigger, the lenses
are the divergence, the critics are the filter, and the **Queen** (not the owner)
is the autonomy gate:

```
corpus synthesis → divergent generation → adversarial critics
   → debate + recombine → routing → (Queen-triage cadence)
```

| Stage                       | What it does                                                                                                                                                                                                      | Module                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **1. Corpus synthesis**     | Roll up cross-corpus *meta-patterns* (recurring friction, time/token sinks, chronic deferrals, capability gaps) over the change feed + completions + reverts — the introspection the idea queue can't do (D-003). | `corpus-digest.ts` (`synthesizeStateOfHive`) + `corpus-digest-deps.ts` |
| **2. Divergent generation** | N ideators, each a *distinct* `CreativeLens` (analogical / first-principles / reframing / constraint-removal) with distant-domain priming — forced diversity, not one "be creative" prompt (D-004).               | `ideators.ts` (`runIdeators`) + `lenses.ts`                            |
| **3. Adversarial critics**  | A **novelty** critic (search-first vs the corpus — reject the already-tried) and a **feasibility** critic, in tension, plus a high-novelty/low-feasibility **moonshot bucket** so leaps survive (D-005).          | `critics.ts` (`critiqueIdeas`) + `critique-core.ts` (the pure spine)   |
| **4. Debate + recombine**   | Merge surviving critiques (A's mechanism + B's framing) into proposals, each carrying a **required, structured cheap experiment** — the anti-bullshit gate (D-006).                                               | `recombine.ts` (`recombineProposals`)                                  |
| **5. Routing**              | Dispatch each proposal into exactly one existing rail: broad → `plans:new` draft / testable → the gym / concrete → `improvements:capture` (D-007).                                                                | `router.ts` (`routeProposals`) + `router-deps.ts`                      |

## The contract chain

Each stage hands the next a typed value (`scout/types.ts` is the single source of
truth):

```
CorpusDigest → Idea[] → ScoredIdea[] → Proposal[] → RoutingDecision[] → RoutedIdeaProvenance[]
```

* **`Idea`** — `{ id, lens, title, body, mechanism, addressesPatternRefs }`. Grounded:
  `addressesPatternRefs` ⊆ the digest's refs (the bettable hook + the P-013 attribution key).
* **`ScoredIdea`** — an `Idea` + `{ novelty, feasibility, noveltyMatches, verdict, notes }`.
  `verdict` is `keep` | `moonshot` | `reject`.
* **`Proposal`** — a *fusion* of several ideas: `{ framing, mechanism, whyNew, bet,
  cheapExperiment: { hypothesis, method, falsifiableSignal }, sourceIdeaIds[], routeHint? }`.
  `cheapExperiment` is **required** and structured so "bettable" is machine-checkable.
* **`RoutingDecision`** — per proposal: `{ proposalId, sourceIdeaIds[], rail, routedRef, reason }`.
* **`RoutedIdeaProvenance`** — per *idea*: `{ ideaId, lens, rail, routedRef }` — the ledger
  rows P-013 reads back to weight winning lenses (D-009).

## Composition: `runScoutCycle`

`cycle.ts` exports the single entrypoint the cadence layer calls and the
verification lane drives:

```ts
runScoutCycle(deps: ScoutCycleDeps): Promise<ScoutCycleResult>
```

It is **pure orchestration over injected ports** — it imports only the shared
contracts (never a peer's step implementation), so it unit-tests with fakes (no
network, $0) and couples to no module. The ports — `readCorpus`,
`readNoveltyCorpus`, `ideate`, `critique`, `recombine`, `route` — are each bound
to a step module by `cycle-deps.ts` (`buildScoutCycleDeps`).

Three behaviours the composition owns:

* **No-human-prompt autonomy (D-010).** The only input is `deps` (an injected
  `ScoutLlmCall` + ports); there is no human-input parameter and no `askUser`. The
  cycle wraps the LLM call in a recorder so every step's call lands in
  `result.calls` — the single surface the "no human authored a prompt" invariant
  and cost accounting read from.
* **Survivors (D-005).** `keep` + `moonshot` proceed to recombine; `reject` is
  dropped (the moonshot bucket survives so leaps aren't over-pruned).
* **Per-cycle budget (D-010).** `limits.maxCostUsd` halts the cycle before the next
  LLM-spending step; `limits.maxIdeators` clamps the ideator roster.

`ScoutCycleResult` carries every stage (`digest`, `ideas`, `scored`, `survivors`,
`proposals`, `routed`, `provenance`, `calls`, `costUsd`, `stop`) so the invariants
suite can assert at each boundary.

### Provenance is the cycle's job

A `Proposal` *fuses* multiple source ideas, and the creative `lens` lives on the
`Idea` — not on the proposal, and not visible to the router. So the router
dispatches **once per proposal** (never per idea — that would double-dispatch a
fused proposal), and the **cycle** expands each routed decision into per-idea lens
provenance (`deriveProvenance`), supplying the `idea → lens` map only it holds.

## Production wiring: `buildScoutCycleDeps`

`cycle-deps.ts` assembles the concrete `ScoutCycleDeps`. Three deps are
irreducibly injected by the caller (a slug alone can't produce them in a pure lib):

* **`llmCall`** — the real meridian LLM client (the gym `JudgeLlmCall` pattern);
* **`createPlanDraft`** — the **ctx-bound** `plans:new` draft creator (plans:new needs
  operator ctx for the write-lock + revision + plan-event — the honest ctx seam);
* **`archive`** — the gym QD `ArchivePort` for the testable rail.

Everything else (the digest readers, the search-first novelty corpus over prior
plans + decisions, and the ideator/critic/recombine/route wiring) is assembled
there. The `system:scout-cycle` action calls
`buildScoutCycleDeps(...) → runScoutCycle(deps)`.

## Autonomy + the gym reframe

* **Queen-gated, prompt-free (D-002/D-010).** Scout *proposes* → the Queen *gates*
  → agents *build* → the owner gets a *report*. Broad-scope proposals route to
  draft plans (owner/Queen-visible, not auto-active); the Queen greenlights by
  promoting the draft. Cadence is **idle-capacity + friction-triggered** (a
  self-gating `shouldRunScoutCycle` gate, not a bare cron) — `cadence.ts` /
  `scheduler.ts` / `budget.ts`.
* **Gym quality-diversity (D-008).** In parallel, the gym gains a MAP-Elites
  **novelty/diversity archive** (best idea per niche across scope / domain / risk)
  and selects partly for *distance from the archive*, not fitness alone — so the
  evolutionary rail leaps too. Scout seeds the archive's distant niches; the
  archive feeds Scout stepping-stones. Source: `packages/operator-core/lib/gym/qd/`
  * `scout/gym-bridge.ts`.
* **Outcome feedback (D-009).** The routed-idea ledger
  (`harness_shared.scout_routed_ideas`) tracks which generated ideas panned out via
  the change feed → weights the lenses that win for this Hive. Source:
  `outcome-feedback.ts` / `routed-ledger.ts`.

## Testing

* **Invariants suite** (`scout-loop-invariants.test.ts` + `invariants.ts`, P-009):
  grounded (refs ⊆ digest), forced-diversity (distinct lenses, no collapse),
  non-duplicate (search-first vs the corpus), bettable (every proposal carries a
  non-empty structured experiment), no-human-prompt.
* **Full-cycle E2E** (`cycle-e2e.test.ts`, P-014): a full autonomous cycle yields
  ≥1 broad idea → plan draft + ≥1 testable idea → gym, with no human prompt —
  driving the real composition + real router with a fake `ScoutLlmCall` + fake
  dispatch ports (deterministic, $0).
* **Shared harness** (`test-support.ts`): `makeFakeScoutLlm` + grounded corpus
  fixtures, so every layer shares one fake instead of re-rolling.

## Honest limits

* LLM novelty is **recombinative, not de-novo** — but so is most human creativity
  (analogy + reframing), so this is a feature, not a ceiling.
* **Judging novelty is hard** — it is grounded against the actual corpus and the
  moonshot bucket keeps the critic from strangling the leaps.
* The dominant risk is **plausible-but-useless ideas** — the required
  cheap-falsifiable-experiment + the outcome feedback keep proposals bettable, not
  merely clever.

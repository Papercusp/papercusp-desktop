# Why a curator role
URL: /internal/docs/harness/decisions/curator

Without compaction, raw observations grow unboundedly — a dedicated role owns distilling them into bounded, auto-injected memory.

The curator is the harness's memory-compaction role: the one place where noisy
raw observations get distilled into the bounded, durable memory every other
role reads. It is the only role allowed to *delete* memory. Without it, the
append-only observation log grows linearly with iterations and no other role
has the bandwidth to read it.

The design predates the current engine (it was one of the original
bash-harness roles) and survived into the blueprint era nearly unchanged.

## When the curator fires

In the `coding` blueprint
(`libs/papercusp/packages/harness/blueprints/coding/blueprint.yaml`), the
curator sits at the end of the spine
(`scoper → architect → worker → validator → reviewer → documenter → curator`)
and runs in the finalize recipe on **both** terminal outcomes:
`onDone: [curator, postCuratorOutputs, documenter, archive]` and
`onEscalate: [curator]`. Same contract as the original design: terminal
events always get a curation pass.

## What the curator does (per its persona)

The persona (`libs/papercusp/packages/harness/prompts/curator.md`) is explicit
and ordered:

1. **Process pending issues first.** Validator findings land as pending
   issues; the curator triages them through the operator's merge endpoint
   (dedupe by code-pointer + title, attempt counters on duplicates,
   auto-close stale ones).
2. **Merge raw observations into `MEMORY.md`** — the full curated store at
   `.papercusp/memory/MEMORY.md`, organized under fixed headings,
   deduplicated, bounded at \~200 lines.
3. **Re-derive `summary.md`** — `.papercusp/memory/summary.md`, **hard-capped
   at 40 lines / \~800 tokens**, auto-injected into every future role's prompt
   (it rides the cacheable preamble — see
   [Why prompt-cache-dominant](/internal/docs/harness/decisions/prompt-cache)).
4. **Truncate `raw.md`** — `.papercusp/memory/raw.md` is the append-only
   one-liner log any role writes to; after curation only a short
   recent-history tail remains.
5. **Maintain per-role identity files** — `identity/<role>.md` carries lessons
   *across* missions (MEMORY.md is mission-scoped). The orchestrator mirrors
   these into Postgres (`harness_shared.identity_files`) via
   `POST /api/internal/identity-snapshot`, so the durable, queryable copy is
   the PG row; the curator authors by writing the file.

## Why compaction is a separate role

Other frameworks bundle memory maintenance into every agent. The result:
workers spend tokens deciding what's worth remembering, different workers
disagree about what matters, and mid-mission deletions churn shared state.
Splitting compaction into one role gives:

* **One place to review** the "what should we remember" prompt.
* **Atomic mutations** — the curator runs, and every subsequent spawn sees the
  new memory.
* **Auditable history** — `raw.md` is the working set; `MEMORY.md` is what the
  curator distilled from it.
* **Bounded growth** — the 40-line summary and \~200-line store mean the
  system can't ingest more than later spawns can afford to re-read.

Any role appends to `raw.md` without coordination; the curator decides where
an observation belongs (mission memory vs cross-mission identity). The worker
flags; the curator files.

## Where this stands today

Memory compaction is the curator's pipeline job, and curation has also grown
an operator-level read surface: the `curation:*` tools
(`packages/operator-core/lib/agent-tools/curation/` — `curation:feed`,
`curation:change-feed`, `curation:state-of-hive`) project completed work and
fleet-wide meta-patterns for supervising agents. The same instinct — distill
the noisy stream into a bounded, grounded digest — applied one level up.

Personal/cross-client semantic memory is a separate system (the `memory:*`
tools over the canonical PG store); the curator owns the *harness's* working
memory. See [Memory](/internal/docs/harness/memory) for the full layering.

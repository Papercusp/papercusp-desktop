# Why fresh contexts per role
URL: /internal/docs/harness/decisions/fresh-contexts

Every spawn is a fresh agent process that re-derives state from durable stores — drift-resistance over efficiency, with the prompt cache making it affordable.

Every role invocation in the harness pipeline is a **fresh agent process** with
no shared in-memory state. A spawn gets its prompt assembled from scratch
(`libs/papercusp/packages/orchestrator/src/prompt-build.ts` — fed to the agent
CLI via stdin for `claude`, via an `@file` argument for `omp`), does its job,
and exits. Nothing conversational carries over to the next spawn; durable state
lives in Postgres (work items, messages, plans, memory) and is re-read each
time.

This is a deliberate design decision carried over from the first harness
generation, and it has survived two engine rewrites (bash run-loop → TS
run-loop → the DBOS pipeline) unchanged.

## The case for shared context (what we don't do)

A long-running agent that maintains one conversation across iterations has
theoretical advantages: it remembers what it just tried, reuses intermediate
reasoning, and doesn't re-read the same files. In practice, every long-running
agent measured during the bash-harness era drifted — hour-1 instructions lose
weight against hour-3 code, and the agent starts agreeing with its own earlier
bad decisions because they're already in its context.

## The case for fresh contexts (what we do)

* **No drift.** Every invocation reads canonical state from the durable
  stores — there is no stale conversational residue to argue with.
* **Reproducibility & debuggability.** A spawn can be replayed with the exact
  prompt it saw; `buildPromptParts` exposes the assembled halves so tests can
  assert byte-stability (the prefix-hash assertion in
  `prompt-build.ts`).
* **Per-role specialization.** Each role gets a tightly-scoped persona
  (`libs/papercusp/packages/harness/prompts/<role>.md`) without dragging in
  another role's history.
* **Crash-safety.** A dead spawn loses nothing that matters: the work item,
  its comments, and the message inbox hold the state a successor needs.

## What replaces conversational memory

The bash era replaced "remember our conversation" with files on disk; the
current system replaces it with durable, queryable stores, re-injected into
each fresh prompt:

| Need                  | Carried by                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is the task?     | The work item + plan context, injected per-spawn                                                                                                                             |
| What happened before? | Feature history + the durable message inbox (`messages:*`)                                                                                                                   |
| Hard-won role lessons | Per-role identity files (`identity/<role>.md`) + curated memory (`memory/summary.md`), both in the prompt preamble — see [Curator](/internal/docs/harness/decisions/curator) |
| "Try again"           | A re-dispatch is simply a new fresh spawn with updated state                                                                                                                 |

## The cost question

A naive read of "fresh context" is "you pay full prompt tokens every spawn."
The Anthropic prompt cache changes the math — and the current prompt assembler
is explicitly structured for it: a **byte-stable cacheable preamble** (role
prompt → overrides → shared guides → identity → curated memory, ordered by
descending stability) followed by a **volatile tail** (live substrate context,
runtime context, brief) appended after the preamble so it never invalidates
it (`prompt-build.ts` header, "Cache discipline").

In the bash era this design measured a **99.94% cache hit rate** (180M
cache-read vs 106K fresh-input tokens over a 5-iteration mission) — the cost
of "fresh" was effectively zero. The numbers and the levers are on
[Why prompt-cache-dominant](/internal/docs/harness/decisions/prompt-cache).

## Tradeoffs we accept

* **No conversational repair.** A role can't say "you misunderstood, try
  again" to itself; correction arrives as new durable state (a validator
  verdict, a message, an updated work item) read by the next fresh spawn.
* **Cache-read fees.** Even cached, tokens aren't free — cheaper than
  fresh-input by an order of magnitude, but not zero.
* **Startup I/O.** Every spawn re-assembles its prompt and re-queries state.
  Negligible next to LLM latency.

## Where this stands today

The DBOS pipeline (`packages/operator-core/lib/dbos/`) spawns each pipeline
role as a one-shot agent process via the shared launch spec
(`packages/operator-core/lib/role-launch-spec.ts`); interactive role sessions
(`psu --role <role>`) ride the same spec. Long-lived *chat* surfaces (the
operator, oracle) are conversations by design — the fresh-context rule is
about the autonomous pipeline, where unattended drift is the failure mode.

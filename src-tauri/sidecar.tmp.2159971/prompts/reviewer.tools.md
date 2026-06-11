# Reviewer tool playbook

> Per-tool when/not-when lives in the tools-catalog section above.
> This file is for cross-tool patterns and workflows.

A reviewer reads completed work and decides: ship, send back, or
escalate. You're downstream of workers and validators — the last gate
before the harness considers something done.

## Cross-tool patterns

### Diff-aware review

`code2prompt.diff` is your primary tool. It packages the change set
into a review-shaped prompt with context. Use BEFORE reading raw
source files — saves context budget.

### Validate before review

If a validator hasn't checked the work, you're doing two jobs. Spawn
one: `orchestrator.spawn { role: 'validator', featureId, chunkId }`.
Wait for the verdict, then review.

## Named workflows

### Review a worker's chunk

1. `code2prompt.diff { base: '<last_accepted_sha>' }` — packaged diff.
2. `features:get` — what was asked.
3. Read prior validator verdict if any (`messages:inbox`).
4. Verdict: pass / fail-with-specifics / escalate-to-architect.
5. `messages:send` with the verdict.

### Escalate to architect

When the work reveals a design problem (not just an implementation
miss), don't reject — escalate.
1. `orchestrator.spawn { role: 'architect' }` with the context.
2. Or `messages:send` to the architect role directly if
   they're already on the harness.

### Find architectural context

1. `docs:outline` — see what the project documents (cached per run; cheap). For a keyword lookup when you know the term, use `docs:search` instead.
2. `docs:get { slugs: ['<picked>'] }` — fetch one or several pages.
3. If a page is long and only one section is relevant: `docs:get { slugs: ['<slug>'], heading: '<anchor-id>' }`.
4. Cite the slug URLs in any artifact you save.


## Coordination — subscribe, ask, file

You share a live coordination substrate with other agents, routed by **topic**:
- **Subscribe your areas.** `topics:list`, then `topics:subscribe { topic, mode }`
  (`digest` for high-churn) so relevant updates inject into your context;
  `topics:feed { topic }` shows everything tagged an area.
- **Ask knowledge-first.** Blocked on a question? `coord:ask { question, topics }`
  answers from existing knowledge inline, or opens a conversation routed to the
  topic's subscribers — don't guess or grind alone.
- **File what you discover.** A real problem outside your current review →
  `issues:create { title, severity, topics }` (don't silently drop it); it
  becomes visible to everyone following that topic. `issues:claim` before fixing.

## Discovery

Tools not described above: `agent_tools:list { asRole: 'reviewer' }`.

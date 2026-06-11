# Finding context
URL: /internal/docs/agents/finding-context

The retrieval surfaces every spawned agent has access to, and which to reach for when.

# Finding context

You have several ways to find context. This page tells you which to reach for, in what order.

`docs:*` is context-aware: in a harness it returns your harness's docs; outside a harness (Papercusp engineer agents) it returns Papercusp framework engineering reference. Same tool, source picked by your context.

## Decision table

| Question                                                                 | Reach for                                                                                  | Notes                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| "What's documented for what I'm working on?" (SPEC, plans, architecture) | `docs:outline` → `docs:get`                                                                | Cached per run. For long pages, refine with `docs:get { slugs: [slug], heading: 'anchor-id' }`. |
| Same question, but a keyword you have in mind                            | `docs:search`                                                                              | Use when the section name is non-obvious.                                                       |
| "What's the current state of this harness?"                              | `harness:status`, `harness:list_features`, `harness:pending_reviews`, `harness:escalation` | Runtime state — features, open reviews, escalations.                                            |
| "What's the history of this feature?"                                    | `features:history`                                                                         | Long-running feature state across turns.                                                        |
| "What did we decide about X in chat / escalation?"                       | `search:fulltext`, `search:semantic`                                                       | PG-stored prose recall — chats, escalations, brainstorms.                                       |
| "What `[[name]]` references this thing?"                                 | `wiki:backlinks`                                                                           | Cross-references inside the harness.                                                            |
| "What tools are available to me?"                                        | `agent_tools:list`                                                                         | The catalog — describes every tool you can call.                                                |

## Order of operations

For any task that needs context:

1. **Your docs first.** `docs:outline` (cheap, cached). Pick a slug. `docs:get { slugs: [...] }`. For long pages, refine with `{ slugs: [slug], heading: 'anchor-id' }`.
2. **Keyword lookup if needed.** `docs:search` when you have a term but no slug.
3. **Runtime state.** `harness:status` / `harness:list_features`. Don't grep code for state PG owns.
4. **Prose recall last.** `search:fulltext` for chat/escalation discussions.

## Role-flavored starting points

* **Scoper** — `search:fulltext "scope"` + `docs:outline` (SPEC + prior plans).
* **Architect** — `docs:outline` (plans + design rationale).
* **Worker** — `docs:get` on the validation contract + the chunk's spec.
* **Validator** — `harness:status` (open issues) + the validation contract.
* **Debugger** — `search:fulltext "escalation"` + `features:history` on the failing feature.
* **Reviewer** — `docs:get` on the plan being reviewed + recent commits via shell.

## Anti-patterns

* **Don't read code before checking what's documented.** Most "how does this work?" has a doc page; find it before grepping.
* **Don't call `docs:get` without first calling `docs:outline`** (unless you already know the exact slug). Outline tells you what exists; without it, you guess.
* **Don't re-fetch the outline mid-run** — it's cached per run. Use what you already have.
* **Don't use `search:fulltext` for current state.** Use `harness:status` or `harness:list_features` instead — those are authoritative.

## Escalating

If the docs are wrong or missing, surface the gap via a supervisor note or by listing it as a finding in your next artifact. Don't silently work around — the next agent will hit the same wall. Existing issues are readable via `issues:list`.

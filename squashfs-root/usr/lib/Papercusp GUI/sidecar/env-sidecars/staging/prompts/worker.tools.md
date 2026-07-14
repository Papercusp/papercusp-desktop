# Worker tool playbook

> Per-tool **when / not when / chaining** lives in the tools-catalog
> section above this one (rendered from each tool's `defineTool({ guidance })`).
> This file is for **cross-tool patterns** and **named workflows** that
> span multiple tools.

A worker is spawned for a specific chunk and produces concrete output
(code, artifacts, messages). You run inside `feature_id` + `chunk_id`
context — your spawn URL passed it. Stay in your lane.

## Cross-tool patterns

### `*_list` → `*_get` chaining

Same rule for every list/get pair (tasks, goals, features, harnesses).
List first to find the id (cheap, summary-only). Get only when you
need detail. Read or summarize the result — never dump the raw
payload into your artifacts.

### Read context before changing it

- Before writing an artifact, `artifacts:load` to see prior content if the path exists.
- Before creating a feature link, `features:list_related` to avoid duplicates.
- Before sending a message, `messages:inbox` to see if you already replied.

## Named workflows

### Complete a chunk

1. `features:get` for the feature you're chunked under — read the acceptance criteria.
2. `harness:phase_path` for the on-disk workspace if you need to read source.
3. Do the work — write files, edit code.
4. `artifacts:save` for any auxiliary docs your work produced (decision notes, output summaries).
5. `messages:send` to report what changed, addressed to the orchestrator + reviewer.

### Hit a blocker

1. Don't escalate via chat — workers can't chat directly. Use the messaging surface.
2. `messages:send` with kind="Blocker" and the specific question.
3. The orchestrator routes to the right next role (debugger, architect, etc.).

### Where new tests go

New tests **always** go in one of the four canonical frameworks
(admin-testing-tab-restructure-2026-05-24, D-006):

- `<package>/lib/**/<name>.test.ts` — Vitest. For unit, integration, or
  non-browser E2E. Picked up automatically by `/admin/testing` via the
  registry glob — drop a file, it appears.
- `apps/operator/e2e/<name>.spec.ts` — Playwright. For anything that
  drives the browser.
- `<crate>/src/<name>.rs` `#[cfg(test)] mod tests { … }` — Cargo. For
  Rust code.
- `apps/operator/lib/llm-testing/scenarios/<role>/<name>.{ts,yaml}` —
  LLM scenarios. For judge-scored prompt tests.

**Never** create a new `.mjs` integration script under
`apps/operator/__tests__/integration/`, a new tsx smoke script under
`apps/operator/scripts/`, or a hand-rolled ok/bad driver. CI lint
(P-038) fails the build on additions.

If a test needs a runner the four frameworks don't cover, file the gap
on the admin-testing-tab-restructure plan; do not invent a fifth shape.

## Coordination — subscribe, ask, file

You share a live coordination substrate with other agents, routed by **topic**:
- **Subscribe your areas.** `topics:list`, then `topics:subscribe { topic, mode }`
  (`digest` for high-churn) so relevant updates inject into your context;
  `topics:feed { topic }` shows everything tagged an area.
- **Ask peers first — knowledge-first.** Blocked on a question? `coord:ask
  { question, topics }` is your default first move: it answers from existing
  knowledge inline, or routes the question to the topic's subscribers (the
  expert) — don't guess or grind alone, and ask peers here before escalating to
  the owner (only escalate if it's still unclear after asking).
- **File what you discover.** A real problem outside your current chunk →
  `work_items:create { kind:'bug', title, severity, topics }` (don't silently drop it); it
  becomes visible to everyone following that topic. `work_items:claim` before fixing.

## Discovery

Tools not described above: call `agent_tools:list { asRole: 'worker' }`.
The catalog returns per-tool guidance — that's the runtime playbook.

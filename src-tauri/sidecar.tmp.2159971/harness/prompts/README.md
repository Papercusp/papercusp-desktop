# Autonomous Harness Prompts

Prompts for agents in coding harnesses (the existing top-level files) and department harnesses (the new `base/` + `department/` subtrees).

## Layout

```
prompts/
├── (top-level *.md = coding harness, untouched)
│   architect.md  curator.md  debugger.md  documenter.md
│   orchestrator.md  scoper.md  reviewer.md
│   ui-qa.md  validator.md  worker.md  crosscheck.md
│
├── staging/, testing/, production/  — coding phase variants (untouched)
│
├── base/                            — universal base prompts for all roles
│   orchestrator.md  worker.md  validator.md  documenter.md  summarizer.md
│
└── department/                      — department harness flavor
    orchestrator.md  worker.md  validator.md  documenter.md  summarizer.md
    └── departments/
        ├── business/    — orchestrator.md (override) + ceo.md (Directive mode)
        ├── technology/  — orchestrator.md (override)
        ├── rd/          — orchestrator.md (override)
        ├── management/  — orchestrator.md (override)
        └── marketing/   — orchestrator.md (override)
```

## Resolution function (implemented — `prompt-resolve.ts`)

The runtime implements a TWO-SECTION composition (audit P-019,
`resolvePromptFiles` in `packages/orchestrator/src/prompt-resolve.ts`):

```
resolve(role, ctx) =
  sections = []
  sections.push_if_exists("base/" + role + ".md")    # universal layer
  sections.push_if_exists(most_specific(role, ctx))   # resolvePromptFile():
    # blueprint > phase/departments/dept > phase > department(legacy) > top-level
  return sections.join("\n\n---\n\n")
```

`most_specific` stays PICK-FIRST across the kind/phase/dept candidates (it does
not concatenate intermediate layers) — the only concatenation is base + the
winning concrete prompt, joined by `prompt-build.ts` when handed `promptFiles`.
The original design sketched full multi-section concatenation for department
harnesses (base + kind + dept + mode); if a department prompt ever needs the
intermediate layers composed too, extend `resolvePromptFiles`, don't fork the
join logic.

## Triggering CEO mode

Business's orchestrator outputs `NEXT_WORKER_CEO_MODE <MESSAGE_ID>` when the message is a Directive. The runtime:
1. Loads the Directive
2. Resolves the prompt with `mode="ceo"` (which substitutes `business/ceo.md` for the worker layer)
3. Invokes the agent with the resolved prompt and `$MESSAGE_ID` set

For all other Business messages (Proposal, MarketSignal, etc.), the orchestrator outputs the standard `NEXT_WORKER <MESSAGE_ID>` and the worker runs the base department worker prompt.

## Inheritance precedence

Later sections override earlier ones (concatenation; the model treats final sections as most authoritative). Order:
1. `base/<role>.md`             — least specific
2. `<kind>/<role>.md`           — kind-specific
3. `<kind>/departments/<dept>/<role>.md` — dept-specific
4. mode-specific override        — most specific (e.g. ceo.md)

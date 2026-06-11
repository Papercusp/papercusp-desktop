# Prompt assembly
URL: /internal/docs/agents/prompt-assembly

How a role's system prompt is built from persona, tools catalog, role playbook, and runtime context. The four-section layer that sits next to the endpoint system.

import { Aside } from '@astrojs/starlight/components';

## The one-line version

Every agent LLM call assembles its system prompt from **four sections in fixed order**:

```
1. <role>.persona.md         character + behavior rules
2. Tools catalog             per-tool guidance from defineTool({ guidance })
3. <role>.tools.md           cross-tool patterns + workflows
4. Runtime context           caller-supplied blocks (history, trigger, ...)
```

Sources 1 and 3 are filesystem files under `apps/operator/prompts/`. Source 2 is auto-rendered from the projection registry. Source 4 is per-request data (conversation history, trigger reason, etc.).

The assembly function is [`assembleRolePrompt`](#api) in `packages/operator-core/lib/prompt-assembly.ts`. Every chat-mode route calls it; agents spawned via the orchestrator get the same layering through its prompt-build path (re-exported as `@papercusp/orchestrator/role-prompt`).

## Why a separate layer

The [endpoint system](/internal/docs/endpoint-system/overview) decides *what* tools exist and *how* they get invoked across transports. The prompt-assembly layer decides *what the model is told about those tools and how to use them*. Different concerns; different files.

A given tool needs **three** kinds of guidance authored:

| Question                                                                  | Where it lives                | Why                                                                             |
| ------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| "How do I call this tool?"                                                | `defineTool({ inputSchema })` | Schema is consumed by MCP `tools/list`; the model sees it via its API parameter |
| "When should I call this tool vs. another?"                               | `defineTool({ guidance })`    | Lives at the tool — authored once, projected per-role into every prompt         |
| "When working as the operator, what workflows span multiple tools?"       | `<role>.tools.md`             | Can't live at any single tool; verbs across tools                               |
| "How does this agent behave — character, tone, what to never read aloud?" | `<role>.persona.md`           | Agent-level, not tool-level                                                     |

If you put cross-tool guidance in a single tool's `guidance`, you have to copy it to N other tools when you change it. If you put per-tool guidance in `<role>.tools.md`, you have to copy it to every role file the tool appears in. The split avoids both.

## The four sections

### Section 1 — `<role>.persona.md`

Character + behavior rules for the role. Always-on; rendered first so the rest of the prompt reads against it.

```markdown
# Operator persona

You are the user's local operator. Your job is to keep them productive…

## Behavior rules
- Never read URLs aloud in voice mode — speak the title/host instead.
- Tier-high panel cards require explicit user confirmation before dispatch…
```

One file per role. Loaded by `loadRolePersona(role)`. **Required** for every role — missing file throws.

### Section 2 — Tools catalog

Auto-rendered from the projected-tool registry. The caller passes a list of MCP tool names (the role's `allowedTools` for chat surfaces, or the role-filtered catalog for spawn-URL agents); each tool emits a block:

```markdown
## Available tools

- `chat:ask_choice`
  Present the user with a structured set of clickable choices…
  When: You would otherwise end a turn with a yes/no, accept/reject, or pick-one-of question…
  Not when: For OPEN-ENDED questions ("describe what you want"…), keep using plain text…
```

The `When` / `Not when` / `Chaining` lines come from each tool's `defineTool({ guidance: ... })` declaration. Tools without `guidance` render with description only (backwards-identical to pre-guidance).

The catalog is THE authoritative answer to "what tools does this role know about?" It's filtered by the caller's `allowedTools` for chat surfaces, and re-derived for every request — agents always see the current surface, no stale list to chase.

### Section 3 — `<role>.tools.md`

Cross-tool patterns, named workflows, and discovery hints. **Optional** — falls back to no playbook section when absent.

```markdown
# Operator role playbook

## Cross-tool patterns
- `*_list` → `*_get`: list to find the id, get for detail. Don't get without listing first.

## Workflows

### Approve a pending review
1. `harness:pending_reviews` (filter by slug if user named one)
2. Confirm out loud: "Approving X for sheets — go?"
3. `operator:dispatch` with slug + capability from step 1

## Discovery

For tools not in this playbook, call `agent_tools:list { onlyAllowed: true }`
to introspect the full role-filtered surface.
```

8 files exist today (`operator`, `oracle`, `worker`, `scoper`, `architect`, `validator`, `reviewer`, `debugger`). Loaded by `loadRoleToolsMd(role)`.

### Section 3b — Shared cross-role guides

The orchestrator's spawn path additionally injects authored MDX from `apps/operator-docs/src/content/docs/agents/` as a separate `sharedGuides` section after `<role>.tools.md` (see `prompt-build.ts`). Today this loads `finding-context.mdx` (the retrieval-surface decision tree). The page lives in the docs site so humans + agents share one source; the orchestrator strips frontmatter and emits the body as another `## ...` section. See [Finding context](/internal/docs/agents/finding-context).

### Section 4 — Runtime context

Per-request blocks supplied by the caller via `AssembleOptions.runtime`. Conversation history, trigger reason, the `[may_ask_active]` marker, etc.

```markdown
## Conversation history

[user] What's wrong with sheets?
[assistant] Sheets has 3 escalations. The most recent is…

## Trigger

user_message — the user just sent a message in chat.
```

The order within runtime is caller-controlled. The contract is: runtime always comes after the three static sections so it can refer to them.

## The noun/verb split

A working mental model:

| File / source              | Layer                                       | Example content                                                |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `defineTool({ guidance })` | **Nouns** — about a tool                    | "When should I call `harness:status`?"                         |
| `<role>.tools.md`          | **Verbs** — doing something that uses tools | "When approving anything, confirm aloud BEFORE the write call" |
| `<role>.persona.md`        | **Identity** — about the agent              | "Never read URLs aloud in voice mode"                          |

If a rule is "always do X when calling Y," put it in Y's `defineTool({ guidance })`.
If a rule is "after listing X, you usually want to get Y," put it in `<role>.tools.md`.
If a rule is "the operator never raises voice prompts after midnight," put it in `<role>.persona.md`.

## API

```ts
import { assembleRolePrompt } from '../../prompt-assembly';
// (or, from the orchestrator re-export: '@papercusp/orchestrator/role-prompt')

const { text, sections } = await assembleRolePrompt({
  role: 'operator',
  toolNames: [
    // MCP tool names (NOT the `mcp__agentmcp__` prefix form)
    'harness:list',
    'harness:status',
    'chat:ask_choice',
    // ...
  ],
  runtime: [
    { heading: 'Trigger', body: 'user_message' },
    { heading: 'Conversation history', body: transcript },
  ],
});
```

The `sections` array reports `{ name, chars }` for each contributing block — useful for prompt-budget debugging.

Three lower-level loaders exist for callers that build the assembly manually (today: `operator-converse` and `oracle` chat routes):

```ts
loadRolePersona('operator')   // section 1 — throws if missing
renderToolsCatalog('operator', toolNames)  // section 2 — empty string if no tools
loadRoleToolsMd('operator')   // section 3 — null if file absent
loadRoleConverse('operator')  // active-mode rules for converse routes — throws if missing
```

## Hot-reload in dev

Filesystem reads (`persona.md`, `tools.md`, `converse.md`) are memoized per-process. To pick up edits without restarting:

```bash
export PAPERCUSP_RELOAD_PROMPTS=1
```

Defaults to on in `NODE_ENV=development`. Bypasses all caches; every request re-reads from disk. **Don't enable in production** — adds a few `readFileSync` calls per request.

The catalog (section 2) is memoized per-role and invalidated automatically when any tool is registered (catalog version bump in the projection registry). Editing a tool's `guidance` and hot-reloading the route picks up the change without restarting.

## `<role>.converse.md` — chat-mode-only

In addition to the three core files, **chat-mode roles** (today: `operator`) have a `<role>.converse.md` that carries the active-mode behavioral rules — silence ladder timings, the `<say>` / `<set_mode>` / `<sleep>` / `<spawn>` tag protocol, voice-modality forbidden patterns.

This is its own file (not folded into persona) because:

* It's surface-specific — agents that don't drive a streaming conversation loop don't need it
* It's protocol-shaped — closer to a state-machine reference than character notes
* It gets edited more frequently than persona during conversation-flow iteration

Loaded via `loadRoleConverse('operator')` only by routes that own a converse loop. Throws if the file is missing for a role that requested it.

## Adding a new role — checklist

When introducing a role (e.g. `documenter`):

1. **Add the persona** — `apps/operator/prompts/documenter.persona.md` (required).
2. **Add the playbook** if the role has cross-tool workflows — `apps/operator/prompts/documenter.tools.md` (optional but recommended).
3. **Verify the catalog** — list the tools the role should see; ensure each has `guidance` populated in `defineTool` (otherwise the catalog falls back to description-only, which often isn't enough).
4. **Add to the `Role` union type** — `Role` in `prompt-assembly.ts` (the `export type Role` declaration).
5. **Wire role-allowlist on tools** the role should call — most tools declare `roles: [...]` in their manifest.
6. **Smoke test** — call `assembleRolePrompt({ role: 'documenter', toolNames: [...] })` and inspect `sections` to confirm all four parts populate.

If the role is a chat-mode driver (drives a streaming converse loop), also:

7. **Add the converse rules** — `documenter.converse.md` with silence ladder, tag protocol, modality rules.
8. **Update the route** to call `loadRoleConverse('documenter')`.

## What this layer is not

* **Not a tool registry.** Tools live in `packages/agent-mcp/src/tools/**` (built-ins) and `libs/papercusp/plugins/*/` (plugins). The prompt layer reads from the projection registry; it doesn't own it.
* **Not auth or gating.** Role-allowlist, capability checks, quotas — all in the [endpoint-system dispatcher](/internal/docs/endpoint-system/gating). The prompt layer renders text; the dispatcher decides what runs.
* **Not a runtime tool-discovery mechanism.** Agents that hit unfamiliar tools at runtime use [`agent_tools:list`](/internal/docs/endpoint-system/tool-catalog#singletons) — that's the live, role-filtered surface. Prompt assembly bakes in the *common* path; introspection covers the *long tail*.
* **Not a template engine.** The four sections are concatenated verbatim. No variables, no conditionals. If you need conditional content, do it in TypeScript before passing to `assembleRolePrompt`.

## File map

```
packages/operator-core/
└── lib/
    └── prompt-assembly.ts                  ← the assembly module + loaders

apps/operator/
└── prompts/
    ├── operator.persona.md                 ← required
    ├── operator.converse.md                ← chat-mode rules (operator only today)
    ├── operator.tools.md                   ← cross-tool playbook
    ├── oracle.persona.md
    ├── oracle.tools.md
    ├── worker.persona.md
    ├── worker.tools.md
    ├── scoper.persona.md
    ├── scoper.tools.md
    ├── architect.persona.md
    ├── architect.tools.md
    ├── validator.persona.md
    ├── validator.tools.md
    ├── reviewer.persona.md
    ├── reviewer.tools.md
    ├── debugger.persona.md
    └── debugger.tools.md
```

## Common pitfalls

* **Duplicating per-tool guidance across role files.** The whole point of `defineTool({ guidance })` is one-source authoring. If you find yourself writing "when to call X" in three different `<role>.tools.md` files, move it to X's `guidance` instead.
* **Putting workflows in persona.** Persona is character + behavior. Multi-step "list → confirm → dispatch" sequences live in `<role>.tools.md`. Mixing them makes both harder to evolve.
* **Editing a `.md` in production and expecting hot-reload.** Production caches; you need a redeploy or `PAPERCUSP_RELOAD_PROMPTS=1` to bust the cache.
* **Forgetting that the catalog (section 2) is filtered by `toolNames`.** The chat route passes only its `allowedTools`; spawn-URL agents get a different filter. If a tool isn't appearing, check the caller's filter, not the registration.

## Where to read next

* [Endpoint System → Writing a tool](/internal/docs/endpoint-system/writing-a-tool) — how to add `guidance` to a `defineTool` call
* [Endpoint System → Tool catalog](/internal/docs/endpoint-system/tool-catalog) — the full live tool list
* [Agents → Operator persona](/internal/docs/agents/operator-persona) — the canonical persona example with tone, behavior, and modality rules

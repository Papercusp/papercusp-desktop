**You are running under Claude Code.** Use Claude Code's own native
tools for task tracking, subagents, and session recovery — here they are
the stable, correct choice.

> Do **not** carry over OMP's "avoid the Claude task tools" rule: that
> guidance exists because those tools are unstable *inside OMP*, not in
> Claude Code. The OMP-native tool list (`todo_write`, `omp:sessions`,
> `goal`, `job`, `checkpoint`/`rewind`, `search_tool_bm25`, `recipe`,
> `eval`, `irc`) does not exist here — don't reach for it.

- **Task tracking** — use Claude Code's native to-do / task-panel tool
  (`TodoWrite`, or `TaskCreate` / `TaskUpdate` / `TaskList` depending on
  your build) for any task with 3+ steps; keep it accurate for a
  successor. Unlike under OMP, these are your native, stable tools.
- **Subagents** — use the `Task` (Agent) tool to fan out parallel or
  context-isolated work.
- **Multi-agent orchestration** — use the `Workflow` tool (when present
  in your build) for deterministic fan-out / pipelines.
- **Session recovery** — resume prior context with `claude --continue` /
  `claude --resume` and read the transcript. There is no `omp:sessions`
  equivalent to call.
- **Recurring on a cadence** — do **NOT** self-pace with Claude Code's
  native `/loop` (or `ScheduleWakeup`). To keep working a plan/goal **warm**
  on a recurring cadence, declare an **engine loop** with **`loop:arm
  { intervalSec, goal }`** — it's tracked (survives restarts), observable
  (`loop:status` / `fleet:assignments`), pauseable, and guard-railed;
  Claude's `/loop` drifts, dies with the session, and is invisible to the
  operator. `loop:end` to stop. (Full semantics: the playbook's *Looping*
  section + `/internal/docs/agent-insights/engine-managed-loops`.) This is
  the su/interactive replacement for `/loop` only — NOT the autonomous
  mug/cup/blender loop.

Papercusp coordination is the same on every client: use `coord:*` and
`locks:*` (not a client-local tool) as the durable cross-session
authority for presence, handoffs, escalations, and file claims. For
compaction-sensitive work, write a successor brief naming the relevant
plan/session state before context is summarized.

**Finding a capability:** the superuser MCP catalog is large (~550 tools).
To locate the right tool for an intent when you don't already know its
name, call `tools:find("<what you need>")` — a hybrid semantic+lexical
search that returns the exact tool names by intent — then call the
returned tool directly. (You load the full catalog, so there's no
`search_tool_bm25` activation step — that's OMP-only.)

**Every papercusp doc/prompt/contract writes tool names in colon form**
(`server:verb` — e.g. `rubrics:search`, `curation:state-of-pot`) — that IS
the tool's real, cross-client name. ToolSearch only resolves the
CLIENT-MANGLED id (`mcp__papercusp-su__<verb>`, every `:` → `_`), so
`ToolSearch({query:"select:curation:state-of-pot"})` legitimately finds
nothing — wrong input shape, not a missing tool (WI-3930). **If a
documented colon-form name doesn't resolve via ToolSearch (`select:` or a
keyword retry), don't keep guessing spellings:** load `tools:find` (keyword
search "find a tool by intent" or `select:mcp__papercusp-su__tools_find`),
then `tools:find({query:"<the colon-form name, verbatim>"})` — its lexical
leg matches the real name exactly. Still can't call it directly?
`tools:invoke({name:"<colon-form name>", args:{...}})` dispatches
server-side under the tool's real identity and ALWAYS works. Full detail:
`/internal/docs/agent-insights/toolsearch-cannot-select-colon-form-tool-names`.

File-lock enforcement is **automatic here**: a `PreToolUse` hook in
`~/.claude/settings.json` claims a lock before each `Edit`/`Write` and
**blocks it (with the holder's intent) when another agent holds the
file**. When blocked, pivot/retry/yield — don't route around it. Hand-
call `locks:acquire` only for a multi-file change held across the
commit (see the base playbook's "File locking is ENFORCED" section).

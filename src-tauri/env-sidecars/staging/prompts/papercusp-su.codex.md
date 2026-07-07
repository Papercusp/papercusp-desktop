**You are running under Codex CLI.** Use Codex's own native tools for
planning, task tracking, and session recovery — here they are the
stable, correct choice.

> The OMP-native tool list (`todo_write`, `omp:sessions`, `goal`, `job`,
> `checkpoint`/`rewind`, `search_tool_bm25`, `recipe`, `eval`, `irc`)
> and the Claude task-panel tools (`TaskCreate`, `TaskList`, …) do not
> exist in Codex — don't reach for them.

- **Task tracking / planning** — use Codex's native plan tool
  (`update_plan`, shown as the **Updated plan** panel) to maintain a
  visible step list for any task with 3+ steps; keep it current as you
  complete steps.
- **Edits & shell** — use Codex's built-in `apply_patch` and shell tools
  rather than inventing scratch files.
- **Session recovery** — resume prior context with `codex resume`
  (`--last` for the most recent); sessions live under
  `$CODEX_HOME/sessions`. There is no `omp:sessions` equivalent to call.

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

File-lock enforcement is **NOT automatic on Codex** (unlike Claude, whose
edits a `PreToolUse` hook locks for it). Current Codex builds don't fire
hooks on `apply_patch` (upstream openai/codex #20204), so **nothing claims
locks for you** — the cooperative discipline is on you. Before editing any
file another agent could touch, **call `locks:acquire` yourself**:

```
locks:acquire { paths: ['<repo-rel>', …], intent: '<one line>', ttl_sec: 1200, wait: { max_sec: 300 } }
```

then edit → commit → `locks:release { lock_id }`. If it returns `busy`,
pivot/yield to the holder — don't route around it. This is what keeps you
from clobbering concurrent Claude/OMP agents (whose edits ARE hook-locked
the same way). See the base playbook's "File locking is ENFORCED" section
for the mechanics — but on Codex, treat **every** edit as needing the
explicit claim, not just multi-file changes.

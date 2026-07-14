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

<!-- PAPERCUSP-CODEX:LOCK-GUIDANCE-START -->
Codex file-lock policy is resolved from runtime evidence, never from a static
assumption. The generated **Codex Lock Enforcement Status** section at the end
of this prompt carries exactly one effective `lockMode` plus hook health.
`coord:orient.codexLocks` is the live authority after launch and supersedes the
launch snapshot when its generation changes. Follow that one instruction; do
not combine the automatic and manual paths.
<!-- PAPERCUSP-CODEX:LOCK-GUIDANCE-END -->

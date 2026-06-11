# psu — the engineer-collaborator launcher
URL: /internal/docs/agent-spawning/terminal-wrappers

psu is the single launcher for engineer-collaborator (su) + role sessions; it assembles the playbook + MCP + flags per-launch and execs the raw CLI.

`psu` is the **one** command for launching a CLI agent in
**engineer-collaborator mode** (the full `papercusp-su` tool catalog +
playbook) or as an interactive **pipeline role**. It picks an agent +
workspace + harness + plan, records a tracked `/adv` session, then execs
the **raw** agent CLI with everything assembled per-launch.

:::note\[The `*-su` wrappers are retired]
There used to be three install-baked shell wrappers (`omp-su` / `claude-su`
/ `codex-su`) that exec'd each CLI with the playbook + MCP + skip-perms
baked in. They're gone. A launch is always: compose the system prompt →
resolve cwd → mint the MCP config → record the session → exec the raw CLI.
`su` is not a different mechanism — it's [`buildLaunchSpec`](#how-a-launch-is-assembled)
at the **superuser tier** (prompt = playbook, scope = `?superuser=1`),
the same builder a pipeline role uses with two parameters changed (D-001).
:::

Plain `omp` / `claude` / `codex` stay vanilla — engineer mode is opt-in,
and you opt in by launching through `psu`.

## Quick start

```bash
psu          # interactive: pick agent → workspace → harness → plan (or "NO PLAN")
```

Harnesses are **workspace-scoped**, so the picker asks for the workspace
before the harness. With a single workspace it's chosen automatically.

### Preselecting with flags

Preselect any of agent / workspace / harness / plan; the picker prompts
only for what you omit:

```bash
psu --agent=claude                                # pick workspace/harness/plan
psu --agent=omp --workspace=my-ws                 # pick harness/plan
psu --agent=codex --harness=papercup --no-plan    # everything preset → no prompts
```

### Scripting escape

```bash
psu --no-picker --agent=claude --harness=papercup --plan=my-plan-slug
psu --no-picker --agent=omp --workspace=my-ws --harness=papercup --no-plan
psu --no-picker --agent=codex --no-plan           # active workspace root, no harness
```

`--agent` is required (`claude` | `omp` | `codex`); `--workspace` defaults
to the active workspace; `--harness` defaults to the workspace root if
omitted; pass `--no-plan` for an ad-hoc session or `--plan=<slug>` to bind one.

## How a launch is assembled

`psu` calls `POST /api/agent-mcp/console/bootstrap-su`, which builds the
launch spec via `buildLaunchSpec({ kind: 'su' })` — the playbook (rendered
fresh from `prompts/papercusp-su-<profile>.tools.md` + the per-agent
overlay, so it can't drift from the installed copy) plus a per-launch
scope/plan addendum — records the `adv_sessions` row, mints a per-session
`PAPERCUSP_SID`, and returns the prompt file + raw backend. `psu` then execs
the raw CLI. What each agent needs differs:

| Agent    | Prompt                                                                                                              | MCP (`papercusp-su`)                                                                               | Lock enforcement                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `claude` | `--append-system-prompt-file <playbook+ctx>` `--dangerously-skip-permissions` `--permission-mode bypassPermissions` | **user-level** in `~/.claude.json` (survives a raw launch; its url env-expands `${PAPERCUSP_SID}`) | **user-level** `Pre/PostToolUse` hooks in `~/.claude/settings.json` — automatic |
| `omp`    | `--approval-mode yolo --append-system-prompt <playbook+ctx>` `-e ~/.papercusp/papercusp-coord.ts`                   | **user-level** in `~/.omp/agent/mcp.json`                                                          | `coord-hook.ts` loaded per-launch via `-e`                                      |
| `codex`  | per-session `CODEX_HOME` (`AGENTS.md` = playbook, `config.toml` = superuser MCP)                                    | in that `CODEX_HOME`'s `config.toml` (`http_headers` bearer)                                       | **soft** — see below                                                            |

`PAPERCUSP_SID` is minted per launch and exported, so each session is a
distinct coord/lock owner (two concurrent `psu` sessions don't collide).

### codex: a per-session CODEX\_HOME, and soft locks

Codex has no `--append-system-prompt`/`--mcp-config` flags, so each `psu`
codex launch mints a fresh `CODEX_HOME` under
`~/.papercusp/su-codex-homes/session-<id>/`:

* `AGENTS.md` — the engineer playbook (codex's instruction file)
* `config.toml` — the superuser MCP, with the bearer baked as
  `http_headers = { Authorization = "Bearer …" }`. (Codex 0.135's
  `bearer_token_env_var` does **not** deliver a valid bearer for a
  streamable-http server — verified — so the token is baked into the 0600
  ephemeral home, like claude's `~/.claude.json` header.)
* `hooks.json` — the SU-locks Pre/PostToolUse hooks. **Currently inert:**
  codex does not fire `PreToolUse` on `apply_patch`/`Bash` edits in 0.135
  / 0.136-alpha (upstream [openai/codex#20204](https://github.com/openai/codex/issues/20204)).
  The config is correct + activates the day codex fixes hook emission.
* `auth.json` — a **symlink** to `~/.codex/auth.json` (shared ChatGPT login).

Because the hook is inert, **codex coordination is soft**: its playbook
instructs it to call `locks:acquire` itself before every edit. claude and
omp get **hard** enforcement (their hooks fire); codex relies on playbook
discipline until the upstream fix lands. Plain `codex` (`CODEX_HOME=~/.codex`)
is fully vanilla.

## Resuming

```bash
psu --resume            # picker: list recent tracked sessions, resume one
psu --resume=<id>       # or: psu --resume <id>  (direct, skip the picker)
```

`psu --resume` reads your recent tracked sessions, `cd`s to each one's
recorded cwd, and execs the **raw** CLI's resume command there — no wrapper:

* `claude --continue` (re-attaches the most recent conversation in the cwd)
* `omp -r <thread>` / `-c`, re-adding `-e <coord>` (loaded per-invocation)
* `codex … resume --last` with `CODEX_HOME` set to that session's home
  (derived from its id — the home still holds the session history)

A fresh `PAPERCUSP_SID` is minted for the resumed process. MCP + claude lock
hooks are user-level, so they survive the raw resume. You can also resume
directly (`claude --continue` from the launch dir) or from the `/adv`
Sessions tab, which knows the cwd.

### Resuming a session psu didn't start

`psu --resume=<id>` also resumes a **raw** session (one you started with plain
`claude`/`codex`/`omp`, not tracked in `/adv`). It doesn't crawl the disk — when
the id isn't a tracked session it searches each agent's **own** session store
(`~/.claude/projects/*/<id>.jsonl`, `~/.codex/sessions/**/rollout-*-<id>.jsonl`)
for that exact id, reads the **cwd recorded in the session file**, `cd`s there,
and resumes by id (`claude --resume <id>` / `codex resume <uuid>`). A non-UUID
id is treated as an omp thread name (resumed in the current dir). So you never
have to remember where you launched it — the store is the index and the file
records its own cwd.

:::caution\[Untracked sessions resume *vanilla*]
A session psu didn't start has **no engineer playbook loaded** (and for codex,
no `papercusp-su` tools — it ran under `~/.codex`). So `psu --resume` of an
untracked session prints a warning and asks **"Do you want to proceed anyway?"**
before continuing it as-is. Pass `--yes` to skip the prompt in scripts;
non-interactive (`--no-picker`) without `--yes` refuses rather than guess.
:::

## Role sessions — `psu --role`

By default `psu` launches an **engineer-collaborator (`su`)** session.
With `--role` you launch **as a pipeline role** (worker, validator,
reviewer, debugger, documenter, architect, scoper, …) — the same persona,
tools, and feature context the orchestrator gives that role, but **you**
drive it interactively.

```bash
psu --role=worker                                                     # picker
psu --role=worker --feature=F-042 --harness=papercup --agent=claude   # scripted
```

What's different from a plain `su` session:

* **Role prompt** — `<role>.persona.md` + `<role>.tools.md`, assembled by
  the same `assembleRolePrompt` the orchestrator + in-app brains use
  (`buildLaunchSpec({ kind: 'role' })`).
* **Role-scoped tools** — a *signed, role-scoped* MCP URL (`role=<role>`,
  **not** `?superuser=1`), so dispatch enforces exactly that role's
  allowlist — true parity with an orchestrator-spawned agent.
* **Feature context** — feature-consuming roles prompt for a feature; the
  picker knows which roles need one from `roleConsumes`.

All three backends work for role sessions (codex via a per-session
role-scoped `CODEX_HOME`). This is distinct from the orchestrator firing a
role **autonomously** (headless, scheduled) — that always routes through
`orchestrator.spawn`, never a terminal `psu`.

## Install

```bash
bash apps/operator/scripts/install-standalone-mcp.sh
```

This mints the superuser token, registers `papercusp-su` in each client's
**user-level** MCP config (`~/.omp/agent/mcp.json` + `~/.claude.json`),
installs the **claude user-level lock hooks**, writes the source playbooks

* the coordination extension, and installs `psu` (a shim that execs the
  in-repo launcher so it resolves `@inquirer/prompts` from the operator's
  `node_modules`). It does **not** install any `*-su` wrappers. Re-run to
  refresh; to revoke, delete the files the installer prints.

## How tracking flows

```
psu ──pick──▶ bootstrap-su ──buildLaunchSpec(su)──▶ prompt file + (codex) CODEX_HOME
  │                │                                      + adv_sessions row (agent, plan|null)
  │                └──records──▶ /adv Sessions (live, ~3s refresh) under plan / "No plan"
  └──exec──▶ RAW claude | omp | codex   (playbook + user-level/per-session MCP + flags + SID)
```

Every engineer session now goes through `psu`, so every one is tracked in
`/adv` — there's no longer an untracked direct-wrapper path.

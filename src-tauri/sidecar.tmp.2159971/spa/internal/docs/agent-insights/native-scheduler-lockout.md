# Native-scheduler lockout — one scheduler of record for agents
URL: /internal/docs/agent-insights/native-scheduler-lockout

Agent sessions (bees, Queen, role panes, wake resumes) are denied every client-native and OS scheduling surface, so a wake can only live in the harness routines table. The variadic --disallowedTools gotcha and the per-backend enforcement map.

## What

The hive's liveness contract is **"a wake is always armed in
`harness_shared.routines`"** (`hive:declare-wake` → the one-shot `hive-wake`
row). That table is the single scheduler of record read by `hive:status`,
Pause, the wake-mode gate, and the liveness backstop. A wake scheduled
anywhere else — claude-code's `CronCreate`/`ScheduleWakeup`/`/schedule`/`/loop`,
or `crontab`/`at`/`systemd-run` through any backend's shell — is invisible to
all of it: the backstop double-fires, Pause can't stage it, and a cron job
outlives the hive as a zombie. So every **agent** launch is locked out of
those surfaces (plan `native-scheduler-lockout-2026-06-09`). The owner's own
`psu su` sessions are untouched.

## The enforcement map

| Layer                                             | Mechanism                                                                                                                                               | Where                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| claude T1 (its scheduler tools + skills)          | `--disallowedTools=…` at launch                                                                                                                         | `invoke.ts` extraFlags (every headless spawn) · `wake-executor.ts` resume leg · `psu-launcher.mjs` `roleLaunchArgs` + brain legs |
| claude T2 (OS schedulers via Bash)                | `Bash(crontab:*)`-style deny patterns in the same flag (works hook-less, i.e. for headless bees) + the bash-resource-gate hook (catches compound forms) | canonical list: `@papercusp/orchestrator/native-scheduler-deny` · hook: `scripts/hooks/cc/pretooluse-bash-resource-gate.sh`      |
| omp (no T1 surface — toolset audited 2026-06-09)  | coord-hook `tool_call` block on OS-scheduler commands                                                                                                   | `scripts/hooks/omp/coord-hook.ts` (`OS_SCHEDULER_CMD_RE`)                                                                        |
| codex (no T1 surface — toolset probed 2026-06-09) | gate hook wired into the role home's `hooks.json` — **inert upstream** (codex PreToolUse doesn't fire, same as the lock hooks) but correct + ready      | `role-codex-home.ts` `writeCodexLockHooks({ agentSession: true })`                                                               |
| All backends, intent layer                        | explicit prohibition in the prompts                                                                                                                     | `queen.md` wake section · `bee.md` Don'ts                                                                                        |

The hook layers key off **`PAPERCUSP_AGENT_SESSION=1`**, set by every agent
launch path (orchestrator spawn env, wake-executor resumes, psu role panes,
the brain) and never by human sessions — the guard fails open for the owner.

## Gotchas (all verified live, 2026-06-09)

* **`--disallowedTools` is variadic** (`<tools...>`): the space form greedily
  eats every following token — in the wake-executor's case the positional
  wake text itself became "deny rules" and the run errored with no prompt.
  **Always use the single-token `=` form** (`--disallowedTools=A,B,C`).
* **The deny holds under `--permission-mode bypassPermissions`** — the tool is
  removed from the model's toolset, not merely permission-gated.
* **`ScheduleWakeup` is present even in headless `claude -p` sessions**, so
  this is a live exposure for bees, not an interactive-only concern.
* **Headless claude spawns load NO hooks** (minimal `CLAUDE_CONFIG_DIR`, creds
  symlink only) — that's why the T2 Bash deny-patterns ride the launch flag
  instead of relying on the PreToolUse gate.
* Bash prefix deny-patterns can't match compound commands
  (`cd x && crontab …`) — the hook layer covers those; `at` is hook-only
  (a bare prefix rule would false-positive `atuin`/`attach`).
* CLI flags don't persist into resumes: **every resume leg must re-apply the
  flag** (the wake-executor does; that's the leg that wakes the Queen).

## Residual gaps (accepted, documented)

* Headless **omp** bees load no `-e` extension (auto-discovery dir is empty on
  this box), so their shell is prompt-governed only. Default bees are claude,
  which is fully covered.
* **codex** PreToolUse emission is broken upstream (openai/codex #20204 /
  \#16732) — the gate entry in `hooks.json` enforces nothing until that fixes,
  exactly like the lock hooks (D-011 in `role-codex-home.ts`).
* Anything remote (`ssh host 'crontab …'`) is out of scope for local hooks.
* `psu --resume` of a role session by the OWNER doesn't re-apply the flag
  (owner-supervised; OQ-2 of the plan).

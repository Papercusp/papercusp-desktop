# claude-code headless permission model (what --allowed-tools / --permission-mode actually do)
URL: /internal/docs/agent-insights/claude-code-headless-permissions

Verified vs claude 2.1.158 — --allowed-tools is NOT a whitelist by itself; only --permission-mode dontAsk makes it one, and even then gating is non-uniform (CronCreate/EnterWorktree bypass it). --disallowed-tools is the hard block. How the fleet spawn is locked down.

## Why this exists

The headless fleet (orchestrator `invoke()` → `claude -p`) needs to run
unattended without (a) hanging on a permission prompt or (b) being able to do
anything destructive. The flag semantics that achieve this are **surprising and
contradict the docs in places** — every claim here was tested empirically against
claude 2.1.158 with external side-effects, because a doc-only read sent an
earlier pass down the wrong path. If you're changing the fleet's permissions
(`claudeMcpArgs` in `libs/papercusp/packages/orchestrator/src/invoke.ts`), read
this first.

## The model (all verified, not assumed)

1. **`--allowed-tools` is NOT a whitelist on its own.** It's a *pre-approval*
   list (don't-prompt-for-these). What an *un-listed* tool does depends on
   `--permission-mode`:
   * Under **`bypassPermissions`** the allow-list is **ignored entirely** —
     everything runs. (Verified: Bash wrote a file with only `Read` allow-listed.)
   * Under **`default`** the tool still *runs*, but `default` applies a
     **sandbox** that blocks filesystem-writes-outside-workdir + network.
     (Verified: a CWD write was blocked.) → `default` breaks file-writing roles;
     do not use it for the fleet.

2. **`--permission-mode dontAsk` makes `--allowed-tools` a true default-deny
   whitelist** — an un-listed *gated* tool is denied, the model is told, and it
   continues (no hang). Unlike `default`, `dontAsk` does **not** sandbox the
   allowed tools, so writes/edits work. **This is the posture the fleet uses.**

3. **`dontAsk` gating is NON-uniform.** A class of session-local / "meta"
   built-ins is **exempt** from the allow-list and runs even when omitted.
   Verified: with the exact fleet allow-list, `CronCreate` still created a job
   and `EnterWorktree` still ran. A `claude -p` spawn carries 250+ tools incl.
   `CronCreate/Delete/List`, `Workflow`, `Enter/ExitWorktree`, `RemoteTrigger`,
   `PushNotification`, `Monitor`, `ScheduleWakeup`, `Task`, `Skill`, `LSP`.
   **The allow-list alone is not a complete boundary.**

4. **`--disallowed-tools` is the hard block.** It removes a tool from the spawn
   entirely ("No such tool exists in this environment"), wins over the allow-list
   AND over `bypassPermissions`, and supports command granularity:
   `Bash(git push:*)` blocks `git push` while `echo` still runs. This is what
   closes the dangerous *exempt* tools (#3) and dangerous Bash *commands*.

5. **The per-role MCP boundary is already server-side**, belt-and-suspenders:
   `tools/list` is surface-filtered by `listMcpProjections(role)`
   (`libs/generic/tooldef/src/tool-projection.ts`) AND call-time-denied by the
   dispatch stack's `role-allowlist` step (`dispatch-stack.ts`, skipped only for
   `gateBypass.role` = superuser). So a fleet worker only ever sees/calls its
   role's MCP tools — `--allowed-tools "mcp__papercusp"` (server wildcard) grants
   exactly that, no per-role enumeration needed.

## What the fleet spawn ships (invoke.ts `claudeMcpArgs`)

```
--mcp-config <cwd>/.mcp.json --strict-mcp-config
--permission-mode dontAsk
--allowed-tools "mcp__papercusp Read Edit Write Bash Glob Grep WebFetch WebSearch"
--disallowed-tools CronCreate CronDelete CronList ScheduleWakeup \
  EnterWorktree ExitWorktree Workflow Task RemoteTrigger PushNotification \
  Monitor "Bash(sudo:*)" "Bash(git push:*)"
```

Allow-list is one space-joined arg (claude splits it); deny patterns are
separate argv elements so internal spaces (`Bash(git push:*)`) survive —
`claudeMcpArgs` is the **tail** of `finalArgv` for claude-code, so the variadic
`--disallowed-tools` swallows nothing unintended. Defers the whole posture if the
user set any permission flag in `AGENT_CMD`.

The allow-list is **per-role** (`fleetAllowedToolsForRole(role)`): most roles
get the kit above, while any role in `FLEET_NO_WRITE_ROLES` drops `Edit`/`Write`
(mechanically enforcing an "API/MCP-only — do NOT use `Write`/`Edit`" prompt
instruction). **Update (2026-06): `FLEET_NO_WRITE_ROLES` is currently EMPTY** —
the former `expert`/`feedback` API-only roles were removed, so no role is cut
today; the mechanism stays for when such a role returns. That's the *only* per-role
built-in cut that's safe from a prompt read (other review/gate roles write
legit output via `Write`). It's a nudge, not a boundary — `Bash` is still
granted, so a shell redirect could write; deeper per-role cuts need a real
fleet-spawn run, not a prompt read. An unknown role gets the full kit.

**No-push** is *really* enforced by a spawn-env-scoped pre-push hook
(`gitConfigNoPushEnv` injects `core.hooksPath` via `GIT_CONFIG_*` into the spawn
env only — the shared checkout's config and the user's/other agents' pushes are
untouched). The `Bash(git push:*)` deny is the evadable backstop (`git -C … push`,
aliases, `&& git push` slip past command-string matching; the hook does not).

## Honest limits (the deny-list alone is not a sandbox)

**Update (`fleet-spawn-sandbox-2026-06-01`, P-013/D-015): there is now a
DEFAULT-ON sandbox layered on top of this deny-list** — claude-code's OWN
built-in sandbox (Linux bubblewrap + socat egress proxy; macOS Seatbelt),
injected via `--settings`, opt-out with `PAPERCUSP_FLEET_SANDBOX=0`. It closes
the two gaps the deny-list cannot: it hides credential dirs
(`FLEET_SANDBOX_DENY_READ` — `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gcloud`,
`~/.papercusp`, `~/.npmrc`) from sandboxed Bash and confines egress to an
allow-listed set of package registries (`resolveFleetAllowedDomains()`;
strip-all with `PAPERCUSP_FLEET_SANDBOX_DENY_ALL_EGRESS=1`). The bullets below
describe the **deny-list layer in isolation** — i.e. the posture *before* that
sandbox, which is now the default container for those reads/egress.

* **Credential reads are not closed by the deny-list** — the allow-listed `Read`
  tool reaches any path. **Network egress is not closed by the deny-list** —
  `WebFetch` is allow-listed. True containment of those needs a network/fs
  sandbox, not a deny-list — which is what the default-on sandbox above now is.
* **Worktree isolation is conditional** — `invoke.ts` falls back to
  `ctx.projectDir` (the shared main checkout) when there's no feature-worktree,
  so "the worker is contained in a worktree" is not universally true.
* Per-role *tightening* of the built-in dev kit (e.g. deny `Write` to read-only
  roles) is deliberately NOT done — it needs per-role real-spawn verification
  because withholding a needed built-in silently breaks a role mid-pipeline.

## How to re-verify (don't trust the docs here)

Test against the real CLI with an **external side-effect** (a file on disk, not
just a `tool_use` block in the stream — a denied call still shows an attempt).
Use a pristine `CLAUDE_CONFIG_DIR` (copy in only `.credentials.json`, no
settings) so a stray `settings.local.json` allow-rule can't confound the result.
Pattern that settled it:

```
claude -p "use a shell command to create file X containing Y" \
  --permission-mode dontAsk --allowed-tools "Read" --output-format json
# then check whether file X exists — exists = the tool ran, absent = denied.
```

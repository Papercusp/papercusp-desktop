# Native console launcher
URL: /internal/docs/desktop/native-console

The "+" button next to the voice button opens an OS-native terminal with the same MCP context spawned agents get. macOS, Linux, Windows-via-WSL.

## What it is

A small terminal-icon button in the chrome header — sibling to the
voice button — that opens a real OS-native terminal window. The
terminal lands in the active harness's directory (or workspace root
when there's no active harness), with env vars set and a `.mcp.json`
written so any agent the user invokes inside it (`claude`, `codex`,
`omp`, …) auto-discovers the operator's MCP server and gets the full
[tool catalog](/internal/docs/endpoint-system/tool-catalog) (145+ tools as of
this writing).

This is the visible end of the [superuser-mode](/internal/docs/endpoint-system/superuser-mode)
plumbing — that doc covers the threat model + token mechanics; this
page is about how to test it.

## How it works

```
click +   ─►  POST /api/agent-mcp/console/resolve { slug? }
              ─►  returns ConsoleEnvelope (cwd, env, mcp.json body, …)
              ─►  Tauri invoke('console_launch', { envelope })
                  ─►  Rust:
                      ├─ ensure ~/.papercusp/superuser-token (installer)
                      ├─ atomic .mcp.json write with backup-restore
                      └─ spawn OS terminal in NEW WINDOW
                          ├─ macOS:  open -na <term> /tmp/papercup-*.command
                          ├─ Linux:  $TERMINAL → gnome-terminal/konsole/…
                          └─ Windows: wt.exe -w new wsl.exe -d papercup-runtime
```

Every click opens a **new window**, not a new tab.

## What appears inside the new terminal

The launcher runs a single bash one-liner before exec'ing the user's
shell:

```bash
cd <cwd> && export PATH=<scripts-dir>:$PATH \
         && export PAPERCUSP_HARNESS_SLUG=… \
         && export PAPERCUSP_WORKSPACE=default \
         && export PAPERCUSP_API_BASE=http://127.0.0.1:3070 \
         && (papercup status) \
         && exec "${SHELL:-/bin/bash}" -l
```

The greeting prints workspace + harness + pending suggestion count +
escalations. Then the user is in their normal shell (zsh/bash/fish/…)
with everything inherited from their rc files.

`.mcp.json` is dropped at cwd (backup-and-restore if one already
existed). Inside that terminal, running `claude` or `codex` connects
to `/api/mcp?superuser=1&workspace=<slug>` with the bearer header from
`~/.papercusp/superuser-token`.

## Smoke test — macOS

1. Build the desktop app (`cd papercusp-desktop && npm run tauri build`).
2. Launch it. Open `/harness/sheets`.
3. Click the terminal-icon button next to the voice button.
4. Verify:
   * A new Terminal.app window appears (not a tab in the front window).
   * The first line shows: `papercup — workspace 'default' · harness 'sheets'`.
   * `pwd` prints the sheets project directory.
   * `echo $PAPERCUSP_HARNESS_SLUG` prints `sheets`.
   * `ls .mcp.json` lists a file containing `superuser=1`.
5. Type `claude` (assuming you have claude-code installed). After
   it connects, run `/mcp` inside claude — `papercusp` should appear
   in the server list.
6. Try a tool call: ask claude "what features are in this harness?"
   It should call `features:list` or `harness:status` and respond
   from real data.

If iTerm2 is installed at `/Applications/iTerm.app` the launcher
prefers it; otherwise Terminal.app. Per-app fallback is documented
in `native_console.rs:detect_macos_default_terminal`.

## Smoke test — Linux

Same as macOS, with these differences in step 4:

* `$TERMINAL` is honored first. If unset, the launcher cascades through
  `gnome-terminal` → `konsole` → `xfce4-terminal` → `alacritty` →
  `kitty` → `wezterm` → `xterm` in order.
* Each terminal opens with its new-window flag (`--window` for
  gnome-terminal, `--new-window` for konsole, `--always-new-process`
  for wezterm, defaults for alacritty/kitty/xterm).
* If none of those are installed, the launcher errors with
  `no terminal emulator found. Set $TERMINAL or install one of: …`.

Force a specific terminal for testing:

```bash
TERMINAL=alacritty <run the operator>
```

## Smoke test — Windows (WSL)

Prerequisite: complete the WSL onboarding (`wsl_setup` state machine
must reach `Ready` — the wizard handles this).

1. From the desktop app, click the terminal-icon button.
2. Verify:
   * A new Windows Terminal window appears (not a tab).
   * The tab title contains `wsl.exe -d papercup-runtime`.
   * `pwd` inside is the Linux-side cwd (e.g. `/home/avi/papercup`).
   * `echo $PAPERCUSP_HARNESS_SLUG` works the same way as on Linux.

When `wt.exe` isn't present (older Win10 without Windows Terminal),
the launcher falls back to bare `wsl.exe` with `CREATE_NEW_CONSOLE`.
Each click still produces a separate console window.

## Smoke test — endpoint only (no Tauri)

You can exercise the operator-side envelope-builder without launching
a terminal:

```bash
curl -X POST http://127.0.0.1:3070/api/agent-mcp/console/resolve \
  -H 'content-type: application/json' \
  -d '{"slug":"sheets"}' | jq
```

Expected fields:

```jsonc
{
  "cwd": "/home/.../sheets-clone",
  "env": {
    "PAPERCUSP_HARNESS_SLUG": "sheets",
    "PAPERCUSP_WORKSPACE": "default",
    "PAPERCUSP_API_BASE": "http://127.0.0.1:3070",
    "PAPERCUSP_OPERATOR_URL": "http://127.0.0.1:3070",
    "PAPERCUSP_HOME": "/home/.../.papercusp-workspaces/default",
    "PAPERCUSP_SCRIPTS_DIR": "/home/.../apps/operator/scripts",
    "PI_CODING_AGENT_DIR": "/home/.../sheets-clone/.papercusp/pi-sessions"
  },
  "mcpJsonContents": "{ \"mcpServers\": { \"papercusp\": { \"url\": \"http://127.0.0.1:3070/api/mcp?superuser=1&workspace=default\", \"headers\": { \"Authorization\": \"Bearer …\" } } } }",
  "greetingCmd": "papercup status 2>/dev/null || true",
  "needsSuperuserBootstrap": false
}
```

`needsSuperuserBootstrap: true` means `~/.papercusp/superuser-token`
doesn't exist yet — the Tauri side runs `install-standalone-mcp.sh`
before writing the `.mcp.json`. The `mcpJsonContents` won't contain a
real bearer token in that case; one is wired in by the next request
after bootstrap completes.

Pass `{"slug": null}` (or omit the body) for a workspace-only console
— cwd becomes the workspace root, no `PAPERCUSP_HARNESS_SLUG` or
`PI_CODING_AGENT_DIR` are set, the MCP URL still pins `workspace=default`.

## What the agent in the terminal can do

Per the [tool catalog](/internal/docs/endpoint-system/tool-catalog), 96 built-in
tools + 36 plugin tools are exposed via `?superuser=1`:

* **Read workspace state**: `harness:status`, `tasks:list`,
  `features:get`, `goals:list`, `issues:list`, `messages:inbox`.
* **Operator surface**: `operator:audit`, `operator:nudge`.
* **Cross-workspace**: `papercusp:list_workspaces`, then any tool
  with `?workspace=<slug>`.
* **Spawn / supervise other agents** (the `fleet:*` surface):
  `fleet:spawn`, `fleet:supervise`, `fleet:cancel`, `fleet:tree`,
  `fleet:assignments`. (The old `orchestrator.spawn` plugin was retired
  2026-06-06 — superseded by `fleet/operator-spawn.ts`.)
* **Plugin tools**: `repomix.pack`, `gitnexus.*`, `firecrawl.*`,
  `code2prompt.*`, `fetch_plus.*`.

Every call is recorded in `harness_shared.tool_invocations` with
`role='operator', run_id='standalone'` — filter the Intel panel by
`runId='standalone'` to see just human-console activity.

## Common failure modes

| Symptom                                     | Cause                                      | Fix                                                                                   |
| ------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Button is hidden                            | Running in browser, not Tauri desktop      | Open the desktop app build                                                            |
| Toast "no terminal emulator found"          | Linux without any of the 7 known terminals | `apt install gnome-terminal` or set `$TERMINAL`                                       |
| `unknown harness slug` 400                  | UI sent a slug not in `harness_registry`   | Refresh the page; harness may have been deleted                                       |
| Terminal opens but `papercup` isn't on PATH | Dev mode without sidecar bundle            | Verify `PAPERCUSP_SCRIPTS_DIR` env var inside the terminal points at a real directory |
| `claude` says no MCP server                 | `.mcp.json` not in cwd, or stale bearer    | `cat .mcp.json`; re-run `install-standalone-mcp.sh` to rotate                         |
| Tab opens instead of new window             | Terminal's args missing new-window flag    | Bug — file the OS + emulator name                                                     |

## Where the code lives

| File                                                                            | Role                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apps/operator/app/_components/ConsoleLauncherButton.tsx`                       | The button + terminal icon SVG                              |
| `packages/operator-core/lib/native-console.ts`                                  | Renderer-side wrapper around `commands.consoleLaunch`       |
| `packages/operator-core/lib/console-launcher.ts`                                | Server-side envelope builder (`buildConsoleEnvelope`)       |
| `packages/operator-core/lib/endpoint-route/routes/agent-mcp/console-resolve.ts` | The Hono `POST /api/agent-mcp/console/resolve` handler      |
| `apps/operator/scripts/papercup-status.mjs`                                     | The greeting CLI shown on first line                        |
| `apps/operator/scripts/papercup`                                                | Bash dispatcher shim                                        |
| `papercusp-desktop/src-tauri/src/native_console.rs`                             | The Tauri command + per-OS spawners                         |
| `packages/operator-core/lib/spawn-config.ts`                                    | Shared primitives (cwd/env) between Pi pty + native console |

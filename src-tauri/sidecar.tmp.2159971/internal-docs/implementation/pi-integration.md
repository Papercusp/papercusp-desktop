# Pi (oh-my-pi) integration
URL: /internal/docs/implementation/pi-integration

Two-track integration — pi as worker-role CLI (Option #2) and embedded pi TUI as a peer pane in the desktop app (Option #3).

import { Aside } from '@astrojs/starlight/components';

[`oh-my-pi`](https://github.com/can1357/oh-my-pi) (binary `omp`) is a 3.5k★ open-source AI coding agent for the terminal — strong tool harness (read / bash / edit / write / grep / find / lsp / python / browser / subagents / hooks / plugins), `--mode=rpc/json` structured output, multi-model fuzzy matching, session resume, and a TUI.

It complements Papercusp at a different layer: **pi has strong in-loop autonomy; Papercusp has strong mission orchestration**. Together: pi as the worker, Papercusp as the conductor.

This page covers two integration tracks.

## Track A — Pi as the worker-role CLI

Track B (the embedded pi pane) shipped; **Track A has not**. There is no
per-role `cliBin` field in the harness role config today — the TS
orchestrator's `invoke.ts` resolves a single agent binary globally
(`$AGENT_CMD ?? $CLAUDE`, default `omp -p`), not per-role. The config below is
the proposed schema, not the current one.

The smallest valuable integration. Papercusp's per-role config already supports overrides; add `cliBin` to the schema so individual roles can specify a non-default CLI.

```json
// config.json (in any harness)
{
  "primaryRole": "orchestrator",
  "roles": {
    "worker": { "cliBin": "pi", "model": "opus" },
    "validator": { "cliBin": "claude" },
    "orchestrator": { "cliBin": "claude" }
  }
}
```

**What lands:** pi runs the worker pipeline (where tool breadth matters); claude stays on plan / validate / orchestrate (where structured-decision reliability matters). Each invocation is `pi -p --no-session --append-system-prompt=<file>` so the fresh-context contract holds.

**Effort:** \~½ day. The bash run.sh's `invoke()` and the TS orchestrator's `invoke.ts` both already shell out to a configurable CLI binary; this is wiring per-role config through to that spawn.

**Output parsing.** Pi's `--mode=json` emits a JSONL event stream with the same shape papercusp already parses for claude (session header, then events). Empirically verified: first event is `{"type":"session","version":3,"id":"…","cwd":"…"}` followed by tool/message events. The adapter to map pi's event names to papercusp's audit schema is \~30 lines, not a deal-breaker.

**Auth.** Pi inherits the sidecar's environment, including `ANTHROPIC_OAUTH_TOKEN`. Users logged into Claude Code see no auth prompt when papercusp invokes pi — the same Claude Max subscription that drives `claude -p` drives `pi -p`. Other providers (OpenAI, Gemini, Bedrock, Vertex, OpenRouter, …) flow the same way via their respective env vars.

### Cost-mixing example

The interesting payoff is fine-grained cost control across roles. Pi's four model slots ([see §16.4 in the spec](/spec/cli-pluggability/#two-layer-pluggability-a-worked-example)) let a single config dial each role independently:

```json
// config.json — opinionated mid-budget setup
{
  "roles": {
    "scoper":       { "cliBin": "pi", "extraArgs": ["--plan=opus"] },
    "planner":      { "cliBin": "pi", "extraArgs": ["--plan=opus"] },
    "worker":       { "cliBin": "pi", "extraArgs": ["--model=sonnet", "--smol=haiku"] },
    "validator":    { "cliBin": "pi", "extraArgs": ["--model=gemini-2-flash"] },
    "orchestrator": { "cliBin": "claude" }
  }
}
```

Reasoning: opus on the rare planning calls, sonnet on hot-path worker calls (with haiku for tool-plan subtasks via pi's `--smol`), gemini flash on cheap validator passes, claude on the orchestrator for stable decision-verb output. Pairs naturally with papercusp's [hard-stop budget enforcement](/spec/state/#53-hard-stop-budget-enforcement) — the substrate enforces the hard cap; this config tunes the per-call cost.

See [§16 CLI pluggability](/internal/docs/spec/cli-pluggability) for the substrate concept this builds on.

## Track B — Embedded pi TUI as a peer pane

A new `pi` tab in the harness dashboard that hosts an interactive `omp` process inside the desktop app. The autonomous loop continues in the background; the human can drop into pi mid-mission for surgical override.

### Goal

Surface an interactive pi TUI inside the Papercusp Desktop harness UI alongside the existing `vscode` / `git` / `brainstorm` panels. (Phase 3b adds a "open in pi" button per feature that scopes pi to that feature's worktree.)

### Design decisions

1. **PTY runs in the Node sidecar, not the Tauri Rust process.** The same sidecar code runs in desktop (Tauri) and cloud (container) modes. A Rust-side PTY would fork the codebase. Use `node-pty` from inside the sidecar.

2. **I/O transport: Server-Sent Events + POST, not WebSockets.** Next.js's standalone server (`node server.js`) does not natively support raw WS-upgrade on arbitrary routes; SSE + POST works out-of-the-box in Next.js / Hono and is plenty for terminal I/O. WS is a future optimization.

3. **`pi` is a user-installed prerequisite, not bundled.** Matches the existing `claude` pattern. The desktop preflight UI already surfaces missing-prereq state — extend with a `pi` check.

4. **No session persistence in v1.** Pi has `--no-session` for ephemeral runs; persistent resume across pane reopen is v2 polish.

5. **Slot into the existing `MainPanel` union.** `HarnessDashboard.tsx` lists every embedded-tool tab (`brainstorm`, `proposals`, `git`, `dashboard`, `vscode`, `insights`, etc.) — adding `'pi'` follows the established pattern. The `vscode` tab (which embeds `code-server` in an iframe) is the direct precedent: same shape, different embedded tool.

### Rejected alternatives

* **Rust-side PTY (`portable-pty` crate)** — forks desktop/cloud paths, more native build pain on Windows, couples a UI feature to the platform shell.
* **SSH/wetty-style HTTP terminal services** — another process, another auth surface, another port. The `node-pty + xterm.js + SSE` stack runs entirely inside the existing sidecar.

### Pi command surface used by Track B

The pane spawns one of:

* `omp` — pi's interactive default mode. Best for general use.
* `omp shell` — pi's "interactive shell console" subcommand. Slightly different surface; useful for shell-flavored workflows.

Useful flags to pass:

* `--no-pty` — disable pi's *internal* PTY-based bash execution. We already have a PTY (the one we bridge to xterm.js); pi nesting another inside it can confuse signal handling and resize semantics. Set this in the embedded pane.
* `--session-dir=$STATE_DIR/.pi-sessions/` (or env `PI_CODING_AGENT_DIR`) — point pi's session store at the harness state dir so sessions are scoped to the harness, not the user's home. Falls back to `~/.omp/agent` if unset.
* `--append-system-prompt=<file>` — for Phase 3b feature-scoped opens, inject the feature's spec/lineage as additional system prompt.
* `--export=<session-file>` — Phase 3d candidate. After a session ends, exporting it to HTML and storing under the harness audit dir makes the in-pane work part of the durable record.

### Phasing

The status table on [/implementation/status/#pi-oh-my-pi-integration--tracks-a--b-phase-3abc-shipped](/internal/docs/implementation/status) tracks landed phases. Live in the harness dashboard (open a harness in the desktop shell) — click the `pi` tab.

**Phase 3a — MVP terminal pane (\~1 day).** ✅ shipped.
A new `pi` tab in the harness dashboard. Click → opens xterm.js connected to a fresh `pi` process in the harness's project directory. Keystrokes in, output out. Close tab → kill pi.

**Phase 3b — peer pane layout + feature-scoped launch (\~1 day).** ✅ shipped (tab-scoped, not split-pane).
Each feature's `FeaturePeekPanel` gets an "open in pi" button → pi spawns in `<stateDir>/worktrees/<fid>` (falls back to project root if no worktree). SSE `onAbort` kills the pty immediately so navigation doesn't orphan `omp`. The plan called for a split-pane layout; we shipped tab-pattern instead (matches the existing `vscode` tab; no layout-shift, full pane width). True split-pane is a future affordance if needed.

**Phase 3c — desktop polish (\~½ day).** ✅ shipped.
`pi` added to preflight checks (PATH + well-known-paths probe). Install-hint UI surfaces missing-pi with `brew install can1357/oh-my-pi/oh-my-pi`. README documents pi as an optional prereq. Pi missing does NOT block the app from booting — only the pi tab degrades.

**Phase 3d — partially shipped.**

* **Feature-scoped system-prompt injection** ✅ shipped. When the user clicks "open in pi" on a feature, the spawn endpoint reads `harness_features` for that `(slug, featureId)`, formats the title / spec / status / lineage as markdown, writes to `<stateDir>/pi-prompts/<feature-id>.md`, and adds `--append-system-prompt=<path>` to the omp args. Pi launches already aware of the feature it's working on. Falls back silently when the feature lookup fails — no error surface, just no injection.
* **Per-harness session persistence** ✅ shipped via `PI_CODING_AGENT_DIR=<stateDir>/pi-sessions/`. Each harness has its own pi history under its state dir; sessions persist across pane reopens automatically. Future polish: explicit "resume last session" button using `omp -c` / `omp -r <id>`.
* **Audit export** — deferred. `--export <session>.html` after each pane close, dropped into `<stateDir>/audit/pi-sessions/`. Sessions are persisted today; export is a presentation layer that can run later from the persisted jsonl.
* **Pi plugin** via `--plugin-dir <path>` — deferred. A `papercusp` plugin shipped at `~/.papercusp/global-plugins/pi/` that registers tools like `papercusp.feature_status`, `papercusp.list_features`, `papercusp.lineage`, `papercusp.post_comment`. Pi loads it on startup; the plugin reads/writes papercusp state through the existing Hono API (so no extra trust boundary). Bidirectional from the dashboard side: papercusp learns of pi-emitted events via plugin hooks.
* **Subagent cross-pollination** — deferred. `omp agents unpack` ships curated subagent personas. Wrap each as a papercusp plugin so they appear in the marketplace catalog. Cross-pollinate the ecosystems.
* **Multi-pane** — deferred. Multiple concurrent pi panes scoped to different features (capped per the 4-pane limit in §Risks).

### File-level changes (Phase 3a + 3b + 3c)

The original plan targeted `apps/papercusp/**`. After the operator rename the
operator app is **`apps/operator/`** and its server routes are Hono routers
under **`packages/operator-core/lib/endpoint-route/routes/**`**; the desktop is
the sibling repo **`papercusp-desktop/`** (not `apps/papercusp-desktop/`). The
harness UI was also restructured — there is no longer a `HarnessDashboard.tsx`
/ `MainPanel` union or a `FeatureList.tsx`; the pi pane now lives in
`PiPanel.tsx` + a multi-pane `PiTerminalsDock.tsx` (dockview-based, so the
multi-pane / split-pane affordances the original phases deferred are present).
The tables below give the current locations.

#### New files

| Path                                                            | Purpose                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/operator-core/lib/endpoint-route/routes/pty/index.ts` | Hono router mounted at `/api/harness/:slug/pty/*`. Endpoints: `POST /spawn`, `GET /:id/stream` (SSE), `POST /:id/input`, `POST /:id/resize`, `POST /:id/kill`. In-memory `Map<id, IPty>` (plus a pre-warm slot). |
| `apps/operator/app/harness/PiPanel.tsx`                         | xterm.js React component (xterm + addon-fit + addon-web-links). SSE on mount, POST keystrokes on input, POST resize on container resize. Cleanup on unmount.                                                     |
| `apps/operator/app/harness/PiPanel.css`                         | Pane chrome (header bar, "open new", spinner) + xterm theme matching papercusp dark colors.                                                                                                                      |
| `packages/operator-core/lib/pty-bridge.ts`                      | Server-side `node-pty` wrapper. `spawnPty({cwd, env, cols, rows, args})` → typed handle with `onData` / `write` / `resize` / `kill`. Centralizes lifecycle + idle cleanup.                                       |

#### Modified files

| Path                                                                    | Change                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/operator/package.json`                                            | Add `node-pty` (or `@lydell/node-pty` for prebuilt support — research first), `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`.                                                                                                                 |
| `packages/operator-core/lib/endpoint-route/routes/index.ts`             | Register the pty router (flattened into the route table) so it mounts under `/api/harness/:slug/pty`.                                                                                                                                                       |
| `apps/operator/app/harness/PiTerminalsDock.tsx`                         | Multi-pane (dockview) container that hosts the pi/omp terminals as draggable tabs/splits; each panel mounts a `<PiPanel>`. (Replaces the original plan's `HarnessDashboard.tsx` `MainPanel`-union single-tab integration after the harness-UI restructure.) |
| `apps/operator/app/harness/PiPanel.tsx`                                 | Per-feature "open in pi" wiring: passes the feature id as `laneId` so the pane spawns in that feature's worktree.                                                                                                                                           |
| `packages/operator-core/lib/endpoint-route/routes/desktop/preflight.ts` | `pi` check (probes `omp`, then well-known paths `/usr/local/bin/omp`, `/opt/homebrew/bin/omp`, … for the GUI no-login-shell PATH gotcha).                                                                                                                   |
| `papercusp-desktop/web/index.html`                                      | Extend `renderHint()` switch with a pi clause: install URL + recommended command.                                                                                                                                                                           |
| `papercusp-desktop/README.md`                                           | Document pi as optional prereq for the pi tab.                                                                                                                                                                                                              |

### I/O protocol (HTTP/SSE)

```
POST /api/harness/:slug/pty/spawn
  body: { laneId?: string, cols: number, rows: number,
          ctxPrompt?: string, cwd?: 'project'|'worktree' }
  → { id: string }   // uuid

GET /api/harness/:slug/pty/:id/stream    (text/event-stream)
  ← event: data\ndata: <base64-bytes>\n\n
  ← event: exit\ndata: {"code": 0}\n\n

POST /api/harness/:slug/pty/:id/input    { data: <base64-bytes> }
POST /api/harness/:slug/pty/:id/resize   { cols, rows }
POST /api/harness/:slug/pty/:id/kill
```

Bytes are base64-encoded over JSON to keep the SSE stream uniform regardless of encoding (xterm.js handles arbitrary byte streams; pi may emit non-UTF-8 in edge cases like binary file contents). Idle PTYs (no input, no SSE consumer) auto-kill after 5 minutes.

### Critical files to read first

| File                                                                    | Why                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/operator/app/harness/PiTerminalsDock.tsx` + `PiPanel.tsx`         | The current pi-pane surface — dockview multi-pane container + the xterm/SSE panel. (Supersedes the original `HarnessDashboard.tsx` `MainPanel`-union integration.) |
| `packages/operator-core/lib/endpoint-route/routes/index.ts`             | Hono route-table assembly. The pty router registers the same way the harness/plugins routers do.                                                                   |
| `papercusp-desktop/src-tauri/src/main.rs`                               | Sidecar spawn — confirms env passes through (`PATH`, etc.) which pi needs.                                                                                         |
| `packages/operator-core/lib/endpoint-route/routes/desktop/preflight.ts` | Pattern for prereq checks. The `pi` check mirrors the `claude` check (plus well-known-path probing).                                                               |
| `papercusp-desktop/web/index.html`                                      | `renderHint()` switch — the pi case.                                                                                                                               |

### Verification

**Phase 3a:**

1. Launch the desktop shell: `cd papercusp-desktop && npm run dev` (the only supported run path; it boots the operator sidecar + webview).
2. In the Tauri window, open a harness (`/harness/<some-slug>`).
3. Click the new pi tab.
4. Pi prompt appears; type `pwd` + Enter; output shows the harness's project directory.
5. Type `exit`; pane shows "(pi exited 0)" and the spawn lifecycle cleans up (verify `pgrep -af omp` returns nothing).
6. Resize the window; xterm-fit addon resizes; pi sees the new width (`tput cols`).

**Phase 3b:**
7\. Two-pane layout works: dashboard left, pi right; resizable divider; both visible.
8\. On a feature row, "Open in pi" puts pi inside that feature's worktree directory (verify with `pwd`).
9\. Pi's first prompt includes the feature spec + lineage (visible when asked "what are you working on?").

**Phase 3c:**
10\. `pi` shows as `missing` in the bootstrap UI when uninstalled; install hint card appears with a brew/install command.
11\. Once installed, `pi` flips to `ok` on next preflight tick; pi tab works.
12\. README quick-start mentions pi as optional.

**Cross-cutting:**

* No native-binary load errors at sidecar boot on macOS, Linux, Windows.
* The desktop bundle still ships within size budget (no inadvertent +100MB from xterm assets).
* No stray pty processes survive sidecar shutdown.

### Risks

| Risk                                                                                                                   | Mitigation                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-pty` native binding fails under Next.js `output: 'standalone'` (Next traces deps and may miss the `.node` file). | Verify on day 1. If `next.config.js` `outputFileTracingIncludes` doesn't capture `node_modules/node-pty/build/Release/*.node`, add an explicit include. Fallback: ship pty-bridge as a separate child process the Next handler shells out to. |
| `node-pty` Windows ConPTY initialization fails on older Win10.                                                         | Document min Windows version (10 1809+) in README. Surface a clear inline error in the pane.                                                                                                                                                  |
| Pi binary not on `PATH` despite being installed (Mac homebrew + Tauri-Cocoa launches without a login shell).           | Probe `/usr/local/bin/omp`, `/opt/homebrew/bin/omp`, `~/.cargo/bin/omp` in addition to `which`. Fall back to user-configurable `pi.binPath` in `config.json`.                                                                                 |
| Concurrent pi panes spawn many processes / use lots of memory.                                                         | Cap to 4 concurrent ptys per harness; show "pty limit reached" inline instead of opening a 5th.                                                                                                                                               |
| Pi's nested PTY (its `bash` tool) conflicts with the outer xterm.js PTY — terminal corruption or signal loss.          | Spawn with `--no-pty`. Pi degrades gracefully (loses interactive bash but keeps every other tool).                                                                                                                                            |
| Auth state drifts: user logged into Claude Code in their normal shell, but the desktop app launches without that env.  | Surface `ANTHROPIC_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` presence in the preflight UI; document the GUI-app-no-login-shell gotcha in the README.                                                                                                 |

## What is explicitly NOT in scope

* Pi plugin exposing papercusp tools (deferred to Phase 3d).
* Session persistence / resume across pane reopen (deferred).
* Replacing the `vscode` tab — pi sits alongside it, not instead of it.
* Web (non-desktop) deployment of the pi pane — works the same way (sidecar is identical), but rollout is separate.

Track A and Track B are independent — implement either or both. Track A alone is the smaller, less-visible change. Track B alone gives users the interactive override without changing how the autonomous loop runs. Together they make pi a first-class citizen in the desktop runtime.

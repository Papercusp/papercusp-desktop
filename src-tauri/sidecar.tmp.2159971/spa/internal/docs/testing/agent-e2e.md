# Agent E2E playbook — driving the operator like a user
URL: /internal/docs/testing/agent-e2e



> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

import { Aside } from '@astrojs/starlight/components';

This is **the manual every AI agent follows** when asked to verify the
operator end-to-end. It is **not** the automated test suite. The agent
must drive a real browser the way a user would: navigate routes, click
buttons, fill forms, watch toasts, observe DOM mutations. Calling the
backend with `curl` is **not** a substitute — many bugs are UI-only
(handlers wired wrong, components unmounted, toast lost, popover
mispositioned, focus stolen). If you only test the API layer you'll
miss them.

The webapp at `:3055` / `:3070` was retired on 2026-05-14. The Next
sidecar still binds a port (so `localhost:3055` may render a page) but
it is **only meant to be reached through the Tauri shell** — auth,
workspace switching, embedded-PG discovery, and the IPC bridge all
assume the Tauri host. Driving the bare Next port skips that wiring
and the bugs you'll find won't reproduce for users.

Start the shell with `cd papercusp-desktop && npm run dev` (or attach
to an already-running one — see §1) and drive that webview via the
**`tauri-agent-tools`** CLI documented below. It speaks to a debug-only
Rust bridge inside the webview, so DOM queries, `eval`, `click`,
`type`, IPC monitoring, and DOM-targeted screenshots all work without
focus-stealing or OCR.

Marketing/website surfaces (`/`, `/marketplace`, `/support`, `/docs`,
auth pages) deliberately omit some app-side affordances (e.g. the
Oracle dock); don't flag those as failures — see the route table for
which surfaces each feature should appear on.

## 0. Tools

Primary stack — drives the operator UI inside the Tauri shell:

* **`tauri-agent-tools`** (`npm i -g tauri-agent-tools`, currently 0.7.0)
  — CLI that talks to a debug-only Rust dev-bridge inside
  `papercusp-desktop`. Real DOM access, `eval`, `click`, `type`, IPC
  monitor, console capture, Rust logs, DOM-targeted screenshots, and
  `check`-style assertions. **This is the primary driver for every
  operator-side test.** Source + full reference:
  [github.com/cesarandreslopez/tauri-agent-tools](https://github.com/cesarandreslopez/tauri-agent-tools).
* **`curl`** — corroborate backend state (PG row written, sidecar log
  line, `/api/...` returns expected JSON) after a UI action. Never as
  a primary verification — many bugs are UI-only and the API would
  pass.
* **Operator log tail** — `tail -200 /tmp/tauri-dev.log` (or whichever
  log the dev shell prints to; `bin/dev` and `npm run dev` both write
  here by convention) for sidecar-side errors after a failure.

Other tools and when:

* **`verdict`** — only for **arbitrary public web pages** (docs site
  on the marketing domain, third-party links, render checks for the
  `/docs` MDX renderer hitting an external URL). Do **not** drive the
  operator with verdict; the operator only renders correctly inside
  Tauri.
* **Xvfb + VirtualGL + `xdotool` + `import` + `tesseract`** — fallback for
  scenarios where the bridge can't help: macOS dev builds without
  the bridge compiled in, **release/production builds** (the bridge is
  `#[cfg(debug_assertions)]` only, so screenshots are your only signal),
  forensics on a crashed app, or visual checks (animation timing, font
  rendering) that the DOM can't express. **⚠ Use VirtualGL (`vglrun -d egl0`),
  NOT bare `Xvfb` — a plain Xvfb has no GL so WebKitGTK never paints and every
  screenshot is blank-white regardless of the DOM.** See §15.4 for the cookbook
  (incl. the GL trap + the `vglrun` recipe).

Forbidden:

* Playwright MCP / `proxy_mcp_playwright_*` tools — superseded by
  `tauri-agent-tools` for operator work and by the official
  `tauri-driver` CLI for the automated suite.
* Driving the user's live `:0` Tauri window with `xdotool` while they
  are working — focus-stealing is unacceptable. Use the bridge (no
  focus changes) or a second Tauri instance under Xvfb.

## 1. Pre-flight

### 1.1 Tauri dev shell is running

```sh
pgrep -af papercusp-desktop | head -3
ls /tmp/tauri-dev-bridge-*.token 2>/dev/null
```

If neither shows a process, start it from
`papercupai-workspace/papercup/papercusp-desktop`:

```sh
cd papercupai-workspace/papercup/papercusp-desktop
npm run dev    # foregrounds 'tauri dev'; cargo build first run is ~2 min
```

The first launch compiles the Rust shell; subsequent launches hot-load
the operator sidecar (the Vite SPA `@papercusp/operator-vite` on `:3055`

* the Hono host on `:3070` — Next.js is retired). Wait for
  `dev bridge listening` to appear in the log before driving.

### 1.2 Bridge probe

```sh
tauri-agent-tools probe
```

Expected output:

```
Running bridges:  1
  PID <pid>  port <port>
Bridge alive:     yes
Bridge version:   0.7.0
Endpoints:        /eval, /logs, /describe, /version, /process, /capabilities, /devtools, /health
Windows:          main
Page:
  URL:      http://127.0.0.1:<port>/harness?slug=<slug>&ws=<ws>
  Title:    Papercusp
  Viewport: 1280x800   # or whatever the user has resized to
```

If multiple bridges show up, several Tauri dev instances are running
(stale token files do **not** mean stale bridges — `kill -0 <pid>`
each one). Pass `--pid <pid>` to subsequent commands to disambiguate.

### 1.3 Stale Vite cache

If the Tauri sidecar log shows a JSX parse error referencing a line
that doesn't match the on-disk file, the Vite dependency cache is
stale — `rm -rf apps/operator-vite/node_modules/.vite` and restart the
Tauri dev shell. (Next.js is retired; there is no longer an
`apps/operator/.next` cache.)

### 1.4 First-run paths — clear stored state

Onboarding tests need a clean slate:

```sh
tauri-agent-tools eval "localStorage.clear(); sessionStorage.clear(); 'cleared'"
tauri-agent-tools eval "location.reload()"
```

`localStorage.clear()` works because the bridge runs inside the
webview — unlike pure-Rust IPC, it has full DOM access including
storage APIs.

## 2. Reporting format

```
[<route>] <feature>: PASS | FAIL | INCONCLUSIVE — <one sentence of evidence>
```

On `FAIL`, capture (one bundle command does most of this):

```sh
tauri-agent-tools capture -o /tmp/fail-<route>-<feature>
```

That writes screenshot + DOM snapshot + storage + console errors +
recent Rust logs to one directory. For the report, include:

* The capture-bundle path (or the `screenshot --selector` PNG if
  zooming on one element).
* The relevant DOM excerpt (`tauri-agent-tools dom <selector>` or the
  `dom.json` file from the capture bundle).
* Console errors (`tauri-agent-tools console-monitor --duration 100`
  during the failing action).
* Sidecar log tail (`tail -200 /tmp/tauri-dev.log`).

`PASS` requires positive evidence. **Silence is not success.** A test
that "looks fine" without a DOM/screenshot/log assertion is
`INCONCLUSIVE`.

For CI-style assertions inline in a script, prefer `check` — it
exits 0/1 and prints a structured failure:

```sh
tauri-agent-tools check \
  --selector 'aside.op-chat-sidebar [data-message]' \
  --text 'Generate Ideas' \
  --no-errors    # console must be clean
```

## 2.5 Verdict → tauri-agent-tools cheatsheet

The §3–§13 route tests below were written for verdict; the same
intent maps 1:1 to tauri-agent-tools. When you read `verdict <verb>`,
substitute the right column.

| Verdict (legacy)              | tauri-agent-tools                                                          | Notes                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verdict snapshot`            | `tauri-agent-tools dom --depth 4`                                          | Returns DOM tree, not ARIA. Add `--text "..."` to filter.                                                                                                 |
| `verdict js "<expr>"`         | `tauri-agent-tools eval "<expr>"`                                          | Returns JSON. Wrap in `JSON.stringify(...)` if the value is an object.                                                                                    |
| `verdict click <selector>`    | `tauri-agent-tools click <selector>`                                       | Real synthetic event inside the webview; no focus-steal.                                                                                                  |
| `verdict type <sel> <text>`   | `tauri-agent-tools type <sel> <text>`                                      | Sets value + dispatches `input` event.                                                                                                                    |
| `verdict press <sel> <key>`   | `tauri-agent-tools press <sel> <key>`                                      | e.g. `press input Enter`.                                                                                                                                 |
| `verdict screenshot <path>`   | `tauri-agent-tools screenshot --title Papercusp -o <path>`                 | Full window. `--selector` crop is currently flaky on this build (returns 1×1 PNG occasionally — fall back to full + crop in ImageMagick if it bites you). |
| `verdict console error`       | `tauri-agent-tools console-monitor --duration 200`                         | Window must be in scope; pass `--pid` if multiple bridges.                                                                                                |
| `verdict reload`              | `tauri-agent-tools eval "location.reload()"`                               | No dedicated `reload` verb.                                                                                                                               |
| `verdict newtab`              | (not applicable)                                                           | Tauri has one webview. For isolation, launch a second `tauri dev` against a different `PAPERCUSP_WORKSPACE_ROOT`.                                         |
| `verdict status`              | `tauri-agent-tools probe`                                                  | Lists running bridges + page state.                                                                                                                       |
| `localStorage.clear()` via JS | `tauri-agent-tools eval "localStorage.clear()"`                            | Works only because bridge is in-webview (Tauri's IPC alone can't).                                                                                        |
| (n/a)                         | `tauri-agent-tools storage --json`                                         | Dump localStorage / sessionStorage / cookies.                                                                                                             |
| (n/a)                         | `tauri-agent-tools ipc-monitor --duration 5000`                            | Capture every `__TAURI__.core.invoke` call — uniquely useful for debugging plugin/host wiring.                                                            |
| (n/a)                         | `tauri-agent-tools rust-logs --tail 200`                                   | Sidecar Rust log without rooting through `/tmp`.                                                                                                          |
| (n/a)                         | `tauri-agent-tools check --selector ... --text ... --eval ... --no-errors` | One-shot CI assertion; exits 0/1.                                                                                                                         |
| (n/a)                         | `tauri-agent-tools capture -o <dir>`                                       | Bundle: screenshot + DOM + storage + console + Rust logs. Use on every FAIL.                                                                              |

## 3. Global elements (every page except auth)

### 3.1 Header bar

Selectors: `header.pc-header`, `.pc-header .brand`, `.pc-header nav`.

| Element                                | Expected                                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.pc-header .brand` link               | href `"/"`                                                                                                                                                                                                          |
| `.pc-header .brand img:nth-of-type(1)` | `src="/mascot.svg"`, 28×28                                                                                                                                                                                          |
| `.pc-header .brand img:nth-of-type(2)` | `src="/wordmark.svg"`, height 22                                                                                                                                                                                    |
| `.pc-header-quote` text                | "Nothing is so painful…" (decorative)                                                                                                                                                                               |
| nav link "Marketplace"                 | navigates to `/marketplace/` (then redirects to `/marketplace/templates`… or shows the Overview tab)                                                                                                                |
| nav link "Support"                     | `/support`                                                                                                                                                                                                          |
| nav link "Settings"                    | `/settings/api-keys`                                                                                                                                                                                                |
| `WorkspaceSwitcher`                    | trigger button shows the current workspace; click toggles a dropdown with: per-workspace `Switch` button, `Rename` (inline), `Delete` (per row); a `Create workspace` action at the bottom; outside-click closes it |
| `SessionIndicator`                     | logged-out: `<a href="/login">Sign in</a>`; logged-in: user-email/name + a `Sign out` button calling `signOut()` (POST `/api/auth/logout`, then redirect to `/`)                                                    |

Verify both `/mascot.svg` and `/wordmark.svg` return 200 via `curl`.

### 3.1.1 Chatwoot widget (third-party)

Selector: `#cw-bubble-holder` (the launcher), `#cw-widget-holder`
(the panel).

| Element                          | Behavior                                                                                                                                                                 |                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Bubble launcher                  | always present (bottom-right when not occluded by Oracle FAB); click toggles widget                                                                                      |                                                                |
| Widget panel                     | when open, shows Chatwoot conversation UI loaded from `https://chat.papercupai.com` (`NEXT_PUBLIC_CHATWOOT_BASE_URL` overrideable); `launcherTitle: "Papercusp Support"` |                                                                |
| \`window.$chatwoot.toggle('open' | 'close')\`                                                                                                                                                               | programmatic open/close (used by `/support` "Talk to a human") |

If `NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` is unset, the widget is
suppressed entirely (no script tag injected). Verify via
`!!document.querySelector('#cw-widget-holder')`.

### 3.2 Oracle dock

Selectors: `.oracle-fab` (closed state), `.oracle-dock` (open),
`.oracle-form input` (chat input), `.oracle-msg-assistant`,
`.oracle-msg-user`, `.oracle-msg-content`, `.oracle-tool-chip`.

#### 3.2.1 First-visit auto-popup

```
verdict js "localStorage.removeItem('oracle_seen_v1'); sessionStorage.removeItem('oracle_history_v1');"
verdict reload
sleep 2
```

Assert: `dock=true`, `localStorage.oracle_seen_v1='1'`, the welcome
message ("Hi, I'm the Oracle…") is the first `.oracle-msg-content`.

Reload again — `dock=false`, `fab=true`. The popup must NOT re-fire.

#### 3.2.2 Open / close

| Action                      | Expected                                                                        |
| --------------------------- | ------------------------------------------------------------------------------- |
| Click `.oracle-fab`         | dock opens, input focusable, fab disappears                                     |
| Click `×` close button      | dock closes, fab reappears                                                      |
| Click `＋` "New chat" button | message list resets to welcome-only; `sessionStorage.oracle_history_v1` is null |
| Click `⚙` link              | `/settings/oracle` opens in same tab                                            |

#### 3.2.3 Text-only chat (no tool)

Type "What is Papercusp?" and submit. Within 30s:

* `.oracle-form input` becomes `disabled=false` (busy ends)
* A `.oracle-msg-assistant` exists with non-empty content
* No `.oracle-tool-chip` elements
* No URL change

#### 3.2.4 Tool: `navigate`

Type "Take me to /marketplace/snapshots." Within 8s:

* Tool chip with text starting `🔧 navigate` and arg
  `path: /marketplace/snapshots`
* `location.pathname === '/marketplace/snapshots'`
* Snapshots tab is selected (active state on the marketplace tabs)

#### 3.2.5 Tool: `listHarnesses`

Type "List my harnesses briefly." Within 15s:

* Tool chip `🔧 listHarnesses` (no args)
* Assistant message lists at least the registered harness slugs
  visible via `curl /api/harness/projects`

#### 3.2.6 Tool: `getHarnessStatus`

Type "What is the state of the sheets harness?" Within 25s:

* Tool chip `🔧 getHarnessStatus(slug: sheets)`
* Assistant message includes feature counts (passed/todo/blocked)
  and a recent-features hint or summary excerpt

#### 3.2.7 Tool: `dispatchToAgent`

Type "In sheets, ask the architect to write the word hello." Within
40s:

* Tool chips include `dispatchToAgent(slug: sheets, role: architect,
  message: …)`
* `location.pathname` becomes `/pi` with `?harness=sheets`
* A Dockview tab labeled `architect` (or with the chat title)
  appears in the tab strip
* `curl /api/harness/sheets/agent-chats` lists a new chat with
  `role: "architect"` and the user's message in `transcript`

#### 3.2.8 Tool: `listChats`

After §3.2.7. Type "What recent chats do I have in sheets?" Within
15s: tool chip `listChats(slug: sheets)` and assistant lists chats
including the one just created.

#### 3.2.9 Tool: `resumeChat`

Type "Resume the most recent architect chat." Within 25s:

* Tool chips include `listChats(slug: sheets, role: architect)` then
  `resumeChat(slug: sheets, chatId: <uuid>)`
* URL becomes `/pi?harness=sheets`
* The same chat tab is opened (no NEW chat row created — count via
  curl is unchanged)

#### 3.2.10 Persistence + new-chat

* Send a message, reload — assistant + user messages restored from
  `sessionStorage.oracle_history_v1`.
* Click `＋` New chat — sessionStorage entry is removed; messages
  reset to welcome only.

### 3.3 Keyboard shortcuts

The authoritative, always-current list is the **in-app cheat-sheet** —
`Ctrl+/` (or `?`) — and the remap editor at `/settings/shortcuts`; both
render live from `packages/operator-core/lib/shortcut-registry.ts`, so
prefer those over this table when they disagree. The high-traffic
defaults after the Discord-parity pass (discord-shortcuts 2026-06-06;
`⌘` on macOS = `Ctrl` elsewhere):

| Keys                             | Where                                        | Action                                                                                                            |
| -------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Ctrl+K` (alt `Ctrl+P`)          | everywhere                                   | open Command Palette (quick switcher)                                                                             |
| `Ctrl+/` (alt `?`)               | everywhere                                   | keyboard-shortcut cheat-sheet (`?shortcuts=1`)                                                                    |
| `Ctrl+,`                         | everywhere                                   | open Settings                                                                                                     |
| `Ctrl+I`                         | everywhere                                   | go to Conversations (inbox)                                                                                       |
| `Ctrl+Shift+N`                   | everywhere                                   | create a new harness (`?create=true` on /adv)                                                                     |
| `Ctrl+Shift+F`                   | everywhere                                   | global content search overlay (`?gsearch=1&gq=…`); hits are clickable → route to the harness view / conversations |
| `↑`                              | empty chat composer                          | recall your last sent message into the input (Discord ↑-to-edit analog)                                           |
| `Ctrl+U`                         | everywhere                                   | live-agents rail / member list (`?members=1`)                                                                     |
| `Ctrl+Shift+M`                   | everywhere                                   | toggle mic mute on the shared voice session (bus control)                                                         |
| `Ctrl+Shift+D`                   | everywhere                                   | toggle local deafen (playout off, transcripts continue)                                                           |
| `Ctrl+Shift+V`                   | video pane mounted                           | toggle camera (`?vcam=1`, VIDEO\_CHANNELS-gated)                                                                  |
| `Alt+↑` / `Alt+↓`                | `/adv`                                       | previous / next tab in the visible strip                                                                          |
| `Ctrl+Alt+←` / `Ctrl+Alt+→`      | `/adv`                                       | previous / next harness (pot)                                                                                     |
| `Alt+←` / `Alt+→`                | everywhere                                   | history back / forward                                                                                            |
| `Ctrl+F`                         | everywhere                                   | in-app find in page                                                                                               |
| `g` then `d`/`s`/`c`/`b`/`p`/`i` | harness tabs                                 | go-to tab (Linear-style sequence)                                                                                 |
| `Esc`                            | any modal/popover/dock                       | close (popover, modal, dock if open)                                                                              |
| `Esc`                            | feature search box                           | clear filter                                                                                                      |
| `↑` / `↓`                        | open command palette / inbox / proposal list | navigate selection                                                                                                |
| `Enter`                          | open command palette                         | execute selected command                                                                                          |
| `⌘+Enter` / `Ctrl+Enter`         | proposal goal editor textarea                | save edit                                                                                                         |
| `Tab` / `Shift+Tab`              | every form                                   | normal tab order through controls                                                                                 |
| Drag (mouse)                     | `/pi` dockview tabs                          | rearrange tabs / split groups                                                                                     |

## 4. Home (`/`)

Interactive inventory:

| Selector / role                 | Behavior                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| (header)                        | per §3.1                                                     |
| `link "Start setup"`            | → `/setup`                                                   |
| `link "Browse marketplace"` ×2  | → `/marketplace`                                             |
| `link "Open settings"`          | → `/settings/api-keys`                                       |
| `link "Open mission control"`   | → `/harness`                                                 |
| `link "Open marketplace"`       | → `/marketplace`                                             |
| `link "Open setup guide"`       | → `/setup`                                                   |
| `link "Why Papercusp exists →"` | → `/docs/spec` (or equivalent)                               |
| `<h1>`                          | contains `<img src="/wordmark.svg">` (no text)               |
| `ApiKeyStatus` block            | shows configured / unconfigured state for Anthropic / OpenAI |

Each link's destination resolves to 200 (`curl` head check).

## 5. Harness dashboard (`/harness` and `/harness/<slug>`)

Test on at least one of each kind:

* **Coding** flavor: `sheets` (has features, state, spec)
* **Org** flavor: `org` (department-style — top-level page may
  render `DepartmentHarnessDashboard`)

### 5.1 Top toolbar

| Selector                                           | Behavior                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button "Collapse top section"`                    | toggles `body.h-harness-top-collapsed`; second click expands                                                                                                                                                                                                    |
| `button "Set up phases"`                           | opens phase setup modal/panel                                                                                                                                                                                                                                   |
| `combobox "Select harness project"` (`.h-project`) | opens a Radix select listing projects grouped by kind (org / department / coding); selecting one updates `location.pathname` to `/harness/<slug>` via history.replaceState                                                                                      |
| `button "spent <amount>"`                          | opens the cost/usage detail panel (`?usage=true`) — same panel as `UsagePanel`                                                                                                                                                                                  |
| `button "Mission focus"`                           | the focus card on the phase-plan row; class `h-focus-card`; clicking calls `setPeekFeature(focusFeature)` → opens `FeaturePeekPanel` for the focus feature; visible only when `status` is loaded, the active panel isn't brainstorm, and a focus feature exists |
| `button "Review N issues"`                         | warn-styled button next to mission focus when `triageCount > 0`; opens `?triage=true`                                                                                                                                                                           |
| `button "⌘K"`                                      | opens the command palette (`CommandPalette` modal)                                                                                                                                                                                                              |
| `button "triage"`                                  | toggles `?triage=true`                                                                                                                                                                                                                                          |
| `button "save snapshot"`                           | opens the save-snapshot modal                                                                                                                                                                                                                                   |
| `button "start"`                                   | starts the autonomous run for the active harness; spinner replaces the button while in flight                                                                                                                                                                   |

### 5.2 Plugin actions toolbar

Per active harness, plugins that contribute toolbar actions appear
as buttons (one per `actions[].surfaces:[harness-toolbar]`):

* `Publish to Cloudflare` — opens action params form, then POSTs to
  `/api/plugins/invoke?slug=…&action=publish`. On success, toast
  with the deployment URL.
* `Run pending migrations` — postgres-manager
* `Inspect schema` — postgres-manager
* `Publish website` — cloudflare-pages-hosted
* `Create Linear issue` — linear-sync

For each: an `enable plugin` chip appears next to disabled actions
when the plugin isn't enabled in the active harness. Clicking the
chip enables the plugin and reveals the action.

### 5.3 Main tabs

Selectors: `tab[value=...]` via Radix Tabs.

| Tab            | Active condition | Body component                                                                                                                      |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `brainstorm`   | activeSlug set   | `BrainstormPanel` — sub-tab nav (Canvas / Map / Write) + chat toggle (right-rail `BrainstormChat`); see §5.16.4 for sub-tab details |
| `🪄 proposals` | activeSlug set   | `ProposalsPanel` — list + filters                                                                                                   |
| `dashboard`    | always           | feature lanes + status filters (default)                                                                                            |
| `summary`      | activeSlug set   | `SummaryPanel` — markdown rendered from `/api/harness/<slug>/summary`                                                               |
| `docs`         | activeSlug set   | docs iframe (fumadocs plugin)                                                                                                       |
| `vscode`       | activeSlug set   | code-server iframe (8082)                                                                                                           |
| `consoles`     | activeSlug set   | `<PiTerminalsDock>` mounted (dockview)                                                                                              |
| `insights`     | activeSlug set   | `InsightsPanel` charts                                                                                                              |
| `config`       | activeSlug set   | `ManifestSpecEditor` — edit the project's `papercusp.json` / spec                                                                   |

Tabs with `disabled` styling when no harness is selected — clicking
must be a no-op. Switching tabs updates `?panel=<id>`.

### 5.4 Add plugin

| Action                                                 | Expected                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click `.h-add-plugin-tab`                              | popover renders at `[data-add-plugin-popover][style*='position: fixed']`, lists installed-but-not-enabled plugins                                                                                                                                                        |
| Empty popover state                                    | "All installed plugins are already enabled here" with a Browse-marketplace link                                                                                                                                                                                          |
| Error state                                            | "Couldn't load plugins" with Retry button (when `/api/plugins/global` errored)                                                                                                                                                                                           |
| Click a candidate                                      | request goes out to `/api/plugins/enable`; popover stays open with disabled buttons during the 3–9s round-trip; on success, toast `"<plugin-name> enabled in <slug>"`, popover closes, dashboard refetches enabled list; `curl /api/plugins/enabled` reflects the change |
| Plugin requires templateKinds=\[coding] enabled on org | response is `{ok:false, error: "...templateKinds=[coding]; got org"}`; `toast.error` shows the error                                                                                                                                                                     |
| Press `Escape` while popover is open                   | popover closes                                                                                                                                                                                                                                                           |
| Click outside the popover                              | popover closes                                                                                                                                                                                                                                                           |

### 5.5 Left pane (inbox / git)

| Selector         | Behavior                                        |
| ---------------- | ----------------------------------------------- |
| `button "inbox"` | sets `?left=inbox`, shows triage inbox sub-pane |
| `button "git"`   | sets `?left=git`, shows the git graph           |

Inbox sub-pane:

| Element                       | Behavior                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `tab "All <n>"`               | unfiltered                                                     |
| `tab "Decisions <n>"`         | filter to decisions                                            |
| `tab "Threads <n>"`           | filter to threads                                              |
| `tab "Pinned <n>"`            | filter to pinned items                                         |
| `textbox "Search inbox"`      | live filter                                                    |
| `button "+ idea"`             | inline create new inbox idea row                               |
| `button "+ draft idea"`       | open `OperatorNoteForm` modal for a richer draft               |
| `button "syncing" [disabled]` | live indicator (becomes enabled when manual sync is available) |
| `button "latest" [disabled]`  | jump-to-latest inbox item                                      |

### 5.6 Status / phase filters (above feature list)

| Selector                                          | Behavior                              |
| ------------------------------------------------- | ------------------------------------- |
| `button "All <n>"`                                | clear status filter                   |
| `button "Running <n>"`                            | filter status=running                 |
| `button "Stuck <n>"`                              | filter status=stuck                   |
| `button "Blocked <n>"`                            | filter status=blocked                 |
| `button "Todo <n>"`                               | filter status=todo                    |
| `button "Passed <n>"`                             | filter status=passed                  |
| Phase tabs (`staging` / `testing` / `production`) | sets `?phase=`; feature lanes refetch |

### 5.7 Feature filter row

| Selector                       | Behavior                                           |
| ------------------------------ | -------------------------------------------------- |
| `combobox "Filter by project"` | restricts feature list to a single project         |
| `textbox "Filter by tag"`      | live tag filter                                    |
| `textbox "Search features"`    | live text search across feature titles             |
| `button "list" [pressed]`      | list view (default)                                |
| `button "board"`               | switch to board (kanban) view                      |
| `button "+ new"`               | open `FeatureEditor` modal to create a new feature |

### 5.8 Per-feature row actions

Each row exposes:

| Selector                 | Behavior                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkbox "Select <id>"` | toggle row selection (enables bulk ops)                                                                                                             |
| `button "steer"`         | opens an `InterventionPanel` for steering this feature                                                                                              |
| `button "chat"`          | calls `openFeatureChat({slug, role:'architect', featureId})` → custom event `papercusp:open-chat`, dock chat panel mounts on /pi or in consoles tab |
| `button "open in pi"`    | navigates to `/pi?harness=<slug>&lane=<id>`                                                                                                         |
| `button "edit"`          | opens `FeatureEditor` modal preloaded                                                                                                               |
| `button "reset"`         | confirmation modal, then POST `/api/harness/<slug>/features/<id>/reset`                                                                             |

Feature title click → opens `FeaturePeekPanel` on the right side.

### 5.9 Footer

| Selector                        | Behavior                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `button "issues <n>"`           | navigates to / opens issues view (`?issues=true` or `/harness/<slug>/issues`) |
| `button "tests"`                | opens TestsTab                                                                |
| `button "report" / "report md"` | opens promotion report panel                                                  |

### 5.10 Command palette (⌘K)

Open with `⌘K` / `Ctrl+K`. Type to filter. Sections + commands:

**Projects** — one entry per registered harness:

| Title                   | Action                                     |
| ----------------------- | ------------------------------------------ |
| `<slug>`                | switches `activeSlug` to that project      |
| Open `<slug>` in VSCode | calls `openInVSCode(<path>)` (file:// URI) |

**Control** — visible when a harness is active:

| Title                                   | Icon   | Action                                                |
| --------------------------------------- | ------ | ----------------------------------------------------- |
| Stop harness                            | `■`    | sends stop signal; visible only when running          |
| Pause harness (SIGSTOP)                 | (none) | suspends the running orchestrator process             |
| Unpause harness (SIGCONT)               | (none) | resumes the suspended orchestrator                    |
| Start harness                           | `▶`    | launches the orchestrator (visible only when stopped) |
| Edit config / spec                      | `✎`    | switches main panel to `config`                       |
| Open current project in VSCode          | `</>`  | open VSCode at project root                           |
| Triage — stuck/blocked/failing features | `🔺`   | sets `?triage=true`                                   |
| Insights — analytics                    | `📊`   | switches main panel to `insights`                     |
| Hooks — edit pre/post lifecycle scripts | `⚡`    | sets `?hooks=true`                                    |
| Intervene — send note to orchestrator   | `💬`   | sets `?intervene=true`                                |
| Usage — per-role cost breakdown         | `💵`   | sets `?usage=true`                                    |
| Snapshots — rollback mission state      | `⟲`    | sets `?snapshots=true`                                |
| Decisions — orchestrator verb timeline  | `🧠`   | sets `?decisions=true`                                |
| Smoke test — service gate               | `💨`   | sets `?smoke=true`                                    |
| Identity — cross-mission role memory    | `🧬`   | sets `?identity=true`                                 |
| Request checkpoint                      | (none) | POSTs to checkpoint endpoint                          |
| Screenshots — visual history            | `📸`   | sets `?screenshots=true`                              |
| Create new feature                      | `＋`    | opens `FeatureEditor` modal in 'new' mode             |

For each: open palette → type/scroll → activate → URL or panel state
matches the listed effect.

### 5.11 Query-param toggles (modal/side panels)

Each is a header-toolbar toggle (or command-palette action) that
flips a `parseAsBoolean` query param. Verify each one renders its
corresponding panel:

| Param               | Panel                               |
| ------------------- | ----------------------------------- |
| `?triage=true`      | `TriageQueue`                       |
| `?hooks=true`       | `HooksPanel`                        |
| `?intervene=true`   | `InterventionPanel`                 |
| `?usage=true`       | `UsagePanel`                        |
| `?snapshots=true`   | `SnapshotsPanel` (in-harness)       |
| `?screenshots=true` | `ScreenshotsPanel`                  |
| `?decisions=true`   | `DecisionsPanel`                    |
| `?smoke=true`       | `SmokeTestPanel`                    |
| `?identity=true`    | `IdentityPanel`                     |
| `?templates=true`   | `TemplatesModal`                    |
| `?archives=true`    | `ArchivesPanel`                     |
| `?diff=<id>`        | `FeatureDiffModal` for that feature |

For each: query param appears, panel renders, `Esc` or close-button
removes the param + closes panel.

### 5.12 Modal / panel internals

#### 5.12.1 `FeatureEditor` (`+ new` button or `edit` per-row)

| Field / control    | Behavior                                                                      |
| ------------------ | ----------------------------------------------------------------------------- |
| ID                 | text input; for new features, server assigns; for edit, read-only             |
| Title              | textarea, multiline, required                                                 |
| Summary            | textarea, longer-form description                                             |
| Status             | select: `todo`, `running`, `passed`, `failed`, `blocked`, `stuck`             |
| Attempts           | number input                                                                  |
| Save               | POSTs to `/api/harness/<slug>/features` (new) or PUT (edit); toast on success |
| Cancel / Close     | discards changes                                                              |
| Delete (edit mode) | confirmation → `DELETE /api/harness/<slug>/features/<id>`                     |

#### 5.12.2 `FeaturePeekPanel` (right-rail when feature title clicked)

Shows the feature's full transcript, linked claims, recent activity.

| Action                       | Behavior                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| Open architect chat          | calls `openFeatureChat({slug, role:'architect', featureId})` |
| Open worker chat             | same with `role:'worker'`                                    |
| Reset feature                | confirmation → reset endpoint                                |
| Close (`×` or click outside) | closes peek panel                                            |

#### 5.12.3 `FeatureDiffModal` (`?diff=<id>`)

Side-by-side diff vs prior version.

| Action                     | Behavior                                        |
| -------------------------- | ----------------------------------------------- |
| Toggle inline / split view | layout swap                                     |
| Apply / revert             | (when applicable) calls feature-update endpoint |
| Close                      | removes `?diff=`                                |

#### 5.12.4 `ProposalsPanel` (proposals tab)

Sidebar (`Proposal list`):

| Element                         | Behavior                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Search box                      | live filter on visible proposals                                                   |
| Status filter tabs (Radix Tabs) | filter by status (pending/accepted/rejected)                                       |
| `next` button                   | focus the next pending proposal                                                    |
| `shortlist only` toggle         | filter to shortlisted only                                                         |
| Each row                        | click selects + loads detail panel                                                 |
| Shortlist star toggle           | adds/removes from shortlist (`aria-label="Add to/Remove from proposal shortlist"`) |

Detail pane:

| Element                   | Behavior                                           |
| ------------------------- | -------------------------------------------------- |
| `edit goal` button        | switches to edit mode                              |
| Spec textarea (edit mode) | editable; aria-label `"Edit SPEC.md"`              |
| `save` button             | persists goal change                               |
| `cancel` button           | discards                                           |
| `replan now`              | POSTs replan; busy spinner during 3–10s round-trip |
| `dismiss` (replan prompt) | hides the replan prompt                            |
| Product review action     | runs review against the active goal                |

#### 5.12.5 `SummaryPanel`

Renders the markdown summary from `/api/harness/<slug>/summary`. No
controls beyond the rendered links (which navigate per the source
markdown).

#### 5.12.6 `InsightsPanel`

Charts: feature throughput, role-time histogram, cost over time. No
write controls — read-only analytics. Verify charts render (look for
`<canvas>` or `<svg>` elements) and labels are non-empty.

#### 5.12.7 `ManifestSpecEditor` (config tab)

| Element            | Behavior                                |
| ------------------ | --------------------------------------- |
| YAML / JSON editor | edits `papercusp.json` and/or `SPEC.md` |
| Save               | persists; toast on success              |
| Discard            | reverts unsaved changes                 |
| Close              | exits edit mode                         |

#### 5.12.8 `HooksPanel` (`?hooks=true`)

| Element                                                                 | Behavior                  |
| ----------------------------------------------------------------------- | ------------------------- |
| List of lifecycle stages (pre-worker, post-worker, pre-validator, etc.) | each row shows the script |
| Edit button per row                                                     | opens an inline editor    |
| Save                                                                    | persists script content   |
| Test run                                                                | dry-runs the script       |
| Add new hook                                                            | append a new row          |

#### 5.12.9 `InterventionPanel` (`?intervene=true`)

| Element       | Behavior                                                     |
| ------------- | ------------------------------------------------------------ |
| Note textarea | message to send to the orchestrator                          |
| Send button   | POST to `/api/harness/<slug>/operator-notes`; toast confirms |

#### 5.12.10 `UsagePanel` (`?usage=true`)

Shows per-role cost + token breakdown for the current run window.
Read-only with a `close` action.

#### 5.12.11 `SnapshotsPanel` (in-harness, `?snapshots=true`)

| Element       | Behavior                                            |
| ------------- | --------------------------------------------------- |
| Save snapshot | invokes `papercusp snapshot save`; toast on success |
| Each row      | shows date, size, description                       |
| Restore       | confirmation → `papercusp snapshot restore`         |
| Delete        | confirmation → delete snapshot                      |

#### 5.12.12 `ScreenshotsPanel` (`?screenshots=true`)

Read-only image grid of captured screenshots. Click to expand.

#### 5.12.13 `DecisionsPanel` (`?decisions=true`)

Timeline of orchestrator decisions (verb log). Filter by verb /
role. No write actions.

#### 5.12.14 `SmokeTestPanel` (`?smoke=true`)

| Element         | Behavior                                                              |
| --------------- | --------------------------------------------------------------------- |
| `Run smoke`     | invokes the smoke gate; spinner during run; result badge: pass / fail |
| Per-step expand | shows logs                                                            |
| Re-run failed   | re-runs only failures                                                 |

#### 5.12.15 `IdentityPanel` (`?identity=true`)

Cross-mission role memory. Read-mostly with an "edit" affordance per
role.

#### 5.12.16 `TemplatesModal` (`?templates=true`)

Apply a harness template to the active project. Wizard-style:

| Step             | Element             | Action                                  |
| ---------------- | ------------------- | --------------------------------------- |
| 1. Pick template | template card grid  | select                                  |
| 2. Configure     | per-template params | fill                                    |
| 3. Confirm       | `Apply` button      | POST to install; close modal on success |

#### 5.12.17 `ArchivesPanel` (`?archives=true`)

Lists archived chats / features. Each row exposes a `restore` action.

#### 5.12.18 `OperatorNoteForm` (inbox `+ draft idea`)

| Element       | Behavior           |
| ------------- | ------------------ |
| Title input   | required           |
| Body textarea | markdown supported |
| Tags input    | comma-separated    |
| Save          | POST to inbox      |

### 5.13 Conditional banners

These render at the top of the dashboard only when their guard fires.
Test by triggering the underlying state.

| Banner             | Renders when                                                          | Actions                                                                       |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `PlanReviewBanner` | `/api/harness/<slug>/plan-review` returns content + not yet dismissed | `Approve`, `Dismiss` (sets local state)                                       |
| `CheckpointBanner` | `/api/harness/<slug>/checkpoints` has at least one entry              | per-row: `Restore`, `Promote` (or similar)                                    |
| `EscalationBanner` | live status payload includes `escalation` and `escalated=true`        | `Acknowledge`, `Resolve`, `Open chat` (architect), `Open chat` (orchestrator) |
| `PromotionCard`    | a feature is queued for promotion                                     | `Promote`, `Reject`                                                           |

For each: simulate the trigger (or pick a harness in the right state),
verify banner appears, click each action, verify state mutation
(banner dismisses, status changes, chat opens, etc.).

### 5.14 Issues view (`button "issues <n>"`)

Selectors: `IssuesList` toolbar + per-row action buttons.

| Element                                                             | Behavior                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Toolbar filter buttons                                              | filter by status (`open` / `acknowledged` / `fixing` / `closed` / `wontfix`) |
| Per-row `aria-label="Open <severity> <status> issue <id>: <title>"` | opens `IssueDetail`                                                          |
| Per-row `promote` button                                            | POST promote action; row updates or moves                                    |
| Per-row `ack` (acknowledge)                                         | POST ack action; status → `acknowledged`                                     |
| Per-row `close` (success styling)                                   | confirms then closes; status → `closed`                                      |
| Per-row `won't fix` (danger styling)                                | confirms then sets status → `wontfix`                                        |

`IssueDetail`:

| Element                               | Behavior                                         |
| ------------------------------------- | ------------------------------------------------ |
| `×` close button                      | back to list                                     |
| Note textarea                         | add a note                                       |
| `Add note` button                     | enabled only when text non-empty; POST adds note |
| Linked feature link (when applicable) | navigates to feature peek                        |

### 5.15 Tests / report sub-views

`button "tests"` opens `TestsTab`:

| Element        | Behavior                                             |
| -------------- | ---------------------------------------------------- |
| Test run list  | each row: status badge, duration, last-run timestamp |
| Run all        | invokes test run for the active phase                |
| Per-row `Run`  | re-runs that single test                             |
| Per-row expand | shows stdout / stderr                                |

`button "report"` (or `report md`) opens promotion-report view —
markdown summary of what's promotable; copy to clipboard, download
as MD.

### 5.16 Per-harness sub-tabs (selected via main tab nav)

Several plugin-mounted or built-in tabs are reachable as
`?panel=<id>` once the user enables them. Cover each:

#### 5.16.1 `CollectionTab` (collections of files)

| Element             | Behavior                                            |
| ------------------- | --------------------------------------------------- |
| File list           | each row clickable → loads contents into editor     |
| Editor              | textarea / code editor; `dirty` flag enables `save` |
| `save` button       | persists; toast on success                          |
| `delete` (per file) | confirmation → DELETE; toast on success             |

#### 5.16.2 `MemoryBrowser`

| Element                                           | Behavior                       |
| ------------------------------------------------- | ------------------------------ |
| Tree of memory entries (per role / cross-mission) | click expands                  |
| Search / filter                                   | live filter                    |
| Edit per entry                                    | inline editor; `save` persists |

#### 5.16.3 `BrainstormPanel`

Top-level wrapper for the `brainstorm` tab.

| Element                                | Behavior                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------- |
| Sub-tab nav (`Canvas`, `Map`, `Write`) | per-tab views; only one renders at a time                                   |
| `Canvas` view                          | freeform whiteboard; idea nodes draggable; double-click to edit             |
| `Map` view                             | tree / mind-map of related ideas                                            |
| `Write` view                           | long-form draft mode (textarea / editor)                                    |
| Chat toggle button                     | opens / closes the right-rail `BrainstormChat` panel                        |
| `BrainstormChat`                       | mini chat with the brainstorm agent; same SSE stream pattern as agent chats |

#### 5.16.4 `PromptsTab`

| Element                    | Behavior                                            |
| -------------------------- | --------------------------------------------------- |
| Per-role prompt rows       | click loads the role's prompt into editor           |
| Editor (per-role override) | textarea; `dirty` flag                              |
| `save override`            | POST to `/api/harness/<slug>/prompts/<role>`; toast |
| `delete override`          | reverts to default; toast                           |

## 5.17 Org-flavor harness (`DepartmentHarnessDashboard`)

When `harness_kind === 'department'`, `/harness/<slug>` mounts
`DepartmentHarnessDashboard` instead of `HarnessDashboard`. The UI
is structured around departmental flow rather than feature lanes.

| Selector                             | Behavior                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| `button "Inbox"`                     | shows incoming briefings/decisions                           |
| `button "Outbox"`                    | shows outgoing items the department has produced             |
| `button "Compose"`                   | opens compose form (briefing / decision)                     |
| `button "Decisions"`                 | filters / shows decisions log                                |
| `button "Charter"`                   | renders the department's charter doc (read-only or editable) |
| `button "Director notes"`            | shows / edits notes from the department's director role      |
| `button "Memory"`                    | shows long-term department memory                            |
| `button "Director agent"`            | opens a chat with the Director role                          |
| `button "full stdout"` (in run logs) | toggle to show full stdout for a run                         |
| `<input>` (Compose form)             | title input                                                  |
| `<textarea>` (Compose form)          | body, markdown                                               |
| `button "Send"`                      | POSTs the message; toast on success                          |
| `button "Reload"` (`onClick={load}`) | refetches data                                               |

For each: click → inner content swaps; verify expected list/form
renders. The header bar and Oracle dock remain as in §3.

## 6. Pi route (`/pi?harness=<slug>`)

Selectors: `.dv-dockview`, `.dv-tab`, `.dv-default-tab-content`.

| Action                                                          | Expected                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Open `/pi?harness=sheets`                                       | dockview mounts; default tab `terminal 1` (PTY connected to project root)                                      |
| Drag a tab into a split                                         | layout updates; persists in `localStorage.dockview.layout.<slug>`                                              |
| Trigger `papercusp:open-chat` event with `{slug, chatId, role}` | new tab appears for the chat (if not already open); panel renders `<ChatPanel>`                                |
| Archive a chat (DELETE) then revisit                            | corresponding tab is auto-pruned via `pruneStaleChatPanels`                                                    |
| `?lane=<id>` query param                                        | initial PTY cwd = the feature's worktree, not the project root                                                 |
| Send a message in the chat panel                                | streams from `/api/harness/<slug>/agent-chats/<chatId>/messages` (SSE); transcript scrolls; cost meter updates |
| Click tab `×` close button                                      | tab closes; layout updates                                                                                     |
| Right-click on tab                                              | context menu (rename / move to new group / close others) where supported                                       |
| Drop a tab onto an edge                                         | splits the active group into two                                                                               |
| Resize split via drag                                           | sash position persists                                                                                         |
| `?lane=<id>` is set                                             | terminal opens with the feature's branch checked out                                                           |

`<ChatPanel>` (each agent chat tab) interactive elements:

| Selector                   | Behavior                                                  |
| -------------------------- | --------------------------------------------------------- |
| Transcript list            | renders user/assistant turns with role labels             |
| Token counter / cost meter | updates after each turn                                   |
| Input textarea             | message input                                             |
| `Send` button              | POST `/messages`; transcript appends; SSE stream consumed |
| `Archive` / `×`            | DELETE the chat; tab closes after pruning                 |

## 7. Marketplace (`/marketplace*`)

`/marketplace` itself renders the **Overview** tab. The shared
layout shows tabs nav (`.pc-tabs`) with four tabs:

| Tab       | Path                     | Description                                          |
| --------- | ------------------------ | ---------------------------------------------------- |
| Overview  | `/marketplace`           | how-it-works hero with category links + search       |
| Harnesses | `/marketplace/templates` | ready workflows (label was "Templates" historically) |
| Plugins   | `/marketplace/plugins`   | extra tools                                          |
| Snapshots | `/marketplace/snapshots` | saved setups                                         |

For each: clicking the tab navigates correctly; active tab gets
`pc-tab active` class with cyan underline.

### 7.1 Overview tab (`/marketplace`)

| Selector                                                        | Behavior                                     |
| --------------------------------------------------------------- | -------------------------------------------- |
| `link "Search the marketplace"`                                 | scrolls to / focuses search box              |
| `link "Browse templates"`                                       | → `/marketplace/templates`                   |
| `link "Add plugins"`                                            | → `/marketplace/plugins`                     |
| `searchbox "Search templates or plugins"`                       | live filter; submitting routes to results    |
| `button "Search templates"`                                     | filter scope = templates only                |
| `button "Search plugins"`                                       | filter scope = plugins only                  |
| Category links (`coding`, `research`, `cloudflare`, `postgres`) | filter by category                           |
| "Add tools later" / "Save progress" cards                       | jump to /plugins and /snapshots respectively |

### 7.2 Templates tab (`/marketplace/templates`)

| Selector                                      | Behavior                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `searchbox`                                   | live filter on visible templates                                                                       |
| Each template `link` (e.g. `papercup-coding`) | → `/marketplace/templates/<slug>` detail page                                                          |
| `button "Fresh project"`                      | opens install modal for "create new directory" install path                                            |
| `button "Attach existing…"`                   | opens install modal for "use existing dir" path                                                        |
| `button "Install (N sub-harnesses)"`          | for templates with subprojects, installs N harnesses with the parent's suffixes                        |
| Detail page `Install` button                  | POSTs to `/api/marketplace/install`; toast on success; "Installed" badge replaces button after refetch |

### 7.3 Plugins tab (`/marketplace/plugins`)

| Selector                                         | Behavior                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `searchbox`                                      | live filter                                                         |
| Each plugin `link` (e.g. `@papercupai/fumadocs`) | → detail page                                                       |
| `button "Install plugin"`                        | POSTs to `/api/marketplace/install` (kind=plugin); toast on success |

### 7.4 Detail page (`/marketplace/<encoded-slug>`)

Routes for individual templates / plugins. Slug is URL-encoded
(e.g. `@papercupai/fumadocs` → `%40papercupai%2Ffumadocs`). The
list-page links produce these URLs automatically.

| Element                        | Behavior                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Tabs nav                       | still visible (Overview / Templates / Plugins / Snapshots)                                                          |
| `link "← back to marketplace"` | → `/marketplace`                                                                                                    |
| `<h1>`                         | plugin/template name                                                                                                |
| Meta line                      | version · license · author                                                                                          |
| Description                    | full markdown description                                                                                           |
| Install commands block         | static shell snippets (`papercusp install <slug>` and friends); not clickable buttons today — copy via OS clipboard |
| Versions list                  | every published version                                                                                             |

For an unknown slug, the page currently renders a placeholder showing
the slug name (returns 200, not 404). Verify the page structure for a
real slug; for an unknown one, expect 200 with the literal slug as a
fallback heading. (Historical behaviour was 404; the catch-all route
was made permissive — track whether this should be tightened.)

### 7.5 Snapshots tab (`/marketplace/snapshots`)

| Selector                | Behavior              |
| ----------------------- | --------------------- |
| Each snapshot `link`    | → snapshot detail     |
| `button "Refresh"`      | refetches the catalog |
| `link "Open harnesses"` | → `/harness`          |

## 8. Snapshots top-level (`/snapshots`)

| Selector                       | Behavior                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button "Refresh"`             | refetches `/api/snapshots` list                                                                                                                                                                                                                       |
| `link "Harnesses"`             | → `/harness`                                                                                                                                                                                                                                          |
| Each row                       | shows harness slug, name, description, size, created date, files count, plugins count, license, redaction tier                                                                                                                                        |
| Row expand                     | shows redaction summary + verified/highRecallHits                                                                                                                                                                                                     |
| (per-row) `Instantiate` button | opens fork-from-snapshot modal — picks a destination harness slug; calls `papercusp snapshot fork`                                                                                                                                                    |
| (per-row) `Publish` button     | calls `papercusp snapshot publish`; toast with new snapshot id; "published" badge                                                                                                                                                                     |
| (per-row) `Retract` button     | reverses publish — POST `/api/snapshots/<id>/retract` with `{marketplaceSlug: "<slug-returned-by-publish>"}`. The marketplaceSlug is required; without it the server returns 400 "marketplaceSlug required". Removes from `/api/marketplace/catalog`. |
| (per-row) `Delete` button      | confirmation modal → `DELETE /api/snapshots/<id>`                                                                                                                                                                                                     |

## 9. Settings (`/settings/<section>`)

Sidebar (`.pc-settings-nav`):

| Link           | Path                       |
| -------------- | -------------------------- |
| API keys       | `/settings/api-keys`       |
| Oracle         | `/settings/oracle`         |
| Profile        | `/settings/profile`        |
| Publishing     | `/settings/publishing`     |
| Plugin runtime | `/settings/plugin-runtime` |

Each link click: URL updates, sidebar `active` class moves, body
swaps to new form.

### 9.1 API keys (`/settings/api-keys`)

| Selector                                 | Behavior                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textbox "Anthropic API key"`            | placeholder shows masked existing value (`sk-…1234`)                                                                                              |
| `textbox "OpenAI API key"`               | same                                                                                                                                              |
| `textbox "GitHub personal access token"` | same                                                                                                                                              |
| `button "Save"`                          | empty fields are skipped; non-empty fields POST to `/api/credentials`; toast `"Saved to ~/.papercusp/credentials.json"`; reloading shows new mask |

### 9.2 Oracle (`/settings/oracle`)

| Selector           | Behavior                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `textbox` (prompt) | renders contents of `~/.papercusp/oracle/prompt.md`                                             |
| `textbox` (memory) | renders contents of `~/.papercusp/oracle/memory.md`                                             |
| `button "Save"`    | PUTs `/api/oracle/config`; toast on success; file on disk reflects new value (verify via `cat`) |

### 9.3 Profile (`/settings/profile`)

| Selector                                                                  | Behavior                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `textbox "Email (optional)"`                                              | persists to profile.json                                                                    |
| `textbox "Display name"`                                                  | same                                                                                        |
| `textbox "Default project directory"`                                     | path validation; persists                                                                   |
| `textbox "scoper" / "worker" / "validator" / "reviewer" / "orchestrator"` | per-role model overrides (e.g. `claude-sonnet-4-6`); persists in `profile.preferred_models` |
| `button "Save"`                                                           | toast on success                                                                            |

### 9.4 Publishing (`/settings/publishing`)

Backed by `/api/publish-credentials`. Fields are fetched on mount; UI
shows current registration + credentials masked.

| Element                          | Behavior                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId` (read-only display)   | the tenant id assigned at registration                                                                                                                                                                      |
| `tenantSecretMasked` (read-only) | masked secret (`pcs_…1234`)                                                                                                                                                                                 |
| `registeredAt`                   | ISO timestamp                                                                                                                                                                                               |
| `publishHost`                    | host used for publishes (e.g. `publish.papercupai.com`)                                                                                                                                                     |
| `Rotate secret` button           | confirmation dialog "Rotate the publish secret? The old secret stops working immediately."; on confirm, POST `/api/publish-credentials/rotate`; toast `"Secret rotated."`; new masked value appears         |
| `Forget credentials` button      | confirmation "Delete local publish credentials? Future publishes will register a fresh tenant."; on confirm, DELETE `/api/publish-credentials`; toast `"Credentials cleared."`; UI shows unregistered state |

### 9.5 Plugin runtime (`/settings/plugin-runtime`)

| Selector               | Behavior                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `button "Reset cache"` | clears the in-process plugin host cache + `require.cache`; toast on completion; subsequent plugin invocations recompile fresh |

## 10. Support (`/support`)

| Selector                           | Behavior                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `button "💬 Start support chat"`   | opens Chatwoot widget (`window.$chatwoot.toggle('open')`)                                                                                                           |
| `link "🐛 Open a GitHub issue"`    | → repo issues page                                                                                                                                                  |
| `link "📚 Browse the docs"`        | → `/docs`                                                                                                                                                           |
| `link "full documentation"`        | → `/docs`                                                                                                                                                           |
| `link "marketing site"`            | → marketing url                                                                                                                                                     |
| `link "issue tracker"`             | → repo issues                                                                                                                                                       |
| `link "5-step setup"`              | → `/setup`                                                                                                                                                          |
| `SupportAgentPanel` (when present) | budget cap UI + chat input + SSE stream from `https://api.papercuspai.com/v1/support/chat`; cap-exceeded warning banner + "Talk to a human" button when over budget |

## 11. Auth pages

### 11.1 `/login`

| Selector                   | Behavior                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| `textbox "Email"`          | email input                                                              |
| `button "Send magic link"` | POSTs to auth-magic-link endpoint; on success "Check your email" message |
| `link "settings"`          | → `/settings/api-keys`                                                   |

### 11.2 `/signup`

Currently redirects to `/login` (single magic-link flow handles both
signin and signup).

### 11.3 `/setup`

A linkified setup guide (not a wizard with form steps in the current
build). Verify each link routes correctly:

| Link                    | Destination                |
| ----------------------- | -------------------------- |
| `← back to home`        | `/`                        |
| `/harness`              | `/harness`                 |
| `home page`             | `/`                        |
| `Settings → API keys`   | `/settings/api-keys`       |
| `Anthropic API key`     | external Anthropic console |
| `Marketplace`           | `/marketplace`             |
| `issue`                 | github issues              |
| `papercusp.com/support` | external support site      |

## 12. Docs (`/docs`)

| Selector                                                                     | Behavior                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `link "Papercusp Spec"`                                                      | header link                                                               |
| `button "Collapse Sidebar"`                                                  | hides the left nav                                                        |
| `button "Search ⌘ K"`                                                        | opens Fumadocs search palette; type to filter                             |
| Sidebar buttons (`Data Sync`, `Design`, `Implementation`, `Spec`, `Testing`) | expand the section, listing pages                                         |
| `button "Toggle Theme"`                                                      | flips light/dark                                                          |
| `button "Open Search"`                                                       | same as `Search ⌘ K`                                                      |
| Body links                                                                   | navigate within docs; page renders MDX (callouts, code, tables) correctly |
| `Testing` → `Agent E2E playbook`                                             | opens this page                                                           |

Full sidebar enumeration (verify each page renders 200):

| Section        | Pages                                                                          |
| -------------- | ------------------------------------------------------------------------------ |
| Top-level      | `index`, `branding`                                                            |
| Data Sync      | `index`, `cookbook`, `named-queries`, `schema`, `zero`, `pitfalls`, `richgrid` |
| Design         | (per `content/internal-docs/design/meta.json`)                                 |
| Implementation | `status`, `orchestrator-port`, `marketplace`, `pi-integration`                 |
| Spec           | `capabilities`, `open-questions`, plus other `spec/*.mdx` files                |
| Testing        | `index` (testing strategy), `agent-e2e` (this page)                            |

For each page: load it, verify h1 renders, no parse errors in
operator log, body has at least one heading and one prose paragraph.

Search box (`⌘K`):

| Action                              | Expected                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| Open palette                        | input focused, suggestion list shows recent / popular pages |
| Type a heading word (e.g. "Oracle") | results match across all docs pages                         |
| Click a result                      | navigates to that doc with hash anchor scrolled             |
| `Esc`                               | closes palette without navigating                           |

## 12.5 Auth state matrix

Every page may render slightly differently when logged out vs
logged in. Verify both states (or at least cover the deltas):

| State      | Header                                          | Pages requiring auth                                       |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------- |
| Logged out | "Sign in" link in nav (from `SessionIndicator`) | `/login` accessible; protected routes redirect to `/login` |
| Logged in  | user email / avatar; Sign-out menu item         | full nav, all routes accessible                            |

`WorkspaceSwitcher` may show a default workspace logged out and the
authenticated user's workspaces logged in.

## 12.6 Empty states

The following empty states should each render gracefully (not throw,
not show a console error). Trigger by exercising on a fresh
machine / new workspace:

| Surface                                  | Empty-state copy / hint                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `/harness` no projects registered        | "No harnesses yet" + link to `/setup` or "+ register harness"          |
| Add-plugin popover, all enabled          | "All installed plugins are already enabled here. Browse marketplace →" |
| Add-plugin popover, none installed       | "No plugins installed. Browse plugins →"                               |
| `/snapshots` empty                       | "No snapshots yet" + link to harness                                   |
| `/marketplace/snapshots` no published    | empty list state                                                       |
| Inbox `All 0`                            | empty list with "+ idea" prompt                                        |
| Feature list `All 5` (or whatever count) | rows; if count is 0, an empty-state row                                |
| Issues view `<n>=0`                      | empty state                                                            |
| Tests tab no tests configured            | empty state with link to TESTING.md                                    |
| Per-role chat with no messages           | empty transcript with input                                            |

## 12.7 Error states

Trigger each by stopping the relevant backend / passing a bad
parameter:

| Surface                            | Trigger                                       | Expected                                                          |   |            |
| ---------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | - | ---------- |
| `/api/oracle/chat`                 | malformed body                                | 400 with `{error: "messages required"}`; dock shows `⚠ <message>` |   |            |
| Add-plugin popover                 | `/api/plugins/global` returns non-200         | popover shows "Couldn't load plugins" + Retry                     |   |            |
| Plugin enable                      | server returns `{ok:false, error:"..."}`      | `toast.error` with description \`(d.results?.\[0]?.log            |   | d.error)\` |
| `/marketplace/<slug>` unknown slug | path doesn't match registered template/plugin | 404 page "This page could not be found."                          |   |            |
| `/harness/<slug>` unknown slug     | not in registry                               | `notFound()` triggers Next.js 404                                 |   |            |
| `/pi` without `?harness=<slug>`    | missing query param                           | inline message: "Missing `?harness=<slug>` query parameter."      |   |            |
| Settings save                      | `/api/credentials` 500                        | `toast.error("save failed: …")`                                   |   |            |

## 13. Coverage checklist (paste into report)

```
[ /]                home renders, h1 wordmark, all 7+ CTA links resolve
[ /harness]         dashboard mounts, harness picker (combobox)
[ /harness — top]   collapse, set-up-phases, ⌘K, triage, save snapshot, start, cost
[ /harness — actions] cf, migrations, schema, website, linear (each)
[ /harness — tabs]  brainstorm proposals dashboard summary docs vscode consoles insights config
[ /harness — phase] staging testing production
[ /harness — addpl] popover empty/error/normal/templateKinds-mismatch paths
[ /harness — left]  inbox vs git pane
[ /harness — inbox] All Decisions Threads Pinned + search + (+ idea / + draft idea)
[ /harness — status]All Running Stuck Blocked Todo Passed
[ /harness — filt]  project tag search list/board +new
[ /harness — feat]  steer chat open-in-pi edit reset (per row)
[ /harness — ⌘K]    each Project + Control command (~17 entries) routes correctly
[ /harness — modals]triage hooks intervene usage snapshots screenshots decisions smoke identity templates archives diff
[ /harness — modal-internals] FeatureEditor (id/title/summary/status/attempts/save/cancel/delete), FeaturePeekPanel (open chats per role, reset, close), FeatureDiffModal, ProposalsPanel (search/filter/edit-goal/replan/dismiss/shortlist), HooksPanel, InterventionPanel (textarea+send), UsagePanel, in-harness SnapshotsPanel (save/restore/delete), DecisionsPanel, SmokeTestPanel (run/expand/re-run-failed), IdentityPanel, TemplatesModal (3-step wizard), ArchivesPanel (restore), OperatorNoteForm
[ /harness — banners] PlanReview (approve/dismiss), Checkpoint (restore/promote per row), Escalation (ack/resolve/open chats), Promotion (promote/reject)
[ /harness — issues]  filter, promote, ack, close, won't-fix, IssueDetail add-note
[ /harness — tests]   run all, per-row run, expand stdout/stderr
[ /harness — report]  promotion-report markdown view, copy/download
[ /harness — sub-tabs] CollectionTab (file list/edit/save/delete), MemoryBrowser (tree/edit), PromptsTab (per-role override save/delete)
[ /harness — dept]    DepartmentHarnessDashboard: Inbox Outbox Compose Decisions Charter "Director notes" Memory "Director agent"
[ /harness — foot]  issues tests report
[ /pi]              terminal default, dockview layout persistence, openChat event, prune, ChatPanel send/archive
[ /pi — controls]   tab close, drag-split, resize sash, ?lane=&lt;id&gt; for feature worktree
[ /marketplace]     overview/templates/plugins/snapshots tabs all switch
[ /marketplace/templates] fresh project, attach existing, install (N sub-harnesses)
[ /marketplace/plugins]   install plugin (per plugin)
[ /marketplace/snapshots] each snapshot link, refresh, open harnesses
[ /marketplace/&lt;slug&gt;] detail page renders name/version/license/author/description/install/versions; bad slug → 404
[ /snapshots]       list, refresh, harnesses link, publish/delete/fork per row
[ /settings/api-keys] anthropic openai github + Save
[ /settings/oracle]   prompt + memory + Save
[ /settings/profile]  email name dir + 5 model fields + Save
[ /settings/publishing] static copy / form (verify what's there)
[ /settings/plugin-runtime] Reset cache
[ /support]         chat button, github link, docs link, agent panel
[ /login]           magic link flow
[ /signup]          redirects to /login
[ /setup]           link guide
[ /docs]            every section page (branding/data-sync/*, design/*, implementation/*, spec/*, testing/*); search palette; theme toggle; sidebar collapse
[ Keyboard]         ⌘K palette, Esc closes modals/popovers/dock, ↑/↓ in palette, ⌘+Enter in proposal goal editor, drag in dockview
[ Auth states]      logged-out vs logged-in nav + protected route redirects
[ Empty states]     no-harnesses, no-plugins-installed, no-snapshots, empty inbox, empty issues, empty tests
[ Error states]     malformed oracle body, plugins/global down, plugin-enable rejection, unknown marketplace slug, /pi without harness, settings 500
[ Oracle dock]      auto-popup, fab, send, navigate, listHarnesses, getHarnessStatus, dispatchToAgent, listChats, resumeChat, persistence, new chat, settings link
[ Header]           brand pair, Marketplace Support Settings, WorkspaceSwitcher, SessionIndicator
```

## 14. What "PASS" means

PASS only if **all of**:

1. The action was performed via verdict (clicks/fills, not curl).
2. The DOM after the action matches the documented expectation.
3. Backend state (where applicable) is corroborated via `curl` or
   the operator log.
4. No console errors with severity ≥ `error` were emitted by the
   action (run `verdict console error`).

Anything else → `FAIL` or `INCONCLUSIVE`. Don't report PASS without
positive evidence — silence is not success.

## 15. Common gotchas

* **Verdict shares chromium with the human user.** Long
  click-and-wait sequences fail when the user is browsing. Run
  `verdict status` first.
* **Sonner Toasts are lazy.** `[data-sonner-toaster]` only mounts
  when at least one toast is active. The empty
  `<section aria-label="Notifications alt+T">` is just the
  accessibility announcer. To assert a toast appeared, query
  `[data-sonner-toaster] li` *during* the action, not after the
  toast has timed out.
* **Add-plugin enable is slow (3–9s).** No spinner. Wait for
  `curl /api/plugins/enabled` to reflect the change; don't time out
  early.
* **`/marketplace` URL behavior changed.** It now renders the
  Overview tab directly (4 tabs total: Overview, Templates,
  Plugins, Snapshots) — not a redirect to `/templates`.
* **Stream parser unwrap.** Oracle stream events arrive as
  `{type:"stream_event", event:{type:"content_block_delta",
  delta:{...}}}` — parsing top-level `content_block_delta` silently
  drops every text token. (Already handled server-side; relevant
  if you're writing a new SSE consumer.)
* **Stale Vite parse cache.** If a JSX parse error references a
  line that doesn't match the on-disk file, the cache is stale.
  `rm -rf apps/operator-vite/node_modules/.vite` and restart. (Next.js
  is retired — there is no `.next` cache anymore.)
* **Harness tab nav uses `?panel=`.** `panel=plugin:<id>` selects a
  plugin-contributed tab. Test these the same way as built-in tabs.
* **`tauri-agent-tools screenshot --selector` is flaky on tiny
  elements.** A short input (e.g. the operator composer at \~187×42
  px) sometimes returns a 1×1 PNG. Workaround: `screenshot --title Papercusp -o full.png` then crop in ImageMagick using the
  rect from `eval "JSON.stringify($('input').getBoundingClientRect())"`.
* **`ipc-monitor` is silent for the operator chat.** The composer
  sends via HTTP/SSE to `/api/agent-mcp/operator-converse`, not via
  Tauri IPC. Use `console-monitor`, `rust-logs`, or
  `curl /api/operator/conversations/<id>` to corroborate.
  `ipc-monitor` *is* the right tool for plugin/host wiring,
  workspace switching, and shell-sidecar calls.
* **Bridge port is per-process.** `tauri-agent-tools probe` reports
  the live port (e.g. `34875`); restart the dev shell and the port
  changes. Always `probe` before scripting a sequence.
* **Radix tabs (and other pointerdown-activated Radix widgets) ignore
  plain `click`.** A programmatic `el.click()` (or the bridge `click`
  verb) dispatches only a `click` event; Radix `Tabs` activate on
  *pointerdown*, so the tab looks clicked but selection and the nuqs
  `?tab=` param never change — and your test silently measures nothing.
  Dispatch the full sequence:
  `for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window}))`.
  Plain anchors are fine with `click`. (Found 2026-06-10; cost a full
  battery round of invalid tab numbers.)
* **Close the Web Inspector before ANY memory or perf measurement.**
  All Tauri instances share one webview profile
  (`~/.local/share/com.papercusp.desktop`), and it restores the
  inspector OPEN from the last session. The inspector's record buffers
  (its Network tab logs every SSE/API frame) grew \~1.9 GB across two
  nav batteries on 2026-06-10 and looked exactly like an app leak —
  closing it dropped RSS from 2.7 GB to 819 MB instantly. Latency
  numbers were unaffected; memory numbers with it open are garbage.
* **Don't measure under `tauri dev` on the shared dev box — launch the
  bare debug binary.** `tauri dev` watches `src-tauri/**`, and the
  fleet edits that tree continuously: a peer's mid-flight Rust edit
  kills and rebuilds your app mid-test (and a peer's compile error
  leaves you appless). Launch
  `./src-tauri/target/debug/papercusp-desktop` directly (the dev
  wrapper + bridge are compiled in) and pick the target via the
  build-switcher rail or a devUrl-restored URL.
* **Wayland trap: a bare `DISPLAY=:9X` launch can land on the owner's
  desktop.** GTK prefers Wayland when `WAYLAND_DISPLAY` is set, so the
  isolated-Xvfb recipe silently opens the window on the live seat
  (focus-steal). Always launch with
  `env -u WAYLAND_DISPLAY GDK_BACKEND=x11 DISPLAY=:9X …`.
* **`screenshot` verb may demand sway/grim** (it probes the host
  platform, not your X11 instance). Fallback that always works on an
  Xvfb display: `WID=$(DISPLAY=:9X xdotool search --name Papercusp |
  tail -1); DISPLAY=:9X import -window $WID shot.png`.
* **`operator-converse` trigger enum.** When poking
  `/api/agent-mcp/operator-converse` directly, `trigger` must be one of
  `user_message | quiet_wait_resume | open_canvas | user_says_ready |
  user_welcomed | continue` — anything else streams a single
  `event: error` frame (`invalid_args`) and closes.

### 15.4 Xvfb / xdotool / OCR fallback cookbook

The bridge covers 99% of cases. Reach for this stack only when:

* You're on a **release build** (the bridge is `#[cfg(debug_assertions)]`).
* You're on **macOS** and the bridge isn't compiled in for that
  target yet.
* You need to verify **visual** behavior the DOM can't express
  (animation timing, font rendering, paint-order glitches).
* The Tauri process **crashed** and you need forensics on the dead
  window (use `tauri-agent-tools diagnose` first; this is a deeper
  fallback).

:::danger\[Bare `Xvfb` has no GPU/GL — WebKitGTK won't paint → every screenshot is blank]
A plain `Xvfb` is a **software framebuffer with no DRI3/GL** (you'll see
`libEGL warning: DRI3 error: Could not get DRI3 device` in the app log).
WebKitGTK's accelerated compositor then **never paints the webview to that
framebuffer, so every screenshot comes back uniformly blank white regardless
of what the DOM actually contains** — a render-environment artifact that looks
exactly like a broken/blank app. The DOM is fine; the pixels just never render.
(This burned \~hours in the desktop-ipc Phase-4 smoke before it was spotted: the
"blank window" was the GL-less Xvfb, not the app.)

**Get real GPU GL one of two ways:**

1. **Run on `:0`** (the real GPU X server): `DISPLAY=:0 …`. Simplest, but puts a
   window on the operator's actual screen (focus-steal — see §0).
2. **VirtualGL on an isolated Xvfb** (no focus-steal, real GPU) — *recommended.*
   `vglrun` routes GL to the GPU's EGL render node while the app displays to the
   isolated Xvfb. **Always confirm real GL first** — it must report the GPU, not
   `llvmpipe`/`swrast`:
   ```sh
   DISPLAY=:90 vglrun -d egl0 glxinfo | grep -i "OpenGL renderer"
   # → OpenGL renderer string: NVIDIA GeForce RTX 3090/...   (good)
   # → ...llvmpipe / swrast                                  (still software — wrong)
   ```
   VirtualGL isn't in Ubuntu apt; install the GitHub release once:
   ```sh
   curl -sSL -o /tmp/vgl.deb \
     https://github.com/VirtualGL/virtualgl/releases/download/3.1.4/virtualgl_3.1.4_amd64.deb
   sudo dpkg -i /tmp/vgl.deb
   ```
   Use `-d egl0` — the EGL **device index**. Do NOT pass the
   `/dev/dri/renderD128` path; VGL rejects it ("Invalid EGL device").
   :::

Recipe — isolated **GPU-accelerated** instance via VirtualGL (no focus-steal):

```sh
Xvfb :90 -screen 0 1920x1080x24 -nolisten tcp &  echo $! > /tmp/xvfb90.pid
DISPLAY=:90 openbox &                            echo $! > /tmp/openbox90.pid
# Sanity — must be the real GPU, not llvmpipe:
DISPLAY=:90 vglrun -d egl0 glxinfo | grep -i "OpenGL renderer"
# Launch the app UNDER vglrun so WebKitGTK composites on the GPU:
( cd papercusp-desktop && env -u WAYLAND_DISPLAY GDK_BACKEND=x11 DISPLAY=:90 \
    vglrun -d egl0 npm run dev ) > /tmp/tauri-xvfb.log 2>&1 &  echo $! > /tmp/tauri-xvfb.pid
# ⚠ Wayland trap: without `env -u WAYLAND_DISPLAY GDK_BACKEND=x11` GTK may pick
# the live Wayland seat and open the window on the OWNER'S desktop, ignoring :90.
# ⚠ On the shared dev box prefer the BARE binary over `npm run dev` — the tauri-dev
# watcher restarts/kills your app whenever the fleet edits src-tauri/** (see §15):
#   env -u WAYLAND_DISPLAY GDK_BACKEND=x11 DISPLAY=:90 vglrun -d egl0 \
#     ./src-tauri/target/debug/papercusp-desktop > /tmp/tauri-xvfb.log 2>&1 &
# wait for window
until DISPLAY=:90 xdotool search --name Papercusp > /dev/null 2>&1; do sleep 1; done
# The bridge binds an EPHEMERAL port (Server::http("127.0.0.1:0") in
# src-tauri/src/dev_bridge.rs) — there is NO PAPERCUSP_BRIDGE_PORT env var.
# Read the real port/token from /tmp/tauri-dev-bridge-<pid>.token, or just
# `tauri-agent-tools probe` (pass --pid to disambiguate this instance).
WID=$(DISPLAY=:90 xdotool search --name Papercusp | head -1)
DISPLAY=:90 xdotool type --window $WID "hello"; DISPLAY=:90 xdotool key --window $WID Return
DISPLAY=:90 import -window $WID /tmp/shot.png    # ← now shows REAL content, not blank
convert /tmp/shot.png -crop 1280x80+0+460 /tmp/band.png; tesseract /tmp/band.png - 2>/dev/null
```

Cleanup: `kill $(cat /tmp/tauri-xvfb.pid /tmp/openbox90.pid /tmp/xvfb90.pid) 2>/dev/null`.

For a **release build** (no dev bridge) screenshots are your *only* window
introspection — so GPU GL via VirtualGL is **mandatory** there, or the
screenshot tells you nothing. On a **debug** build the bridge is still up on the
isolated instance — find it with `tauri-agent-tools probe --pid <pid>` or the
`/tmp/tauri-dev-bridge-<pid>.token` file (the port is ephemeral; there is **no**
`PAPERCUSP_BRIDGE_PORT` env var). Prefer the
bridge for DOM/JS (it reads the DOM, not pixels, so it works even GL-less) and
use this VirtualGL stack only for the pixels.

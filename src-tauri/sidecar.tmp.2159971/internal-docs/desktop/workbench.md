# Desktop workbench (/workbench)
URL: /internal/docs/desktop/workbench

The top-level dockview shell — two GUI panes (main app + voice/peers) beside the glued native terminal. Layout persists to PG; Reset restores the seed.

The **workbench** is the desktop's top-level dock shell
(`/workbench` in the operator-vite SPA): a `dockview` layout hosting the
**GUI surfaces only**, glued to the **native sibling terminal** window on
the left. Plan: `desktop-workbench-shell-2026-06-05`; re-scoped by
`native-terminal-desktop-2026-06-06` (see "What is NOT a pane" below).

## The panes

| Pane      | Type              | What it renders                                                                                                                                                                                        |
| --------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App**   | `workbench:app`   | The main `/adv` app via `IframePanel` (the operator's full dock/tab shell rides inside it). Self-manages its own harness selector — the seed bakes no slug into it.                                    |
| **Peers** | `workbench:voice` | The holepunch `VideoGrid` behind the `papercusp-video-channels` flag (flag off → an explanatory empty state), plus the voice seam for the universal voice interface. Carries the active `harnessSlug`. |

The active harness is the `?harness=` URL param (nuqs — deep-linkable,
agent-driveable). The route patches it into the voice panel at runtime
(the dock-preview pattern); a header picker defaults it to the first
project when unset.

## What is NOT a pane

* **No pui/terminal pane, and never xterm.js.** Owner directive
  (`native-terminal-desktop-2026-06-06` D-001/D-002): a webview cannot
  host a native terminal, so the terminal runs as a **native sibling
  window** (glued Ghostty on X11 hosting the `pui chat` dock; owned-window
  / embedded native view elsewhere), launched by the Tauri shell
  (`src-tauri/src/native_terminal.rs`). The seed tests **ban**
  `workbench:pui` from ever being re-seeded.
* **No standalone operator-chat pane** (plan D-001) — the chats are
  terminal-native pui panes in the sibling window; the web chat is
  flag-gated (`TESTING`) off by default.
* **No setup-wizard preview rail.** `/setup` renders the bare
  `SetupWizard`; the old preview iframed the retired `/pi` and was
  removed (`native-terminal-desktop` D-019).

## Layout seed + persistence

* The default layout is **server-side**: `defaultWorkbenchLayout()` in
  `packages/operator-core/lib/dock-layouts.ts`, routed by
  `seedForDockName('workbench')` — `GET /api/dock-layouts/workbench`
  returns it when no row exists (app 0.6 / voice 0.4, `direction: row`).
  A `workbench:<slug>` layout name bakes the slug into the voice pane.
* Edits (drag a sash, move a tab) persist via the inherited
  `useDockLayout` debounced save to the PG `dock_layouts` row — reloads
  restore your layout, not the seed.
* **Reset layout** (header button) dispatches
  `papercusp:dock-reset-layout`: the seed is rewritten to PG and
  re-applied live.

## Testing

Unit/component homes: `packages/operator-core/lib/dock-layouts.test.ts`
(seed shape, the `workbench:pui` ban, slug baking, validator round-trip),
`apps/operator/app/harness/dock/workbench-panels.test.tsx`, and
`apps/operator-vite/src/components/workbench/WorkbenchVoicePanel.test.tsx`
(flag off / on / no-harness).

Live verification (2026-06-07, plan D-010): isolated Tauri under Xvfb +
VirtualGL per [the agent-E2E playbook](/internal/docs/testing/agent-e2e) —
both panes render, sash-drag → PG save → reload round-trips, Reset
restores the seed live, `/setup` shows the bare wizard.

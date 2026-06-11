# Operator architecture decisions (load-bearing)
URL: /internal/docs/spec/operator-architecture-decisions

Decisions baked into apps/operator that, when reverted, reintroduce specific bugs. Future agents working in operator code MUST read this before changing the listed files. Each entry names the rule, the file(s) it touches, and the bug it prevents.

import { Aside } from '@astrojs/starlight/components';

The decisions on this page are not preferences — each one fixes a specific user-visible bug. Reverting any of them brings the bug back. Do not "tidy up" these patterns without first reading the **Why** clause and confirming with the user that the bug is acceptable.

The decisions themselves are all still live (verified against source). Two
locations in the cited paths have moved: most operator **libs** are now under
`packages/operator-core/lib/*` (not `apps/operator/lib/*`) — e.g. `harness-registry.ts`,
`validators.ts`, `papercusp-root.ts` (the home of `papercuspPath`/`papercuspRoot`),
`operator-notes.ts`, `snapshot-discovery.ts`, `credentials.ts`, `session.ts` — and
the operator's **HTTP routes are Hono handlers** under
`packages/operator-core/lib/endpoint-route/routes/**`, not Next.js `app/api/.../route.ts`
(the `apps/operator/app/api/` tree no longer exists). The `apps/operator/app/_components/*`
and `apps/operator/app/harness/*` React components below are still at their cited paths.

## Harness-project registry: one source of truth

**Rule.** All operator reads/writes of the harness-project registry go through `packages/operator-core/lib/harness-registry.ts` (`loadHarnessRegistry()` / `saveHarnessRegistry()`). The registry lives at `papercuspPath('registry.json')` — i.e., `<active-workspace>/.papercusp/registry.json`. Operator code MUST NOT read or write `~/.restart-harness-projects.json` directly, and MUST NOT auto-discover projects in hardcoded directories like `~/sheets-clone` or `~/Restart`.

**Why.** New workspaces are supposed to feel like a clean install — empty harness list, no plugins, nothing inherited from another workspace. Before this rule was enforced, the harness API merged the legacy global file `~/.restart-harness-projects.json` on top of the workspace-scoped registry, so a freshly created workspace listed every project from the user's other workspaces. The legacy global file is the CLI's concern alone (it mirrors writes there for transition compat) — the operator must ignore it.

**Files it lives in.** `packages/operator-core/lib/harness-registry.ts` (helpers), and every callsite that reads/writes the registry imports from it — the harness / plugins / pty / agent-chats / installed / marketplace-install / plugin-contributions / plugin-invoke route handlers (now Hono routes under `packages/operator-core/lib/endpoint-route/routes/**`), plus `packages/operator-core/lib/operator-notes.ts` and `packages/operator-core/lib/snapshot-discovery.ts`.

## papercuspRoot() / papercuspPath() must be called per-request

**Rule.** Module-level `const X = papercuspPath(...)` or `const X = papercuspRoot()` is forbidden in route handlers and any lib that's loaded once per process. Use a getter function instead: `function X() { return papercuspPath(...) }` and call it at the call site.

**Why.** `papercuspRoot()` invalidates its cache on `~/.papercusp-workspaces/registry.json` mtime, so the resolver tracks workspace switches automatically. But a module-load capture freezes the path at whichever workspace was active when Next first loaded that route. After a workspace switch in webapp mode (which only `location.reload()`s the browser, not the server), endpoints that captured at module load keep writing into the previous workspace's directories until a manual server restart. Desktop mode doesn't hit this because the Tauri shell restarts the process on switch.

**Files where this rule was enforced and tends to regress.** The provision-run / plugins-enable / snapshots-create-retract-instantiate / oracle / plugin-runtime route handlers (now Hono routes under `packages/operator-core/lib/endpoint-route/routes/**`), and the libs `packages/operator-core/lib/{credentials,publish-credentials,session,oauth/storage-fs}.ts`, `packages/operator-core/lib/provision/{trust-store,state-store,single-user}.ts`, `packages/operator-core/lib/plugin-{host-runtime,host,configs-pg,enables-pg,slug}.ts`. The per-request cache + mtime-invalidation mechanism lives in `packages/operator-core/lib/papercusp-root.ts`.

## Marketplace credentials are per-workspace, with no `default` fallback

**Rule.** `apps/operator/app/api/snapshots/[id]/publish/route.ts` and `apps/operator/app/api/templates/[slug]/[version]/publish/route.ts` resolve `marketplace-secrets.env` ONLY at `papercuspPath('marketplace-secrets.env')`. They MUST NOT fall back to `~/.papercusp-workspaces/default/.papercusp/marketplace-secrets.env`.

**Why.** Otherwise, publishing from a non-default workspace silently uses Default's marketplace identity, which both contradicts workspace isolation and surprises users. Falling through to "default" is the same class of bug as the registry leak above.

## Iframe-target routes opt out of chrome via `ChromeShell`

**Rule.** Operator routes that are the target of a harness plugin's `iframeUrl` (currently `/pi` and `/project-docs`) opt out of the global header / OracleDock / ChatwootWidget by having their pathname listed in `CHROMELESS_PATH_PREFIXES` inside `apps/operator/app/_components/ChromeShell.tsx`. The `ChromeShell` client component uses `usePathname()` to skip rendering chrome **server-side** for those routes.

**Why.** Two bugs come from getting this wrong. (1) Routes with no chrome opt-out at all (`/project-docs` was the case) render the chrome inside the iframe — the user sees the operator's nav bar inside what should be a docs panel. (2) Routes that opt out via a `useEffect`-applied body class (the legacy `Chromeless` component) render the chrome on the first frame and then hide it after hydration — the user sees a flash of header before it disappears. Server-side skip via `usePathname()` eliminates both.

**Don't reach for** the legacy `Chromeless` component for new routes. It remains only for `/(docs)/` (the operator's own docs site, which is meaningful both standalone and iframed and so still needs runtime detection). New iframe-target routes go in `CHROMELESS_PATH_PREFIXES` instead.

## Dropdown menus inside `.pc-header` must portal to `<body>`

**Rule.** Any dropdown / menu / popover that opens from a button inside `.pc-header` (e.g. `WorkspaceSwitcher`) MUST render via `createPortal(menu, document.body)` and use `position: fixed` anchored to the trigger via `getBoundingClientRect()`. Inline `position: absolute` inside the header is forbidden.

**Why.** `.pc-header` is `position: sticky; z-index: 50`, which creates a stacking context. A descendant with `z-index: 100` is still trapped at z=50 from `<body>`'s perspective. The OracleDock (z-index: 80) then paints over the menu, which the user reads as "translucent" or "covered". Portaling to body escapes the stacking context. Menu z-index should be ≥ 100 (above the dock and above `Modal`'s default).

## `Modal` default `z-index` is 100, not 60

**Rule.** `apps/operator/app/harness/Modal.tsx` defaults the modal/overlay z-index to **100**. Never lower it back to 60.

**Why.** OracleDock is `z-index: 80 !important`. With Modal at 60, the overlay and content are both painted under the dock wherever they overlap — Save snapshot / Save template dialogs appear "covered" on the right side of the screen. 100 puts the modal above the dock. Individual modal instances can override by passing `zIndex` explicitly if they have a reason.

## "Open in pi" was intentionally removed from the feature row

**Rule.** Don't reintroduce an "open in pi" button on the FeatureList row. The button only set `piLaneId` state, which was passed to `PiTerminalsDock` as `initialLaneId` — but `initialLaneId` is consulted ONLY when the dock seeds its first terminal pane on a cold mount. With a saved layout in localStorage, the prop is ignored entirely; clicking the button just switched tabs.

**Why.** The button looked like it would scope the Pi terminal to the feature's worktree. It didn't (except in the cold-start case). Two buttons that do similar-but-different things on the same row ("chat" creates a worker chat, "open in pi" allegedly scoped the terminal) confused users. The feature-row buttons are now: `steer` / `chat` / `edit` / `reset`. If we want feature-scoped terminals back, the right design is to spawn a *new* PiPanel pane scoped to the feature, not flip a "first-mount only" prop.

## Form input validation happens at input time, via `validators.ts`

**Rule.** Operator forms with format-restricted fields (slug, semver) validate per-keystroke using the schemas in `packages/operator-core/lib/validators.ts` (zod). Submit buttons disable while invalid and show inline error text under each bad field. Server-side validation stays as defence-in-depth, but the user must never see a server-side validation error for a format rule the client could have caught.

**Why.** "Invalid slug" toasts after clicking Save are a poor user experience compared to a red border + "lowercase + digits + .\_-" hint that appears as soon as the input becomes invalid. The shared `slugSchema` / `semverSchema` also keep client and server agreeing on the rule.

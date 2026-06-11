# TypeScript Layers
URL: /internal/docs/build-system/layers

The four-layer model the operator is migrating toward — core / host / routes / client — and the empty tsconfig scaffold under apps/operator/layers/ that names them.

## What this is

`apps/operator/` will eventually be partitioned into four compile units. Each one is a tsconfig with its own `include` glob, and the layers reference each other in a one-directional dependency graph. The build invariant is: nothing in `core` can import from `host`, `routes`, or `client`; nothing in `host` can import from `routes` or `client`; etc.

Today the partition is **scaffolded but empty**. The four layer tsconfigs exist under `apps/operator/layers/` with `include: []`. `tsc --build apps/operator/layers/tsconfig.layers.json` resolves cleanly but checks no files. Files migrate into a layer's `include` glob as the route-migration work (Phase 4) and the layering-enforcement work (Phase 6b) progress.

This is by design — the alternative was to globs-up the existing tree and lie about which files belong where. The layers describe the **target**, not the current state.

## The four layers

```
                  ┌─────────┐
                  │  core   │
                  └────┬────┘
                       │
        ┌──────────────┼─────────────┐
        ▼              ▼             ▼
   ┌─────────┐   ┌──────────┐   ┌─────────┐
   │  host   │   │  client  │   │ routes  │
   └────┬────┘   └──────────┘   └────┬────┘
        │                            │
        └────────► routes ◄──────────┘
                  (via host)
```

### core

**What lives here:** typed business logic with no host coupling. `define_tool` handlers (the host-clean ones), the endpoint system's pipeline + dispatch stack, schemas, pure helpers, type definitions.

**What may be imported:** anything from `libs/*`, `packages/*`, and host-clean third-party packages (`zod`, `date-fns`, `postgres`, `@modelcontextprotocol/sdk`, etc.).

**What may NOT be imported:**

* `next/*`
* `node:fs`, `node:child_process` directly (use `@papercusp/host-platform` instead)
* DOM types implicitly
* React

If you find yourself wanting to reach for `node:fs` in core code, the answer is to take a `HostPlatform` parameter (or call `getHostPlatform()`) — see [host-platform](/internal/docs/build-system/architecture) coverage in the host-platform package source.

### host

**What lives here:** host-specific glue that the desktop needs but a future web host might not. `desktopHostPlatform`'s body, IPC bridge code (`packages/operator-core/lib/endpoint-ipc/`), embedded-PG discovery, plugin runtime (`packages/operator-core/lib/plugin-host-runtime.ts`), FS watchers, background sweepers, socket lifecycle.

**What may be imported:** `core`, anything in `libs/*` and `packages/*`, Node stdlib (`node:fs`, `node:child_process`, `node:net`, etc.).

**What may NOT be imported:** `next/*` (Next-specific request/response shapes); React.

### routes

**What lives here:** transport-shaped code — Next route handlers (`app/api/.../route.ts`) and Hono routers (`app/api/_hono/*.ts`). Thin shims that map an HTTP request into a `core` or `host` function call.

**What may be imported:** `core`, `host`, `next/*` (`NextRequest`, `cookies()`, etc.), Hono types.

**What may NOT be imported:** React; client-only browser APIs.

A handler that holds non-transport state (cookies, cost caps, feature locks, transcript persistence) is A1-class — it stays as a substantive shim and doesn't migrate to a `define_tool` projection. See [agent-policies §endpoint-system migration](/internal/docs/agent-policies) for the audit axes.

### client

**What lives here:** React components, hooks, transport-adapter polyfills (`packages/operator-core/lib/transport-adapters/`), Zero client wiring, client-side state.

**What may be imported:** `core`, `react`, `next/link`, `next/navigation` (client APIs), DOM types, browser-only third-party packages.

**What may NOT be imported:**

* `node:fs`, `node:child_process` (server-only)
* `next/headers`, `cookies()` (server-only)
* Database clients (`postgres`, drizzle)
* Anything in `host` (the client doesn't run on the host)

## How to run the layered build

```bash
npx tsc --build apps/operator/layers/tsconfig.layers.json
```

Exit code 0 with no output means all four layers' include globs resolved + every cross-layer reference is satisfied. Today this trivially succeeds because every `include` is empty.

When files start moving in (Phase 4, Phase 6b), the build will start checking them and a violation — say, a file in `client/include` importing `host/some-thing` — will surface as a `tsc --build` error.

## What this scaffold doesn't do (yet)

* **No enforcement.** Phase 6a (this) ships the structural slots. Phase 6b adds ESLint `no-restricted-imports` rules + dependency-cruiser; that lands once Phase 4 has disentangled routes from `core` enough that the rules wouldn't be a wall of red.
* **No code moves.** The four `include` arrays are `[]`. Files migrate in by per-handler audit, not en masse.
* **No replacement of Next's tsconfig.** `apps/operator/tsconfig.json` is what Next + the IDE consume; it's untouched. The layered build is a parallel surface that runs independently.

## How a file gets added to a layer

When a route migration (Phase 4) determines that a handler is host-clean and projectable, the worker:

1. Moves the handler file to its target location (often `packages/operator-core/lib/agent-tools/<feature>/<name>.ts`).
2. Adds the file's path to the appropriate layer's `include` glob in `apps/operator/layers/tsconfig.core.json` (or `host.json`, etc.).
3. Runs `tsc --build apps/operator/layers/tsconfig.layers.json` locally; addresses any reported violations before committing.

The first few migrations will likely uncover edge cases (DOM types leaking into core via a stale .d.ts, a tsbuildinfo path that needs gitignoring, etc.). Those get fixed as found; the scaffold's job is to make the violation visible early instead of letting it ship.

## When to revisit

When ≥75% of `app/api/*/route.ts` files have been audited (Phase 4 milestone), or when an enforcement violation appears that the scaffold should have caught — whichever comes first. At that point Phase 6b adds the ESLint rules + builds fail on cross-layer imports.

Sister doc: the [host-platform](https://github.com/papercusp/papercusp/tree/main/libs/host-platform) interface that `core` and `host` share, and [agent-policies §endpoint-system migration](/internal/docs/agent-policies) for the per-route audit rules.

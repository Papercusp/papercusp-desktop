# Architecture
URL: /internal/docs/build-system/architecture

How a production Papercusp binary is laid out, what it spawns at startup, and how the browser webview finds the operator server.

:::note\[History: the operator frontend was Next.js until mid-2026]
Next.js is **fully removed** (`finish-next-removal-2026-06-01`): no `next`
dependency, no `next.config.js`, no `next/*` shims — the former
`next/{navigation,link,dynamic}` adapter hooks live on as
`apps/operator/lib/router-compat/*`. The operator frontend is the **Vite** SPA
(`@papercusp/operator-vite`, TanStack Router, `:3055` in dev) served by the
`:3070` **Hono host** (`apps/operator/bin/hono-host.ts`); the shipped sidecar is
an esbuild-bundled `serve.mjs`. `apps/operator/app/**` is **not** dead code —
operator-vite imports its live page bodies via the `@` alias (→ `apps/operator/`).
See the `operator-next-is-retired` insight.
:::

## Two repos, two stages

```
~/papercupai-workspace/
├── papercup/                 ← the operator (Vite SPA + Hono host + libs)
│   ├── apps/operator-vite/   ← @papercusp/operator-vite — the TanStack-Router SPA UI (:3055 dev)
│   └── apps/operator/        ← @papercusp/web — the Hono host (bin/hono-host.ts, :3070), serve entry (bin/serve.ts), + lib/app page bodies
└── papercusp-desktop/        ← the Tauri shell (Rust)
    └── src-tauri/            ← main.rs + tauri.conf.json — produces the .deb/.dmg/.msi
```

`papercusp-desktop` is the wrapper. It bundles the operator as a single
esbuild-bundled `serve.mjs` **sidecar** (built by `bin/build-desktop-sidecar.sh`
into `src-tauri/sidecar/`) and ships the Rust binary + sidecar in one installer.
Per plan `operator-core-headless-serve-2026-06-04`, the desktop is an **embedder
of `papercusp serve`**: `serve.mjs` owns the whole operator lifecycle (embedded
Postgres, migrations, the Hono host, the discovery files); Rust just spawns it
and points the webview at it.

## What a Tauri production build does at startup

`papercusp-desktop/src-tauri/src/main.rs` `setup()` (production branch):

1. **Pick a free port hint** (e.g. `19210`) and a separate PG port hint — these are cold-start *hints*; the real ports are resolved later from discovery.
2. **Spawn `code-server`** (the bundled VS Code for the web) on a free port, and surface its URL to the sidecar via `PAPERCUSP_CODE_SERVER_URL`. (Debug builds also start an MCP bridge plugin bound to `127.0.0.1`.)
3. **Spawn the `serve.mjs --ensure` sidecar** as one child process. `serve` then owns everything PG/operator: it starts real embedded PostgreSQL (`wal_level=logical`) on its own free port, runs migrations, writes `~/.papercusp/embedded-pg.json`, runs `runBootstrap()` (which starts the endpoint-IPC server + writes `~/.papercusp/endpoint-ipc.json`), and starts the Hono host bound to `127.0.0.1:<port>`. `--ensure` reuses an already-healthy operator under the same HOME instead of double-booting.
4. **Poll `~/.papercusp/operator.json`** (`wait_for_operator`, up to 120s for a first boot that pays `initdb` + full migration replay) until the pid is alive **and** the port accepts TCP. The **real** port comes from this file — `--ensure` reuse may land on a different port than the cold-start hint.
5. **`eval()` an init script into the webview** setting `window.__papercuspBase` / `window.__papercuspAppBase` / `window.__PAPERCUSP_TAURI__` and dispatching a `papercusp:base` event.

The webview opens on the bootstrap page (`papercusp-desktop/web/index.html`, `frontendDist: "../web"`) that:

1. Waits for `window.__papercuspBase` (re-applied if the page-load drops it)
2. Polls `<base>/api/desktop/preflight` until ready
3. Navigates to the real operator UI

With the `papercusp://` **custom protocol** on (default, shipped 2026-06-01), the real app loads from `papercusp://localhost/…` (forwarded to the loopback sidecar), so the webview opens **zero** HTTP connections. With `PAPERCUSP_DESKTOP_CUSTOM_PROTOCOL=0` it falls back to the HTTP `http://127.0.0.1:<port>` origin. Either way, `/api` fetches + EventSource ride **endpoint-IPC** (resolved from `endpoint-ipc.json`) to escape libsoup's 6-socket pool, falling back to HTTP if the socket isn't up. Tauri's IPC (`invoke()`) works alongside because the page is in a Tauri webview.

## What dev mode does instead

A debug build (`cfg!(debug_assertions) == true`) makes `main.rs` `setup()`:

1. **Skip the `serve.mjs` spawn entirely** — the developer is expected to run the operator dev stack separately (the Vite SPA on `:3055` + the Hono host on `:3070`)
2. **Start the tauri-agent-tools dev bridge** (debug-only, localhost-only, token-authenticated) and, on Linux, auto-grant `getUserMedia`
3. **Open devtools automatically** (WebKitGTK doesn't reliably wire Ctrl+Shift+I)
4. Webview loads `http://localhost:3055` (`devUrl` in `tauri.conf.json`); `/api` fetches ride endpoint-IPC re-read from `~/.papercusp/endpoint-ipc.json` (written by the externally-run operator), with graceful HTTP fallback while it's down

So a dev Tauri window IS just a Tauri webview pointed at the live Vite dev server on `:3055` (with the Hono host on `:3070`). Production is the same UI code but served from the bundled sidecar on a private port. (`papercusp-desktop`'s `beforeDevCommand` runs `bin/dev-operator-ifneeded.sh` to bring the dev stack up if it isn't already.)

## Where the operator code lives in a prod bundle

After `bin/build-desktop-sidecar.sh` (which esbuild-bundles the operator into `src-tauri/sidecar/`) followed by `tauri build` (`= npm run build` in `papercusp-desktop/` — note `beforeBuildCommand` is empty, so the sidecar build is a **separate** step):

```
/usr/lib/Papercusp/                          # Linux .deb install root
├── papercusp-desktop                        # main Tauri binary
└── sidecar/                                 # bundled as a Tauri resource (sidecar/**/*)
    ├── serve.mjs                            # one esbuild-bundled ESM operator entry — main.rs spawns `node serve.mjs --ensure`
    ├── db-sql/                              # bundled SQL migration files
    ├── node_modules/                        # externalized native deps only (node-pty, @papercusp/embedded-postgres-server + its @embedded-postgres/<plat> binary, …)
    ├── code-server/                         # the bundled code-server
    └── bin/
        ├── node                             # bundled Node v24 runtime (Tauri prepends bin/ to the sidecar's PATH)
        ├── omp
        └── gh
```

Embedded Postgres is no longer a separate sidecar directory — `serve.mjs` resolves the `@papercusp/embedded-postgres-server` package (with its platform binary) out of `sidecar/node_modules/` and runs PG in-process. `zero-cache` is **not** shipped (the desktop sidecar serves SSE itself; the opt-in `zero-cache-server` was removed 2026-05-07). Mac is the same shape inside `Papercusp.app/Contents/Resources/`. Windows under `C:\Program Files\Papercusp\` (where the sidecar is routed through WSL).

## The bundled Node binary (`bundled_path_env`)

`main.rs` has a `bundled_path_env()` helper that builds a `PATH` with the
shipped `sidecar/bin/` directory (containing `node`, `omp`, `gh`) prepended.
**Every node-based spawn runs through it** rather than relying on `which node`,
because GUI-launched apps inherit `$PATH = /usr/bin:/bin` on macOS — Homebrew's
`node`, `nvm` Node, etc. won't be visible. Without this, the packaged process
can't find `node` at all (the Linux clean-room test VM caught exactly this —
see [VMs](/internal/docs/build-system/vms)), and `pg_dump`/`libpq` discovery
would break on Mac.

## The embedded-PG discovery file

On boot, **`serve.mjs`** (not `main.rs` anymore) writes `~/.papercusp/embedded-pg.json` containing roughly:

```json
{
  "pid": 877130,
  "adminUrl": "postgresql://harness_admin:...@127.0.0.1:20721/papercusp",
  "appUrl":   "postgresql://harness_app:...@127.0.0.1:20721/papercusp",
  "port": 20721,
  "startedAt": "2026-05-13T12:56:00Z"
}
```

It also writes `~/.papercusp/operator.json` (the Hono host pid + port that
`main.rs` polls) and `~/.papercusp/endpoint-ipc.json` (the IPC socket path).

Three rules:

* The operator reads PG discovery via `getHarnessAdminUrl()` in `packages/operator-core/lib/embedded-pg-discovery.ts`. **Never hard-code `:5432` or `:16534` anywhere** — always resolve through this helper. The central connection resolver in `libs/papercusp/libs/db/src/connection.ts` already does this; new code should call the helper.
* The discovery files are **owned by `serve`**: it writes them atomically on boot and removes `operator.json`/`embedded-pg.json` on the way down. `serve --ensure` also makes same-HOME double-launches converge on one operator rather than fighting over the file.
* Native PG (`:5432`) is for Restart / paperclip / marketplace **and** is what this dev box's operator runs against (`apps/operator/.env.local` pins a `:5432/papercusp` `DATABASE_URL`). The **ship** target is embedded-pg, but on the standing dev box there is **no** `papercusp_legacy`/`papercusp_native_backup` rename — `papercusp` on `:5432` is alive and in use. Code must keep working under embedded-pg regardless, so resolve through `getHarnessAdminUrl()` rather than assuming either topology.

## What gets *built* vs. what gets *shipped*

* **Built** but **not shipped**: the Vite SPA's intermediate output, `target/debug/`, `node_modules/.cache/`. The auditor (`papercusp-desktop/bin/audit-bundle.sh`) scans the *installer* contents, not the build directory.
* **Built and shipped** but **not loaded at runtime in prod**: `web/index.html` only runs during the brief bootstrap; `tauri.conf.json`'s `devUrl` is dev-only and never read in a release binary.
* **Built and shipped and active**: everything under `sidecar/`. `serve.mjs` is spawned at boot (and owns embedded PG in-process); `code-server` is spawned alongside it; both run for the lifetime of the Tauri window.

## A note on Linux WebKit quirks

WebKitGTK is what wry uses on Linux, and it has a few recurring quirks the desktop works around:

* **`localhost` vs `127.0.0.1`** — WebKitGTK may resolve `localhost` to `::1` while the sidecar binds IPv4 loopback, which fails the bootstrap's preflight fetch. `main.rs` deliberately hands the webview a `http://127.0.0.1:<port>` base, not `localhost`.
* **libsoup's 6-socket pool** — the webview's `/api` fetch + EventSource are routed over endpoint-IPC (Unix socket) instead of HTTP precisely to escape this limit. See the discovery-file handoff above.
* **getUserMedia denied by default** — `main.rs` auto-grants media permission on Linux so the operator's voice / wake-word / ElevenLabs paths work without a `NotAllowedError`.

> Historical note: the old "duplicate dashboard" + "access control checks CORS spam" bugs were Next.js-era artifacts (a Next error overlay double-mounting the layout, and wildcard CORS headers in `next.config.js`). Both that machinery and `next.config.js` are gone now that the operator is a Vite SPA served by the Hono host, so those specific fixes no longer apply.

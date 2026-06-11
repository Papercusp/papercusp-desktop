# Build system overview
URL: /internal/docs/build-system/index

Where each piece is built, what produces what, and the one URL that runs all of it.

:::caution\[The operator is Vite now, not Next.js]
The operator frontend migrated **Next.js → Vite** (`@papercusp/operator-vite`,
a TanStack-Router SPA). Read any "Next.js app / Next standalone / `next dev` /
`next start`" wording below as the **Vite** SPA (`:3055` dev) served by the
`:3070` **Hono host** (`apps/operator/bin/hono-host.ts`). There is no
`next.config.js` left in `apps/operator/`, and `next dev`/`next start` are no
longer used; running/browsing the old standalone webapp is what's retired — a
`PreToolUse` hook blocks browser nav to `:3055`/`:3070`. (Note: `apps/operator/app/**`
is **not** dead code — operator-vite still imports its live page bodies via the
`@/app` alias + `next/*` compat shims.) See the `operator-next-is-retired` insight.
:::

> **Webapp retired (2026-05-14).** Any `localhost:3055` or `localhost:3070` URL on this page is only reachable while the **Tauri dev shell** is running. Start it with `cd papercusp-desktop && npm run dev`.

## What "the build system" means here

Three different things are bundled by three different commands:

| Artifact                         | What it is                                                                                                                                       | Built by                                                                                                                     | Path                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Linux `.deb` / `.rpm`**        | Tauri desktop installer for Linux                                                                                                                | `bin/build-desktop-sidecar.sh` then `npm run build` (`= tauri build`) in `papercusp-desktop/` (runs locally on the dev host) | `papercusp-desktop/src-tauri/target/release/bundle/{deb,rpm}/`                                                            |
| **macOS `.dmg`**                 | Tauri desktop installer for macOS x86\_64                                                                                                        | Same flow, but executed **inside the macOS VM** over SSH                                                                     | `~/papercupai/papercusp-desktop/src-tauri/target/release/bundle/dmg/` on the Mac VM, then `scp`'d back                    |
| **Windows `.msi` + NSIS `.exe`** | Tauri desktop installer for Windows                                                                                                              | Same, executed **inside the Windows VM** (via `win-build.ps1`)                                                               | `C:\Users\User\papercupai\papercusp-desktop\src-tauri\target\release\bundle\{msi,nsis}\` on the Win VM, then `scp`'d back |
| **`:3070` Hono host**            | Production Hono host (`apps/operator/bin/hono-host.ts`) serving the built Vite SPA + the `/api` surface + `/internal/docs` (the testing surface) | `bin/prod` in the `papercup/` repo                                                                                           | built `apps/operator-vite/dist/` (served by the Hono host)                                                                |
| **`:3055` Vite dev server**      | The Vite dev server (`@papercusp/operator-vite`, TanStack-Router SPA) used by `tauri dev` AND served directly in the browser for fast iteration  | `bin/dev` in the `papercup/` repo (papercup-dev systemd user unit)                                                           | live, no artifact                                                                                                         |

Production Tauri builds are real binaries (\~700MB Linux, \~440MB Mac, \~375MB Windows). They contain a bundled Node.js runtime (v24) plus a single esbuild-bundled `serve.mjs` sidecar that **itself** owns embedded Postgres (start + migrations + the `embedded-pg.json` discovery file) and the Hono operator host — plus a bundled `code-server` spawned alongside (and, in debug builds only, an MCP bridge). They do **not** depend on `:3055` at runtime.

## The single entry point: `/admin`

Open `http://localhost:3055/admin` (no nav link — type the URL). Every build / install / VM-launch command in this system is wired into a button there with a live SSE-streamed log.

Four sections:

* **Building** — Linux Prod Build · Mac Prod Build · Windows Prod Build · Rebuild 3070 host
* **Running** — Install + launch each platform · Launch Linux Desktop DEV · Restart dev stack (3055 + 3070) · Audit prod bundles · Env probe
* **Packaged build** — Install wdio deps · Run wdio test against the packaged binary · Check webkit2gtk-driver
* **Simulators** — Launch Android emulator · Start macOS VM · Launch iOS simulator · List iOS sim devices

The button source-of-truth allow-list lives in `packages/operator-core/lib/admin-commands.ts`. The client only sends a `cmd` id; the server resolves it to the actual shell command — there's no path that lets the client pass raw shell. See [Admin commands](/internal/docs/build-system/admin-commands) for the full reference.

## How to use this section

* **[Architecture](/internal/docs/build-system/architecture)** — the bundle layout, the bootstrap → sidecar handoff, what runs in prod vs dev
* **[TypeScript layers](/internal/docs/build-system/layers)** — the core/host/routes/client compile-unit scaffold the operator is migrating toward
* **[Admin commands](/internal/docs/build-system/admin-commands)** — every `/admin` button explained: what it runs, what it depends on, what it produces
* **[VMs](/internal/docs/build-system/vms)** — SSH targets, sudo passwords, port maps, "the Windows VM crashes constantly" survival kit
* **[Privacy audit](/internal/docs/build-system/privacy-audit)** — the V1 ship contract, `papercusp-desktop/bin/audit-bundle.sh`, what gets scanned
* **[Verification](/internal/docs/build-system/verification)** — smoke tests for each platform, what "the build is good to ship" actually means

# /admin command reference
URL: /internal/docs/build-system/admin-commands

Every command wired into the /admin ops dashboard — what it runs, what it depends on, what it produces.

:::note\[History: the operator frontend was Next.js until mid-2026]
Next.js is **fully removed** (`finish-next-removal-2026-06-01`): no `next`
dependency, no `next.config.js`, no `next/*` shims. The operator frontend is the
**Vite** SPA (`@papercusp/operator-vite`, TanStack Router, `:3055` in dev) served
by the `:3070` **Hono host** (`apps/operator/bin/hono-host.ts`); the `/admin` run
route is a Hono `endpoint-route` handler. See the `operator-next-is-retired`
insight.
:::

## How the page works

`http://localhost:3055/admin` lists every build/install/sim command as a card with Run/Stop buttons and a live log box (5000-line ring, stderr in red).

Mechanism:

* **Source of truth**: `packages/operator-core/lib/admin-commands.ts` exports `ADMIN_COMMANDS` — the server-side allow-list. Each entry is `{id, label, section, description?, command, cwd?}` where `section` is `'building' | 'running' | 'simulators' | 'packaged-build'`. The client only sends `cmd: <id>`; the server never accepts raw shell.
* **Spawning**: `GET /api/admin/run?cmd=<id>` opens an SSE stream (the Hono route `packages/operator-core/lib/endpoint-route/routes/admin/run.ts`). It forks `bash -lic <command>` as a detached process group (so closing the stream `process.kill(-pid, 'SIGTERM')`s the whole tree). Output is line-buffered: a `meta` event up front (`{commandId, label, command, cwd?, pid, startedAt}`), `log` events (`{stream: 'stdout'|'stderr', line}`), an `error` event on spawn failure, and an `exit` event on close (`{code, signal}`).
* **Why `-lic`**: `-l` sources `.profile`, `-i` makes the shell interactive so `.bashrc`'s non-interactive guard short-circuit doesn't fire — so the spawn inherits `NVM_DIR`, `BUN_INSTALL`, `COMPOSIO_INSTALL_DIR`, `HINDSIGHT_API_URL`, `ELEVENLABS_API_KEY`, `CLOUDFLARE_API_TOKEN`, etc. exactly as your interactive terminal would. The two cosmetic warnings `-i`-without-TTY emits (`cannot set terminal process group`, `no job control in this shell`) are filtered out server-side.

## Auth

**None.** The admin page is loopback-only (operator binds `127.0.0.1:3055` by default) and is intentionally NOT linked from any nav. Reach it by typing the URL. There is no `requireFlag()` check — earlier versions had one tied to `papercusp-admin`, removed 2026-05-13.

## Building section

### `build-linux-prod` — Linux Prod Build

Runs locally on the dev host (`cwd` = `papercusp-desktop`). Produces both `.deb` and `.rpm` in one pass, then audits each.

```
cd /home/marsh-office/papercupai-workspace/papercup/papercusp-desktop
npm run build              # = tauri build (the sidecar must already be built — see note)
bin/audit-bundle.sh src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb
bin/audit-bundle.sh src-tauri/target/release/bundle/rpm/Papercusp-0.0.1-1.x86_64.rpm
```

> **Note:** `npm run build` is just `tauri build` (`beforeBuildCommand` is empty). The bundled `serve.mjs` sidecar is produced by a **separate** `bin/build-desktop-sidecar.sh` step — `bin/release-local.sh` runs it before `tauri build`. If you only run `tauri build` you'll bundle a stale/empty `sidecar/`.

\~10 minutes if the Rust target dir is warm, \~30 if cold.

**Outputs** (verify via the auditor card afterward, too):

* `src-tauri/target/release/bundle/deb/Papercusp_0.0.1_amd64.deb` (\~700 MB)
* `src-tauri/target/release/bundle/rpm/Papercusp-0.0.1-1.x86_64.rpm` (\~715 MB)

### `build-mac-prod` — Mac Prod Build

SSHes into the macOS VM (`ssh -i ~/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1`), builds inside `~/papercupai/papercusp-desktop`, scps the DMG back to the dev host, then audits it.

```
ssh -i /home/marsh-office/.ssh/papercup-vm-mac -p 2222 aviweiss@127.0.0.1 'bash -lc "
  . $HOME/.nvm/nvm.sh; nvm use 22
  cd ~/papercupai/papercusp-desktop
  NODE_OPTIONS=--max-old-space-size=8192 npm install --legacy-peer-deps
  NODE_OPTIONS=--max-old-space-size=8192 npm run build
"'
scp -i /home/marsh-office/.ssh/papercup-vm-mac -P 2222 \
  aviweiss@127.0.0.1:papercupai/papercusp-desktop/src-tauri/target/release/bundle/dmg/Papercusp_0.0.1_x86_64.dmg /home/marsh-office/
bin/audit-bundle.sh /home/marsh-office/Papercusp_0.0.1_x86_64.dmg
```

\~30–45 min. NEEDS the Mac VM running with disk room (≥10 GB free). See [VMs](/internal/docs/build-system/vms).

**Hard-coded requirements** (all currently met on the VM):

* Node 22 via nvm (script does `nvm use 22`)
* `--legacy-peer-deps` (workspace install hangs without it — see [VMs](/internal/docs/build-system/vms#npm---legacy-peer-deps-is-required))
* `NODE_OPTIONS=--max-old-space-size=8192` (without it, npm OOMs on the 16-GB VM)

### `build-windows-prod` — Windows Prod Build

SSHes into the Windows VM (`ssh -i ~/.ssh/papercup-vm-win -p 2223 User@127.0.0.1`) and runs `win-build.ps1`. Same shape as Mac. Copies back `.msi` (from `bundle/msi/`) and NSIS `.exe` (from `bundle/nsis/`) to `/home/marsh-office/`, then audits both.

```
ssh -i /home/marsh-office/.ssh/papercup-vm-win -p 2223 User@127.0.0.1 \
  "powershell -NoProfile -ExecutionPolicy Bypass -File win-build.ps1"
scp -i /home/marsh-office/.ssh/papercup-vm-win -P 2223 User@127.0.0.1:papercupai/papercusp-desktop/src-tauri/target/release/bundle/msi/Papercusp_0.0.1_x64_en-US.msi /home/marsh-office/
scp -i /home/marsh-office/.ssh/papercup-vm-win -P 2223 User@127.0.0.1:papercupai/papercusp-desktop/src-tauri/target/release/bundle/nsis/Papercusp_0.0.1_x64-setup.exe /home/marsh-office/
bin/audit-bundle.sh /home/marsh-office/Papercusp_0.0.1_x64_en-US.msi /home/marsh-office/Papercusp_0.0.1_x64-setup.exe
```

\~30–45 min. The Windows VM has crashed 6+ times during builds in past sessions — **expect to retry**. See [VMs / Windows VM crash recovery](/internal/docs/build-system/vms#windows-vm-crashes-routinely).

### `rebuild-3070` — Rebuild 3070 host

Runs `bin/prod` in the papercup repo (`cwd` = the papercup repo). It builds the operator (`npm --workspace @papercusp/web run build` = the `@papercupai/operator-docs` Starlight docs + the `@papercusp/operator-vite` SPA) and restarts the Hono host (`bin/hono-host.ts`) on `:3070`, detached (survives the SSE stream closing). This is **not** the desktop bundle — `:3070` serves the same operator UI/API that the packaged Tauri sidecar runs.

```
cd /home/marsh-office/papercupai-workspace/papercup
bin/prod
```

## Running section

### `install-linux-deb` — Install + launch Linux .deb

Installs the most-recently-built local `.deb` and launches `papercusp` (the installed binary on `/usr/bin/papercusp`). Requires `NOPASSWD` sudo for `dpkg`.

```
sudo -n dpkg -i /home/marsh-office/papercupai-workspace/papercup/papercusp-desktop/.../Papercusp_0.0.1_amd64.deb
setsid /usr/bin/papercusp >/dev/null 2>&1 < /dev/null &
```

### `install-mac-dmg` — Install + launch Mac .dmg

SSH macOS VM → mount the DMG → copy `Papercusp.app` to `/Applications/` → strip Gatekeeper quarantine → `open`. View via SPICE.

```
hdiutil attach ~/Papercusp_0.0.1_x86_64.dmg
rm -rf /Applications/Papercusp.app
cp -R /Volumes/Papercusp/Papercusp.app /Applications/
hdiutil detach /Volumes/Papercusp
xattr -dr com.apple.quarantine /Applications/Papercusp.app
open /Applications/Papercusp.app
```

### `install-windows-msi` — Install + launch Windows .msi

SSH Windows VM → `msiexec /i ... /quiet` → `Start-Process Papercusp.exe`. Installs to `C:\Program Files\Papercusp\`.

### `launch-linux-dev` — Launch Linux Desktop DEV

Detached `npm run dev` in `papercusp-desktop/` (Tauri dev mode against `:3055`). Survives closing the stream. Tails `/tmp/papercusp-desktop-dev.log`. In dev mode the Tauri shell doesn't spawn the `serve.mjs` sidecar — it expects the operator dev stack (Vite `:3055` + Hono `:3070`) running externally; its `beforeDevCommand` (`bin/dev-operator-ifneeded.sh`) brings that stack up if it isn't already.

### `restart-3055` — Restart dev stack (3055 + 3070)

Runs `bin/dev` in the papercup repo. This (re)starts **two** systemd `--user` transient units: `papercup-dev` (the **Vite** SPA dev server on `:3055`, `@papercusp/operator-vite`) and `papercup-dev-api` (the Hono API host on `:3070`, `tsx bin/hono-host.ts`). The `/admin` page goes offline for a few seconds while the Hono host re-imports; the Vite side comes back via HMR almost immediately — you'll lose your SSE log stream and need to refresh.

### `audit-prod-bundles` — Audit prod bundles for PostHog leaks

Standalone re-run of `papercusp-desktop/bin/audit-bundle.sh` against every prod artifact present on disk — the local `.deb`/`.rpm` plus any `.dmg`/`.msi`/`.exe` in `/home/marsh-office/`. Fails (`exit 1`) if no artifacts are found, or if any contains a real PostHog key. See [Privacy audit](/internal/docs/build-system/privacy-audit) for the full contract.

### `env-probe` — Env probe

Prints whether key env vars are set (NVM, BUN, COMPOSIO, HINDSIGHT\_API\_URL, ELEVENLABS, CLOUDFLARE, ANTHROPIC, OPENAI). Use this to diagnose "command can't find X" issues — these are sourced from your `.bashrc` and pass through via `bash -lic`.

## Packaged build section

These drive [WebdriverIO](https://webdriver.io) + `tauri-driver` against the **shipped** Tauri binary (not the dev server). All run in `tools/perf-test/wdio` in the papercup repo, which is kept out of the workspace on purpose.

### `wdio-install` — Install wdio deps (one-time)

`npm install` in `tools/perf-test/wdio`.

### `wdio-test` — Run wdio test against packaged binary

Spawns `tauri-driver` on `:4445` and drives the latest packaged Tauri binary via WebDriver, running `specs/*.spec.ts`. Prereqs: a `Linux Prod Build` artifact exists, `webkit2gtk-driver` is installed (`sudo apt`), and `wdio-install` was run once.

### `wdio-webkit-driver-check` — Check webkit2gtk-driver

Reports whether `WebKitWebDriver` is on `PATH` (required for `tauri-driver` on Linux). If missing: `sudo apt install webkit2gtk-driver`.

## Simulators section

### `launch-android-emulator`

`~/Android/Sdk/emulator/emulator -avd papercusp-test -no-snapshot-load -no-audio`, detached, tailing `/tmp/android-emulator.log`. Works on the Linux host directly (no VM needed). After boot, `adb devices` shows `emulator-5554`.

### `start-mac-vm`

Idempotent — skips if `qemu.*mac_hdd_ng` is already running. Otherwise `nohup bash boot-sonoma.sh` from `~/macos-vm/OSX-KVM/` and tails `/tmp/macvm-boot.log`. View via `remote-viewer spice://127.0.0.1:5930`. \~60–120s to SSH-ready.

### `launch-ios-simulator`

SSH macOS VM → `xcrun simctl boot "iPhone 16"` → `open -a Simulator`. Requires the VM running. View through SPICE.

### `ios-simulator-list`

Shows all available iOS sim devices on the Mac VM. Use device names from here for custom `simctl boot` runs.

## Adding a new command

Edit `packages/operator-core/lib/admin-commands.ts`. Each entry:

```ts
{
  id: 'my-thing',                  // url-safe, used in /api/admin/run?cmd=
  label: 'Human label',
  section: 'building' | 'running' | 'simulators' | 'packaged-build',
  description: 'What it does + caveats',  // optional
  command: 'set -e; echo hello',   // raw bash, executed via `bash -lic`
  cwd: '/optional/work/dir',       // optional
}
```

After editing, the new card appears immediately — the page fetches the list via `/api/admin/commands` on mount. (The Hono host runs `tsx` with no file-watch, so a `packages/operator-core` edit needs the host to reload — restart `papercup-dev-api` or reload the Tauri shell — before the new command id resolves server-side.)

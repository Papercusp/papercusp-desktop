# Shipping Papercusp Desktop

Cheat sheet for cutting + verifying a release.

## Cut a test build

```sh
git checkout feat/desktop-app
git tag desktop-v0.0.1-test<N>
git push origin desktop-v0.0.1-test<N>
```

This triggers `.github/workflows/desktop-release.yml` to matrix-build for macOS, Windows, and Linux in parallel. ~15-30 min later artifacts land on a draft GitHub Release at <https://github.com/papercupai/papercusp-desktop/releases>.

## Watch progress

```sh
gh run list -L 5                                # find the run id
gh run view <run-id>                            # high-level status
gh run view <run-id> --log-failed | head -2000  # diagnose failures
```

## Verify a build before promoting test → real release

Download the platform's installer from the draft Release, then:

### macOS — `.dmg`

1. Double-click the `.dmg`, drag Papercusp into `/Applications`.
2. **Right-click** Papercusp.app → **Open** (the first launch only — bypasses Gatekeeper for the unsigned build).
3. The app's bootstrap window should appear within ~2s.
4. The preflight checks should run; if Postgres / claude / bash isn't installed locally, the check list shows what's missing.
5. Once all checks pass, the window navigates to `/harness`.

If preflight stays stuck on "starting harness sidecar…", the Node sidecar failed to spawn. Open Console.app, filter on "papercusp" — the Rust shell logs everything to stdout/stderr.

### Windows — `.msi` or `.exe`

1. Run the installer; click **More info → Run anyway** when SmartScreen warns about the unsigned binary.
2. Launch from Start Menu.
3. Same flow as macOS — bootstrap → preflight → `/harness`.

If the sidecar fails to spawn, open Event Viewer → Windows Logs → Application and look for events with source "Papercusp".

### Linux — `.AppImage` (recommended)

```sh
chmod +x Papercusp_*.AppImage
./Papercusp_*.AppImage
```

For `.deb`: `sudo dpkg -i Papercusp_*.deb && papercusp`. For `.rpm`: `sudo rpm -i Papercusp_*.rpm`.

Logs go to stdout — run from terminal to see them.

## Promote test → release

When a `desktop-v0.0.1-test<N>` build looks good:

1. Edit the draft GitHub Release on github.com (no longer draft, version number stripped of `-test<N>`).
2. Update the release notes with what's new.
3. Click **Publish release**.

For now, all releases are unsigned. Code signing roadmap:

- **macOS:** Apple Developer ID (~$99/year) + notarization. Sets `APPLE_CERTIFICATE` + `APPLE_CERTIFICATE_PASSWORD` + `APPLE_SIGNING_IDENTITY` + `APPLE_ID` + `APPLE_PASSWORD` + `APPLE_TEAM_ID` GitHub secrets, `tauri-action` picks them up.
- **Windows:** OV/EV code-signing cert from a CA (~$200-500/year). Sets `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` GitHub secrets.
- **Linux:** AppImage + deb don't need signing for typical install. Flathub publication is its own flow.

Once codesigned, also enable `bundle.createUpdaterArtifacts: true` in tauri.conf.json + add `tauri-plugin-updater` Rust dep + `[plugins.updater]` section. The bundler then produces signed `.tar.gz`/`.zip` artifacts the in-app updater consumes.

## Vendored binaries — what gets bundled

`bin/build-desktop-sidecar.sh` downloads two external binaries per build host
and lays them out under the Tauri sidecar so `omp` (Pi CLI) and code-server
work out of the box without the user installing anything:

- **Node.js + npm** — `nodejs.org/dist`. Pinned via `NODE_VERSION` env
  (default `v22.20.0`). ~145 MB per platform. We keep both `node` and
  `npm`/`npx` so the on-demand "Install Claude + Meridian" flow works
  without requiring the user to have Node already installed. Lands at
  `sidecar/bin/{node,npm,npx}` with the npm shim's lib at
  `sidecar/node-runtime/`. Tauri spawns the sidecar + pglite-server
  using `resolve_node_bin()` which prefers the bundled binary and falls
  back to system `node` when missing (keeps dev / non-bundled flows
  working).
- **`gh`** (GitHub CLI) — `github.com/cli/cli` releases. Pinned via
  `GH_VERSION` env (default `2.92.0`). ~38 MB per platform. Single Go
  binary lands at `sidecar/bin/gh[.exe]`. Used by harness flows that
  comment on PRs / open issues / fetch GitHub metadata.
- **MinGit-busybox** (Windows only) — `github.com/git-for-windows/git`
  releases. Pinned via `MINGIT_VERSION` env (default `2.54.0`). ~85 MB
  extracted. Provides `git.exe`, `bash.exe` (busybox dispatch), `ssh.exe`,
  and the POSIX util set (sed/grep/awk via busybox) the harness scripts
  need. Lands at `sidecar/git/`. Tauri prepends three subdirs to PATH
  on Windows: `git/cmd` (git.exe), `git/mingw64/bin` (busybox + the
  `bash.exe` copy the build script drops next to it), `git/usr/bin`
  (ssh + the msys-2.0 DLL set bash.exe needs). macOS/Linux ship git +
  bash + POSIX utils by default and are not vendored.
- **`omp`** — `github.com/can1357/oh-my-pi` releases. Pinned via `OMP_VERSION`
  env (default `v14.5.12`). ~10 MB. Lands at `sidecar/bin/omp[.exe]`. Tauri
  prepends `sidecar/bin` to PATH for the Node sidecar so any pty child finds
  it. All 5 host targets covered: `darwin-{x64,arm64}`, `linux-{x64,arm64}`,
  `windows-x64`.
- **code-server** — `github.com/coder/code-server` releases. Pinned via
  `CODE_SERVER_VERSION` env (default `4.117.0`). **~447 MB extracted** — yes,
  really; it ships its own Node and a full VS Code build. Lands at
  `sidecar/code-server/`. Tauri spawns it on a free loopback port with
  `--auth none --disable-telemetry --disable-update-check` and surfaces the
  URL via `PAPERCUSP_CODE_SERVER_URL`; the operator's contributions resolver
  uses that as the iframe default for `@papercupai/vscode-server`.
  **Linux + macOS only — upstream does not ship a Windows native build**, so
  Windows installers fall back to the plugin's `localhost:8082` config
  default and the user must install code-server (or skip the VS Code tab).

Resulting installer-size jump per platform (vs. pre-bundling):

| Platform   | Δ approx | Notes                                            |
|------------|---------:|--------------------------------------------------|
| linux-x64  |  ~640 MB | node+npm + omp + gh + code-server                  |
| linux-arm64|  ~640 MB | node+npm + omp + gh + code-server                  |
| macos-x64  |  ~640 MB | node+npm + omp + gh + code-server                  |
| macos-arm64|  ~640 MB | node+npm + omp + gh + code-server                  |
| windows-x64|  ~270 MB | node+npm + omp + gh + MinGit; no code-server upstream |

The pi-coding plugin's `omp` and the vscode-server plugin's code-server are
the only vendored externals. The `claude` CLI is intentionally **not**
bundled — preflight checks for it on PATH and surfaces an install hint if
absent. See `docs/desktop-runtime-deps.md` (or memory:
`project_desktop_app_build`) for the full external-deps audit.

Override the pinned versions with build-time env:

```sh
NODE_VERSION=v22.21.0 \
OMP_VERSION=v14.6.0 \
GH_VERSION=2.93.0 \
CODE_SERVER_VERSION=4.118.0 \
MINGIT_VERSION=2.54.1 \
  bin/build-desktop-sidecar.sh
```

The `claude` CLI is intentionally **not** vendored. Anthropic's
Commercial Terms of Service ("All rights reserved") make redistributing
the binary inside another installer legally questionable, and bundling
it would add ~248 MB to the installer.

Instead, the bootstrap UI shows an **Install Claude + Meridian** button
when preflight detects claude is missing. Clicking it streams the
progress of two install steps (via SSE from
`/api/desktop/install-claude-stack`):

1. `curl -fsSL https://claude.ai/install.sh | bash` (Anthropic's
   official installer; `install.ps1` on Windows). Drops the binary at
   `~/.claude/bin/claude` under the user's existing personal-use
   license.
2. `npm install --prefix ~/.papercusp/runtime @rynfar/meridian@<pinned>`
   using the bundled npm. Meridian is MIT-licensed; this install is
   per-user (not vendored into our installer) so we don't redistribute
   its `@anthropic-ai/claude-code` transitive dep either.

The user gets the same one-click UX as if we'd vendored both, without
the legal risk or the ~530 MB installer bloat.

Soft-prerequisite CLIs the harness shells out to but that we do **not**
bundle on macOS/Linux (universally available there; surfaced in preflight
as informational): `git`, `tar`, `curl`, `psql`, `sqlite3`, `python`.
`gh` is bundled on every platform. On Windows, MinGit-busybox additionally
covers `git` + `tar` + `bash` + `grep`/`sed`/etc; `psql` / `python` remain
user-installed even on Windows. If a harness flow that needs one of these
runs without it installed, that flow fails loudly via the run.sh exit code.

If a download fails at build time the script logs a warning and continues —
the desktop bundle still ships, but the corresponding plugin tab falls back
to "user must install on PATH". CI should treat warnings as soft-fail; bake
a hard-fail into the workflow only once the upstream releases are pinned to
known-good tags you've verified.

## Troubleshooting common CI failures

See `project_desktop_app_build.md` in auto-memory — it has the 8 pitfalls catalogued from initial bring-up. Most failures fall into one of those buckets.

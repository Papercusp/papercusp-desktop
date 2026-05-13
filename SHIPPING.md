# Shipping Papercusp Desktop

Cheat sheet for cutting + verifying a release.

## Tag → channel mapping

The Setup Wizard's auto-update step routes through the operator at
`/api/updates/manifest`. That route classifies each GH release by tag
suffix and surfaces it to users on a matching (or laxer) channel:

| Tag pattern                | Channel | Visible to subscribers of |
| -------------------------- | ------- | ------------------------- |
| `desktop-v<X.Y.Z>`         | stable  | alpha + beta + stable     |
| `desktop-v<X.Y.Z>-beta.N`  | beta    | alpha + beta              |
| `desktop-v<X.Y.Z>-rc.N`    | beta    | alpha + beta              |
| `desktop-v<X.Y.Z>-alpha.N` | alpha   | alpha only                |
| `desktop-v<X.Y.Z>-test.N`  | —       | not auto-built (workflow filter)  |

## Cut a release

Use `bin/cut-release.sh` — it bumps `package.json` / `Cargo.toml` /
`tauri.conf.json`, commits, and tags. It does **not** push (so you can
review the diff first).

```sh
bin/cut-release.sh 0.1.0              # stable v0.1.0
bin/cut-release.sh 0.1.0 alpha 3      # v0.1.0-alpha.3
bin/cut-release.sh 0.1.0 beta 1       # v0.1.0-beta.1
```

Then:

```sh
git show HEAD                                 # review the bump commit
git push origin main desktop-v<full>          # triggers the workflow
gh run watch                                  # follow the matrix build
```

The push triggers `.github/workflows/desktop-release.yml` which matrix-builds for macOS (universal), Windows (x86_64), and Linux (x86_64 + arm64) in parallel. ~15-30 min later artifacts land on a draft GitHub Release at <https://github.com/papercupai/papercusp-desktop/releases>.

## Cut a test build

For iterations that should NOT trigger a release (workflow filter excludes `*-test*`):

```sh
git tag desktop-v0.0.1-test<N>
git push origin desktop-v0.0.1-test<N>
```

Workflow won't fire. Use `workflow_dispatch` from the Actions UI if you want a one-off build.

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

## Troubleshooting common CI failures

See `project_desktop_app_build.md` in auto-memory — it has the 8 pitfalls catalogued from initial bring-up. Most failures fall into one of those buckets.

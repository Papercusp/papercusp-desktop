# Shipping Papercusp Desktop

Local-build release flow — no GitHub Actions required.

## One-time setup

```sh
# 1. Generate the Tauri updater signing keypair (lives in ~/.papercusp/signing/)
bin/setup-signing-key.sh

# 2. (Optional) write the PostHog discovery file for feature-flag + telemetry
bin/setup-posthog.sh
```

After step 1, `src-tauri/tauri.conf.json`'s `pubkey` is updated to embed the new public key. Commit that change so released binaries verify against the right pubkey.

After step 2, restart the operator. The wizard's Step 12 will indicate when telemetry is fully live (requires user opt-in *and* `testingFeatures: true` in the discovery file).

## Cut a release

```sh
# Stable release (cuts tag `desktop-vX.Y.Z`)
bin/release-local.sh 0.0.2 stable

# Beta (cuts `desktop-vX.Y.Z-beta` + marks GH release as prerelease)
bin/release-local.sh 0.0.3 beta

# Alpha (cuts `desktop-vX.Y.Z-alpha`, dirty tree allowed for fast iteration)
bin/release-local.sh 0.0.4 alpha
```

The script:

1. Bumps `version` in `package.json`, `Cargo.toml`, `tauri.conf.json`
2. Builds the Node sidecar (`papercup/apps/operator` → `src-tauri/sidecar/`)
3. Runs `tauri build` with the Linux x86_64 target, signing each artifact
4. Generates `latest.json` for the auto-updater
5. Commits + tags + pushes via `git push origin HEAD <tag>`
6. Creates the GitHub Release via `gh release create` (no Actions involved)

The auto-updater route (`/api/updates/manifest` in the operator) reads from these releases by tag pattern.

## Build targets

| Target | Default | How to enable |
|---|---|---|
| Linux x86_64 | ✓ always | — |
| Linux arm64 | optional | `WITH_ARM64=1 bin/release-local.sh …` (needs `cross` set up) |
| Windows x86_64 | optional | `WITH_WINDOWS=1 bin/release-local.sh …` (builds natively on the local Windows VM) |
| macOS universal | optional | `WITH_MAC=1 bin/release-local.sh …` (builds natively on the local Mac VM) |

### macOS (universal .dmg + updater .app.tar.gz, built on the Mac VM)

`WITH_MAC=1` drives a native build on the local QEMU macOS Sonoma VM
(SSH :2222) via `bin/mac-vm-build.sh`: SwiftTerm term-shim (universal
dylib) → sidecar (darwin binaries) → `tauri build --target
universal-apple-darwin`. The GUI binary is universal; the sidecar is
x86_64 and runs under Rosetta 2 on Apple silicon (one-time
`softwareupdate --install-rosetta` — say so in release notes). Plan +
decisions: `mac-desktop-release-readiness-2026-06-11` (esp. D-006).

VM prereqs (one-time, already on the VM): Xcode CLT, nvm Node 22,
`brew install libpq pgvector` (pg client tools + the vector extension —
the build FAILS without pgvector since a fresh DB cannot boot without
it). VM ops: `systemctl --user start papercup-vm-mac.service`;
recovery runbook: the `mac-vm-qmp-recovery` agent insight.

The bundle is NOT Apple-signed/notarized (alpha decision D-002): first
launch needs right-click → Open, or
`xattr -dr com.apple.quarantine /Applications/Papercusp.app`. Updater
payloads are still minisign-signed.

### Windows (NSIS, built on the Windows VM)

`WITH_WINDOWS=1` does NOT cross-compile — it drives a native MSVC build on
the local QEMU Windows 11 VM via `bin/build-windows-on-vm.sh` (the old
`x86_64-pc-windows-gnu` cross lane never worked and MSVC is Tauri's
supported Windows story). Plan + decisions:
`windows-desktop-release-readiness-2026-06-11`.

Per-release prereqs (the script checks all of these and fails early):

1. **VM booted** — `~/windows-vm/boot-windows.sh` (ssh `-p 2223`, key
   `~/.ssh/papercup-vm-win`; spice `:5931`; qemu monitor
   `qemu-monitor.sock` — a black screen + dead ssh usually means
   `paused (io-error)`: check `info status`, then `cont`).
2. **Sidecar built** — `bin/build-desktop-sidecar.sh` (release-local.sh
   does this anyway).
3. **WSL rootfs tarball** — `scripts/build-rootfs.sh` (docker; ~250 MB
   output at `src-tauri/resources/papercup-runtime.tar.gz`, gitignored).
   The Windows app imports this as the `papercup-runtime` WSL2 distro on
   first run — an installer built without it cannot onboard.

The artifact is the NSIS `*-setup.exe` (+ minisign `.sig`); MSI is not
built by default. Artifacts land in
`src-tauri/target/windows-vm/bundle/nsis/` on the host. The Windows app is
unsigned (no Authenticode cert yet) — SmartScreen will warn on install;
revisit before public distribution.

#### Windows per-release gate: install smoke + snapshot convention

Every Windows artifact gets one clean hands-off pass in the VM before it
ships (the P-012 shape): **wipe → install the candidate → ONE launch, zero
touches → WSL import + first-boot bootstrap + finalize restart + fresh
initdb/migrations → then `bin/vm-smoke-windows.sh` from the host = 8/8
green**. The smoke probes ssh → distro → app process → serve discovery →
`/api/health` → backups+kopia (the WSLENV-PATH regression guard) →
agent-tools loopback → zero PG ERROR lines.

Resetting the VM between runs — two tiers:

- **In-guest wipe (default; fast, keeps the toolchain warm).** Close the
  app, then from ssh: `wsl --unregister papercup-runtime`, run the NSIS
  uninstaller (`"%LOCALAPPDATA%\Papercusp\uninstall.exe" /S`, or
  install-over for the reinstall test), delete leftovers
  (`%LOCALAPPDATA%\Papercusp`, `%USERPROFILE%\.papercusp`). Note
  `wsl --unregister` deletes the embedded-PG database with the distro
  (D-007) — that's the point of the wipe.
- **qcow2 snapshot restore (when the guest OS itself is suspect).**
  Internal snapshots on `~/windows-vm/windows_hdd.qcow2`, managed
  **offline only** — shut the VM down first; `qemu-img snapshot` on a
  live image corrupts it (and `savevm` via the monitor would write 32 GB
  of RAM state). `qemu-img snapshot -l|-c <name>|-a <name>
  windows_hdd.qcow2`. Convention: `pre-release-baseline` = provisioned
  toolchain (MSVC/rustc/Node/NSIS), no app installed — refresh it
  deliberately after toolchain upgrades, never casually; transient
  iteration snapshots are `pre-<tag>-<purpose>` and get deleted
  (`-d`) once the lane closes.

Agent-side recipe + sharp edges (schtasks launch, CDP into the webview,
inbox-WSL gotchas): `/internal/docs/agent-insights/windows-vm-desktop-testing-workflow`.

## Verify a build

After `bin/release-local.sh` succeeds:

```sh
# Inspect what landed
gh release view desktop-v0.0.2-alpha --repo Papercusp/papercusp-desktop

# Test the auto-updater manifest end-to-end against your local operator
curl 'http://127.0.0.1:3055/api/updates/manifest?target=linux-x86_64&arch=x86_64&current_version=0.0.1'
```

The manifest endpoint resolves the channel (per the wizard's `update_channel`) and serves the right release.

## Disaster recovery

- **Signing key lost** → run `bin/setup-signing-key.sh` again. All previously-signed releases will fail signature verification on existing installs. Push a new release with the new pubkey baked in. Users on the old install can't auto-update; they need to reinstall.
- **Bad release published** → `gh release delete <tag>` + delete the tag (`git push origin :refs/tags/<tag>`). Cut a new patch version.
- **Manifest wrong on prod** → The manifest is generated at request time by the operator from the GH Release contents. There's no separate manifest file to fix; redeploy the operator if the route logic itself has a bug.

## What's NOT local

A few things still need real-world action:

- **macOS builds** — see above.
- **Production user devices** — these only get builds via `gh release upload` (which `release-local.sh` does for you).
- **PostHog deployment** — `~/.papercusp/posthog.json` is per-machine. End users don't need one; admins / devs do if they want feature flags or telemetry capture.

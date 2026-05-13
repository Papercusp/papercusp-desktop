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
| Windows x86_64 | optional | `WITH_WINDOWS=1 bin/release-local.sh …` (needs `cross` set up) |
| macOS universal | ✗ | requires a Mac + Apple Developer cert; not buildable from Linux |

For macOS you have three options:
- Skip macOS during alpha. Acceptable: `latest.json` won't list a darwin entry, the updater will say "no compatible asset" on Macs.
- Borrow / rent a Mac for builds. Run `bin/release-local.sh` there; it works.
- Pay for a hosted Mac runner (BuildJet, MacStadium). Out of scope of this repo.

## Verify a build

After `bin/release-local.sh` succeeds:

```sh
# Inspect what landed
gh release view desktop-v0.0.2 --repo papercupai/papercusp-desktop

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

# `src-tauri/seed/` — the installer-bundled shared-hive seed

This directory is a **Tauri bundled resource** (`bundle.resources: ["seed/**/*"]`
in `tauri.conf.json`). At **release-build time** it is populated by the seed
cutter and shipped inside the installer so a fresh install pre-positions the
shared-hive bytes and the (unmodified) live join then transfers only the delta.

Plan: `hive-seed-bundle-2026-07-04` (P-006). Design memo:
`/internal/docs/agent-insights/hive-seed-bundle-design`.

## What lands here at release time

```
seed/
  manifest.json      # the combined SeedManifest (@papercusp/seed-bundle)
  git/               # git bundles: super.bundle + submodules/*.bundle (+ index.json)
  corestore/         # the read-only corestore replica of admitted author logs
```

Everything except this README is **git-ignored** (see `.gitignore` here) — it is
a machine-specific, multi-GB build artifact, never committed. This README is the
only tracked file so the resource glob always matches and the Tauri build never
fails on an empty/missing dir.

## Produce it

Run **on the owner box** (the live epoch keychain must be present — the git seal
key is the hive epoch key) with the local operator **stopped** (the corestore dir
must be quiescent), then:

```bash
npx tsx apps/operator/lib/release/cut-seed-cli.ts \
  --out papercusp-desktop/src-tauri/seed \
  --origin https://github.com/Papercusp/papercup \
  --workspace-id papercusp-workspace   # seal git bundles under the hive epoch key (keyRef via=epoch)
```

⚠️ **Pass `--workspace-id` (or `--epoch`) — this is the shipping seal.** It seals
the (PRIVATE-repo) git bundles `via=epoch`, which a freshly-admitted member
decrypts with the epoch key admission delivers (Q-4 / `grantEpochKeysToMembers`).
Do **not** use `--encrypt-key-hex` for a real release: that seals `via=seed-key-op`,
for which there is **no joiner delivery path**, so a member cannot unwrap it and the
git half falls back to a cold clone (fixture/manual use only). And the cut **must**
run on the owner box: `deriveEpochKey` is get-or-create, so a wrong keychain context
mints a divergent key no member can unwrap.

The CLI prints a size report (per-store + total = installer growth). Restore wiring
(first boot) is P-007 in `bootstrap-papercusp-hive.ts`; the failure modes + the full
cut/restore model are in the
[seed-bundle runbook](/internal/docs/agent-insights/hive-seed-bundle-runbook).

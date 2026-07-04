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

Stop the local operator first (the corestore dir must be quiescent), then:

```bash
npx tsx apps/operator/lib/release/cut-seed-cli.ts \
  --out papercusp-desktop/src-tauri/seed \
  --origin https://github.com/Papercusp/papercup \
  --encrypt-key-hex <64-hex>     # REQUIRED — the dogfood repo is PRIVATE
```

The CLI prints a size report (per-store + total = installer growth). Restore
wiring (first boot) is P-007 in `bootstrap-papercusp-hive.ts`.

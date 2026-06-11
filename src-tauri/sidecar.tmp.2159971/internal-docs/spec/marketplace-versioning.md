# Marketplace versioning
URL: /internal/docs/spec/marketplace-versioning

When to bump patch / minor / major on a published template or plugin manifest.

import { Aside } from '@astrojs/starlight/components';

This page describes the **retired** `papercusp publish` / tarball-catalog
marketplace (see the [Distribution](/spec/distribution) banner). The live
distribution surface is the in-app **Cupboard** (`apps/operator-public`),
where listings are GitHub-project-backed and snapshot artifacts are
content-addressed by tarball SHA-256 rather than carried by a
`papercusp.json` `version` field. The semver guidance below is retained as
design rationale for manifest/plugin versioning; the `papercusp publish`
CLI snippet and `marketplace catalog ?version=` behavior no longer reflect
the shipped code.

Marketplace manifests follow semver with one extra rule: **manifest changes that are additive at the same major.minor require a patch bump and a re-publish**.

## Rules

* **Additive manifest field** (e.g. adding `spawnable: { kind, requires }` to a template that didn't have it): bump patch (`0.1.0` → `0.1.1`). Existing installs don't see the new field but continue to work.
* **Breaking manifest field** (e.g. removing a field, changing the meaning of an existing one, requiring a new dependency): bump minor (`0.1.x` → `0.2.0`). Existing installs may need migration.
* **Breaking semantics in the underlying assets** (e.g. SPEC.md format changed, plugin handler signature broke): bump major (`x.y.z` → `(x+1).0.0`). Equivalent to a hard fork; old version stays installable.

## What "additive" means

A manifest field is additive if **all three** are true:

1. Old runtimes ignore the new field gracefully (no parse errors, no startup crash).
2. The template/plugin functionally works the same way for users who haven't upgraded the runtime.
3. The new field only **adds** behavior; it doesn't change or remove behavior.

`spawnable: { ... }` is additive: an old runtime that doesn't know about spawning ignores it; a new runtime can use it. Adding it is a patch bump.

## Re-publishing

```bash
cd ~/.papercusp/harnesses/<template-name>
# Update papercusp.json's version field
jq '.version = "0.1.1"' papercusp.json > .tmp && mv .tmp papercusp.json
# Re-bundle
tar -czf <template>-0.1.1.tar.gz <template-files>
# Publish (uses the marketplace publish-credentials)
papercusp publish
```

## Multiple versions in flight

The marketplace catalog returns the latest version by default. Older versions remain reachable via `?version=<x.y.z>` if needed (e.g. for reproducibility of a snapshot). Patch versions of the same minor are interchangeable for spawning purposes — the executor's `template` validation accepts the template by name, not by version.

## When NOT to bump

* Editing a `README.md` only: optional bump, doesn't materially change behavior.
* Fixing a typo in `mandate.md`: optional bump.
* Internal refactor of a plugin's source that doesn't change the manifest: bump if you want the install machinery to refresh, otherwise skip.

## Audit trail

In the shipped Cupboard, publisher provenance is the GitHub repo-permission signal plus an optional **Ed25519 device-pubkey ↔ GitHub-login attestation** (a signed gist), and snapshot artifacts are content-addressed by tarball SHA-256 — not Cosign. (The original design called for Cosign signing "in v1.5+"; that was a property of the superseded Gitea/OCI marketplace.)

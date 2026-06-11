# Privacy audit (PostHog leak scanner)
URL: /internal/docs/build-system/privacy-audit

The V1 ship contract, how bin/audit-bundle.sh enforces it, and how to extend it for future leak categories.

## The V1 contract

A freshly installed production binary must:

1. Make **zero network requests** to `flags.papercuspai.com` under any usage.
2. Resolve every feature flag to its `FLAG_DEFAULTS` ship value with `source: "defaults"` — i.e. PostHog must not be configured. (The defaults are the V1 ship state: `papercusp-snapshots` is `true` by design; cloudflare-publish / oracle / harness-phases / design / rust-port-ui / testing / the-hive / video / voice / improvement-auto-implement / inbox-durable-escalations are all `false`.)

Both must hold without anyone configuring anything post-install.

## How the system already enforces it

`packages/operator-core/lib/posthog-config.ts` resolves the active PostHog configuration in this priority order:

1. **Env vars** — `PAPERCUSP_POSTHOG_HOST`, `PAPERCUSP_POSTHOG_KEY`, `PAPERCUSP_POSTHOG_PERSONAL_KEY`, `PAPERCUSP_POSTHOG_TESTING_FEATURES`
2. **Discovery file** — `~/.papercusp/posthog.json` (and `~/.papercusp/posthog-personal.json` for the personal API key)
3. **Default** — testing-features disabled → the `/api/flags/bootstrap` layer returns `source: "defaults"`

`packages/operator-core/lib/flag-bus.ts` only initializes the PostHog client when `isTestingFeaturesEnabled() === true`. So on a clean install (no env vars, no discovery files), the PostHog SDK never starts. **Zero network requests by construction.**

`libs/flags/src/types.ts` exports `FLAG_DEFAULTS` with every flag defaulting `false`. These are baked into the bundle. On a clean install they are the values returned.

## What the auditor scans for

`papercusp-desktop/bin/audit-bundle.sh` **FAILs** an artifact only if it contains a real PostHog secret — a `phx_` or `phc_` key followed by 30+ alphanumeric/underscore chars:

```
phx_[A-Za-z0-9_]{30,}
phc_[A-Za-z0-9_]{30,}
```

These are `REGEX_NEEDLES`. Placeholders like `phx_xxx` or path/prose references (`posthog.json`, `PAPERCUSP_POSTHOG_KEY`) deliberately do **not** match — earlier versions used those literal strings as needles and false-positived on source/docs/code, so the literal `NEEDLES` array is now empty.

It also has **soft `WARN_NEEDLES`** that surface (but do *not* fail) when the browser SDK is in the bundle:

```
node_modules/posthog-js/
posthog-js@
```

`posthog-js` is dynamic-imported only when the user opts into telemetry (default off), so its presence isn't a leak per se — but a hostile fork could strip the opt-in gate, so it's worth flagging. WARN, not FAIL.

Documentation paths (`content/docs`, `*.mdx`, `*.md`, `*.rsc`, prerendered `app/docs/*.html`) are excluded from the FAIL scan via an `exclude_re` so legitimate prose mentions of the needles don't trip it.

## Supported artifact formats

```
.deb         → dpkg-deb -x
.rpm         → rpm2cpio | cpio -idm  (falls back to 7z)
.dmg         → hdiutil attach  (on Linux: 7z)
.msi         → 7z x
.exe (NSIS)  → 7z x
.AppImage    → ./Artifact --appimage-extract
directory    → copied + scanned in place (useful for an unpacked Papercusp.app or the sidecar/ dir)
```

If `7z` (or `hdiutil`/`rpm2cpio`) isn't available for a given format, the script WARNs and scans the artifact as a raw binary blob instead. Extraction goes into a `mktemp -d` and is `rm -rf`'d on exit.

## Usage

```sh
bin/audit-bundle.sh path/to/Papercusp_0.0.1_amd64.deb
bin/audit-bundle.sh /home/marsh-office/Papercusp_0.0.1_x86_64.dmg \
                    /home/marsh-office/Papercusp_0.0.1_x64_en-US.msi \
                    /home/marsh-office/Papercusp_0.0.1_x64-setup.exe
```

Exit codes:

* `0` — all clean (`OK: N/N artifacts clean`)
* `1` — at least one artifact had a match
* `2` — usage error

## /admin integration

Three integration points:

1. **Inside each prod-build command** (Linux, Mac, Windows): the build script runs the auditor on its own output before declaring success. A bundled leak fails the build.
2. **Standalone "Audit prod bundles for PostHog leaks" card** — re-runs against the local `papercusp-desktop/src-tauri/target/release/bundle/{deb,rpm}` artifacts plus any `.dmg`/`.msi`/`.exe` in `/home/marsh-office/`.
3. **CI-equivalent local check** — `papercusp-desktop/bin/audit-bundle.sh` can be called from any context; consider adding it to a pre-release script if/when one exists.

## Verified-clean status (2026-05-13)

All four currently-built artifacts pass:

```
Papercusp_0.0.1_amd64.deb       (700 MB)  OK
Papercusp_0.0.1_x86_64.dmg      (460 MB)  OK
Papercusp_0.0.1_x64_en-US.msi   (375 MB)  OK
Papercusp_0.0.1_x64-setup.exe   (268 MB)  OK
```

## Extending the scanner

If a new "must not ship in prod" secret pattern is identified, edit `papercusp-desktop/bin/audit-bundle.sh`. Prefer a **regex** that matches only the real secret (long random suffix), not a placeholder or path reference:

```sh
REGEX_NEEDLES=(
  'phx_[A-Za-z0-9_]{30,}'
  'phc_[A-Za-z0-9_]{30,}'
  # add new secret-shaped patterns here
)
```

For a literal-string match, add to the (currently empty) `NEEDLES` array — but be careful: literal needles like `posthog.json` false-positive on source/docs/code, which is exactly why they were removed. For a "this code is present but gated" signal that should surface without failing the build, add to `WARN_NEEDLES`. Then run the standalone audit card to verify existing artifacts before declaring the new policy enforced.

## Why this isn't an AST / behavioral scan

The bundles are gigabytes of compiled JS, minified output, native binaries, postgres data files, etc. A `grep -rlF`/`grep -rlE` over the extracted tree is fast (\~5–10s per artifact). The auditor uses **regex** needles tuned to match only real secrets (a `phx_`/`phc_` key with a long random suffix) so it doesn't false-positive on placeholders or prose — rather than parsing the JS, which would be slow and brittle against minification.

## What the auditor does NOT catch

* **Behavioral leaks**: code that hardcodes `flags.papercuspai.com` and calls `fetch()` regardless of `isTestingFeaturesEnabled()`. The auditor scans for embedded *secrets*, not for the SDK's runtime behavior. Defense: the build chain validates `flag-bus.ts`'s gating discipline; no code outside that file should touch PostHog endpoints.
* **Same-host PostHog instance accidentally pointing prod traffic somewhere it shouldn't**. Defense: see the V1 contract — even with a wrong host, the client must not start.
* **Telemetry from other sources** (Tauri's auto-update, OS crash reporters). These are separate trust decisions documented elsewhere.

If you need to validate behavioral guarantees, see [verification](/internal/docs/build-system/verification) — that page covers the live-run smoke test (`curl /api/flags/bootstrap`, `ss -tnp | grep flags.papercuspai`) that catches behavioral leaks.

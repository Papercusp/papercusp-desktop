# Desktop release: cut → upload → auto-update (runbook)
URL: /internal/docs/agent-insights/desktop-release-upload-runbook

Runbook for shipping a desktop release on the local-only rail: build the cut, upload artifacts to the R2 release host, and publish the manifest that drives auto-update.

## The two invariants — read these before you touch anything

**1. The manifest address is PERMANENT.** Every shipped app has
`<base>/latest.json` compiled into it. It polls that exact URL forever. Change the
base and every install that is already out there silently stops updating — it keeps
polling an address that no longer answers, and (this is the nasty part) reports
itself as *up to date* while doing so. The base lives in
`~/.papercusp/release-host.env`, mode 600, outside git. **Never regenerate it.**

**2. The ARTIFACT urls are NOT permanent — and that is deliberate.** They live
*inside* `latest.json`, which is fetched fresh on every check. So you can move where
the installers are stored, per release, without shipping a new app. Only the manifest
has to stay put. That asymmetry is the whole design.

The secret sits in the **path** (`https://dl.papercusp.com/<secret>/…`), not in the
hostname. A random *subdomain* would be published to Certificate Transparency logs
the moment it got a TLS cert — paths never appear in CT or in DNS. This is
obscurity, not access control: the URL is baked into the binary and `strings` will
find it. It keeps the artifacts unlisted; it does not keep them private.

## Cut the release

```bash
cd papercusp-desktop
bin/release-local.sh 0.0.8 alpha
```

This builds, signs, and writes `/tmp/papercusp-latest-desktop-v0.0.8-alpha.json`.
It publishes nothing — artifacts stay local. The script sources
`release-host.env` itself, so the manifest comes out already pointing at the real
host, and the host is baked into the binary via `PAPERCUSP_RELEASE_HOST`.

If that env is missing, the cut still succeeds but every url in the manifest is the
deliberate placeholder `papercusp-update-base-unset://…`. That is a **feature**: a
loud, unmistakably-invalid URL beats a plausible-but-wrong one. Both the uploader and
the operator refuse to serve a manifest containing it.

## Security audit — YOU run this, and you read the output

The build already gates itself: `bin/stage-source-tree.sh` runs
`bin/audit-release-bundle.py` on the `source.tar.zst` it just produced and **fails
the build** on any finding. You do not have to remember to invoke it. You *do* have
to do the part a regex cannot.

**Why this gate exists at all.** Every bundle ships `source.tar.zst` — a plaintext
tar of the whole monorepo working tree, so the packaged app's dev/local buttons have
something to run. The 0.0.8 cut shipped **53,225 untracked files** that way,
including **121 agent session transcripts** (`.papercusp/pi-sessions/*.jsonl`) with
the operator's home path in every record. Nobody decided to ship those. The staging
script's exclusion list simply had never heard of `.papercusp/` (WI-4419).

**Two things follow, and they are the whole point:**

1. **Scan the artifact, not the repo.** A source-tree scan would have *passed* on
   0.0.8 — the repo was clean. The leak only existed once the tar swept up untracked
   scratch. If you find yourself grepping the working tree to check a build is clean,
   you are measuring the wrong object.

2. **The leak's contents vary by build host.** The same structural hole on the mac
   box carried *zero* transcripts, purely because that machine had none. A clean
   audit on your box says nothing about anyone else's. This is why the identity rules
   (username, home path, hostname) resolve **at run time** from the building machine
   rather than being hardcoded — the gate scrubs *whatever box it runs on*.

**Your job — the triage the scanner cannot do.** Its rules are deliberately
high-recall, so it will hand you things that are not leaks, and telling them apart is
judgment. Real examples from the WI-4419 sweep: `AKIAIOSFODNN7EXAMPLE` is AWS's own
documentation placeholder; a bare 27-character PEM `BEGIN…PRIVATE KEY` *header*
string sitting in a V8 compile cache is a header, not a key; `sk-ant-…-CHANGED` is a
test fixture. All three look alarming and none of them are. Meanwhile a real 40-char
`gho_…` token *was* sitting in a turbopack build cache on the dev box.

(This document itself tripped the repo's `secrets-guard` hook while being written,
because it quoted that PEM header literally. That is the same false-positive class,
and it is a fair illustration: a high-recall rule cannot tell a *description* of a key
from a key. Judgment is the job.)

So when it fires:

* **Fix the source of the leak** — the allowlist in `bin/stage-source-tree.sh`.
* **Do not add an exception to make the build pass.** The `BENIGN` list in the
  auditor is for *documented* false positives with a justification, not a place to
  park a finding you would rather not deal with. Silencing the gate to ship is the
  bug the gate exists to catch.
* If you genuinely cannot classify a hit, **stop and ask** rather than shipping it.

To audit a bundle by hand (it is idempotent, and safe to run any time):

```bash
python3 bin/audit-release-bundle.py src-tauri/sidecar/source.tar.zst   # exit 0 clean / 1 findings
```

It never prints a secret value — findings are redacted to `head…tail (len N)`.

## Upload

```bash
bin/upload-release.sh 0.0.8 alpha        # DRY_RUN=1 to preview
```

Order is load-bearing: **artifacts first, `latest.json` last.** The manifest is what
makes an update *visible* to every installed app, so publishing it before the bytes
it points at exist would advertise an update that 404s for anyone who checks in the
gap.

It then verifies two things separately, because they fail for unrelated reasons:

* **storage** (authenticated, via the S3 endpoint) — did the bytes land at full size?
* **the public read path** — can a client actually fetch what the manifest advertises?
  It re-downloads `latest.json` over HTTPS, diffs it byte-for-byte against what was
  uploaded, and HEADs every artifact url in it.

Exit `2` means the artifacts uploaded fine but the hostname does not resolve — the
R2 bucket has not been bound to the custom domain yet. That is one-time Cloudflare
setup, not a broken upload.

## How auto-update actually resolves

An installed app polls its operator's `/api/updates/manifest`, which discovers
releases from **two** sources, in priority order:

1. **The static release host** — authoritative *whenever it publishes
   `<host>/latest.json`*. This is the live rail.
2. **GitHub Releases** — legacy. Still used for the hybrid case where GitHub carries
   the release but artifacts exceed its 2 GiB asset cap.

A configured host that is *unreachable* returns 204 and warns server-side; it
deliberately does **not** fall through to GitHub, because a stale GitHub release
could be offered as a silent **downgrade**.

## The failure this rail exists to prevent

`204` means "no update available", and the Tauri updater **cannot distinguish it from
"the check failed"**. So any break in this chain — no manifest, an unreachable host, a
manifest whose urls 404 — presents to the user as *"you are up to date."* Forever.
That is exactly how auto-update was silently dead on the local-only rail (WI-4389):
the manifest route discovered releases only from GitHub Releases, which we stopped
publishing to.

The lesson generalizes: **a signed, schema-valid manifest that names a download
location which does not exist is still a broken release.** Verify the bytes are
fetchable at the advertised url, not merely that the manifest validates.

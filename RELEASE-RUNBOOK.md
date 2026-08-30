# Desktop release runbook — cut + verify all three platforms

> **P-015 of `desktop-build-hardening-tri-platform-2026-07-11`.** The single
> documented path for cutting a Papercusp desktop release and proving it is
> honest, self-verifying, and installable — replacing the tribal knowledge that
> was scattered across checkpoints and insights. It ties together
> `bin/release-local.sh` (the cut), the Phase-1 provenance layer, and the Phase-3
> verify tools (`release:verify-provenance`, `release:vm-preflight`,
> `release:install-and-relaunch-verify`).

## ⛔ Releases are LOCAL-only — never publish to GitHub

**Owner directive 2026-07-08 (binding):** *"We are no longer using GitHub for our
releases — just build the installer locally and I will upload it to the right
spot."*

- Build the artifacts locally, then hand the owner the **local artifact paths +
  their sha256** (see [Hand-off](#5-hand-off)). The owner uploads them.
- **Do NOT** push a release, create a GitHub Release, or attach artifacts to one.
- ⚠ `bin/release-local.sh`'s own header comment and its steps 5–6 ("push tag to
  origin", "create GitHub Release with artifacts") are **superseded** by this
  directive — that header predates it. The *build/sign/provenance/verify* steps
  are current; the *publish-to-GitHub* steps are not. Treat the build output on
  disk as the deliverable.

---

## 0. Prerequisites

| Need | How |
|------|-----|
| Signing key | `~/.papercusp/signing/papercusp.key` present (`bin/setup-signing-key.sh`). Updater artifacts are minisign-signed with it on every platform. |
| macOS leg (optional) | the mac build VM up on SSH `:2222` — see `/internal/docs/build-system/vms`. Enable with `WITH_MAC=1`. |
| Windows leg (optional) | the Windows 11 build VM up on SSH `:2223`, distro `papercup-runtime`. Enable with `WITH_WINDOWS=1`. |
| Live operator (for verify) | a running operator whose `/api/health` reports the cut's `sha` (the dev `:3070`, or the VM's in-distro operator). |

---

## 1. Cut the build

⚠ **`bin/release-local.sh` now REQUIRES two env vars before any write** (P-016 /
EI-20505417131773854, EI-21007848170102877) — a bare invocation with no env
fails immediately with `ERROR: release source drift` / `ERROR: release cut
requires PAPERCUSP_RELEASE_OWNER_NAME`. `release:cut` (below) supplies both
for you; a manual invocation must too:

```bash
cd papercusp-desktop
# <version> <channel>  — channel ∈ stable | beta | alpha
PAPERCUSP_EXPECTED_SOURCE_SHA="$(git -C .. rev-parse HEAD)" \
PAPERCUSP_RELEASE_OWNER_NAME="<your name>" \
  bin/release-local.sh 0.0.8 alpha                 # Linux only
WITH_MAC=1 WITH_WINDOWS=1 \
PAPERCUSP_EXPECTED_SOURCE_SHA="$(git -C .. rev-parse HEAD)" \
PAPERCUSP_RELEASE_OWNER_NAME="<your name>" \
  bin/release-local.sh 0.0.8 alpha   # all three
```

**Agent lever (preferred): `release:cut`.** The `release:cut` MCP tool is the
orchestrator over this script — `op:preflight` (go/no-go: signing key + scripts
present, nothing in flight), `op:run` (fires the cut **detached** so a 35–60 min
build survives a compaction/relaunch; dry-run unless `confirm:true`; operator role;
audited), `op:status` (poll it), `op:handoff` (collect the version's signed artifacts
+ sha256 for the owner — §5). It always runs the cut LOCAL-only
(`PAPERCUSP_PUBLISH_GITHUB=0`), so it can never publish to GitHub.

What the cut does, and the guard behind each step (Phase 1 + Phase 2):

1. **Honest sha (P-003).** `BUILD_SHA` is derived once, centrally, and gets a
   `-dirty` suffix if the desktop tree *or* the sidecar source is dirty — so
   `/api/health` never claims a clean commit for a dirty/reused tree. Flows
   unchanged into all three legs.
2. **Provenance-parity fail-fast (P-016).** `bin/verify-provenance-parity.sh`
   runs at the top of the cut: all three legs must emit a `build-provenance.json`
   conforming to the one shared schema (one emitter — `bin/emit-build-provenance.sh`
   — no re-inlined `printf` emitters). Override (rarely):
   `PAPERCUSP_SKIP_PROVENANCE_PARITY_CHECK=1`.
3. **serve.mjs freshness — fail-closed (P-004 / D-003).** Before packing, the
   packed `serve.mjs` fingerprint must match a fresh `build-desktop-sidecar.sh`
   output. A stale bundle **aborts** the cut (no silent auto-rebuild). Override:
   `PAPERCUSP_ALLOW_STALE_SIDECAR=1`.
4. **Host-load protection (P-006 / D-005).** The local CPU-heavy legs run under
   `nice`/`ionice` and the cut sets `PC_HEAVY_BYPASS=1` so it is never denied by
   the WI-3821 admission gate and never holds a short-command slot. Disable the
   nice-ing with `PAPERCUSP_RELEASE_NICE=0`. *(The build was the victim of host
   load, not its cause — don't throttle it.)*
5. **VM build resilience (P-007 / P-008).** The mac leg carries the SSH keepalive
   parity fix and runs **detached** on the VM (poll-for-done, non-fatal SSH
   flaps — never re-invoke a 35-min build). The mac leg fails fast on a VM
   disk-OOM preflight (`PAPERCUSP_MAC_MIN_FREE_GB`, default 12) instead of
   OOM-ing 20 min in.
6. **Version-scoped collection (P-009).** Every artifact-collection glob is
   `*_<version>_*`; a cross-version count assertion trips if a stale-version
   artifact is about to be collected.
7. **Verifiable salvage (P-005).** If `PAPERCUSP_REUSE_MAC=1` / `REUSE_WIN=1`
   salvages a prior cut's bytes, the cut reads that cut's `build-provenance.json`
   and **fails loud** if its version differs (no silent re-label). Overrides:
   `PAPERCUSP_ALLOW_REUSE_UNVERIFIED=1` / `PAPERCUSP_ALLOW_REUSE_VERSION_MISMATCH=1`.
8. **Emit provenance + sign + `latest.json`.** Each leg writes a
   `build-provenance.json` (version, buildSha, gitDirty, per-artifact sha256,
   signed, toolchain) next to its artifacts; updater artifacts are minisign-signed;
   `latest.json` carries per-platform `url` + `signature`.

Reproducibility (P-014): `tauri-cli` is pinned (`PAPERCUSP_TAURI_CLI_VERSION`
override) and the build toolchain (rustc/node/tauri-cli) is recorded in
`build-provenance.json`.

---

## 2. Ship-gate: `bin/verify-provenance.sh` (P-010)

The executable form of "a bad build physically cannot ship." Run the canonical
script once per cut artifact directory before handing anything over:

```
bash bin/verify-provenance.sh <artifact-dir> --health-sha <sha> --require-signed
```

Given one cut artifact directory and its `build-provenance.json`, it asserts
(via `bin/verify-provenance.sh` + `bin/verify-tauri-signature.mjs`):

- `gitDirty == false`;
- `buildSha == the supplied live `/api/health` sha`;
- **each artifact's sha256** matches what provenance recorded;
- **D-004 signature dimension** — each artifact's minisign `.sig` verifies against
  the embedded updater pubkey (Node Blake2b-512 + Ed25519, no external `minisign`),
  and `latest.json`'s per-platform `url` + `signature` reference the *exact*
  artifact whose sha256 was just verified.

A targeted single-dir check with explicit args:
`bash bin/verify-provenance.sh <artifact-dir> --health-sha <sha> [--require-signed]`.

**Green here is the ship gate.** Any FAIL → do not hand it over.

---

## 3. VM operator health: `bin/vm-preflight.sh` (P-011)

Before (and after) exercising an install on a VM, confirm the packaged operator
is genuinely alive — without misreading a healthy operator as dead (WI-3270):

```
bash bin/vm-preflight.sh --json
```

The WI-3270 triad: host VM process (`pgrep`) + app process in the VM (`tasklist`)
+ operator `/api/health` **probed from INSIDE the WSL distro** (the authoritative
signal). An inner-healthy / outer-failing split is reported as non-fatal
**`forward-degraded`** (repair the Windows→WSL forward, never kill the operator).
Direct: `bash bin/vm-preflight.sh --json`.

If the SSH leg cannot complete, the preflight also requests a host-side QEMU HMP
`screendump` through `~/windows-vm/qemu-monitor.sock` and records the PNG path in
the JSON verdict (`guestScreenPng`). This is diagnostic evidence for distinguishing
a bluescreen, boot/login screen, and hung guest; it does not turn the screenshot
into a health pass. Override the socket or artifact directory with
`--monitor-socket PATH` and `--screendump-dir DIR` when the VM uses a different
layout. A QEMU-owned hostfwd LISTEN socket is never treated as guest liveness.

---

## 4. Live update proof: `bin/install-and-relaunch-verify.sh` (P-012)

The EI-9002 / WI-3783 live proof that installing the new cut **actually replaces
the running operator, in place, keeping its address**:

```
bash bin/install-and-relaunch-verify.sh \
  --platform windows \
  --artifact <new-gui-installer> \
  --server-artifact <matching-server-installer>
```

Sequence: snapshot the running operator (`/api/health` sha+version + sticky port)
→ scp + install the matching GUI **and Server** cut (including every
provenance-listed Windows Inno span) → **relaunch WITHOUT terminating** (the app's
`serve --ensure` must replace the stale operator itself) → assert (a) the sha +
version **flip** old→new [EI-9002: not a silent no-op update] and (b) the operator
**sticky port holds** [WI-3783]. The target sha is the artifact's *own*
`build-provenance.json` sha (D-002 — rollback-safe).

> ⚠ This **touches the VM** (scp + install + relaunch). Only run it when a build
> VM is genuinely free to be mutated. Validate the argument surface without VM
> contact with `bash bin/install-and-relaunch-verify.sh --help`; the script's
> mock `PC_SSH`/`PC_SCP` harness is the no-VM verification path.
> For a specific artifact / mac|linux / a different VM, call
> `bash bin/install-and-relaunch-verify.sh --platform <p> --artifact <path> [flags]`.
> On Windows the script auto-resolves the exact-version Server stub beside the
> GUI artifact and fails closed unless its provenance matches and every listed
> span is present; use `--server-artifact PATH` only to override that location.
> For a disposable/reset VM whose host key is intentionally rotated, opt in to
> the transport overrides explicitly on both legs:
> `--ssh-option StrictHostKeyChecking=no --ssh-option UserKnownHostsFile=/dev/null
> --scp-option StrictHostKeyChecking=no --scp-option UserKnownHostsFile=/dev/null`.
> Host-key checking remains strict by default.

**In-app backstop (P-013):** every user's first launch after an update runs a
built-in self-check (`run_update_self_check` in `src-tauri/src/main.rs`): if the
running `/api/health` sha ≠ this build's own baked sha, the user gets a persistent
"Update did not fully apply — restart" toast. This turns EI-9002 from an
agent-noticed bug into an invariant the user sees, on every install and every
rollback.

---

## 5. Hand-off

1. Collect, per platform, the installer(s) + their `.sig` + `build-provenance.json`
   + `latest.json` from the cut output under `src-tauri/target/**/bundle/`.
2. Compute/confirm each artifact's **sha256** (verify-provenance already did).
3. Give the **owner** the local paths + sha256. The owner uploads them to the
   right spot. **Never** publish to GitHub (see the top of this runbook).

---

## Verification standard for the tooling itself (D-007)

The release scripts cannot be fully end-to-end'd without the VMs, so the Phase-3
tools are accepted on: `bash -n` + a functional/derivation test + an emitter/artifact
smoke-run against **real bytes** + a render of the exact remote command strings +
a mock ssh/scp responder covering every branch. No claim of "verified" rests on a
live VM run that did not happen.

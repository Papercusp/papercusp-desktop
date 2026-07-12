#!/usr/bin/env bash
# Build + sign a Papercusp desktop release LOCALLY (no GitHub Actions, and —
# since 2026-07-12 — no GitHub publish at all). Run on this Linux box;
# produces a Linux x86_64 build by default, with cross-compile hooks for
# other targets.
#
# ⛔ RELEASES ARE LOCAL-ONLY. Owner directive (2026-07-08, restated
# 2026-07-12): "We are no longer using github for our releases so just build
# the installer locally and I will upload it to the right spot." The signed
# artifacts + latest.json on disk ARE the deliverable. This script prints each
# artifact with its sha256 at the end; hand those to the owner, who uploads.
# The old GitHub-publish leg (git push origin + gh release create/upload,
# behind PAPERCUSP_PUBLISH_GITHUB=1) has been DELETED, not merely defaulted
# off — see the note at the tail. Recover it from git history if that ever
# reverses.
#
# Usage:
#   bin/release-local.sh 0.0.8 stable     # tag + channel
#   bin/release-local.sh 0.0.8 beta
#
# What it does:
#   1. Bumps version in package.json + Cargo.toml + tauri.conf.json
#   2. Builds the sidecar (papercup/apps/operator → src-tauri/sidecar/)
#   3. cargo + Tauri build (signs with ~/.papercusp/signing/papercusp.key)
#   4. Generates latest.json manifest + release notes
#   5. Commits the version bump and creates a LOCAL git tag (never pushed)
#   6. Prints the local artifacts + sha256s, and stops.
#
# NOTE: it DOES `git commit` the version bump and `git tag -f` locally (neither
# is pushed to origin). It also pushes a dogfood *monorepo* tag — see the
# PAPERCUP_DOGFOOD_REPO_REF block below; that is a source-pin, not a release.
#
# Optional platform legs:
#   - macOS  : WITH_MAC=1 — drives the macOS build VM over SSH
#              (universal binary, UNSIGNED by Apple — D-002/D-006 of
#              mac-desktop-release-readiness-2026-06-11; updater
#              artifacts are still minisign-signed). VM must be up
#              (SSH :2222, see /internal/docs/build-system/vms).
#   - Windows: WITH_WINDOWS=1 — drives the Windows 11 build VM over SSH
#              (native MSVC NSIS build, keyless in-VM, .sig signed
#              host-side — D-001/D-006 of
#              windows-desktop-release-readiness-2026-06-11; no
#              Authenticode yet, SmartScreen will warn). VM must be up
#              (SSH :2223, ~/windows-vm/boot-windows.sh).
#   - arm64  : cross-compile via WITH_ARM64=1 (needs `cross` set up)
#
# Re-run safety: idempotent. If a release for the tag exists, asset
# uploads use `gh release upload --clobber`.

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <version> <channel: alpha|beta|stable>"
  exit 1
fi

VERSION="$1"
CHANNEL="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
KEY_FILE="${HOME}/.papercusp/signing/papercusp.key"
KEY_PUB="${HOME}/.papercusp/signing/papercusp.key.pub"

# ── Release host (plan desktop-release-hosting-r2-2026-07-12) ────────────────
# Where the shipped app looks for updates, and where the artifacts get uploaded.
# Kept OUT of git and alongside the signing key, because it is a shared secret of
# the same character: the secret lives in the URL PATH (D-002 — a random
# SUBdomain would be published to Certificate Transparency the moment it got a
# cert), and it is PERMANENT (D-003 — it is baked into every shipped app, so
# rotating it silently strands every existing install on a dead URL).
#
#   PAPERCUSP_RELEASE_HOST    → baked into the app; the app polls <host>/latest.json
#   PAPERCUSP_UPDATE_BASE_URL → written into latest.json as the artifact download base
#
# Both are the same value today. They are separate knobs on purpose: only the
# MANIFEST location must be permanent — the artifact URLs live inside latest.json
# and can move per release without an app update.
RELEASE_HOST_ENV="${HOME}/.papercusp/release-host.env"
if [[ -f "$RELEASE_HOST_ENV" ]]; then
  # shellcheck source=/dev/null
  set -a; . "$RELEASE_HOST_ENV"; set +a
fi
export PAPERCUSP_RELEASE_HOST="${PAPERCUSP_RELEASE_HOST:-}"
export PAPERCUSP_UPDATE_BASE_URL="${PAPERCUSP_UPDATE_BASE_URL:-$PAPERCUSP_RELEASE_HOST}"
if [[ -z "$PAPERCUSP_RELEASE_HOST" ]]; then
  echo "WARNING: no release host configured ($RELEASE_HOST_ENV missing)."
  echo "         The build will ship WITHOUT an update source: an installed app polls,"
  echo "         gets nothing, and the Tauri updater reads that as 'up to date' FOREVER."
  echo "         latest.json's urls will be placeholders. Installers still work."
  echo "         See plan desktop-release-hosting-r2-2026-07-12."
fi

WITH_WINDOWS="${WITH_WINDOWS:-0}"
WITH_ARM64="${WITH_ARM64:-0}"
WITH_MAC="${WITH_MAC:-0}"
# P-014 (repro hygiene): PIN the Tauri CLI instead of `@latest` (which fetches
# whatever npm resolves at cut time — a silent reproducibility hole: two cuts of
# identical source could bundle with different tauri-cli versions). Keep in sync
# with package.json's @tauri-apps/cli devDependency (^2.1.0 → resolved 2.11.0).
# One-off override: PAPERCUSP_TAURI_CLI_VERSION=x.y.z.
TAURI_CLI_VERSION="${PAPERCUSP_TAURI_CLI_VERSION:-2.11.0}"
# P-007 (desktop-build-hardening-tri-platform-2026-07-11): keepalive parity with
# the Windows leg (build-windows-on-vm.sh:113). ssh's DEFAULT ServerAliveCountMax=3
# tears the session down after ~90s of VM unresponsiveness — that 90s death is what
# discarded the 0.0.7 cut mid-build when host-load starvation (WI-3792) stalled the
# VM. 30s interval × 20 misses tolerates ~10min of unresponsiveness before ssh
# gives up; IdentitiesOnly pins auth to this key so a loaded agent doesn't offer
# many keys and trip MaxAuthTries. Reused by every mac ssh/scp/rsync call below.
MAC_VM_KEEPALIVE=(-o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=20)
MAC_VM_SSH=(ssh -i "${HOME}/.ssh/papercup-vm-mac" -o IdentitiesOnly=yes -p 2222 -o BatchMode=yes "${MAC_VM_KEEPALIVE[@]}" aviweiss@127.0.0.1)
MAC_VM_SCP=(scp -i "${HOME}/.ssh/papercup-vm-mac" -o IdentitiesOnly=yes -P 2222 -o BatchMode=yes "${MAC_VM_KEEPALIVE[@]}")
MAC_VM_RSYNC_E="ssh -i ${HOME}/.ssh/papercup-vm-mac -o IdentitiesOnly=yes -p 2222 -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 -o ServerAliveCountMax=20"
MAC_VM_BUILD_DIR="papercup-build-mac/papercup"
# Build provenance: the short git sha of the tree we're packaging, made HONEST
# per EI-8914 / P-003 (desktop-build-hardening-tri-platform-2026-07-11). This is
# the SINGLE SOURCE OF TRUTH for PAPERCUSP_BUILD_SHA across all three legs — it
# flows unchanged into the linux/mac/arm64/windows build envs below AND into
# every build-provenance.json emit, so option_env!("PAPERCUSP_BUILD_SHA")
# (main.rs) / the operator's /api/health can never claim a clean commit for a
# build cut from a modified tree. The VM build trees are rsynced WITHOUT .git, so
# they can't self-derive it — it MUST be passed in from here, where .git is
# present.
#
# Why the -dirty marker (previously only the Windows leg carried it,
# build-windows-on-vm.sh): the linux leg compiles the LIVE working tree, and the
# mac/windows legs overlay THIS release's version-bump (+ freshly-cut seed) onto
# their source — so a cut is ~never a byte-clean checkout of HEAD, and on this
# shared fleet checkout the tree is almost always dirty against HEAD (git-sync
# commits on a schedule). Baking a bare commit UNDER-reports that — the exact
# LABELED!=PACKED lie P-003 kills. Mark -dirty whenever the desktop tree OR the
# monorepo superproject (the sidecar is built from apps/operator, so its
# dirtiness ships too) has uncommitted changes. Over-reporting dirty is the SAFE
# direction; the per-artifact packedSrcFingerprint (P-014) is what actually
# distinguishes two dirty cuts. On stable/beta the dirty-tree guard below aborts
# a dirty desktop tree, so a clean release keeps a bare sha; alpha surfaces it.
# (Fed this already-honest value, the Windows leg's own derivation reproduces the
# same label — no divergence.)
_short_head="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || true)"
if [[ -n "$_short_head" ]] \
   && { [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]] \
        || [[ -n "$(git -C "$ROOT/.." status --porcelain 2>/dev/null)" ]]; }; then
  BUILD_SHA="${_short_head}-dirty"
else
  BUILD_SHA="$_short_head"
fi
echo "==> build provenance: PAPERCUSP_BUILD_SHA=${BUILD_SHA:-<unknown>}"
# Fail-fast on a -dirty cut (0.0.8 drive, 2026-07-11): the release-verify-provenance
# ship-gate asserts gitDirty==false on EVERY channel — alpha included, since alpha
# IS the public shipping channel — so a -dirty cut can only produce unshippable
# bytes; abort at second five, not minute forty. On this shared fleet checkout the
# cure is: force git-sync, wait for `status --porcelain` to be empty in BOTH the
# desktop tree and the superproject, re-fire. PAPERCUSP_ALLOW_DIRTY=1 escapes for
# local dev iteration (the -dirty label itself stays honest, P-003).
if [[ "$BUILD_SHA" == *-dirty && "${PAPERCUSP_ALLOW_DIRTY:-0}" != "1" ]]; then
  echo "ERROR: BUILD_SHA is ${BUILD_SHA} — uncommitted changes in the desktop tree or superproject."
  echo "       A -dirty cut cannot pass the ship-gate (gitDirty must be false), so this run"
  echo "       would only produce unshippable artifacts. Force git-sync, verify"
  echo "       'git status --porcelain' is empty in $ROOT AND $ROOT/.., then re-fire."
  echo "       (PAPERCUSP_ALLOW_DIRTY=1 to build a dirty dev cut anyway.)"
  exit 1
fi
# Build provenance: the shipped app VERSION (WI-2644). Same mechanism as
# PAPERCUSP_BUILD_SHA above — the packaged sidecar has no npm_package_version
# in its env, so build-info.ts needs this baked in explicitly. Sourced from
# $VERSION (this script's own CLI arg, semver-validated below) — the exact
# value this run writes into tauri.conf.json, so they can never drift.
echo "==> build provenance: PAPERCUSP_BUILD_VERSION=${VERSION}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9.-]+)?$ ]]; then
  echo "ERROR: version must look like X.Y.Z or X.Y.Z-foo"
  exit 1
fi

case "$CHANNEL" in
  alpha|beta|stable) ;;
  *) echo "ERROR: channel must be alpha|beta|stable"; exit 1 ;;
esac

# Tag convention matches the operator's manifest classifier
# (apps/operator/app/api/updates/manifest/route.ts):
#   alpha  → desktop-vX.Y.Z-alpha
#   beta   → desktop-vX.Y.Z-beta
#   stable → desktop-vX.Y.Z
case "$CHANNEL" in
  alpha)  TAG="desktop-v${VERSION}-alpha" ;;
  beta)   TAG="desktop-v${VERSION}-beta" ;;
  stable) TAG="desktop-v${VERSION}" ;;
esac

echo "==> version=$VERSION channel=$CHANNEL tag=$TAG"

# P-016: parity regression gate — fail FAST (before the ~35-min build) if any leg
# re-forked provenance emission or the centralized honest-sha derivation. Fast +
# hermetic. Skip with PAPERCUSP_SKIP_PROVENANCE_PARITY_CHECK=1 (emergencies only).
if [[ "${PAPERCUSP_SKIP_PROVENANCE_PARITY_CHECK:-0}" != "1" ]]; then
  echo "==> checking build-provenance parity (P-016)"
  bash "$ROOT/bin/verify-provenance-parity.sh" \
    || { echo "ERROR: build-provenance parity gate failed (above) — a leg re-forked provenance. Fix, or PAPERCUSP_SKIP_PROVENANCE_PARITY_CHECK=1 to override."; exit 1; }
fi

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: signing key not found at $KEY_FILE"
  echo "       Run bin/setup-signing-key.sh first."
  exit 1
fi

# NOTE: there is deliberately NO `gh` CLI preflight here. It used to hard-fail
# the cut when gh was missing or unauthenticated — dead weight once the GitHub
# publish leg was removed (2026-07-12), and an active landmine: it blocked a cut
# on any machine without an authenticated gh (e.g. the mac/windows VM legs, which
# drive this same script). A local build must never require a GitHub credential.

# Refuse to publish from a dirty tree on stable/beta. On alpha we
# allow it for fast iteration.
if [[ "$CHANNEL" != "alpha" ]]; then
  if [[ -n "$(git -C "$ROOT" status --porcelain)" ]]; then
    echo "ERROR: tree dirty — commit or stash before a $CHANNEL release"
    git -C "$ROOT" status --short
    exit 1
  fi
fi

# WI-3047: guard against cutting a release from a STALE `libs/papercusp`
# submodule checkout — the actual root cause of the 2026-07-05 incident where a
# seeded Linux .deb shipped the pre-505/506 schema (agent_facts REPLICA
# IDENTITY sweep failure, the WI-2914 bug 505 fixes). build-desktop-sidecar.sh
# bakes db-seed.tar.gz from whatever is CURRENTLY checked out under
# libs/papercusp/libs/db/sql/ — internally consistent by construction, but
# silently stale if the submodule pointer lags its remote (new migrations
# merged upstream, never pulled locally). Fail loud on stable/beta; warn on
# alpha (matches the dirty-tree check's channel split above).
PAPERCUSP_SUBMODULE_DIR="$(cd "$ROOT/.." && pwd)/libs/papercusp"
echo "==> checking libs/papercusp submodule freshness (WI-3047)"
if git -C "$PAPERCUSP_SUBMODULE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  SUBMODULE_BRANCH="$(git -C "$PAPERCUSP_SUBMODULE_DIR" branch --show-current 2>/dev/null || true)"
  SUBMODULE_BRANCH="${SUBMODULE_BRANCH:-main}"
  if git -C "$PAPERCUSP_SUBMODULE_DIR" fetch --quiet origin "$SUBMODULE_BRANCH" 2>/dev/null; then
    SUB_LOCAL_SHA="$(git -C "$PAPERCUSP_SUBMODULE_DIR" rev-parse HEAD)"
    SUB_REMOTE_SHA="$(git -C "$PAPERCUSP_SUBMODULE_DIR" rev-parse "origin/$SUBMODULE_BRANCH")"
    if [[ "$SUB_LOCAL_SHA" != "$SUB_REMOTE_SHA" ]]; then
      SUB_BEHIND="$(git -C "$PAPERCUSP_SUBMODULE_DIR" rev-list --count "$SUB_LOCAL_SHA..$SUB_REMOTE_SHA" 2>/dev/null || echo '?')"
      SUB_MSG="libs/papercusp is $SUB_BEHIND commit(s) behind origin/$SUBMODULE_BRANCH (local=${SUB_LOCAL_SHA:0:12} remote=${SUB_REMOTE_SHA:0:12}) — a release cut now may ship migrations/code that lag what's already merged (WI-3047 class)."
      if [[ "$CHANNEL" != "alpha" ]]; then
        echo "ERROR: $SUB_MSG"
        echo "       Run: git -C libs/papercusp pull origin $SUBMODULE_BRANCH   (then re-stage the submodule pointer)"
        exit 1
      else
        echo "WARN: $SUB_MSG (continuing — alpha channel)"
      fi
    else
      echo "    ✓ libs/papercusp is up to date with origin/$SUBMODULE_BRANCH (${SUB_LOCAL_SHA:0:12})"
    fi
  else
    echo "WARN: could not fetch libs/papercusp origin/$SUBMODULE_BRANCH — skipping freshness check (offline / network issue?)"
  fi
else
  echo "WARN: $PAPERCUSP_SUBMODULE_DIR is not a git repo — skipping submodule freshness check"
fi

echo "==> bumping version in manifests"
python3 - "$VERSION" "$ROOT" <<'PY'
import json, sys, re, pathlib
version, root = sys.argv[1], pathlib.Path(sys.argv[2])

pkg = root / "package.json"
if pkg.exists():
    d = json.loads(pkg.read_text())
    d["version"] = version
    pkg.write_text(json.dumps(d, indent=2) + "\n")
    print(f"  package.json → {version}")

tauri_conf = root / "src-tauri" / "tauri.conf.json"
d = json.loads(tauri_conf.read_text())
d["version"] = version
tauri_conf.write_text(json.dumps(d, indent=2) + "\n")
print(f"  tauri.conf.json → {version}")

cargo = root / "src-tauri" / "Cargo.toml"
text = cargo.read_text()
text = re.sub(r'(?m)^version = "[^"]+"', f'version = "{version}"', text, count=1)
cargo.write_text(text)
print(f"  Cargo.toml → {version}")
PY

# ── Dogfood version pin (clone-progress + version-pin) ──────────────────────
# The shipped app clones the `papercusp` dogfood hive from the MONOREPO
# (github.com/Papercusp/papercup) on first boot. Pin that clone to THIS build's
# commit so the dogfooded source matches the binary exactly (without it, a fresh
# install clones whatever `main` is NOW — drift). We:
#   1. tag the monorepo superproject ($ROOT/.. — papercusp-desktop is a submodule
#      of it) with the SAME release tag + push it, so the ref exists to clone, and
#   2. export PAPERCUP_DOGFOOD_REPO_REF=$TAG so build-desktop-sidecar.sh bakes it
#      into the sidecar (esbuild --define). bootstrap-papercusp-hive reads it.
# Best-effort: a push failure just means the dogfood clone falls back to `main`.
MONOREPO="$(cd "$ROOT/.." && pwd)"
if git -C "$MONOREPO" rev-parse --git-dir >/dev/null 2>&1; then
  export PAPERCUP_DOGFOOD_REPO_REF="$TAG"
  MONO_SHA="$(git -C "$MONOREPO" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "==> dogfood pin: tagging monorepo ($MONOREPO @ $MONO_SHA) as $TAG"
  if git -C "$MONOREPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1; then
    echo "    tag $TAG already exists on the monorepo — reusing"
  else
    git -C "$MONOREPO" tag "$TAG" || echo "    WARN: could not create monorepo tag $TAG"
  fi
  git -C "$MONOREPO" push origin "refs/tags/$TAG" 2>/dev/null \
    || echo "    WARN: could not push monorepo tag $TAG — dogfood clone will fall back to the default branch (main)"
else
echo "==> dogfood pin: $ROOT/.. is not a git repo — skipping (sidecar bakes no ref → dogfood clone uses main)"
fi

cut_release_seed() {
  if [[ "${PAPERCUSP_SKIP_SEED_CUT:-0}" == "1" ]]; then
    echo "==> seed: PAPERCUSP_SKIP_SEED_CUT=1 — leaving src-tauri/seed as-is"
    return 0
  fi
  # Owner directive 2026-07-07 (supersedes WI-2903 option A's full-history
  # default): release seeds ship DEPTH-1 — a one-commit snapshot of --rev, not
  # the ~1.75GiB full-history bundle. Full history stays on GitHub; first-boot
  # fetch back-fills it from origin when online. Escape hatch: export
  # PAPERCUSP_SEED_DEPTH= (empty) forces full history; git-only stays opt-in
  # via PAPERCUSP_SEED_CORESTORE=0. The cut runs HERE on the owner box —
  # cut-seed-cli refuses an epoch seal without the live hive keychain
  # (load-don't-mint) and refuses a missing corestore dir.
  local seed_hive="${PAPERCUSP_SEED_HIVE:-papercusp}"
  local seed_workspace="${PAPERCUSP_SEED_WORKSPACE_ID:-papercusp-workspace}"
  local seed_origin="${PAPERCUSP_SEED_ORIGIN:-https://github.com/Papercusp/papercup}"
  local seed_rev="${PAPERCUSP_SEED_REV:-HEAD}"
  local seed_depth="${PAPERCUSP_SEED_DEPTH-1}"
  local operator_dir="$MONOREPO/apps/operator"
  local seed_out="$ROOT/src-tauri/seed"
  if [[ ! -d "$operator_dir" ]]; then
    echo "ERROR: seed cutter not found at $operator_dir"
    echo "       Set PAPERCUSP_SKIP_SEED_CUT=1 only for a deliberate placeholder build."
    exit 1
  fi
  local core_args=()
  if [[ "${PAPERCUSP_SEED_CORESTORE:-1}" != "1" ]]; then
    core_args+=(--no-corestore)
  fi
  if [[ -n "${PAPERCUSP_SEED_STORE_DIR:-}" ]]; then
    core_args+=(--store-dir "$PAPERCUSP_SEED_STORE_DIR")
  fi
  # Offline dogfood restores need the bundled epoch keys too. Keep parity with
  # mac-vm-build.sh; opt out only for diagnostic cuts.
  local emit_args=()
  [[ "${PAPERCUSP_SEED_EMIT_EPOCH_KEY:-1}" == "1" ]] && emit_args+=(--emit-epoch-key)
  # P-004 trim: --sparse ships only the head-snapshot span (~40MB vs ~2.1GB). This
  # linux path always cuts a FRESH corestore (no --reuse-corestore branch), so --sparse
  # applies whenever a corestore is cut. Default-ON; PAPERCUSP_SEED_SPARSE=0 forces full
  # history. cut-seed-cli THROWS if --sparse meets --no-corestore, so gate on corestore=1.
  local sparse_args=()
  [[ "${PAPERCUSP_SEED_CORESTORE:-1}" == "1" && "${PAPERCUSP_SEED_SPARSE:-1}" == "1" ]] && sparse_args+=(--sparse)
  local depth_args=()
  if [[ -n "$seed_depth" ]]; then
    depth_args+=(--depth "$seed_depth")
  fi
  echo "==> cutting installer seed (hive=$seed_hive rev=$seed_rev depth=${seed_depth:-full} corestore=${PAPERCUSP_SEED_CORESTORE:-1} sparse=$([[ ${#sparse_args[@]} -gt 0 ]] && echo 1 || echo 0))"
  (
    cd "$operator_dir"
    OPATH="$PATH"
    set -a
    [[ -f ./.env.local ]] && . ./.env.local
    set +a
    export PATH="$OPATH:$PATH"
    PAPERCUSP_ALLOW_DEV_RESTART=1 PAPERCUSP_WORKSPACE_ROOT="$MONOREPO" \
      npx tsx lib/release/cut-seed-cli.ts \
        --out "$seed_out" \
        --repo "$MONOREPO" \
        --origin "$seed_origin" \
        --workspace-id "$seed_workspace" \
        --hive "$seed_hive" \
        --rev "$seed_rev" \
        "${depth_args[@]}" \
        "${core_args[@]}" \
        "${sparse_args[@]}" \
        "${emit_args[@]}"
  )
}

cut_release_seed

# ── P-006 (desktop-build-hardening-tri-platform-2026-07-11), per D-005 ────────
# The release cut is the VICTIM of host load, not its cause: WI-3792's 05:20Z
# 0.0.7 death was runaway staging hono-hosts + the Gemma ONNX all-core spin
# STARVING the win VM mid-build, not the build overloading the box. So the fix is
# protect + be polite, NOT throttle the victim:
#   (1) POLITE LOCAL LEG — the local Linux cargo/tauri compile spins all cores and
#       runs CONCURRENTLY with the windows+mac VM builds on the SAME host (see the
#       parallel-legs comment below), so an un-niced local leg can starve its own
#       sibling qemu VM legs (the 05:20Z failure, self-inflicted). Wrap every local
#       CPU-heavy step (sidecar esbuild + the tauri compiles) with nice + ionice so
#       it yields to the CPUWeight-protected critical services and the qemu VM host
#       processes — that lowered relative priority is what "protect the build FROM
#       contention" (D-005) means here: the VM legs get scheduled ahead of the
#       local compile. Disable with PAPERCUSP_RELEASE_NICE=0.
#   (2) NO SHORT-COMMAND SLOT / NEVER DENIED — export PC_HEAVY_BYPASS=1 so that if
#       this cut is ever launched under scripts/pc-heavy.sh (or spawns a hooked
#       heavy child), the WI-3821 admission gate never REFUSES a step when the box
#       is loaded (a load spike must not kill a cut) and the ~35-min VM builds
#       never sit in / hold a pc-heavy admission slot tuned for short tsc/vitest
#       (D-005: give long builds a dedicated lane OR exempt them — exemption IS the
#       lane). The gate keeps throttling the actual CAUSES (other agents' raw
#       vitest/tsc/build); it just never throttles this victim.
export PC_HEAVY_BYPASS=1
PC_NICE=()
if [[ "${PAPERCUSP_RELEASE_NICE:-1}" != "0" ]]; then
  command -v nice   >/dev/null 2>&1 && PC_NICE=(nice -n "${PAPERCUSP_RELEASE_NICE_ADJ:-10}")
  command -v ionice >/dev/null 2>&1 && PC_NICE=(ionice -c2 -n "${PAPERCUSP_RELEASE_IONICE:-7}" "${PC_NICE[@]}")
fi
[[ ${#PC_NICE[@]} -gt 0 ]] && echo "==> local build legs run niced (P-006): ${PC_NICE[*]}"

echo "==> building sidecar"
# P-004 (desktop-build-hardening-tri-platform-2026-07-11): record the cut-start
# epoch BEFORE the sidecar build so the freshness stamp it writes is guaranteed
# >= this — the Windows leg's guard then proves the packed serve.mjs was rebuilt
# for THIS cut, not a stale leftover.
export PAPERCUSP_SIDECAR_MIN_EPOCH_SEC="$(date +%s)"
"${PC_NICE[@]}" bash "$ROOT/bin/build-desktop-sidecar.sh"
# P-004: the exact sha of the serve.mjs we just built — exported so every leg's
# packer asserts it packs THIS byte-identical sidecar (fail-closed on a
# concurrent rebuild swapping it mid-cut). Doubles as a self-check that the
# sidecar build actually produced a serve.mjs.
PAPERCUSP_EXPECTED_SERVE_SHA="$(sha256sum "$ROOT/src-tauri/sidecar/serve.mjs" 2>/dev/null | cut -d' ' -f1)"
if [[ -z "$PAPERCUSP_EXPECTED_SERVE_SHA" ]]; then
  echo "ERROR: sidecar build did not produce src-tauri/sidecar/serve.mjs — cannot proceed"; exit 1
fi
export PAPERCUSP_EXPECTED_SERVE_SHA
echo "==> sidecar freshness (P-004): serve.mjs sha=${PAPERCUSP_EXPECTED_SERVE_SHA:0:12}… cut-epoch=$PAPERCUSP_SIDECAR_MIN_EPOCH_SEC"

# WI-3287 / env-switcher-packaged-all-platforms-2026-07-06: stage the bundled
# env-sidecars/staging bundle inside sidecar/ so the existing `sidecar/**/*`
# resources glob ships it — see bin/stage-env-sidecars.sh for the contract.
bash "$ROOT/bin/stage-env-sidecars.sh"

# WI-3308 / same plan: the "all-5-buttons" dogfood bundle — stage a PRE-installed
# runnable monorepo tree as sidecar/source.tar.zst so the dev(:3270)/local(:3055)
# env buttons run from SOURCE on an install (no npm/npx needed; the bundled node
# runs the tree's own tsx/vite). DEFAULT-ON since VM-verified end-to-end on Linux
# (WI-3308, 2026-07-07); opt out with PAPERCUSP_STAGE_SOURCE=0 for a smaller build.
bash "$ROOT/bin/stage-source-tree.sh"

echo "==> building Tauri Linux x86_64 (signed)"
# Tauri v2 reads TAURI_SIGNING_PRIVATE_KEY (value = key content OR a path);
# the v1-style _PATH variant is silently ignored and the build dies at the
# updater-artifact signing step ("public key found, but no private key").
export TAURI_SIGNING_PRIVATE_KEY="$KEY_FILE"
# Empty passphrase by default. If the user set one at keygen time
# they should `export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=...` before
# running this script.
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

# Tauri CLI does the platform-native bundling + signing in one shot.
# Two-bundle split (ONE binary, two roles — see src-tauri/src/app_role.rs):
# GUI (base tauri.conf.json) + Server (tauri.server.conf.json override).
# Distinct productNames → distinct deb/appimage/rpm filenames; the version-
# scoped globs below pick up both. PAPERCUSP_BUILD_ROLES="gui" (or "server")
# builds just one.
# ── Build ALL THREE platforms CONCURRENTLY (owner request 2026-07-08): Linux is
# LOCAL (cargo → external ~/.cargo-target, does not mutate the source tree) while
# Windows + macOS build on their OWN QEMU VMs over SSH, so nothing contends. Each
# leg is a background subshell → its own log; we join all three below and collect
# artifacts in the PARENT (a subshell's `ARTIFACTS+=` would not survive the fork).
# ── P-005 (desktop-build-hardening-tri-platform-2026-07-11): verify the REUSE
# salvage path, don't just flag it ──────────────────────────────────────────
# PAPERCUSP_REUSE_MAC/REUSE_WIN skip a rebuild and ship artifacts SALVAGED from a
# prior cut — but they get re-labelled with THIS cut's version/sha (baked into
# the binary at its ORIGINAL build; the provenance emit only stamps reused:true).
# Salvaging a DIFFERENT version's bytes and shipping them as $VERSION is the
# LABELED!=PACKED lie. Reuse is only honest for a SAME-VERSION re-cut (e.g. a
# 0.0.7 cut that failed at a later step, reusing 0.0.7's already-built leg). So
# before trusting salvaged artifacts, read the prior cut's build-provenance.json
# (restored alongside them) and FAIL LOUD if its version != $VERSION, or if it's
# missing (then the true version is unknowable → unsafe to re-label). Run in the
# reuse blocks BELOW, before the late provenance emit overwrites the file.
# Overrides: PAPERCUSP_ALLOW_REUSE_UNVERIFIED=1 (no prior provenance) /
# PAPERCUSP_ALLOW_REUSE_VERSION_MISMATCH=1 (deliberate cross-version salvage).
_prov_version() {  # $1 = build-provenance.json path → prints the version string
  grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$1" 2>/dev/null | head -1 | sed -E 's/.*"([^"]*)"$/\1/'
}
assert_reused_provenance() {  # $1 = artifact dir, $2 = leg label
  local dir="$1" leg="$2"
  local prov="$dir/build-provenance.json"
  if [[ "${PAPERCUSP_ALLOW_REUSE_UNVERIFIED:-0}" == "1" ]]; then
    echo "==> ⚠ PAPERCUSP_ALLOW_REUSE_UNVERIFIED=1 — skipping the $leg reuse-provenance verification (P-005)"
    return 0
  fi
  [[ -f "$prov" ]] || { echo "ERROR: REUSE_$leg but no prior build-provenance.json at $prov — the salvaged bytes' true version is unknown, so re-labelling them $VERSION would be a LABELED!=PACKED lie (P-005). Restore a cut that includes build-provenance.json, or override: PAPERCUSP_ALLOW_REUSE_UNVERIFIED=1."; exit 1; }
  local prior_ver; prior_ver="$(_prov_version "$prov")"
  [[ -n "$prior_ver" ]] || { echo "ERROR: could not read a version from $prov — refusing to reuse unverifiable salvaged $leg artifacts (P-005). Override: PAPERCUSP_ALLOW_REUSE_UNVERIFIED=1."; exit 1; }
  if [[ "$prior_ver" != "$VERSION" ]]; then
    if [[ "${PAPERCUSP_ALLOW_REUSE_VERSION_MISMATCH:-0}" == "1" ]]; then
      echo "==> ⚠ PAPERCUSP_ALLOW_REUSE_VERSION_MISMATCH=1 — proceeding despite $leg salvage version mismatch ($prior_ver != $VERSION)"
    else
      echo "ERROR: REUSE_$leg salvaged artifacts are version '$prior_ver' but this cut is '$VERSION' — refusing to re-label a DIFFERENT version's bytes as $VERSION (the silent-relabel P-005 kills). Rebuild the $leg leg for $VERSION, or (same-version re-cut only) override: PAPERCUSP_ALLOW_REUSE_VERSION_MISMATCH=1."
      exit 1
    fi
  else
    echo "==> ✓ REUSE_$leg provenance verified: salvaged version $prior_ver == cut $VERSION (P-005)"
  fi
}

LINUX_LEG_LOG="/tmp/papercusp-linuxleg-${TAG}.log"
LINUX_PID=""
echo "==> [parallel] launching Linux x86_64 build (local, log: $LINUX_LEG_LOG)"
(
  set -euo pipefail
  PAPERCUSP_BUILD_ROLES="${PAPERCUSP_BUILD_ROLES:-gui server}"
  for role in $PAPERCUSP_BUILD_ROLES; do
    role_cfg=(); [[ "$role" == "server" ]] && role_cfg=(--config src-tauri/tauri.server.conf.json)
    # rpm DROPPED (2026-07-08): it is never collected (Linux ships deb+AppImage only —
    # see the collection globs) AND its multi-GB payload compression wedged the
    # 0.0.3-alpha linux leg for 33min+. deb only.
    echo "==> tauri build (linux x86_64, role=$role) — deb only (AppImage separate WI-2918; rpm not shipped)"
    (cd "$ROOT" && PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" "${PC_NICE[@]}" npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri build --bundles deb "${role_cfg[@]}")
  done
  # AppImage — built SEPARATELY (WI-2918): tauri's appimage target crashes linuxdeploy
  # on the sidecar tree; build-appimage.sh finishes with appimagetool (no ELF-scan).
  if [[ " $PAPERCUSP_BUILD_ROLES " == *" gui "* ]]; then
    echo "==> building Linux AppImage (gui, via bin/build-appimage.sh — linuxdeploy workaround)"
    (cd "$ROOT" && PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" \
       TAURI_SIGNING_PRIVATE_KEY="$KEY_FILE" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
       "${PC_NICE[@]}" bash "$ROOT/bin/build-appimage.sh")
  fi
) >"$LINUX_LEG_LOG" 2>&1 &
LINUX_PID=$!

WIN_LEG_LOG="/tmp/papercusp-winleg-${TAG}.log"
MAC_LEG_LOG="/tmp/papercusp-macleg-${TAG}.log"
WIN_PID=""; MAC_PID=""; MAC_REUSE=0; WIN_REUSE=0
if [[ "$WITH_WINDOWS" == "1" && "${PAPERCUSP_REUSE_WIN:-0}" == "1" ]]; then
  # SALVAGE PATH (2026-07-09, mirror of PAPERCUSP_REUSE_MAC below): the Windows VM
  # + target/windows-vm/bundle/inno are SHARED across lanes and clobber each other
  # (b0fbf windows-parity note) — when a good win 0.0.5 build already exists on the
  # host (e.g. restored/rescued into the inno dir), skip the VM rebuild entirely and
  # let the collection block below sweep the existing artifacts (WIN_REUSE=1 keeps
  # its gate + emptiness check).
  echo "==> [reuse] PAPERCUSP_REUSE_WIN=1 — skipping windows build; reusing artifacts in $ROOT/src-tauri/target/windows-vm/bundle/inno"
  win_reuse_found=0
  for f in "$ROOT"/src-tauri/target/windows-vm/bundle/inno/*; do
    [[ -f "$f" ]] && { echo "    reuse: $(basename "$f")"; win_reuse_found=1; }
  done
  if [[ "$win_reuse_found" != "1" ]]; then
    echo "ERROR: PAPERCUSP_REUSE_WIN=1 but no windows artifacts in $ROOT/src-tauri/target/windows-vm/bundle/inno — restore them there first"; exit 1
  fi
  # P-005: refuse to re-label a different version's salvaged windows bytes as $VERSION.
  assert_reused_provenance "$ROOT/src-tauri/target/windows-vm/bundle/inno" windows
  WIN_REUSE=1
elif [[ "$WITH_WINDOWS" == "1" ]]; then
  echo "==> [parallel] launching Windows x86_64 build on the Windows VM (log: $WIN_LEG_LOG)"
  # Native MSVC build on the local QEMU Windows 11 VM (windows-desktop-release-
  # readiness-2026-06-11 D-001). SKIP the per-build seed cut: release-local already
  # cut src-tauri/seed ONCE above; build-windows-on-vm.sh REUSES it.
  (
    set -euo pipefail
    PAPERCUSP_SKIP_SEED_CUT=1 PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" bash "$ROOT/bin/build-windows-on-vm.sh"
  ) >"$WIN_LEG_LOG" 2>&1 &
  WIN_PID=$!
fi
if [[ "$WITH_ARM64" == "1" ]]; then
  echo "==> building Linux arm64 (cross)"
  for role in ${PAPERCUSP_BUILD_ROLES:-gui server}; do
    role_cfg=(); [[ "$role" == "server" ]] && role_cfg=(--config src-tauri/tauri.server.conf.json)
    echo "==> tauri build (linux arm64, role=$role)"
    (cd "$ROOT" && PAPERCUSP_BUILD_SHA="$BUILD_SHA" PAPERCUSP_BUILD_VERSION="$VERSION" "${PC_NICE[@]}" npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri build --target aarch64-unknown-linux-gnu "${role_cfg[@]}")
  done
  for f in "$CARGO_TARGET_ROOT"/aarch64-unknown-linux-gnu/release/bundle/{deb,appimage}/*_"$VERSION"_*; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f")
  done
fi
if [[ "$WITH_MAC" == "1" && "${PAPERCUSP_REUSE_MAC:-0}" == "1" ]]; then
  # SALVAGE PATH (2026-07-08): the mac VM (~9.6GB total) is fundamentally too small
  # for a universal (dual-arch) build (~8-10GB) and OOM-disk'd mid-build. Instead of
  # rebuilding, REUSE the good mac artifacts already restored into $MAC_OUT from a
  # backed-up successful cut. Skip the mac build subshell entirely (MAC_PID stays
  # empty) AND skip the pre-scp clean; the collection block below fires on MAC_REUSE=1.
  MAC_OUT="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
  echo "==> [reuse] PAPERCUSP_REUSE_MAC=1 — skipping mac build; reusing artifacts in $MAC_OUT"
  mac_reuse_found=0
  for f in "$MAC_OUT"/dmg/*.dmg "$MAC_OUT"/macos/*.app.tar.gz "$MAC_OUT"/macos/*.app.tar.gz.sig; do
    [[ -f "$f" ]] && { echo "    reuse: $(basename "$f")"; mac_reuse_found=1; }
  done
  if [[ "$mac_reuse_found" != "1" ]]; then
    echo "ERROR: PAPERCUSP_REUSE_MAC=1 but no mac artifacts in $MAC_OUT — restore the backup there first"; exit 1
  fi
  # P-005: refuse to re-label a different version's salvaged mac bytes as $VERSION.
  assert_reused_provenance "$MAC_OUT" mac
  MAC_REUSE=1
elif [[ "$WITH_MAC" == "1" ]]; then
  echo "==> [parallel] launching macOS universal build on the mac VM (log: $MAC_LEG_LOG)"
  (
    set -euo pipefail
    if ! "${MAC_VM_SSH[@]}" 'true' 2>/dev/null; then
      echo "ERROR: mac VM unreachable on :2222 — boot it first (see /internal/docs/build-system/vms)"; exit 1
    fi
    # ── P-008 (desktop-build-hardening-tri-platform-2026-07-11, per D-005 option
    # 3): FAIL FAST on insufficient VM disk BEFORE the multi-GB rsync + ~20-min
    # build, instead of OOM-ing mid-build and forcing a manual REUSE_MAC panic. The
    # mac VM (~9.6GB) is marginal for a universal (dual-arch) build (~8-10GB peak);
    # if space is short, abort with an actionable message that names the
    # P-005-provenance-verified salvage path as the FIRST-CLASS fallback — a planned
    # choice, not a mid-build emergency. Threshold PAPERCUSP_MAC_MIN_FREE_GB (default
    # 12); PAPERCUSP_MAC_MIN_FREE_GB=0 skips the check entirely.
    _mac_min_free_gb="${PAPERCUSP_MAC_MIN_FREE_GB:-12}"
    if (( _mac_min_free_gb > 0 )); then
      _mac_free_kb="$("${MAC_VM_SSH[@]}" 'df -Pk "$HOME" 2>/dev/null | awk "NR==2{print \$4}"' 2>/dev/null || true)"
      if [[ "$_mac_free_kb" =~ ^[0-9]+$ ]]; then
        _mac_free_gb=$(( _mac_free_kb / 1024 / 1024 ))
        echo "    mac VM free disk: ${_mac_free_gb}GB (universal build needs ~${_mac_min_free_gb}GB)"
        if (( _mac_free_gb < _mac_min_free_gb )); then
          echo "ERROR: mac VM has only ${_mac_free_gb}GB free — a universal (dual-arch) build needs ~${_mac_min_free_gb}GB and OOM-disks mid-build (the recurring mac cut emergency). FIX: free space / grow the VM disk, OR cut with PAPERCUSP_REUSE_MAC=1 to ship the P-005-provenance-verified prior mac artifacts (the first-class salvage fallback). Bypass this check: PAPERCUSP_MAC_MIN_FREE_GB=0."; exit 1
        fi
      else
        echo "    ⚠ could not read mac VM free disk (got '${_mac_free_kb}') — skipping P-008 disk preflight (non-fatal)"
      fi
    fi
    # WI-1708: build from a COMMIT (git archive HEAD), never the live working tree —
    # the superproject is edited concurrently by the fleet, so a direct rsync would
    # snapshot a moving target. git archive is an atomic read of committed objects.
    SNAP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/papercusp-mac-snap.XXXXXX")"
    echo "    snapshotting HEAD (superproject + submodules) → $SNAP_DIR"
    git -C "$MONOREPO" archive --format=tar HEAD | tar -x -C "$SNAP_DIR" \
      || { echo "ERROR: git archive of superproject HEAD failed"; rm -rf "$SNAP_DIR"; exit 1; }
    git -C "$MONOREPO" submodule foreach --recursive --quiet \
      'git archive --format=tar --prefix="$displaypath/" HEAD | tar -x -C "'"$SNAP_DIR"'"' \
      || { echo "ERROR: git archive of a submodule failed"; rm -rf "$SNAP_DIR"; exit 1; }
    # Re-apply THIS release's version bump + freshly-cut seed onto the snapshot (both
    # are working-tree-only mutations not yet in HEAD).
    cp "$ROOT/package.json"              "$SNAP_DIR/papercusp-desktop/package.json"
    cp "$ROOT/src-tauri/tauri.conf.json" "$SNAP_DIR/papercusp-desktop/src-tauri/tauri.conf.json"
    cp "$ROOT/src-tauri/Cargo.toml"      "$SNAP_DIR/papercusp-desktop/src-tauri/Cargo.toml"
    if [[ -f "$ROOT/src-tauri/seed/manifest.json" ]]; then
      rm -rf "$SNAP_DIR/papercusp-desktop/src-tauri/seed"
      mkdir -p "$SNAP_DIR/papercusp-desktop/src-tauri/seed"
      cp -a "$ROOT/src-tauri/seed/." "$SNAP_DIR/papercusp-desktop/src-tauri/seed/"
    else
      echo "ERROR: seed cut did not produce $ROOT/src-tauri/seed/manifest.json"; rm -rf "$SNAP_DIR"; exit 1
    fi
    echo "    rsync snapshot → VM:$MAC_VM_BUILD_DIR"
    rsync -az --delete --exclude '.git' --exclude 'node_modules' --exclude 'target' \
      --exclude '.turbo' --exclude '.next' --exclude '.mcp.json' --exclude '.claude' \
      -e "$MAC_VM_RSYNC_E" \
      "$SNAP_DIR/" "aviweiss@127.0.0.1:$MAC_VM_BUILD_DIR/"
    rm -rf "$SNAP_DIR"
    "${MAC_VM_SCP[@]}" \
      "$KEY_FILE" aviweiss@127.0.0.1:.papercusp-updater.key
    # ── P-007 (desktop-build-hardening-tri-platform-2026-07-11, per D-005): run
    # the ~35-min build DETACHED on the VM (nohup + a status sentinel) and POLL
    # for it — so a dropped ssh connection (the 90s-keepalive death that discarded
    # 0.0.7, or a hard reset the keepalive can't survive) never kills the build.
    # A poll that fails (ssh flap) is NON-fatal: the detached build keeps running
    # and we RETRY THE POLL; we NEVER re-invoke the build from scratch (a re-run
    # doubles the 35 min, it does not save it). macOS has no setsid — nohup +
    # </dev/null + redirected fds is what detaches it from the ssh channel.
    # Sentinel ~/mac-release-build.done holds "DONE:<exit-code>".
    _mac_done="mac-release-build.done"
    _mac_log="mac-release-build.log"
    echo "    launching DETACHED mac build on the VM (nohup; sentinel ~/$_mac_done, log ~/$_mac_log)"
    "${MAC_VM_SSH[@]}" 'chmod 600 .papercusp-updater.key; rm -f "$HOME/'"$_mac_done"'"; nohup bash -lc "
      status=0
      cd '"$MAC_VM_BUILD_DIR"'/papercusp-desktop || status=91
      if [ \$status -eq 0 ]; then npm install --legacy-peer-deps >/tmp/mac-release-install.log 2>&1 || { tail -20 /tmp/mac-release-install.log; status=92; }; fi
      if [ \$status -eq 0 ]; then
        export TAURI_SIGNING_PRIVATE_KEY=\$HOME/.papercusp-updater.key
        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
        export PAPERCUSP_BUILD_SHA='"$BUILD_SHA"'
        export PAPERCUSP_BUILD_VERSION='"$VERSION"'
        export PAPERCUP_DOGFOOD_REPO_REF='"$TAG"'
        export PAPERCUP_DOGFOOD_POT_PUBKEY='"${PAPERCUP_DOGFOOD_POT_PUBKEY:-${PAPERCUP_DOGFOOD_HIVE_PUBKEY:-}}"'
        export PAPERCUP_DOGFOOD_POT_INVITE_SECRET='"${PAPERCUP_DOGFOOD_POT_INVITE_SECRET:-${PAPERCUP_DOGFOOD_HIVE_INVITE_SECRET:-}}"'
        export PAPERCUSP_SKIP_SEED_CUT=1
        bash bin/mac-vm-build.sh || status=\$?
      fi
      echo \"DONE:\$status\" > \"\$HOME/'"$_mac_done"'\"
    " </dev/null >"$HOME/'"$_mac_log"'" 2>&1 &' </dev/null >/dev/null 2>&1 \
      || { echo "ERROR: failed to launch the detached mac build over ssh"; exit 1; }

    # Poll the sentinel; an ssh flap here is NON-fatal (retry). Wall-clock timeout
    # leaves the detached build running for inspection rather than re-invoking it.
    _mac_timeout="${PAPERCUSP_MAC_BUILD_TIMEOUT_SEC:-3600}"
    _mac_poll="${PAPERCUSP_MAC_POLL_INTERVAL_SEC:-30}"
    _mac_t0="$(date +%s)"; _mac_sentinel=""
    echo "    polling for mac build completion (timeout ${_mac_timeout}s, every ${_mac_poll}s)…"
    while :; do
      if (( $(date +%s) - _mac_t0 > _mac_timeout )); then
        echo "ERROR: mac build did not finish within ${_mac_timeout}s — it is DETACHED and may still be running on the VM (~/$_mac_log). NOT re-invoking (D-005). Raise PAPERCUSP_MAC_BUILD_TIMEOUT_SEC or investigate the VM."; exit 1
      fi
      _mac_sentinel="$("${MAC_VM_SSH[@]}" 'cat "$HOME/'"$_mac_done"'" 2>/dev/null' 2>/dev/null || true)"
      [[ "$_mac_sentinel" == DONE:* ]] && break
      sleep "$_mac_poll"
    done
    if [[ "${_mac_sentinel#DONE:}" != "0" ]]; then
      echo "ERROR: mac build FAILED on the VM ($_mac_sentinel) — tail of ~/$_mac_log:"
      "${MAC_VM_SSH[@]}" 'tail -80 "$HOME/'"$_mac_log"'" 2>/dev/null' 2>/dev/null | sed 's/^/  [mac-vm] /' || true
      exit 1
    fi
    echo "    mac build completed OK (detached; survived any ssh flaps) — replaying VM build log:"
    "${MAC_VM_SSH[@]}" 'cat "$HOME/'"$_mac_log"'" 2>/dev/null' 2>/dev/null | sed 's/^/  [mac-vm] /' || true
    MAC_BUNDLE_VM="$MAC_VM_BUILD_DIR/papercusp-desktop/src-tauri/target/universal-apple-darwin/release/bundle"
    MAC_OUT="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
    mkdir -p "$MAC_OUT/dmg" "$MAC_OUT/macos"
    # Clean stale artifacts FIRST: the mac collection glob is UNSCOPED (app.tar.gz has
    # no version in its filename), so a prior cut's dmg/app would contaminate this
    # release (a stale 0.0.2 dmg nearly shipped in 0.0.3-alpha, 2026-07-08).
    rm -f "$MAC_OUT"/dmg/*.dmg "$MAC_OUT"/macos/*.app.tar.gz "$MAC_OUT"/macos/*.app.tar.gz.sig 2>/dev/null || true
    "${MAC_VM_SCP[@]}" \
      "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/dmg/*.dmg" "$MAC_OUT/dmg/" || true
    "${MAC_VM_SCP[@]}" \
      "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/macos/*.app.tar.gz" \
      "aviweiss@127.0.0.1:$MAC_BUNDLE_VM/macos/*.app.tar.gz.sig" "$MAC_OUT/macos/" || true
  ) >"$MAC_LEG_LOG" 2>&1 &
  MAC_PID=$!
fi

# ── JOIN all parallel legs; replay each leg's log; FAIL the release if any failed ──
join_leg() {  # $1=pid  $2=name  $3=logfile
  local pid="$1" name="$2" logf="$3" rc=0
  echo "==> joining $name leg (pid $pid)…"
  # WI-4230 (0.0.8 false-FAIL): a signal-interrupted `wait` returns >128 (or a
  # spurious 127) IMMEDIATELY while the leg is still running — the 0.0.8 cut
  # declared the linux leg FAILED mid-appimagetool, dumped a truncated log, and
  # exited without provenance/latest.json while the leg finished fine 4min
  # later. Only accept a verdict once the pid is actually GONE; an interrupted
  # wait on a live pid re-waits (bash keeps the un-reaped child's status, so the
  # re-wait returns the leg's true exit code).
  while :; do
    if wait "$pid"; then rc=0; else rc=$?; fi
    if kill -0 "$pid" 2>/dev/null; then
      echo "    (wait returned rc=$rc but $name leg pid $pid is still alive — interrupted wait; re-waiting)"
      [[ "$rc" == "127" ]] && sleep 5   # non-child rc: poll instead of hot-spinning
      continue
    fi
    break
  done
  if [[ "$rc" == "0" ]]; then
    [[ -f "$logf" ]] && sed "s/^/  [$name] /" "$logf"
    echo "==> $name leg SUCCEEDED"
  else
    echo "ERROR: $name leg FAILED (rc=$rc) — full leg log:"
    [[ -f "$logf" ]] && sed "s/^/  [$name] /" "$logf"
    exit 1
  fi
}
[[ -n "$LINUX_PID" ]] && join_leg "$LINUX_PID" linux "$LINUX_LEG_LOG"
[[ -n "$WIN_PID"   ]] && join_leg "$WIN_PID"   win   "$WIN_LEG_LOG"
[[ -n "$MAC_PID"   ]] && join_leg "$MAC_PID"   mac   "$MAC_LEG_LOG"

# ── Collect artifacts in the PARENT, post-join (a subshell's ARTIFACTS+= would not
# survive the fork). Version-scoped globs so a stale older-version bundle can't
# sweep in (desktop-v0.0.2-alpha incident 2026-06-11). ──
ARTIFACTS=()
CARGO_TARGET_ROOT="$(cd "$ROOT/src-tauri" && cargo metadata --no-deps --format-version 1 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin).get("target_directory",""))' 2>/dev/null)"
[[ -n "$CARGO_TARGET_ROOT" ]] || CARGO_TARGET_ROOT="$ROOT/src-tauri/target"
LINUX_BUNDLE="$CARGO_TARGET_ROOT/release/bundle"
if [[ ! -d "$LINUX_BUNDLE" ]]; then
  echo "ERROR: expected Linux bundles at $LINUX_BUNDLE — Linux leg produced none?"; exit 1
fi
for f in "$LINUX_BUNDLE"/deb/*_"$VERSION"_*.deb "$LINUX_BUNDLE"/appimage/*_"$VERSION"_*.AppImage \
         "$LINUX_BUNDLE"/appimage/*_"$VERSION"_*.AppImage.sig "$LINUX_BUNDLE"/deb/*_"$VERSION"_*.deb.sig; do
  [[ -f "$f" ]] && ARTIFACTS+=("$f")
done
# EI-8914 parity (P-001, desktop-build-hardening-tri-platform-2026-07-11): the
# Windows leg records build-provenance.json (inline in build-windows-on-vm.sh)
# and the Mac leg does (below, WI-3850), but the Linux leg emitted NOTHING — so a
# shipped .deb/.AppImage was untraceable to the source it was built from (the
# LABELED!=PACKED class the whole plan eradicates). Emit the same provenance
# (each installer's sha256 + gitHead/dirty + buildSha) next to the Linux bundle.
# Linux always builds FRESH locally (no REUSE_LINUX salvage path) → reused:false.
# Fingerprint the primary installers (deb + AppImage, both gui+server roles via
# the version-scoped globs), matching the mac call's primary-artifact scope — the
# .sig files are signatures over these, covered by the signature dimension (P-010
# / D-004), not the byte-provenance record. Best-effort: a provenance hiccup must
# never fail a good release.
# P-014: record the host toolchain (host == the Linux builder, so accurate) — rustc,
# node, and the PINNED tauri-cli — so two cuts of the same gitHead are comparable and
# a toolchain drift that changes the bytes is visible in the provenance record.
_tc_rustc="$(rustc --version 2>/dev/null | awk '{print $2}')"
_tc_node="$(node --version 2>/dev/null)"
PROVENANCE_TOOLCHAIN="$(printf '{ "rustc": "%s", "node": "%s", "tauriCli": "%s" }' "${_tc_rustc:-unknown}" "${_tc_node:-unknown}" "$TAURI_CLI_VERSION")" \
PROVENANCE_GIT_ROOT="$ROOT" bash "$ROOT/bin/emit-build-provenance.sh" \
  "$LINUX_BUNDLE" "$VERSION" "$BUILD_SHA" false \
  "$LINUX_BUNDLE"/deb/*_"$VERSION"_*.deb "$LINUX_BUNDLE"/appimage/*_"$VERSION"_*.AppImage \
  || echo "WARNING: linux build-provenance.json emit failed (non-fatal) — linux artifacts shipped WITHOUT a provenance record"
if [[ "$WITH_ARM64" == "1" ]]; then
  for f in "$CARGO_TARGET_ROOT"/aarch64-unknown-linux-gnu/release/bundle/{deb,appimage}/*_"$VERSION"_*; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f")
  done
fi
if [[ -n "$WIN_PID" || "$WIN_REUSE" == "1" ]]; then
  win_found=0
  # P-009: version-scope so a stale prior-cut installer left in the SHARED inno
  # dir (it isn't cleaned between cuts) can't be swept into this release. The Inno
  # output is "<AppName>_<version>_x64-setup.exe" (+ .sig + any .bin slices), all
  # carrying _<version>_, so this captures every this-version win artifact.
  for f in "$ROOT"/src-tauri/target/windows-vm/bundle/inno/*_"$VERSION"_*; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f") && win_found=1
  done
  [[ "$win_found" == "1" ]] || { echo "ERROR: WITH_WINDOWS=1 but no windows artifacts $([[ "$WIN_REUSE" == "1" ]] && echo "in the inno dir (reuse)" || echo "came back from the VM")"; exit 1; }
fi
if [[ -n "$MAC_PID" || "$MAC_REUSE" == "1" ]]; then
  MAC_OUT="$ROOT/src-tauri/target/universal-apple-darwin/release/bundle"
  mac_found=0
  # P-009: version-scope the dmg (named "<Product>_<version>_universal-apple-darwin.dmg")
  # so a stale prior-version dmg — 0.0.6 AND 0.0.7 dmgs were found coexisting in this
  # dir — can't be swept in. The .app.tar.gz updater bundle is UNVERSIONED by tauri, so
  # it rides the pre-collection clean (fresh path) / P-005 verification (reuse) plus the
  # cross-version-count assertion below.
  for f in "$MAC_OUT"/dmg/*_"$VERSION"_*.dmg "$MAC_OUT"/macos/*.app.tar.gz "$MAC_OUT"/macos/*.app.tar.gz.sig; do
    [[ -f "$f" ]] && ARTIFACTS+=("$f") && mac_found=1
  done
  [[ "$mac_found" == "1" ]] || { echo "ERROR: WITH_MAC=1 but no mac artifacts $([[ "$MAC_REUSE" == "1" ]] && echo "in $MAC_OUT (reuse)" || echo "came back from the VM")"; exit 1; }
  # P-009 pre-collection clean ASSERTION: the .app.tar.gz can't be version-filtered, so
  # guard against a stale unversioned bundle by asserting there are no MORE of them than
  # this-version dmgs (tauri emits one dmg + one .app.tar.gz per role).
  _mac_dmg_n=$(find "$MAC_OUT/dmg" -maxdepth 1 -name "*_${VERSION}_*.dmg" 2>/dev/null | wc -l | tr -d ' ')
  _mac_tgz_n=$(find "$MAC_OUT/macos" -maxdepth 1 -name "*.app.tar.gz" 2>/dev/null | wc -l | tr -d ' ')
  if (( _mac_tgz_n > _mac_dmg_n )); then
    echo "ERROR: mac collection has ${_mac_tgz_n} .app.tar.gz updater bundle(s) but only ${_mac_dmg_n} ${VERSION} .dmg — the UNVERSIONED .app.tar.gz set is contaminated by a prior cut (P-009). Clean $MAC_OUT/macos/ and re-cut, or use PAPERCUSP_REUSE_MAC=1 (provenance-verified salvage)."; exit 1
  fi
  bash "$ROOT/bin/audit-bundle.sh" "$MAC_OUT"/dmg/*_"$VERSION"_*.dmg
  # EI-8914 parity: the Windows leg records build-provenance.json (inline in
  # build-windows-on-vm.sh); the Mac leg never did, so a mac installer was
  # untraceable to its source and — worst on the PAPERCUSP_REUSE_MAC salvage
  # path — a SALVAGED artifact inherited THIS cut's version/sha label with no
  # record of what was actually inside (the LABELED!=PACKED class). Emit the
  # same provenance (each file's sha256 + a `reused` flag) next to the mac
  # artifacts. Best-effort: a provenance hiccup must never fail a good release.
  PROVENANCE_GIT_ROOT="$ROOT" bash "$ROOT/bin/emit-build-provenance.sh" \
    "$MAC_OUT" "$VERSION" "$BUILD_SHA" "$([[ "${MAC_REUSE:-0}" == "1" ]] && echo true || echo false)" \
    "$MAC_OUT"/dmg/*_"$VERSION"_*.dmg "$MAC_OUT"/macos/*.app.tar.gz \
    || echo "WARNING: mac build-provenance.json emit failed (non-fatal) — mac artifacts shipped WITHOUT a provenance record"
fi

echo "==> generating latest.json"
LATEST_JSON="/tmp/papercusp-latest-${TAG}.json"
NOTES_FILE="/tmp/papercusp-notes-${TAG}.md"

python3 - "$VERSION" "$CHANNEL" "$TAG" "$LATEST_JSON" "$NOTES_FILE" "${ARTIFACTS[@]}" <<'PY'
import json, os, sys, pathlib, hashlib
version, channel, tag, out_path, notes_path = sys.argv[1:6]
artifacts = [pathlib.Path(p) for p in sys.argv[6:]]

# Where an updating client DOWNLOADS the artifact from. This used to be
# hardcoded to github.com/Papercusp/papercusp-desktop/releases/download/... —
# which became a LIE the moment releases went LOCAL-only (2026-07-12): we never
# publish there, so every updater client would have chased a 404 against a
# manifest that looked perfectly valid. A manifest asserting a download URL that
# does not exist is the LABELED!=PACKED class of bug.
#
# The owner uploads the installers by hand and we cannot know the destination at
# cut time, so it is an INPUT, not a guess: set PAPERCUSP_UPDATE_BASE_URL to the
# base the artifacts will actually be served from. Unset, we emit an obviously
# invalid placeholder (never a plausible-but-wrong URL) and the cut warns loudly.
UPDATE_BASE = os.environ.get("PAPERCUSP_UPDATE_BASE_URL", "").rstrip("/")
PLACEHOLDER = "papercusp-update-base-unset://SET-PAPERCUSP_UPDATE_BASE_URL"

def repo_url(name: str) -> str:
    base = UPDATE_BASE or PLACEHOLDER
    return f"{base}/{tag}/{name}"

# Map (platform, arch, ext) → (url, signature). The operator's
# /api/updates/manifest already converts this latest.json to the
# Tauri updater's wire format, so what we publish here is the
# canonical truth.
platforms = {}
def add(platform_key, bin_path, sig_path):
    sig = sig_path.read_text().strip() if sig_path.exists() else ""
    platforms[platform_key] = {
        "signature": sig,
        "url": repo_url(bin_path.name),
    }

# Linux x86_64 — pick AppImage as the updater format
for art in artifacts:
    # WI-3696: latest.json is the GUI product's update-fallback manifest ONLY — a
    # Server-role artifact must NEVER land in it, on ANY platform. The darwin
    # (.app.tar.gz) and windows (-setup.exe/.msi) collection globs pull BOTH
    # roles' bundles out of the SAME output dir (mac-vm-build.sh / build-
    # windows-on-vm.sh each build "Papercusp GUI" + "Papercusp Server" side by
    # side), and this loop used to add() unconditionally per matching
    # extension — so whichever role's file the shell glob happened to iterate
    # LAST silently overwrote the other's entry. Concretely: "Papercusp
    # Server.app.tar.gz" sorts after "Papercusp GUI.app.tar.gz" alphabetically,
    # so it always won, clobbering the darwin entries with a Server artifact
    # whose signature VALIDATES (it's genuinely signed) — a mac GUI update
    # falling back to latest.json would silently install Server instead of
    # GUI. Skip every Server-role artifact up front so only the GUI one is
    # ever considered, on every platform.
    if "Server" in art.name:
        continue
    if art.suffix == ".AppImage":
        sig = art.with_suffix(art.suffix + ".sig")
        add("linux-x86_64", art, sig)
    # Windows — NSIS setup.exe is the v1 artifact (plan
    # windows-desktop-release-readiness-2026-06-11 D-003); MSI kept as
    # fallback for an opportunistic WiX build.
    if art.name.endswith("-setup.exe"):
        sig = pathlib.Path(str(art) + ".sig")
        add("windows-x86_64", art, sig)
    elif art.name.endswith(".msi") and "windows-x86_64" not in platforms:
        sig = art.with_suffix(".msi.sig")
        add("windows-x86_64", art, sig)
    if "aarch64" in str(art) and art.suffix == ".AppImage":
        sig = art.with_suffix(".AppImage.sig")
        add("linux-aarch64", art, sig)
    # macOS universal .app.tar.gz serves BOTH darwin arches (D-006)
    if art.name.endswith(".app.tar.gz"):
        sig = pathlib.Path(str(art) + ".sig")
        add("darwin-x86_64", art, sig)
        add("darwin-aarch64", art, sig)

# WI-3696 cut-time assertion: every entry latest.json publishes must genuinely
# be the GUI product (productName "Papercusp GUI" → every collected filename
# contains "GUI"; a Server artifact never does, and never should reach here
# given the skip above — this is a fail-loud backstop against a FUTURE
# naming/glob regression re-introducing the same silent wrong-product swap).
for platform_key, entry in platforms.items():
    if "GUI" not in entry["url"]:
        raise SystemExit(
            f"latest.json BUG: {platform_key} entry does not look like the GUI product "
            f"(url={entry['url']!r}) — refusing to publish a manifest that could ship the "
            f"wrong app on update (WI-3696)"
        )

manifest = {
    "version": version,
    "channel": channel,
    "notes": f"Papercusp desktop {version} ({channel}). See release notes.",
    "pub_date": __import__("datetime").datetime.utcnow().isoformat(timespec="seconds") + "Z",
    "platforms": platforms,
}
pathlib.Path(out_path).write_text(json.dumps(manifest, indent=2) + "\n")

# Brief release notes
lines = [
    f"# Papercusp desktop {version} — {channel}",
    "",
    f"Channel: **{channel}**",
    "",
    "## Artifacts",
]
for a in artifacts:
    sha = hashlib.sha256(a.read_bytes()).hexdigest()[:12] if a.is_file() else ""
    lines.append(f"- `{a.name}`  ({a.stat().st_size // 1024} KB, sha256:{sha}…)")
pathlib.Path(notes_path).write_text("\n".join(lines) + "\n")
print(f"manifest: {out_path}")
print(f"notes:    {notes_path}")
if not UPDATE_BASE:
    print(
        "\n"
        "  ⚠ WARNING: PAPERCUSP_UPDATE_BASE_URL is unset, so latest.json's download\n"
        "    URLs are the placeholder " + PLACEHOLDER + "/...\n"
        "    The INSTALLERS below are complete and shippable — this only affects the\n"
        "    auto-updater manifest. Before latest.json is SERVED to clients, re-run with\n"
        "    PAPERCUSP_UPDATE_BASE_URL=<base the artifacts are uploaded to>, or rewrite\n"
        "    the urls in place. Serving it as-is means every update check fails.\n",
        file=sys.stderr,
    )
PY

echo "==> committing version bump"
git -C "$ROOT" add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git -C "$ROOT" commit -m "release: $TAG" 2>&1 | tail -3 || echo "(nothing to commit)"

echo "==> tagging $TAG (local)"
git -C "$ROOT" tag -f "$TAG"

# ── ⛔ LOCAL-only. The GitHub publish leg was REMOVED (2026-07-12, WI-desktop-release-0-0-8).
# Owner directive (2026-07-08, restated 2026-07-12): "We are no longer using github for our
# releases so just build the installer locally and I will upload it to the right spot."
# This script therefore builds + signs + writes latest.json and STOPS. The signed artifacts
# on disk ARE the deliverable; hand the owner the paths + sha256s below.
#
# There is deliberately NO publish flag. The former PAPERCUSP_PUBLISH_GITHUB=1 opt-out — and
# the `git push origin HEAD "$TAG"` + `gh release create/upload` it guarded — are DELETED
# rather than left dormant: a superseded outward-facing path kept "just in case" is exactly
# the footgun that publishes a release nobody meant to publish. Restore from git history if
# GitHub releases ever come back.
echo
echo "==> done (LOCAL-only — nothing was pushed to GitHub)"
echo "    tag:       $TAG (local, not pushed)"
echo "    manifest:  $LATEST_JSON"
echo "    notes:     $NOTES_FILE"
echo "    artifacts: ${#ARTIFACTS[@]}"
echo "    hand-off:  give the owner the paths + sha256 below."
for f in "${ARTIFACTS[@]}"; do
  [[ -f "$f" ]] && echo "      $f  sha256:$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)"
done

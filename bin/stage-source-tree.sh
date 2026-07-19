#!/usr/bin/env bash
# stage-source-tree.sh — WI-3308; plan env-switcher-packaged-all-platforms-2026-07-06.
#
# The "all-5-buttons" dogfood bundle: the dev(:3270) + local(:3055) env buttons
# run from SOURCE (dev = `tsx apps/operator/bin/hono-host.ts`; local = the Vite
# SPA dev server over apps/operator-vite). The launcher gates both on
# detectPapercupRoot() + defaultHasToolchain() (env-operator-launcher.ts). A
# packaged install has NO npm/npx/tsx, so we ship a PRE-`npm install`ed runnable
# monorepo tree + its node_modules; the bundled node (sidecar/bin/node,
# v24.15.0) runs the tree's OWN tsx/vite (proven WI-3308: tsx v4.21.0 + vite
# 7.3.5 both run under the bundled node with no npm/npx on PATH).
#
# ARCHITECTURE (pinned; Mac/Win mirror): ship the tree as ONE compressed
# resource `sidecar/source.tar.zst`, extracted on FIRST BOOT to a WRITABLE dir,
# with PAPERCUSP_INTEGRATION_ROOT pointed at it — NOT an uncompressed
# `sidecar/**` glob. Rationale: the install dir (/usr/lib/…) is read-only so an
# in-place tree can't be edited (editability is the whole point of a dogfood
# source drop); tauri copying ~9GB uncompressed through its resource pipeline is
# slow; and node_modules `.bin/*` symlinks survive `tar` but not tauri's copy.
#
# DEFAULT-ON since the all-5-buttons dogfood bundle is VM-verified end-to-end on
# Linux (WI-3308, 2026-07-07: dev:3270 + local:3055 spawn from the extracted tree;
# Windows WI-3306 / Mac WI-3307 mirror the same seams) — a finished feature never
# ships dark. Opt OUT with PAPERCUSP_STAGE_SOURCE=0 (e.g. a deliberately smaller
# build with only the 3 bundled-sidecar buttons).
#
# Runs AFTER bin/build-desktop-sidecar.sh (needs a fresh src-tauri/sidecar/) and
# BEFORE `tauri build` (so the existing `sidecar/**/*` resources glob in
# tauri.conf.json + tauri.server.conf.json sweeps source.tar.zst into the
# bundle — zero tauri.conf / Rust glob changes needed). src-tauri/sidecar/ is
# .gitignored, so the multi-GB artifact never reaches git-sync.
set -euo pipefail

# ── Self-read guard (WI-3306, 2026-07-08): the body runs inside this { } group
# so bash reads the whole script before executing — a peer editing this
# shared-tree file during the multi-minute tar below can't corrupt the running
# shell's read offset. Matching } + exit at EOF. Same guard as the caller,
# bin/build-windows-on-vm.sh (and bin/mac-vm-build.sh, which also stages here).
{
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"                  # papercusp-desktop
MONO="$(cd "$ROOT/.." && pwd)"                  # monorepo root (apps/, libs/, node_modules/)
SIDECAR="$ROOT/src-tauri/sidecar"

if [[ "${PAPERCUSP_STAGE_SOURCE:-1}" != "1" ]]; then
  echo "==> stage-source-tree: skipped (PAPERCUSP_STAGE_SOURCE=0 — building without the dev/local runnable source tree; only the 3 bundled-sidecar buttons will work — WI-3308)"
  exit 0
fi

if [[ ! -f "$SIDECAR/serve.mjs" ]]; then
  echo "ERROR: $SIDECAR/serve.mjs missing — run bin/build-desktop-sidecar.sh first" >&2
  exit 1
fi
# The mono root MUST carry the detectPapercupRoot() markers, or dev/local skip
# with 'no-source-tree' at runtime.
if [[ ! -f "$MONO/apps/operator/package.json" || ! -f "$MONO/libs/papercusp/package.json" ]]; then
  echo "ERROR: $MONO is not the monorepo root (missing apps/operator + libs/papercusp package.json markers)" >&2
  exit 1
fi
# The tree MUST ship PRE-installed — installs have no npm/npx to populate it.
if [[ ! -x "$MONO/node_modules/.bin/tsx" ]]; then
  echo "ERROR: $MONO/node_modules/.bin/tsx missing — run 'npm install' at the monorepo root first (defaultHasToolchain needs <root>/node_modules/.bin; installs have no npm)" >&2
  exit 1
fi

OUT="$SIDECAR/source.tar.zst"

# ── Serialize against build-desktop-sidecar.sh (2026-07-12) ─────────────────
# We write source.tar.zst INTO the sidecar dir, and build-desktop-sidecar.sh
# REBUILDS that whole dir (rm -rf + atomic rename of a temp sibling). It takes a
# lock (EI-160) to protect readers from a half-written bundle — but this script
# never did, so a `npm run dev` (which rebuilds the sidecar) racing a release
# stage silently swapped the directory out from under our multi-minute tar: tar
# and zstd both reported SUCCESS, and the finished bundle was simply gone one
# line later. Observed 2026-07-12: the stage died on `du: cannot access
# .../source.tar.zst`, having produced nothing, while three `tauri dev` shells
# ran. Take the SAME lock (same path, so the two scripts actually exclude each
# other) for the whole tar, and the rebuild waits its turn instead of eating the
# artifact.
#
# NOT -n: we WAIT. A release stage that aborts because someone opened the dev
# shell is a worse failure than one that takes a few minutes longer.
exec 9>"$SIDECAR.lock"
STAGE_LOCKDIR=""
if [[ "${PAPERCUSP_SIDECAR_LOCK_HELD:-0}" == "1" ]]; then
  # The caller already holds an flock on THIS sidecar.lock for our whole run and
  # invokes us from inside it (build-windows-on-vm.sh's pack subshell:
  # `( flock 9; … bash stage-source-tree.sh; tar … ) 9>>src-tauri/sidecar.lock`).
  # Re-acquiring here would SELF-DEADLOCK: the `exec 9>` above opened a NEW open
  # file description, so `flock 9` would block on the caller's still-held lock
  # while the caller blocks waiting for us to return. Observed live on the
  # 2026-07-13 0.0.9 win leg — this script printed "build-desktop-sidecar.sh holds
  # … waiting" (it was the CALLER holding it, not build-desktop-sidecar.sh) then
  # hung on `flock 9` until killed. The caller's lock already gives us the exact
  # SIDECAR-publish exclusion this acquire would — so skip it. (mac-vm-build.sh /
  # build-linux-local.sh / release-local.sh call us WITHOUT the flag and still
  # self-lock below.)
  echo "    → sidecar.lock already held by the caller (PAPERCUSP_SIDECAR_LOCK_HELD=1) — not re-acquiring"
elif command -v flock >/dev/null 2>&1; then
  if ! flock -n 9; then
    echo "    → build-desktop-sidecar.sh holds $SIDECAR.lock — waiting (it would delete this bundle mid-tar)"
    flock 9
  fi
else
  # macOS ships no flock(1) — the same mkdir spinlock + stale-PID reclaim
  # build-desktop-sidecar.sh falls back to, on the SAME lockdir path (mac-vm-build.sh
  # calls this stager, so the mac leg needs the protection too — WI-3307).
  STAGE_LOCKDIR="$SIDECAR.lockdir"
  while ! mkdir "$STAGE_LOCKDIR" 2>/dev/null; do
    holder="$(cat "$STAGE_LOCKDIR/pid" 2>/dev/null || true)"
    if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$STAGE_LOCKDIR"
      continue
    fi
    echo "    → another sidecar build/stage holds $STAGE_LOCKDIR — waiting for it"
    sleep 5
  done
  echo "$$" > "$STAGE_LOCKDIR/pid"
fi
SCRUB_DIR=""
trap 'rm -rf ${STAGE_LOCKDIR:+"$STAGE_LOCKDIR"} ${SCRUB_DIR:+"$SCRUB_DIR"}' EXIT

# Re-check AFTER taking the lock: a rebuild we just waited on may have replaced
# the sidecar (the serve.mjs check above ran unlocked, so its answer is stale).
if [[ ! -f "$SIDECAR/serve.mjs" ]]; then
  echo "ERROR: $SIDECAR/serve.mjs missing after acquiring the sidecar lock — run bin/build-desktop-sidecar.sh first" >&2
  exit 1
fi

rm -f "$OUT"
echo "==> stage-source-tree: taring runnable monorepo tree from $MONO"

# EXCLUDES. Two classes, and only ONE of them is maintained here:
#
# (1) SECRETS / PRIVACY — NOT maintained here. Derived at run time from
#     bin/audit-release-bundle.py --tar-excludes, which is also THE GATE that
#     fails this build if any of it slips through. These used to be two
#     hand-kept lists of the same knowledge — a denylist here, a regex set
#     there — and two copies drift by construction. Read the old list as a
#     postmortem log: cargo-target added after it blew up the 0.0.5 cut, .next
#     after it tripled 0.0.8, and NOBODY had ever heard of .papercusp/, so 0.0.8
#     shipped 121 agent session transcripts. Now the exclude and the check that
#     catches a missed exclude come from ONE rule (WI-4419).
#
#     Nested is the half the top-level allowlist below cannot do: the junk sits
#     INSIDE apps/ and packages/ (packages/operator-core/.papercusp,
#     apps/operator/test-results, **/.vitest-tmp), and some of it is git-TRACKED
#     via a .gitignore anchoring bug — so "tracked" was never a safety signal.
#
# (2) HEAVY / IRRELEVANT to running dev(:3270 tsx hono-host)/local(:3055 vite):
#     .git (7.2G history); papercusp-desktop/ (the Tauri/Rust shell — its own
#     src-tauri/sidecar 2G self-reference, seed 2.1G, Rust target; the operators
#     never import it and detectPapercupRoot's markers live at the mono root);
#     Rust build targets; editor dirs; logs; tsbuildinfo. Size, not secrecy —
#     so it stays local, and a miss here is a fat bundle, not a leak.
#
# node_modules IS KEPT — it is the shipped toolchain (tsx/vite + the whole
# @papercusp/* runtime closure). dist/ is DELIBERATELY kept: some internal
# packages resolve their "main" to a built dist/ at runtime, so pruning it
# would break module resolution. .next is NOT kept (2026-07-11, 0.0.8 cut):
# apps/operator/.next had grown to 21G (19.5G webpack cache) and bloated the
# 0.0.8 GUI deb to 9.4GB (0.0.6: 2.9GB) with a ~35G first-boot extract; the
# standalone Next operator path is RETIRED and nothing in hono-host /
# host-bootstrap / env-operator-launcher resolves into .next at runtime.
declare -a EXCLUDES=()
# (1) secrets / privacy — from the gate, never re-typed here.
while IFS= read -r pat; do
  [[ -n "$pat" ]] && EXCLUDES+=(--exclude="$pat")
done < <(python3 "$HERE/audit-release-bundle.py" --tar-excludes)
(( ${#EXCLUDES[@]} > 0 )) \
  || { echo "ERROR: audit-release-bundle.py --tar-excludes returned nothing — refusing to stage an UNFILTERED tree (WI-4419)" >&2; exit 1; }
echo "    privacy excludes: ${#EXCLUDES[@]} patterns (derived from the gate's rules)"
EXCLUDES+=(
  # (2) heavy / irrelevant — size, not secrecy
  --exclude='./papercusp-desktop'
  --exclude='./target' --exclude='./.cargo-target'
  # per-work-item isolated cargo target dirs (.wiNNNN-cargo-target): multi-GB
  # build output — one swept into the 2026-07-09 0.0.5 cut and tripled the
  # source bundle to 7.1G (plus "file changed as we read it" tar churn from
  # the concurrent build writing it)
  --exclude='./.wi*-cargo-target' --exclude='./*cargo-target*'
  # Next.js build/cache dirs (WI-4229): apps/operator/.next hit 21G (19.5G
  # webpack cache) and tripled the 0.0.8 source bundle; the standalone Next
  # operator is retired and nothing resolves into .next at runtime (dist/ is
  # the runtime-resolved build output and stays).
  --exclude='./.next' --exclude='*/.next'
  --exclude='*/.turbo'
  # apps/operator-docs/dist (WI-4419): the STANDALONE Starlight docs-SITE build
  # (193M, untracked). Exempt from the "dist/ stays" rule above — that rule is for
  # package dist/ resolved at runtime via exports."main"; this dist is a static
  # website nothing in the app consumes. Runtime reads the docs SOURCE tree
  # (apps/operator-docs/src/content/docs) and the operator's OWN public/ copy of
  # llms.txt (see resource-index.ts / _repo-paths.ts LLMS_TXT_PATH), NEVER this
  # dist. It is also the RECURRING box-identity leak source: every operator-docs
  # rebuild bakes the owner's git-name/email from an agent-insight into dist HTML
  # (e.g. attributing-a-change-*.html), red-ing the cut ~10min in on stale output
  # the cut never regenerates. Dropping it kills that class and shrinks the bundle.
  --exclude='./apps/operator-docs/dist' --exclude='*/operator-docs/dist'
  --exclude='./.idea' --exclude='*/.idea'
  --exclude='./.vscode' --exclude='*/.vscode'
  --exclude='*.log'
  --exclude='*.tsbuildinfo'
  --exclude='./.DS_Store' --exclude='*/.DS_Store'
)
# Rust/Cargo build targets at ANY depth. The `./target` above only anchors the
# MONO ROOT; a nested crate target (apps/tui/target, apps/pui-*/target,
# libs/**/src-tauri/target) sails through, and a cargo target bakes this box's
# absolute home path into .rustc_info.json / *.d / release binaries — the 0.0.9
# mac leg leaked /Users/<owner> ×8075 out of apps/tui/target/ and the gate
# (correctly) red'd the cut (WI-4419). We CANNOT use a blanket `*/target`:
# node_modules/weapon-regex ships its RUNTIME under core/target/ (package.json
# exports → ./core/target/js-3/weapon-regex-opt/main.js), so `*/target` would drop
# a shipped runtime and break module resolution. So discover the REAL cargo targets
# generically — every `target/` dir OUTSIDE any node_modules, at any depth, so a new
# crate can't re-open the hole (no hand-kept per-crate list) — and exclude each.
# The gate carries a matching node_modules-scoped `cargo-build-target` path rule as
# the fast backstop; the content identity scan is the ultimate one (WI-4419).
while IFS= read -r tdir; do
  [[ -n "$tdir" ]] && EXCLUDES+=(--exclude="$tdir")
done < <(cd "$MONO" && find . -type d -name node_modules -prune -o -type d -name target -print 2>/dev/null)
# ── ALLOWLIST (WI-4419). The EXCLUDES above are kept as a second layer for
# NESTED junk inside an allowed dir (apps/operator/.next, a stray */.env), but
# they are no longer what decides whether a top-level entry ships.
#
# WHY THIS IS AN ALLOWLIST NOW. It used to be `-cf - .` (everything at the mono
# root, minus exclusions). A denylist can only ever exclude what someone already
# learned to fear — read the EXCLUDES list as a postmortem log: cargo-target was
# added after it blew up the 0.0.5 cut, .next after it tripled 0.0.8. Meanwhile
# NOBODY thought of <mono>/.papercusp/, so the 0.0.8 bundles shipped 53,225
# untracked files including 121 AGENT SESSION TRANSCRIPTS
# (.papercusp/pi-sessions/*.jsonl) with the operator's home path in every record
# (WI-4419). The mono root is a working tree on a busy dev box — .agent-tmp/,
# .tmp/, scratch/, test-results/, ~140 .papercup-console-active.* turds — and a
# denylist silently re-opens every single time any tool drops a new one.
#
# So: name what the dev(:3270 tsx hono-host) / local(:3055 vite) buttons actually
# need. Anything not named here does not ship, including things that do not exist
# yet. Adding a top-level dir to the repo is now a DELIBERATE decision to ship it.
#
# NOT shipped, on purpose: .papercusp .agent-tmp .claude .harness .nx .tmp*
# .vitest-tmp .pcv-socktest scratch scratchpad test-results briefs _retired
# papercusp-desktop .git .github benchmarks infra deploy — plus every root dotfile
# (.env* .bashrc .gitconfig .npmrc .mcp.json*), which git happens to TRACK here,
# so "tracked" was never a safety signal either.
declare -a INCLUDES=()
declare -a MISSING=()
for entry in \
  package.json package-lock.json tsconfig.base.json .nvmrc \
  eslint.config.mjs knip.json bunfig.toml .gitignore .gitmodules \
  CLAUDE.md AGENTS.md BORROWABLE.md \
  node_modules apps libs packages \
  tools scripts templates patches design design-tokens rubrics docs bin
do
  if [[ -e "$MONO/$entry" ]]; then
    INCLUDES+=("./$entry")
  else
    MISSING+=("$entry")
  fi
done
# The four load-bearing ones — a packaged install has no npm to repair a gap, so
# a missing one is a silently-broken dev/local button in the field, not a warning.
for required in node_modules apps libs packages; do
  [[ -e "$MONO/$required" ]] \
    || { echo "ERROR: allowlist requires $MONO/$required — refusing to stage a tree the dev/local buttons cannot run" >&2; exit 1; }
done
(( ${#MISSING[@]} == 0 )) \
  || echo "    note: allowlist entries absent from this tree (skipped): ${MISSING[*]}"
echo "    allowlist: ${#INCLUDES[@]} top-level entries"

# ── IDENTITY SCRUB (WI-4419; desktop-v0-0-12-release-tri-platform-2026-07-19 D-004)
# ─────────────────────────────────────────────────────────────────────────────
# The audit gate (below) forbids this build box's identity — git name ("Avi"),
# home path, unix user, email, hostname — plus the known cross-box creds, in the
# shipped bytes. Dev-infra and agent-authored SOURCE keeps re-introducing them into
# MUST-SHIP files: [owner:Avi] provenance comments in prod .ts/.sql, dev systemd
# ExecStart=/home/<user> units, test fixtures hardcoding the build username. Those
# files ship (or run), so they can't be pruned like a scratch dir, and hand-editing
# each one is a treadmill that reds the next cut the instant a new tag lands. So:
# redact every identity literal in a COPY of each leaking source file, and tar the
# copy IN PLACE OF the original via a --transform overlay (streams — never touches
# the shared working tree, never node_modules; a vendored leak is a delete-exclude
# class handled above). BOTH the literal→placeholder map AND the leaking-file set
# come from the gate's ONE rule (audit-release-bundle.py --identity-literals /
# --source-leakers), so the scrub cannot drift from what the gate later fails on.
# This REMOVES the leak from the shipped bytes — the gate still fails on anything
# left un-redacted, so it is not an exception. Opt out: PAPERCUSP_STAGE_SCRUB=0.
declare -a SCRUB_EXCLUDES=()
declare -a SCRUB_MEMBERS=()
declare -a SCRUB_TRANSFORM=()
if [[ "${PAPERCUSP_STAGE_SCRUB:-1}" == "1" ]]; then
  declare -a _leakers=()
  # NOTE: portable read loop instead of `mapfile -t` — mapfile/readarray is a
  # bash-4+ builtin and this script also runs on the mac release VM, whose
  # default /bin/bash is 3.2 (macOS ships no newer bash); mapfile there aborts
  # the build with `mapfile: command not found` (exit 127) — broke the mac
  # v0.0.12 leg. This loop is functionally identical to `mapfile -t` (strips the
  # trailing newline per line and drops the final empty line).
  while IFS= read -r _leak_line; do
    [[ -n "$_leak_line" ]] && _leakers+=("$_leak_line")
  done < <(python3 "$HERE/audit-release-bundle.py" --source-leakers "$MONO" "${INCLUDES[@]#./}")
  if (( ${#_leakers[@]} > 0 )); then
    # literal→placeholder sed program, longest-literal-first (so /home/<user> is
    # redacted before the bare <user> inside it) — straight from the gate's rule.
    declare -a _sed=()
    while IFS=$'\t' read -r _val _red _wb; do
      [[ -z "$_val" ]] && continue
      _p="$(printf '%s' "$_val" | sed 's/[][\.^$*+?(){}|/]/\\&/g')"
      _r="$(printf '%s' "$_red" | sed 's/[&/\]/\\&/g')"
      if [[ "$_wb" == "1" ]]; then _sed+=(-e "s/\\b${_p}\\b/${_r}/g"); else _sed+=(-e "s/${_p}/${_r}/g"); fi
    done < <(python3 "$HERE/audit-release-bundle.py" --identity-literals)
    SCRUB_DIR="$(mktemp -d "$SIDECAR/.stage-scrub-XXXXXX")"
    for _rel in "${_leakers[@]}"; do
      [[ -f "$MONO/$_rel" ]] || continue
      mkdir -p "$SCRUB_DIR/SCRUBBED/$(dirname "$_rel")"
      sed -E "${_sed[@]}" "$MONO/$_rel" > "$SCRUB_DIR/SCRUBBED/$_rel"
      SCRUB_EXCLUDES+=(--exclude="./$_rel")
      SCRUB_MEMBERS+=("./SCRUBBED/$_rel")
    done
    SCRUB_TRANSFORM+=(--transform='s|^\./SCRUBBED/|./|')
    echo "    identity scrub: redacted ${#SCRUB_MEMBERS[@]} must-ship source file(s) in the bundle (WI-4419 D-004)"
  fi
fi

zstd_level="${PAPERCUSP_SOURCE_ZSTD_LEVEL:-6}"
# GNU tar REQUIRED (WI-3307 mac leg): the exclude anchoring + --owner/--group
# flags above are GNU dialect — macOS bsdtar rejects --owner outright and
# matches excludes subtly differently (a silent-content bug, not a loud one).
# On macOS: brew install gnu-tar → gtar.
TAR_BIN=tar
if ! tar --version 2>/dev/null | grep -q 'GNU tar'; then
  if command -v gtar >/dev/null 2>&1; then
    TAR_BIN=gtar
  else
    echo "ERROR: GNU tar required (macOS: brew install gnu-tar) — bsdtar's --owner/exclude dialect differs" >&2
    exit 1
  fi
fi
command -v zstd >/dev/null 2>&1 || { echo "ERROR: zstd not on PATH (macOS: brew install zstd)" >&2; exit 1; }
# The shared tree is edited by the whole fleet WHILE this multi-minute tar
# runs; GNU tar exits 1 for "file changed as we read it" — a warning (the
# entry is still written), not corruption. Under set -e/pipefail that exit 1
# would kill a ~25-min VM build at the pack step, so tolerate exactly exit 1
# (the changed-file warnings stay visible on stderr); exit ≥2 and any zstd
# failure remain fatal.
set +e +o pipefail
# The scrub overlay (D-004): SCRUB_EXCLUDES drop the leaking originals from the
# MONO pass; a second `-C "$SCRUB_DIR"` adds the redacted copies, whose ./SCRUBBED/
# prefix the SCRUB_TRANSFORM rewrites back to the real path (and which the leaker
# excludes — anchored on ./<relpath> — do NOT match, so the redacted copy survives
# while the original is dropped). One archive, one EOF; empty arrays no-op when
# PAPERCUSP_STAGE_SCRUB=0 or nothing leaked.
declare -a _scrub_tail=()
[[ -n "$SCRUB_DIR" ]] && _scrub_tail=(-C "$SCRUB_DIR" "${SCRUB_MEMBERS[@]}")
"$TAR_BIN" --numeric-owner --owner=0 --group=0 \
  "${EXCLUDES[@]}" "${SCRUB_EXCLUDES[@]}" "${SCRUB_TRANSFORM[@]}" \
  -C "$MONO" -cf - "${INCLUDES[@]}" \
  "${_scrub_tail[@]}" \
  | zstd -T0 "-${zstd_level}" --long=27 -q -f -o "$OUT"
rcs=("${PIPESTATUS[@]}")
set -e -o pipefail
(( rcs[0] <= 1 )) || { echo "ERROR: tar failed (exit ${rcs[0]})" >&2; exit 1; }
(( rcs[1] == 0 )) || { echo "ERROR: zstd failed (exit ${rcs[1]})" >&2; exit 1; }

sz="$(du -h "$OUT" | cut -f1)"
echo "    ✓ source.tar.zst staged (${sz} compressed, zstd -${zstd_level} --long=27)"
echo "      → first boot extracts it to a writable dir; PAPERCUSP_INTEGRATION_ROOT points at it (WI-3308)"

# ── THE GATE (WI-4419). Audit what we ACTUALLY produced, not what we meant to.
# Wired HERE, in the producer, rather than in each of the three callers
# (release-local.sh / mac-vm-build.sh / build-windows-on-vm.sh) — a gate that
# each platform has to remember to call is a gate that one platform forgets, and
# the leak's CONTENTS vary by build host (the mac Server bundle carried the same
# structural hole with zero transcripts, purely because that box had none). The
# allowlist decides what we MEAN to ship; this decides what we DID.
#
# Fatal by design. If this fires, fix the allowlist above — do not add an
# exception to make the build pass.
if ! python3 "$HERE/audit-release-bundle.py" "$OUT"; then
  echo "" >&2
  echo "ERROR: release bundle audit FAILED — refusing to package (WI-4419)." >&2
  exit 1
fi
exit 0

}  # ── end self-read guard (WI-3306) — opened after 'set -euo pipefail' above ──

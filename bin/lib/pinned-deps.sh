#!/usr/bin/env bash
# papercusp_pinned_deps_* — give a PINNED release cut dependencies that are decoupled
# from the shared checkout, and refuse to build when they are not.
#
# EI-21832562420831737, third and last part. Parts one and two (lib/source-roots.sh) made
# a vm-release cut read ONE repo root and refuse a source tree that was dirty at the phase
# boundary. Both are about *source*. This file is about the other half of what the build
# actually reads: node_modules.
#
# THE DEFECT. A pinned worktree is created by `git worktree add --detach`, so it has no
# node_modules at all, and a full install is minutes the release window does not have. The
# workaround that shipped r15 overlay-mounted 86 node_modules directories into the pinned
# tree with `lowerdir` pointing straight at the LIVE shared checkout. That gets the write
# direction right — an overlay upper layer captures every pinned write, so nothing the build
# does can reach the shared tree — and gets the READ direction exactly wrong: ~100 agents
# keep installing into that lower layer while the cut reads it.
#
# It is not a theoretical race; it has already destroyed a release. On 2026-08-29 a
# concurrent live build rewrote the shared sidecar node_modules at 20:34:43, 20:35:57 and
# 20:37:30 EDT, inside r14's dependency-generation comparison window, and r14 died on a torn
# cache hit (D-187). The detector that caught it was dependency generation itself, and D-186
# then switched dependency generation OFF for having zero consumers in the release path and
# costing ~23 of r14's 24 minutes. So the hazard survived and its only detector did not.
#
# WHY THE LOWER LAYER IS THE WRONG PLACE FOR A LIVE TREE, independently of the race window:
# overlayfs does not support it. Modifying the underlying directories of a mounted overlay
# is documented as producing undefined behaviour, not merely a stale read — so "we mounted
# the live tree and it worked" describes a build whose inputs were never well-defined.
#
# THE FIX: keep the overlay, move the floor. `lowerdir` becomes a HARDLINK SNAPSHOT of the
# donor rather than the donor itself. npm mutates a package by unlinking or renaming its
# directory entry, never by editing the inode in place, so a hardlink farm is a genuine
# point-in-time snapshot of exactly the operations that tore r14: entries the snapshot owns
# keep pointing at the inodes they were linked to, whatever the donor does afterwards. The
# result keeps BOTH properties — the donor cannot tear the build (its own entries are
# frozen) and the build cannot reach the donor (overlay writes land in the upper layer).
#
# MEASURED, not assumed: `cp -al` of the live root node_modules — 255,519 files — took 9
# seconds and consumed no measurable disk (58G available before and after; hardlinks share
# data blocks, so only directory entries are new). That is the whole cost of the fix, once
# per pin, against the ~17-minute cut it protects.
#
# ⚠ USE df, NOT du, IF YOU RE-MEASURE THAT. `du` over a hardlink farm dedupes within one
# invocation and not across them, so it reports whatever the caller's traversal order makes
# it report; a sibling item measured a ~7x overstatement that way.
#
# WHAT THIS DELIBERATELY DOES NOT DO: take the snapshot by fingerprinting the donor before
# and after and refusing a mismatch, the way sync_one_node_modules does in
# apps/operator/bin/release/setup-release-checkout.sh. That is a DETECTOR, and this path can
# have PREVENTION instead: scripts/npm-install-safe.mjs already owns a repo-keyed install
# mutex and already exposes the reader half of that contract as `--exec-under-lock`, written
# for precisely this shape ("long-lived host services build an entrypoint from node_modules
# immediately before boot"). Snapshotting under that lock means no sanctioned install can be
# mid-flight, and the lock is held for the ~9 seconds of the snapshot rather than the whole
# build. The cheap shape check below is the residual net for UNSANCTIONED writers — a bare
# `npm install`, which the repo forbids precisely because it corrupts the shared tree.
# The full fingerprint is deliberately not used as a per-cut gate, on cost grounds that were
# measured rather than guessed: `dependency_generation_tree_fingerprint` over the root
# node_modules ALONE took 3m09s (2m58s of it system time — it stats every one of the 255,519
# paths), against 9s for hardlink-snapshotting the same tree. Its before/after form needs two
# such walks per tree, so adopting it here would reintroduce exactly the cost profile D-186
# switched dependency generation off for. It remains the right instrument in
# setup-release-checkout.sh, which has no lock over its donor and therefore no alternative.
#
# PORTABILITY: macOS ships /bin/bash 3.2.57 and this file is sourced by scripts that run on
# the mac VM. Everything here is bash 3.2 (no mapfile, no associative arrays, no ${var^^});
# see scripts/check-mac-bash-portability.mjs.

# Usage: papercusp_pinned_deps_trees <root>
# Echoes, one per line, the repo-relative path of every node_modules directory a workspace
# install can reach from <root>. Empty output is a legitimate answer (a fresh worktree).
#
# Use the maintained product boundary, including tracked submodules and these exclusions:
#   - `.papercusp/` holds agent scratch, not build input;
#   - nested node_modules under a node_modules are reached through their parent already;
#   - the generated sidecar OUTPUT dir is excluded by D-187. Mounting inside it makes the
#     mount follow the retired inode when publication atomically renames sidecar/ aside, and
#     the builder's cleanup then fails EBUSY after an otherwise-green cut. It would also
#     leak live build artifacts into server.tgz.
papercusp_pinned_deps_trees() (
  local _root="${1:-}"
  [ -n "$_root" ] || return 0
  [ -d "$_root" ] || return 0

  _root="$(cd "$_root" && pwd -P)" || return 1
  source "$(dirname "${BASH_SOURCE[0]}")/../../../apps/operator/bin/release/dependency-generation.sh" || return 1
  dependency_generation_configure_workspace_dirs "$_root" || return 1
  # WI-41095: no second depth-limited walker admitting unrelated checkouts.
  local _trees _tree
  _trees="$(dependency_generation_enumerate_node_modules "$_root")" || return 1
  while IFS= read -r _tree; do
    if [ -n "$_tree" ]; then printf '%s\n' "${_tree#"$_root"/}"; fi
  done <<EOF
$_trees
EOF
)

# WI-41095: refuse invalid donor links before allocating a copy. With a source
# capture (or '-' for stdin JSON), also require their targets in the planned copy.
# Repeat inside the install mutex; the final copied-tree guard remains authoritative.
# The donor must be a physical install. lint-as-committed's node_modules shadow
# deliberately links package files back to its install and is a SOURCE checkout,
# not a snapshot donor. Use the physical install as donor; never dereference its
# package links or edit a shadow to make it pass. Disposable caches and exact npm
# retired executable shims are excluded from both preflight and copying.
papercusp_pinned_deps_preflight() {
  local _donor="${1:-}" _population="${2:-}" _emit="${3:-}" _trees
  _trees="$(papercusp_pinned_deps_trees "$_donor")" || return 1
  node -e '
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = fs.realpathSync(process.argv[1]), population = process.argv[2];
const trees = process.argv[3].split("\n").filter(Boolean).map(p => path.join(root, p));
const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
let files;
if (population) {
  const record = JSON.parse(fs.readFileSync(population === "-" ? 0 : population, "utf8"));
  const selected = Array.isArray(record) ? record : Object.keys(record.sourceFiles);
  files = new Set();
  for (const p of selected) {
    const target = path.resolve(root, p);
    if (path.isAbsolute(p) || !inside(root, target)) throw new Error("escaping-pinned-source:" + p);
    for (let parent = target; inside(root, parent); parent = path.dirname(parent)) {
      files.add(parent);
      if (parent === root) break;
    }
  }
}
const fail = (reason, file) => { throw new Error(reason + ":" + path.relative(root, file)); };
// Match dependency_generation_prune_ephemeral before traversing disposable outputs.
// The Bun install cache includes absolute version-index links, not installed
// package links. Exclude it with the same policy used when copying the tree.
const caches = new Set([".cache", ".bun-cache", ".astro", ".vite", ".vite-temp", ".verdict-data"]);
const exclusions = [];
const visit = (file, tree) => {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    // Arborist retires binPaths to .<name>-<pathSafeHash(absolute binPath)>.
    // These rollback/trash entries may outlive an interrupted npm cleanup;
    // they are not executable dependencies. Match the exact writer identity,
    // not every hidden shim, and use this same list for the snapshot copy.
    const retired = path.basename(file).match(/^\.(.+)-([a-zA-Z0-9]{8})$/);
    if (path.basename(path.dirname(file)) === ".bin" && retired) {
      const original = path.join(path.dirname(file), retired[1]);
      const hash = crypto.createHash("sha1").update(original).digest("base64")
        .replace(/[^a-zA-Z0-9]+/g, "").slice(0, 8);
      if (hash === retired[2]) {
        const rel = path.relative(tree, file), treeRel = path.relative(root, tree);
        if (/[\r\n\t]/.test(rel + treeRel)) fail("unrepresentable-pinned-exclusion", file);
        // rsync filters are globs. Escape package/bin names before anchoring
        // the exclusion to this dependency tree, including on resumed copies.
        exclusions.push(treeRel + "\t/" + rel.replace(/[\\*?\[\]]/g, "\\$&"));
        return;
      }
    }
    const link = fs.readlinkSync(file);
    if (path.isAbsolute(link)) fail("absolute-pinned-dependency-link", file);
    const lexical = path.resolve(path.dirname(file), link);
    if (!inside(root, lexical)) fail("escaping-pinned-dependency-link", file);
    let resolved;
    try { resolved = fs.realpathSync(file); } catch { fail("dangling-pinned-dependency-link", file); }
    if (!inside(root, resolved)) fail("escaping-pinned-dependency-link", file);
    if (files && [lexical, resolved].some(target => !trees.some(tree => inside(tree, target)) &&
      !files.has(target))) fail("unplanned-pinned-dependency-target", file);
  } else if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(file, { withFileTypes: true })) {
      // Materialized donors may link these disposable outputs to a live cache.
      // Exclude the entry before following or validating its target, just as the
      // snapshot copy does; real package links still take the strict guard above.
      if (caches.has(entry.name)) continue;
      visit(path.join(file, entry.name), tree);
    }
  }
};
for (const tree of trees) {
  if (fs.lstatSync(tree).isSymbolicLink()) fail("REFUSING symlinked dependency tree", tree);
  visit(tree, tree);
}
if (process.argv[4] === "rsync-filters") process.stdout.write(exclusions.join("\n"));
' "$_donor" "$_population" "$_trees" "$_emit"
}

# Usage: papercusp_pinned_deps_snapshot <donor_root> <snapshot_root> [hardlink|copy]
# `copy` keeps independent inodes for readers which must also survive in-place donor writes.
# Hardlink-snapshots every dependency tree under <donor_root> into <snapshot_root>, preserving
# the donor's relative layout. Prints progress to stdout; returns non-zero on any failure.
#
# ⚠ CALL IT UNDER THE DONOR'S INSTALL MUTEX. This function does not take the lock itself,
# because the lock belongs to the donor tree and is owned by the donor's own tooling — taking
# it here would be a second implementation of a contract scripts/npm-install-safe.mjs already
# defines. `papercusp_pinned_deps_snapshot_locked` below is the wrapper that does it properly.
#
# LAYOUT IS MIRRORED, NOT FLATTENED. The snapshot keeps `apps/operator/node_modules` at
# `<snapshot_root>/apps/operator/node_modules` rather than a flattened key, so a lowerdir can
# be checked with a plain prefix test and a reader can see which tree a directory came from.
#
# RELATIVE SYMLINKS SURVIVE. The ~98 `@papercusp/*` entries are relative symlinks
# (`../../libs/generic/...`). `cp -al` preserves the link TEXT, and an overlay resolves links
# at the MOUNTPOINT, so under the pinned tree they land inside the pinned tree — the same
# property the r15 overlay had, for the same reason. That is also why a snapshot must never be
# used as a node_modules directly at a different depth: the links would resolve elsewhere.
papercusp_pinned_deps_snapshot() (
  local _donor="${1:-}"
  local _snap="${2:-}"
  local _copy_mode="${3:-hardlink}"
  local _population="${4:-}"
  # The locked wrapper must drop its donor reader if copy capacity races away.
  local _copy_admission="${5:-wait}"
  local _rel _src _dst _tmp _old _n=0 _fail=0 _legacy _legacy_count _legacy_path
  case "$_copy_mode" in
    hardlink|copy) ;;
    *) echo "ERROR: snapshot mode must be hardlink or copy." >&2; return 2 ;;
  esac

  if [ -z "$_donor" ] || [ -z "$_snap" ]; then
    echo "ERROR: papercusp_pinned_deps_snapshot needs <donor_root> <snapshot_root>." >&2
    return 2
  fi
  if [ ! -d "$_donor" ]; then
    echo "ERROR: dependency donor is not a directory: $_donor" >&2
    return 2
  fi
  # rsync resolves a relative --link-dest from the destination, not the caller.
  _donor="$(cd "$_donor" && pwd -P)" || return 1

  # A refused retry must not leave the previous attempt attested by its stamp.
  if [ -d "$_snap" ]; then rm -f "$_snap/.papercusp-pinned-deps" || return 1; fi
  local _retired_filters _filter_tree _filter_pattern
  _retired_filters="$(papercusp_pinned_deps_preflight "$_donor" "$_population" rsync-filters)" || return 1

  # Live tool caches can disappear even under the install mutex. Filter before
  # copying, using dependency-generation's policy; package failures remain fatal.
  local -a _cache_filters
  _cache_filters=(--delete-excluded --exclude=.cache --exclude=.bun-cache --exclude=.astro --exclude=.vite \
    --exclude=.vite-temp --exclude=.verdict-data)
  if ! command -v rsync >/dev/null 2>&1; then
    echo "ERROR: pinned dependency snapshots require rsync for cache-safe copying." >&2
    return 1
  fi

  if [ "$_copy_mode" = copy ]; then
    local _generation_helper
    _generation_helper="$(dirname "${BASH_SOURCE[0]}")/../../../apps/operator/bin/release/dependency-generation.sh"
    if ! command -v rsync >/dev/null 2>&1 || [ ! -f "$_generation_helper" ]; then
      echo "ERROR: independent snapshots require rsync and the maintained dependency copy progress helper." >&2
      return 1
    fi
    source "$_generation_helper" || return 1
    # WI-10007557: the progress helper alone does not serialize or admit a copy.
    # Keep the host-wide lease through checksum reuse, staging and publication;
    # the subshell's EXIT trap also releases it on every refused/failed attempt.
    dependency_generation_record_reserve_fs "$_donor"
    case "$_copy_admission" in
      try)
        DEPENDENCY_GENERATION_COPY_LOCK_TIMEOUT_SEC=0 DEPENDENCY_GENERATION_COPY_LOCK_MAX_SEC=0 \
          dependency_generation_acquire_copy_lock "pinned snapshot $_snap" || return $? ;;
      wait) dependency_generation_acquire_copy_lock "pinned snapshot $_snap" || return $? ;;
      *) echo "ERROR: invalid copy admission mode; refusing dependency snapshot." >&2; return 76 ;;
    esac
    trap dependency_generation_release_copy_lock EXIT
  fi

  # Hardlinks cannot cross filesystems, and the failure mode without this check is a
  # half-built snapshot plus an EXDEV error thousands of files in. Assert it once, up front,
  # naming both devices — the same contract assert_hardlink_compatible_roots makes in
  # setup-release-checkout.sh before its own hardlink copy.
  local _donor_dev _snap_dev _snap_probe
  _snap_probe="$_snap"
  while [ -n "$_snap_probe" ] && [ ! -e "$_snap_probe" ]; do
    _snap_probe="$(dirname "$_snap_probe")"
  done
  _donor_dev="$(df -P "$_donor" 2>/dev/null | awk 'NR==2 {print $1}')"
  _snap_dev="$(df -P "$_snap_probe" 2>/dev/null | awk 'NR==2 {print $1}')"
  if [ -z "$_donor_dev" ] || [ -z "$_snap_dev" ]; then
    echo "ERROR: could not determine the filesystem of the donor ($_donor) or snapshot root ($_snap)." >&2
    return 1
  fi
  if [ "$_copy_mode" = hardlink ] && [ "$_donor_dev" != "$_snap_dev" ]; then
    echo "ERROR: a hardlink dependency snapshot needs one filesystem." >&2
    echo "       donor=$_donor ($_donor_dev)  snapshot=$_snap ($_snap_dev)" >&2
    echo "       Place the snapshot root on the donor's filesystem; a cross-device copy would" >&2
    echo "       duplicate the whole dependency payload instead of sharing its data blocks." >&2
    return 1
  fi

  mkdir -p "$_snap" || return 1
  # A retry may fail even when this root holds an earlier complete snapshot.
  # Its old success receipt must not attest this new attempt.
  rm -f "$_snap/.papercusp-pinned-deps" || return 1

  while IFS= read -r _rel; do
    [ -n "$_rel" ] || continue
    _src="$_donor/$_rel"
    _dst="$_snap/$_rel"
    local -a _tree_filters
    _tree_filters=("${_cache_filters[@]}")
    while IFS=$'\t' read -r _filter_tree _filter_pattern; do
      if [ "$_filter_tree" = "$_rel" ]; then
        _tree_filters+=("--exclude=$_filter_pattern")
      fi
    done <<EOF
$_retired_filters
EOF
    _tmp="$_dst.pinned-deps-tmp.$$"
    _old="$_dst.pinned-deps-old.$$"
    [ -d "$_src" ] || continue

    # A SYMLINKED dependency tree must not be snapshotted through. `cp -al` implies
    # --no-dereference, so it would faithfully reproduce the symlink and the "snapshot" would
    # still point at the donor — decoupled in name only, and silently so. Refusing is also
    # honest about the alternative: dereferencing with -L would turn a 9-second hardlink farm
    # into a real 15GB copy of somebody else's tree.
    if [ -L "$_src" ]; then
      echo "  REFUSING to snapshot through a symlinked dependency tree: $_rel -> $(readlink "$_src")" >&2
      _fail=1
      continue
    fi

    mkdir -p "$(dirname "$_dst")" || { _fail=1; continue; }
    if [ "$_copy_mode" = copy ]; then
      # Earlier trees may already have been published before interruption. A
      # byte/metadata dry run plus single-link files permits unchanged reuse;
      # shared inodes or any difference take the independent staging path.
      local _changes _linked
      if [ -d "$_dst" ] && [ ! -L "$_dst" ]; then
        _linked="$(find "$_dst" -type f -links +1 -print -quit)" || { _fail=1; continue; }
        if [ -z "$_linked" ]; then
          echo "verifying completed snapshot $_rel (checksums, independent inodes)"
          if ! _changes="$(rsync -aH --checksum --dry-run --delete --itemize-changes \
            "${_tree_filters[@]}" "$_src/" "$_dst/")"; then
            _fail=1
            continue
          fi
          if [ -z "$_changes" ]; then
            echo "  reused verified completed snapshot $_rel"
            _n=$((_n + 1))
            echo "snapshot progress: completed=$_n tree=$_rel"
            continue
          fi
        fi
      fi
      # These ordinary donors have no generation .tree-bytes receipt. Measure
      # apparent bytes (including sparse files) before touching retained staging.
      # Check-only forbids the generation reaper from disposing peer evidence.
      local _size_output _need _admission_rc=0
      if ! _size_output="$(LC_ALL=C du -s -B1 --apparent-size -- "$_src")"; then
        echo "DEPENDENCY_GENERATION_HEADROOM_UNMEASURED cannot measure $_src" >&2
        _fail=77
        continue
      fi
      _need="${_size_output%%[[:space:]]*}"
      case "$_need" in ''|*[!0-9]*)
        echo "DEPENDENCY_GENERATION_HEADROOM_UNMEASURED invalid size for $_src" >&2
        _fail=77
        continue ;;
      esac
      DEPENDENCY_GENERATION_HEADROOM_CHECK_ONLY=1 \
        dependency_generation_check_headroom "$_src" "$_dst" "$_need" || _admission_rc=$?
      if [ "$_admission_rc" -ne 0 ]; then
        _fail="$_admission_rc"
        continue
      fi
      _tmp="$_dst.pinned-deps-tmp"
      # Adopt exactly one old PID-specific staging tree. It is untrusted input:
      # rsync checks every reused file's bytes, metadata, type and link text.
      # Ambiguity is a refusal, never permission to delete retained progress.
      if [ ! -e "$_tmp" ] && [ ! -L "$_tmp" ]; then
        _legacy_count=0
        _legacy_path=''
        for _legacy in "$_dst".pinned-deps-tmp.*; do
          [ -e "$_legacy" ] || [ -L "$_legacy" ] || continue
          _legacy_count=$((_legacy_count + 1))
          _legacy_path="$_legacy"
        done
        if [ "$_legacy_count" -gt 1 ]; then
          echo "  REFUSING ambiguous retained staging trees for $_rel" >&2
          _fail=1
          continue
        fi
        if [ "$_legacy_count" -eq 1 ]; then
          if [ -L "$_legacy_path" ] || [ ! -d "$_legacy_path" ]; then
            echo "  REFUSING unsafe retained staging tree: $_legacy_path" >&2
            _fail=1
            continue
          fi
          mv "$_legacy_path" "$_tmp" || { _fail=1; continue; }
        fi
      fi
      if [ -L "$_tmp" ] || { [ -e "$_tmp" ] && [ ! -d "$_tmp" ]; }; then
        echo "  REFUSING unsafe staging tree: $_tmp" >&2
        _fail=1
        continue
      fi
      mkdir -p "$_tmp" || { _fail=1; continue; }
      # A retained hardlink could couple this copy to its donor or an old
      # mounted lower layer. Unlink it in staging before rsync applies metadata;
      # -H then recreates donor hardlink groups with independent inodes.
      find "$_tmp" -type f -links +1 -exec rm -f -- {} + || { _fail=1; continue; }
    else
      rm -rf "$_tmp" 2>/dev/null
    fi

    # Build beside the destination and swap with renames, never in place. A snapshot root is
    # cheap to rebuild but it may be the lowerdir of a mounted overlay while we run, and a
    # half-populated lower layer is precisely the torn read this file exists to prevent.
    local _copy_rc=0
    echo "snapshotting $_rel (mode=$_copy_mode)"
    if [ "$_copy_mode" = copy ]; then
      echo "  verifying retained staging bytes before reuse: $_tmp"
      dependency_generation_copy_with_progress "$_src" "$_tmp" --rsync-checksum \
        "${_tree_filters[@]}" || _copy_rc=$?
    else
      # Preserve rsync's path-specific diagnosis. A generic incomplete receipt
      # cannot distinguish a disappearing cache entry, EXDEV or ENOSPC, and
      # forces callers to repeat the whole expensive snapshot to investigate.
      mkdir -p "$_tmp" || _copy_rc=$?
      if [ "$_copy_rc" -eq 0 ]; then
        # st_dev/df identify the backing filesystem, not the mount boundary.
        # Linux rejects link() between two bind mounts of that same device.
        # Probe the actual tree before rsync can emit thousands of EXDEVs
        # (or silently copy ordinary files after its link attempt fails).
        local _link_source _link_probe
        _link_source="$(find "$_src" \( -type f -o -type l \) -print -quit)" || return 1
        if [ -n "$_link_source" ]; then
          _link_probe="$(mktemp -d "$_tmp/.pinned-deps-link.XXXXXX")" || return 1
          if ! ln "$_link_source" "$_link_probe/entry"; then
            echo "ERROR: hardlink admission failed; donor=$_src snapshot=$_tmp must share one mount." >&2
            rm -rf "$_tmp"
            return 1
          fi
          rm -rf "$_link_probe" || return 1
        fi
        rsync -aH --link-dest="$_src" "${_tree_filters[@]}" "$_src/" "$_tmp/" || _copy_rc=$?
      fi
    fi
    if [ "$_copy_rc" -ne 0 ]; then
      echo "  FAILED to snapshot $_rel (exit=$_copy_rc)" >&2
      if [ "$_copy_mode" = copy ]; then
        echo "  retained resumable staging tree: $_tmp (not a completed snapshot)" >&2
      else
        rm -rf "$_tmp" 2>/dev/null
      fi
      _fail=1
      continue
    fi

    if [ -e "$_dst" ]; then
      if ! mv "$_dst" "$_old" 2>/dev/null; then
        echo "  FAILED to retire the previous snapshot of $_rel" >&2
        [ "$_copy_mode" = copy ] || rm -rf "$_tmp" 2>/dev/null
        _fail=1
        continue
      fi
    fi
    if ! mv "$_tmp" "$_dst" 2>/dev/null; then
      echo "  FAILED to publish the snapshot of $_rel" >&2
      [ -e "$_old" ] && mv "$_old" "$_dst" 2>/dev/null
      [ "$_copy_mode" = copy ] || rm -rf "$_tmp" 2>/dev/null
      _fail=1
      continue
    fi
    rm -rf "$_old" 2>/dev/null
    _n=$((_n + 1))
    # Small trees can finish before the byte sampler's first interval. Count
    # only published (or checksum-verified reused) trees as forward progress.
    echo "snapshot progress: completed=$_n tree=$_rel"
  done <<EOF
$(papercusp_pinned_deps_trees "$_donor")
EOF

  if [ "$_fail" -ne 0 ]; then
    echo "ERROR: dependency snapshot incomplete; refusing to stamp it." >&2
    return "$_fail"
  fi

  papercusp_pinned_deps_workspace_outputs "$_donor" "$_snap" "$_copy_mode" || return $?
  {
    echo "donor=$_donor"
    echo "mode=$_copy_mode"
    echo "trees=$_n"
    echo "takenAtUtc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$_snap/.papercusp-pinned-deps" || return 1
  echo "snapshotted $_n dependency tree(s) from $_donor into $_snap"
)

# Shared output closure; caller holds the donor's maintained install reader.
# Generated workspace executables are absent from dependency generations.
papercusp_pinned_deps_workspace_outputs() (
  local _donor="$1" _snap="$2" _copy_mode="$3"
  # Complete verifier trees need the output reached by workspace .bin shims;
  # Git export omits it. Dependency-only overlay floors have no source receipt.
  # Freeze declared output under the same donor mutex, never replacing source.
  if [ -f "$_snap/.verifier-source.json" ]; then
    node -e '
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const donor = fs.realpathSync(process.argv[1]), dest = fs.realpathSync(process.argv[2]);
const mode = process.argv[3], receipt = JSON.parse(fs.readFileSync(path.join(dest, ".verifier-source.json"), "utf8"));
const source = new Set(receipt.files.map(row => row.path));
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
for (const rel of source) {
  if (!rel.endsWith("/package.json")) continue;
  const manifest = path.join(dest, rel), pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const bins = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin || {});
  for (const bin of bins) {
    if (typeof bin !== "string" || !/^(\.\/)?dist\//.test(bin)) continue;
    const packageDir = path.dirname(manifest), target = path.resolve(packageDir, bin);
    if (!inside(packageDir, target)) throw Error("escaping-workspace-bin:" + rel);
    if (fs.existsSync(target)) continue;
    const outputRel = path.relative(dest, path.join(packageDir, "dist"));
    if ([...source].some(p => p === outputRel || p.startsWith(outputRel + "/")))
      throw Error("recorded-workspace-bin-output:" + outputRel);
    const donorManifest = path.join(donor, rel), donorOutput = path.join(donor, outputRel);
    if (!fs.readFileSync(donorManifest).equals(fs.readFileSync(manifest)))
      throw Error("workspace-bin-manifest-mismatch:" + rel);
    if (!fs.existsSync(path.resolve(path.dirname(donorManifest), bin)))
      throw Error("missing-workspace-bin-output:" + rel);
    if (!fs.lstatSync(donorOutput).isDirectory() || !inside(donor, fs.realpathSync(donorOutput)))
      throw Error("unsafe-workspace-bin-output:" + outputRel);
    const output = path.join(dest, outputRel);
    if (fs.existsSync(output) || fs.lstatSync(output, { throwIfNoEntry: false }))
      throw Error("incomplete-workspace-bin-output:" + outputRel);
    const staging = output + ".pinned-deps-tmp." + process.pid;
    try {
      fs.mkdirSync(staging);
      const args = ["-aH", ...(mode === "hardlink" ? ["--link-dest=" + donorOutput] : []), donorOutput + "/", staging + "/"];
      const result = cp.spawnSync("rsync", args, { stdio: "inherit" });
      if (result.error || result.status !== 0) throw Error("workspace-bin-copy-failed:" + outputRel);
      fs.renameSync(staging, output);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    console.log("snapshotted workspace executable output " + outputRel);
  }
}
' "$_donor" "$_snap" "$_copy_mode" || return 1
    # Donor validity does not imply copied-tree validity. Refuse broken links
    # before stamping success or allowing a child to allocate providers.
    papercusp_pinned_deps_preflight "$_snap" || return 1
  fi

)

# Consume the existing full generation selector and independent materializer.
# No publication or fallback donor copy is allowed on this verifier path.
papercusp_pinned_deps_snapshot_generation_locked() (
  local _donor="$1" _snap="$2" _self="${BASH_SOURCE[0]}"
  local _store _identity _token _input _rel _fingerprint _extra _src _dst _source_device _dest_device _n=0
  _donor="$(cd "$_donor" && pwd -P)" || return 1
  _snap="$(cd "$_snap" && pwd -P)" || return 1
  rm -f -- "$_snap/.papercusp-pinned-deps" || return 1
  source "$(dirname "$_self")/../../../apps/operator/bin/release/dependency-generation.sh" || return 1
  _store="$(dependency_generation_resolve_root "$_donor" '' 1)" || return $?
  dependency_generation_select_inputs "$_snap" "$_store" || return $?
  _identity="$DEPENDENCY_GENERATION_ID"
  _token="$DEPENDENCY_GENERATION_TOKEN"
  _input="$DEPENDENCY_GENERATION_INPUT_FINGERPRINT"
  dependency_generation_acquire_selector_lease "$_store" "$_identity" "${BASHPID:-$$}" "$_token" || return $?
  trap 'dependency_generation_release_copy_lock; dependency_generation_release_selector_lease' EXIT
  dependency_generation_select_prevalidated "$_store" "$_identity" "$_token" || return $?
  _source_device="$(dependency_generation_device "$DEPENDENCY_GENERATION_TREE")" || return 1
  _dest_device="$(dependency_generation_device "$_snap")" || return 1
  if [ "$_source_device" != "$_dest_device" ]; then
    echo "ERROR: verifier dependency generation must be on the snapshot filesystem; refusing another cross-device copy." >&2
    return 74
  fi
  # Even ambient release hardlink opt-ins must not couple verifier bytes.
  DEPENDENCY_GENERATION_ALLOW_HARDLINK=0
  DEPENDENCY_GENERATION_FORCE_COPY=1
  dependency_generation_record_reserve_fs "$_donor"
  while IFS=$'\t' read -r _rel _fingerprint _extra; do
    [ -n "$_rel" ] || continue
    _src="$DEPENDENCY_GENERATION_TREE/$_rel"
    _dst="$_snap/$_rel"
    mkdir -p -- "$(dirname "$_dst")" || return 1
    [ "$(cd "$(dirname "$_dst")" && pwd -P)" = "$(dirname "$_dst")" ] && [ ! -L "$_dst" ] || return 74
    dependency_generation_materialize_tree "$_src" "$_dst" || return $?
    # Directories are private inodes; permit disposable runtime caches without
    # changing any immutable-generation inode or making package files writable.
    find "$_dst" -type d -exec chmod u+w {} + || return 1
    _n=$((_n + 1))
    echo "snapshot progress: completed=$_n tree=$_rel"
  done < "$DEPENDENCY_GENERATION_PATH/.tree-manifest"
  [ "$_n" -gt 0 ] || return 74
  # Only the small generated workspace output closure reads the mutable donor.
  node "$_donor/scripts/npm-install-safe.mjs" --repo-root "$_donor" --exec-under-lock -- \
    bash "$_self" verifier-workspace-outputs "$_donor" "$_snap" copy || return $?
  papercusp_pinned_deps_preflight "$_snap" || return $?
  dependency_generation_select_prevalidated "$_store" "$_identity" "$_token" || return $?
  [ "$(dependency_generation_input_fingerprint "$_snap")" = "$_input" ] || return 74
  {
    printf 'donor=%s\nmode=generation-copy\ntrees=%s\ngeneration=%s\ninput=%s\ntoken=%s\n' "$_donor" "$_n" "$_identity" "$_input" "$_token"
    echo "takenAtUtc=$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  } > "$_snap/.papercusp-pinned-deps" || return 1
)

# Usage: papercusp_pinned_deps_snapshot_locked <donor_root> <snapshot_root>
# The supported entry point: waits for copy capacity outside the donor reader,
# then releases that probe before entering the reader and tries copy admission.
# A race drops the reader and retries. Never hold either lock while waiting for
# the other: generation publishers also take an install reader before copying.
#
# It re-invokes this file as a script under `npm-install-safe.mjs --exec-under-lock`, which is
# that script's own documented reader-side contract, rather than reimplementing the mkdir-lock
# algorithm in scripts/lib/fs-mutex.mjs. Two consequences worth knowing: the lock is keyed off
# the donor root's symlink-resolved real path, so a different checkout is never blocked by it;
# and the wait is bounded by whatever install is in flight, not by our build.
#
# NO SILENT DEGRADATION. If the wrapper is missing we refuse instead of snapshotting unlocked,
# because an unlocked snapshot is the exact artifact this function exists to rule out and it is
# indistinguishable from a good one by inspection.
papercusp_pinned_deps_snapshot_locked() (
  local _donor="${1:-}"
  local _snap="${2:-}"
  local _copy_mode="${3:-hardlink}"
  local _population="${4:-}"
  local _self="${BASH_SOURCE[0]}"
  local _wrapper _attempt=0 _status

  if [ -z "$_donor" ] || [ -z "$_snap" ]; then
    echo "ERROR: papercusp_pinned_deps_snapshot_locked needs <donor_root> <snapshot_root>." >&2
    return 2
  fi

  _wrapper="$_donor/scripts/npm-install-safe.mjs"
  if [ ! -f "$_wrapper" ]; then
    echo "ERROR: cannot take the donor's install mutex — $_wrapper is missing." >&2
    echo "       Refusing to snapshot dependencies unlocked: a snapshot taken while an install" >&2
    echo "       is reifying the donor is torn, and a torn snapshot looks exactly like a good one." >&2
    return 1
  fi

  if [ "$_copy_mode" = copy ]; then
    source "$(dirname "${BASH_SOURCE[0]}")/../../../apps/operator/bin/release/dependency-generation.sh" || return 1
    dependency_generation_record_reserve_fs "$_donor"
    trap dependency_generation_release_copy_lock EXIT
    while [ "$_attempt" -lt 3 ]; do
      _attempt=$((_attempt + 1))
      dependency_generation_acquire_copy_lock "pinned snapshot $_snap" || return $?
      dependency_generation_release_copy_lock
      if node "$_wrapper" --repo-root "$_donor" --exec-under-lock -- \
        bash "$_self" snapshot "$_donor" "$_snap" "$_copy_mode" "$_population" try; then
        return 0
      else
        _status=$?
      fi
      [ "$_status" -eq 76 ] || return "$_status"
      echo "Dependency copy admission raced; donor reader released (attempt $_attempt of 3)." >&2
    done
    return 76
  fi

  node "$_wrapper" --repo-root "$_donor" --exec-under-lock -- \
    bash "$_self" snapshot "$_donor" "$_snap" "$_copy_mode" "$_population"
)

# Usage: papercusp_assert_pinned_deps_decoupled <repo_root> [<allowed_root>] [<mountinfo>]
# Returns 0 when every dependency tree the build will read is backed only by storage inside
# <repo_root> (or inside <allowed_root>, the declared snapshot root). Otherwise prints a
# diagnosis to stderr and returns 1. The caller decides how to fail.
#
# THIS IS THE GATE, and it is the increment-2 shape applied to dependencies: having demanded
# an immutable source sha and a clean source tree, refuse to read dependencies out of a tree
# that ~100 agents are concurrently writing. Nothing checked this before — the release audit,
# the SBOM and the vulnerability scan all inspect the FINISHED bundle, which agrees with
# itself whether or not its inputs were torn.
#
# TWO COUPLING SHAPES ARE CHECKED, because both are reachable from here:
#   1. an overlay whose lowerdir is outside the pinned tree — the r15 workaround's shape, and
#      the one that killed r14;
#   2. a node_modules that is a SYMLINK out of the pinned tree — the cheaper thing a reader
#      reaches for first, and worse than the overlay: the workspace packages' relative links
#      would resolve back into the donor and npm's writes would land there directly.
# A bind mount is caught by the same mountinfo pass as (1), since its field-4 root IS the
# source path when the filesystem is mounted at /.
#
# A PLAIN DIRECTORY PASSES, and that is the point rather than a gap: real dependencies inside
# the pinned tree are decoupled by construction, so the gate fires only on the shapes that
# borrow storage from somewhere else.
#
# PLATFORM: the mount pass reads /proc/self/mountinfo directly rather than shelling to
# findmnt, which does not exist on macOS. Where that file is unreadable the mount axis is
# reported as not applicable and the symlink axis still runs — overlayfs is Linux-only, so on
# a platform without procfs shape (1) cannot exist. That is a statement about the platform,
# not a guess about this tree, which is why it is not treated as "could not tell".
#
# <mountinfo> exists so this gate is TESTABLE — the overlay shape it is built to refuse needs
# root to create, so without an injectable table the only executable coverage would be a
# source grep, and a guard nobody can run against a real fixture is a guard nobody has
# falsified. It is a positional PARAMETER and deliberately not an environment variable: an
# ambient `PAPERCUSP_..._MOUNTINFO=/dev/null` would silently blind a release gate, whereas an
# argument has to be passed by the caller, and the producer is guard-tested to pass exactly
# two. Default is the live table.
papercusp_assert_pinned_deps_decoupled() {
  local _root="${1:-}"
  local _allowed="${2:-}"
  local _mountinfo="${3:-}"
  local _rel _path _target _fail=0

  [ -n "$_mountinfo" ] || _mountinfo=/proc/self/mountinfo

  if [ -z "$_root" ]; then
    echo "ERROR: papercusp_assert_pinned_deps_decoupled needs <repo_root>." >&2
    return 2
  fi

  local _root_real _allowed_real=""
  _root_real="$( cd "$_root" 2>/dev/null && pwd )" || _root_real="$_root"
  if [ -n "$_allowed" ]; then
    _allowed_real="$( cd "$_allowed" 2>/dev/null && pwd )" || _allowed_real="$_allowed"
  fi

  # --- shape 2: a dependency tree that is a symlink out of the pinned tree ---------------
  while IFS= read -r _rel; do
    [ -n "$_rel" ] || continue
    _path="$_root_real/$_rel"
    [ -L "$_path" ] || continue
    _target="$( cd "$(dirname "$_path")" 2>/dev/null && cd "$(readlink "$_path")" 2>/dev/null && pwd )"
    [ -n "$_target" ] || _target="$(readlink "$_path")"
    case "$_target" in
      "$_root_real"/*|"$_root_real") continue ;;
    esac
    if [ -n "$_allowed_real" ]; then
      case "$_target" in
        "$_allowed_real"/*|"$_allowed_real") continue ;;
      esac
    fi
    echo "ERROR: $_rel is a SYMLINK to dependencies outside the pinned tree: $_target" >&2
    _fail=1
  done <<EOF
$(papercusp_pinned_deps_trees "$_root_real")
EOF

  # --- shape 1: an overlay/bind whose backing storage is outside the pinned tree ---------
  if [ ! -r "$_mountinfo" ]; then
    echo "note: skipping the mount check — no $_mountinfo on this platform, where" >&2
    echo "      overlayfs does not exist; the symlink check above still ran." >&2
  else
    local _line
    while IFS= read -r _line; do
      [ -n "$_line" ] || continue
      echo "ERROR: $_line" >&2
      _fail=1
    done <<EOF
$(awk -v root="$_root_real" -v allowed="$_allowed_real" '
  function inside(p, base) {
    return base != "" && (p == base || index(p, base "/") == 1);
  }
  function report(mp, backing) {
    if (inside(backing, root)) return;
    if (allowed != "" && inside(backing, allowed)) return;
    printf "%s is backed by storage OUTSIDE the pinned tree: %s\n", mp, backing;
  }
  {
    # mountinfo: id parent maj:min ROOT MOUNTPOINT OPTIONS [tags...] - FSTYPE SOURCE SUPEROPTS
    sep = 0;
    for (i = 7; i <= NF; i++) if ($i == "-") { sep = i; break; }
    if (!sep) next;
    mountroot = $4; mp = $5; fstype = $(sep + 1); superopts = $(sep + 3);
    if (!inside(mp, root)) next;
    if (mp !~ /node_modules$/) next;
    if (fstype == "overlay") {
      n = split(superopts, opts, ",");
      for (i = 1; i <= n; i++) {
        if (index(opts[i], "lowerdir=") == 1) {
          lowers = substr(opts[i], 10);
          m = split(lowers, lower, ":");
          for (j = 1; j <= m; j++) report(mp, lower[j]);
        }
      }
    } else if (mountroot != "/" && mountroot != "") {
      report(mp, mountroot);
    }
  }
' "$_mountinfo")
EOF
  fi

  [ "$_fail" -eq 0 ] && return 0

  echo "       A release-audited cut may not read dependencies out of a tree other agents are" >&2
  echo "       writing: overlayfs calls a mutating lower layer undefined behaviour, and this is" >&2
  echo "       how r14 died (D-187) — with dependency generation off (D-186) nothing detects it." >&2
  echo "       Snapshot the donor first, then point the pinned tree at the SNAPSHOT:" >&2
  echo "         papercusp_pinned_deps_snapshot_locked <donor_root> <snapshot_root>" >&2
  return 1
}

# Script entry point — sourceable AND runnable. `papercusp_pinned_deps_snapshot_locked` needs
# a command to hand to `--exec-under-lock`, and re-invoking this same file is what keeps the
# locked and unlocked paths from drifting into two implementations.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    snapshot) shift; papercusp_pinned_deps_snapshot "$@" ;;
    snapshot-locked) shift; papercusp_pinned_deps_snapshot_locked "$@" ;;
    snapshot-generation-locked) shift; papercusp_pinned_deps_snapshot_generation_locked "$@" ;;
    verifier-workspace-outputs) shift; papercusp_pinned_deps_workspace_outputs "$@" ;;
    trees) shift; papercusp_pinned_deps_trees "$@" ;;
    preflight) shift; papercusp_pinned_deps_preflight "$@" ;;
    assert) shift; papercusp_assert_pinned_deps_decoupled "$@" ;;
    *)
      echo "usage: $0 {snapshot|snapshot-locked|snapshot-generation-locked|verifier-workspace-outputs|trees|preflight|assert} <args...>" >&2
      exit 2
      ;;
  esac
fi

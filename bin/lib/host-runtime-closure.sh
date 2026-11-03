# shellcheck shell=bash
# Shared production/private runtime package closure. Sourcing performs no build.
HOST_RUNTIME_CLOSURE_POLICY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# lost-pixel eagerly imports odiff-bin's JS wrapper, but our production provider
# calls compareImagesViaPixelmatch directly. odiff 2.6.1's fat package carries
# x64 Linux/Darwin executables even on ARM, including dormant platform-* trees
# and the esy v3 installation store (3/i/.../bin/ODiffBin). postinstall extracts
# that store alongside bin/, so removing only the export/platform trees misses it.
# Preserve the real JS package, version and requester topology; omit only this
# unselected engine's installation/native payload. Never delete arbitrary foreign
# ELF files: the complete target inventory must reject an unexpected runtime dep.
prune_unused_odiff_payload() {
  local pkg_dir="$1"
  [[ "$(node -p 'require(process.argv[1]).name' "$pkg_dir/package.json")" == "odiff-bin" ]] || {
    echo "ERROR: refusing odiff payload prune for a different package: $pkg_dir" >&2
    return 1
  }
  rm -rf "$pkg_dir/bin" "$pkg_dir/_export" "$pkg_dir/3" "$pkg_dir"/platform-* || return 1
  echo "  ✂ odiff-bin: omitted unused native engine; retained eager-import JS wrapper"
}
prune_foreign_prebuilds() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/prebuilds" && -n "$_bare_node_platform" && -n "$_bare_node_arch" ]] || return 0
  local keep="${_bare_node_platform}-${_bare_node_arch}"
  local pd pd_name pruned=0
  for pd in "$pkg_dir/prebuilds"/*/; do
    [[ -d "$pd" ]] || continue
    pd_name="$(basename "$pd")"
    [[ "$pd_name" == "$keep" ]] && continue
    rm -rf "$pd"
    pruned=$((pruned+1))
  done
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned foreign-platform prebuilds/ dir(s), kept $keep"
  return 0
}
# onnxruntime-node does NOT use the prebuilds/<platform>-<arch>/ convention above:
# it ships bin/napi-v6/<platform>/<arch>/{onnxruntime_binding.node,libonnxruntime.so}
# for all 5 platforms (211M). A plain closure-copy therefore (a) bloats the sidecar
# ~6x over what one platform needs, and (b) re-arms WI-807: linuxdeploy ldd-walks
# every ELF under the AppDir and chokes on the foreign-arch linux/arm64 .so, aborting
# `tauri build --bundles appimage`. Same remedy as prune_foreign_prebuilds, different
# layout. (P-009.)
prune_foreign_onnx_bins() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/bin/napi-v6" && -n "$_bare_node_platform" && -n "$_bare_node_arch" ]] || return 0
  local pd pd_name pruned=0
  for pd in "$pkg_dir/bin/napi-v6"/*/; do
    [[ -d "$pd" ]] || continue
    pd_name="$(basename "$pd")"
    if [[ "$pd_name" != "$_bare_node_platform" ]]; then
      rm -rf "$pd"; pruned=$((pruned+1)); continue
    fi
    # keep this platform, drop its foreign ARCH subdirs
    local ad ad_name
    for ad in "$pd"*/; do
      [[ -d "$ad" ]] || continue
      ad_name="$(basename "$ad")"
      [[ "$ad_name" == "$_bare_node_arch" ]] && continue
      rm -rf "$ad"; pruned=$((pruned+1))
    done
  done
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned foreign onnx bin dir(s), kept ${_bare_node_platform}/${_bare_node_arch}"
  return 0
}
# The KEPT platform/arch dir from the prune above still ships ONNX Runtime's GPU
# EXECUTION PROVIDERS — and on linux/x64 that is the single largest file in the
# entire sidecar:
#     libonnxruntime_providers_cuda.so      301M   ← dead weight, on every install
#     libonnxruntime_providers_tensorrt.so  835K   ← same
#     libonnxruntime_providers_shared.so     14K   ← KEEP: the EP-registration shim
#
# Dead weight because nothing in this product ever constructs a GPU session, and
# that is a DECISION, not an oversight:
#   • the embedder is CPU-only ON PURPOSE (EI-19363236885307403). Shipping the
#     provider actively makes CUDA *look* available — it then fails at pipeline
#     construction on `libcudnn.so.9: cannot open shared object file`, because
#     cuDNN 9 is absent and Ubuntu's apt only offers cuDNN 8. See the long note in
#     libs/generic/memory/src/local-embedder-worker.script.mjs.
#   • the one component that CAN target a GPU — the local reranker — is opt-IN
#     (PAPERCUSP_RERANK_DEVICE) *and* verified-load: a provider that fails to
#     construct falls back to the CPU pair (libs/generic/rerank/src/local-engine.ts,
#     `_gpuUnusable` → CPU_EXECUTION_TARGET).
#
# So removing these .so files removes no capability. It swaps one failing provider
# load for another on the SAME already-exercised fallback path, and stops us
# shipping 301M to every user that could never execute on their machine. (WI-38682.)
prune_onnx_gpu_providers() {
  local pkg_dir="$1"
  [[ -d "$pkg_dir/bin/napi-v6" ]] || return 0
  local f freed_kb=0 pruned=0
  while IFS= read -r -d '' f; do
    freed_kb=$(( freed_kb + ( $(stat -c %s "$f" 2>/dev/null || echo 0) / 1024 ) ))
    rm -f "$f"
    pruned=$((pruned+1))
  done < <(find "$pkg_dir/bin/napi-v6" -type f \( \
             -name 'libonnxruntime_providers_cuda.*' -o \
             -name 'libonnxruntime_providers_tensorrt.*' \) -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ $(basename "$pkg_dir"): pruned $pruned GPU execution provider(s), $((freed_kb / 1024))MB (CPU-only by design, EI-19363236885307403)"
  return 0
}
# The backstop for the prune above. prune_onnx_gpu_providers runs PER PACKAGE inside
# the closure walk, so it only ever sees what that walk brought in. Anything that puts
# a GPU provider back into the assembled tree AFTERWARDS would ship hundreds of MB of
# dead weight with nothing failing and no line in the log — a new dependency vendoring
# its own onnxruntime copy, an onnxruntime-node bump adding a provider we do not know
# about, or the prune silently not running because its call site was dropped in a
# refactor. So this scans the ASSEMBLED tree and refuses to build.
#
# Deliberately an ALLOWLIST rather than a denylist of known-bad names: a provider
# nobody has seen before is exactly the case that must stop the line instead of
# shipping silently, and a denylist cannot catch one. libonnxruntime_providers_shared
# (14K) is the EP-registration shim and is REQUIRED — everything else is a GPU
# execution provider this product never constructs a session for. (WI-38682.)
assert_no_onnx_gpu_providers() {
  local root="$1"
  local _gpu_eps="" _ep
  [[ -d "$root" ]] || return 0
  while IFS= read -r -d '' _ep; do
    case "$(basename "$_ep")" in
      libonnxruntime_providers_shared.*) continue ;;
    esac
    _gpu_eps+="         $(( $(stat -c %s "$_ep" 2>/dev/null || echo 0) / 1048576 ))MB  ${_ep#"$root"/}"$'\n'
  done < <(find "$root" -type f -name 'libonnxruntime_providers_*' -print0 2>/dev/null)
  [[ -z "$_gpu_eps" ]] && return 0
  echo "ERROR: ONNX GPU execution provider(s) survived sidecar staging (WI-38682):" >&2
  printf '%s' "$_gpu_eps" >&2
  echo "       This product never constructs a GPU session, so these can never execute on a" >&2
  echo "       user's machine — they are pure install-size bloat. The embedder is CPU-only BY" >&2
  echo "       DESIGN (EI-19363236885307403) and the reranker's GPU path is opt-in AND" >&2
  echo "       verified-load with a CPU fallback, so nothing here is a capability regression." >&2
  echo "       • New provider from an onnxruntime-node bump? Add it to prune_onnx_gpu_providers()." >&2
  echo "       • Vendored by a new dependency? Prune it at the source, like the closure walk does." >&2
  echo "       • Genuinely intend to ship GPU execution? That is a real product decision — make" >&2
  echo "         it deliberately (and it needs the cuDNN 9 story solved first, see the note in" >&2
  echo "         libs/generic/memory/src/local-embedder-worker.script.mjs)." >&2
  return 1
}
# The two owner-confirmed transformers models are intentionally preserved above,
# but model downloaders can leave large `*.tmp.*`, `*.partial`, or `*.part`
# fragments beside the finished ONNX data files after an interrupted download.
# Those fragments are not model bytes and must never cross the assembled-sidecar
# boundary (EI-21121880496840788 / P-008).
# Takes the directory CONTAINING `onnx-community/`. Since D-178 that is the
# package's `models/` dir, not its `.cache/` — the layout beneath is identical,
# so this function is unchanged apart from what it is pointed at.
prune_transformers_model_fragments() {
  local models_root="$1"
  local model_dir
  [[ -d "$models_root/onnx-community" ]] || return 0
  for model_dir in \
    "$models_root/onnx-community/harrier-oss-v1-0.6b-ONNX" \
    "$models_root/onnx-community/embeddinggemma-300m-ONNX"; do
    [[ -d "$model_dir" ]] || continue
    find "$model_dir" -type f \( \
      -name '*.tmp.*' -o -name '*.partial' -o -name '*.part' \
    \) -delete
  done
  return 0
}
# node-gyp SCAFFOLDING carries the build box's absolute paths — and therefore the
# owner's identity — into the shipped bundle (WI-4419). A compiled native module
# needs only its addon binary at build/Release/*.node; everything else node-gyp
# leaves behind (Makefile, binding.Makefile, config.gypi, *.target.mk, the
# Release/.deps/*.o.d dependency lists, obj.target/ objects) embeds
# /home/<user>/... literally. That is what failed the 0.0.13 identity gate: 22
# files across cpu-features/ and ssh2/, every one of them build residue with no
# runtime role.
#
# Prune it at the SOURCE — which is exactly what the gate demands ("prune the
# leaking file from the sidecar copy … never add an exclude here"), because the
# scan deliberately honors no path-exclude list. Runs in EVERY build, not just a
# release: a dev sidecar that differs structurally from the shipped one is how
# this class of leak hides until the release gate. Safe against the dev tree —
# the sidecar holds real COPIES (the closure walker cp's each package), and
# `find -type d` never follows a symlink, so a symlinked package is skipped.
# Vendored TEST FIXTURES have no runtime role, and they are where HOSTILE archives
# live: tar-fs ships test/fixtures/invalid.tar, a tar whose links deliberately
# escape the extraction root (it exists precisely to prove tar-fs rejects it). The
# WI-4419 identity scan correctly refuses to report CLEAN on bytes it could not
# read, so that one vendored fixture failed the 0.0.14 release at minute 22 of a
# 22-minute cut (WI-37620). audit-release-bundle.py now reads tars member-wise and
# is no longer stoppable by such a member — this prune is the other half: the junk
# should not be in what ships at all.
#
# Prune at the SOURCE, per the same doctrine as prune_gyp_build_intermediates
# ("never add an exclude here" — the scan honors no path-exclude list), and in
# EVERY build, so a dev sidecar never differs structurally from the shipped one.
#
# Deliberately NARROW: only `<pkg>/test|tests/fixtures`. A blanket `-name test`
# would also match a legitimately-named PACKAGE (node_modules/test), and a wrong
# prune breaks the app at runtime for a beta tester — far worse than shipping junk.
prune_vendored_test_fixtures() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  local d pruned=0
  while IFS= read -r -d '' d; do
    rm -rf "$d"
    pruned=$((pruned+1))
  done < <(find "$root" -type d \( \
             -path '*/node_modules/*/test/fixtures'  -o \
             -path '*/node_modules/*/tests/fixtures' -o \
             -path '*/node_modules/*/test/fixture'   \) -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ pruned $pruned vendored test-fixture dir(s) (WI-37620: no runtime role, and they carry deliberately-hostile archives)"
  return 0
}
prune_gyp_build_intermediates() {
  local root="$1"
  [[ -d "$root" ]] || return 0
  local bd pruned=0
  while IFS= read -r -d '' bd; do
    rm -rf "$bd/Release/.deps" "$bd/Release/obj.target" "$bd/Release/obj" "$bd/deps"
    rm -f  "$bd/Makefile" "$bd/binding.Makefile" "$bd/config.gypi" "$bd"/*.mk "$bd"/gyp-*-tool
    find "$bd" \( -name '*.target.mk' -o -name '*.o.d' -o -name '*.gypi' \) -type f -delete 2>/dev/null || true
    pruned=$((pruned+1))
  done < <(find "$root" -type d -name build -path '*/node_modules/*' -print0 2>/dev/null)
  [[ $pruned -gt 0 ]] && echo "  ✂ pruned node-gyp build scaffolding from $pruned native-module build/ dir(s) (WI-4419: they embed build-box paths)"
  # ssh2's OPTIONAL native crypto accelerator. The scaffolding prune above
  # deliberately PRESERVES compiled `build/Release/*.node` addons (better-sqlite3
  # has no JS fallback and MUST ship), but this ONE addon has to go: node-gyp
  # compiles it here and the compiler bakes the build-box home path into a
  # .rodata __FILE__ string via an assert() macro. That is a CONTENT leak the
  # stager cannot redact (its scrub skips binaries) and the audit cannot attribute
  # (binary member), so removal is the only mechanism that reaches it — the
  # auditor says exactly this and emits `*/sshcrypto.node` in --tar-excludes.
  # It reached the r12 bundle because packages arrive here via `cp -aL`, which
  # consults no exclude list at all.
  #
  # Safe to drop: ssh2 wraps `require('.../sshcrypto.node')` in try/catch and
  # falls back to pure-JS crypto when it is absent
  # (node_modules/ssh2/lib/protocol/crypto.js). Scoped BY NAME on purpose.
  #
  # The durable class fix — noted as a follow-up in the auditor and NOT done here
  # — is to compile native addons with -ffile-prefix-map (or a neutral node-gyp
  # cache dir) so __FILE__ never captures the box path for ANY addon.
  if ! grep -qF '"ssh2-native-crypto-addon"' "$HOST_RUNTIME_CLOSURE_POLICY_DIR/../audit-release-bundle.py"; then
    echo "ERROR: the auditor no longer carries the ssh2-native-crypto-addon rule — re-check whether this prune is still required (D-178)" >&2
    exit 1
  fi
  local addon_pruned=0 addon
  while IFS= read -r -d '' addon; do
    rm -f "$addon"
    addon_pruned=$((addon_pruned+1))
  done < <(find "$root" -type f -name 'sshcrypto.node' -print0 2>/dev/null)
  [[ $addon_pruned -gt 0 ]] && echo "  ✂ pruned $addon_pruned ssh2 native crypto addon(s) (WI-4419: __FILE__ embeds the build-box path; ssh2 falls back to pure-JS crypto)"
  return 0
}
# Walks a package's dependency closure and copies each package into the sidecar.
#
# It follows dependencies, optionalDependencies and runtime peerDependencies.
# Optional peers may be absent, but installed peers need their own closure too.
# ⚠ It follows BOTH `dependencies` AND `optionalDependencies`, and it must:
# napi/node-gyp packages ship their PLATFORM BINARIES as optionalDependencies —
# that is the convention, not an edge case. sharp is the worst offender:
#     sharp --(optional)--> @img/sharp-linux-x64 --(optional)--> @img/sharp-libvips-linux-x64
# Every hop is optional, so a copier that walks only `dependencies` copies sharp's
# JavaScript and NONE of its native code. The result INSTALLS cleanly and then dies
# at boot with `Could not load the "sharp" module using the linux-x64 runtime` — which
# is exactly how 0.0.9 shipped dead on all three platforms. It survived every check
# because on a dev box the desktop app falls back to a :3070 operator that a beta
# tester does not have; the only thing that sees it is a real install on a clean
# machine. (sharp reaches us transitively via @huggingface/transformers / the ONNX
# voice stack.) Note the musl-strip further down already spoke of "@img/sharp-linuxmusl-*"
# arriving "as optional deps" — it was stripping packages that never got copied.
#
# Resolve a dependency from the package that REQUESTED it, following Node's
# node_modules ancestor search. Falling back to a top-level package by name is not
# equivalent: lost-pixel depends on its nested posthog-node@3.5.0, while this repo
# also carries top-level posthog-node@5.x. The old name-only lookup read 5.x's
# manifest, missed 3.5.0's rusha dependency, and produced a signed Server bundle
# that installed successfully but died on clean-machine boot.
resolve_pkg_source() {
  local pkg="$1" requester="${2:-}" probe parent candidate base
  if [[ -n "$requester" ]]; then
    probe="$requester"
    while :; do
      # Node does not probe node_modules/node_modules while ascending.
      if [[ "$(basename "$probe")" != "node_modules" ]]; then
        candidate="$probe/node_modules/$pkg"
        [[ -d "$candidate" ]] && { printf '%s\n' "$candidate"; return 0; }
      fi
      parent="$(dirname "$probe")"
      [[ "$parent" != "$probe" ]] || break
      probe="$parent"
    done
  fi
  # Entrypoints have no requester. These are the same three install roots the
  # original copier searched, in the same precedence order.
  for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
    [[ -d "$base/$pkg" ]] && { printf '%s\n' "$base/$pkg"; return 0; }
  done
  return 1
}

# Preserve the source node_modules topology in the sidecar. This lets top-level
# and nested versions coexist at the exact paths Node will search at runtime.
pkg_dest_for_source() {
  local src="$1" base rel
  for base in "$WEB_DIR/node_modules" "$REPO_ROOT/node_modules" "$ROOT/node_modules"; do
    case "$src" in
      "$base"/*)
        rel="${src#"$base/"}"
        printf '%s\n' "$SIDECAR_DIR/node_modules/$rel"
        return 0
        ;;
    esac
  done
  echo "ERROR: resolved package source is outside every known node_modules root: $src" >&2
  return 1
}

# npm Arborist retires replaced packages to .<basename>-<8-character hash>
# siblings. Parent copies can bring these abandoned versions into the bundle;
# they are not Node-resolvable package names and have no maintained closure.
# Prune only that npm shape directly under node_modules (including scopes),
# leaving package assets, .bin and the dependency donor untouched.
prune_npm_retired_packages() {
  node - "$1" <<'NODE'
  const fs = require('node:fs');
  const path = require('node:path');
  const retired = /^\..+-[A-Za-z0-9]{8}$/;
  let removed = 0;
  function visit(nodeModulesDir, scope = false) {
    if (!fs.existsSync(nodeModulesDir)) return;
    for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
      const entryPath = path.join(nodeModulesDir, entry.name);
      if (retired.test(entry.name)) {
        fs.rmSync(entryPath, { recursive: true, force: true });
        removed++;
      } else if (entry.isDirectory()) {
        if (!scope && entry.name.startsWith('@')) visit(entryPath, true);
        else visit(path.join(entryPath, 'node_modules'));
      }
    }
  }
  visit(path.join(process.argv[2], 'node_modules'));
  if (removed) console.log(`  ✂ omitted ${removed} npm retirement sibling(s)`);
NODE
}

# A queued row carries name + requesting source + optionality in parallel arrays.
# For optionalDependencies, NOT FOUND is the expected, correct outcome — npm only
# installs the packages matching THIS platform, so @img/sharp-darwin-arm64 is
# legitimately absent on Linux. A missing REQUIRED dep still warns and counts;
# the assembled-tree guard below then fails closed with the complete referrer list.
# Fingerprint exactly the dereferenced package bytes cp -aL reads. Private setup
# checks both sides of each copy; the production donor's install lease remains
# responsible for npm writer exclusion. No file is written in the donor.
fingerprint_runtime_package() {
  node - "$1" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(65536);
function visit(file, relative, ancestors) {
  const real = fs.realpathSync(file), stat = fs.statSync(real);
  hash.update(JSON.stringify([relative, stat.mode & 0o777]));
  if (stat.isDirectory()) {
    if (ancestors.has(real)) throw new Error('cyclic package symlink: ' + file);
    const next = new Set(ancestors).add(real);
    for (const name of fs.readdirSync(real).sort()) visit(path.join(real, name), relative + '/' + name, next);
  } else if (stat.isFile()) {
    const fd = fs.openSync(real, 'r');
    try { let n; while ((n = fs.readSync(fd, buffer)) > 0) hash.update(buffer.subarray(0, n)); }
    finally { fs.closeSync(fd); }
  } else throw new Error('unsupported package member: ' + file);
}
visit(process.argv[2], '', new Set());
console.log(hash.digest('hex'));
NODE
}

copy_pkg_closure() {
  local queue_names=("$1")
  local queue_requesters=("")
  local queue_optional=(0)
  while [[ ${#queue_names[@]} -gt 0 ]]; do
    local cur="${queue_names[0]}"
    local requester_src="${queue_requesters[0]}"
    local optional="${queue_optional[0]}"
    queue_names=("${queue_names[@]:1}")
    queue_requesters=("${queue_requesters[@]:1}")
    queue_optional=("${queue_optional[@]:1}")
    local src=""
    if ! src="$(resolve_pkg_source "$cur" "$requester_src")"; then
      # An optionalDep for another platform is SUPPOSED to be absent here — not a defect.
      [[ "$optional" == 1 ]] && continue
      echo "  ⚠ closure dep '$cur' required by '${requester_src:-<entrypoint>}' not found in its Node resolution path"
      nat_missing=$((nat_missing+1))
      continue
    fi
    # A name-keyed seen-set suppresses distinct nested versions. Source-path
    # identity preserves both while still deduplicating repeat visits.
    case "$_seen" in *"|$src|"*) continue ;; esac
    _seen="${_seen}${src}|"

    local dest=""
    if ! dest="$(pkg_dest_for_source "$src")"; then
      nat_missing=$((nat_missing+1))
      continue
    fi
    # onnxruntime-web is a @huggingface/transformers dependency but is ONLY used
    # on the browser backend — the node path loads onnxruntime-node. A parent
    # package copy can bring its nested directory across before this queue row is
    # visited, so "continue" alone does not skip it: delete its exact mapped
    # destination and then stop traversal. Otherwise 134M of inert wasm/js ships,
    # and the final-tree dependency audit correctly sees its deliberately-omitted
    # browser dependencies as unresolved.
    if [[ "$cur" == "onnxruntime-web" ]]; then
      rm -rf "$dest"
      echo "  ⊘ skipping onnxruntime-web (browser-only backend; node uses onnxruntime-node)"
      continue
    fi
    local source_before=""
    if [[ -n "${HOST_CLOSURE_INPUT_LOG:-}" ]]; then
      source_before="$(fingerprint_runtime_package "$src")" || return 1
    fi
    # A parent `cp -aL` may already have brought a nested dependency directory
    # across. Do not copy it twice, but DO traverse its manifest: skipping the
    # traversal is the exact path by which nested posthog-node lost rusha.
    if [[ ! -e "$dest" ]]; then
      mkdir -p "$(dirname "$dest")"
      cp -aL "$src" "$dest" || return 1
      nat_copied=$((nat_copied+1))
    fi
    if [[ -n "$source_before" ]]; then
      [[ "$source_before" == "$(fingerprint_runtime_package "$src")" ]] || {
        echo "ERROR: dependency donor changed during copy: $src" >&2; return 1;
      }
      printf '%s\t%s\n' "$source_before" "$src" >> "$HOST_CLOSURE_INPUT_LOG" || return 1
    fi
    prune_npm_retired_packages "$dest" || return 1
    # WI-5638 (2026-07-20, revised 2026-07-27): strip runtime model-download
    # scratch — but NOT the two embedding models the desktop app actually
    # needs at runtime. @huggingface/transformers' DEFAULT cacheDir resolves
    # to a path INSIDE its own package dir (src/env.js: `DEFAULT_CACHE_DIR =
    # path.join(dirname__, '/.cache/')` when RUNNING_LOCALLY, which is always
    # true under Node) — there is no env.cacheDir/localModelPath override
    # anywhere in libs/generic/memory, so that in-bundle path is the ONLY
    # place the packaged app looks. A .deb installs its resources tree
    # root-owned/read-only for the running (non-root) user, so "models
    # re-download on first use" — the ORIGINAL assumption behind a blanket
    # `rm -rf .cache` here — does not hold: a stripped harrier/gemma cache
    # cannot be regenerated at runtime, it just breaks local embedding
    # silently. Per owner [owner 2026-07-20, recorded in memory]: the desktop
    # app runs a LIVE HYBRID of the harrier + embeddinggemma embedders (both
    # intentionally bundled, not dead weight) — keep BOTH. Only bge-small
    # (Xenova/bge-small-en-v1.5, 'local' mode) and any other/future scratch
    # under `.cache` is genuinely unused and safe to strip.
    #
    # D-178 (2026-08-29) REVISES the paragraph above on one point. It claimed
    # "there is no env.cacheDir/localModelPath override ... so that in-bundle
    # path is the ONLY place the packaged app looks." The models do NOT have to
    # live under `.cache/` for the runtime to find them, and no override is
    # needed to move them, because the library ships a SECOND resolution root
    # that is enabled by default:
    #
    #   env.cacheDir       -> <pkg>/.cache/   (the forbidden path)
    #   env.localModelPath -> <pkg>/models/   (NOT a .cache path)
    #   env.allowLocalModels = true
    #
    # Both roots take the SAME relative layout — `<repo_id>/<filename>`, with no
    # revision segment for the default revision 'main' (src/utils/hub.js:125-146)
    # — so relocating is a literal `mv`, not a re-layout. Resolution consults the
    # cache first and then falls through to localModelPath (hub.js:270-298), so a
    # bundle with NO `.cache/` at all resolves cleanly from `models/`.
    #
    # Measured on the shipped node build (dist/transformers.node.mjs) with the
    # .cache route neutralised and the network FORBIDDEN (allowRemoteModels=false,
    # so a silent re-download cannot masquerade as success):
    #   models at a non-.cache localModelPath -> full feature-extraction pipeline
    #     loaded, PROBE_FULL=OK dims=[1,768] l2norm=1.0000
    #   same config, empty localModelPath     -> PROBE_FULL=FAIL (correctly)
    # The positive arm ran the FULL pipeline on purpose: ONNX external data
    # (model.onnx_data, 1.2GB) is resolved by onnxruntime relative to the .onnx
    # file, NOT by the transformers hub layer, so a config-only probe would have
    # left the largest artifact untested.
    #
    # WHY THIS MATTERS: the release identity audit forbids `(^|/)\.cache/`
    # outright, on the premise that nothing in a .cache/ is needed to RUN the
    # tree. For this one path that premise was false, so the audit and this build
    # were in direct conflict — one demanding deletion, the other FATAL-ing on
    # absence. Relocating satisfies BOTH at full strength: `.cache/` stays
    # categorically forbidden with no auditor exception, and the weights still
    # ship at a path the runtime already resolves by default. WI-5638's intent is
    # unchanged — both models still ship, still behind a fail-closed guard; only
    # the directory changed.
    local _transformers_cache="$dest/.cache"
    local _transformers_models="$dest/models"
    if [[ "$cur" == "@huggingface/transformers" ]]; then
      if [[ -d "$_transformers_cache" ]]; then
        find "$_transformers_cache" -mindepth 1 -maxdepth 1 ! -name 'onnx-community' -exec rm -rf {} +
        if [[ -d "$_transformers_cache/onnx-community" ]]; then
          find "$_transformers_cache/onnx-community" -mindepth 1 -maxdepth 1 \
            ! -name 'harrier-oss-v1-0.6b-ONNX' ! -name 'embeddinggemma-300m-ONNX' -exec rm -rf {} +
          # Relocate the survivors OUT of .cache/ (D-178). Merge rather than
          # clobber: `models/` may already exist in a future package version.
          mkdir -p "$_transformers_models"
          if [[ -d "$_transformers_models/onnx-community" ]]; then
            echo "ERROR: $_transformers_models/onnx-community already exists — refusing to merge two model roots (D-178)" >&2
            exit 1
          fi
          mv "$_transformers_cache/onnx-community" "$_transformers_models/onnx-community" \
            || { echo "ERROR: failed to relocate transformers models out of .cache (D-178)" >&2; exit 1; }
        fi
      fi
      # EI-22077502575226404: everything above only MOVES weights that a runtime download
      # already put in `.cache/`. A pristine clone + `npm ci` has none — nothing fetches
      # them — so the relocation is a no-op and the fail-closed presence check near the end
      # of this script FATALs, which is how P-101 build #3 died (exit 5). This is the step
      # that can SOURCE them, and it is opt-in: it returns immediately when the models are
      # already staged (every host-tree build) or when PAPERCUSP_TRANSFORMERS_MODEL_CACHE
      # is unset, so the guard's fail-closed behaviour is unchanged for builds that do not
      # ask for it. The `.cache` condition deliberately no longer gates this — that was the
      # bug: with no `.cache` there was no code path at all.
      papercusp_stage_transformers_models "$_transformers_models" || exit 1
      prune_transformers_model_fragments "$_transformers_models"
    fi
    # `.cache/` is now unconditionally removed — including for
    # @huggingface/transformers, whose models were just relocated above. There is
    # no longer any package for which a shipped `.cache/` is legitimate.
    rm -rf "$dest/.cache"
    if [[ "$cur" == "onnxruntime-node" ]]; then
      # D-180: upstream omitted Intel macOS from the pinned registry package.
      # Import only an exact-version, hash-bound upstream source-build closure
      # through the existing native copier; never modify the dependency donor.
      papercusp_verify_transformers_native_target "$REPO_ROOT" "$TARGET_OS" "$TARGET_ARCH" "$dest" "${_transformers_declaration_policy:-exact}" || exit 1
    fi
    prune_foreign_prebuilds "$dest"
    prune_foreign_onnx_bins "$dest"
    prune_onnx_gpu_providers "$dest"
    if [[ "$cur" == "odiff-bin" ]]; then
      prune_unused_odiff_payload "$dest" || return 1
    fi

    local deps
    deps=$(node -e '
      try {
        const p = require(process.argv[1]);
        const optional = new Set(Object.keys(p.optionalDependencies || {}));
        const required = new Set(Object.keys(p.dependencies || {}).filter(name => !optional.has(name)));
        for (const name of Object.keys(p.peerDependencies || {})) {
          if (p.peerDependenciesMeta?.[name]?.optional === true && !required.has(name)) optional.add(name);
          else if (!optional.has(name)) required.add(name);
        }
        process.stdout.write([...required, ...[...optional].map(name => `?${name}`)].join(" "));
      } catch {}
    ' "$src/package.json" 2>/dev/null)
    local d dep_optional
    for d in $deps; do
      dep_optional=0
      if [[ "$d" == '?'* ]]; then dep_optional=1; d="${d#\?}"; fi
      queue_names+=("$d")
      queue_requesters+=("$src")
      queue_optional+=("$dep_optional")
    done
  done
}

# Explicit externals are runtime package roots even when they contain no native
# addon. Reuse the bundler's list so a new boundary (for example OpenTelemetry)
# cannot silently depend on the build checkout's ancestor node_modules.
copy_host_external_closures() {
  local external package
  local -a closure_externals=("${HOST_COMMON_EXTERNALS[@]}")
  if declare -p HOST_EXTERNALS >/dev/null 2>&1; then closure_externals=("${HOST_EXTERNALS[@]}"); fi
  for external in "${closure_externals[@]}"; do
    package="${external#--external:}"
    case "$package" in *\**|*\?*) continue ;; esac
    if [[ "$package" == @*/* ]]; then
      package="$(printf '%s' "$package" | cut -d/ -f1-2)"
    else
      package="${package%%/*}"
    fi
    # Platform-only optional externals may be absent from the source install.
    # Required imports are still enforced by the final isolated boot probe.
    if resolve_pkg_source "$package" "" >/dev/null 2>&1; then
      copy_pkg_closure "$package" || return 1
    fi
  done
}

# Exercise the production tracing composition without starting PRIMARY, DBOS,
# a listener, a database or an exporter. DBOS's legacy provider is a fallback
# only when this context probe fails. Keep this proof separate from boot proof.
assert_host_default_trace_context() {
  local run="$1" entry="$1/build-state/trace-context-entry.mjs"
  [[ "${DBOS__CLOUD:-}" != true ]] || {
    echo 'ERROR: private default-host assembly does not qualify DBOS Cloud/OTLP' >&2; return 1;
  }
  node - "$REPO_ROOT" "$entry" <<'NODE' || return 1
const fs = require('node:fs'), path = require('node:path');
const [root, entry] = process.argv.slice(2);
const host = fs.readFileSync(path.join(root, 'apps/operator/bin/host-bootstrap.ts'), 'utf8');
const before = host.indexOf('initializeRuntimeObservability();');
if (before < 0 || host.indexOf('await startDbos();') <= before)
  throw new Error('unqualified host tracing/DBOS startup order');
const sdk = path.join(root, 'node_modules/@dbos-inc/dbos-sdk/dist/src');
const launch = fs.readFileSync(path.join(sdk, 'dbos.js'), 'utf8');
if (!/if\s*\(!\(0,\s*traces_1\.isTraceContextWorking\)\(\)\)\s*\(0,\s*traces_1\.installTraceContextManager\)/.test(launch))
  throw new Error('unqualified DBOS legacy-provider fallback');
const bootstrap = fs.readFileSync(path.join(root, 'packages/operator-core/lib/dbos/bootstrap.ts'), 'utf8');
if (/enableOTLP\s*:/.test(bootstrap)) throw new Error('explicit DBOS OTLP needs separate closure qualification');
fs.writeFileSync(entry, `import { createTracing } from ${JSON.stringify(path.join(root, 'packages/operator-core/lib/observability/tracing.ts'))};
import { globalParams } from ${JSON.stringify(path.join(sdk, 'utils.js'))};
import { isTraceContextWorking } from ${JSON.stringify(path.join(sdk, 'telemetry/traces.js'))};
const runtime = createTracing();
const registration = runtime.register();
globalParams.tracingEnabled = true;
const contextWorking = isTraceContextWorking();
registration.disable();
await runtime.provider.shutdown();
if (!registration.registered || !contextWorking) throw new Error('production tracing context unavailable');
console.log(JSON.stringify({schemaVersion:'private-default-trace-context-v1',contextWorking,registered:registration.registered,otlp:false,primaryStarted:false}));
`);
NODE
  bundle_host_run_step trace-context-compile bundle_host_esbuild "$REPO_ROOT" "$entry" \
    --bundle --platform=node --format=esm --target=node22 --banner:js="$HOST_BANNER" \
    "${HOST_BANNER_DEFINES[@]}" "${HOST_EXTERNALS[@]}" \
    --outfile="$SIDECAR_DIR/.assembly-trace-context.mjs" || return 1
  node "$SIDECAR_DIR/.assembly-trace-context.mjs" > "$run/trace-context.json" || return 1
  rm "$SIDECAR_DIR/.assembly-trace-context.mjs"
}

# Use INPUT edges, not just output import kinds: esbuild represents both an
# optional CommonJS loader and a mandatory require as require-call. Optional
# manifest peers and the measured default DBOS composition remain optional;
# any other occurrence of the same package keeps the union mandatory.
write_host_graph_dependency_census() {
  node - "$REPO_ROOT" "$1" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), {isBuiltin} = require('node:module');
const [root, run] = process.argv.slice(2);
const ts = require(path.join(root, 'node_modules/typescript'));
const rows = new Map(), edges = [], parsed = new Map();
const packageName = value => value.startsWith('@') ? value.split('/').slice(0,2).join('/') : value.split('/')[0];
const bare = imp => imp.external && imp.path !== '<runtime>' && !isBuiltin(imp.path) && !imp.path.startsWith('.') && !imp.path.startsWith('/');
const traceFile = path.join(run, 'trace-context.json');
const trace = fs.existsSync(traceFile) ? JSON.parse(fs.readFileSync(traceFile)) : null;
function optional(source, imp) {
  if (!['require-call','dynamic-import'].includes(imp.kind)) return false;
  let dir = path.dirname(source);
  while (dir !== root && dir !== path.dirname(dir)) {
    const manifestFile = path.join(dir, 'package.json');
    if (fs.existsSync(manifestFile)) {
      const p = JSON.parse(fs.readFileSync(manifestFile));
      if (p.optionalDependencies?.[packageName(imp.path)] || p.peerDependenciesMeta?.[packageName(imp.path)]?.optional === true)
        return true;
      // ESM/CJS format markers inside dist/ do not own package dependencies.
      // Stop at the actual package, including one with no declared imports.
      if (p.name || p.version || p.dependencies || p.optionalDependencies || p.peerDependencies) break;
    }
    dir = path.dirname(dir);
  }
  const logicalSdk = path.join(root, 'node_modules/@dbos-inc/dbos-sdk/dist/src/telemetry');
  const sdk = fs.existsSync(logicalSdk) ? fs.realpathSync(logicalSdk) + path.sep : null;
  if (imp.kind !== 'require-call' || !sdk || !fs.realpathSync(source).startsWith(sdk) || !imp.path.startsWith('@opentelemetry/')) return false;
  if (!parsed.has(source)) parsed.set(source, ts.createSourceFile(source, fs.readFileSync(source, 'utf8'), ts.ScriptTarget.Latest, true));
  const file = parsed.get(source), calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'require'
        && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === imp.path) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return calls.length > 0 && calls.every(call => {
    for (let node = call; node.parent; node = node.parent) {
      if (imp.path === '@opentelemetry/sdk-trace-base' && ts.isFunctionDeclaration(node)
          && node.name?.text === 'installTraceContextManager' && trace?.schemaVersion === 'private-default-trace-context-v1'
          && trace.registered === true && trace.contextWorking === true && trace.otlp === false) return true;
      if (ts.isBlock(node.parent)) {
        for (const statement of node.parent.statements) {
          if (statement.pos >= node.pos) break;
          if (!ts.isIfStatement(statement) || statement.expression.getText(file).replace(/\s/g, '') !== '!utils_1.globalParams.enableOTLP') continue;
          const body = statement.thenStatement;
          if (trace?.otlp === false && (ts.isReturnStatement(body) || ts.isBlock(body) && ts.isReturnStatement(body.statements.at(-1)))) return true;
        }
      }
    }
    return false;
  });
}
function add(source, imp) {
  if (!bare(imp) || packageName(imp.path) === 'onnxruntime-web') return;
  const name = packageName(imp.path);
  const required = !optional(source, imp);
  rows.set(name, rows.get(name) === true || required);
  edges.push({source:path.relative(root,source),specifier:imp.path,kind:imp.kind,required});
}
function visit(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file = path.join(dir,entry.name);
    if (entry.isDirectory()) { if(entry.name !== 'node_modules') visit(file); }
    else if (entry.name.endsWith('.meta.json')) {
      const data = JSON.parse(fs.readFileSync(file)), inputEdges = new Set();
      for (const [input, info] of Object.entries(data.inputs || {})) {
        const source = [path.resolve(root,input),path.resolve(root,'apps/operator',input)].find(p => fs.existsSync(p));
        if (!source) throw new Error('missing metafile input: ' + input);
        for (const imp of info.imports || []) {
          if (bare(imp)) { add(source,imp); inputEdges.add(imp.path + ':' + imp.kind); }
        }
      }
      for (const output of Object.values(data.outputs || {})) for (const imp of output.imports || [])
        if (bare(imp) && !inputEdges.has(imp.path + ':' + imp.kind)) add(file,imp);
    }
  }
}
visit(path.join(run,'artifact')); visit(path.join(run,'build-meta'));
if (!rows.size) throw new Error('empty external dependency census');
fs.writeFileSync(path.join(run,'graph-imports.json'),JSON.stringify(edges)+'\n');
for (const [name,required] of [...rows].sort()) console.log((required?'required':'optional')+'\t'+name);
NODE
}

# Class-level backstop: inspect every actual package in the ASSEMBLED sidecar and
# resolve every required dependency using only that tree. This does not replace
# the clean-root boot gate (which exercises the real artifact); it catches the
# dependency class immediately at staging time and names every broken referrer.
assert_runtime_dependency_closure() {
  local root="$1"
  [[ -d "$root/node_modules" ]] || {
    echo "ERROR: assembled sidecar has no node_modules directory" >&2
    return 1
  }
  node - "$root" <<'NODE'
  const fs = require('node:fs');
  const path = require('node:path');

  const root = path.resolve(process.argv[2]);
  const nodeModulesRoot = path.join(root, 'node_modules');
  const visited = new Set();
  const failures = new Set();
  // This package is deliberately deleted by copy_pkg_closure: the packaged
  // operator is Node-only and uses onnxruntime-node, while onnxruntime-web is a
  // browser backend whose 134M wasm payload cannot execute here. Keep the
  // exception exact; every other required dependency remains fail-closed.
  const intentionallyOmitted = new Set(['onnxruntime-web']);

  function isDirectory(candidate) {
    try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
  }

  function isInsideRoot(candidate) {
    return candidate === root || candidate.startsWith(`${root}${path.sep}`);
  }

  function dependencyDir(fromPackage, dependency) {
    let cursor = fromPackage;
    while (isInsideRoot(cursor)) {
      if (path.basename(cursor) !== 'node_modules') {
        const candidate = path.join(cursor, 'node_modules', ...dependency.split('/'));
        if (fs.existsSync(path.join(candidate, 'package.json'))) {
          if (!isInsideRoot(fs.realpathSync(candidate))) {
            failures.add(candidate + ' -> dependency symlink escapes assembled root');
            return null;
          }
          return candidate;
        }
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return null;
  }

  function visitPackage(packageDir) {
    const logicalDir = path.resolve(packageDir);
    if (visited.has(logicalDir)) return;
    visited.add(logicalDir);
    if (!isInsideRoot(fs.realpathSync(logicalDir))) {
      failures.add(logicalDir + ' -> package symlink escapes assembled root');
      return;
    }

    const manifestPath = path.join(logicalDir, 'package.json');
    if (!fs.existsSync(manifestPath)) return;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      failures.add(`${path.relative(nodeModulesRoot, logicalDir)} -> invalid package.json (${error.message})`);
      return;
    }

    const optional = new Set(Object.keys(manifest.optionalDependencies || {}));
    const required = new Set(Object.keys(manifest.dependencies || {}).filter(
      dependency => !optional.has(dependency) && !intentionallyOmitted.has(dependency),
    ));
    for (const dependency of Object.keys(manifest.peerDependencies || {})) {
      if (!optional.has(dependency) && !intentionallyOmitted.has(dependency)
          && manifest.peerDependenciesMeta?.[dependency]?.optional !== true) required.add(dependency);
    }
    const label = `${path.relative(nodeModulesRoot, logicalDir)}@${manifest.version || 'unknown'}`;
    for (const dependency of required) {
      if (!dependencyDir(logicalDir, dependency)) failures.add(`${label} -> ${dependency}`);
    }

    visitNodeModules(path.join(logicalDir, 'node_modules'));
  }

  function visitNodeModules(nodeModulesDir) {
    if (!isDirectory(nodeModulesDir)) return;
    for (const entry of fs.readdirSync(nodeModulesDir)) {
      if (entry === '.bin') continue;
      const entryPath = path.join(nodeModulesDir, entry);
      if (!isDirectory(entryPath)) continue;
      if (entry.startsWith('@')) {
        for (const scopedEntry of fs.readdirSync(entryPath)) {
          const scopedPath = path.join(entryPath, scopedEntry);
          if (isDirectory(scopedPath)) visitPackage(scopedPath);
        }
      } else {
        visitPackage(entryPath);
      }
    }
  }

  visitNodeModules(nodeModulesRoot);
  if (failures.size > 0) {
    console.error(`ERROR: ${failures.size} unresolved runtime dependencies in assembled sidecar:`);
    for (const failure of [...failures].slice(0, 100)) console.error(`  - ${failure}`);
    if (failures.size > 100) console.error(`  - ... ${failures.size - 100} more`);
    process.exit(1);
  }
  console.log(`  ✓ runtime dependency closure resolved inside sidecar (${visited.size} packages checked)`);
NODE
}

copy_host_runtime_require_closures() {
  # The installed Codex resume path runs inside the packaged PSU sidecar.
  # psu-pty-host.mjs loads @iarna/toml through createRequire(import.meta.url),
  # so the launcher keeps it external and this copier must place its real
  # package closure beside the sidecar entrypoints.
  echo "→ copying createRequire runtime dep @iarna/toml (+ closure) into the sidecar"
  copy_pkg_closure @iarna/toml || return 1
  echo "  @iarna/toml closure copied ($nat_copied total package(s), $nat_missing missing)"

  # rrule is loaded at runtime via `createRequire(import.meta.url)('rrule')` in
  # operator-core/lib/harness/routines/schedule-next.ts (rrule's CJS build sets
  # __esModule:true with NO `default`, so every static-import form diverges between
  # the tsx dev host and the esbuild bundle — createRequire is the only form that
  # works in both). esbuild can't see a dynamic createRequire, so it never inlines
  # rrule, and it is pure-JS (not in NATIVE_PKGS) so it was never copied either —
  # the bundled operator then crashed at boot with `Cannot find module 'rrule'`
  # (EMBEDDED_PG_FAILED). Copy rrule + its dep closure (tslib) so the runtime
  # createRequire('rrule') from sidecar/serve.mjs resolves.
  echo "→ copying createRequire runtime dep rrule (+ closure) into the sidecar"
  copy_pkg_closure rrule || return 1
  echo "  rrule closure copied ($nat_copied total package(s), $nat_missing missing)"
  
  # luxon — IDENTICAL createRequire gotcha as rrule above. schedule-next.ts loads
  # `createRequire(import.meta.url)('luxon')` (DST-correct schedule math; landed
  # 2026-06-17 in 5472dec3c, the scheduled-plans EI-1368/136 fixes — which did NOT
  # add this copy line). esbuild can't see the dynamic createRequire, luxon is
  # pure-JS (no deps, not in NATIVE_PKGS) so it was never copied → the packaged
  # operator crashed at boot with `Cannot find module 'luxon'` (EMBEDDED_PG_FAILED),
  # i.e. the .deb did not boot at all. Copy luxon so the runtime createRequire('luxon')
  # from sidecar/serve.mjs resolves. (shared-pot-release-testing Lane A, A-001.)
  echo "→ copying createRequire runtime dep luxon (+ closure) into the sidecar"
  copy_pkg_closure luxon || return 1
  echo "  luxon closure copied ($nat_copied total package(s), $nat_missing missing)"
  
  # Design comparison loads these packages through createRequire so the same
  # implementation works in the unbundled operator and the packaged sidecar.
  # esbuild cannot see those runtime calls; copy the three package roots (a root
  # copy also covers lost-pixel/package.json and lost-pixel/dist/* subpaths).
  echo "→ copying createRequire runtime deps lost-pixel, pixelmatch, pngjs (+ closures) into the sidecar"
  copy_pkg_closure lost-pixel || return 1
  copy_pkg_closure pixelmatch || return 1
  copy_pkg_closure pngjs || return 1
  echo "  design-compare closures copied ($nat_copied total package(s), $nat_missing missing)"
  
  # EI-19981394187273902 (2026-08-09) — IDENTICAL createRequire gotcha as rrule/luxon
  # above, caught by the sidecar-createrequire-bundling.test.ts recurrence guard
  # (EI-1589). device-push-dispatcher.ts loads BOTH
  # `createRequire(import.meta.url)('google-auth-library')` (FCM push — signs a
  # service-account JWT) AND `createRequire(import.meta.url)('jose')` (APNs push —
  # signs the ES256 provider JWT). Both are pure-JS (not in NATIVE_PKGS), so esbuild
  # can't see the dynamic createRequire and never inlined either — the packaged
  # operator would crash at boot with `Cannot find module 'google-auth-library'` (or
  # 'jose') the first time a push dispatch actually ran. Copy both (+ closures) so
  # the runtime createRequire(...) calls from sidecar/serve.mjs resolve.
  echo "→ copying createRequire runtime deps google-auth-library, jose (+ closures) into the sidecar"
  copy_pkg_closure google-auth-library || return 1
  copy_pkg_closure jose || return 1
  echo "  google-auth-library/jose closures copied ($nat_copied total package(s), $nat_missing missing)"

  # Equity compilation uses an opaque createRequire and require.resolve to read
  # the pinned compiler and Solidity dependency sources at runtime.
  copy_pkg_closure solc || return 1
  copy_pkg_closure @openzeppelin/contracts || return 1

  # The plan execution guard parses shell commands through an opaque
  # createRequire loader. esbuild cannot inline it; ship the parser at the
  # existing runtime dependency boundary so installed hosts stay self-contained.
  copy_pkg_closure shell-quote || return 1
  
}

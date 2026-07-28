#!/usr/bin/env bash
# build-appimage.sh — WI-2918.
#
# THE PROBLEM
# -----------
# `tauri build --bundles appimage` runs linuxdeploy across the WHOLE AppDir.
# linuxdeploy recursively "deploys dependencies" for every ELF it finds — which
# includes our large, self-contained sidecar tree (bundled node, code-server's
# node_modules native addons, @anthropic-ai/sandbox-runtime's static + FOREIGN-ARCH
# (arm64) seccomp helpers, libsql, the claude agent binary, …). It hits
# `patchelf ... cannot find section .dynamic` on the static/foreign binaries and
# then hard-CRASHES: `terminate ... Failed to run ldd: exited with code 1` (exit
# 127). No .AppImage is produced. Because `appimage` is one of the tauri.conf
# bundle targets, that non-zero exit ALSO fails the whole `tauri build`, blocking
# the entire Linux release cut — not just the updater artifact.
#
# THE FIX
# -------
# By the time linuxdeploy crashes it has ALREADY done the useful part: the AppDir
# is complete (main binary + all gtk/webkit libs deployed into usr/lib + AppRun +
# desktop + icon). Its ONLY remaining (broken) work was the pointless ELF-scan of
# the self-contained sidecar — which must not be patchelf'd anyway. So we let tauri
# create the AppDir (ignore the linuxdeploy crash), then finish the job ourselves:
# supply the root icon appimagetool wants, and package the AppDir with appimagetool
# directly (appimagetool just squashfs-packs the tree — it does NOT ELF-scan, so it
# can't hit the crash). The resulting AppImage self-hosts identically to the .deb
# (verified on the clean-room VM 2026-07-05: sidecar resolves from the AppImage
# mount, operator + embedded-PG come up).
#
# Env (inherited from release-local.sh; all optional here):
#   PAPERCUSP_BUILD_SHA / PAPERCUSP_BUILD_VERSION  — build provenance (baked in)
#   TAURI_SIGNING_PRIVATE_KEY / _PASSWORD          — sign the AppImage for the updater
set -uo pipefail   # deliberately NOT -e: the tauri appimage step is EXPECTED to fail
DESK="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DESK"

CT="$(cd src-tauri && cargo metadata --no-deps --format-version 1 2>/dev/null \
        | python3 -c 'import sys,json; print(json.load(sys.stdin)["target_directory"])' 2>/dev/null)"
[ -n "$CT" ] || CT="$HOME/.cargo-target"
APPIMG_DIR="$CT/release/bundle/appimage"
VERSION="$(python3 -c 'import json;print(json.load(open("src-tauri/tauri.conf.json"))["version"])')"
AUDIT_PY="$DESK/bin/audit-release-bundle.py"

# 0. PURGE any stale AppDir from a PRIOR build BEFORE tauri runs (WI-4736 / EI-11730).
#    A leftover *.AppDir from an OLDER sidecar can ship the mac-VM sudo/login passwords +
#    build-box identity inside its rendered docs, even though the .deb (packed straight
#    from the clean sidecar in the same cut) carries NONE of it.
#    NOTE (su-b0fbf 2026-07-14): wiping the AppDir is NECESSARY BUT NOT SUFFICIENT — see
#    step 0b. In 0.0.9 cut#3d a mtime-FRESH AppDir (built AFTER this purge) still carried
#    339 leaking files, because `tauri build --bundles appimage` REFILLS the AppDir from
#    the staged resource intermediate under $CT/release/ (step 0b), NOT from
#    src-tauri/sidecar/ directly. The fail-closed identity scan in step 3d is the backstop.
echo "==> purging any stale AppDir under $APPIMG_DIR (WI-4736: a reused stale AppDir ships an un-pruned/leaky sidecar)"
rm -rf "$APPIMG_DIR"/*.AppDir

# 0b. Opportunistic DISK HYGIENE (NOT the leak fix — see step 2b). The tauri release
#     resource-staging dirs $CT/release/{sidecar,seed,resources} are copy-into-never-delete,
#     so they accumulate the union of past cuts (this box's $CT/release/sidecar was 11G,
#     holding a month-stale code-server + meridian-host). Wiping them reclaims ~15G on a
#     disk-pressured builder. NOTE (su-b0fbf 2026-07-14, EI-11730): wiping these does NOT by
#     itself stop the AppImage leak — proven, a fresh AppDir built AFTER this wipe still
#     carried 339 files. tauri sources the AppDir sidecar from an opaque path (two relocated
#     target trees are in play: $CT -> /mnt/data/.../cargo-target and the src-tauri/target
#     symlink -> /mnt/data/.../papercusp-desktop-src-tauri-target). The guaranteed fix is the
#     correct-by-construction force-sync in step 2b, below.
echo "==> purging tauri resource-staging intermediates under $CT/release (EI-11730: disk hygiene, reclaims ~15G — does NOT by itself fix the leak; see step 2b)"
rm -rf "$CT/release/sidecar" "$CT/release/seed" "$CT/release/resources" 2>/dev/null || true

# 1. Let tauri build the AppDir + deploy the gtk/webkit libs. linuxdeploy crashes
#    at the sidecar ELF-scan (see header) — we IGNORE that and finish below.
#
#    Invoke the CLI through `npx -p @tauri-apps/cli@<pinned>`, exactly as every leg
#    in release-local.sh does — NOT `npm run tauri`. The npm-script form resolves
#    `tauri` from node_modules/.bin, which exists only where the desktop workspace's
#    devDependencies were installed; the RELEASE checkout (papercup-release) never
#    installs them, so the 0.0.13 cut died right here with `sh: 1: tauri: not found`
#    and then "FATAL: no AppDir" — a whole release lost to a build-host install
#    detail. npx fetches the pinned CLI on demand, so this step no longer depends
#    on which checkout it runs in.
TAURI_CLI_VERSION="${PAPERCUSP_TAURI_CLI_VERSION:-${TAURI_CLI_VERSION:-2.11.0}}"
echo "==> tauri build --bundles appimage (the linuxdeploy sidecar-scan crash is EXPECTED and ignored)"
PAPERCUSP_BUILD_SHA="${PAPERCUSP_BUILD_SHA:-}" PAPERCUSP_BUILD_VERSION="${PAPERCUSP_BUILD_VERSION:-$VERSION}" \
  npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri build --bundles appimage \
  || echo "   (tauri appimage step exited non-zero as expected — finishing with appimagetool)"

# 2. Locate the AppDir tauri produced (GUI bundle).
APPDIR="$(ls -d "$APPIMG_DIR"/*.AppDir 2>/dev/null | grep -vi server | head -1)"
[ -n "$APPDIR" ] && [ -d "$APPDIR" ] || { echo "FATAL: no AppDir under $APPIMG_DIR — tauri didn't get far enough" >&2; exit 1; }
echo "==> finishing AppDir: $APPDIR"

# 2b. THE LEAK FIX (EI-11730, su-b0fbf 2026-07-14) — correct-by-construction.
#     tauri's appimage bundler populates the AppDir's bundled sidecar from an opaque
#     staging path that, UNLIKE the .deb, accumulates dropped trees (code-server,
#     meridian-host) + pre-prune docs across cuts. Wiping the AppDir (step 0) AND the
#     $CT/release/* staging (step 0b) both PROVED INSUFFICIENT — a fresh AppDir still
#     carried 339 leaking files, sourced from a location neither wipe controls (two
#     relocated target trees confound it). So instead of chasing tauri's copy source, we
#     make the shipped bytes a PURE FUNCTION of the single source of truth: rsync --delete
#     the freshly pruned+identity-scanned src-tauri/sidecar/ over the AppDir's sidecar.
#     After this the AppDir sidecar EQUALS the clean .deb sidecar exactly — anything tauri
#     staged that is absent from the clean source (code-server, meridian-host, stale docs)
#     is deleted here. The step-3d scan then validates the result as a fail-closed backstop.
#     tauri.conf bundle.resources = [sidecar/**, resources/*, seed/**], so the AppDir
#     carries THREE sibling resource trees under usr/lib/<product>/ (sidecar, resources,
#     seed) — the leak spanned sidecar/ AND seed/ (a stale corestore/db/LOG). Force-sync
#     EACH from its clean src-tauri/<name>/ source; if a source is gone but the AppDir has
#     a stale tree (e.g. a dropped resource), delete it outright.
APPDIR_SIDECAR="$(ls -d "$APPDIR"/usr/lib/*/sidecar 2>/dev/null | head -1)"
if [ -z "$APPDIR_SIDECAR" ] || [ ! -d "$APPDIR_SIDECAR" ]; then
  echo "FATAL: no bundled sidecar under $APPDIR/usr/lib/*/sidecar — tauri bundle incomplete" >&2; exit 1
fi
LIBDIR="$(dirname "$APPDIR_SIDECAR")"   # $APPDIR/usr/lib/<product>
for _res in sidecar resources seed; do
  _src="$DESK/src-tauri/$_res"
  _dst="$LIBDIR/$_res"
  [ -e "$_dst" ] || continue           # AppDir doesn't carry this resource → nothing to fix
  if [ -d "$_src" ]; then
    echo "==> force-syncing AppDir/$_res to the clean src-tauri/$_res (EI-11730: correct-by-construction)"
    rsync -a --delete "$_src"/ "$_dst"/
    echo "   AppDir/$_res now mirrors the clean source ($(du -sh "$_dst" 2>/dev/null | cut -f1))"
  else
    echo "==> AppDir carries /$_res but src-tauri/$_res is absent — removing the stale tree (EI-11730)"
    rm -rf "$_dst"
  fi
done

# 3. appimagetool requires the desktop file's Icon=<name> to exist as <name>.png at
#    the AppDir ROOT. linuxdeploy names the root icon after the productName, but the
#    .desktop uses the binary/icon name — so copy the largest bundled icon into place.
ICON_NAME="$(grep -h -oP '^Icon=\K.*' "$APPDIR"/*.desktop 2>/dev/null | head -1)"
if [ -n "$ICON_NAME" ] && [ ! -f "$APPDIR/$ICON_NAME.png" ]; then
  ICON_SRC="$(find "$APPDIR/usr/share/icons" -name "$ICON_NAME.png" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$ICON_SRC" ]; then cp "$ICON_SRC" "$APPDIR/$ICON_NAME.png"; echo "   root icon: $ICON_NAME.png (from $ICON_SRC)"; fi
fi

# 3b. Replace linuxdeploy's compiled AppRun with a robust shell AppRun (WI-2902).
#     linuxdeploy's ELF AppRun NULL-derefs in libc on some hosts (`segfault at 0,
#     error 4, in libc.so.6`) — it crashes the launch before the app ever starts,
#     even though the app BINARY runs fine given LD_LIBRARY_PATH + the WebKitGTK env.
#     Verified on the clean-room VM 2026-07-06: with this shell AppRun the AppImage
#     launches, the operator + embedded-PG come up, and the SPA renders. The script
#     sets the full GTK/WebKit env off $APPDIR (pixbuf loaders, gio TLS modules,
#     gstreamer, the webkit helper-process path) and execs the binary — the standard
#     AppImage AppRun pattern. Overwrite in place (the AppDir is a fresh build
#     artifact; no need to keep the crashing compiled one).
echo "==> replacing compiled AppRun with shell AppRun (linuxdeploy AppRun segfaults in libc; WI-2902)"
cat > "$APPDIR/AppRun" <<'APPRUN'
#!/bin/bash
# Robust shell AppRun (replaces linuxdeploy's crashing compiled AppRun) — WI-2902.
HERE="$(dirname "$(readlink -f "${0}")")"
export APPDIR="${APPDIR:-$HERE}"
export LD_LIBRARY_PATH="$HERE/usr/lib:$HERE/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$HERE/usr/bin:$PATH"
export XDG_DATA_DIRS="$HERE/usr/share:${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"
# gdk-pixbuf image loaders
_pbcache="$(ls "$HERE"/usr/lib/gdk-pixbuf-*/*/loaders.cache 2>/dev/null | head -1)"
[ -n "$_pbcache" ] && export GDK_PIXBUF_MODULE_FILE="$_pbcache"
# gio modules (tls etc.)
for _gio in "$HERE/usr/lib/x86_64-linux-gnu/gio/modules" "$HERE/usr/lib/gio/modules"; do
  [ -d "$_gio" ] && export GIO_MODULE_DIR="$_gio" && break
done
# gstreamer (webkit media)
[ -d "$HERE/usr/lib/gstreamer-1.0" ] && export GST_PLUGIN_SYSTEM_PATH_1_0="$HERE/usr/lib/gstreamer-1.0"
# WebKitGTK helper-process exec path (network/web process live beside the lib)
for _wk in "$HERE/usr/libexec/webkit2gtk-4.1" "$HERE/usr/lib/webkit2gtk-4.1" "$HERE/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1"; do
  [ -d "$_wk" ] && export WEBKIT_EXEC_PATH="$_wk" && break
done
# single-process webkit sandbox off (AppImage helper processes can't sandbox)
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"
exec "$HERE/usr/bin/papercusp-desktop" "$@"
APPRUN
chmod +x "$APPDIR/AppRun"

# 3c. RELATIVIZE any absolute symlink whose target points INSIDE the AppDir.
#     linuxdeploy creates the AppDir-root `.DirIcon` and `<productName>.desktop`
#     symlinks with ABSOLUTE targets (/home/<builder>/.cargo-target/.../*.AppDir/…),
#     which appimagetool packs into the squashfs VERBATIM — leaking the build-box
#     home path + username into every shipped AppImage (WI-4736). The identity
#     scan in 3d CANNOT catch these: grep -rIlE never reads a symlink's target.
#     Rewrite each as a path RELATIVE to the symlink's own directory so the packed
#     AppImage carries no absolute build path AND the link still resolves at the
#     user's mount point.
echo "==> relativizing absolute in-AppDir symlinks (strip build-box path from .DirIcon/.desktop; WI-4736)"
_appdir_abs="$(cd "$APPDIR" && pwd)"
while IFS= read -r -d '' _lnk; do
  _tgt="$(readlink "$_lnk")"
  case "$_tgt" in
    "$_appdir_abs"/*)
      _rel="$(realpath -ms --relative-to="$(dirname "$_lnk")" "$_tgt")"
      ln -sfn "$_rel" "$_lnk"
      echo "   relativized: ${_lnk#"$_appdir_abs"/} -> $_rel"
      ;;
  esac
done < <(find "$APPDIR" -type l -print0)

# 3d. RELEASE-PRIVACY GATE (WI-4736 / EI-11730) — FAIL CLOSED. Never package an
#     AppImage whose AppDir carries a known-sensitive or build-box identity. This
#     is the backstop to the stale-AppDir purge (step 0): even if a fresh AppDir
#     somehow still picks up a contaminated sidecar (a concurrent sidecar rebuild,
#     a future tauri regression), this HARD-STOPS the ship instead of leaking
#     silently — the 0.0.8/0.0.9 failure mode. Uses audit-release-bundle.py's
#     --scan-dir, the SAME identity rule build-desktop-sidecar.sh enforces on the
#     source sidecar (single source of truth; honors NO path-exclude). Default-ON
#     because an AppImage is ALWAYS a release artifact; PAPERCUSP_RELEASE_AUDIT=0
#     opts a throwaway local dev appimage out (matches bin/mac-vm-build.sh).
if [ "${PAPERCUSP_RELEASE_AUDIT:-1}" = "1" ]; then
  if [ ! -f "$AUDIT_PY" ]; then
    echo "FATAL: $AUDIT_PY not found — cannot enforce AppImage release-privacy; refusing to ship blind (WI-4736)." >&2
    exit 1
  fi
  echo "==> identity-scanning AppDir before packaging (release gate, honors NO path-exclude; WI-4736)"
  if ! python3 "$AUDIT_PY" --scan-dir "$APPDIR"; then
    echo "FATAL: AppDir carries a sensitive/build-box identity — refusing to package a leaky AppImage (WI-4736/EI-11730)." >&2
    exit 1
  fi
fi

# 4. Locate appimagetool (tauri downloads the linuxdeploy appimage plugin, which
#    embeds it) and package the AppDir. No ELF scan → no crash.
PLUGIN="$(ls "$HOME/.cache/tauri/"*plugin-appimage*.AppImage 2>/dev/null | head -1)"
[ -n "$PLUGIN" ] || { echo "FATAL: linuxdeploy-plugin-appimage not found in ~/.cache/tauri (did the tauri step run?)" >&2; exit 1; }
OUT="$APPIMG_DIR/Papercusp_GUI_${VERSION}_amd64.AppImage"
echo "==> packaging with appimagetool → $OUT"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 LDAI_OUTPUT="$OUT" "$PLUGIN" --appdir "$APPDIR"
[ -f "$OUT" ] || { echo "FATAL: appimagetool did not produce $OUT" >&2; exit 1; }

# 5. Sign for the Tauri updater (minisign .sig). Best-effort — the AppImage itself
#    runs unsigned; the .sig only gates auto-update verification.
if [ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "==> signing $OUT (updater)"
  # WI-3823: `tauri signer sign -k/--private-key` wants the key CONTENT (base64), not
  # a path — unlike the TAURI_SIGNING_PRIVATE_KEY env that `tauri build` reads (which
  # accepts either). Resolve a path to its contents, but hand the resolved secret to
  # the CLI via its OWN env-var reading (`tauri signer sign --help` confirms -k/-p both
  # have `[env: TAURI_SIGNING_PRIVATE_KEY=]` / `[env: TAURI_SIGNING_PRIVATE_KEY_PASSWORD=]`
  # fallbacks) instead of --private-key/--password on argv. `npm run` ECHOES the fully
  # resolved script command line before executing it, so a secret on argv here printed
  # the ENTIRE encrypted private key (+ password) straight into the build log AND was
  # visible in `ps` for the life of the process. Passing nothing secret on argv removes
  # the leak at the root; `--silent` (belt-and-suspenders) also suppresses npm's own
  # `> pkg@version tauri` / `> tauri signer sign …` echo lines entirely (verified: with
  # --silent, npm prints only the wrapped command's own stdout).
  _key="$TAURI_SIGNING_PRIVATE_KEY"; [ -f "$_key" ] && _key="$(cat "$_key")"
  if TAURI_SIGNING_PRIVATE_KEY="$_key" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
        npm run --silent tauri -- signer sign "$OUT"; then
    echo "   signed → $OUT.sig"
  else
    echo "   WARN: signing failed — AppImage is usable but the updater .sig is missing" >&2
  fi
fi

echo "==> AppImage done:"
ls -la "$OUT"*

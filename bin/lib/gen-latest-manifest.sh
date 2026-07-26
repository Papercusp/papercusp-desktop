#!/usr/bin/env bash
# gen-latest-manifest.sh — the SINGLE source of truth for turning a built artifact
# set into latest.json / latest-server.json (+ brief release notes), shared by
# every release-cut path (EI-18101626616739029).
#
# THE GAP THIS FIXES: latest.json / latest-server.json were generated ONLY by
# release-local.sh's embedded Python (the multi-leg, all-platforms-join cut).
# The per-leg producers — bin/build-linux-local.sh, bin/build-windows-cross.sh,
# bin/build-mac-cross.sh — build artifacts + minisign .sig but emit NO manifest,
# so the tri-platform PARALLEL-FLEET release pattern (each agent cuts ONE
# platform via its own per-leg script, per the owner's 2026-07-15 parallel-
# build directive) left nobody generating latest.json unless someone manually
# re-ran release-local.sh's Python block standalone (a real, error-prone step
# that happened live during a fleet cut). Factoring it out here means a
# single-leg cut can produce its OWN manifest via bin/gen-latest-manifest.sh,
# and release-local.sh calls the exact same helper — one implementation, no
# drift between "the real multi-leg release" and "a manual single-platform
# publish".
#
# Public functions:
#   desktop_release_tag <version> <channel>
#     -> echoes the release tag ("desktop-vX.Y.Z[-alpha|-beta]"), matching the
#        operator's manifest classifier (apps/operator/app/api/updates/manifest/route.ts).
#   gen_latest_manifest_json_path <tag>          -> latest.json path for the tag
#   gen_latest_manifest_server_json_path <tag>   -> latest-server.json path for the tag
#   gen_latest_manifest_notes_path <tag>         -> release-notes.md path for the tag
#   gen_latest_manifest <version> <channel> <tag> <artifact>...
#     -> writes latest.json (+ latest-server.json when Server-role artifacts are
#        present) + brief release notes to the paths above. Set
#        PAPERCUSP_UPDATE_BASE_URL to the base the artifacts will actually be
#        served from — unset, download URLs are an obviously-invalid placeholder
#        and the function prints a loud warning (never a plausible-but-wrong URL).
#
# All three "*_path" helpers are pure string functions (no I/O) so a caller can
# resolve where the manifest WILL land before/after calling gen_latest_manifest.

desktop_release_tag() {
  local version="$1" channel="$2"
  case "$channel" in
    alpha)  printf 'desktop-v%s-alpha\n' "$version" ;;
    beta)   printf 'desktop-v%s-beta\n' "$version" ;;
    stable) printf 'desktop-v%s\n' "$version" ;;
    *) echo "gen-latest-manifest: channel must be alpha|beta|stable (got '$channel')" >&2; return 1 ;;
  esac
}

gen_latest_manifest_json_path()        { printf '/tmp/papercusp-latest-%s.json\n' "$1"; }
gen_latest_manifest_server_json_path() { printf '/tmp/papercusp-latest-server-%s.json\n' "$1"; }
gen_latest_manifest_notes_path()       { printf '/tmp/papercusp-notes-%s.md\n' "$1"; }

# gen_latest_manifest <version> <channel> <tag> <artifact>...
gen_latest_manifest() {
  local version="$1" channel="$2" tag="$3"; shift 3
  local out_path out_server_path notes_path
  out_path="$(gen_latest_manifest_json_path "$tag")"
  out_server_path="$(gen_latest_manifest_server_json_path "$tag")"
  notes_path="$(gen_latest_manifest_notes_path "$tag")"

  python3 - "$version" "$channel" "$tag" "$out_path" "$out_server_path" "$notes_path" "$@" <<'PY'
import json, os, sys, pathlib, hashlib
from urllib.parse import quote, urlsplit
version, channel, tag, out_path, out_server_path, notes_path = sys.argv[1:7]
artifacts = [pathlib.Path(p) for p in sys.argv[7:]]

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
    # Percent-encode the FILENAME ONLY. The mac and windows GUI bundles are named
    # with SPACES ("Papercusp GUI.app.tar.gz", "Papercusp GUI_0.0.8_x64-setup.exe"),
    # and a url carrying a literal space is rejected by the client outright
    # (curl: "URL rejected: Malformed input to a URL function") — so the manifest
    # validates, the minisign signature verifies, and the download still fails.
    # The updater cannot tell a failed check from a 204, so it reports "up to date"
    # FOREVER: the LABELED!=PACKED class again. Linux only escaped it because the
    # AppImage is underscore-named.
    #
    # safe="" so the name is fully encoded; the BASE is never touched (it carries
    # the secret path segment and its slashes must stay slashes). The S3 object key
    # keeps the RAW name — only this url is encoded, and R2 serves it at the %20 path.
    return f"{base}/{tag}/{quote(name, safe='')}"

# EI-... (WI-4404): WI-3696 made latest.json GUI-only because the darwin
# (.app.tar.gz) and windows (-setup.exe/.msi) collection globs pull BOTH
# roles' bundles out of the SAME output dir (mac-vm-build.sh / build-
# windows-on-vm.sh each build "Papercusp GUI" + "Papercusp Server" side by
# side) — adding both unconditionally into ONE `platforms` dict let whichever
# role's file the shell glob happened to iterate LAST silently clobber the
# other's entry (a Server artifact — genuinely signed — served in place of
# GUI, or vice versa). The fix keeps that hard separation but stops discarding
# the Server half outright: build the SAME platform-selection logic once per
# product into its OWN dict/manifest/file (`latest.json` for gui,
# `latest-server.json` for server) so a `product=server` poll
# (updates-manifest.ts) finally has something to be served from, instead of
# always answering `no_candidate` — the "no update path exists for Server"
# gap WI-4404 identified.
def build_platforms(artifacts, want_token, reject_token):
    """want_token/reject_token: substrings that must/must-not appear in the
    artifact filename — e.g. want='Server', reject='GUI' selects only
    Server-role bundles for the server manifest (and vice versa for gui)."""
    platforms = {}
    def add(platform_key, bin_path, sig_path):
        sig = sig_path.read_text().strip() if sig_path.exists() else ""
        platforms[platform_key] = {
            "signature": sig,
            "url": repo_url(bin_path.name),
        }
    for art in artifacts:
        if reject_token in art.name:
            continue
        # A pre-split bundle (neither role token in the name) is treated as
        # GUI-role only — never let an unlabeled artifact land in BOTH
        # manifests. want_token=='' (gui) accepts it; want_token=='Server'
        # (server) requires the explicit token.
        if want_token and want_token not in art.name:
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
    return platforms

gui_platforms = build_platforms(artifacts, want_token="", reject_token="Server")
server_platforms = build_platforms(artifacts, want_token="Server", reject_token="GUI")

# WI-3696/WI-4404 cut-time assertion: every entry each manifest publishes must
# genuinely be that manifest's product (a fail-loud backstop against a FUTURE
# naming/glob regression re-introducing a silent wrong-product swap). The GUI
# manifest's own artifacts don't carry a "GUI" token pre-split, so the GUI
# check only forbids the OTHER product's token; the Server manifest requires
# its own token explicitly since Server-role bundles are always name-stamped.
for platform_key, entry in gui_platforms.items():
    if "Server" in entry["url"]:
        raise SystemExit(
            f"latest.json BUG: {platform_key} entry looks like the Server product "
            f"(url={entry['url']!r}) — refusing to publish a manifest that could ship the "
            f"wrong app on update (WI-3696)"
        )
for platform_key, entry in server_platforms.items():
    if "Server" not in entry["url"]:
        raise SystemExit(
            f"latest-server.json BUG: {platform_key} entry does not look like the Server "
            f"product (url={entry['url']!r}) — refusing to publish a manifest that could "
            f"ship the wrong app on update (WI-4404)"
        )

# Cut-time assertion: a url a client cannot even parse must never ship. Belt-and-
# braces behind repo_url()'s quoting, because the failure is SILENT downstream —
# the download 404s/rejects and the updater renders it as "up to date".
for label, platforms in (("latest.json", gui_platforms), ("latest-server.json", server_platforms)):
    for platform_key, entry in platforms.items():
        url = entry["url"]
        if " " in url or url != url.strip():
            raise SystemExit(
                f"{label} BUG: {platform_key} url contains whitespace ({url!r}) — a client "
                f"rejects it outright and the updater would silently read the failure as "
                f"'up to date' (WI-4364)"
            )
        parts = urlsplit(url)
        if not parts.scheme or not parts.path:
            raise SystemExit(
                f"{label} BUG: {platform_key} url does not round-trip urlsplit() ({url!r}) "
                f"— refusing to publish an unfetchable manifest (WI-4364)"
            )

pub_date = __import__("datetime").datetime.utcnow().isoformat(timespec="seconds") + "Z"

manifest = {
    "version": version,
    "channel": channel,
    "notes": f"Papercusp desktop {version} ({channel}). See release notes.",
    "pub_date": pub_date,
    "platforms": gui_platforms,
}
pathlib.Path(out_path).write_text(json.dumps(manifest, indent=2) + "\n")

# Only emit latest-server.json when this cut actually produced Server-role
# artifacts (PAPERCUSP_BUILD_ROLES="gui" builds skip Server entirely) — an
# empty-platforms manifest would make every Server poll read as "up to date"
# just as convincingly as no manifest at all, but writing NOTHING here instead
# leaves the PREVIOUS cut's latest-server.json live on the host (upload-
# release.sh only uploads what release-local.sh actually produced), so a
# Server-only build never regresses to a false up-to-date.
if server_platforms:
    server_manifest = {
        "version": version,
        "channel": channel,
        "notes": f"Papercusp Server {version} ({channel}). See release notes.",
        "pub_date": pub_date,
        "platforms": server_platforms,
    }
    pathlib.Path(out_server_path).write_text(json.dumps(server_manifest, indent=2) + "\n")
else:
    print("==> no Server-role artifacts in this cut — latest-server.json NOT written "
          "(the host keeps serving its previous one, if any)")

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
        "  ⚠ WARNING: PAPERCUSP_UPDATE_BASE_URL is unset, so latest.json's (and\n"
        "    latest-server.json's, if written) download URLs are the placeholder " + PLACEHOLDER + "/...\n"
        "    The INSTALLERS below are complete and shippable — this only affects the\n"
        "    auto-updater manifest. Before latest.json is SERVED to clients, re-run with\n"
        "    PAPERCUSP_UPDATE_BASE_URL=<base the artifacts are uploaded to>, or rewrite\n"
        "    the urls in place. Serving it as-is means every update check fails.\n",
        file=sys.stderr,
    )
PY
}

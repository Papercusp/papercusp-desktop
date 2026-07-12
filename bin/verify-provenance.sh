#!/usr/bin/env bash
# P-010 (desktop-build-hardening-tri-platform-2026-07-11): release:verify-provenance,
# as an executable check. Given a directory of built release artifacts + their
# build-provenance.json (emitted by bin/emit-build-provenance.sh), assert every
# dimension that must hold for the bytes to be safe to ship — encoding EI-8914
# (LABELED != PACKED) as a gate a bad build physically cannot pass:
#
#   1. gitDirty == false             — a release was not cut from a dirty tree.
#   2. buildSha == live /api/health  — the running operator IS this artifact
#      sha (when a --health-sha/--health-url is supplied; the post-install proof).
#   3. each artifact's sha256 == the value recorded in build-provenance.json
#      (the core LABELED != PACKED check: the shipped bytes are the recorded bytes).
#   4. the SIGNATURE dimension (D-004) — the updater's REAL trust check:
#      (a) each artifact's minisign .sig verifies against the embedded pubkey
#          (via bin/verify-tauri-signature.mjs — no external minisign needed); and
#      (b) if a latest.json manifest is present, every per-platform url references
#          an artifact whose sha256 was verified AND its signature field equals
#          that artifact's on-disk .sig — so the manifest cannot point the updater
#          at a different/stale file than the one we just verified.
#
# Verification standard (D-007, VMs unavailable): this script is `bash -n`-clean,
# functionally tested against synthetic fixtures covering every failure branch,
# and smoke-run against REAL 0.0.7 artifact bytes + their real signatures.
#
# Usage:
#   verify-provenance.sh ARTIFACT_DIR [options]
# Options:
#   --health-sha SHA     assert build-provenance.buildSha == SHA (the live health sha)
#   --health-url URL     curl URL and extract .sha, then assert equality (URL is the
#                        full /api/health endpoint, e.g. http://127.0.0.1:3070/api/health)
#   --latest-json PATH   cross-check this manifest (default: ARTIFACT_DIR/latest.json if present)
#   --pubkey VALUE|PATH  minisign pubkey for the sig check (default: plugins.updater.pubkey
#                        from src-tauri/tauri.conf.json)
#   --require-signed     fail if ANY artifact lacks a .sig (default: verify sigs that exist)
#   --allow-dirty        don't fail on gitDirty==true (default: gitDirty must be false)
#   --json               emit a machine-readable verdict to stdout
# Exit: 0 = all checks pass · 1 = a check failed · 2 = usage/setup error.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
NODE_HELPER="$HERE/verify-tauri-signature.mjs"

DIR=""
HEALTH_SHA=""
HEALTH_URL=""
LATEST_JSON=""
PUBKEY=""
REQUIRE_SIGNED=0
ALLOW_DIRTY=0
JSON=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --health-sha) HEALTH_SHA="${2:-}"; shift 2 ;;
    --health-url) HEALTH_URL="${2:-}"; shift 2 ;;
    --latest-json) LATEST_JSON="${2:-}"; shift 2 ;;
    --pubkey) PUBKEY="${2:-}"; shift 2 ;;
    --require-signed) REQUIRE_SIGNED=1; shift ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *) [[ -z "$DIR" ]] && DIR="$1" || { echo "unexpected extra arg: $1" >&2; exit 2; }; shift ;;
  esac
done

[[ -n "$DIR" ]] || { echo "usage: verify-provenance.sh ARTIFACT_DIR [options]" >&2; exit 2; }
[[ -d "$DIR" ]] || { echo "ARTIFACT_DIR '$DIR' is not a directory" >&2; exit 2; }
[[ -f "$NODE_HELPER" ]] || { echo "signature verifier missing at $NODE_HELPER" >&2; exit 2; }

# Default the manifest to a co-located latest.json when the caller didn't name one.
if [[ -z "$LATEST_JSON" && -f "$DIR/latest.json" ]]; then LATEST_JSON="$DIR/latest.json"; fi

# Default the pubkey from the app's own updater config (single source of truth).
if [[ -z "$PUBKEY" ]]; then
  PUBKEY="$(python3 -c "import json;print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['plugins']['updater']['pubkey'])" 2>/dev/null || true)"
  [[ -n "$PUBKEY" ]] || { echo "could not read plugins.updater.pubkey from tauri.conf.json — pass --pubkey" >&2; exit 2; }
fi

# Resolve the live health sha from --health-url if given (and no explicit sha).
if [[ -z "$HEALTH_SHA" && -n "$HEALTH_URL" ]]; then
  HEALTH_SHA="$(curl -s --max-time 8 "$HEALTH_URL" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("sha",""))' 2>/dev/null || true)"
  [[ -n "$HEALTH_SHA" ]] || { echo "could not fetch/parse a sha from --health-url $HEALTH_URL" >&2; exit 2; }
fi

PROV="$DIR/build-provenance.json"
[[ -f "$PROV" ]] || { echo "no build-provenance.json in $DIR — nothing to verify (unprovenanced artifacts)" >&2; exit 2; }

DIR="$DIR" PROV="$PROV" HEALTH_SHA="$HEALTH_SHA" LATEST_JSON="$LATEST_JSON" \
PUBKEY="$PUBKEY" NODE_HELPER="$NODE_HELPER" \
REQUIRE_SIGNED="$REQUIRE_SIGNED" ALLOW_DIRTY="$ALLOW_DIRTY" JSON="$JSON" \
python3 <<'PY'
import os, sys, json, hashlib, subprocess, pathlib

DIR = pathlib.Path(os.environ["DIR"])
PROV = pathlib.Path(os.environ["PROV"])
HEALTH_SHA = os.environ.get("HEALTH_SHA", "")
LATEST_JSON = os.environ.get("LATEST_JSON", "")
PUBKEY = os.environ["PUBKEY"]
NODE_HELPER = os.environ["NODE_HELPER"]
REQUIRE_SIGNED = os.environ.get("REQUIRE_SIGNED") == "1"
ALLOW_DIRTY = os.environ.get("ALLOW_DIRTY") == "1"
AS_JSON = os.environ.get("JSON") == "1"

failures = []
notes = []

try:
    prov = json.loads(PROV.read_text())
except Exception as e:
    print(f"build-provenance.json is not valid JSON: {e}", file=sys.stderr)
    sys.exit(2)

version = prov.get("version")
build_sha = prov.get("buildSha")
git_dirty = prov.get("gitDirty")
reused = prov.get("reused", False)  # absent on pre-P-002 provenance ⇒ treat as fresh

# ── 1. gitDirty ────────────────────────────────────────────────────────────
if git_dirty is True and not ALLOW_DIRTY:
    failures.append("gitDirty is true — release cut from a dirty tree (pass --allow-dirty to override)")
git_dirty_ok = not (git_dirty is True and not ALLOW_DIRTY)

# ── 2. buildSha == live health sha ──────────────────────────────────────────
if HEALTH_SHA:
    health_ok = (build_sha == HEALTH_SHA)
    if not health_ok:
        failures.append(f"buildSha {build_sha!r} != live /api/health sha {HEALTH_SHA!r} — the running operator is not this artifact")
else:
    health_ok = None
    notes.append("health-match dimension skipped (no --health-sha/--health-url) — cannot prove the running operator is this artifact")

# ── 3. each artifact's sha256 matches + 4a. its signature verifies ──────────
def sha256_file(p: pathlib.Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def verify_sig(artifact: pathlib.Path, sig: pathlib.Path) -> bool:
    r = subprocess.run(["node", NODE_HELPER, PUBKEY, str(artifact), str(sig), "--json"],
                       capture_output=True, text=True)
    return r.returncode == 0

artifacts_report = []
prov_artifacts = prov.get("artifacts") or []
if not prov_artifacts:
    failures.append("build-provenance.json lists no artifacts — nothing to verify")

verified_names = set()          # names whose sha256 matched (D-004b anchors on these)
sig_content_by_name = {}        # name → on-disk .sig text (D-004b compares to manifest)

for a in prov_artifacts:
    name = a.get("name")
    recorded = a.get("sha256")
    path = DIR / name
    entry = {"name": name, "present": path.is_file(), "sha256Ok": None, "sigOk": None}
    if not path.is_file():
        failures.append(f"artifact {name!r} recorded in provenance is missing from {DIR}")
        artifacts_report.append(entry)
        continue
    actual = sha256_file(path)
    entry["sha256Ok"] = (actual == recorded)
    if actual != recorded:
        failures.append(f"artifact {name!r} sha256 {actual} != recorded {recorded} (LABELED!=PACKED)")
    else:
        verified_names.add(name)
    # 4a. signature
    sig = pathlib.Path(str(path) + ".sig")
    if sig.is_file():
        sig_content_by_name[name] = sig.read_text().strip()
        entry["sigOk"] = verify_sig(path, sig)
        if not entry["sigOk"]:
            failures.append(f"artifact {name!r} signature ({sig.name}) does not verify against the embedded pubkey")
    else:
        entry["sigOk"] = "absent"
        if a.get("sig") is True:
            # WI-4243: the emitter recorded a co-located .sig at build time —
            # its absence now means the signature was stripped/lost in transit.
            failures.append(f"artifact {name!r}: provenance records a .sig but none is co-located (signature stripped?)")
        elif REQUIRE_SIGNED:
            failures.append(f"artifact {name!r} has no .sig and --require-signed was set")
        else:
            notes.append(f"artifact {name!r} has no co-located .sig — signature not checked")
    artifacts_report.append(entry)

# ── 4b. latest.json manifest cross-check ────────────────────────────────────
manifest_report = None
if LATEST_JSON:
    lp = pathlib.Path(LATEST_JSON)
    if not lp.is_file():
        failures.append(f"--latest-json {LATEST_JSON} does not exist")
    else:
        try:
            manifest = json.loads(lp.read_text())
        except Exception as e:
            failures.append(f"latest.json is not valid JSON: {e}")
            manifest = None
        if manifest is not None:
            manifest_report = {}
            # WI-4243: provenance names may carry a subdir (e.g. "deb/App.deb");
            # a manifest url only carries the basename — match on basenames.
            prov_name_by_base = {}
            for a in prov_artifacts:
                n = a.get("name") or ""
                prov_name_by_base.setdefault(n.rsplit("/", 1)[-1], n)
            for platform_key, meta in (manifest.get("platforms") or {}).items():
                url = (meta or {}).get("url", "")
                sig_field = ((meta or {}).get("signature", "") or "").strip()
                base = url.rsplit("/", 1)[-1] if url else ""
                name = prov_name_by_base.get(base)
                ok = True
                if name is None:
                    failures.append(f"latest.json[{platform_key}] url {base!r} is not an artifact in this provenance"); ok = False
                elif name not in verified_names:
                    failures.append(f"latest.json[{platform_key}] points at {base!r} whose sha256 did not verify"); ok = False
                else:
                    disk_sig = sig_content_by_name.get(name)
                    if disk_sig is None:
                        failures.append(f"latest.json[{platform_key}] references {base!r} but it has no on-disk .sig to compare"); ok = False
                    elif sig_field != disk_sig:
                        failures.append(f"latest.json[{platform_key}] signature does not match {base}.sig (manifest points at different/stale bytes)"); ok = False
                manifest_report[platform_key] = {"url_basename": base, "ok": ok}

ok = len(failures) == 0
verdict = {
    "ok": ok,
    "dir": str(DIR),
    "version": version,
    "buildSha": build_sha,
    "gitDirty": git_dirty,
    "gitDirtyOk": git_dirty_ok,
    "reused": reused,
    "healthMatch": health_ok,
    "artifacts": artifacts_report,
    "manifest": manifest_report,
    "failures": failures,
    "notes": notes,
}

if AS_JSON:
    print(json.dumps(verdict, indent=2))
else:
    print(f"verify-provenance: {'PASS' if ok else 'FAIL'}  version={version} buildSha={build_sha} gitDirty={git_dirty} reused={reused}")
    for e in artifacts_report:
        print(f"  artifact {e['name']}: present={e['present']} sha256Ok={e['sha256Ok']} sigOk={e['sigOk']}")
    if health_ok is None:
        print("  health-match: SKIPPED")
    else:
        print(f"  health-match: {'OK' if health_ok else 'MISMATCH'}")
    if manifest_report is not None:
        for k, v in manifest_report.items():
            print(f"  manifest[{k}]: {v['url_basename']} ok={v['ok']}")
    for n in notes:
        print(f"  note: {n}")
    for f in failures:
        print(f"  FAIL: {f}")

sys.exit(0 if ok else 1)
PY

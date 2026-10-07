#!/usr/bin/env python3
"""D186/D187: normalize private bottle inputs at the existing native-copy seam.

This does not qualify a public profile. LLVM performs the same load-command
rewrites as build-desktop-sidecar.sh; rcodesign re-signs each modified Mach-O.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
import socket


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def run(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE)


def minimum_os(commands):
    # EI253195: parse ONLY the field belonging to the current load command.
    # Adjacent LC_LOAD_DYLIB/current version and LC_BUILD_VERSION tool versions
    # are not OS requirements. Old LC_VERSION_MIN_MACOSX uses `version`.
    command = None
    platform = None
    values = []
    for line in commands.splitlines():
        match = re.match(r"\s*cmd\s+(LC_\w+)\s*$", line)
        if match:
            command = match[1]
            platform = None
        match = re.match(r"\s*platform\s+(\w+)\s*$", line)
        if match:
            platform = match[1].lower()
        field = "minos" if command == "LC_BUILD_VERSION" else (
            "version" if command == "LC_VERSION_MIN_MACOSX" else None)
        match = re.match(r"\s*" + field + r"\s+(\d+(?:\.\d+)*)\s*$", line) if field else None
        if match:
            if command == "LC_BUILD_VERSION" and platform not in ("1", "macos"):
                raise ValueError("LC_BUILD_VERSION is not measured macOS platform")
            values.append(match[1])
            command = None
    if not values:
        raise ValueError("Mach-O has no measured macOS minimum load command")
    return values


def version(value):
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) * (3 - len(parts))


def is_macho(path):
    with open(path, "rb") as source:
        return source.read(4) in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
                                  b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca")


def inspect(path, arch):
    description = run("file", "-b", str(path)).strip()
    expected = "x86_64" if arch == "x64" else "arm64"
    if "Mach-O" not in description or expected not in description:
        raise ValueError(f"{path}: not Mach-O {expected}: {description}")
    otool = shutil.which("llvm-otool-18") or "otool"
    loads = run(otool, "-L", str(path)).splitlines()[1:]
    deps = [line.strip().split(" (compatibility version", 1)[0] for line in loads if line.strip()]
    identity = run(otool, "-D", str(path)).splitlines()[1:]
    if identity and deps and deps[0] == identity[0].strip():
        deps.pop(0)  # LC_ID_DYLIB is not a dependency.
    return {"format": description, "minimumOS": minimum_os(run(otool, "-l", str(path))),
            "dylibs": deps}


def system_dep(dep):
    return dep.startswith(("/usr/lib/", "/System/Library/"))


def file_inventory(root):
    files = {}
    for path in sorted(root.rglob("*")):
        if path == root / "manifest.json":
            continue
        if path.is_symlink():
            raise ValueError(f"native input symlink is not inventoried: {path}")
        if path.is_file():
            files[path.relative_to(root).as_posix()] = sha(path)
    return files


def files_hash(files):
    return hashlib.sha256(canonical(files)).hexdigest()


def make_copy_writable(root):
    # Homebrew kegs intentionally ship 0555 dirs/executables. rcodesign needs
    # to replace files beside the target; writable files alone are insufficient.
    # Touch ONLY the newly copied normalization output, never the upstream keg.
    for path in [root, *root.rglob("*")]:
        path.chmod(path.stat().st_mode | 0o200)


def check_closure(root, arch, floor):
    observations = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or not is_macho(path):
            continue
        info = inspect(path, arch)
        if any(version(v) > version(floor) for v in info["minimumOS"]):
            raise ValueError(f"{path}: minimum macOS {info['minimumOS']} exceeds recorded {floor}")
        for dep in info["dylibs"]:
            if system_dep(dep):
                continue
            if not dep.startswith("@loader_path/"):
                raise ValueError(f"{path}: nonrelocatable dylib {dep}")
            target = (path.parent / dep[len("@loader_path/"):]).resolve()
            if not target.is_relative_to(root.resolve()) or not target.is_file():
                raise ValueError(f"{path}: unresolved dylib {dep}")
            if not is_macho(target):
                raise ValueError(f"{path}: dylib target is not Mach-O: {dep}")
        observations[path.relative_to(root).as_posix()] = info
    return observations


def verify(root, expected, arch, profile, require_runtime=False, require_security=False):
    manifest_path = root / "manifest.json"
    if sha(manifest_path) != expected:
        raise ValueError("Darwin native input manifest SHA-256 mismatch")
    manifest = json.loads(manifest_path.read_text())
    if profile != "dogfood" or manifest.get("privateOnly") is not True:
        raise ValueError("private Darwin native inputs require dogfood; public/VM profiles refused")
    if manifest.get("schemaVersion") != "darwin-native-inputs/v1" or manifest.get("target") != {"os": "darwin", "arch": arch}:
        raise ValueError("Darwin native input target/schema mismatch")
    if manifest.get("postgresqlVersion") != "18.6":
        raise ValueError("private native input requires pinned PostgreSQL 18.6")
    actual = file_inventory(root)
    if actual != manifest.get("files"):
        raise ValueError("Darwin native input file inventory/checksum mismatch")
    required = ["postgresql/bin/" + name for name in
                ("postgres", "initdb", "pg_ctl", "pg_dump", "pg_dumpall", "pg_restore", "psql")]
    required += ["postgresql/lib/postgresql/vector.dylib", "postgresql/share/postgresql/extension/vector.control", "bin/gh", "bin/kopia"]
    if any(name not in actual for name in required):
        raise ValueError("Darwin native input required server/client/pgvector/CLI file missing")
    if any(not os.access(root / name, os.X_OK) for name in required if "/bin/" in name or name.startswith("bin/")):
        raise ValueError("Darwin native input required executable mode missing")
    observations = check_closure(root, arch, manifest["minimumMacOS"])
    if any(name not in observations for name in required if not name.endswith(".control")):
        raise ValueError("required native input is not a measured Mach-O")
    if not manifest.get("upstreamReceipts"):
        raise ValueError("Darwin native input upstream provenance missing")
    if require_runtime or require_security:
        security = manifest.get("securityQualification") or {}
        attestation = root / "apps/operator/runtime/vm-release-vulnerability-attestation.json"
        if not attestation.is_file() or sha(attestation) != security.get("summarySha256"):
            raise ValueError("exact native input security attestation missing or mismatched")
        summary = json.loads(attestation.read_text())
        if summary.get("result", {}).get("status") != "green" or summary["result"].get("gatedMatches") != 0:
            raise ValueError("native input security verdict is not zero High/Critical")
        if summary.get("evidence") != security.get("evidence"):
            raise ValueError("native input security evidence hashes mismatch")
    if require_runtime:
        receipt = manifest.get("runtimeQualification") or {}
        raw = base64.b64decode(manifest.get("runtimeQualificationReceiptBase64", ""), validate=True)
        if (not raw or hashlib.sha256(raw).hexdigest() != receipt.get("receiptSha256")
                or json.loads(raw) != {k: v for k, v in receipt.items() if k != "receiptSha256"}):
            raise ValueError("native rig receipt SHA-256 must bind actual immutable receipt bytes")
        if (receipt.get("nativeFilesSha256") != files_hash(actual)
                or receipt.get("target") != manifest["target"]
                or receipt.get("minimumMacOS") != manifest["minimumMacOS"]
                or not re.fullmatch(r"[0-9a-f]{64}", receipt.get("receiptSha256", ""))
                or any(receipt.get("checks", {}).get(key) is not True for key in
                       ("pgInitStartQueryStop", "pgvector", "gh", "kopia"))):
            raise ValueError("exact native input rig runtime qualification missing or mismatched")
    return manifest


def bind_security(args):
    """Retain scanner-created attestation in a NEW, fully inventoried input bank."""
    source = args.root.resolve()
    manifest_path = source / "manifest.json"
    if sha(manifest_path) != args.sha256:
        raise ValueError("pre-security manifest checksum mismatch")
    manifest = json.loads(manifest_path.read_text())
    actual = file_inventory(source)
    attestation = "apps/operator/runtime/vm-release-vulnerability-attestation.json"
    original = manifest["files"]
    if (any(actual.get(name) != digest for name, digest in original.items())
            or set(actual) - set(original) != {attestation}):
        raise ValueError("scanner changed original native bytes or added unrecorded files")
    summary_path = args.evidence / "summary.json"
    summary = json.loads(summary_path.read_text())
    if sha(summary_path) != actual[attestation]:
        raise ValueError("scanner attestation differs from immutable summary")
    for name, field in (("sbom.cdx.json", "sbomSha256"), ("grype.json", "grypeReportSha256")):
        if sha(args.evidence / name) != summary["evidence"][field]:
            raise ValueError("actual scanner evidence checksum mismatch")
    report = json.loads((args.evidence / "grype.json").read_text())
    if any(str(x.get("vulnerability", {}).get("severity", "")).lower() in ("high", "critical") for x in report["matches"]):
        raise ValueError("native input scanner report contains High/Critical")
    if args.out.exists():
        raise ValueError("security-qualified output must be fresh; refusing overwrite")
    manifest["files"] = actual
    manifest["nativeFilesSha256"] = files_hash(actual)
    manifest["securityQualification"] = {"summarySha256": sha(summary_path), "evidence": summary["evidence"],
                                         "scope": "native-inputs-only-not-final-candidate"}
    shutil.copytree(source, args.out)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    verify(args.out.resolve(), sha(args.out / "manifest.json"), args.arch, "dogfood", require_security=True)
    print(json.dumps({"manifestSha256": sha(args.out / "manifest.json"), "nativeFilesSha256": files_hash(actual),
                      "securitySummarySha256": sha(summary_path), "rigAccepted": False}))


def bind_runtime(args):
    # Preserve the static manifest; qualification produces a NEW input bank.
    source = args.root.resolve()
    manifest = verify(source, args.sha256, args.arch, "dogfood")
    raw = args.receipt.read_bytes()
    receipt = json.loads(raw)
    if not receipt.get("evidence"):
        raise ValueError("rig receipt requires actual protocol output evidence references")
    receipt["receiptSha256"] = hashlib.sha256(raw).hexdigest()
    manifest["runtimeQualification"] = receipt
    manifest["runtimeQualificationReceiptBase64"] = base64.b64encode(raw).decode()
    if args.out.exists():
        raise ValueError("qualified native output must be fresh; refusing overwrite")
    shutil.copytree(source, args.out)
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    verify(args.out.resolve(), sha(args.out / "manifest.json"), args.arch, "dogfood", True)
    print(json.dumps({"manifestSha256": sha(args.out / "manifest.json"), "receiptSha256": receipt["receiptSha256"]}))


def qualify_runtime(args):
    """Input-only protocols in disposable state; the caller owns the rig lock."""
    root = args.root.resolve()
    manifest = verify(root, args.sha256, args.arch, "dogfood", require_security=True)
    expected_arch = "x86_64" if args.arch == "x64" else "arm64"
    if (platform.system() != "Darwin" or platform.machine() != expected_arch
            or version(platform.mac_ver()[0]) < version(manifest["minimumMacOS"])):
        raise ValueError("runtime rig OS/architecture does not satisfy the exact native input")
    if args.receipt.exists() or args.evidence.exists():
        raise ValueError("runtime receipt and external evidence must be fresh paths")
    args.evidence.mkdir(parents=True)
    observations = []
    started = time.monotonic()
    before = file_inventory(root)
    with tempfile.TemporaryDirectory(prefix="papercusp-native-protocol-") as temporary:
        work = Path(temporary)
        for name in ("home", "socket", "input"):
            (work / name).mkdir()
        env = {"PATH": os.environ["PATH"], "HOME": str(work / "home"), "LANG": "C",
               "TMPDIR": temporary, "GH_CONFIG_DIR": str(work / "gh-config"),
               "GH_TOKEN": "local-fixture-only", "GH_PROMPT_DISABLED": "1"}

        def execute(name, command, cleanup=False):
            remaining = 180 - (time.monotonic() - started)
            if remaining <= 0 and not cleanup:
                raise ValueError("native protocol qualification exceeded its 180s deadline")
            result = subprocess.run([str(x) for x in command], env=env, capture_output=True,
                                    text=True, timeout=30 if cleanup else min(45, remaining))
            output = {"argv": [str(x) for x in command], "exitCode": result.returncode,
                      "stdout": result.stdout, "stderr": result.stderr}
            evidence = args.evidence / (str(len(observations)) + "-" + name + ".json")
            evidence.write_text(json.dumps(output, indent=2) + "\n")
            # The safe receipt ships only hashes; raw rig identities/paths stay
            # in external evidence and remain subject to final privacy checks.
            observations.append({"protocol": name, "exitCode": result.returncode,
                                 "evidenceSha256": sha(evidence)})
            if result.returncode:
                raise ValueError(f"native protocol {name} failed; see external evidence")
            return result.stdout

        pg = root / "postgresql/bin"
        data = work / "pg-data"
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        try:
            execute("initdb", [pg / "initdb", "--encoding=UTF8", "--locale=C", "--auth=trust", "-D", data])
            execute("pg-start", [pg / "pg_ctl", "-D", data, "-l", work / "postgres.log", "-w", "-t", "30", "-o",
                                 f"-p {port} -h 127.0.0.1 -k {work / 'socket'}", "start"])
            query = execute("pg-vector-query", [pg / "psql", "-h", "127.0.0.1", "-p", str(port), "-d", "postgres",
                                                "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c",
                                                "SELECT version(); CREATE EXTENSION vector; SELECT '[1,2]'::vector <-> '[4,6]'::vector;"])
            if "PostgreSQL 18.6" not in query or query.strip().splitlines()[-1] != "5":
                raise ValueError("native PostgreSQL version/vector result mismatch")
        finally:
            if (data / "postmaster.pid").exists():
                execute("pg-stop", [pg / "pg_ctl", "-D", data, "-m", "fast", "-w", "-t", "20", "stop"], cleanup=True)

        class Fixture(BaseHTTPRequestHandler):
            calls = 0

            def do_GET(self):
                Fixture.calls += 1
                if self.path != "/fixture":
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"nativeQualification":"ok"}')

            def log_message(self, *unused):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            response = execute("gh-loopback-api", [root / "bin/gh", "api", f"http://127.0.0.1:{server.server_port}/fixture"])
            if json.loads(response) != {"nativeQualification": "ok"} or Fixture.calls != 1:
                raise ValueError("GitHub CLI did not complete the exact loopback fixture")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

        kopia = root / "bin/kopia"
        config = work / "kopia.config"
        prefix = [kopia, "--config-file", config]
        payload = work / "input/payload.txt"
        payload.write_text("papercusp native snapshot protocol\n")
        execute("kopia-create-repo", prefix + ["repository", "create", "filesystem", "--path", work / "repository",
                                             "--password", "local-fixture-only"])
        snapshot = json.loads(execute("kopia-snapshot", prefix + ["snapshot", "create", work / "input", "--json"]))
        identifier = snapshot["rootEntry"]["obj"]
        listed = json.loads(execute("kopia-list", prefix + ["snapshot", "list", "--all", "--json"]))
        if not any(item.get("rootEntry", {}).get("obj") == identifier for item in listed):
            raise ValueError("native Kopia snapshot missing from repository list")
        execute("kopia-restore", prefix + ["snapshot", "restore", identifier, work / "restored"])
        if sha(payload) != sha(work / "restored/payload.txt"):
            raise ValueError("native Kopia restore hash mismatch")
    if file_inventory(root) != before:
        raise ValueError("native protocol execution mutated exact input bytes")
    receipt = {"schemaVersion": "darwin-native-protocol-receipt/v1", "target": manifest["target"],
               "minimumMacOS": manifest["minimumMacOS"], "rigMacOS": platform.mac_ver()[0],
               "nativeFilesSha256": files_hash(before), "at": datetime.now(timezone.utc).isoformat(),
               "checks": {name: True for name in ("pgInitStartQueryStop", "pgvector", "gh", "kopia")},
               "evidence": observations, "installerAccepted": False}
    args.receipt.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"receiptSha256": sha(args.receipt), "nativeFilesSha256": files_hash(before), "installerAccepted": False}))


def assemble(args):
    root = args.out.resolve()
    if root.exists():
        raise ValueError("native output must be a fresh path; refusing overwrite")
    # Read/validate before writing. Existing receipts stay immutable.
    upstream = [{"name": path.name, "sha256": sha(path), "receipt": json.loads(path.read_text())}
                for path in args.receipt]
    if not upstream:
        raise ValueError("upstream receipts required")
    root.mkdir(parents=True)
    native = root / "postgresql"
    for name in ("bin", "lib", "share"):
        shutil.copytree(args.keg / name, native / name, symlinks=False)
    extension = native / "share/postgresql/extension"
    extension.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.vector / "vector.dylib", native / "lib/postgresql/vector.dylib")
    for path in args.vector.glob("extension/vector*"):
        shutil.copy2(path, extension / path.name)
    (root / "bin").mkdir()
    for name in ("gh", "kopia"):
        shutil.copy2(args.go / "bin" / name, root / "bin" / name)
    make_copy_writable(root)

    # Reuse exact dependency kegs selected from the PG bottle's upstream SBOM.
    # Resolve the entire emitted Mach-O population, including server plugins.
    candidates = {}
    for folder in [native / "lib", *args.dependency]:
        for path in sorted(folder.rglob("*.dylib")):
            if path.is_file():
                candidates.setdefault(path.name, []).append((path, sha(path)))
    pending = [path for path in root.rglob("*") if path.is_file() and is_macho(path)]
    seen = set()
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.add(path)
        info = inspect(path, args.arch)
        for dep in info["dylibs"]:
            if system_dep(dep):
                continue
            base = Path(dep).name
            sources = candidates.get(base, [])
            if not sources:
                raise ValueError(f"{path}: pinned dependency closure missing {dep}")
            if len({digest for _, digest in sources}) != 1:
                raise ValueError(f"conflicting pinned dylib basename {base}")
            target = native / "lib" / base
            if not target.exists():
                shutil.copy2(sources[0][0], target)
                target.chmod(target.stat().st_mode | 0o200)
                pending.append(target)
            replacement = "@loader_path/" + os.path.relpath(target, path.parent)
            run("llvm-install-name-tool-18", "-change", dep, replacement, str(path))
        if path.suffix == ".dylib":
            run("llvm-install-name-tool-18", "-id", "@loader_path/" + path.name, str(path))
        run("rcodesign", "sign", str(path))
    observations = check_closure(root, args.arch, args.floor)
    measured = max((v for info in observations.values() for v in info["minimumOS"]), key=version)
    files = file_inventory(root)
    manifest = {"schemaVersion": "darwin-native-inputs/v1", "privateOnly": True,
                "target": {"os": "darwin", "arch": args.arch}, "postgresqlVersion": "18.6",
                "minimumMacOS": measured, "public1015Compatible": False,
                "files": files, "nativeFilesSha256": files_hash(files),
                "upstreamReceipts": upstream, "runtimeQualification": None}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    verify(root, sha(root / "manifest.json"), args.arch, "dogfood")
    print(json.dumps({"manifestSha256": sha(root / "manifest.json"), "nativeFilesSha256": files_hash(files),
                      "minimumMacOS": measured, "machOFiles": len(observations), "rigAccepted": False}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prep = sub.add_parser("assemble")
    for name in ("keg", "vector", "go", "out"):
        prep.add_argument("--" + name, required=True, type=Path)
    prep.add_argument("--dependency", action="append", default=[], type=Path)
    prep.add_argument("--receipt", action="append", default=[], type=Path)
    prep.add_argument("--arch", required=True, choices=("x64", "arm64"))
    prep.add_argument("--floor", default="14.0")
    check = sub.add_parser("verify")
    check.add_argument("root", type=Path)
    check.add_argument("sha256")
    check.add_argument("arch", choices=("x64", "arm64"))
    check.add_argument("profile")
    check.add_argument("--require-runtime", action="store_true")
    bind = sub.add_parser("bind-runtime")
    bind.add_argument("root", type=Path)
    bind.add_argument("sha256")
    bind.add_argument("arch", choices=("x64", "arm64"))
    bind.add_argument("receipt", type=Path)
    bind.add_argument("out", type=Path)
    qualify = sub.add_parser("qualify-runtime")
    qualify.add_argument("root", type=Path)
    qualify.add_argument("sha256")
    qualify.add_argument("arch", choices=("x64", "arm64"))
    qualify.add_argument("receipt", type=Path)
    qualify.add_argument("evidence", type=Path)
    security = sub.add_parser("bind-security")
    security.add_argument("root", type=Path)
    security.add_argument("sha256")
    security.add_argument("arch", choices=("x64", "arm64"))
    security.add_argument("evidence", type=Path)
    security.add_argument("out", type=Path)
    args = parser.parse_args()
    if args.command == "assemble":
        assemble(args)
    elif args.command == "bind-runtime":
        bind_runtime(args)
    elif args.command == "qualify-runtime":
        qualify_runtime(args)
    elif args.command == "bind-security":
        bind_security(args)
    else:
        verify(args.root.resolve(), args.sha256, args.arch, args.profile, args.require_runtime)
        print("PRIVATE_DARWIN_NATIVE_INPUTS_OK")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"ERROR: private Darwin native inputs: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr, file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""audit-release-bundle.py — WI-4419. The release bundle's LAST GATE.

Answers ONE question about the thing we are actually about to ship: does it
contain anything that must never leave this machine?

WHY IT SCANS THE ARTIFACT AND NOT THE REPO
------------------------------------------
A source-tree scan would have PASSED on the 0.0.8 cut. The repo was clean; the
leak only came into existence when bin/stage-source-tree.sh tarred the working
tree and swept up 53,225 UNTRACKED files — including 121 agent session
transcripts (.papercusp/pi-sessions/*.jsonl) carrying the operator's home path
in every record. So the gate has to run against the built artifact, after the
tar, or it is measuring the wrong thing.

WHY IT EXISTS AT ALL, GIVEN stage-source-tree.sh HAS AN ALLOWLIST
-----------------------------------------------------------------
Defence in depth, and the allowlist is the thing most likely to drift: someone
adds a legitimate top-level dir, and untracked scratch rides in under it. The
allowlist decides what we MEAN to ship; this decides what we ACTUALLY shipped.
It is deliberately not the same mechanism.

Exit 0 = clean. Exit 1 = findings (the build MUST fail). Exit 2 = could not scan
(missing file / bad tar) — also fatal: an unscannable bundle is not a clean one.

Never prints a secret VALUE — findings are redacted to head…tail + length.

Usage:  audit-release-bundle.py <path/to/source.tar.zst> [--json]
"""
import json
import os
import pwd
import re
import socket
import subprocess
import sys
import tarfile

# ── PATH rules: applied to EVERY member. Cheap, and they catch the whole class
# that actually bit us (a scratch/state dir sweeping in wholesale).
FORBIDDEN_PATH = [
    ("agent-transcripts", re.compile(r"(^|/)pi-sessions/|(^|/)sessions/.*\.jsonl$")),
    ("papercusp-state-dir", re.compile(r"(^|/)\.papercusp/")),
    ("scratch-or-tmp", re.compile(r"(^|/)(scratch|scratchpad|test-results|\.agent-tmp|\.vitest-tmp|\.tmp|\.tmp-vitest[^/]*|\.pcv-socktest|\.nx)/")),
    ("agent-config", re.compile(r"(^|/)(\.claude|\.harness)/")),
    ("vcs", re.compile(r"(^|/)\.git/")),
    ("dotenv", re.compile(r"(^|/)\.env(\.|$)")),
    ("shell-rc", re.compile(r"(^|/)\.(bashrc|bash_profile|bash_history|profile|zshrc|zprofile)$")),
    ("credential-file", re.compile(r"(^|/)(\.npmrc|\.netrc|\.git-credentials|\.gitconfig|\.mcp\.json.*)$")),
    ("credential-dir", re.compile(r"(^|/)(\.ssh|\.aws|\.gnupg)/")),
    ("console-turd", re.compile(r"(^|/)\.papercup-console-active\.")),
    ("next-build-cache", re.compile(r"(^|/)\.next/")),
]

# ── CONTENT rules: real credential VALUES, not the word "secret".
CONTENT = [
    ("anthropic-key", re.compile(rb"sk-ant-(?:api|oat)[0-9]{2}-[A-Za-z0-9_\-]{40,}")),
    ("openai-key", re.compile(rb"sk-(?:proj-)?[A-Za-z0-9]{40,}")),
    ("github-token", re.compile(rb"gh[pousr]_[A-Za-z0-9]{36,}")),
    ("aws-secret-key", re.compile(rb"aws_secret_access_key\s*=\s*\S{30,}")),
    ("private-key-block", re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----\s*\n\s*\S")),
    ("slack-token", re.compile(rb"xox[abprs]-[A-Za-z0-9\-]{20,}")),
]

# Known-benign values that MUST NOT fail the build. Every entry is a documented
# false positive from the WI-4419 scan — keep this list short and justified.
BENIGN = [
    re.compile(rb"AKIAIOSFODNN7EXAMPLE"),        # AWS's own documentation placeholder
    re.compile(rb"sk-ant-(?:api|oat)[0-9]{2}-(?:test|fake|dummy|example)"),
]

# node_modules gets a REDUCED content scan, not none.
#
# The first cut of this file skipped node_modules content entirely (322k vendor
# files; credential-shaped files there are caught by the PATH rules). That was
# WRONG, and a peer's mac-side scan proved it: the mac Server bundle leaked the
# owner's home path in the CONTENT of 7 files and an email in 1, with nothing in
# the paths and no credentials anywhere. A path-only scan passes that bundle.
# Absolute build paths get baked into vendored trees constantly — .bin shims,
# sourcemaps, .package-lock.json, compile caches — so node_modules is exactly
# where machine identity hides.
#
# So: IDENTITY rules (username / home path / hostname) run over node_modules too.
# The email + credential rules do not — every vendor package.json carries a
# maintainer address, and that noise would train the reader to ignore the gate.
# A credential file landing in node_modules is still caught by the PATH rules.
VENDOR_PREFIX = ("./node_modules/", "node_modules/")
CONTENT_MAX_BYTES = 8 * 1024 * 1024


def identity_rules():
    """PII specific to THIS build machine, resolved at run time rather than
    hardcoded — the point is that a build on anyone's box scrubs THAT box."""
    rules = []
    user = pwd.getpwuid(os.getuid()).pw_name
    home = os.path.expanduser("~")
    host = socket.gethostname()
    if user and user not in ("root", "runner", "build"):
        rules.append(("build-user-name", re.compile(re.escape(user).encode())))
    if home and home not in ("/root", "/"):
        rules.append(("build-home-path", re.compile(re.escape(home).encode())))
    if host and not host.startswith(("runner", "ci-")):
        rules.append(("build-hostname", re.compile(re.escape(host).encode())))
    rules.append(("email-address", re.compile(rb"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")))
    return rules


def redact(b: bytes) -> str:
    s = b.decode("utf8", "replace")
    return f"{s[:8]}…{s[-4:]} (len {len(s)})" if len(s) > 16 else f"{s[:4]}… (len {len(s)})"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    path = sys.argv[1]
    as_json = "--json" in sys.argv
    if not os.path.isfile(path):
        print(f"AUDIT ERROR: no such bundle: {path}", file=sys.stderr)
        return 2

    ident = identity_rules()
    # Email is far too noisy for PATHS, and for VENDOR content (every package.json
    # carries a maintainer address). It applies to non-vendor content only.
    path_ident = [r for r in ident if r[0] != "email-address"]
    identity_only = path_ident

    findings = []   # (rule, member, detail)
    members = 0

    proc = subprocess.Popen(["zstd", "-dc", path], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for m in tf:
                members += 1
                name = m.name
                for rule, rx in FORBIDDEN_PATH:
                    if rx.search(name):
                        findings.append((rule, name, "forbidden path"))
                        break
                for rule, rx in path_ident:
                    if rx.search(name.encode("utf8", "replace")):
                        findings.append((rule, name, "identity in PATH"))
                        break

                if not m.isfile() or m.size > CONTENT_MAX_BYTES:
                    continue
                # Vendor: identity only (see VENDOR_PREFIX note). Everything else:
                # the full rule set.
                rules = identity_only if name.startswith(VENDOR_PREFIX) else CONTENT + ident
                f = tf.extractfile(m)
                if f is None:
                    continue
                blob = f.read()
                if b"\0" in blob[:4096]:
                    continue  # binary
                for rule, rx in rules:
                    for hit in rx.findall(blob):
                        if any(b.search(hit) for b in BENIGN):
                            continue
                        findings.append((rule, name, redact(hit)))
                        break
    finally:
        proc.stdout.close()
        proc.wait()

    # Collapse: one line per (rule, top-level dir), with a count + an example.
    grouped = {}
    for rule, name, detail in findings:
        top = "/".join(name.split("/")[:3]) if name.startswith("./") else name.split("/")[0]
        g = grouped.setdefault((rule, top), {"n": 0, "eg": detail, "member": name})
        g["n"] += 1

    if as_json:
        print(json.dumps({
            "bundle": path, "members": members, "findings": len(findings),
            "groups": [{"rule": r, "under": t, "count": g["n"], "example_member": g["member"], "detail": g["eg"]}
                       for (r, t), g in sorted(grouped.items(), key=lambda kv: -kv[1]["n"])],
        }, indent=2))
    else:
        print(f"==> auditing {os.path.basename(path)} — {members:,} members")
        if not findings:
            print("    ✓ CLEAN — no forbidden paths, credentials, or build-machine identity found")
        else:
            print(f"    ✗ {len(findings):,} FINDING(S) — this bundle MUST NOT ship\n")
            for (rule, top), g in sorted(grouped.items(), key=lambda kv: -kv[1]["n"]):
                print(f"  [{rule}]  {g['n']:,}×  under {top}")
                print(f"      e.g. {g['member']}")
                if g["eg"] not in ("forbidden path", "identity in PATH"):
                    print(f"           -> {g['eg']}")
            print("\n  Fix the SOURCE of the leak (bin/stage-source-tree.sh's allowlist), not this")
            print("  audit. Adding an exception here to make the build pass is the bug, not the fix.")

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())

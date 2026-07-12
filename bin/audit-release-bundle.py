#!/usr/bin/env python3
"""audit-release-bundle.py — WI-4419. The release bundle's LAST GATE.

Answers ONE question about the thing we are actually about to ship: does it
contain anything that must never leave this machine?

WHY IT SCANS THE ARTIFACT AND NOT THE REPO
------------------------------------------
A source-tree scan would have PASSED on the 0.0.8 cut. The repo was clean; the
leak only came into existence when bin/stage-source-tree.sh tarred the working
tree and swept up 53,225 UNTRACKED files — including 121 agent session
transcripts (.papercusp/pi-sessions/*.jsonl) carrying the operator's home path in
every record. So the gate runs against the built artifact, after the tar, or it
is measuring the wrong object.

WHY IT MUST SCAN CONTENT, NOT JUST PATHS
----------------------------------------
The mac Server bundle leaked the owner's home path in the CONTENT of 7 files and
an email in 1 — with nothing in the filenames and no credentials anywhere. A
path-only scan passes that bundle. Absolute build paths get baked into vendored
trees constantly (.bin shims, sourcemaps, .package-lock.json, compile caches), so
node_modules is exactly where machine identity hides — it is scanned, not skipped.

WHY IDENTITY IS A SET OF LITERALS
---------------------------------
"Personal information" here means THIS BUILD BOX: its unix user, its home path,
its hostname, its git identity. Those are literal strings, resolved at run time,
so a build on anyone's machine scrubs THAT machine. Deliberately NOT a generic
email/name regex: that matches a maintainer address in every vendor package.json,
and a gate that cries wolf on every build is a gate someone switches off.

PERFORMANCE — why this shells out instead of using Python's tarfile
-------------------------------------------------------------------
Streaming the 9GB tar through Python's tarfile took >18 minutes. `zstd -dc | tar
-tf -` over the same bytes takes 23 SECONDS: the cost was ~50x Python interpreter
overhead, not the data. So the hot paths are C (zstd | tar | grep) and Python only
decides. A slow gate gets disabled, which makes it worse than no gate.

Three phases, cheapest first:
  A. PATHS    — `tar -tf` (~25s). Forbidden dirs/files, identity in filenames.
  B. CONTENT  — `tar -xO | grep` (~1-3min). Identity literals + credential values.
  C. ATTRIBUTE— only if B found something: the slow per-file pass, to name the
                offending files. A failing build can afford the minutes; a
                passing one cannot.

Exit 0 clean · 1 findings (build MUST fail) · 2 unscannable (also fatal — an
unscannable bundle is not a clean one). Never prints a secret VALUE.

Usage:  audit-release-bundle.py <path/to/source.tar.zst>
"""
import os
import pwd
import re
import shutil
import socket
import subprocess
import sys
import tarfile

# ── PATH rules — the class that actually bit us: a scratch/state dir sweeping in
# wholesale. Cheap, and applied to every member name.
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

# ── CONTENT: real credential VALUES (grep -E, C speed). Not the word "secret".
CREDENTIAL_ERE = [
    ("anthropic-key", r"sk-ant-(api|oat)[0-9]{2}-[A-Za-z0-9_-]{40,}"),
    ("openai-key", r"sk-(proj-)?[A-Za-z0-9]{40,}"),
    ("github-token", r"gh[pousr]_[A-Za-z0-9]{36,}"),
    ("aws-secret-key", r"aws_secret_access_key[[:space:]]*=[[:space:]]*[^[:space:]]{30,}"),
    ("slack-token", r"xox[abprs]-[A-Za-z0-9-]{20,}"),
]

# Documented false positives from the WI-4419 sweep. Keep short and justified —
# this is NOT a parking lot for findings you would rather not deal with.
BENIGN_ERE = [
    r"AKIAIOSFODNN7EXAMPLE",                        # AWS's own doc placeholder
    r"sk-ant-(api|oat)[0-9]{2}-(test|fake|dummy|example)",
]


def identity_literals():
    """Machine identity as LITERAL strings, resolved from the box doing the build."""
    lits = {}
    try:
        user = pwd.getpwuid(os.getuid()).pw_name
        if user and user not in ("root", "runner", "build", "ubuntu"):
            lits["build-user-name"] = user
    except Exception:
        pass
    home = os.path.expanduser("~")
    if home and home not in ("/root", "/", "/home"):
        lits["build-home-path"] = home
    host = socket.gethostname()
    if host and not host.startswith(("runner", "ci-", "localhost")):
        lits["build-hostname"] = host
    for key, cfg in (("build-git-email", "user.email"), ("build-git-name", "user.name")):
        try:
            v = subprocess.run(["git", "config", "--get", cfg], capture_output=True,
                               text=True, timeout=5).stdout.strip()
            # A one- or two-char name would match half the bundle; require substance.
            if v and len(v) >= 4:
                lits[key] = v
        except Exception:
            pass
    return lits


def sh(cmd, **kw):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True, **kw)


def phase_a_paths(bundle, lits):
    """Member names. ~25s for 444k members."""
    r = sh(f"zstd -dc {q(bundle)} | tar -tf -")
    if r.returncode != 0:
        print(f"AUDIT ERROR: cannot list bundle: {r.stderr.strip()[:300]}", file=sys.stderr)
        sys.exit(2)
    names = r.stdout.splitlines()
    hits = []
    for name in names:
        for rule, rx in FORBIDDEN_PATH:
            if rx.search(name):
                hits.append((rule, name))
                break
        else:
            for rule, lit in lits.items():
                if lit in name:
                    hits.append((rule + " (in path)", name))
                    break
    return len(names), hits


def phase_b_content(bundle, lits):
    """Concatenated content through C grep. No filenames — that is phase C's job."""
    # Every interpolated value is shell-quoted via q() — including git user.name,
    # which is attacker-ish only in the sense that it is arbitrary user config.
    pats = [f"-e {q(p)}" for _, p in CREDENTIAL_ERE]
    lit_pats = [f"-e {q(re.escape(v))}" for v in lits.values()]
    if not pats and not lit_pats:
        return []
    benign = " ".join(f"-e {q(b)}" for b in BENIGN_ERE)
    grep = f"grep -aoE {' '.join(pats + lit_pats)}"
    # Filter the documented benign values out of the stream before we judge.
    cmd = f"zstd -dc {q(bundle)} | tar -xOf - | {grep} | grep -avE {benign} | sort | uniq -c | sort -rn"
    r = sh(cmd)
    out = [l.strip() for l in r.stdout.splitlines() if l.strip()]
    found = []
    rev = {v: k for k, v in lits.items()}
    for line in out:
        n, _, val = line.partition(" ")
        val = val.strip()
        rule = rev.get(val)
        if rule is None:
            for name, pat in CREDENTIAL_ERE:
                if re.fullmatch(pat.replace("[[:space:]]", r"\s"), val):
                    rule = name
                    break
        found.append((rule or "credential-or-identity", int(n), val))
    return found


def phase_c_attribute(bundle, lits, wanted):
    """Only on a failing build: name the offending files. Slow, and that is fine."""
    needles = [(r, v.encode()) for r, _, v in wanted]
    out = []
    proc = subprocess.Popen(["bash", "-c", f"zstd -dc {q(bundle)} | cat"], stdout=subprocess.PIPE)
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for m in tf:
                if not m.isfile() or m.size > 8 * 1024 * 1024:
                    continue
                f = tf.extractfile(m)
                if f is None:
                    continue
                blob = f.read()
                if b"\0" in blob[:4096]:
                    continue
                for rule, needle in needles:
                    if blob.find(needle) != -1:
                        out.append((rule, m.name))
                        break
                if len(out) >= 200:
                    break
    finally:
        proc.stdout.close()
        proc.wait()
    return out


def q(s):
    return "'" + str(s).replace("'", "'\\''") + "'"


def redact(v):
    return f"{v[:8]}…{v[-4:]} (len {len(v)})" if len(v) > 16 else f"{v[:3]}… (len {len(v)})"


def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    bundle = sys.argv[1]
    if not os.path.isfile(bundle):
        print(f"AUDIT ERROR: no such bundle: {bundle}", file=sys.stderr)
        return 2
    for tool in ("zstd", "tar", "grep"):
        if not shutil.which(tool):
            print(f"AUDIT ERROR: {tool} not on PATH — cannot scan", file=sys.stderr)
            return 2

    lits = identity_literals()
    print(f"==> auditing {os.path.basename(bundle)}")
    print(f"    identity of this build box: {', '.join(sorted(lits)) or '(none resolved)'}")

    members, path_hits = phase_a_paths(bundle, lits)
    print(f"    [A] paths    — {members:,} members, {len(path_hits):,} finding(s)")

    content_hits = phase_b_content(bundle, lits)
    print(f"    [B] content  — {len(content_hits):,} distinct value(s) matched")

    if not path_hits and not content_hits:
        print("    ✓ CLEAN — no forbidden paths, no build-box identity, no credentials")
        return 0

    print(f"\n    ✗ THIS BUNDLE MUST NOT SHIP\n")

    if path_hits:
        grouped = {}
        for rule, name in path_hits:
            top = "/".join(name.split("/")[:3])
            g = grouped.setdefault((rule, top), {"n": 0, "eg": name})
            g["n"] += 1
        print("  FORBIDDEN PATHS")
        for (rule, top), g in sorted(grouped.items(), key=lambda kv: -kv[1]["n"]):
            print(f"    [{rule}]  {g['n']:,}×  under {top}")
            print(f"        e.g. {g['eg']}")

    if content_hits:
        print("\n  IN FILE CONTENT")
        for rule, n, val in content_hits[:20]:
            shown = val if rule.startswith("build-") else redact(val)
            print(f"    [{rule}]  {n:,}×  {shown}")
        print("\n  attributing to files (slow pass — only runs on a failing build)…")
        for rule, name in phase_c_attribute(bundle, lits, content_hits)[:40]:
            print(f"    {rule:24s} {name}")

    print("\n  Fix the SOURCE — the allowlist in bin/stage-source-tree.sh. Do NOT add an")
    print("  exception here to make the build pass: that is the bug this gate exists to catch.")
    return 1


if __name__ == "__main__":
    sys.exit(main())

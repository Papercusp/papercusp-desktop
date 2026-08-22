#!/usr/bin/env python3
"""
scan-discarded-measurements.py — find the "computed here, reported there" defect.

THE CLASS (3 independent sightings in one night: D-038's recheck caveat,
WI-40534, WI-40542):

    absent="$(rig_assert_absent b "$FPOST" 30)"   # line N — 30s measurement PAID
    ...
    [ "$crypto_ok" = 1 ] || return 1              # early return between N and M
    ...
    echo "behavioral: $absent"                    # line M — NEVER REACHED

On any path taking that early return, the measurement is computed and silently
discarded. In a log it looks like a FAIL for one leg and NOTHING for its
sibling — which reads as "no problem found" and actually means "never
reported". That is the whole danger: absence of evidence rendered as evidence
of absence.

This is a CANDIDATE GENERATOR, not a verdict. Some intervening returns are
legitimately unreachable before the use, and some measurements are genuinely
optional. Every hit needs a human read. It exists so the fourth instance is
found by a machine instead of by an incident.

Exit 0 = no candidates. Exit 1 = candidates found (advisory).
"""

import re
import sys
from pathlib import Path

# A measurement is a command substitution — it costs something to produce.
ASSIGN = re.compile(
    r"""^\s*(?:local\s+(?:-\w+\s+)?)?   # optional `local`
         ([A-Za-z_][A-Za-z0-9_]*)       # 1: variable name
         =(.*\$\(.*)$                   # 2: RHS containing a command substitution
    """,
    re.VERBOSE,
)
FUNC_START = re.compile(r"^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_:.-]*)\s*\(\)\s*\{")
RETURN_OR_EXIT = re.compile(r"^\s*(?:return|exit)\b")

# Assignments that are bookkeeping rather than measurement — a discarded `rc`
# or loop counter is not the defect this hunts.
BORING = {"rc", "now", "ts", "i", "n", "tmp", "tmpdir", "d", "dir", "pid"}


def leading_ws(line: str) -> int:
    return len(line) - len(line.lstrip())


def scan(path: Path):
    lines = path.read_text(errors="replace").splitlines()
    hits = []

    # Locate function extents by brace depth so we never cross a function
    # boundary when looking for the consuming line.
    funcs = []
    for idx, line in enumerate(lines):
        m = FUNC_START.match(line)
        if not m:
            continue
        depth = 0
        for j in range(idx, len(lines)):
            depth += lines[j].count("{") - lines[j].count("}")
            if depth <= 0 and j > idx:
                funcs.append((m.group(1), idx, j))
                break

    for fname, fstart, fend in funcs:
        for n in range(fstart, fend + 1):
            line = lines[n]
            if line.lstrip().startswith("#"):
                continue
            m = ASSIGN.match(line)
            if not m:
                continue
            var, rhs = m.group(1), m.group(2)
            if var.lower() in BORING:
                continue

            use_re = re.compile(r"\$\{?" + re.escape(var) + r"\b")
            first_use = None
            for k in range(n + 1, fend + 1):
                if lines[k].lstrip().startswith("#"):
                    continue
                if use_re.search(lines[k]):
                    first_use = k
                    break
            if first_use is None:
                continue

            # A return between assignment and first use, at a nesting level at
            # or shallower than the assignment, is reachable without consuming
            # the measured value.
            assign_indent = leading_ws(line)
            blockers = [
                k
                for k in range(n + 1, first_use)
                if RETURN_OR_EXIT.match(lines[k])
                and not lines[k].lstrip().startswith("#")
                and leading_ws(lines[k]) <= assign_indent + 2
            ]
            if blockers:
                hits.append(
                    {
                        "func": fname,
                        "var": var,
                        "assigned": n + 1,
                        "first_use": first_use + 1,
                        "gap": first_use - n,
                        "returns": [k + 1 for k in blockers],
                        "rhs": rhs.strip()[:90],
                    }
                )
    return hits


def main(argv):
    roots = argv[1:] or [
        str(Path(__file__).resolve().parent / "scenarios"),
    ]
    files = []
    for r in roots:
        p = Path(r)
        files.extend(sorted(p.glob("*.sh")) if p.is_dir() else [p])

    total = 0
    for f in files:
        hits = scan(f)
        if not hits:
            continue
        print(f"\n=== {f} ===")
        for h in hits:
            total += 1
            print(
                f"  {h['func']}(): ${h['var']} measured at L{h['assigned']}, "
                f"first used at L{h['first_use']} (gap {h['gap']} lines)"
            )
            print(f"      intervening return/exit at: {h['returns']}")
            print(f"      rhs: {h['rhs']}")

    print(f"\nscanned {len(files)} file(s) — {total} candidate(s)")
    if total:
        print(
            "\nCANDIDATES ARE NOT VERDICTS. For each, ask: can that return execute\n"
            "on a run where the measurement mattered? If yes, emit the verdict AT\n"
            "the point of measurement, in THREE states (no / yes / UNMEASURED) —\n"
            "never two, because the missing third is what reads as a clean result."
        )
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

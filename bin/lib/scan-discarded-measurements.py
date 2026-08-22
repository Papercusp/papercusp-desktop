#!/usr/bin/env python3
"""
scan-discarded-measurements.py — find the "computed here, reported there" defect.

THE CLASS (3 independent sightings in one night: D-038's recheck caveat,
WI-40534, WI-40542):

    local absent; absent="$(rig_assert_absent b "$FPOST" 30)"   # L124 — 30s PAID
    ...
    [ "$crypto_ok" = 1 ] || return 1                            # early return
    ...
    echo "behavioral: $absent"                                  # L233 — NEVER REACHED

On any path taking that early return the measurement is computed and silently
discarded. In a log it looks like a FAIL for one leg and NOTHING for its
sibling — which reads as "no problem found" and actually means "never
reported". Absence of evidence rendered as evidence of absence.

This is a CANDIDATE GENERATOR, not a verdict. Some intervening returns are
legitimately unreachable before the use. Every hit needs a human read.

--------------------------------------------------------------------------
WHY --self-test EXISTS, AND WHY IT RUNS BY DEFAULT
--------------------------------------------------------------------------
The first version of this scanner was start-anchored (`^\\s*(?:local\\s+)?...`)
and therefore could not see `local X; X=$(...)` — the exact idiom of the
canonical WI-40542 line. It scanned the whole library, reported 4 candidates,
and MISSED the one defect we already knew was there.

A detector blind to the shape it was built to find is itself an instance of
this class. So the control is embedded here permanently and runs before every
scan: if it ever stops firing, "0 candidates" means the instrument is broken,
not that the library is clean.

Exit 0 = control passed, no candidates.
Exit 1 = control passed, candidates found (advisory).
Exit 2 = CONTROL FAILED — the scan result is meaningless, fix the scanner.
"""

import re
import sys
import tempfile
from pathlib import Path

# Matches an assignment ANYWHERE in the line, not just at its start, so the
# common `local X; X=$(...)` compound statement is visible. See the module
# docstring: an anchored version of this regex is what made the scanner blind.
ASSIGN = re.compile(
    r"""(?:^|;|&&|\|\||\bthen\b|\bdo\b|\s)              # statement boundary
         (?:local\s+|declare\s+|export\s+|readonly\s+)?  # optional declarator
         ([A-Za-z_][A-Za-z0-9_]*)                        # 1: variable name
         =("?\$\(.*)                                     # 2: RHS w/ command substitution
    """,
    re.VERBOSE,
)
FUNC_START = re.compile(r"^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_:.-]*)\s*\(\)\s*\{")

# Also NOT line-anchored, and for the same reason as ASSIGN above — this is the
# second half of the same blindness. In the real scenarios essentially every
# early return is mid-line:
#
#     echo "revocation: K-CUT FAILED — ..."; return 1
#     ''|*[!0-9]*) echo "... not a pass"; return 1 ;;
#     [ "$ok" = 1 ] || return 1
#
# A `^\\s*return` regex sees NONE of those. Both regexes in this file were
# start-anchored initially, and both silently reported the library clean.
RETURN_OR_EXIT = re.compile(
    r"(?:^|;|&&|\|\||\bthen\b|\bdo\b|\belse\b|\)\s)\s*(?:return|exit)\b"
)

# Bookkeeping rather than measurement — a discarded `rc` or loop counter is not
# the defect this hunts.
BORING = {"rc", "now", "ts", "i", "n", "tmp", "tmpdir", "d", "dir", "pid"}

# The canonical WI-40542 shape, kept as a permanent control. Copied faithfully
# from the real pre-fix b3-revocation.sh, INCLUDING the two details that each
# independently blinded an earlier version of this scanner:
#   1. `local X; X="$(...)"` — a compound statement, so the assignment is not
#      at the start of the line;
#   2. `echo "..."; return 1` and `case) ...; return 1 ;;` — mid-line returns,
#      so the early return is not at the start of the line either.
# A control that omits either detail passes while the scanner is blind, which
# is exactly how the first version reported "0 candidates" on a file whose
# defect we already knew by line number.
CONTROL = '''#!/usr/bin/env bash
scn_control_defect() {
  local crypto_ok="$1"
  local absent; absent="$(rig_assert_absent b "$FPOST" 30)"
  case "${maxep:-}" in
    ''|*[!0-9]*) echo "K-CUT UNMEASURED — could not read max epoch"; return 1 ;;
  esac
  if [ "$crypto_ok" != 1 ]; then
    echo "K-CUT FAILED — banned member still holds a key"; return 1
  fi
  echo "  behavioral leg: $absent"
  return 0
}
'''

# A near-miss that must NOT fire: measured, then consumed BEFORE any return.
CALIBRATION = '''#!/usr/bin/env bash
scn_control_clean() {
  local absent; absent="$(rig_assert_absent b "$FPOST" 30)"
  echo "  behavioral leg: $absent"
  if [ "$1" != 1 ]; then
    return 1
  fi
  return 0
}
'''


def leading_ws(line: str) -> int:
    return len(line) - len(line.lstrip())


def find_functions(lines):
    """(name, start_idx, end_idx) for each function, by brace depth."""
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
    return funcs


def scan_text(text: str):
    lines = text.splitlines()
    hits = []
    for fname, fstart, fend in find_functions(lines):
        for n in range(fstart, fend + 1):
            line = lines[n]
            if line.lstrip().startswith("#"):
                continue
            for m in ASSIGN.finditer(line):
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

                # A return between assignment and first use, at a nesting level
                # at or shallower than the assignment, is reachable without the
                # measured value ever being consumed.
                assign_indent = leading_ws(line)
                blockers = [
                    k
                    for k in range(n + 1, first_use)
                    # .search(), NOT .match() — .match() anchors at position 0
                    # and would re-introduce the start-anchored blindness a
                    # third time, at the call site rather than in the pattern.
                    if RETURN_OR_EXIT.search(lines[k])
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


def self_test(verbose=True):
    """The control MUST fire and the calibration MUST NOT."""
    defect = scan_text(CONTROL)
    clean = scan_text(CALIBRATION)
    ok = len(defect) == 1 and len(clean) == 0
    if verbose or not ok:
        print("── self-test (WI-40542 canonical shape) ──")
        print(f"  control (must fire):      {len(defect)} hit(s) "
              f"{'✓' if len(defect) == 1 else '✗ SCANNER IS BLIND'}")
        print(f"  calibration (must NOT):   {len(clean)} hit(s) "
              f"{'✓' if len(clean) == 0 else '✗ SCANNER OVER-FIRES'}")
    return ok


def main(argv):
    args = [a for a in argv[1:] if a != "--self-test"]
    only_self_test = "--self-test" in argv

    if not self_test(verbose=only_self_test):
        print(
            "\nCONTROL FAILED — this scanner cannot see the defect it exists to find.\n"
            "Any '0 candidates' result from it is meaningless. Fix the scanner first.",
            file=sys.stderr,
        )
        return 2
    if only_self_test:
        return 0

    roots = args or [str(Path(__file__).resolve().parent / "scenarios")]
    files = []
    for r in roots:
        p = Path(r)
        files.extend(sorted(p.glob("*.sh")) if p.is_dir() else [p])

    total = 0
    for f in files:
        hits = scan_text(Path(f).read_text(errors="replace"))
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

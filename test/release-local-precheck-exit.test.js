// release-local.sh is NOT a read-only script, and its first ~550 lines read as
// though it is: version validation, channel validation, provenance, submodule
// freshness, migration boot-smoke, build-set completeness. The first statement
// that touches the shared working tree is the version bump, which writes FOUR
// tracked files.
//
// WHY THIS GUARD EXISTS (2026-08-09). An agent verifying preflight guards near
// the top of the script ran it as a probe (`release-local.sh 9.9.9 alpha`),
// expecting an early refusal. Nothing refuses an alpha cut, so it ran on to the
// version bump and stamped 9.9.9 into all four manifests. On this shared tree
// that is not a local mistake:
//
//   * git-sync swept it into a commit inside a minute, so `git status` was
//     clean afterwards — the state in which an edited file and an untouched one
//     are indistinguishable;
//   * every running `tauri dev` watches this same source tree, so the write to
//     src-tauri/tauri.conf.json rebuilt and restarted EVERY desktop on the box,
//     the owner's included. Target-dir isolation does not prevent that — a slot
//     lock guards the generated app-manifest from concurrent writers, not the
//     watched source tree.
//
// The fix is PAPERCUSP_RELEASE_PRECHECK_ONLY=1, which exits after every gate and
// before the first write. This file pins the one property that makes it worth
// anything: THE EXIT IS ABOVE THE FIRST WRITE. An exit that drifts below the
// version bump still prints "nothing has been modified" and is silently a lie —
// the failure would look exactly like success, which is why ordering is checked
// mechanically rather than left to review.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const SCRIPT = path.join(root, 'bin', 'release-local.sh');
const src = () => fs.readFileSync(SCRIPT, 'utf8');

/** 1-based line index of the first line matching `re`, or -1. */
function firstLine(text, re) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return -1;
}

// The files the version-bump block itself WRITES. Named here so that adding a
// fourth without moving the precheck exit above it is a visible edit to this
// list, not an invisible widening of the blast radius.
//
// Cargo.lock is deliberately NOT in this list, and the distinction is load-
// bearing rather than pedantic: the bump writes three files, and Cargo.lock
// picks the version up LATER, when some cargo invocation re-resolves it from
// Cargo.toml. It still ends up carrying the version — that is how it reached
// 9.9.9 in the incident — but it is downstream of Cargo.toml, not a fourth
// write here. Listing it as one made this very test fail against a correct
// script, which is the sort of false red that gets a guard deleted.
const WRITTEN_MANIFESTS = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/tauri.conf.json'];

/** The line of the actual `if` branch — NOT the header comment that names it. */
const PRECHECK_BRANCH = /if \[\[ "\$\{PAPERCUSP_RELEASE_PRECHECK_ONLY:-0\}" == "1" \]\]/;

test('the precheck-only exit exists and is reachable', () => {
  const text = src();
  // Anchor on the BRANCH, not on any mention of the variable: the header
  // documents it ~500 lines earlier, so a bare name match lands in a comment
  // and then reports the branch missing when it is present and correct.
  const guard = firstLine(text, PRECHECK_BRANCH);
  assert(guard > 0, 'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch has been removed from bin/release-local.sh');
  assert(
    /exit 0/.test(text.split('\n').slice(guard - 1, guard + 8).join('\n')),
    'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch no longer exits 0',
  );
});

test('the precheck exit is ABOVE the version bump — the first tree write', () => {
  const text = src();
  const guard = firstLine(text, /if \[\[ "\$\{PAPERCUSP_RELEASE_PRECHECK_ONLY:-0\}" == "1" \]\]/);
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);

  assert(guard > 0, 'the PAPERCUSP_RELEASE_PRECHECK_ONLY branch was removed or reworded');
  assert(bump > 0, 'the version-bump step was removed or reworded — re-derive what the first tree write now is');
  assert(
    guard < bump,
    `the precheck exit (line ${guard}) is BELOW the version bump (line ${bump}). A precheck run would ` +
      `write the manifests and then claim "nothing has been modified" — a false green that restarts ` +
      `every desktop on the box.`,
  );
});

test('the version bump really is the first write, and it writes what we think', () => {
  const text = src();
  const bump = firstLine(text, /^echo "==> bumping version in manifests"/);
  // The python heredoc immediately below the banner is what performs the write.
  const block = text.split('\n').slice(bump - 1, bump + 40).join('\n');
  for (const f of WRITTEN_MANIFESTS) {
    const leaf = f.split('/').pop();
    assert(
      block.includes(leaf),
      `the version bump no longer mentions ${f} — if the set of written files changed, re-check that ` +
        `the precheck exit is still above ALL of them`,
    );
  }
});

test('the header warns that this script is not read-only', () => {
  // The guard above makes the safe run EXIST; this makes it DISCOVERABLE. The
  // trap was never that the writes were hidden — it was that nothing told the
  // reader to expect them before reaching them.
  const head = src().split('\n').slice(0, 60).join('\n');
  assert(
    /NOT READ-ONLY/i.test(head),
    "release-local.sh's header no longer warns that it writes to the shared tree",
  );
  assert(
    /PAPERCUSP_RELEASE_PRECHECK_ONLY/.test(head),
    "release-local.sh's header no longer names the precheck-only escape hatch",
  );
});

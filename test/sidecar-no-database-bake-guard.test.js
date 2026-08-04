// P-011 (plan memory-corpus-hygiene-and-release-distribution-2026-08-03) —
// bin/build-desktop-sidecar.sh must never bake a DATABASE DUMP into the shipped
// bundle, and the republish overlay carry-forward must stay an ALLOWLIST.
//
// WHY THIS TEST EXISTS
// The script used to `pg_dump` an entire database into $SIDECAR_DIR/seed.dump
// whenever PAPERCUSP_SEED_PG_URL was set — no shareable filter, no exclusion of
// personal memory, no pack review. Every engineer issue, coord message, plan and
// memory row in that database would have shipped inside a public desktop bundle.
// EI-19455334533123459 deleted the bake on 2026-08-03 (its consumer, the
// pg_restore branch, had been gone since D-004), which is a STRONGER outcome than
// P-011 asked for: it wanted the bake to "refuse by default", and instead the
// producer no longer exists.
//
// But that removal left only a COMMENT. Nothing prevents the class returning, and
// the class is quiet: a re-added bake produces a bundle that builds, verifies and
// ships green — the only symptom is data in a public artifact, which no existing
// check looks for. This test is the recurrence guard the removal did not land.
//
// It reads the REAL script rather than a copy, so re-introducing the bake — under
// any filename — fails here.
//
// ⚠ THE PRECISION POINT, for whoever edits this next: the script LEGITIMATELY
// bundles the pg_dump/pg_restore BINARIES into sidecar/bin (the snapshot
// subsystem spawns `pg_dump` by bare name — see the wiring near "wiring pg_dump /
// psql into $SIDECAR_DIR/bin"). So "the script mentions pg_dump" is NOT the
// defect and a naive grep for it would fire constantly and then be deleted for
// crying wolf. What is forbidden is RUNNING a dump to WRITE a data artifact into
// the bundle. These assertions target the written artifact, not the tool.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.resolve(__dirname, '../bin/build-desktop-sidecar.sh');
const script = fs.readFileSync(scriptPath, 'utf8');

/** Lines with the comment body and blank lines removed — i.e. what actually RUNS. */
function executableLines() {
  return script
    .split('\n')
    .map((line, i) => ({ n: i + 1, text: line }))
    .filter(({ text }) => text.trim() !== '' && !text.trim().startsWith('#'));
}

test('no database dump artifact is written into the shipped bundle', () => {
  // A dump baked into the bundle is a data artifact, whatever it is called. The
  // tombstone comment retains the words "seed.dump", so restrict to lines that RUN.
  const offenders = executableLines().filter(({ text }) => /\.dump\b/.test(text));
  assert.deepEqual(
    offenders.map(({ n, text }) => `${n}: ${text.trim()}`),
    [],
    'build-desktop-sidecar.sh writes a .dump artifact into the bundle. A database dump ' +
      'in a public desktop bundle ships every engineer issue, coord message, plan and ' +
      'memory row with no pack review (P-011). If a build-time data seed is genuinely ' +
      'needed again, restore its CONSUMER first and gate it on a shareable filter.',
  );
});

test('the PAPERCUSP_SEED_PG_URL bake knob does not come back', () => {
  // The env var that armed the bake. Its mere presence means a dump path exists.
  assert.equal(
    /PAPERCUSP_SEED_PG_URL/.test(script),
    false,
    'PAPERCUSP_SEED_PG_URL is back in build-desktop-sidecar.sh — it armed the seed.dump ' +
      'bake that EI-19455334533123459 removed.',
  );
});

test('republish overlay carry-forward stays an ALLOWLIST, never a blanket copy', () => {
  // WI-3346 preserves release-staged overlays from the OUTGOING bundle into the new
  // one so a concurrent `npm run tauri dev` republish cannot clobber a release
  // mid-build. That carry-forward is the second half of P-011: it is the mechanism
  // by which a once-baked artifact would silently ride into every LATER build,
  // outliving the code that produced it.
  //
  // It is currently safe because it enumerates exactly two literal names. Widening
  // it to a glob would restore the carry-forward hazard for ANY stray file — and
  // would look like a tidy generalisation while doing so.
  const loop = script.match(/for\s+_overlay\s+in\s+([^\n;]+)/);
  assert.notEqual(loop, null, 'the WI-3346 overlay preservation loop is gone — re-check P-011 if it moved');

  const entries = loop[1].trim().split(/\s+/);
  assert.deepEqual(
    entries,
    ['source.tar.zst', 'env-sidecars'],
    'the republish overlay carry-forward is no longer the two-entry allowlist. Anything ' +
      'listed here survives from the OUTGOING bundle into every later build, so a data ' +
      'artifact added here (or a glob such as "$OLD_DIR"/*) would outlive the code that ' +
      'produced it — exactly the silent carry-forward P-011 names.',
  );

  // And the copy must address ONE named entry, not expand the outgoing tree.
  assert.equal(
    /cp -a "\$OLD_DIR"\/[*.]/.test(script),
    false,
    'the overlay preservation copies the outgoing tree wholesale instead of one named ' +
      'entry — every stray artifact in the old bundle would now ride forward.',
  );
});

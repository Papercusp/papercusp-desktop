// P-011 (plan memory-corpus-hygiene-and-release-distribution-2026-08-03) —
// bin/build-desktop-sidecar.sh must never bake a LIVE/EXTERNAL DATABASE DUMP
// into the shipped bundle, and republish carry-forward stays an ALLOWLIST.
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
// WI-39304 introduces one deliberately different artifact: db-seed.dump is made
// from a throwaway initdb that applies ONLY the repository's shipped migrations.
// It accepts no database URL/live source and the runtime restores it only after
// a fresh per-install initdb, preserving system_identifier isolation. This test
// admits exactly that hermetic producer while retaining the blanket rejection for
// every other .dump path or configurable database source.
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
const seedBuilderPath = path.resolve(
  __dirname,
  '../../libs/papercusp/packages/embedded-postgres-server/bin/build-seed.mjs',
);
const seedBuilder = fs.readFileSync(seedBuilderPath, 'utf8');

/** Lines with the comment body and blank lines removed — i.e. what actually RUNS. */
function executableLines(source = script) {
  return source
    .split('\n')
    .map((line, i) => ({ n: i + 1, text: line }))
    .filter(({ text }) => text.trim() !== '' && !text.trim().startsWith('#'));
}

test('the sole database dump artifact is the hermetic migration-only logical seed', () => {
  // Preserve the blanket rule: every executable .dump reference must name the
  // one reviewed filename. A future live.dump / snapshot.dump is still red.
  const dumpLines = executableLines().filter(({ text }) => /\.dump\b/.test(text));
  const offenders = dumpLines.filter(({ text }) => !/\bdb-seed\.dump\b/.test(text));
  assert.deepEqual(
    offenders.map(({ n, text }) => `${n}: ${text.trim()}`),
    [],
    'build-desktop-sidecar.sh writes a non-reviewed .dump artifact. Only db-seed.dump ' +
      'from the hermetic migration-only producer is allowed; any other database dump ' +
      'can ship engineer issues, coord, plans, and memory rows (P-011).',
  );
  assert.ok(dumpLines.length > 0, 'the WI-39304 logical seed writer disappeared; re-check this contract');

  const writers = dumpLines.filter(({ text }) => /--out\s+"\$SIDECAR_DIR\/db-seed\.dump"/.test(text));
  assert.equal(writers.length, 1, 'db-seed.dump must have exactly one build writer');

  // The writer receives only a fresh mktemp PGDATA and the already-staged,
  // repository-authored migration directory. No live database URL can enter.
  assert.match(script, /_seed_tmp="\$\(mktemp -d\)"/);
  assert.match(script, /--data\s+"\$_seed_tmp\/pgdata"/);
  assert.match(script, /--sql\s+"\$SIDECAR_DIR\/db-sql"/);
  assert.match(script, /--pg-dump\s+"\$SIDECAR_DIR\/bin\/pg_dump"/);
  assert.doesNotMatch(script, /PAPERCUSP_SEED_PG_URL|DATABASE_URL/);

  // The called producer destroys/recreates its temp data dir, force-disables
  // seed inheritance, boots the real migration path, and emits a logical archive
  // without ownership/physical cluster metadata.
  assert.match(seedBuilder, /PAPERCUSP_PG_DISABLE_SEED\s*=\s*['"]1['"]/);
  assert.match(seedBuilder, /rm\(dataDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}/);
  assert.match(seedBuilder, /startEmbeddedPostgresServer\(\{\s*dataDir,\s*port,\s*dbSqlDir:\s*sqlDir/);
  assert.match(seedBuilder, /--format=custom/);
  assert.match(seedBuilder, /--no-owner/);
  assert.doesNotMatch(seedBuilder, /PAPERCUSP_SEED_PG_URL|DATABASE_URL|--url\b/);
});

test('the dump-path detector remains falsifiable for an arbitrary live-store artifact', () => {
  const poisoned = `${script}\npg_dump --file "$SIDECAR_DIR/live-store.dump" "$DATABASE_URL"\n`;
  const offenders = executableLines(poisoned)
    .filter(({ text }) => /\.dump\b/.test(text))
    .filter(({ text }) => !/\bdb-seed\.dump\b/.test(text));
  assert.equal(offenders.length, 1);
  assert.match(offenders[0].text, /live-store\.dump/);
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

// WI-10003589 — release-local.sh's mac collector must gather each DMG's minisign
// sibling, and the collector-side signature guard must run before release.manifest.
//
// WHY THIS TEST EXISTS
// D-019 made .dmg a signable suffix (RELEASE_ARTIFACTS_SIGNABLE_SUFFIXES), but the mac
// collection loop in bin/release-local.sh kept globbing only dmg/*.dmg,
// macos/*.app.tar.gz and macos/*.app.tar.gz.sig. The 0.0.22 cut therefore ran every
// leg to completion and then died at release.manifest with "NO sibling .sig", while
// both .dmg.sig files sat on disk, already verified. The collector-side guard
// (release_artifacts_assert_collected_sigs_complete, EI-23962107353168459) names that
// fault precisely, but it was wired into publish-platform-incremental.sh only.
//
// These tests execute the REAL loop text extracted from release-local.sh against a
// fixture bundle, so the glob list is what gets tested, not a copy of it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_LOCAL = process.env.RELEASE_LOCAL_SCRIPT || path.join(ROOT, 'bin/release-local.sh');
const LIB = path.join(ROOT, 'bin/lib/release-artifacts.sh');
const VERSION = '9.9.9';

const LOOP_ANCHOR = 'for f in "$MAC_OUT"/dmg/*_"$VERSION"_*.dmg';
const DMG_SIG_GLOB = ' "$MAC_OUT"/dmg/*_"$VERSION"_*.dmg.sig';
const GUARD_CALL = 'release_artifacts_assert_collected_sigs_complete "release-local" "${ARTIFACTS[@]}"';
const MANIFEST_STAGE = 'release_task_prepare_manifest_stage "${ARTIFACTS[@]}"';

function source() {
  return fs.readFileSync(RELEASE_LOCAL, 'utf8');
}

/** The mac collection loop, verbatim, from its `for` line through its `done`. */
function macCollectionLoop(src) {
  const start = src.indexOf(LOOP_ANCHOR);
  assert.ok(start >= 0, `mac collection loop anchor not found in ${RELEASE_LOCAL}`);
  const doneMatch = /^\s*done\s*$/m.exec(src.slice(start));
  assert.ok(doneMatch, 'mac collection loop has no closing `done`');
  return src.slice(start, start + doneMatch.index + doneMatch[0].length);
}

/** A universal-apple-darwin bundle dir with signed dmgs + updater bundles, plus a stale prior-version dmg. */
function bundleFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-mac-sigs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'dmg'));
  fs.mkdirSync(path.join(dir, 'macos'));
  const files = [
    `dmg/Papercusp GUI_${VERSION}_universal-apple-darwin.dmg`,
    `dmg/Papercusp GUI_${VERSION}_universal-apple-darwin.dmg.sig`,
    `dmg/Papercusp Server_${VERSION}_universal-apple-darwin.dmg`,
    `dmg/Papercusp Server_${VERSION}_universal-apple-darwin.dmg.sig`,
    'dmg/Papercusp GUI_0.0.1_universal-apple-darwin.dmg',
    'dmg/Papercusp GUI_0.0.1_universal-apple-darwin.dmg.sig',
    'macos/Papercusp GUI.app.tar.gz',
    'macos/Papercusp GUI.app.tar.gz.sig',
    'macos/Papercusp Server.app.tar.gz',
    'macos/Papercusp Server.app.tar.gz.sig',
  ];
  for (const f of files) fs.writeFileSync(path.join(dir, f), `${f}\n`);
  return dir;
}

/** Run `loop` exactly as release-local.sh does, then the collector-side guard over ARTIFACTS. */
function collect(loop, macOut) {
  const script = [
    'set -uo pipefail',
    'source "$LIB"',
    'ARTIFACTS=()',
    'mac_found=0',
    'eval "$LOOP"',
    'printf "%s\\n" "${ARTIFACTS[@]}"',
    'release_artifacts_assert_collected_sigs_complete "release-local" "${ARTIFACTS[@]}"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, LIB, LOOP: loop, MAC_OUT: macOut, VERSION },
  });
  return { ...r, collected: r.stdout.split('\n').filter(Boolean).map((p) => path.relative(macOut, p)) };
}

test('the real mac collection loop gathers every dmg .sig and passes the collector guard', (t) => {
  const macOut = bundleFixture(t);
  const r = collect(macCollectionLoop(source()), macOut);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    [...r.collected].sort(),
    [
      `dmg/Papercusp GUI_${VERSION}_universal-apple-darwin.dmg`,
      `dmg/Papercusp GUI_${VERSION}_universal-apple-darwin.dmg.sig`,
      `dmg/Papercusp Server_${VERSION}_universal-apple-darwin.dmg`,
      `dmg/Papercusp Server_${VERSION}_universal-apple-darwin.dmg.sig`,
      'macos/Papercusp GUI.app.tar.gz',
      'macos/Papercusp GUI.app.tar.gz.sig',
      'macos/Papercusp Server.app.tar.gz',
      'macos/Papercusp Server.app.tar.gz.sig',
    ].sort(),
    'collected set must be version-scoped and include each dmg signature',
  );
});

test('control: the pre-fix loop (no dmg .sig glob) is refused and the dropped signature is named', (t) => {
  const macOut = bundleFixture(t);
  const loop = macCollectionLoop(source());
  assert.ok(loop.includes(DMG_SIG_GLOB), 'fixture expects the dmg .sig glob in the live loop');
  const preFix = loop.replace(DMG_SIG_GLOB, '');
  assert.notEqual(preFix, loop, 'removing the dmg .sig glob must change the loop');
  const r = collect(preFix, macOut);
  assert.notEqual(r.status, 0, 'the collector guard passed a set that dropped on-disk dmg signatures');
  assert.match(r.stderr, /DROPPED 2 signature\(s\)/);
  assert.match(r.stderr, new RegExp(`Papercusp Server_${VERSION.replace(/\./g, '\\.')}_universal-apple-darwin\\.dmg\\.sig`));
});

test('release-local.sh runs the collector-side signature guard after collection and before release.manifest', () => {
  const src = source();
  const lines = src.split('\n');
  const guardLine = lines.findIndex((l) => l.trim().startsWith(GUARD_CALL));
  assert.ok(guardLine >= 0, 'release-local.sh never calls the collector-side signature guard over ARTIFACTS');
  const loopLine = lines.findIndex((l) => l.includes(LOOP_ANCHOR));
  const manifestLine = lines.findIndex((l) => l.trim().startsWith(MANIFEST_STAGE));
  assert.ok(loopLine >= 0 && manifestLine >= 0, 'anchors for ordering not found');
  assert.ok(guardLine > loopLine, 'guard must run after the last leg collector (mac)');
  assert.ok(guardLine < manifestLine, 'guard must run before release.manifest is prepared');
  assert.match(lines[guardLine + 1] ?? '', /\|\|\s*\{.*exit 1/, 'a guard failure must abort the cut');
});

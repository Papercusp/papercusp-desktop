// EI-18891305951810001 — the prebuild gate that refuses to package a stale frontend.
//
// The case that motivated it, replayed verbatim as the first test: the packaged SPA was
// `index-YLHVi6ZV.js` while the freshly built one was `index-AZ22_Xh1.js`, and the stale
// file's MTIME was newer than the fix (the packaging copy touched it) — so every
// timestamp-based check called it current while the content was a build behind.
//
// The guard must also be quiet when it genuinely cannot judge. A build blocked by a
// check that guesses gets the check disabled, which is worse than no check.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const {
  entryBundle,
  inspectSpaFreshness,
  blocksBuild,
  describe: describeResult,
  desktopInterfaceIdentity,
  desktopInterfaceChoice,
  assertPublicDesktopInterface,
  assertPublicDesktopArtifacts,
  assertPublicDesktopReleaseSite,
} = require('../bin/lib/spa-freshness.js');

const html = (entry) =>
  `<!doctype html><html><head><script type="module" crossorigin src="/assets/${entry}"></script>` +
  `<link rel="stylesheet" href="/assets/index-abc123.css"></head><body><div id="root"></div></body></html>`;

test('the real 2026-07-28 skew is caught', () => {
  const r = inspectSpaFreshness({
    sidecarHtml: html('index-YLHVi6ZV.js'),
    distHtml: html('index-AZ22_Xh1.js'),
  });
  assert.equal(r.verdict, 'skew');
  assert.equal(blocksBuild(r.verdict), true);
  // The message must name BOTH bundles and the command that fixes it — a gate that
  // only says "stale" sends the reader to guess, which is the cycle this exists to end.
  const msg = describeResult(r);
  assert.match(msg, /index-YLHVi6ZV\.js/);
  assert.match(msg, /index-AZ22_Xh1\.js/);
  assert.match(msg, /build-desktop-sidecar\.sh/);
});

test('identical builds pass', () => {
  const r = inspectSpaFreshness({
    sidecarHtml: html('index-AZ22_Xh1.js'),
    distHtml: html('index-AZ22_Xh1.js'),
  });
  assert.equal(r.verdict, 'match');
  assert.equal(blocksBuild(r.verdict), false);
});

test('a missing dist declines to judge instead of reporting a pass it has not earned', () => {
  const r = inspectSpaFreshness({ sidecarHtml: html('index-AZ22_Xh1.js'), distHtml: null });
  assert.equal(r.verdict, 'no-dist');
  assert.equal(blocksBuild(r.verdict), false);
  assert.match(describeResult(r), /cannot be judged/);
});

test('a missing staged SPA is reported, not blocked', () => {
  const r = inspectSpaFreshness({ sidecarHtml: null, distHtml: html('index-AZ22_Xh1.js') });
  assert.equal(r.verdict, 'no-sidecar');
  assert.equal(blocksBuild(r.verdict), false);
});

test('a document with no entry bundle is unreadable, not a false skew', () => {
  const r = inspectSpaFreshness({ sidecarHtml: '<html></html>', distHtml: html('index-A.js') });
  assert.equal(r.verdict, 'unreadable');
  assert.equal(blocksBuild(r.verdict), false);
});

test('entryBundle reports ALL entries when a document has several, rather than picking one', () => {
  // Silently picking the first would let a genuinely odd document read as a clean match.
  const two = html('index-AAAAAAAA.js').replace(
    '</head>',
    '<script type="module" src="/assets/index-BBBBBBBB.js"></script></head>',
  );
  assert.equal(entryBundle(two), 'index-AAAAAAAA.js,index-BBBBBBBB.js');
});

test('entryBundle is not fooled by a repeated reference to the same bundle', () => {
  const repeated = html('index-AAAAAAAA.js').replace(
    '</head>',
    '<link rel="modulepreload" href="/assets/index-AAAAAAAA.js"></head>',
  );
  assert.equal(entryBundle(repeated), 'index-AAAAAAAA.js');
});

test('the CLI exits 4 on skew and 0 under the documented override', () => {
  const cli = path.resolve(__dirname, '../bin/check-spa-freshness.js');
  // Point the guard at a repo root with no dist so it cannot block, proving the
  // no-dist path really is non-blocking end-to-end (not just in the pure function).
  const noDist = spawnSync(process.execPath, [cli], {
    env: { ...process.env, PAPERCUSP_REPO_DIR: '/nonexistent-repo-root' },
    encoding: 'utf8',
  });
  assert.equal(noDist.status, 0, noDist.stderr);
});

test('public interface selection defaults to legacy and refuses candidate or unknown requests', () => {
  assert.equal(desktopInterfaceChoice({}), 'legacy');
  assert.doesNotThrow(() => assertPublicDesktopInterface(undefined, {}));
  assert.throws(() => assertPublicDesktopInterface(undefined, { PAPERCUSP_DESKTOP_INTERFACE: 'portal-candidate' }), /PUBLIC DESKTOP INTERFACE HOLD/);
  assert.throws(() => desktopInterfaceChoice({ PAPERCUSP_DESKTOP_INTERFACE: 'typo' }), /Unknown desktop interface/);
});

test('SPA interface identity comes from exactly one built-document marker', () => {
  const marked = (kind) => html('index-AAAAAAAA.js').replace('</head>', `<meta name="papercusp-desktop-interface" content="${kind}"></head>`);
  const legacy = desktopInterfaceIdentity(marked('legacy'));
  assert.equal(legacy.kind, 'legacy');
  assert.match(legacy.spaIndexSha256, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertPublicDesktopInterface({ desktopInterface: legacy }, {}));
  assert.throws(() => assertPublicDesktopInterface({ sidecar: { desktopInterface: desktopInterfaceIdentity(marked('portal-candidate')) } }, {}), /PUBLIC DESKTOP INTERFACE HOLD/);
  assert.equal(desktopInterfaceIdentity(html('index-AAAAAAAA.js')).kind, 'unknown');
  assert.equal(desktopInterfaceIdentity(`<!-- ${marked('legacy')} -->`).kind, 'unknown');
  assert.equal(desktopInterfaceIdentity(marked('legacy').replace('</head>', '<meta content="portal-candidate" name="papercusp-desktop-interface"></head>')).kind, 'unknown');
  assert.throws(() => assertPublicDesktopInterface({}, {}), /no measured legacy/);
  assert.throws(() => assertPublicDesktopInterface({ desktopInterface: legacy, sidecar: { desktopInterface: { kind: 'portal-candidate' } } }, {}), /PUBLIC DESKTOP INTERFACE HOLD/);
});

test('public artifact guard binds interface provenance to bytes, including nested bundle paths', () => {
  const fs = require('node:fs');
  const crypto = require('node:crypto');
  const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');
  const root = makeDesktopTestScratchDirSync('desktop-interface-');
  try {
    fs.mkdirSync(path.join(root, 'deb'));
    const file = path.join(root, 'deb', 'legacy.deb');
    const bytes = Buffer.from('measured installer bytes');
    fs.writeFileSync(file, bytes);
    const identity = desktopInterfaceIdentity(html('index-AAAAAAAA.js').replace('</head>', '<meta name="papercusp-desktop-interface" content="legacy"></head>'));
    const record = { desktopInterface: identity, artifacts: [{ name: 'deb/legacy.deb', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }] };
    const provenance = path.join(root, 'build-provenance.json');
    fs.writeFileSync(provenance, JSON.stringify(record));
    assert.doesNotThrow(() => assertPublicDesktopArtifacts([file], {}));
    record.desktopInterface.kind = 'portal-candidate';
    fs.writeFileSync(provenance, JSON.stringify(record));
    assert.throws(() => assertPublicDesktopArtifacts([file], {}), /PUBLIC DESKTOP INTERFACE HOLD/);
    record.desktopInterface.kind = 'legacy';
    fs.writeFileSync(provenance, JSON.stringify(record));
    fs.writeFileSync(file, 'other installer bytes');
    assert.throws(() => assertPublicDesktopArtifacts([file], {}), /bytes differ/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retained public history refuses candidate metadata with a legacy caller', () => {
  const fs = require('node:fs');
  const { makeDesktopTestScratchDirSync } = require('./test-scratch.cjs');
  const root = makeDesktopTestScratchDirSync('desktop-interface-site-');
  try {
    const desktopInterface = { kind: 'legacy', spaIndexSha256: 'a'.repeat(64), entryBundle: 'index-A.js' };
    const history = { releases: [{ artifacts: [{ desktopInterface }] }] };
    const file = path.join(root, 'history.json');
    fs.writeFileSync(file, JSON.stringify(history));
    assert.doesNotThrow(() => assertPublicDesktopReleaseSite(root, {}));
    desktopInterface.kind = 'portal-candidate';
    fs.writeFileSync(file, JSON.stringify(history));
    assert.throws(() => assertPublicDesktopReleaseSite(root, {}), /PUBLIC DESKTOP INTERFACE HOLD/);
    fs.writeFileSync(file, JSON.stringify({ releases: [{ artifacts: null }] }));
    assert.throws(() => assertPublicDesktopReleaseSite(root, {}), /malformed release artifacts/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

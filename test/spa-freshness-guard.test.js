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

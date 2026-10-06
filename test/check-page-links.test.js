'use strict';

// WI-10006550 (open-source-release-2026-09-29 R-15): the release page linked a 0.0.25
// Server .deb that was recorded in the registry but never uploaded, so it served a 404
// download link. bin/check-page-links.mjs refuses such a page before publish-release-
// history.sh uploads index.html. These tests run the real checker against a local HTTP
// server standing in for the public release host.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const CHECKER = path.join(__dirname, '..', 'bin', 'check-page-links.mjs');
const PUBLISH = path.join(__dirname, '..', 'bin', 'publish-release-history.sh');
const PREFIX = '/SECRETPREFIX0123456789';
// Objects the stand-in host serves under the channel prefix.
const SERVED = new Set([
  'desktop-v0.0.25-alpha/Papercusp%20GUI_0.0.25_amd64.deb',
  'changes/desktop-v0.0.25-alpha.html',
  'plans/some-plan.html',
  'instructions.html',
]);

let server;
let base;
let headless; // a host that answers 405 to HEAD
let headlessBase;
let checker;

function listen(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function served(req) {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(`${PREFIX}/`)) return false;
  return SERVED.has(url.pathname.slice(PREFIX.length + 1));
}

before(async () => {
  checker = await import(CHECKER);
  server = await listen((req, res) => {
    res.statusCode = served(req) ? 200 : 404;
    res.end(req.method === 'HEAD' ? undefined : 'x');
  });
  base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
  headless = await listen((req, res) => {
    if (req.method === 'HEAD') {
      res.statusCode = 405;
      return res.end();
    }
    res.statusCode = served(req) ? (req.headers.range ? 206 : 200) : 404;
    res.end('x');
  });
  headlessBase = `http://127.0.0.1:${headless.address().port}${PREFIX}`;
});

after(() => {
  server?.close();
  headless?.close();
});

const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="assets/../instructions.html">
</head><body>
<a href="desktop-v0.0.25-alpha/Papercusp%20GUI_0.0.25_amd64.deb">GUI deb</a>
<a href="desktop-v0.0.25-alpha/Papercusp%20Server_0.0.25_amd64.deb">Server deb</a>
<a href="changes/desktop-v0.0.25-alpha.html#top">changes</a>
<a href='plans/some-plan.html'>plan</a>
<a href="plans/some-plan.html">plan again</a>
<a href="#downloads">in page</a>
<a href="https://example.com/elsewhere.html">external</a>
<a href="//cdn.example.com/x.js">protocol-relative</a>
<a href="mailto:someone@example.com">mail</a>
<video src="https://clips.example.com/demo.mp4"></video>
<a href="search.html?q=a&amp;b=c">entity</a>
</body></html>`;

test('extracts each distinct relative link and skips other hosts and in-page fragments', () => {
  assert.deepEqual(checker.extractRelativeLinks(PAGE), [
    'assets/../instructions.html',
    'desktop-v0.0.25-alpha/Papercusp%20GUI_0.0.25_amd64.deb',
    'desktop-v0.0.25-alpha/Papercusp%20Server_0.0.25_amd64.deb',
    'changes/desktop-v0.0.25-alpha.html',
    'plans/some-plan.html',
    'search.html?q=a&b=c',
  ]);
});

test('the WI-10006550 regression: a recorded-but-never-uploaded installer link is reported dead', async () => {
  const links = checker.extractRelativeLinks(PAGE);
  const results = await checker.checkLinks(links, base);
  assert.equal(checker.verdict(results), 1);
  const dead = results.filter((r) => !r.ok).map((r) => [r.status, r.link]);
  assert.deepEqual(dead, [
    [404, 'desktop-v0.0.25-alpha/Papercusp%20Server_0.0.25_amd64.deb'],
    [404, 'search.html?q=a&b=c'],
  ]);
});

test('a page whose every link is served passes (calibration: the checker is not always-red)', async () => {
  const links = [...SERVED];
  const results = await checker.checkLinks(links, base);
  assert.equal(checker.verdict(results), 0);
  assert.ok(results.every((r) => r.status === 200));
});

test('a host without HEAD support is probed with a one-byte GET', async () => {
  const results = await checker.checkLinks(
    ['desktop-v0.0.25-alpha/Papercusp%20GUI_0.0.25_amd64.deb', 'desktop-v0.0.25-alpha/missing.deb'],
    headlessBase,
  );
  assert.deepEqual(results.map((r) => r.status), [206, 404]);
  assert.equal(checker.verdict(results), 1);
});

test('an unreachable host is "nothing measured" (exit 2), never a pass', async () => {
  const closed = await listen(() => {});
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  const results = await checker.checkLinks(['instructions.html'], `http://127.0.0.1:${port}${PREFIX}`, { timeoutMs: 2000 });
  assert.deepEqual(results.map((r) => r.status), [0]);
  assert.equal(checker.verdict(results), 2);
  assert.equal(checker.verdict([]), 0, 'a page with no relative links has nothing to refuse');
});

function runCli(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHECKER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI exits 1 naming the dead link, and never prints the base URL (it carries the secret prefix)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-page-links-'));
  try {
    const page = path.join(dir, 'index.html');
    fs.writeFileSync(page, PAGE);
    const { code, stdout, stderr } = await runCli([page, base]);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /HTTP 404 {2}desktop-v0\.0\.25-alpha\/Papercusp%20Server_0\.0\.25_amd64\.deb/);
    assert.doesNotMatch(stdout + stderr, /SECRETPREFIX/);

    fs.writeFileSync(page, '<a href="instructions.html">ok</a>');
    const ok = await runCli([page, base]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /all 1 relative link\(s\) on the page resolve/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publish-release-history.sh runs the check before uploading index.html and stops on dead links', () => {
  const src = fs.readFileSync(PUBLISH, 'utf8');
  const check = src.indexOf('node "$HERE/check-page-links.mjs" "$UPLOAD_FROM/index.html" "$BASE"');
  const upload = src.indexOf('aws s3 cp "$UPLOAD_FROM/index.html"');
  assert.ok(check > 0, 'publish-release-history.sh no longer runs check-page-links.mjs on the index');
  assert.ok(upload > check, 'the link check must run BEFORE index.html is uploaded');
  const between = src.slice(check, upload);
  assert.match(between, /if \[\[ "\$LINK_RC" == "1" \]\]; then[\s\S]*?exit 1/, 'a dead link must stop the publish');
});

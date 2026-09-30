// Guards `bin/lib/transformers-models.sh fetch` (WI-10003960 R-15, fresh-clone build6).
//
// A fresh clone had no way to produce the two contract-pinned embedding models the
// sidecar's fail-closed guard requires. `fetch` downloads exactly what
// distribution-contract.json's `local-models` pack pins (repo, revision, bytes, sha256).
// These tests serve a tiny contract from a local HTTP server via PAPERCUSP_HF_ENDPOINT, so
// they are hermetic and never touch huggingface.co.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const lib = path.resolve(__dirname, '..', 'bin/lib/transformers-models.sh');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const REV = 'a'.repeat(40);
const FILES = {
  'onnx-community/m1/config.json': Buffer.from('{"m":1}'),
  'onnx-community/m1/onnx/model.onnx_data': crypto.randomBytes(300_000),
};

function contract(overrides = {}) {
  const files = Object.entries(FILES).map(([p, b]) => ({
    path: p.split('/').slice(2).join('/'),
    bytes: b.length,
    sha256: overrides[p] ?? sha(b),
  }));
  return {
    server: { optionalPacks: [{ name: 'local-models', models: [
      { runtimeId: 'onnx-community/m1', revision: REV, files },
    ] }] },
  };
}

async function withServer(fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const m = req.url.match(/^\/(onnx-community\/[^/]+)\/resolve\/([0-9a-f]{40})\/(.+)$/);
    const key = m && `${m[1]}/${m[3]}`;
    if (!m || m[2] !== REV || !FILES[key]) { res.statusCode = 404; return res.end(); }
    res.end(FILES[key]);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`, hits);
  } finally {
    server.close();
  }
}

function runFetch(endpoint, contractObj, dest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-fetch-contract-'));
  const cpath = path.join(dir, 'contract.json');
  fs.writeFileSync(cpath, JSON.stringify(contractObj));
  return new Promise((resolve) => {
    // Async spawn: the HTTP server lives in THIS process, so a sync spawn would deadlock.
    const child = spawn('bash', [lib, 'fetch', dest], {
      env: { ...process.env, PAPERCUSP_HF_ENDPOINT: endpoint, PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: cpath },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (status) => { fs.rmSync(dir, { recursive: true, force: true }); resolve({ status, out }); });
  });
}

test('fetch downloads every pinned file at the pinned revision into <dest>/onnx-community', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-fetch-dest-'));
  try {
    await withServer(async (endpoint, hits) => {
      const r = await runFetch(endpoint, contract(), dest);
      assert.equal(r.status, 0, r.out);
      for (const [p, b] of Object.entries(FILES)) {
        assert.ok(fs.readFileSync(path.join(dest, p)).equals(b), p);
      }
      assert.ok(hits.every((u) => u.includes(`/resolve/${REV}/`)), hits.join(','));
      const parts = fs.readdirSync(dest, { recursive: true }).filter((f) => String(f).endsWith('.part'));
      assert.deepEqual(parts, []);
    });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('fetch is idempotent: verified files are kept, not re-downloaded', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-fetch-dest-'));
  try {
    await withServer(async (endpoint, hits) => {
      assert.equal((await runFetch(endpoint, contract(), dest)).status, 0);
      const before = hits.length;
      const r = await runFetch(endpoint, contract(), dest);
      assert.equal(r.status, 0, r.out);
      assert.equal(hits.length, before, 'no second download');
      assert.match(r.out, /fetched 0 file\(s\), kept 2/);
    });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('fetch refuses bytes that do not match the contract sha256 and leaves no final file', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-fetch-dest-'));
  try {
    await withServer(async (endpoint) => {
      const bad = contract({ 'onnx-community/m1/onnx/model.onnx_data': 'b'.repeat(64) });
      const r = await runFetch(endpoint, bad, dest);
      assert.notEqual(r.status, 0, r.out);
      assert.match(r.out, /does not match the contract/);
      const final = path.join(dest, 'onnx-community/m1/onnx/model.onnx_data');
      assert.equal(fs.existsSync(final), false);
      assert.equal(fs.existsSync(`${final}.part`), false);
    });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('the fetched layout is what `stage` accepts as PAPERCUSP_TRANSFORMERS_MODEL_CACHE', () => {
  // stage() takes a dir holding onnx-community/ (or onnx-community itself); fetch writes
  // <dest>/<runtimeId> with runtimeId = onnx-community/<name>, i.e. exactly that shape.
  const src = fs.readFileSync(lib, 'utf8');
  assert.match(src, /holds neither 'onnx-community\/'/);
  assert.match(src, /os\.path\.join\(dest, repo, rel\)/);
});

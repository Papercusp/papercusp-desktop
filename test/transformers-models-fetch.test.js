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
const { spawn, spawnSync } = require('node:child_process');

const lib = path.resolve(__dirname, '..', 'bin/lib/transformers-models.sh');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function nativeTargetFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-native-target-'));
  const tf = path.join(root, 'node_modules/@huggingface/transformers');
  const runtime = path.join(root, 'node_modules/onnxruntime-node');
  fs.mkdirSync(tf, { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/operator'), { recursive: true });
  const declaration = { dependencies: { '@huggingface/transformers': '4.2.0' } };
  fs.writeFileSync(path.join(root, 'apps/operator/package.json'), JSON.stringify(declaration));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: {
    'apps/operator': declaration,
    'node_modules/@huggingface/transformers': { version: '4.2.0' },
  } }));
  fs.writeFileSync(path.join(tf, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '4.2.0', dependencies: { 'onnxruntime-node': '1.24.3' } }));
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: '1.24.3' }));
  const contract = path.join(root, 'contract.json');
  fs.writeFileSync(contract, JSON.stringify({ server: { optionalPacks: [{ name: 'local-models', compatibility: { transformersPackage: '4.2.0' } }] } }));
  function writeTarget(os, arch) {
    const bytes = Buffer.alloc(128);
    if (os === 'darwin') { bytes.writeUInt32BE(0xcffaedfe, 0); bytes.writeUInt32LE(arch === 'x64' ? 0x1000007 : 0x100000c, 4); }
    else if (os === 'linux') { bytes.set([0x7f, 0x45, 0x4c, 0x46]); bytes[5] = 1; bytes.writeUInt16LE(arch === 'x64' ? 62 : 183, 18); }
    else { bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.set([0x50, 0x45, 0, 0], 64); bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 68); }
    const dir = path.join(runtime, 'bin/napi-v6', os, arch);
    fs.mkdirSync(dir, { recursive: true });
    const library = os === 'darwin' ? 'libonnxruntime.1.24.3.dylib' : os === 'linux' ? 'libonnxruntime.so.1' : 'onnxruntime.dll';
    fs.writeFileSync(path.join(dir, 'onnxruntime_binding.node'), bytes);
    fs.writeFileSync(path.join(dir, library), bytes);
    return dir;
  }
  const probe = (os, arch) => spawnSync('bash', ['-c', 'source "$1"; papercusp_verify_transformers_native_target "$2" "$3" "$4"', 'test', lib, root, os, arch], {
    encoding: 'utf8', env: { ...process.env, PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: contract },
  });
  return { root, runtime, writeTarget, probe };
}

test('pinned native preflight accepts matching target binding and runtime library for each supported shape', () => {
  const f = nativeTargetFixture();
  try {
    for (const os of ['darwin', 'linux', 'win32']) for (const arch of ['x64', 'arm64']) {
      f.writeTarget(os, arch);
      const result = f.probe(os === 'win32' ? 'windows' : os, arch);
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, /on-target inference remains required/);
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('Darwin arm64-only package cannot pass Intel native preflight', () => {
  const f = nativeTargetFixture();
  try {
    f.writeTarget('darwin', 'arm64');
    const result = f.probe('darwin', 'x64');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /darwin\/x64\/onnxruntime_binding.node/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('native preflight refuses wrong architecture, missing library, truncated bytes and version substitution', () => {
  for (const failure of ['wrong-architecture', 'missing-library', 'truncated', 'version']) {
    const f = nativeTargetFixture();
    try {
      const dir = f.writeTarget('darwin', 'x64');
      if (failure === 'wrong-architecture') {
        const arm = f.writeTarget('darwin', 'arm64');
        fs.copyFileSync(path.join(arm, 'onnxruntime_binding.node'), path.join(dir, 'onnxruntime_binding.node'));
      } else if (failure === 'missing-library') fs.rmSync(path.join(dir, 'libonnxruntime.1.24.3.dylib'));
      else if (failure === 'truncated') fs.writeFileSync(path.join(dir, 'onnxruntime_binding.node'), 'bad');
      else fs.writeFileSync(path.join(f.runtime, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: '1.23.2' }));
      const result = f.probe('darwin', 'x64');
      assert.equal(result.status, 1, `${failure}: ${result.stdout}${result.stderr}`);
      assert.match(result.stderr, /FATAL: local-model native preflight/);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

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

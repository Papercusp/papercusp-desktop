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
  const cache = path.join(root, 'bin-cache');
  const probe = (os, arch, stage = '') => spawnSync('bash', ['-c', 'source "$1"; papercusp_verify_transformers_native_target "$2" "$3" "$4" "$5"', 'test', lib, root, os, arch, stage], {
    encoding: 'utf8', env: { ...process.env, PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: contract, PAPERCUSP_SIDECAR_BIN_CACHE: cache },
  });
  function sourceCache() {
    const dir = path.join(cache, 'onnxruntime-node-1.24.3-darwin-x64');
    fs.mkdirSync(dir, { recursive: true });
    const source = writeTarget('darwin', 'x64');
    const files = {};
    for (const name of ['onnxruntime_binding.node', 'libonnxruntime.1.24.3.dylib']) {
      const bytes = fs.readFileSync(path.join(source, name));
      fs.writeFileSync(path.join(dir, name), bytes);
      files[name] = sha(bytes);
    }
    fs.rmSync(source, { recursive: true });
    const receipt = { kind: 'onnxruntime-node-source-build', version: '1.24.3', platform: 'darwin', arch: 'x64',
      upstream: 'https://github.com/microsoft/onnxruntime', tag: 'v1.24.3', sourceSha: '3a728b75062256951b6e19ce718907cf1a1d4cf0',
      toolchain: { clang: 'fixture clang', cmake: 'fixture cmake', node: 'fixture node' },
      dependencyLockSha256: 'b'.repeat(64), bindingLoad: 'passed', files,
      linkage: Object.keys(files).map(file => ({ file, dependencies: ['/usr/lib/libSystem.B.dylib'] })) };
    receipt.licenses = {};
    for (const file of ['LICENSE', 'ThirdPartyNotices.txt']) {
      const text = `fixture upstream ${file}`;
      fs.writeFileSync(path.join(dir, file), text);
      receipt.licenses[file] = sha(text);
    }
    const save = () => fs.writeFileSync(path.join(dir, 'source-build.json'), JSON.stringify(receipt));
    save();
    return { dir, receipt, save };
  }
  return { root, runtime, writeTarget, probe, sourceCache };
}

test('split tooling reads the selected product model contract and preserves explicit override and ordinary defaults', () => {
  const f = nativeTargetFixture();
  try {
    const tooling = path.join(f.root, 'tooling');
    const product = path.join(f.root, 'product');
    const copiedLib = path.join(tooling, 'bin/lib/transformers-models.sh');
    const toolingContract = path.join(tooling, 'src-tauri/distribution-contract.json');
    const productContract = path.join(product, 'src-tauri/distribution-contract.json');
    fs.mkdirSync(path.dirname(copiedLib), { recursive: true });
    fs.mkdirSync(path.dirname(productContract), { recursive: true });
    fs.copyFileSync(lib, copiedLib);
    const writeContract = (file, version) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ server: { optionalPacks: [{
        name: 'local-models', compatibility: { transformersPackage: version },
      }] } }));
    };
    const probe = (targetRoot, override = '') => spawnSync('bash', [
      '-c', 'source "$1"; papercusp_verify_transformers_dependencies "$2" 1',
      'test', copiedLib, f.root,
    ], { encoding: 'utf8', env: { ...process.env,
      PAPERCUSP_DESKTOP_TARGET_ROOT: targetRoot,
      PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: override,
    } });
    writeContract(productContract, '4.2.0');
    let result = probe(product);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeContract(toolingContract, '4.1.0');
    result = probe(product);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeContract(productContract, '4.1.0');
    result = probe(product);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /(?:must pin|expects) 4\.1\.0, got 4\.2\.0/);
    result = probe(product, path.join(f.root, 'contract.json'));
    assert.equal(result.status, 0, result.stdout + result.stderr);
    writeContract(toolingContract, '4.2.0');
    result = probe('');
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('same-version upstream source cache stages the missing Intel closure without mutating dependencies', () => {
  const f = nativeTargetFixture();
  try {
    const cache = f.sourceCache();
    assert.equal(f.probe('darwin', 'x64').status, 0);
    const staged = path.join(f.root, 'assembled/onnxruntime-node');
    fs.mkdirSync(staged, { recursive: true });
    fs.copyFileSync(path.join(f.runtime, 'package.json'), path.join(staged, 'package.json'));
    const result = f.probe('darwin', 'x64', staged);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.existsSync(path.join(f.runtime, 'bin/napi-v6/darwin/x64')), false);
    for (const [name, digest] of Object.entries(cache.receipt.files)) {
      assert.equal(sha(fs.readFileSync(path.join(staged, 'bin/napi-v6/darwin/x64', name))), digest);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(staged, 'native-source-build.json'))), cache.receipt);
    for (const [name, digest] of Object.entries(cache.receipt.licenses)) assert.equal(sha(fs.readFileSync(path.join(staged, 'native-source-licenses', name))), digest);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('source cache refuses stale bytes, version/source/target gaps and non-portable linkage before staging', () => {
  for (const defect of ['bytes', 'version', 'source', 'wrong-source', 'arch', 'load', 'toolchain', 'inventory', 'linkage', 'license', 'staged-version']) {
    const f = nativeTargetFixture();
    try {
      const c = f.sourceCache();
      if (defect === 'bytes') fs.appendFileSync(path.join(c.dir, 'onnxruntime_binding.node'), 'changed');
      if (defect === 'version') c.receipt.version = '1.23.2';
      if (defect === 'source') delete c.receipt.sourceSha;
      if (defect === 'wrong-source') c.receipt.sourceSha = 'a'.repeat(40);
      if (defect === 'arch') c.receipt.arch = 'arm64';
      if (defect === 'load') c.receipt.bindingLoad = 'unverified';
      if (defect === 'toolchain') delete c.receipt.toolchain.clang;
      if (defect === 'inventory') c.receipt.files['extra.dylib'] = 'c'.repeat(64);
      if (defect === 'linkage') c.receipt.linkage[0].dependencies = ['/Users/builder/private/lib.dylib'];
      if (defect === 'license') fs.appendFileSync(path.join(c.dir, 'LICENSE'), 'changed');
      c.save();
      const staged = path.join(f.root, 'assembled/onnxruntime-node');
      fs.mkdirSync(staged, { recursive: true });
      fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ name: 'onnxruntime-node', version: defect === 'staged-version' ? '1.23.2' : '1.24.3' }));
      const result = f.probe('darwin', 'x64', staged);
      assert.equal(result.status, 1, `${defect}: ${result.stdout}${result.stderr}`);
      assert.equal(fs.existsSync(path.join(staged, 'bin')), false, defect);
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
  }
});

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

test('installed verification derives the nested pack from its contract and never rewrites the snapshot', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-installed-'));
  try {
    const pack = contract().server.optionalPacks[0];
    Object.assign(pack, { required: true, installRoot: 'sidecar/node_modules/@huggingface/transformers/models/onnx-community',
      manifestPath: 'sidecar/node_modules/@huggingface/transformers/models/papercusp-model-assets.json',
      cachePolicy: { remoteFetch: 'forbidden-on-vm-release' }, compatibility: { transformersPackage: '4.2.0' } });
    const selectedContract = path.join(root, 'contract.json');
    const saveContract = () => fs.writeFileSync(selectedContract, JSON.stringify({ server: { optionalPacks: [pack] } }));
    saveContract();
    const models = path.join(root, path.dirname(pack.installRoot));
    for (const [file, bytes] of Object.entries(FILES)) {
      fs.mkdirSync(path.dirname(path.join(models, file)), { recursive: true });
      fs.writeFileSync(path.join(models, file), bytes);
    }
    fs.writeFileSync(path.join(models, '../package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '4.2.0' }));
    const env = { ...process.env, PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: selectedContract };
    const seed = spawnSync('bash', [lib, 'verify', models, '1', '1'], { encoding: 'utf8', env });
    assert.equal(seed.status, 0, seed.stderr);
    const snapshot = path.join(root, pack.manifestPath);
    const original = fs.readFileSync(snapshot);
    const probe = () => spawnSync('bash', [lib, 'verify-installed', root], { encoding: 'utf8', env });
    const wrongRoot = spawnSync('bash', [lib, 'verify', path.join(root, 'sidecar/models'), '0', '1'], { encoding: 'utf8', env });
    assert.notEqual(wrongRoot.status, 0, 'the former guessed path must fail');
    assert.match(wrongRoot.stderr, /missing declared file/);
    let result = probe();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).manifestSha256, sha(original));
    assert.deepEqual(fs.readFileSync(snapshot), original);
    fs.writeFileSync(snapshot, '{}');
    result = probe();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /snapshot differs/);
    assert.equal(fs.readFileSync(snapshot, 'utf8'), '{}', 'verification must preserve a corrupt snapshot as evidence');
    fs.writeFileSync(snapshot, original);
    fs.appendFileSync(path.join(models, 'onnx-community/m1/config.json'), 'corrupt');
    result = probe();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /(?:size|sha256) mismatch/);
    pack.installRoot = '../outside/onnx-community';
    saveContract();
    result = probe();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsafe installRoot/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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

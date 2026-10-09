// Actual packaged-worker qualification. Bind a captured payload or installed target
// with PAPERCUSP_MODEL_INFERENCE_BINDING; never substitute the host's Node/models.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fingerprint(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(1024 * 1024);
    let length;
    while ((length = fs.readSync(fd, chunk, 0, chunk.length, null))) hash.update(chunk.subarray(0, length));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

function validateVector(vector, dims) {
  assert.ok(Array.isArray(vector) && vector.length === dims, `expected ${dims} native dimensions`);
  assert.ok(vector.every(Number.isFinite), 'non-finite model output');
  assert.ok(vector.some(value => value !== 0), 'degenerate zero model output');
}

function cosine(a, b) {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / Math.sqrt(aa * bb);
}

// Dogfood candidates carry the same pinned weights without the vm-release
// snapshot document. Reuse the producer's non-mutating file/compatibility check
// rather than manufacturing release metadata inside an already-built payload.
function verifyModelAssets(binding, root, pack) {
  const profile = binding.distributionProfile ?? 'vm-release';
  assert.ok(['vm-release', 'dogfood'].includes(profile), 'unsupported qualification profile');
  assert.equal(fingerprint(binding.productContract.path), binding.productContract.sha256, 'product contract binding');
  const modelsRoot = path.resolve(root, pack.installRoot.slice('sidecar/'.length));
  assert.ok(pack.installRoot.startsWith('sidecar/') && modelsRoot.startsWith(root + path.sep), 'model path escapes the bundle');
  if (profile === 'vm-release') {
    const snapshot = path.resolve(root, pack.manifestPath.slice('sidecar/'.length));
    assert.ok(pack.manifestPath.startsWith('sidecar/') && snapshot.startsWith(root + path.sep), 'model snapshot escapes the bundle');
    assert.equal(fingerprint(snapshot), binding.modelSnapshotSha256, 'model snapshot binding');
    return binding.modelSnapshotSha256;
  }
  const verifier = path.resolve(__dirname, '../bin/lib/transformers-models.sh');
  assert.equal(fingerprint(verifier), binding.modelVerifierSha256, 'maintained model verifier binding');
  assert.equal(path.basename(modelsRoot), 'onnx-community', 'unsupported model namespace');
  const result = spawnSync('bash', ['-c',
    'source "$1"; papercusp_verify_transformers_model_pack "$2" 0 1',
    'bound-model-assets', verifier, path.dirname(modelsRoot)], {
    encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024,
    env: { ...process.env, PAPERCUSP_TRANSFORMERS_DISTRIBUTION_CONTRACT: binding.productContract.path },
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const measured = JSON.parse(result.stdout.trim());
  assert.equal(measured.ok, true);
  assert.equal(measured.status, 'ready');
  assert.match(measured.manifestSha256, /^[a-f0-9]{64}$/);
  return measured.manifestSha256;
}

test('dogfood qualification checks pinned model bytes without adding vm-release metadata', t => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bound-model-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const installRoot = 'sidecar/node_modules/@huggingface/transformers/models/onnx-community';
  const modelsRoot = path.join(root, installRoot.slice('sidecar/'.length));
  const model = path.join(modelsRoot, 'fixture-model');
  fs.mkdirSync(model, { recursive: true });
  fs.writeFileSync(path.resolve(modelsRoot, '../../package.json'), JSON.stringify({ name: '@huggingface/transformers', version: '4.2.0' }));
  const weights = path.join(model, 'model.onnx');
  fs.writeFileSync(weights, 'pinned model bytes');
  const pack = { name: 'local-models', required: true, installRoot,
    manifestPath: 'sidecar/node_modules/@huggingface/transformers/models/papercusp-model-assets.json',
    cachePolicy: { remoteFetch: 'forbidden-on-vm-release' }, compatibility: { transformersPackage: '4.2.0' },
    models: [{ runtimeId: 'onnx-community/fixture-model', revision: 'a'.repeat(40),
      files: [{ path: 'model.onnx', bytes: fs.statSync(weights).size, sha256: fingerprint(weights) }] }],
  };
  const contract = path.join(root, 'contract.json');
  fs.writeFileSync(contract, JSON.stringify({ server: { optionalPacks: [pack] } }));
  const candidate = { distributionProfile: 'dogfood', productContract: { path: contract, sha256: fingerprint(contract) },
    modelVerifierSha256: fingerprint(path.resolve(__dirname, '../bin/lib/transformers-models.sh')) };
  const snapshot = path.join(root, pack.manifestPath.slice('sidecar/'.length));
  assert.match(verifyModelAssets(candidate, root, pack), /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(snapshot), false, 'qualification must not mutate the payload');
  assert.throws(() => verifyModelAssets({ ...candidate, distributionProfile: 'other' }, root, pack), /unsupported qualification profile/);
  assert.throws(() => verifyModelAssets({ ...candidate, modelVerifierSha256: '0'.repeat(64) }, root, pack), /maintained model verifier binding/);
  assert.throws(() => verifyModelAssets({ ...candidate, productContract: { ...candidate.productContract, sha256: '0'.repeat(64) } }, root, pack), /product contract binding/);
  assert.throws(() => verifyModelAssets({ ...candidate, distributionProfile: undefined }, root, pack), /ENOENT/);
  fs.writeFileSync(snapshot, '{}');
  assert.throws(() => verifyModelAssets({ ...candidate, distributionProfile: 'vm-release', modelSnapshotSha256: '0'.repeat(64) }, root, pack), /model snapshot binding/);
  fs.writeFileSync(weights, 'broken model bytes');
  assert.throws(() => verifyModelAssets(candidate, root, pack), /(?:size|sha256) mismatch/);
});

test('qualification rejects invalid native model outputs', () => {
  assert.throws(() => validateVector([1], 768), /native dimensions/);
  assert.throws(() => validateVector([NaN, 1], 2), /non-finite/);
  assert.throws(() => validateVector([0, 0], 2), /degenerate/);
  validateVector([0.5, -0.5], 2);
});

const bindingPath = process.env.PAPERCUSP_MODEL_INFERENCE_BINDING;
const binding = bindingPath ? JSON.parse(fs.readFileSync(bindingPath, 'utf8')) : null;
const models = [
  { name: 'embeddinggemma-300m-ONNX', dims: 768, pooling: 'mean', normalize: false,
    query: 'task: search result | query: What is the capital of France?',
    documents: ['title: none | text: Paris is the capital of France.', 'title: none | text: Granite is a type of rock.'] },
  { name: 'harrier-oss-v1-0.6b-ONNX', dims: 1024, output: 'sentence_embedding',
    query: 'Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: What is the capital of France?',
    documents: ['Paris is the capital of France.', 'Granite is a type of rock.'] },
];

// This child uses the bundle's unmodified maintained worker and real fp32 ONNX
// model. Kill the whole child on timeout; terminating an in-flight ONNX worker
// can abort its parent. A successful/error response drains before retirement.
const child = String.raw`
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const input = JSON.parse(process.argv[1]);
const worker = new Worker(path.join(input.sidecarRoot, 'local-embedder-worker.script.mjs'), {
  workerData: { device: 'cpu' }, execArgv: [],
});
let next = 0;
const pending = new Map();
worker.on('error', error => { console.error(error); process.exit(1); });
worker.on('message', message => {
  if (message.kind === 'retired') worker.terminate();
  if (message.kind === 'embed_ok' || message.kind === 'embed_err') {
    const request = pending.get(message.id);
    if (!request) { console.error('unbound worker reply'); process.exit(1); }
    pending.delete(message.id);
    if (message.kind === 'embed_err') request.reject(new Error(message.error));
    else request.resolve(message.vector);
  }
});
const embed = text => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, { resolve, reject });
  worker.postMessage({ kind: 'embed', id, text,
    model: path.join(input.modelsRoot, input.model.name),
    pooling: input.model.pooling, normalize: input.model.normalize, output: input.model.output });
});
(async () => {
  try {
    const vectors = [];
    for (const text of [input.model.query, ...input.model.documents]) vectors.push(await embed(text));
    console.log(JSON.stringify({ vectors, nodeExecutable: process.execPath }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { worker.postMessage({ kind: 'retire' }); }
})();
`;

for (const model of models) {
  test(`actual bound ${model.name} worker inference`, { skip: binding ? false : 'requires exact payload/installed binding', timeout: 210000 }, () => {
    assert.equal(binding.schemaVersion, 'packaged-local-model-inference-binding/v1');
    assert.ok(['extracted-payload', 'installed-target'].includes(binding.evidencePlane));
    const root = fs.realpathSync(binding.sidecarRoot);
    const node = path.join(root, 'bin/node');
    const worker = path.join(root, 'local-embedder-worker.script.mjs');
    const contract = JSON.parse(fs.readFileSync(binding.productContract.path, 'utf8'));
    assert.equal(fingerprint(binding.productContract.path), binding.productContract.sha256);
    const packs = contract.server.optionalPacks.filter(pack => pack.name === 'local-models');
    assert.equal(packs.length, 1);
    const pack = packs[0];
    assert.ok(pack.installRoot.startsWith('sidecar/') && !pack.installRoot.split('/').includes('..'));
    const selected = pack.models.filter(entry => entry.runtimeId === 'onnx-community/' + model.name);
    assert.equal(selected.length, 1, 'model must belong to the product contract');
    assert.equal(selected[0].nativeDimensions, model.dims, 'dimensions must match the product contract');
    const modelsRoot = path.resolve(root, pack.installRoot.slice('sidecar/'.length));
    assert.ok(modelsRoot.startsWith(root + path.sep), 'model path escapes the bundle');
    const modelAssetsSha256 = verifyModelAssets(binding, root, pack);
    const inputs = [[node, binding.nodeSha256], [worker, binding.workerSha256]];
    for (const [file, expected] of inputs) assert.equal(fingerprint(file), expected, `input binding: ${file}`);
    const result = spawnSync(node, ['-e', child, JSON.stringify({ sidecarRoot: root, modelsRoot, model })], {
      cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '',
        PAPERCUSP_DISTRIBUTION_PROFILE: binding.distributionProfile ?? 'vm-release', PAPERCUSP_TRANSFORMERS_LOCAL_ONLY: '1',
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    });
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(result.status, 0, result.stderr);
    const lines = result.stdout.trim().split('\n');
    const measured = JSON.parse(lines.at(-1));
    assert.equal(fs.realpathSync(measured.nodeExecutable), fs.realpathSync(node));
    assert.equal(measured.vectors.length, 3);
    for (const vector of measured.vectors) validateVector(vector, model.dims);
    const relevant = cosine(measured.vectors[0], measured.vectors[1]);
    const unrelated = cosine(measured.vectors[0], measured.vectors[2]);
    assert.ok(relevant > unrelated, `relevance order failed: ${relevant} <= ${unrelated}`);
    for (const [file, expected] of inputs) assert.equal(fingerprint(file), expected, `changed inference input: ${file}`);
    assert.equal(verifyModelAssets(binding, root, pack), modelAssetsSha256, 'changed model asset binding');
    console.log(JSON.stringify({ evidencePlane: binding.evidencePlane, model: model.name,
      dimensions: model.dims, relevantCosine: relevant, unrelatedCosine: unrelated, remoteFetch: 'disabled',
      distributionProfile: binding.distributionProfile ?? 'vm-release',
      workerSha256: binding.workerSha256, modelAssetsSha256 }));
  });
}

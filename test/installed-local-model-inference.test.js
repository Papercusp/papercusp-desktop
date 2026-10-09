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
    const snapshot = path.resolve(root, pack.manifestPath.slice('sidecar/'.length));
    const inputs = [[node, binding.nodeSha256], [worker, binding.workerSha256], [snapshot, binding.modelSnapshotSha256]];
    for (const [file, expected] of inputs) assert.equal(fingerprint(file), expected, `input binding: ${file}`);
    const result = spawnSync(node, ['-e', child, JSON.stringify({ sidecarRoot: root, modelsRoot, model })], {
      cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '',
        PAPERCUSP_DISTRIBUTION_PROFILE: 'vm-release', PAPERCUSP_TRANSFORMERS_LOCAL_ONLY: '1',
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
    console.log(JSON.stringify({ evidencePlane: binding.evidencePlane, model: model.name,
      dimensions: model.dims, relevantCosine: relevant, unrelatedCosine: unrelated, remoteFetch: 'disabled',
      workerSha256: binding.workerSha256, modelSnapshotSha256: binding.modelSnapshotSha256 }));
  });
}

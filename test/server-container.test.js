const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const desktop = path.resolve(__dirname, '..');
const lib = import(pathToFileURL(path.join(desktop, 'bin/lib/server-container.mjs')).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const imageId = 'sha256:' + 'b'.repeat(64);

async function archiveFixture(t, mutate = () => {}, dockerOnly = false, sourceReceipt = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'server-archive-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const tree = path.join(root, 'tree');
  await fs.mkdir(path.join(tree, 'blobs/sha256'), { recursive: true });
  const descriptor = async (value, mediaType) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    const digest = 'sha256:' + sha(bytes);
    await fs.writeFile(path.join(tree, 'blobs/sha256', digest.slice(7)), bytes);
    return { digest, size: bytes.length, mediaType };
  };
  const layer = await descriptor(Buffer.from('uncompressed layer fixture'), 'application/vnd.oci.image.layer.v1.tar');
  const configValue = { os: 'linux', architecture: 'arm64', config: { Labels: sourceReceipt?.labels ?? {
    'org.opencontainers.image.revision': 'a'.repeat(40), 'com.papercusp.serve.sha256': 'b'.repeat(64),
  } }, rootfs: { type: 'layers', diff_ids: [layer.digest] } };
  const config = await descriptor(configValue, 'application/vnd.oci.image.config.v1+json');
  const manifest = await descriptor({ schemaVersion: 2, config, layers: [layer] }, 'application/vnd.oci.image.manifest.v1+json');
  const index = await descriptor({ schemaVersion: 2, manifests: [{ ...manifest,
    platform: { os: 'linux', architecture: 'arm64' } }] }, 'application/vnd.oci.image.index.v1+json');
  const receipt = { ...sourceReceipt, kind: 'papercusp-server-local-image', schemaVersion: 1,
    imageId: dockerOnly ? config.digest : index.digest, platform: 'linux/arm64',
    sourceCommit: 'a'.repeat(40), labels: configValue.config.Labels, tag: 'papercusp-server:test' };
  const aliases = [{ Config: 'blobs/sha256/' + config.digest.slice(7),
    Layers: ['blobs/sha256/' + layer.digest.slice(7)], RepoTags: ['docker.io/library/papercusp-server:test'] }];
  if (!dockerOnly) {
    await fs.writeFile(path.join(tree, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
    await fs.writeFile(path.join(tree, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [{ ...index,
      annotations: { 'io.containerd.image.name': 'docker.io/library/papercusp-server:test',
        'org.opencontainers.image.ref.name': 'test' } }] }));
  }
  await fs.writeFile(path.join(tree, 'manifest.json'), JSON.stringify(aliases));
  const receiptPath = path.join(root, 'build.json');
  const f = { root, tree, config, manifest, index, layer, receipt, aliases, receiptPath,
    archive: path.join(root, 'saved-image.bytes') };
  await mutate(f);
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  const result = spawnSync('tar', ['-cf', f.archive, '-C', tree, '.'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return f;
}

test('preserved OCI archive binds distinct index, manifest and extensionless config digests', async t => {
  const { verifyServerContainerArchive } = await lib;
  const f = await archiveFixture(t);
  for (const descriptor of [f.index, f.manifest, f.config]) {
    f.receipt.imageId = descriptor.digest;
    await fs.writeFile(f.receiptPath, JSON.stringify(f.receipt));
    const result = await verifyServerContainerArchive(f);
    assert.equal(result.configDigest, f.config.digest);
    assert.equal(result.manifestDigest, f.manifest.digest);
    assert.equal(result.verifiedBlobCount, 4);
  }
});

test('preserved Docker archive verifies config identity and uncompressed layer digests', async t => {
  const { verifyServerContainerArchive } = await lib;
  const f = await archiveFixture(t, () => {}, true);
  assert.equal((await verifyServerContainerArchive(f)).configDigest, f.config.digest);
});

test('OCI-only archives retain reference binding and refuse a substituted preservation hash', async t => {
  const { verifyServerContainerArchive } = await lib;
  const f = await archiveFixture(t, f => fs.rm(path.join(f.tree, 'manifest.json')));
  const result = await verifyServerContainerArchive(f);
  assert.equal(result.imageId, f.index.digest);
  await assert.rejects(verifyServerContainerArchive({ ...f, archiveSha256: '0'.repeat(64) }), /preservation/);
});

test('OCI immutable-ID references require the exact receipt image digest', async t => {
  const { verifyServerContainerArchive } = await lib;
  for (const annotation of ['org.opencontainers.image.ref.name', 'io.containerd.image.name']) {
    for (const form of ['prefixed', 'bare', 'wrong-prefixed', 'wrong-bare', 'short', 'nonhex']) {
      await t.test(annotation + '/' + form, async t => {
        const f = await archiveFixture(t, async f => {
          f.receipt.imageId = f.config.digest;
          const reference = {
            prefixed: f.config.digest,
            bare: f.config.digest.slice(7),
            'wrong-prefixed': 'sha256:' + '9'.repeat(64),
            'wrong-bare': '9'.repeat(64),
            short: f.config.digest.slice(7, 19),
            nonhex: 'g'.repeat(64),
          }[form];
          const indexPath = path.join(f.tree, 'index.json');
          const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
          // podman save <immutable-id> emits this single annotation, without a tag.
          index.manifests[0].annotations = { [annotation]: reference };
          await fs.writeFile(indexPath, JSON.stringify(index));
        });
        if (form === 'prefixed' || form === 'bare') {
          assert.equal((await verifyServerContainerArchive(f)).configDigest, f.config.digest);
        } else {
          await assert.rejects(verifyServerContainerArchive(f), /reference changed/);
        }
      });
    }
  }
});

test('archive verification refuses platform, source, reference, missing and corrupt blob bindings', async t => {
  const { verifyServerContainerArchive } = await lib;
  for (const mutation of ['platform', 'source', 'reference', 'oci-reference', 'descriptor-platform', 'config-alias', 'layer-alias', 'missing', 'config-bytes', 'layer-bytes', 'size', 'identity']) {
    await t.test(mutation, async t => {
      const f = await archiveFixture(t, async f => {
        if (mutation === 'platform') f.receipt.platform = 'linux/amd64';
        if (mutation === 'source') {
          f.receipt.sourceCommit = 'c'.repeat(40);
          f.receipt.labels = { ...f.receipt.labels, 'org.opencontainers.image.revision': f.receipt.sourceCommit };
        }
        if (mutation === 'identity') f.receipt.imageId = 'sha256:' + '9'.repeat(64);
        if (mutation === 'reference') f.aliases[0].RepoTags = ['wrong:tag'];
        if (mutation === 'config-alias') f.aliases[0].Config = 'wrong-config';
        if (mutation === 'layer-alias') f.aliases[0].Layers = [];
        if (['reference', 'config-alias', 'layer-alias'].includes(mutation))
          await fs.writeFile(path.join(f.tree, 'manifest.json'), JSON.stringify(f.aliases));
        const blob = d => path.join(f.tree, 'blobs/sha256', d.digest.slice(7));
        if (mutation === 'missing') await fs.rm(blob(f.config));
        if (mutation === 'config-bytes') await fs.appendFile(blob(f.config), 'x');
        if (mutation === 'layer-bytes') await fs.writeFile(blob(f.layer), Buffer.alloc(f.layer.size));
        if (mutation === 'size') {
          const rootIndex = { schemaVersion: 2, manifests: [{ ...f.index, size: f.index.size + 1 }] };
          await fs.writeFile(path.join(f.tree, 'index.json'), JSON.stringify(rootIndex));
        }
        if (mutation === 'oci-reference' || mutation === 'descriptor-platform') {
          const rootIndex = JSON.parse(await fs.readFile(path.join(f.tree, 'index.json'), 'utf8'));
          if (mutation === 'oci-reference') rootIndex.manifests[0].annotations['io.containerd.image.name'] = 'wrong:tag';
          else rootIndex.manifests[0].platform = { os: 'linux', architecture: 'amd64' };
          await fs.writeFile(path.join(f.tree, 'index.json'), JSON.stringify(rootIndex));
        }
      });
      await assert.rejects(verifyServerContainerArchive(f), /platform|source|label|reference|alias|member|digest|size|identity/);
    });
  }
});

test('owned producer removes only its recorded immutable container after success, failure or abort', async t => {
  const { runOwnedContainer } = await lib;
  for (const outcome of ['success', 'failure', 'abort']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-producer-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const calls = [];
    const controller = new AbortController();
    const id = 'c'.repeat(64);
    const run = async (engine, args, options) => {
      calls.push(args);
      if (args[0] === 'create') return id;
      if (args[0] === 'start') {
        if (outcome === 'failure') throw new Error('producer failed');
        if (outcome === 'abort') {
          controller.abort(); assert.equal(options.signal.aborted, true);
          throw new Error('producer aborted');
        }
        return 'producer output';
      }
      if (args[0] === 'inspect') return JSON.stringify({ Running: false, ExitCode: 0 });
      if (args[0] === 'rm') return '';
      throw new Error('unexpected engine call');
    };
    const promise = runOwnedContainer({ imageId, platform: 'linux/arm64', out: root,
      command: ['bash', '-c', 'exit 0'], signal: controller.signal }, run);
    if (outcome === 'success') assert.equal((await promise).output, 'producer output');
    else await assert.rejects(promise, /producer failed|producer aborted/);
    assert.deepEqual(calls.at(-1), ['rm', '--force', id]);
    const [directory] = await fs.readdir(root);
    const receipt = JSON.parse(await fs.readFile(path.join(root, directory, 'ownership.json')));
    assert.equal(receipt.containerId, id); assert.equal(receipt.removed, true);
  }
});

test('owned producer exposes a cross-UID clock without exposing its ownership receipt', async t => {
  const { runOwnedContainer, ownedContainerSupervisor } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-producer-clock-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let clockRoot;
  const oldUmask = process.umask(0o077);
  t.after(() => process.umask(oldUmask));
  const privileged = process.getuid?.() === 0;
  const sudo = !privileged && process.platform === 'linux' &&
    spawnSync('sudo', ['-n', process.execPath, '-e', 'process.exit(0)']).status === 0;
  await runOwnedContainer({ imageId, platform: 'linux/arm64', out: root, command: ['true'] },
    async (engine, args) => {
      if (args[0] === 'create') {
        const mount = args[args.indexOf('--mount') + 1];
        assert.match(mount, /,target=\/run\/papercusp-producer-owner,readonly$/);
        clockRoot = mount.split(',')[1].slice('source='.length);
        assert.equal((await fs.stat(clockRoot)).mode & 0o777, 0o755);
        assert.deepEqual(await fs.readdir(clockRoot), ['lease.json']);
        assert.equal((await fs.stat(path.join(clockRoot, 'lease.json'))).mode & 0o777, 0o644);
        assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(clockRoot, 'lease.json')))), ['at']);
        const ownerRoot = path.dirname(clockRoot);
        assert.equal((await fs.stat(ownerRoot)).mode & 0o777, 0o700);
        assert.equal((await fs.stat(path.join(ownerRoot, 'ownership.json'))).mode & 0o777, 0o600);
        return 'c'.repeat(64);
      }
      if (args[0] === 'start') {
        if (privileged || sudo) {
          // Enter the mounted directory before dropping privileges: a bind mount
          // bypasses the private host parents in exactly the same way.
          const probe = `const fs=require('node:fs');
            const [root,supervisor]=process.argv.slice(1);
            process.chdir(root);process.setgroups([]);process.setgid(1001);process.setuid(1001);
            let privateReadable=false;try{fs.readFileSync('../ownership.json');privateReadable=true}catch{}
            console.log(JSON.stringify({uid:process.getuid(),privateReadable,clock:JSON.parse(fs.readFileSync('lease.json','utf8'))}));
            process.argv=[process.execPath,'lease.json','1000','/usr/bin/printf','workload-ran'];eval(supervisor);`;
          for (const fresh of [true, false]) {
            await fs.writeFile(path.join(clockRoot, 'lease.json'), JSON.stringify({ at: fresh ? Date.now() : 0 }));
            const argv = ['-e', probe, clockRoot, ownedContainerSupervisor];
            const result = spawnSync(privileged ? process.execPath : 'sudo', privileged ? argv : ['-n', process.execPath, ...argv],
              { encoding: 'utf8', timeout: 5000 });
            assert.equal(result.status, fresh ? 0 : 125, result.stderr);
            const observation = JSON.parse(result.stdout.split('\n')[0]);
            assert.equal(observation.uid, 1001); assert.equal(observation.privateReadable, false);
            assert.equal(result.stdout.includes('workload-ran'), fresh);
          }
        } else t.diagnostic('Cross-UID OS probe unavailable; clock and private-receipt permission invariants checked.');
        return '';
      }
      if (args[0] === 'inspect') return JSON.stringify({ Running: false, ExitCode: 0 });
      if (args[0] === 'rm') return '';
      throw new Error('unexpected engine call');
    });
});

test('owned producer refreshes its clock after create before starting the workload', async t => {
  const { runOwnedContainer } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-producer-slow-create-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let now = Date.now(), clockRoot;
  t.mock.method(Date, 'now', () => now);
  await runOwnedContainer({ imageId, platform: 'linux/arm64', out: root, command: ['true'] },
    async (engine, args) => {
      if (args[0] === 'create') {
        clockRoot = args[args.indexOf('--mount') + 1].split(',')[1].slice('source='.length);
        now += 20_000;
        return 'c'.repeat(64);
      }
      if (args[0] === 'start') {
        assert.equal(JSON.parse(await fs.readFile(path.join(clockRoot, 'lease.json'))).at, now);
        return '';
      }
      if (args[0] === 'inspect') return JSON.stringify({ Running: false, ExitCode: 0 });
      if (args[0] === 'rm') return '';
      throw new Error('unexpected engine call');
    });
});

test('owned producer reports a refused daemon cleanup instead of claiming removal', async t => {
  const { runOwnedContainer } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-producer-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await assert.rejects(runOwnedContainer({ imageId, platform: 'linux/arm64', out: root, command: ['true'] },
    async (engine, args) => {
      if (args[0] === 'create') return 'c'.repeat(64);
      if (args[0] === 'start') throw new Error('producer failed');
      if (args[0] === 'rm') throw new Error('daemon unavailable');
    }), /cleanup failed/);
  const [directory] = await fs.readdir(root);
  const receipt = JSON.parse(await fs.readFile(path.join(root, directory, 'ownership.json')));
  assert.equal(receipt.removed, undefined); assert.match(receipt.cleanupError, /daemon unavailable/);
});

test('interrupted create recovers only the exact saved name, image and ownership token', async t => {
  const { runOwnedContainer } = await lib;
  for (const foreign of [false, true]) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-create-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const calls = []; let name, token;
    await assert.rejects(runOwnedContainer({ imageId, platform: 'linux/arm64', out: root, command: ['true'] },
      async (engine, args) => {
        calls.push(args);
        if (args[0] === 'create') {
          name = args[args.indexOf('--name') + 1]; token = args[args.indexOf('--label') + 1].split('=')[1];
          const [directory] = await fs.readdir(root);
          const receipt = JSON.parse(await fs.readFile(path.join(root, directory, 'ownership.json')));
          assert.equal(receipt.containerName, name); assert.equal(receipt.ownerToken, token);
          throw new Error('create response lost');
        }
        if (args[0] === 'inspect') {
          assert.equal(args.at(-1), name);
          return JSON.stringify({ Id: 'c'.repeat(64), Image: imageId,
            Config: { Labels: { 'dev.papercusp.producer-owner': foreign ? 'foreign' : token } } });
        }
        if (args[0] === 'rm') return '';
        throw new Error('unexpected');
      }), foreign ? /cleanup failed/ : /create response lost/);
    assert.equal(calls.some(args => args[0] === 'rm'), !foreign);
    if (!foreign) assert.deepEqual(calls.at(-1), ['rm', '--force', 'c'.repeat(64)]);
  }
});

test('interrupted create waits for a late owned object before removing its immutable ID', async t => {
  const { runOwnedContainer } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-create-late-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let name, token, inspections = 0, creates = 0;
  const removed = [];
  await assert.rejects(runOwnedContainer({ imageId, platform: 'linux/arm64', out: root,
    command: ['true'], cleanupTimeoutMs: 1000 }, async (engine, args) => {
    if (args[0] === 'create') {
      creates++;
      name = args[args.indexOf('--name') + 1]; token = args[args.indexOf('--label') + 1].split('=')[1];
      throw new Error('create client timed out');
    }
    if (args[0] === 'inspect') {
      assert.equal(args.at(-1), name);
      if (++inspections === 1) throw new Error('No such object: ' + name);
      return JSON.stringify({ Id: 'c'.repeat(64), Image: imageId,
        Config: { Labels: { 'dev.papercusp.producer-owner': token } } });
    }
    if (args[0] === 'rm') { removed.push(args); return ''; }
    throw new Error('unexpected');
  }), /create client timed out/);
  assert.equal(creates, 1); assert.equal(inspections, 2);
  assert.deepEqual(removed, [['rm', '--force', 'c'.repeat(64)]]);
  const [directory] = await fs.readdir(root);
  const receipt = JSON.parse(await fs.readFile(path.join(root, directory, 'ownership.json')));
  assert.equal(receipt.removed, true); assert.equal(receipt.cleanupPending, false);
});

test('an absent interrupted create remains pending and resumes without another create', async t => {
  const { runOwnedContainer, reconcileOwnedContainer } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-create-pending-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let name, token, creates = 0;
  await assert.rejects(runOwnedContainer({ imageId, platform: 'linux/arm64', out: root,
    command: ['true'], cleanupTimeoutMs: 50 }, async (engine, args) => {
    if (args[0] === 'create') {
      creates++;
      name = args[args.indexOf('--name') + 1]; token = args[args.indexOf('--label') + 1].split('=')[1];
      throw new Error('create client timed out');
    }
    if (args[0] === 'inspect') throw new Error('No such object: ' + name);
    throw new Error('must not remove an absent object');
  }), /cleanup failed/);
  const [directory] = await fs.readdir(root);
  const receiptFile = path.join(root, directory, 'ownership.json');
  const pending = JSON.parse(await fs.readFile(receiptFile));
  assert.equal(pending.removed, undefined); assert.equal(pending.cleanupPending, true);
  assert.match(pending.cleanupError, /pending/);
  for (const foreign of [true, false]) {
    let removals = 0;
    const reconcile = reconcileOwnedContainer({ receiptFile, cleanupTimeoutMs: 50 }, async (engine, args) => {
      if (args[0] === 'inspect') {
        assert.equal(args.at(-1), name);
        return JSON.stringify({ Id: 'c'.repeat(64), Image: imageId,
          Config: { Labels: { 'dev.papercusp.producer-owner': foreign ? 'foreign' : token } } });
      }
      if (args[0] === 'rm') { assert.equal(args.at(-1), 'c'.repeat(64)); removals++; return ''; }
      throw new Error('resumed cleanup must not create or start a workload');
    });
    if (foreign) await assert.rejects(reconcile, /ownership/);
    else assert.equal((await reconcile).removed, true);
    assert.equal(removals, foreign ? 0 : 1);
  }
  assert.equal(creates, 1);
  const settled = JSON.parse(await fs.readFile(receiptFile));
  assert.equal(settled.cleanupPending, false); assert.equal(settled.cleanupError, undefined);
});

test('in-container supervisor terminates the producer when launcher lease disappears', async t => {
  const { ownedContainerSupervisor } = await lib;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-producer-lease-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const lease = path.join(root, 'lease.json');
  const marker = path.join(root, 'child-stopped');
  await fs.writeFile(lease, JSON.stringify({ at: Date.now() }));
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', ownedContainerSupervisor, lease, '1000',
    process.execPath, '-e', 'process.on("SIGTERM",()=>{require("node:fs").writeFileSync(process.argv[1],"stopped");process.exit(0)});setInterval(()=>{},100)', marker]);
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  t.after(() => child.kill('SIGKILL'));
  assert.equal(await exit, 125);
  assert.equal(await fs.readFile(marker, 'utf8'), 'stopped');
});

async function fixture(t, platform = 'linux/amd64') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'server-container-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resources = path.join(root, 'resources');
  const sidecar = path.join(root, 'sidecar');
  await fs.mkdir(resources);
  await fs.mkdir(sidecar);
  await fs.mkdir(path.join(sidecar, 'db-sql'));
  await fs.writeFile(path.join(sidecar, 'db-sql/000-fixture.sql'), '-- fixture migrations\n');
  const rootfs = path.join(resources, 'papercup-runtime.tar.gz');
  const content = 'rootfs archive fixture';
  await fs.writeFile(rootfs, content);
  const env = { ...process.env, UBUNTU_IMAGE: 'ubuntu:24.04', NODE_VERSION: '24.18.1',
    PNPM_VERSION: '9.15.0', PAPERCUSP_RUNTIME_PLATFORM: platform };
  const probe = spawnSync('bash', [path.join(desktop, 'scripts/build-rootfs.sh'), '--print-recipe-fingerprint'],
    { env, encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const rootfsStamp = { platform, rootfsSha256: sha(content), recipeSha256: probe.stdout.trim(),
    nodeVersion: '24.18.1', pnpmVersion: '9.15.0', baseImage: 'ubuntu:24.04' };
  await fs.writeFile(path.join(resources, '.rootfs-build-stamp'), JSON.stringify(rootfsStamp));
  await fs.writeFile(path.join(sidecar, 'serve.mjs'), 'native server bytes');
  await fs.writeFile(path.join(sidecar, 'mcp-proxy.mjs'), 'native proxy bytes');
  const sidecarStamp = { gitHead: 'a'.repeat(40), serveSha256: sha('native server bytes'),
    mcpProxySha256: sha('native proxy bytes') };
  await fs.writeFile(path.join(sidecar, '.sidecar-build-stamp'), JSON.stringify(sidecarStamp));
  return {
    root, resources, rootfs, rootfsStamp, sidecar, sidecarStamp,
    options: { rootfs, sidecar, platform, tag: 'papercusp/server:fixture', out: path.join(root, 'output') },
  };
}

function nativeHeader(machine) {
  const bytes = Buffer.alloc(20);
  Buffer.from([127, 69, 76, 70, 2, 1]).copy(bytes);
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

async function fakeRunner(options = {}) {
  const calls = [];
  const id = options.imageId ?? imageId;
  let labels = options.labels;
  let imageContext = options.imageContext;
  return {
    calls,
    run: async (command, args, config) => {
      calls.push({ command, args });
      if (command === 'bash') {
        const result = spawnSync(command, args, { env: config.env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'build') {
        labels = {};
        args.forEach((arg, index) => {
          if (arg === '--label') {
            const value = args[index + 1];
            labels[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1);
          }
        });
        const context = args.at(-1);
        imageContext = context;
        assert.equal(await fs.readFile(path.join(context, 'sidecar/serve.mjs'), 'utf8'), options.serveBytes ?? 'native server bytes');
        const recipe = await fs.readFile(path.join(context, 'Containerfile'), 'utf8');
        assert.match(recipe, /ADD papercup-runtime\.tar\.gz/);
        assert.match(recipe, /PAPERCUSP_PG_SQL_DIR=\/opt\/papercusp\/sidecar\/db-sql/);
        assert.match(recipe, /PAPERCUSP_SIDECAR_DIR=\/opt\/papercusp\/sidecar/);
        assert.match(recipe, /PAPERCUSP_BUILD_SHA=\$\{PAPERCUSP_BUILD_SHA\}/);
        assert.equal(args[args.indexOf('--build-arg') + 1], 'PAPERCUSP_BUILD_SHA=' + labels['org.opencontainers.image.revision']);
        if (options.failBuild) throw new Error('engine build failure');
        await fs.writeFile(args[args.indexOf('--iidfile') + 1], id);
        return '';
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'image') {
        return JSON.stringify({ Id: 'inspectId' in options ? options.inspectId :
          (options.engine === 'podman' ? id.slice(7) : id),
          Os: 'linux', Architecture: options.wrongPlatform ? 'arm64' : (options.arch ?? 'amd64'),
          Config: { Labels: { ...labels, ...(options.wrongLabel ?
            { 'org.opencontainers.image.revision': '9'.repeat(40) } : {}) } } });
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'run') {
        assert.ok(args.includes(id), 'probe the content-addressed image, never a tag');
        assert.equal(args[args.indexOf('--network') + 1], 'none');
        if (options.engine === 'podman') {
          for (let i = 0; i < args.length; i++) {
            if (args[i] === '--tmpfs') assert.doesNotMatch(args[i + 1], /(?:uid|gid)=/,
              'Podman 4.9 refuses uid/gid in --tmpfs');
          }
        }
        if (args.at(-1).includes('papercusp-boot-home-check')) {
          assert.ok(args.includes('--rm'));
          assert.ok(args.includes('--read-only'));
          assert.equal(args[args.indexOf('--entrypoint') + 1], '/usr/local/bin/node');
          if (options.engine === 'podman') assert.ok(args.includes(
            'type=tmpfs,destination=/home/papercup,tmpfs-mode=0700,notmpcopyup,U=true'));
          else assert.ok(args.includes('/home/papercup:rw,uid=1001,gid=1001,mode=0700'));
          return JSON.stringify({ uid: 1001, gid: 1001, homeUid: 1001, homeGid: 1001,
            mode: 0o700, empty: true, writable: !options.unwritableHome,
            ...options.homeObservation });
        }
        if (args.includes('--detach')) {
          assert.ok(args.includes('--read-only'));
          assert.ok(args.includes('PAPERCUSP_DBOS_ENABLE=1'));
          assert.equal(args.includes('--publish'), false);
          assert.equal(args.includes('--volume'), false);
          return 'd'.repeat(64);
        }
        assert.ok(args.includes('--read-only'));
        assert.equal(args[args.indexOf('--entrypoint') + 1], '/usr/local/bin/node');
        if (options.wrongPayload) await fs.writeFile(path.join(imageContext, 'sidecar/serve.mjs'), 'substituted packed bytes');
        const script = args.at(-1).replaceAll('/opt/papercusp/sidecar/', path.join(imageContext, 'sidecar') + '/');
        const setup = "Object.defineProperty(process,'version',{value:'v24.18.1'});" +
          "Object.defineProperty(process,'arch',{value:'" + (options.wrongRuntime ? 'ia32' : (options.arch === 'arm64' ? 'arm64' : 'x64')) + "'});";
        const result = spawnSync(process.execPath, ['-e', setup + script], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'inspect') {
        return JSON.stringify({ Running: !options.exitedServer, ExitCode: options.exitedServer ? 1 : 0 });
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'exec') {
        return JSON.stringify({ arch: options.arch === 'arm64' ? 'arm64' : 'x64', node: 'v24.18.1',
          ready: { status: 200, body: { ready: !options.unreadyServer, dbos: !options.noDbos,
            dbosEnabled: !options.noDbos } },
          health: { status: 200, body: { ok: true, service: 'papercusp-operator',
            sha: options.wrongBootSource ? 'c'.repeat(40) : 'a'.repeat(40) } },
          database: { vectorReady: !options.noVector, schemaReady: !options.noSchema, serverVersion: '18.6' } });
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'rm') return '';
      if (command === 'syft') {
        const output = args[args.indexOf('-o') + 1].slice('cyclonedx-json='.length);
        await fs.writeFile(output, JSON.stringify({
          bomFormat: 'CycloneDX', components: Array.from({ length: options.emptySbom ? 0 : 50 },
            (_, i) => ({ name: 'runtime-package-' + i, type: 'library' })),
        }));
        return '';
      }
      throw new Error('Unexpected command: ' + command);
    },
  };
}

test('preflight binds the exact native payload and WSL archive without writing outputs', async t => {
  const f = await fixture(t);
  const { preflightServerContainer } = await lib;
  const first = await preflightServerContainer(f.options);
  assert.equal(first.rootfsSha256, f.rootfsStamp.rootfsSha256);
  assert.equal(first.serveSha256, f.sidecarStamp.serveSha256);
  assert.equal(first.sourceCommit, f.sidecarStamp.gitHead);
  await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
  await fs.writeFile(path.join(f.sidecar, 'worker.mjs'), 'changed worker payload');
  const second = await preflightServerContainer(f.options);
  assert.notEqual(first.sidecarSha256, second.sidecarSha256, 'non-entry payload bytes are also bound');
});

test('missing or empty packaged SQL refuses before the engine can boot a schema-less Server', async t => {
  const { preflightServerContainer } = await lib;
  const f = await fixture(t);
  await fs.rm(path.join(f.sidecar, 'db-sql/000-fixture.sql'));
  await assert.rejects(preflightServerContainer(f.options), /lacks packaged SQL migrations/);
  await fs.rm(path.join(f.sidecar, 'db-sql'), { recursive: true });
  await assert.rejects(preflightServerContainer(f.options), /ENOENT/);
  await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
});

test('tampered archives, stale recipes, and missing platform receipts refuse preflight', async t => {
  const { preflightServerContainer } = await lib;
  for (const mutation of ['archive', 'recipe', 'platform']) {
    await t.test(mutation, async sub => {
      const f = await fixture(sub);
      if (mutation === 'archive') await fs.appendFile(f.rootfs, 'tampering');
      else {
        if (mutation === 'recipe') f.rootfsStamp.recipeSha256 = 'c'.repeat(64);
        else delete f.rootfsStamp.platform;
        await fs.writeFile(path.join(f.resources, '.rootfs-build-stamp'), JSON.stringify(f.rootfsStamp));
      }
      await assert.rejects(preflightServerContainer(f.options), /receipt|stale/);
      await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
    });
  }
});

test('wrong-architecture native dependencies and escaping links are rejected', async t => {
  const { preflightServerContainer } = await lib;
  const f = await fixture(t);
  await fs.writeFile(path.join(f.sidecar, 'dependency.node'), nativeHeader(183));
  await assert.rejects(preflightServerContainer(f.options), /architecture mismatch/);
  await fs.unlink(path.join(f.sidecar, 'dependency.node'));
  const outside = path.join(f.root, 'external');
  await fs.writeFile(outside, 'external material must not enter the image');
  await fs.symlink(outside, path.join(f.sidecar, 'external-link'));
  await assert.rejects(preflightServerContainer(f.options), /escapes its payload/);
});

test('arm64 payloads are validated and executable-mode changes affect the binding', async t => {
  const { preflightServerContainer } = await lib;
  const f = await fixture(t, 'linux/arm64');
  await fs.mkdir(path.join(f.sidecar, 'bin'));
  await fs.writeFile(path.join(f.sidecar, 'bin/node'), nativeHeader(183));
  const first = await preflightServerContainer(f.options);
  await fs.chmod(path.join(f.sidecar, 'bin/node'), 0o755);
  const second = await preflightServerContainer(f.options);
  assert.notEqual(first.sidecarSha256, second.sidecarSha256);
});

test('every ELF payload must match the platform, including pui, PostgreSQL and non-executable libraries', async t => {
  const { preflightServerContainer } = await lib;
  for (const name of ['bin/pui', 'node_modules/@embedded-postgres/linux-arm64/native/bin/postgres', 'lib/libpayload.so']) {
    await t.test(name, async sub => {
      const f = await fixture(sub, 'linux/arm64');
      const native = path.join(f.sidecar, name);
      await fs.mkdir(path.dirname(native), { recursive: true });
      await fs.writeFile(native, nativeHeader(62), { mode: 0o644 });
      await assert.rejects(preflightServerContainer(f.options), /Native payload architecture mismatch/);
      await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
      await fs.writeFile(native, nativeHeader(183));
      await preflightServerContainer(f.options);
    });
  }
});

test('architecture validation follows in-payload ELF links and permits scripts', async t => {
  const { preflightServerContainer } = await lib;
  const f = await fixture(t, 'linux/arm64');
  await fs.mkdir(path.join(f.sidecar, 'bin'));
  await fs.writeFile(path.join(f.sidecar, 'payload'), nativeHeader(62));
  await fs.symlink('../payload', path.join(f.sidecar, 'bin/pui'));
  await assert.rejects(preflightServerContainer(f.options), /Native payload architecture mismatch/);
  await fs.writeFile(path.join(f.sidecar, 'payload'), nativeHeader(183));
  await fs.writeFile(path.join(f.sidecar, 'bin/launcher'), '#!/bin/sh\nexec node serve.mjs\n', { mode: 0o755 });
  await preflightServerContainer(f.options);
});

test('entry bytes and source provenance must match their native build receipt', async t => {
  const { preflightServerContainer } = await lib;
  const f = await fixture(t);
  await fs.writeFile(path.join(f.sidecar, 'serve.mjs'), 'different build');
  await assert.rejects(preflightServerContainer(f.options), /receipt mismatch/);
  await fs.writeFile(path.join(f.sidecar, 'serve.mjs'), 'native server bytes');
  f.sidecarStamp.gitHead = '12345678';
  await fs.writeFile(path.join(f.sidecar, '.sidecar-build-stamp'), JSON.stringify(f.sidecarStamp));
  await assert.rejects(preflightServerContainer(f.options), /full source commit/);
  const pinned = await preflightServerContainer({ ...f.options, sourceCommit: '12345678' + 'a'.repeat(32) });
  assert.equal(pinned.sourceCommit, '12345678' + 'a'.repeat(32));
  await assert.rejects(preflightServerContainer({ ...f.options, sourceCommit: 'b'.repeat(40) }), /matching/);
});

test('successful build inspects the content-addressed image and publishes bound local evidence', async t => {
  const { buildServerContainer } = await lib;
  const f = await fixture(t);
  const runner = await fakeRunner();
  const progress = [];
  f.options.onProgress = phase => progress.push(phase);
  const result = await buildServerContainer(f.options, runner.run);
  assert.equal(result.imageId, imageId);
  assert.equal(result.labels['com.papercusp.serve.sha256'], f.sidecarStamp.serveSha256);
  assert.equal(result.sbomPackages, 50);
  assert.equal(result.signed, false);
  assert.equal(result.published, false);
  assert.equal(result.payloadVerification.serveSha256, f.sidecarStamp.serveSha256);
  assert.equal(result.payloadVerification.mcpProxySha256, f.sidecarStamp.mcpProxySha256);
  assert.equal(result.bootVerification.imageId, imageId);
  assert.equal(result.bootVerification.database.vectorReady, true);
  assert.equal(result.bootVerification.ready.body.dbos, true);
  assert.deepEqual(progress, ['preflight', 'freeze-inputs', 'build-image', 'verify-payload',
    'verify-full-boot', 'generate-sbom', 'publish-local-evidence', 'complete']);
  assert.deepEqual(JSON.parse(await fs.readFile(result.receiptPath, 'utf8')).imageId, imageId);
  assert.equal(runner.calls.filter(c => c.command === 'docker' && c.args[0] === 'build').length, 1);
  assert.ok(runner.calls.some(c => c.command === 'docker' && c.args.includes(imageId)));
  assert.ok(runner.calls.findIndex(c => c.command === 'docker' && c.args[0] === 'run') <
    runner.calls.findIndex(c => c.command === 'syft'));
  assert.equal((await fs.readdir(f.options.out)).some(name => name.startsWith('.server-container-build-')), false);
});

test('Podman build accepts a full bare inspect hash and preserves canonical receipt identity', async t => {
  const { buildServerContainer } = await lib;
  const f = await fixture(t);
  const runner = await fakeRunner({ engine: 'podman' });
  const result = await buildServerContainer({ ...f.options, engine: 'podman' }, runner.run);
  assert.equal(result.imageId, imageId);
  assert.equal(result.bootVerification.imageId, imageId);
  assert.equal(JSON.parse(await fs.readFile(result.receiptPath, 'utf8')).imageId, imageId);
  assert.ok(runner.calls.some(c => c.command === 'podman' && c.args[0] === 'run' && c.args.includes(imageId)));
});

test('Podman inspect normalization rejects different, incomplete or malformed hashes and provenance', async t => {
  const { buildServerContainer } = await lib;
  for (const mismatch of [{ inspectId: 'c'.repeat(64) }, { inspectId: 'sha256:' + 'c'.repeat(64) },
    { inspectId: 'b'.repeat(12) }, { inspectId: 'z'.repeat(64) }, { inspectId: null },
    { wrongPlatform: true }, { wrongLabel: true }]) {
    await t.test(JSON.stringify(mismatch), async t => {
      const f = await fixture(t);
      const runner = await fakeRunner({ engine: 'podman', ...mismatch });
      await assert.rejects(buildServerContainer({ ...f.options, engine: 'podman' }, runner.run),
        /Built image does not match/);
      assert.equal(runner.calls.some(c => c.command === 'podman' && c.args[0] === 'run'), false);
      await assert.rejects(fs.stat(path.join(f.options.out, 'papercusp-server-amd64-' + imageId.slice(7, 19))),
        { code: 'ENOENT' });
    });
  }
});

test('retained image qualification binds every input without freezing or rebuilding', async t => {
  const { preflightServerContainer, buildServerContainer } = await lib;
  const f = await fixture(t);
  const input = await preflightServerContainer(f.options);
  const labels = {
    'org.opencontainers.image.revision': input.sourceCommit,
    'com.papercusp.rootfs.sha256': input.rootfsSha256,
    'com.papercusp.sidecar.sha256': input.sidecarSha256,
    'com.papercusp.serve.sha256': input.serveSha256,
    'com.papercusp.native.release-audit': 'unverified',
    'com.papercusp.native.source-verified': 'false',
  };
  const progress = [];
  const runner = await fakeRunner({ engine: 'podman', labels, imageContext: f.root });
  const result = await buildServerContainer({ ...f.options, engine: 'podman', imageId,
    onProgress: phase => progress.push(phase) }, runner.run);
  assert.equal(result.buildMode, 'qualify-retained-image');
  assert.equal(result.containerfileSha256, null, 'qualification cannot attest a previous build recipe');
  assert.equal(result.bootVerification.homeVerification.writable, true);
  assert.equal(runner.calls.some(c => c.args[0] === 'build'), false);
  assert.equal(progress.includes('freeze-inputs'), false);
  assert.equal(result.signed, false);
  assert.equal(result.published, false);
  for (const key of Object.keys(labels)) {
    const mismatch = await fakeRunner({ engine: 'podman', labels: { ...labels, [key]: 'different' }, imageContext: f.root });
    await assert.rejects(buildServerContainer({ ...f.options, engine: 'podman', imageId }, mismatch.run),
      /does not match/);
    assert.equal(mismatch.calls.some(c => ['run', 'build'].includes(c.args[0])), false);
  }
  for (const invalid of ['localhost/image:mutable', 'c'.repeat(64), 'sha256:' + 'c'.repeat(12)]) {
    await assert.rejects(buildServerContainer({ ...f.options, imageId: invalid }, runner.run), /immutable image ID/);
  }
});

test('private home precheck refuses wrong identity, ownership, mode, contents or write access before services', async t => {
  const { verifyServerContainerBoot } = await lib;
  for (const homeObservation of [{ uid: 0 }, { gid: 0 }, { homeUid: 0 }, { homeGid: 0 },
    { mode: 0o777 }, { empty: false }, { writable: false }]) {
    await t.test(JSON.stringify(homeObservation), async () => {
      const runner = await fakeRunner({ engine: 'podman', homeObservation });
      await assert.rejects(verifyServerContainerBoot({ engine: 'podman', platform: 'linux/amd64',
        imageId, sourceCommit: 'a'.repeat(40), nodeVersion: '24.18.1' }, runner.run), /private writable non-root home/);
      assert.equal(runner.calls.some(c => c.args.includes('--detach')), false);
      assert.equal(runner.calls.some(c => c.command === 'syft'), false);
    });
  }
});

test('generated home precheck actually writes and removes its file and rejects a populated home', async t => {
  const { verifyServerContainerHome } = await lib;
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'boot-home-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const run = async (_engine, args) => {
    const setup = `(()=>{
      const fs=require('node:fs'),home=${JSON.stringify(home)};
      process.env.HOME='/home/papercup';process.getuid=()=>1001;process.getgid=()=>1001;
      const translate=p=>p.replace('/home/papercup',home);
      for(const name of ['statSync','readdirSync','writeFileSync','unlinkSync']) {
        const original=fs[name];fs[name]=(p,...args)=>{
          const r=original(translate(p),...args);
          if(name==='statSync'){r.uid=1001;r.gid=1001;}return r;
        };
      }
    })();`;
    const r = spawnSync(process.execPath, ['-e', setup + args.at(-1)], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout;
  };
  const options = { engine: 'podman', platform: 'linux/amd64', imageId };
  assert.equal((await verifyServerContainerHome(options, run)).writable, true);
  assert.deepEqual(await fs.readdir(home), [], 'the actual generated script leaves no check file');
  await fs.writeFile(path.join(home, 'unexpected'), 'state from another instance');
  await assert.rejects(verifyServerContainerHome(options, run), /AssertionError/);
});

test('the actual in-container probe queries the discovered database after DBOS readiness', async () => {
  const { verifyServerContainerBoot } = await lib;
  let removed = false;
  const run = async (_command, args) => {
    if (args[0] === 'run') return args.includes('--detach') ? 'd'.repeat(64) :
      JSON.stringify({ uid: 1001, gid: 1001, homeUid: 1001, homeGid: 1001, mode: 0o700, empty: true, writable: true });
    if (args[0] === 'inspect') return JSON.stringify({ Running: true });
    if (args[0] === 'rm') { removed = true; return ''; }
    assert.equal(args[0], 'exec');
    // Execute the producer's generated probe, rather than supplying the result
    // it is expected to return. Both connection routing and query shape are
    // checked by the child; a wrong call yields no qualifying database proof.
    const setup = `
      const assert=require('node:assert/strict');
      Object.defineProperty(process,'version',{value:'v24.18.1'});
      Object.defineProperty(process,'arch',{value:'x64'});
      globalThis.fetch=async url=>({status:200,json:async()=>url.endsWith('/ready')
        ?{ready:true,dbos:true,dbosEnabled:true}
        :{ok:true,service:'papercusp-operator',sha:'${'a'.repeat(40)}'}});
      require('node:fs').readFileSync=name=>{
        assert.equal(name,'/home/papercup/.papercusp/embedded-pg.json');
        return JSON.stringify({url:'postgres://fixture/isolated'});
      };
      require('node:child_process').spawnSync=(command,args)=>{
        assert.equal(command,'/usr/bin/psql');
        assert.equal(args[0],'postgres://fixture/isolated');
        assert.ok(args.at(-1).includes("extname='vector'"));
        assert.ok(args.at(-1).includes("schemaname='harness_shared'"));
        return {status:0,stdout:JSON.stringify({vectorReady:true,schemaReady:true,serverVersion:'18.6'})};
      };
    `;
    const r = spawnSync(process.execPath, ['-e', setup + args.at(-1)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const observed = await verifyServerContainerBoot({ engine: 'docker', imageId, platform: 'linux/amd64',
    sourceCommit: 'a'.repeat(40), nodeVersion: '24.18.1', bootTimeoutMs: 1000 }, run);
  assert.equal(observed.database.vectorReady, true);
  assert.equal(observed.database.schemaReady, true);
  assert.equal(removed, true);
});

test('a liveness response cannot qualify an unready Server, missing DBOS, missing database or different source', async t => {
  const { verifyServerContainerBoot } = await lib;
  for (const mode of ['unreadyServer', 'noDbos', 'noVector', 'noSchema', 'wrongBootSource', 'exitedServer']) {
    await t.test(mode, async () => {
      const runner = await fakeRunner({ [mode]: true });
      await assert.rejects(verifyServerContainerBoot({ engine: 'docker', platform: 'linux/amd64',
        imageId, sourceCommit: 'a'.repeat(40), nodeVersion: '24.18.1', bootTimeoutMs: 1 }, runner.run),
      /did not establish full boot readiness|exited during boot/);
      assert.equal(runner.calls.at(-1).args[0], 'rm', 'the isolated Server is always removed');
    });
  }
});

test('correct image labels cannot hide substituted packaged Server bytes or the wrong runtime', async t => {
  const { buildServerContainer } = await lib;
  for (const mode of ['wrongPayload', 'wrongRuntime']) {
    await t.test(mode, async sub => {
      const f = await fixture(sub);
      const runner = await fakeRunner({ [mode]: true });
      await assert.rejects(buildServerContainer(f.options, runner.run), /Packaged Server bytes or runtime/);
      assert.equal(runner.calls.some(call => call.command === 'syft'), false);
      assert.deepEqual(await fs.readdir(f.options.out), []);
    });
  }
});

test('engine failure, wrong-platform images and uncovered SBOMs publish no success receipt', async t => {
  const { buildServerContainer } = await lib;
  for (const mode of ['failBuild', 'wrongPlatform', 'emptySbom']) {
    await t.test(mode, async sub => {
      const f = await fixture(sub);
      const runner = await fakeRunner({ [mode]: true });
      await assert.rejects(buildServerContainer(f.options, runner.run), /failure|platform|coverage/);
      assert.deepEqual(await fs.readdir(f.options.out), []);
    });
  }
});

test('build retries preserve an earlier atomic generation and reject damaged evidence', async t => {
  const { buildServerContainer } = await lib;
  const f = await fixture(t);
  const firstRunner = await fakeRunner();
  const first = await buildServerContainer(f.options, firstRunner.run);
  const prior = await fs.readFile(first.receiptPath, 'utf8');
  const failingRunner = await fakeRunner({ emptySbom: true });
  await assert.rejects(buildServerContainer(f.options, failingRunner.run), /coverage/);
  assert.equal(await fs.readFile(first.receiptPath, 'utf8'), prior);
  const retryRunner = await fakeRunner();
  const retried = await buildServerContainer(f.options, retryRunner.run);
  assert.equal(retried.receiptPath, first.receiptPath);
  assert.equal(await fs.readFile(first.receiptPath, 'utf8'), prior);
  await fs.appendFile(first.sbomPath, 'damaged');
  const damagedRunner = await fakeRunner();
  await assert.rejects(buildServerContainer(f.options, damagedRunner.run), /inconsistent evidence/);
  assert.equal(await fs.readFile(first.receiptPath, 'utf8'), prior);
  assert.equal((await fs.readdir(f.options.out)).filter(name => name.startsWith('.server-container-build-')).length, 0);
});

async function publicationFixture(t, overrides = {}) {
  const { buildServerContainer } = await lib;
  const amd64 = await fixture(t);
  const arm64 = await fixture(t, 'linux/arm64');
  for (const native of [amd64, arm64]) {
    if (!overrides.unauditedNative) native.sidecarStamp.releaseIdentityAudit = {
      schemaVersion: 1, passed: true, scanner: 'audit-release-bundle.py --scan-dir',
    };
    await fs.writeFile(path.join(native.sidecar, '.sidecar-build-stamp'), JSON.stringify(native.sidecarStamp));
    await fs.writeFile(path.join(native.sidecar, 'build-provenance.json'), JSON.stringify({
      gitHead: native.sidecarStamp.gitHead, gitDirty: Boolean(overrides.dirtyNativeSource),
    }));
  }
  if (overrides.arm64ServeBytes) {
    await fs.writeFile(path.join(arm64.sidecar, 'serve.mjs'), overrides.arm64ServeBytes);
    arm64.sidecarStamp.serveSha256 = sha(overrides.arm64ServeBytes);
    await fs.writeFile(path.join(arm64.sidecar, '.sidecar-build-stamp'), JSON.stringify(arm64.sidecarStamp));
  }
  const engine = overrides.engine ?? 'docker';
  amd64.options.engine = arm64.options.engine = engine;
  const amd64Runner = await fakeRunner({ engine });
  const arm64Runner = await fakeRunner({ engine, arch: 'arm64', imageId: 'sha256:' + 'c'.repeat(64),
    serveBytes: overrides.arm64ServeBytes });
  const receipts = [await buildServerContainer(amd64.options, amd64Runner.run),
    await buildServerContainer(arm64.options, arm64Runner.run)];
  const key = path.join(amd64.root, 'release.key');
  await fs.writeFile(key, 'fixture key');
  await fs.writeFile(path.join(amd64.root, 'release.pub'), 'fixture verification key');
  const options = { amd64Receipt: receipts[0].receiptPath, arm64Receipt: receipts[1].receiptPath,
    key, engine, tag: 'registry.example.com:5000/papercusp/server:release', out: path.join(amd64.root, 'publication') };
  const images = receipts.map(receipt => ({ Id: receipt.imageId, Os: 'linux', Architecture: receipt.platform.split('/')[1],
    Config: { Labels: { ...receipt.labels } } }));
  const digests = ['sha256:' + 'd'.repeat(64), 'sha256:' + 'e'.repeat(64)];
  const indexDigest = 'sha256:' + 'f'.repeat(64);
  const calls = [];
  let activeBootReceipt;
  const run = async (command, args, runOptions) => {
    calls.push({ command, args });
    if (command === 'tar') return (await lib).runCommand(command, args, runOptions);
    if (command === engine && ['image', 'load', 'tag', 'push', 'manifest', 'run', 'inspect', 'exec', 'rm'].includes(args[0])) {
      if (args[0] === 'load') return '';
      if (args[0] === 'image') {
        const image = images.find(image => image.Id === args.at(-1));
        return JSON.stringify({ ...image, Id: 'inspectId' in overrides ? overrides.inspectId :
          (engine === 'podman' ? image.Id.slice(7) : image.Id),
          Architecture: overrides.wrongPlatform ? '386' : image.Architecture,
          Config: { Labels: { ...image.Config.Labels, ...(overrides.wrongLabel ?
            { 'org.opencontainers.image.revision': '9'.repeat(40) } : {}) } } });
      }
      if (args[0] === 'run') {
        const receipt = receipts[images.findIndex(image => args.includes(image.Id))];
        if (args.includes('--detach')) { activeBootReceipt = receipt; return 'd'.repeat(64); }
        if (args.at(-1).includes('papercusp-boot-home-check')) return JSON.stringify(receipt.bootVerification.homeVerification);
        return JSON.stringify({ ...receipt.payloadVerification,
          ...(overrides.changedImagePayload ? { mcpProxySha256: '9'.repeat(64) } : {}) });
      }
      if (args[0] === 'inspect') return JSON.stringify({ Running: true, ExitCode: 0 });
      if (args[0] === 'exec') return JSON.stringify({ ...activeBootReceipt.bootVerification,
        ...(overrides.unreadyPublishedServer ? { ready: { status: 503, body: { ready: false } } } : {}) });
      if (args[0] === 'rm') { activeBootReceipt = null; return ''; }
      return '';
    }
    if (command === 'sudo' || command === 'podman') {
      const ref = args.at(-1).slice('docker://'.length);
      const archIndex = ref.includes('-amd64-') || ref.endsWith(digests[0]) ? 0 :
        ref.includes('-arm64-') || ref.endsWith(digests[1]) ? 1 : -1;
      if (!args.includes('--raw')) return (archIndex < 0 ? indexDigest : digests[archIndex]) + '\n';
      if (archIndex >= 0) return JSON.stringify({ config: { digest: overrides.wrongConfig ? indexDigest : images[archIndex].Id } });
      return JSON.stringify({ manifests: digests.map((digest, i) => ({
        digest: overrides.wrongMember && i === 1 ? indexDigest : digest,
        platform: { os: 'linux', architecture: i === 0 || overrides.missingArm64 ? 'amd64' : 'arm64' },
      })) });
    }
    if (command === 'bash') {
      assert.match(args[0], /infra\/images\/bootc\/release-supply-chain\.sh$/);
      const signingOut = args[args.indexOf('--out') + 1];
      const reference = args[args.indexOf('--image') + 1];
      assert.match(reference, /@sha256:[a-f0-9]{64}$/);
      assert.equal(args[args.indexOf('--source-commit') + 1], 'a'.repeat(40));
      assert.equal(args[args.indexOf('--containerfile') + 1], 'infra/images/server/Containerfile');
      assert.equal(args[args.indexOf('--base-image') + 1], 'ubuntu:24.04');
      await fs.mkdir(signingOut, { recursive: true });
      await fs.writeFile(path.join(signingOut, 'supply-chain-summary.json'), JSON.stringify({
        reference, signed: true, provenanceAttested: true, sbomAttested: true, secretScan: 'clean',
        verifiedFromRegistry: !overrides.unverifiedSignature, sbomPackages: overrides.invalidCoverage ? 'skipped' : '50',
      }));
      return '';
    }
    throw new Error('Unexpected publication command: ' + command);
  };
  return { options, receipts, images, calls, run };
}

async function importedPublicationFixture(t, overrides = {}) {
  const f = await publicationFixture(t, { engine: 'podman', ...overrides });
  const original = f.receipts[1];
  const a = await archiveFixture(t, a => { a.receipt.engine = 'docker'; }, false, original);
  await fs.copyFile(original.sbomPath, path.join(a.root, 'sbom.cdx.json'));
  f.options.arm64Receipt = a.receiptPath;
  f.options.arm64Archive = a.archive;
  f.receipts[1] = { ...a.receipt, bootVerification: { ...original.bootVerification, imageId: a.config.digest } };
  f.images[1].Id = a.config.digest;
  return { ...f, archiveFixture: a };
}

test('publication imports a verified Docker index into Podman without relabeling its native receipt', async t => {
  const f = await importedPublicationFixture(t);
  const original = await fs.readFile(f.options.arm64Receipt);
  const result = await (await lib).publishServerContainers(f.options, f.run);
  assert.equal(result.platforms[1].imageId, f.archiveFixture.config.digest);
  assert.equal(result.platforms[1].nativeImageId, f.archiveFixture.index.digest);
  assert.equal(result.platforms[1].importVerification.configDigest, f.archiveFixture.config.digest);
  assert.equal(result.platforms[1].nativeReceiptSha256, sha(original));
  assert.deepEqual(await fs.readFile(f.options.arm64Receipt), original);
  assert.ok(f.calls.some(c => c.command === 'podman' && c.args[0] === 'load'));
  assert.ok(f.calls.some(c => c.command === 'podman' && c.args[0] === 'tag' && c.args[1] === f.archiveFixture.config.digest));
});

test('archive-backed publication refuses missing proof, changed archive and substituted loaded config before pushes', async t => {
  for (const mode of ['missing', 'changed', 'config']) await t.test(mode, async t => {
    const f = await importedPublicationFixture(t);
    if (mode === 'missing') delete f.options.arm64Archive;
    const run = async (command, args, options) => {
      if (mode === 'changed' && command === 'podman' && args[0] === 'load') await fs.appendFile(f.options.arm64Archive, 'changed');
      if (mode === 'config' && command === 'podman' && args[0] === 'image' && args.at(-1) === f.archiveFixture.config.digest)
        return JSON.stringify({ ...f.images[1], Id: '9'.repeat(64) });
      return f.run(command, args, options);
    };
    const error = { missing: /build generation/, changed: /changed during import/, config: /no longer matches/ }[mode];
    await assert.rejects((await lib).publishServerContainers(f.options, run), error);
    assert.equal(f.calls.some(c => c.command === 'podman' && c.args[0] === 'push'), false);
  });
});

test('publication preflight verifies imported members without any registry or signing identity', async t => {
  const f = await importedPublicationFixture(t);
  for (const field of ['key', 'pubkey', 'tag', 'out']) delete f.options[field];
  const result = await (await lib).publishServerContainers({ ...f.options, preflightOnly: true }, f.run);
  assert.equal(result.kind, 'papercusp-server-publication-preflight');
  assert.equal(result.signed, false);
  assert.equal(result.published, false);
  assert.equal(result.platforms.length, 2);
  assert.ok(result.platforms.every(p => p.bootVerification.ready.body.dbos &&
    p.bootVerification.database.vectorReady && p.bootVerification.database.schemaReady));
  assert.equal(f.calls.some(c => c.command === 'bash' || c.command === 'sudo' ||
    (c.command === 'podman' && ['tag', 'push', 'manifest'].includes(c.args[0]))), false);
});

test('publication verifies signed members and exact platforms from the registry before issuing a release receipt', async t => {
  const { publishServerContainers } = await lib;
  const f = await publicationFixture(t);
  const result = await publishServerContainers(f.options, f.run);
  assert.equal(result.memberSignaturesVerified, true);
  assert.equal(result.verifiedFromRegistry, true);
  assert.equal(result.platforms.length, 2);
  assert.ok(result.platforms.every(p => p.bootVerification.dbos && p.bootVerification.vectorReady));
  assert.match(result.reference, /registry\.example\.com:5000\/papercusp\/server@sha256:/);
  assert.deepEqual(result.platforms.map(p => p.imageId), f.receipts.map(r => r.imageId));
  assert.equal(JSON.parse(await fs.readFile(result.receiptPath, 'utf8')).digest, result.digest);
  const signedAt = f.calls.map((c, i) => c.command === 'bash' ? i : -1).filter(i => i >= 0);
  const indexAt = f.calls.findIndex(c => c.command === 'docker' && c.args[0] === 'manifest');
  assert.ok(signedAt.length === 2 && signedAt.every(i => i < indexAt));
  assert.equal(f.calls.filter(c => c.command === 'docker' && c.args[0] === 'push').length, 2);
  assert.equal((await fs.readdir(f.options.out)).some(name => name.startsWith('.server-container-release-')), false);
  const retried = await publishServerContainers(f.options, f.run);
  assert.equal(retried.receiptPath, result.receiptPath);
  await fs.writeFile(result.receiptPath, '{}');
  await assert.rejects(publishServerContainers(f.options, f.run), /inconsistent evidence/);
});

test('publication refuses liveness-only artifacts before any registry write and cleans the boot container', async t => {
  const { publishServerContainers } = await lib;
  const f = await publicationFixture(t, { unreadyPublishedServer: true });
  await assert.rejects(publishServerContainers({ ...f.options, bootTimeoutMs: 1 }, f.run), /full boot readiness/);
  assert.equal(f.calls.some(c => ['tag', 'push', 'manifest'].includes(c.args[0])), false);
  assert.equal(f.calls.at(-1).args[0], 'rm');
  await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
});

test('mixed builds and damaged local SBOMs refuse before any registry write', async t => {
  const { publishServerContainers } = await lib;
  for (const mutation of ['source', 'bundle', 'sbom']) {
    await t.test(mutation, async sub => {
      const f = await publicationFixture(sub);
      if (mutation === 'sbom') await fs.appendFile(f.receipts[1].sbomPath, 'changed');
      else {
        if (mutation === 'source') {
          f.receipts[1].sourceCommit = '9'.repeat(40);
          f.receipts[1].labels['org.opencontainers.image.revision'] = f.receipts[1].sourceCommit;
          f.images[1].Config.Labels['org.opencontainers.image.revision'] = f.receipts[1].sourceCommit;
        } else f.receipts[1].labels['com.papercusp.serve.sha256'] = '9'.repeat(64);
        await fs.writeFile(f.receipts[1].receiptPath, JSON.stringify(f.receipts[1]));
      }
      await assert.rejects(publishServerContainers(f.options, f.run),
        mutation === 'bundle' ? /observed native\/container payload parity/ : /different native|damaged/);
      assert.equal(f.calls.some(c => c.command === 'docker' && c.args[0] === 'push'), false);
      await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
    });
  }
});

test('Podman publication assembles both immutable members and cleans its temporary index', async t => {
  const { publishServerContainers } = await lib;
  const f = await publicationFixture(t, { engine: 'podman' });
  const result = await publishServerContainers(f.options, f.run);
  assert.equal(result.platforms.length, 2);
  assert.equal(f.calls.filter(c => c.command === 'podman' && c.args[0] === 'push').length, 2);
  assert.ok(f.calls.some(c => c.command === 'podman' && c.args[0] === 'manifest' && c.args[1] === 'push' && c.args.includes('--all')));
  assert.ok(f.calls.some(c => c.command === 'podman' && c.args[0] === 'manifest' && c.args[1] === 'rm'));
});

test('Podman publication rejects inspect identity or provenance drift before pushing', async t => {
  const { publishServerContainers } = await lib;
  for (const mismatch of [{ inspectId: 'e'.repeat(64) }, { inspectId: 'b'.repeat(12) },
    { inspectId: null }, { wrongPlatform: true }, { wrongLabel: true }]) {
    await t.test(JSON.stringify(mismatch), async t => {
      const f = await publicationFixture(t, { engine: 'podman', ...mismatch });
      await assert.rejects(publishServerContainers(f.options, f.run), /Local image no longer matches/);
      assert.equal(f.calls.some(c => c.command === 'podman' && c.args[0] === 'push'), false);
    });
  }
});

test('each architecture remains bound to its own native bundle from the common source release', async t => {
  const { publishServerContainers } = await lib;
  const f = await publicationFixture(t, { arm64ServeBytes: 'native arm64 Server bytes' });
  const result = await publishServerContainers(f.options, f.run);
  assert.equal(result.sourceCommit, f.receipts[0].sourceCommit);
  assert.deepEqual(result.platforms.map(p => p.labels['com.papercusp.serve.sha256']),
    f.receipts.map(r => r.labels['com.papercusp.serve.sha256']));
  assert.notEqual(result.platforms[0].labels['com.papercusp.serve.sha256'], result.platforms[1].labels['com.papercusp.serve.sha256']);
  for (const [i, platform] of result.platforms.entries()) {
    assert.equal(platform.nativeReceiptSha256, sha(await fs.readFile(f.receipts[i].receiptPath)));
  }
});

test('local development images remain buildable but cannot be published without audited clean native provenance', async t => {
  const { publishServerContainers } = await lib;
  for (const mode of ['unauditedNative', 'dirtyNativeSource']) {
    await t.test(mode, async sub => {
      const f = await publicationFixture(sub, { [mode]: true });
      await assert.rejects(publishServerContainers(f.options, f.run), /audited native release/);
      assert.equal(f.calls.length, 0);
      await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
    });
  }
});

test('publication rechecks payload bytes and refuses old generations with no observed parity proof', async t => {
  const { publishServerContainers } = await lib;
  for (const mode of ['changedImagePayload', 'missingProof']) {
    await t.test(mode, async sub => {
      const f = await publicationFixture(sub, { [mode]: true });
      if (mode === 'missingProof') {
        delete f.receipts[0].payloadVerification;
        await fs.writeFile(f.receipts[0].receiptPath, JSON.stringify(f.receipts[0]));
      }
      await assert.rejects(publishServerContainers(f.options, f.run), /observed native|Packaged Server/);
      assert.equal(f.calls.some(c => c.command === 'docker' && c.args[0] === 'push'), false);
      await assert.rejects(fs.stat(f.options.out), { code: 'ENOENT' });
    });
  }
});

test('substituted registry members, missing platforms and unverifiable signatures publish no release receipt', async t => {
  const { publishServerContainers } = await lib;
  for (const mode of ['wrongConfig', 'wrongMember', 'missingArm64', 'unverifiedSignature', 'invalidCoverage']) {
    await t.test(mode, async sub => {
      const f = await publicationFixture(sub, { [mode]: true });
      await assert.rejects(publishServerContainers(f.options, f.run), /native image|exact signed|not verified/);
      assert.deepEqual(await fs.readdir(f.options.out), []);
    });
  }
});

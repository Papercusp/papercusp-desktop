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
  let labels;
  let imageContext;
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
        return JSON.stringify({ Id: id, Os: 'linux', Architecture: options.wrongPlatform ? 'arm64' : (options.arch ?? 'amd64'),
          Config: { Labels: labels } });
      }
      if (command === (options.engine ?? 'docker') && args[0] === 'run') {
        assert.ok(args.includes(id), 'probe the content-addressed image, never a tag');
        assert.equal(args[args.indexOf('--network') + 1], 'none');
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

test('the actual in-container probe queries the discovered database after DBOS readiness', async () => {
  const { verifyServerContainerBoot } = await lib;
  let removed = false;
  const run = async (_command, args) => {
    if (args[0] === 'run') return 'd'.repeat(64);
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
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command === engine && ['image', 'tag', 'push', 'manifest', 'run', 'inspect', 'exec', 'rm'].includes(args[0])) {
      if (args[0] === 'image') {
        return JSON.stringify(images.find(image => image.Id === args.at(-1)));
      }
      if (args[0] === 'run') {
        const receipt = receipts.find(receipt => args.includes(receipt.imageId));
        if (args.includes('--detach')) { activeBootReceipt = receipt; return 'd'.repeat(64); }
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
      if (archIndex >= 0) return JSON.stringify({ config: { digest: overrides.wrongConfig ? indexDigest : receipts[archIndex].imageId } });
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

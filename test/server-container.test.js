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
  let labels;
  return {
    calls,
    run: async (command, args, config) => {
      calls.push({ command, args });
      if (command === 'bash') {
        const result = spawnSync(command, args, { env: config.env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout;
      }
      if (command === 'docker' && args[0] === 'build') {
        labels = {};
        args.forEach((arg, index) => {
          if (arg === '--label') {
            const value = args[index + 1];
            labels[value.slice(0, value.indexOf('='))] = value.slice(value.indexOf('=') + 1);
          }
        });
        const context = args.at(-1);
        assert.equal(await fs.readFile(path.join(context, 'sidecar/serve.mjs'), 'utf8'), 'native server bytes');
        assert.match(await fs.readFile(path.join(context, 'Containerfile'), 'utf8'), /ADD papercup-runtime\.tar\.gz/);
        if (options.failBuild) throw new Error('engine build failure');
        await fs.writeFile(args[args.indexOf('--iidfile') + 1], imageId);
        return '';
      }
      if (command === 'docker' && args[0] === 'image') {
        return JSON.stringify({ Id: imageId, Os: 'linux', Architecture: options.wrongPlatform ? 'arm64' : 'amd64',
          Config: { Labels: labels } });
      }
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
  const result = await buildServerContainer(f.options, runner.run);
  assert.equal(result.imageId, imageId);
  assert.equal(result.labels['com.papercusp.serve.sha256'], f.sidecarStamp.serveSha256);
  assert.equal(result.sbomPackages, 50);
  assert.equal(result.signed, false);
  assert.equal(result.published, false);
  assert.deepEqual(JSON.parse(await fs.readFile(result.receiptPath, 'utf8')).imageId, imageId);
  assert.equal(runner.calls.filter(c => c.command === 'docker' && c.args[0] === 'build').length, 1);
  assert.ok(runner.calls.some(c => c.command === 'docker' && c.args.includes(imageId)));
  assert.equal((await fs.readdir(f.options.out)).some(name => name.startsWith('.server-container-build-')), false);
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

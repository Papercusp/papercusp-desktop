/**
 * Package the existing native sidecar and WSL runtime, without rebuilding either.
 * Local image receipts are build evidence; registry signatures/release are separate.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultContainerfile = resolve(desktopRoot, '../infra/images/server/Containerfile');
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const PLATFORMS = new Map([['linux/amd64', 62], ['linux/arm64', 183]]);

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function jsonFile(path) {
  const size = (await lstat(path)).size;
  if (size > 128 * 1024) throw new Error('Oversized build receipt: ' + path);
  return JSON.parse(await readFile(path, 'utf8'));
}

function within(root, path) {
  const suffix = relative(root, path);
  return !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep);
}

async function requireElfPlatform(path, machine) {
  const fd = await open(path, 'r');
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await fd.read(header, 0, header.length, 0);
    if (bytesRead !== 20 || !header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) ||
        header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== machine) {
      throw new Error('Native payload architecture mismatch: ' + path);
    }
  } finally {
    await fd.close();
  }
}

/** Bind every payload entry, including executable modes and safe in-tree links. */
async function sidecarInventory(root, platform) {
  const physicalRoot = await realpath(root);
  const hash = createHash('sha256');
  const pending = [''];
  let entries = 0;
  let bytes = 0;
  while (pending.length) {
    const name = pending.pop();
    const path = join(root, name);
    const st = await lstat(path);
    if (++entries > 100_000) throw new Error('Sidecar inventory exceeds its entry bound');
    if (st.isSymbolicLink()) {
      const target = await realpath(path);
      if (!within(physicalRoot, target)) throw new Error('Sidecar link escapes its payload: ' + name);
      if (name.endsWith('.node') || name === join('bin', 'node')) {
        await requireElfPlatform(target, PLATFORMS.get(platform));
      }
      hash.update(JSON.stringify([name, 'link', relative(physicalRoot, target)]) + '\n');
    } else if (st.isDirectory()) {
      hash.update(JSON.stringify([name, 'directory', st.mode & 0o777]) + '\n');
      const children = (await readdir(path)).sort().reverse();
      pending.push(...children.map(child => join(name, child)));
    } else if (st.isFile()) {
      if (name.endsWith('.node') || name === join('bin', 'node')) {
        await requireElfPlatform(path, PLATFORMS.get(platform));
      }
      bytes += st.size;
      hash.update(JSON.stringify([name, 'file', st.mode & 0o777, await hashFile(path)]) + '\n');
    } else {
      throw new Error('Unsupported sidecar entry: ' + name);
    }
  }
  return { sha256: hash.digest('hex'), bytes, entries };
}

export async function runCommand(command, args, options = {}) {
  const result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 30 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: options.env ?? process.env,
  });
  return result.stdout;
}

/** Read-only: no engine calls, output directories, or changes to the input artifacts. */
export async function preflightServerContainer(options, run = runCommand) {
  const { platform, tag } = options;
  if (!PLATFORMS.has(platform)) throw new Error('Supported platforms: linux/amd64, linux/arm64');
  if (typeof tag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(tag)) {
    throw new Error('A valid explicit image tag is required');
  }
  const rootfs = resolve(options.rootfs);
  const sidecar = resolve(options.sidecar);
  const rootfsStamp = await jsonFile(join(dirname(rootfs), '.rootfs-build-stamp'));
  if (rootfsStamp.platform !== platform) throw new Error('Rootfs receipt has a different or missing platform');
  if (!SHA.test(rootfsStamp.rootfsSha256) || await hashFile(rootfs) !== rootfsStamp.rootfsSha256) {
    throw new Error('Rootfs archive does not match its build receipt');
  }
  if (!/^\d+\.\d+\.\d+$/.test(rootfsStamp.nodeVersion ?? '') ||
      !/^\d+\.\d+\.\d+$/.test(rootfsStamp.pnpmVersion ?? '') ||
      typeof rootfsStamp.baseImage !== 'string' || !rootfsStamp.baseImage) {
    throw new Error('Rootfs receipt lacks its pinned recipe inputs');
  }
  const recipe = (await run('bash', [join(desktopRoot, 'scripts/build-rootfs.sh'), '--print-recipe-fingerprint'], {
    env: { ...process.env, UBUNTU_IMAGE: rootfsStamp.baseImage, NODE_VERSION: rootfsStamp.nodeVersion,
      PNPM_VERSION: rootfsStamp.pnpmVersion, PAPERCUSP_RUNTIME_PLATFORM: platform },
  })).trim();
  if (!SHA.test(recipe) || recipe !== rootfsStamp.recipeSha256) throw new Error('Rootfs recipe is stale');
  const stamp = await jsonFile(join(sidecar, '.sidecar-build-stamp'));
  const sourceCommit = options.sourceCommit ?? stamp.gitHead;
  if (!COMMIT.test(sourceCommit ?? '') || !/^[a-f0-9]{7,64}$/.test(stamp.gitHead ?? '') ||
      !sourceCommit.startsWith(stamp.gitHead)) {
    throw new Error('Sidecar needs a full source commit matching its recorded build pin');
  }
  for (const [name, key] of [['serve.mjs', 'serveSha256'], ['mcp-proxy.mjs', 'mcpProxySha256']]) {
    if (!SHA.test(stamp[key] ?? '') || await hashFile(join(sidecar, name)) !== stamp[key]) {
      throw new Error('Sidecar build receipt mismatch: ' + name);
    }
  }
  const inventory = await sidecarInventory(sidecar, platform);
  return {
    platform, tag, rootfs, sidecar, sourceCommit,
    rootfsSha256: rootfsStamp.rootfsSha256, recipeSha256: recipe,
    serveSha256: stamp.serveSha256, sidecarSha256: inventory.sha256,
    inputBytes: inventory.bytes + (await lstat(rootfs)).size,
    payloadEntries: inventory.entries,
  };
}

export async function buildServerContainer(options, run = runCommand) {
  const input = await preflightServerContainer(options, run);
  const engine = options.engine ?? 'docker';
  if (!['docker', 'podman'].includes(engine)) throw new Error('Engine must be docker or podman');
  const out = resolve(options.out);
  if (within(input.sidecar, out) || within(out, input.sidecar) || within(out, input.rootfs)) {
    throw new Error('Output directory must be separate from the source artifacts');
  }
  await mkdir(out, { recursive: true });
  const fs = await statfs(out);
  if (BigInt(fs.bsize) * BigInt(fs.bavail) < BigInt(input.inputBytes) + 256n * 1024n * 1024n) {
    throw new Error('Insufficient output space for a frozen build context');
  }
  const stage = await mkdtemp(join(out, '.server-container-build-'));
  try {
    const context = join(stage, 'context');
    await mkdir(context);
    await cp(input.rootfs, join(context, 'papercup-runtime.tar.gz'));
    await cp(join(dirname(input.rootfs), '.rootfs-build-stamp'), join(context, '.rootfs-build-stamp'));
    await cp(input.sidecar, join(context, 'sidecar'), { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    const frozen = await preflightServerContainer({ ...options,
      rootfs: join(context, 'papercup-runtime.tar.gz'), sidecar: join(context, 'sidecar') }, run);
    if (frozen.sidecarSha256 !== input.sidecarSha256 || frozen.rootfsSha256 !== input.rootfsSha256) {
      throw new Error('Source artifacts changed while freezing the build context');
    }
    const containerfile = join(context, 'Containerfile');
    await cp(options.containerfile ?? defaultContainerfile, containerfile);
    const labels = {
      'org.opencontainers.image.revision': input.sourceCommit,
      'com.papercusp.rootfs.sha256': input.rootfsSha256,
      'com.papercusp.sidecar.sha256': input.sidecarSha256,
      'com.papercusp.serve.sha256': input.serveSha256,
    };
    const labelArgs = Object.entries(labels).flatMap(([key, value]) => ['--label', key + '=' + value]);
    const iidfile = join(stage, 'image-id');
    await run(engine, ['build', '--platform', input.platform, ...labelArgs, '--iidfile', iidfile,
      '--tag', input.tag, '--file', containerfile, context]);
    const imageId = (await readFile(iidfile, 'utf8')).trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Engine did not return a content-addressed image');
    const inspected = JSON.parse(await run(engine, ['image', 'inspect', '--format', '{{json .}}', imageId]));
    if (inspected.Id !== imageId || inspected.Os + '/' + inspected.Architecture !== input.platform ||
        Object.entries(labels).some(([key, value]) => inspected.Config?.Labels?.[key] !== value)) {
      throw new Error('Built image does not match its platform and source labels');
    }
    const sbomTmp = join(stage, 'sbom.cdx.json');
    await run(options.syft ?? 'syft', [imageId, '--from', engine, '-o', 'cyclonedx-json=' + sbomTmp]);
    const sbom = JSON.parse(await readFile(sbomTmp, 'utf8'));
    if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || sbom.components.length < 50) {
      throw new Error('SBOM does not establish package coverage of the runtime image');
    }
    const basename = 'papercusp-server-' + input.platform.split('/')[1] + '-' + imageId.slice(7, 19);
    const generation = join(out, basename);
    const sbomPath = join(generation, 'sbom.cdx.json');
    const receiptPath = join(generation, 'build.json');
    const receipt = {
      schemaVersion: 1, kind: 'papercusp-server-local-image', platform: input.platform,
      tag: input.tag, imageId, sourceCommit: input.sourceCommit, labels,
      rootfsRecipeSha256: input.recipeSha256, containerfileSha256: await hashFile(containerfile),
      sbomSha256: await hashFile(sbomTmp), sbomPackages: sbom.components.length,
      sbomPath, signed: false, published: false,
    };
    const publication = join(stage, 'publication');
    await mkdir(publication);
    await writeFile(join(publication, 'build.json'), JSON.stringify(receipt, null, 2) + '\n');
    await rename(sbomTmp, join(publication, 'sbom.cdx.json'));
    try {
      // One rename publishes the pair; retries never overwrite an existing generation.
      await rename(publication, generation);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const existing = await jsonFile(receiptPath);
      if (existing.imageId !== imageId || existing.platform !== input.platform ||
          existing.sourceCommit !== input.sourceCommit ||
          Object.entries(labels).some(([key, value]) => existing.labels?.[key] !== value) ||
          existing.sbomSha256 !== await hashFile(sbomPath)) {
        throw new Error('Existing image generation has inconsistent evidence');
      }
      return { ...existing, receiptPath };
    }
    return { ...receipt, receiptPath };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

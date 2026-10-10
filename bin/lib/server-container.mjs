/**
 * Package the existing native sidecar and WSL runtime, without rebuilding either.
 * Local image receipts are build evidence; registry signatures/release are separate.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let execFileAsyncMemo;
const execFileAsync = (...args) =>
  Reflect.apply((execFileAsyncMemo ??= promisify(execFile)), undefined, args);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaultContainerfile = resolve(desktopRoot, '../infra/images/server/Containerfile');
const supplyChainScript = resolve(desktopRoot, '../infra/images/bootc/release-supply-chain.sh');
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

function matchesImageId(observed, expected) {
  // Podman reports the full config hash without Docker's sha256: prefix.
  return observed === expected ||
    (typeof observed === 'string' && SHA.test(observed) && 'sha256:' + observed === expected);
}

async function requireElfPlatform(path, machine, required = true) {
  const fd = await open(path, 'r');
  try {
    const header = Buffer.alloc(20);
    const { bytesRead } = await fd.read(header, 0, header.length, 0);
    const isElf = bytesRead >= 4 && header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70]));
    if (!required && !isElf) return false;
    if (bytesRead !== 20 || !header.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])) ||
        header[4] !== 2 || header[5] !== 1 || header.readUInt16LE(18) !== machine) {
      throw new Error('Native payload architecture mismatch: ' + path);
    }
    return true;
  } finally {
    await fd.close();
  }
}

/** Bind every payload entry, including executable modes and safe in-tree links. */
export async function sidecarInventory(root, platform, { hashContents = true } = {}) {
  if (!PLATFORMS.has(platform)) throw new Error('Unsupported native inventory platform: ' + platform);
  const physicalRoot = await realpath(root);
  const hash = createHash('sha256');
  const elfFiles = [];
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
      if ((await lstat(target)).isFile()) {
        if (await requireElfPlatform(target, PLATFORMS.get(platform),
          name.endsWith('.node') || name === join('bin', 'node'))) elfFiles.push(path);
      }
      hash.update(JSON.stringify([name, 'link', relative(physicalRoot, target)]) + '\n');
    } else if (st.isDirectory()) {
      hash.update(JSON.stringify([name, 'directory', st.mode & 0o777]) + '\n');
      const children = (await readdir(path)).sort().reverse();
      pending.push(...children.map(child => join(name, child)));
    } else if (st.isFile()) {
      // pui, PostgreSQL and shared libraries matter as much as Node/addons.
      // Inspect ELF headers regardless of name or executable mode.
      if (await requireElfPlatform(path, PLATFORMS.get(platform),
        name.endsWith('.node') || name === join('bin', 'node'))) elfFiles.push(path);
      bytes += st.size;
      if (hashContents) hash.update(JSON.stringify([name, 'file', st.mode & 0o777, await hashFile(path)]) + '\n');
    } else {
      throw new Error('Unsupported sidecar entry: ' + name);
    }
  }
  return { sha256: hashContents ? hash.digest('hex') : null, bytes, entries, elfFiles };
}

export async function runCommand(command, args, options = {}) {
  if (options.hashOutput) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      let bytes = 0, stderr = '', failure;
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env ?? process.env, signal: options.signal,
        timeout: options.timeout ?? 30 * 60_000 });
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > options.maxBytes) {
          failure ??= new Error('Archive member exceeds its declared size');
          child.kill();
        } else hash.update(chunk);
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(command + ' failed: ' + (signal || code) + ': ' + stderr));
        else resolve(JSON.stringify({ sha256: hash.digest('hex'), bytes }));
      });
    });
  }
  if (options.stream) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'],
        env: options.env ?? process.env, signal: options.signal, timeout: options.timeout });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 ? resolve('')
        : reject(new Error(command + ' failed with ' + (signal || code))));
    });
  }
  let result;
  try { result = await execFileAsync(command, args, {
    timeout: options.timeout ?? 30 * 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: options.env ?? process.env,
    signal: options.signal,
  }); } catch (error) {
    error.message = command + ' failed (' + (error.signal || error.code || error.name) + ')'
      + (error.stderr?.trim() ? ': ' + error.stderr.trim().slice(0, 4096) : '');
    throw error;
  }
  return result.stdout;
}

/** Verify preserved OCI/Docker archives against the existing local-image receipt. */
export async function verifyServerContainerArchive(options, run = runCommand) {
  const archive = await realpath(options.archive);
  const receiptPath = resolve(options.receiptPath);
  const receiptSha256 = await hashFile(receiptPath);
  const receipt = await jsonFile(receiptPath);
  if (receipt.kind !== 'papercusp-server-local-image' || receipt.schemaVersion !== 1 ||
      !PLATFORMS.has(receipt.platform) || !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId ?? '') ||
      !COMMIT.test(receipt.sourceCommit ?? '') || typeof receipt.tag !== 'string' || !receipt.tag ||
      receipt.labels?.['org.opencontainers.image.revision'] !== receipt.sourceCommit) {
    throw new Error('Invalid archive source/platform receipt');
  }
  const archiveSha256 = await hashFile(archive);
  if (options.archiveSha256 && options.archiveSha256 !== archiveSha256)
    throw new Error('Archive digest differs from its preservation receipt');
  const names = (await run('tar', ['-tf', archive])).trim().split('\n');
  if (names.length > 4096) throw new Error('Archive exceeds its member bound');
  const members = new Map();
  for (const name of names) {
    const key = name.replace(/^\.\//, '').replace(/\/$/, '');
    if (!key || key === '.') continue;
    if (!/^[a-zA-Z0-9._/-]+$/.test(key) || key.startsWith('/') || key.split('/').includes('..') || members.has(key))
      throw new Error('Unsafe or duplicate archive member: ' + name);
    members.set(key, name);
  }
  const member = key => {
    if (!members.has(key)) throw new Error('Missing archive member: ' + key);
    return members.get(key);
  };
  const readJson = async key => {
    const text = await run('tar', ['-xOf', archive, '--', member(key)]);
    if (Buffer.byteLength(text) > 128 * 1024) throw new Error('Oversized archive JSON member');
    return { value: JSON.parse(text), text };
  };
  const verified = new Map();
  let totalBytes = 0;
  const verifyBlob = async descriptor => {
    if (!descriptor || !/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? '') ||
        !Number.isSafeInteger(descriptor.size) || descriptor.size < 0 || descriptor.size > 32 * 1024 ** 3)
      throw new Error('Invalid archive blob descriptor');
    const key = 'blobs/sha256/' + descriptor.digest.slice(7);
    let observed = verified.get(key);
    if (!observed) {
      if (verified.size >= 256 || (totalBytes += descriptor.size) > 32 * 1024 ** 3)
        throw new Error('Archive exceeds its descriptor/byte bound');
      observed = JSON.parse(await run('tar', ['-xOf', archive, '--', member(key)],
        { hashOutput: true, maxBytes: descriptor.size }));
      verified.set(key, observed);
    }
    if (observed.bytes !== descriptor.size || observed.sha256 !== descriptor.digest.slice(7))
      throw new Error('Archive blob digest/size mismatch: ' + key);
    return key;
  };
  const labelsMatch = config => Object.entries(receipt.labels).every(([key, value]) => config.config?.Labels?.[key] === value);
  const normalizeTag = tag => tag.replace(/^docker\.io\/(?:library\/)?/, '');
  // Saving by immutable ID gives Podman's OCI archive that ID as its reference.
  const referenceMatches = ref => normalizeTag(ref) === normalizeTag(receipt.tag) ||
    matchesImageId(ref, receipt.imageId);
  const candidates = [];
  if (members.has('index.json')) {
    if ((await readJson('oci-layout')).value.imageLayoutVersion !== '1.0.0') throw new Error('Invalid OCI layout version');
    const root = await readJson('index.json');
    const walk = async (descriptor, ancestors = [], platforms = [], references = [], depth = 0) => {
      if (depth > 6) throw new Error('Archive index exceeds its depth bound');
      const key = await verifyBlob(descriptor);
      const chain = [...ancestors, descriptor.digest];
      const hints = descriptor.platform ? [...platforms, descriptor.platform] : platforms;
      const refs = descriptor.annotations ? [...references, descriptor.annotations] : references;
      if (/image\.index|manifest\.list/.test(descriptor.mediaType ?? '')) {
        const index = (await readJson(key)).value;
        if (index.schemaVersion !== 2 || !Array.isArray(index.manifests) || !index.manifests.length || index.manifests.length > 32)
          throw new Error('Invalid archive index descriptors');
        for (const child of index.manifests) await walk(child, chain, hints, refs, depth + 1);
      } else if (/image\.manifest|manifest\.v2/.test(descriptor.mediaType ?? '')) {
        const manifest = (await readJson(key)).value;
        if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.layers) || manifest.layers.length > 128)
          throw new Error('Invalid archive image manifest');
        const configPath = await verifyBlob(manifest.config);
        const config = (await readJson(configPath)).value;
        const layerPaths = [];
        for (const layer of manifest.layers) layerPaths.push(await verifyBlob(layer));
        if (hints.some(p => p.os !== config.os || p.architecture !== config.architecture))
          throw new Error('Archive descriptor/config platform mismatch');
        if (config.os + '/' + config.architecture === receipt.platform &&
            [...chain, manifest.config.digest].includes(receipt.imageId)) {
          if (!labelsMatch(config)) throw new Error('Archive source/payload labels changed');
          for (const ref of refs) {
            const full = ref['io.containerd.image.name'];
            const name = ref['org.opencontainers.image.ref.name'];
            if ((full && !referenceMatches(full)) ||
                (name && !referenceMatches(name) && name !== receipt.tag.split(':').at(-1)))
              throw new Error('OCI archive image reference changed');
          }
          candidates.push({ manifestDigest: descriptor.digest, configDigest: manifest.config.digest, configPath, layerPaths });
        }
      } else throw new Error('Unsupported archive descriptor media type');
    };
    if (root.value.schemaVersion !== 2 || !Array.isArray(root.value.manifests) || !root.value.manifests.length || root.value.manifests.length > 32)
      throw new Error('Invalid OCI archive root index');
    for (const descriptor of root.value.manifests) await walk(descriptor, ['sha256:' + createHash('sha256').update(root.text).digest('hex')]);
  } else if (members.has('manifest.json')) {
    const manifest = (await readJson('manifest.json')).value;
    if (!Array.isArray(manifest) || !manifest.length || manifest.length > 32) throw new Error('Invalid Docker archive manifest');
    for (const entry of manifest) {
      const raw = await readJson(entry.Config);
      const configDigest = 'sha256:' + createHash('sha256').update(raw.text).digest('hex');
      if (configDigest !== receipt.imageId || raw.value.os + '/' + raw.value.architecture !== receipt.platform) continue;
      if (!labelsMatch(raw.value)) throw new Error('Archive source/payload labels changed');
      if (!Array.isArray(entry.Layers) || entry.Layers.length > 128 || entry.Layers.length !== raw.value.rootfs?.diff_ids?.length)
        throw new Error('Docker archive layer/config mismatch');
      for (const [i, key] of entry.Layers.entries()) {
        const observed = JSON.parse(await run('tar', ['-xOf', archive, '--', member(key)],
          { hashOutput: true, maxBytes: 32 * 1024 ** 3 - totalBytes }));
        totalBytes += observed.bytes;
        if ('sha256:' + observed.sha256 !== raw.value.rootfs.diff_ids[i]) throw new Error('Docker archive layer digest mismatch');
      }
      candidates.push({ manifestDigest: null, configDigest, configPath: entry.Config, layerPaths: entry.Layers });
    }
  } else throw new Error('Archive has no OCI/Docker manifest');
  if (candidates.length !== 1) throw new Error('Archive does not bind exactly one receipt identity/platform');
  const selected = candidates[0];
  if (members.has('manifest.json')) {
    const aliases = (await readJson('manifest.json')).value;
    if (!Array.isArray(aliases) || !aliases.some(entry => entry.Config === selected.configPath &&
        JSON.stringify(entry.Layers) === JSON.stringify(selected.layerPaths) &&
        Array.isArray(entry.RepoTags) && entry.RepoTags.some(tag => normalizeTag(tag) === normalizeTag(receipt.tag))))
      throw new Error('Docker archive reference/config/layer alias mismatch');
  }
  if (await hashFile(archive) !== archiveSha256 || await hashFile(receiptPath) !== receiptSha256)
    throw new Error('Archive or source receipt changed during verification');
  return { archive, archiveSha256, receiptPath, receiptSha256, imageId: receipt.imageId,
    platform: receipt.platform, sourceCommit: receipt.sourceCommit,
    manifestDigest: selected.manifestDigest, configDigest: selected.configDigest, verifiedBlobCount: verified.size };
}

// Docker children belong to the daemon, outside the launcher's task cgroup.
// The in-container supervisor makes a killed launcher observable as a stale
// lease and terminates its own producer group, even when host finally cannot run.
export const ownedContainerSupervisor = `
const fs=require('node:fs'),{spawn}=require('node:child_process');
const [lease,ttl,...command]=process.argv.slice(1);
let child,stopping=false,killTimer;
function stop(){
  if(stopping)return; stopping=true;
  if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{};
    killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},2000)}
}
function current(){try{return Date.now()-JSON.parse(fs.readFileSync(lease,'utf8')).at<Number(ttl)}catch{return false}}
if(!current()){process.exit(125)}
child=spawn(command[0],command.slice(1),{stdio:'inherit',detached:true});
const timer=setInterval(()=>{if(!current())stop()},250);
process.on('SIGTERM',stop);process.on('SIGINT',stop);
child.on('error',error=>{console.error(error.message);clearInterval(timer);process.exitCode=127});
child.on('exit',(code,signal)=>{clearInterval(timer);clearTimeout(killTimer);process.exitCode=stopping?125:(code??1)});
`;

/** Run the existing native producer with a recorded, bounded daemon lifetime. */
export async function runOwnedContainer(options, run = runCommand) {
  const engine = options.engine ?? 'docker';
  if (!['docker', 'podman'].includes(engine) || !PLATFORMS.has(options.platform)
      || !/^sha256:[a-f0-9]{64}$/.test(options.imageId ?? '')
      || !Array.isArray(options.command) || !options.command.length
      || options.command.some(arg => typeof arg !== 'string')
      || !Array.isArray(options.args ?? [])
      || (options.args ?? []).some(arg => typeof arg !== 'string'
        || /^(?:--(?:name|cidfile|rm|init|entrypoint|detach|restart|platform))(?:=|$)/.test(arg))) {
    throw new Error('Owned producer requires an immutable image, platform, command and unowned create arguments');
  }
  const out = resolve(options.out);
  await mkdir(out, { recursive: true });
  const leaseRoot = await mkdtemp(join(out, '.native-producer-owner-'));
  const lease = join(leaseRoot, 'lease.json');
  const receiptFile = join(leaseRoot, 'ownership.json');
  const ttl = options.leaseTimeoutMs ?? 15_000;
  if (!Number.isInteger(ttl) || ttl < 1000 || ttl > 60_000) throw new Error('Owned producer lease requires 1000..60000 ms');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const update = async () => {
    await writeFile(lease + '.tmp', JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    await rename(lease + '.tmp', lease);
  };
  let id, heartbeat, error, heartbeatPending = Promise.resolve();
  const receipt = { schemaVersion: 1, imageId: options.imageId, platform: options.platform,
    leaseTimeoutMs: ttl, leaseRoot, status: 'creating',
    containerName: 'papercusp-native-' + randomUUID(), ownerToken: randomUUID() };
  const save = () => writeFile(receiptFile, JSON.stringify(receipt) + '\n', { mode: 0o600 });
  process.on('SIGTERM', abort); process.on('SIGINT', abort);
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await update();
    await save();
    id = (await run(engine, ['create', '--init', '--name', receipt.containerName,
      '--platform', options.platform, '--mount', 'type=bind,source=' + leaseRoot + ',target=/run/papercusp-producer-owner,readonly',
      ...(options.args ?? []), '--label', 'dev.papercusp.producer-owner=' + receipt.ownerToken,
      '--entrypoint', '/usr/local/bin/node', options.imageId,
      '-e', ownedContainerSupervisor, '/run/papercusp-producer-owner/lease.json', String(ttl), ...options.command],
    { timeout: options.timeoutMs ?? 2 * 60 * 60_000, signal: controller.signal })).trim();
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Engine returned no immutable producer container ID');
    receipt.containerId = id; receipt.status = 'created'; await save();
    heartbeat = setInterval(() => {
      heartbeatPending = heartbeatPending.then(update).catch(error => {
        receipt.leaseError = error.message; controller.abort();
      });
    }, Math.min(1000, Math.floor(ttl / 3)));
    if (options.signal?.aborted) controller.abort();
    receipt.status = 'running'; await save();
    const output = await run(engine, ['start', '--attach', id],
      { timeout: options.timeoutMs ?? 2 * 60 * 60_000, signal: controller.signal, stream: true });
    const state = JSON.parse(await run(engine, ['inspect', '--format', '{{json .State}}', id], { timeout: 5000 }));
    if (state.Running !== false || state.ExitCode !== 0) throw new Error('Owned producer exited with ' + state.ExitCode);
    receipt.exitCode = state.ExitCode; receipt.status = 'completed';
    return { ...receipt, receiptFile, output };
  } catch (caught) {
    error = caught; receipt.status = 'failed'; receipt.error = caught.message; throw caught;
  } finally {
    clearInterval(heartbeat); await heartbeatPending;
    process.off('SIGTERM', abort); process.off('SIGINT', abort);
    options.signal?.removeEventListener('abort', abort);
    try {
      // A killed create client can leave a daemon-created object without
      // returning its ID. Recover it only under our saved name, image and token.
      if (!id) {
        let object;
        try { object = JSON.parse(await run(engine, ['inspect', '--format', '{{json .}}', receipt.containerName], { timeout: 10_000 })); }
        catch (inspectError) {
          if (!/No such (?:object|container)/i.test(inspectError.message)) throw inspectError;
        }
        if (object) {
          if (object.Image !== options.imageId || object.Config?.Labels?.['dev.papercusp.producer-owner'] !== receipt.ownerToken
              || !/^[a-f0-9]{64}$/.test(object.Id ?? '')) throw new Error('Cannot confirm interrupted create ownership');
          id = object.Id; receipt.containerId = id;
        }
      }
      if (id && /^[a-f0-9]{64}$/.test(id)) {
        await run(engine, ['rm', '--force', id], { timeout: 10_000 });
        receipt.removed = true;
      }
      await save();
    } catch (cleanupError) {
      receipt.cleanupError = cleanupError.message; await save();
      throw new AggregateError([...(error ? [error] : []), cleanupError], 'Owned producer cleanup failed');
    }
  }
}

/** Observe the packaged bytes with the image's own runtime, without starting services. */
export async function verifyServerContainerPayload(options, run = runCommand) {
  if (!['docker', 'podman'].includes(options.engine) || !PLATFORMS.has(options.platform) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.imageId ?? '')) {
    throw new Error('Payload verification requires an immutable image and supported platform');
  }
  const script = "const fs=require('node:fs'),crypto=require('node:crypto');" +
    "const hash=name=>crypto.createHash('sha256').update(fs.readFileSync('/opt/papercusp/sidecar/'+name)).digest('hex');" +
    "process.stdout.write(JSON.stringify({serveSha256:hash('serve.mjs'),mcpProxySha256:hash('mcp-proxy.mjs')," +
    "nodeArch:process.arch,nodeVersion:process.version}));";
  const observed = JSON.parse(await run(options.engine, ['run', '--rm', '--read-only', '--network', 'none',
    '--platform', options.platform, '--entrypoint', '/usr/local/bin/node', options.imageId, '-e', script]));
  const arch = options.platform === 'linux/amd64' ? 'x64' : 'arm64';
  if (observed.serveSha256 !== options.serveSha256 || observed.mcpProxySha256 !== options.mcpProxySha256 ||
      observed.nodeArch !== arch || observed.nodeVersion !== 'v' + options.nodeVersion) {
    throw new Error('Packaged Server bytes or runtime differ from the native/rootfs build receipts');
  }
  return observed;
}

function bootFilesystemArgs(engine) {
  // Podman 4.9 rejects Docker's uid/gid tmpfs options. Its chown option
  // gives the empty mount to the image user without running the Server as root.
  return ['--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,exec',
    ...(engine === 'podman'
      ? ['--mount', 'type=tmpfs,destination=/home/papercup,tmpfs-mode=0700,notmpcopyup,U=true']
      : ['--tmpfs', '/home/papercup:rw,uid=1001,gid=1001,mode=0700'])];
}

/** Exercise the real engine grammar and non-root home before starting services. */
export async function verifyServerContainerHome(options, run = runCommand) {
  if (!['docker', 'podman'].includes(options.engine) || !PLATFORMS.has(options.platform) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.imageId ?? '')) {
    throw new Error('Home verification requires an immutable image and supported platform');
  }
  const script = "const fs=require('node:fs'),a=require('node:assert/strict');" +
    "const home=process.env.HOME,s=fs.statSync(home),uid=process.getuid(),gid=process.getgid();" +
    "a.equal(home,'/home/papercup');a.equal(uid,1001);a.equal(gid,1001);" +
    "a.equal(s.uid,uid);a.equal(s.gid,gid);a.equal(s.mode&511,448);" +
    "a.equal(fs.readdirSync(home).length,0);const file=home+'/papercusp-boot-home-check';" +
    "fs.writeFileSync(file,'ok',{flag:'wx',mode:384});fs.unlinkSync(file);" +
    "process.stdout.write(JSON.stringify({uid,gid,homeUid:s.uid,homeGid:s.gid,mode:s.mode&511,empty:true,writable:true}));";
  const observed = JSON.parse(await run(options.engine, ['run', '--rm', '--platform', options.platform,
    ...bootFilesystemArgs(options.engine), '--entrypoint', '/usr/local/bin/node', options.imageId, '-e', script]));
  if (observed.uid !== 1001 || observed.gid !== 1001 || observed.homeUid !== 1001 ||
      observed.homeGid !== 1001 || observed.mode !== 0o700 || observed.empty !== true || observed.writable !== true) {
    throw new Error('Packaged Server lacks an empty private writable non-root home');
  }
  return observed;
}

/** Boot the immutable artifact in an isolated empty home, with no host ports/network. */
export async function verifyServerContainerBoot(options, run = runCommand) {
  if (!['docker', 'podman'].includes(options.engine) || !PLATFORMS.has(options.platform) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.imageId ?? '') || !COMMIT.test(options.sourceCommit ?? '')) {
    throw new Error('Server boot verification requires an immutable image, platform and source commit');
  }
  const homeVerification = await verifyServerContainerHome(options, run);
  const name = 'papercusp-server-boot-' + randomUUID();
  const deadline = Date.now() + (options.bootTimeoutMs ?? 15 * 60_000);
  const sql = "SELECT json_build_object('vectorReady',EXISTS(SELECT 1 FROM pg_extension WHERE extname='vector')," +
    "'schemaReady',EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='harness_shared')," +
    "'serverVersion',current_setting('server_version'))";
  const probe = "const fs=require('node:fs'),{spawnSync}=require('node:child_process');" +
    "(async()=>{try{" +
    "const get=async path=>{const r=await fetch('http://127.0.0.1:3070'+path,{signal:AbortSignal.timeout(2000)});" +
    "return {status:r.status,body:await r.json()};};" +
    "const ready=await get('/api/health/ready'),health=await get('/api/health');" +
    "let database=null;if(ready.status===200&&ready.body.ready===true){" +
    "const pg=JSON.parse(fs.readFileSync('/home/papercup/.papercusp/embedded-pg.json','utf8'));" +
    "const result=spawnSync('/usr/bin/psql',[pg.url,'-X','-A','-t','-c'," + JSON.stringify(sql) +
    "],{encoding:'utf8',timeout:5000});if(result.status===0)database=JSON.parse(result.stdout);}" +
    "process.stdout.write(JSON.stringify({arch:process.arch,node:process.version,ready,health,database}));" +
    "}catch(error){process.stdout.write(JSON.stringify({pending:error.name}));}})();";
  let observed;
  try {
    await run(options.engine, ['run', '--detach', '--name', name, '--platform', options.platform,
      ...bootFilesystemArgs(options.engine),
      '--env', 'PAPERCUSP_HONO_PORT=3070', '--env', 'PAPERCUSP_PG_PORT=5532',
      '--env', 'PAPERCUSP_BACKGROUND_WORKERS=1', '--env', 'PAPERCUSP_DBOS_ENABLE=1', options.imageId]);
    do {
      const state = JSON.parse(await run(options.engine, ['inspect', '--format', '{{json .State}}', name]));
      if (state.Running !== true) {
        throw new Error('Packaged Server exited during boot (exit=' + state.ExitCode + ')');
      }
      try {
        observed = JSON.parse(await run(options.engine, ['exec', name, '/usr/local/bin/node', '-e', probe],
          { timeout: 12_000 }));
      } catch (error) {
        observed = { pending: error.name };
      }
      if (observed.ready?.status === 200 && observed.ready.body?.ready === true &&
          observed.ready.body.dbosEnabled === true && observed.ready.body.dbos === true &&
          observed.health?.status === 200 && observed.health.body?.ok === true &&
          observed.health.body.service === 'papercusp-operator' &&
          /^[a-f0-9]{7,64}$/.test(observed.health.body.sha ?? '') &&
          options.sourceCommit.startsWith(observed.health.body.sha) &&
          observed.arch === (options.platform === 'linux/amd64' ? 'x64' : 'arm64') &&
          observed.node === 'v' + options.nodeVersion &&
          observed.database?.vectorReady === true && observed.database.schemaReady === true) {
        return { schemaVersion: 1, imageId: options.imageId, platform: options.platform,
          sourceCommit: options.sourceCommit, verifiedAtUtc: new Date().toISOString(), homeVerification, ...observed };
      }
      if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.min(1000, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error('Packaged Server did not establish full boot readiness: ' + JSON.stringify(observed));
  } finally {
    await run(options.engine, ['rm', '--force', name]);
  }
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
  const sqlDir = join(sidecar, 'db-sql');
  if (!(await lstat(sqlDir)).isDirectory() || !(await readdir(sqlDir)).some(name => name.endsWith('.sql'))) {
    throw new Error('Native Server payload lacks packaged SQL migrations');
  }
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
  let provenance;
  try { provenance = await jsonFile(join(sidecar, 'build-provenance.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const audit = stamp.releaseIdentityAudit;
  const nativeReleaseAuditPassed = audit?.schemaVersion === 1 && audit.passed === true &&
    audit.scanner === 'audit-release-bundle.py --scan-dir';
  const nativeSourceVerified = provenance?.gitDirty === false &&
    /^[a-f0-9]{7,64}$/.test(provenance.gitHead ?? '') && sourceCommit.startsWith(provenance.gitHead);
  return {
    platform, tag, rootfs, sidecar, sourceCommit,
    rootfsSha256: rootfsStamp.rootfsSha256, recipeSha256: recipe,
    rootfsBaseImage: rootfsStamp.baseImage,
    serveSha256: stamp.serveSha256, mcpProxySha256: stamp.mcpProxySha256,
    nodeVersion: rootfsStamp.nodeVersion, sidecarSha256: inventory.sha256,
    inputBytes: inventory.bytes + (await lstat(rootfs)).size,
    payloadEntries: inventory.entries,
    nativeReleaseAuditPassed, nativeSourceVerified,
  };
}

export async function buildServerContainer(options, run = runCommand) {
  options.onProgress?.('preflight');
  const input = await preflightServerContainer(options, run);
  const engine = options.engine ?? 'docker';
  if (!['docker', 'podman'].includes(engine)) throw new Error('Engine must be docker or podman');
  if (options.imageId !== undefined && !/^sha256:[a-f0-9]{64}$/.test(options.imageId)) {
    throw new Error('Retained image qualification requires a full immutable image ID');
  }
  const out = resolve(options.out);
  if (within(input.sidecar, out) || within(out, input.sidecar) || within(out, input.rootfs)) {
    throw new Error('Output directory must be separate from the source artifacts');
  }
  await mkdir(out, { recursive: true });
  const fs = await statfs(out);
  if (BigInt(fs.bsize) * BigInt(fs.bavail) < (options.imageId ? 0n : BigInt(input.inputBytes)) + 256n * 1024n * 1024n) {
    throw new Error('Insufficient output space for a frozen build context');
  }
  const stage = await mkdtemp(join(out, '.server-container-build-'));
  try {
    let imageId = options.imageId;
    let containerfileSha256 = null;
    const labels = {
      'org.opencontainers.image.revision': input.sourceCommit,
      'com.papercusp.rootfs.sha256': input.rootfsSha256,
      'com.papercusp.sidecar.sha256': input.sidecarSha256,
      'com.papercusp.serve.sha256': input.serveSha256,
      'com.papercusp.native.release-audit': input.nativeReleaseAuditPassed ? 'passed' : 'unverified',
      'com.papercusp.native.source-verified': input.nativeSourceVerified ? 'true' : 'false',
    };
    if (!imageId) {
    const context = join(stage, 'context');
    options.onProgress?.('freeze-inputs');
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
    containerfileSha256 = await hashFile(containerfile);
    const labelArgs = Object.entries(labels).flatMap(([key, value]) => ['--label', key + '=' + value]);
    const iidfile = join(stage, 'image-id');
    options.onProgress?.('build-image');
    await run(engine, ['build', '--platform', input.platform,
      '--build-arg', 'PAPERCUSP_BUILD_SHA=' + input.sourceCommit, ...labelArgs, '--iidfile', iidfile,
      '--tag', input.tag, '--file', containerfile, context]);
    imageId = (await readFile(iidfile, 'utf8')).trim();
    } else {
      options.onProgress?.('qualify-retained-image');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Engine did not return a content-addressed image');
    const inspected = JSON.parse(await run(engine, ['image', 'inspect', '--format', '{{json .}}', imageId]));
    if (!matchesImageId(inspected.Id, imageId) || inspected.Os + '/' + inspected.Architecture !== input.platform ||
        Object.entries(labels).some(([key, value]) => inspected.Config?.Labels?.[key] !== value)) {
      throw new Error('Built image does not match its platform and source labels');
    }
    options.onProgress?.('verify-payload');
    const payloadVerification = await verifyServerContainerPayload({ ...input, engine, imageId }, run);
    options.onProgress?.('verify-full-boot');
    const bootVerification = await verifyServerContainerBoot({ ...input, engine, imageId,
      bootTimeoutMs: options.bootTimeoutMs }, run);
    const sbomTmp = join(stage, 'sbom.cdx.json');
    options.onProgress?.('generate-sbom');
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
      engine, rootfsBaseImage: input.rootfsBaseImage,
      payloadVerification, bootVerification,
      rootfsRecipeSha256: input.recipeSha256, containerfileSha256,
      buildMode: options.imageId ? 'qualify-retained-image' : 'build',
      sbomSha256: await hashFile(sbomTmp), sbomPackages: sbom.components.length,
      sbomPath, signed: false, published: false,
    };
    const publication = join(stage, 'publication');
    options.onProgress?.('publish-local-evidence');
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
      options.onProgress?.('complete');
      return { ...existing, receiptPath };
    }
    options.onProgress?.('complete');
    return { ...receipt, receiptPath };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

/** Publish verified platform generations through the existing BYOC OCI trust pipeline. */
export async function publishServerContainers(options, run = runCommand) {
  const engine = options.engine ?? 'docker';
  if (!['docker', 'podman'].includes(engine)) throw new Error('Engine must be docker or podman');
  const tag = options.tag;
  if (typeof tag !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(tag) ||
      !tag.includes('/') || !tag.split('/').at(-1).includes(':')) {
    throw new Error('Publication requires an explicit repository and release tag');
  }
  for (const key of ['key', 'out', 'amd64Receipt', 'arm64Receipt']) {
    if (typeof options[key] !== 'string' || !options[key]) throw new Error('Missing publication input: ' + key);
  }
  const key = resolve(options.key);
  const pubkey = resolve(options.pubkey ?? key.replace(/\.key$/, '.pub'));
  if (pubkey === key) throw new Error('A separate verification public key is required');
  await Promise.all([lstat(key), lstat(pubkey)]);
  const members = [];
  for (const arch of ['amd64', 'arm64']) {
    const receiptPath = resolve(options[arch + 'Receipt']);
    const receiptHash = await hashFile(receiptPath);
    const receipt = await jsonFile(receiptPath);
    if (receipt.kind !== 'papercusp-server-local-image' || receipt.schemaVersion !== 1 ||
        receipt.platform !== 'linux/' + arch || receipt.engine !== engine ||
        !/^sha256:[a-f0-9]{64}$/.test(receipt.imageId ?? '') ||
        !COMMIT.test(receipt.sourceCommit ?? '') || !receipt.rootfsBaseImage ||
        !SHA.test(receipt.sbomSha256 ?? '') ||
        receipt.sbomSha256 !== await hashFile(join(dirname(receiptPath), 'sbom.cdx.json'))) {
      throw new Error('Invalid or damaged ' + arch + ' build generation');
    }
    const labels = receipt.labels;
    if (!labels || labels['org.opencontainers.image.revision'] !== receipt.sourceCommit ||
        ['rootfs', 'sidecar', 'serve'].some(name => !SHA.test(labels['com.papercusp.' + name + '.sha256'] ?? ''))) {
      throw new Error('Build generation lacks its native payload binding');
    }
    if (labels['com.papercusp.native.release-audit'] !== 'passed' ||
        labels['com.papercusp.native.source-verified'] !== 'true') {
      throw new Error('Publication requires an audited native release with verified clean source provenance');
    }
    const proof = receipt.payloadVerification;
    if (!proof || !SHA.test(proof.mcpProxySha256 ?? '') ||
        proof.serveSha256 !== labels['com.papercusp.serve.sha256'] ||
        !/^v\d+\.\d+\.\d+$/.test(proof.nodeVersion ?? '')) {
      throw new Error('Build generation lacks observed native/container payload parity');
    }
    const image = JSON.parse(await run(engine, ['image', 'inspect', '--format', '{{json .}}', receipt.imageId]));
    if (!matchesImageId(image.Id, receipt.imageId) || image.Os + '/' + image.Architecture !== receipt.platform ||
        Object.entries(labels).some(([name, value]) => image.Config?.Labels?.[name] !== value)) {
      throw new Error('Local image no longer matches its build generation');
    }
    await verifyServerContainerPayload({ engine, imageId: receipt.imageId, platform: receipt.platform,
      serveSha256: proof.serveSha256, mcpProxySha256: proof.mcpProxySha256,
      nodeVersion: proof.nodeVersion.slice(1) }, run);
    if (await hashFile(receiptPath) !== receiptHash) throw new Error('Local build receipt changed during preflight');
    members.push({ arch, receipt, receiptPath, receiptHash });
  }
  if (members[0].receipt.sourceCommit !== members[1].receipt.sourceCommit) {
    throw new Error('Platform generations are from different native Server builds');
  }
  // Legacy receipts can be qualified without rebuilding the artifact. A stored
  // liveness/parity proof never substitutes for this fresh full-boot observation.
  for (const member of members) {
    member.bootVerification = await verifyServerContainerBoot({ engine,
      imageId: member.receipt.imageId, platform: member.receipt.platform,
      sourceCommit: member.receipt.sourceCommit,
      nodeVersion: member.receipt.payloadVerification.nodeVersion.slice(1),
      bootTimeoutMs: options.bootTimeoutMs }, run);
  }
  const out = resolve(options.out);
  if (members.some(member => within(out, member.receiptPath) || within(dirname(member.receiptPath), out))) {
    throw new Error('Publication output must be separate from local build generations');
  }
  await mkdir(out, { recursive: true });
  const stage = await mkdtemp(join(out, '.server-container-release-'));
  const tls = options.insecureRegistry ? ['--tls-verify=false'] : [];
  const registry = async (ref, raw = false) => {
    const args = ['run', '--rm', '--network', 'host', '--entrypoint', 'skopeo',
      process.env.SKOPEO_IMAGE ?? 'quay.io/centos-bootc/centos-bootc:stream9',
      'inspect', ...tls, ...(raw ? ['--raw'] : ['--format', '{{.Digest}}']), 'docker://' + ref];
    const data = await run(process.getuid?.() === 0 ? 'podman' : 'sudo',
      process.getuid?.() === 0 ? args : ['-n', 'podman', ...args]);
    if (raw) return JSON.parse(data);
    const digest = data.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Registry returned an invalid manifest digest');
    return digest;
  };
  const repository = tag.slice(0, tag.lastIndexOf(':'));
  try {
    for (const member of members) {
      const memberTag = tag + '-' + member.arch + '-' + member.receipt.imageId.slice(7, 19);
      await run(engine, ['tag', member.receipt.imageId, memberTag]);
      await run(engine, ['push', ...(engine === 'podman' ? tls : []), memberTag]);
      member.digest = await registry(memberTag);
      member.reference = repository + '@' + member.digest;
      const manifest = await registry(member.reference, true);
      if (manifest.config?.digest !== member.receipt.imageId) {
        throw new Error('Registry member does not contain the built native image');
      }
      const signingOut = join(stage, member.arch);
      await run('bash', [supplyChainScript, '--image', member.reference,
        '--key', key, '--pubkey', pubkey, '--out', signingOut,
        '--source-commit', member.receipt.sourceCommit,
        '--containerfile', 'infra/images/server/Containerfile',
        '--build-type', 'https://papercusp.dev/server/container/v1',
        '--builder-id', 'https://papercusp.dev/builders/server-container',
        '--base-image', member.receipt.rootfsBaseImage,
        ...(options.insecureRegistry ? ['--insecure-registry'] : [])]);
      const signed = await jsonFile(join(signingOut, 'supply-chain-summary.json'));
      const packageCount = Number(signed.sbomPackages);
      if (signed.reference !== member.reference || signed.signed !== true ||
          signed.provenanceAttested !== true || signed.sbomAttested !== true ||
          signed.secretScan !== 'clean' || signed.verifiedFromRegistry !== true ||
          !Number.isSafeInteger(packageCount) || packageCount < 50) {
        throw new Error('Image signatures and SBOM were not verified from the registry');
      }
    }
    const refs = members.map(member => member.reference);
    if (engine === 'docker') {
      await run(engine, ['manifest', 'create', ...(options.insecureRegistry ? ['--insecure'] : []), '--amend', tag, ...refs]);
      await run(engine, ['manifest', 'push', ...(options.insecureRegistry ? ['--insecure'] : []), tag]);
    } else {
      const localIndex = 'papercusp-server-' + stage.split(sep).at(-1).replaceAll('.', '');
      await run(engine, ['manifest', 'create', localIndex, ...refs]);
      try {
        await run(engine, ['manifest', 'push', '--all', ...tls, localIndex, 'docker://' + tag]);
      } finally {
        await run(engine, ['manifest', 'rm', localIndex]);
      }
    }
    const digest = await registry(tag);
    const reference = repository + '@' + digest;
    const index = await registry(reference, true);
    if (!Array.isArray(index.manifests) || index.manifests.length !== members.length ||
        members.some(member => index.manifests.filter(descriptor =>
          descriptor.platform?.os === 'linux' && descriptor.platform?.architecture === member.arch &&
          descriptor.digest === member.digest).length !== 1)) {
      throw new Error('Published manifest does not contain the exact signed amd64 and arm64 images');
    }
    const release = { schemaVersion: 1, kind: 'papercusp-server-published-index',
      reference, digest, tag, sourceCommit: members[0].receipt.sourceCommit,
      verifiedFromRegistry: true, memberSignaturesVerified: true,
      platforms: members.map(member => ({ platform: member.receipt.platform, reference: member.reference,
        imageId: member.receipt.imageId, labels: member.receipt.labels, sbomSha256: member.receipt.sbomSha256,
        bootVerification: { imageId: member.bootVerification.imageId, platform: member.bootVerification.platform,
          sourceCommit: member.bootVerification.sourceCommit, arch: member.bootVerification.arch,
          node: member.bootVerification.node, dbos: true, schemaReady: true, vectorReady: true },
        nativeReceiptSha256: member.receiptHash })) };
    await writeFile(join(stage, 'release.json'), JSON.stringify(release, null, 2) + '\n');
    const generation = join(out, 'papercusp-server-release-' + digest.slice(7));
    try {
      await rename(stage, generation);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
      const existing = await jsonFile(join(generation, 'release.json'));
      if (JSON.stringify(existing) !== JSON.stringify(release)) {
        throw new Error('Existing published generation has inconsistent evidence');
      }
      for (const member of members) {
        const prior = await jsonFile(join(generation, member.arch, 'supply-chain-summary.json'));
        if (prior.reference !== member.reference || prior.signed !== true || prior.verifiedFromRegistry !== true) {
          throw new Error('Existing published generation has inconsistent signing evidence');
        }
      }
    }
    return { ...release, receiptPath: join(generation, 'release.json') };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

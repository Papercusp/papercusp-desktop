/** Target-specific extension of host-runtime-closure.sh. Measured package
 * bytes are not approval, authenticated authorship or SEC evidence.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readSync, readFileSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTauriUpdateEnvelope } from '../../../libs/generic/tauri-release-kit/src/signature.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const inside = (root, file) => { const rel = relative(root, file); return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'); };

export function stageHandlerRuntime({ node, bootstrap, koffi, addon, arch, output, libraryDirs, build }) {
  if (!['x64', 'arm64'].includes(arch) || !Array.isArray(libraryDirs) || !libraryDirs.length) {
    throw new Error('explicit supported target and library roots required');
  }
  const roots = libraryDirs.map(root => realpathSync(root));
  const destination = resolve(output);
  if (existsSync(destination)) throw new Error('handler runtime destination already exists');
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), '.handler-runtime-'));
  const files = new Map(), queue = [];
  let bytesTotal = 0;
  const add = (path, source, executable = false, elf = false) => {
    if (!/^\/(?:runtime|lib|lib64|usr\/lib)\/[A-Za-z0-9_@/+.\-]+$/.test(path)
      || path.split('/').includes('..')) throw new Error('invalid runtime package path');
    const stat = statSync(source);
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024) throw new Error('invalid runtime package file');
    const contents = readFileSync(source);
    const record = { path, sha256: hash(contents), executable };
    const prior = files.get(path);
    if (prior) {
      if (prior.sha256 !== record.sha256 || prior.executable !== executable) throw new Error('runtime path collision');
      return;
    }
    bytesTotal += contents.length;
    if (bytesTotal > 512 * 1024 * 1024 || files.size >= 1022) throw new Error('runtime package exceeds admission limits');
    const target = join(temporary, path.slice(1));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, { flag: 'wx', mode: executable ? 0o555 : 0o444 });
    if (elf) {
      if (contents.length < 64 || contents.subarray(0, 4).toString('hex') !== '7f454c46'
        || contents[4] !== 2 || contents[5] !== 1 || contents.readUInt16LE(18) !== (arch === 'x64' ? 62 : 183)) {
        throw new Error('runtime ELF target mismatch');
      }
      queue.push(target);
    }
    files.set(path, record);
  };
  const library = name => {
    if (!/^[A-Za-z0-9_.+\-]+$/.test(name)) throw new Error('unsafe ELF dependency');
    for (const root of roots) {
      const candidate = join(root, name);
      if (!existsSync(candidate)) continue;
      const real = realpathSync(candidate);
      if (!roots.some(allowed => inside(allowed, real))) throw new Error('library escapes explicit target roots');
      return real;
    }
    throw new Error('missing target ELF dependency: ' + name);
  };
  try {
    const manifest = JSON.parse(readFileSync(join(koffi, 'package.json'), 'utf8'));
    if (manifest.name !== 'koffi' || manifest.version !== '3.3.7') throw new Error('unrecognized Koffi runtime layout');
    const nativeManifest = JSON.parse(readFileSync(join(dirname(dirname(addon)), 'package.json'), 'utf8'));
    if (nativeManifest.name !== '@koromix/koffi-linux-' + arch || nativeManifest.version !== manifest.version) {
      throw new Error('Koffi target package mismatch');
    }
    // Reviewed 3.3.7 CJS loader closure: no tests, compiler or foreign ABI.
    for (const name of ['package.json', 'index.cjs', 'src/koffi/index.cjs', 'src/koffi/src/static.cjs']) {
      const source = join(koffi, name);
      if (!inside(realpathSync(koffi), realpathSync(source))) throw new Error('Koffi loader escapes package');
      add('/runtime/node_modules/koffi/' + name, source);
    }
    add('/runtime/node_modules/koffi/build/koffi/linux_' + arch + '/koffi.node', addon, true, true);
    add('/runtime/node', node, true, true);
    add('/runtime/bootstrap.cjs', bootstrap);
    // dlopen inputs are explicit roots, not DT_NEEDED edges.
    add('/lib/libseccomp.so.2', library('libseccomp.so.2'), true, true);
    add('/lib/libc.so.6', library('libc.so.6'), true, true);
    const environment = { PATH: '/usr/bin:/bin', LC_ALL: 'C' };
    for (let index = 0; index < queue.length; index++) {
      const file = queue[index];
      const dynamic = execFileSync('/usr/bin/objdump', ['-p', file], { encoding: 'utf8', env: environment, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      // Flat /lib mounts cannot silently substitute origin-dependent rules.
      if (/^\s*(?:RPATH|RUNPATH)\s+/m.test(dynamic)) throw new Error('unsupported runtime ELF search path');
      for (const match of dynamic.matchAll(/^\s*NEEDED\s+(\S+)\s*$/gm)) {
        add('/lib/' + match[1], library(match[1]), true, true);
      }
      const program = execFileSync('/usr/bin/readelf', ['-l', '--wide', file], { encoding: 'utf8', env: environment, timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      const interpreters = [...program.matchAll(/\[Requesting program interpreter: ([^\]]+)\]/g)];
      if (file === join(temporary, 'runtime/node') && interpreters.length !== 1) throw new Error('Node ELF interpreter missing');
      for (const match of interpreters) {
        const expected = arch === 'x64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1';
        if (match[1] !== expected) throw new Error('unsupported runtime ELF interpreter');
        add(expected, library(basename(expected)), true, true);
      }
    }
    const records = [...files.values()].sort(compare);
    const inventory = { schema: 'handler-runtime-files-v1', platform: 'linux', arch,
      sha256: hash(JSON.stringify(records)), bootstrapSha256: files.get('/runtime/bootstrap.cjs').sha256, files: records };
    if (build !== undefined) {
      // Transport existing signed receipts, never mint authority here. Admission
      // rebuilds these sources and checks CURRENT protected trust independently.
      const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
      if (!exact(build, ['entryPoint', 'identity', 'sources', 'assets', 'authorization'])
        || !exact(build.identity, ['sourceRevision', 'version', 'rollbackCounter'])
        || !Array.isArray(build.sources) || !build.sources.length || !Array.isArray(build.assets)
        || build.sources.length + files.size > 1023) throw new Error('invalid handler build population');
      const receipts = (input, file) => {
        if (!Array.isArray(input) || !input.length || input.length > 64) throw new Error('complete input author receipts required');
        return input.map(value => {
          const envelope = parseTauriUpdateEnvelope(value), metadata = JSON.parse(envelope.payload);
          if (metadata.artifactSha256 !== file.sha256
            || metadata.policySha256 !== hash(JSON.stringify({ path: file.path, executable: file.executable }))
            || metadata.product !== 'papercusp-handler-input'
            || metadata.platform !== (arch === 'x64' ? 'linux-x86_64' : 'linux-aarch64')
            || ['sourceRevision', 'version', 'rollbackCounter'].some(field => metadata[field] !== build.identity[field])) {
            throw new Error('handler input receipt differs from packaged bytes or identity');
          }
          return envelope;
        });
      };
      const seen = new Set();
      const sources = build.sources.map(source => {
        if (!exact(source, ['path', 'source', 'sha256', 'executable', 'authorizations'])
          || typeof source.path !== 'string' || !/^\/src\/[A-Za-z0-9_@/+.\-]+$/.test(source.path)
          || source.path.slice(1).split('/').some(part => part === '.' || part === '..' || !part) || source.executable !== false
          || !/^[a-f0-9]{64}$/.test(source.sha256) || seen.has(source.path)) throw new Error('invalid handler source record');
        seen.add(source.path);
        const fd = openSync(source.source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        let contents;
        try {
          const before = fstatSync(fd, { bigint: true });
          if (!before.isFile() || before.nlink !== 1n || before.size > 256n * 1024n * 1024n
            || bytesTotal + Number(before.size) > 512 * 1024 * 1024) throw new Error('invalid handler source size or type');
          contents = Buffer.alloc(Number(before.size) + 1);
          let size = 0;
          while (size < contents.length) {
            const count = readSync(fd, contents, size, contents.length - size, null);
            if (!count) break;
            size += count;
          }
          const after = fstatSync(fd, { bigint: true });
          if (BigInt(size) !== before.size || !['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']
            .every(field => before[field] === after[field])) throw new Error('handler source changed during snapshot');
          contents = contents.subarray(0, size);
        } finally { closeSync(fd); }
        if (hash(contents) !== source.sha256) throw new Error('handler source digest mismatch');
        bytesTotal += contents.length;
        const target = join(temporary, source.path.slice(1));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, contents, { flag: 'wx', mode: 0o444 });
        return { path: source.path, sha256: source.sha256, executable: false, authorizations: receipts(source.authorizations, source) };
      });
      if (!seen.has(build.entryPoint)) throw new Error('handler build entry is absent');
      const assets = new Map(records.filter(file => file.path !== '/runtime/bootstrap.cjs').map(file => [file.path, file]));
      if (build.assets.length !== assets.size) throw new Error('handler asset receipt population mismatch');
      const assetReceipts = build.assets.map(asset => {
        if (!exact(asset, ['path', 'authorizations']) || !assets.has(asset.path)) throw new Error('handler asset receipt population mismatch');
        const file = assets.get(asset.path); assets.delete(asset.path);
        return { path: asset.path, authorizations: receipts(asset.authorizations, file) };
      });
      const authorization = parseTauriUpdateEnvelope(build.authorization), metadata = JSON.parse(authorization.payload);
      if (metadata.artifactSha256 !== inventory.sha256 || metadata.policySha256 !== inventory.bootstrapSha256
        || metadata.product !== 'papercusp-handler-runtime'
        || metadata.platform !== (arch === 'x64' ? 'linux-x86_64' : 'linux-aarch64')
        || ['sourceRevision', 'version', 'rollbackCounter'].some(field => metadata[field] !== build.identity[field])) {
        throw new Error('handler runtime receipt differs from packaged bytes or identity');
      }
      inventory.build = { entryPoint: build.entryPoint, identity: { ...build.identity }, sources,
        assets: assetReceipts, authorization };
    }
    const serialized = JSON.stringify(inventory) + '\n';
    if (Buffer.byteLength(serialized) > 16 * 1024 * 1024) throw new Error('handler inventory exceeds admission limit');
    writeFileSync(join(temporary, 'inventory.json'), serialized, { flag: 'wx', mode: 0o444 });
    renameSync(temporary, destination);
    return inventory;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [node, bootstrap, koffi, addon, arch, output, ...options] = process.argv.slice(2);
  try {
    let build;
    if (options[0] === '--build-inputs') {
      const file = resolve(options[1]); options.splice(0, 2);
      if (statSync(file).size > 16 * 1024 * 1024) throw new Error('handler build description exceeds admission limit');
      build = JSON.parse(readFileSync(file, 'utf8'));
      for (const source of build.sources ?? []) source.source = resolve(dirname(file), source.source);
    }
    stageHandlerRuntime({ node, bootstrap, koffi, addon, arch, output, libraryDirs: options, build });
  }
  catch (error) { console.error('handler runtime packaging refused: ' + error.message); process.exitCode = 1; }
}

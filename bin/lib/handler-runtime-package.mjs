/** Target-specific extension of host-runtime-closure.sh. Measured package
 * bytes are not approval, authenticated authorship or SEC evidence.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
const inside = (root, file) => { const rel = relative(root, file); return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('/'); };

export function stageHandlerRuntime({ node, bootstrap, koffi, addon, arch, output, libraryDirs }) {
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
    writeFileSync(join(temporary, 'inventory.json'), JSON.stringify(inventory) + '\n', { flag: 'wx', mode: 0o444 });
    renameSync(temporary, destination);
    return inventory;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [node, bootstrap, koffi, addon, arch, output, ...libraryDirs] = process.argv.slice(2);
  try { stageHandlerRuntime({ node, bootstrap, koffi, addon, arch, output, libraryDirs }); }
  catch (error) { console.error('handler runtime packaging refused: ' + error.message); process.exitCode = 1; }
}

// Independent native-source/WSL-destination witness. This never writes a runtime
// marker or changes the trees being compared. Only snapshot's output is written.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const excludedInputs = new Set(['source.tar.zst', 'db-seed.dump', 'db-seed.tar.gz']);

// Windows readlink reports native separators; tar stores portable separators.
// Never normalize Unix link text: a backslash there is a literal filename byte.
function portableLinkTarget(target, platform = process.platform) {
  return platform === 'win32' ? target.replace(/\\/g, '/') : target;
}

function inventory(root, source = false) {
  const entries = [];
  function walk(relative) {
    for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
      const rel = relative ? `${relative}/${name}` : name;
      if (source && excludedInputs.has(rel)) continue;
      const file = path.join(root, rel);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(file);
        entries.push({ path: rel, type: 'link',
          target: source ? portableLinkTarget(target) : target });
      } else if (stat.isDirectory()) {
        entries.push({ path: rel, type: 'directory' });
        walk(rel);
      } else if (stat.isFile()) {
        const fd = fs.openSync(file, 'r');
        const hash = crypto.createHash('sha256');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        let length = 0;
        let executable = false;
        try {
          for (;;) {
            const n = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (!n) break;
            if (!length) {
              executable = (n >= 2 && buffer[0] === 35 && buffer[1] === 33)
                || (n >= 4 && buffer.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])));
            }
            hash.update(buffer.subarray(0, n));
            length += n;
          }
          const after = fs.fstatSync(fd);
          if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
            throw new Error(`Source changed while hashing: ${rel}`);
          }
        } finally { fs.closeSync(fd); }
        entries.push({ path: rel, type: 'file', bytes: length, sha256: hash.digest('hex'),
          executable: source ? executable : Boolean(stat.mode & 0o100),
          // Owner-only execute is the contract: checking just the owner bit
          // cannot detect unwanted group/other execute permissions.
          executeBits: source ? (executable ? 0o100 : 0) : stat.mode & 0o111 });
      } else {
        throw new Error(`Unsupported entry type: ${rel}`);
      }
    }
  }
  walk('');
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function snapshot(root) {
  for (const required of ['serve.mjs', 'sidecar-preload.js']) {
    if (!fs.statSync(path.join(root, required)).isFile()) throw new Error(`Missing ${required}`);
  }
  return { schema: 'wsl-staging-byte-mode-v2', entries: inventory(root, true) };
}

function verify(root, manifest) {
  if (manifest.schema !== 'wsl-staging-byte-mode-v2' || !Array.isArray(manifest.entries)) {
    throw new Error('Invalid source manifest');
  }
  const expected = new Map();
  for (const entry of manifest.entries) {
    if (!entry.path || path.posix.isAbsolute(entry.path) || entry.path.split('/').includes('..')
        || entry.path.includes('\\') || expected.has(entry.path)) throw new Error('Invalid or duplicate path');
    expected.set(entry.path, entry);
  }
  if (!expected.has('serve.mjs') || !expected.has('sidecar-preload.js')) {
    throw new Error('Source manifest lacks required runtime files');
  }
  const actual = inventory(root);
  const failures = [];
  for (const entry of actual) {
    const want = expected.get(entry.path);
    if (!want) failures.push(`extra: ${entry.path}`);
    else if (JSON.stringify(entry) !== JSON.stringify(want)) failures.push(`changed: ${entry.path}`);
    expected.delete(entry.path);
  }
  for (const missing of expected.keys()) failures.push(`missing: ${missing}`);
  if (failures.length) throw new Error(`${failures.length} byte/mode differences: ${failures.slice(0, 8).join('; ')}`);
  return { pass: true, entries: actual.length,
    files: actual.filter(e => e.type === 'file').length,
    bytes: actual.reduce((sum, e) => sum + (e.bytes || 0), 0),
    executableFiles: actual.filter(e => e.type === 'file' && e.executable).length,
    manifestSha256: crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    acceptance: false, published: false };
}

module.exports = { snapshot, verify, portableLinkTarget };
if (require.main === module) {
  const [mode, root, output] = process.argv.slice(2);
  if (!root || !output || !['snapshot', 'verify'].includes(mode)) {
    throw new Error('Usage: snapshot SOURCE MANIFEST | verify DESTINATION MANIFEST');
  }
  if (mode === 'snapshot') {
    const manifest = snapshot(root);
    fs.writeFileSync(output, JSON.stringify(manifest), { flag: 'wx' });
    console.log(JSON.stringify({ snapshot: true, entries: manifest.entries.length }));
  } else {
    console.log(JSON.stringify(verify(root, JSON.parse(fs.readFileSync(output, 'utf8')))));
  }
}

// WI-6554700010009823 — verify-sidecar-bundle.sh step [3/7] must gate on the
// TARGET OS, not the build host's OS.
//
// WHY THIS TEST EXISTS
// [3/7] inventories the payload with server-container.mjs sidecarInventory(root,
// 'linux/<arch>'), which requires every native payload (bin/node included) to be
// an ELF for that platform. The step was gated on `uname -s` == Linux, so a
// darwin bundle cross-baked on a Linux host (the Mac Intel release leg) ran the
// ELF-only inventory over a Mach-O bin/node and failed with "Native payload
// architecture mismatch: bin/node" / "complete ELF target inventory failed".
// [4/7] already gates on the target for the same reason (WI-5651).
//
// This runs the REAL script against a synthetic sidecar whose bin/node is a
// Mach-O x86_64 header, for both targets: darwin must skip [3/7]; linux must
// still run it (and reject the non-ELF node), so the fix cannot be a blanket skip.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const scriptPath = path.resolve(__dirname, '../bin/verify-sidecar-bundle.sh');
const verifierSource = fs.readFileSync(scriptPath, 'utf8');
const closureStart = verifierSource.indexOf('check_boot_import_closure() {');
const closureEnd = verifierSource.indexOf('\n}\nif [[', closureStart) + 2;
assert.ok(closureStart >= 0 && closureEnd > closureStart);
const closureFunction = verifierSource.slice(closureStart, closureEnd);

function promptReceipt() {
  return { schemaVersion: 'role-prompt-assets/v1', installedUseVerified: false, candidateAccepted: false,
    roles: ['oracle', 'operator'],
    documents: ['oracle', 'operator'].flatMap(role => ['persona', 'converse', 'tools'].map(document => ({ role, document,
      required: document !== 'tools', disposition: document === 'tools' ? 'optional-absent' : 'unavailable',
      sha256: null, refusalVerified: document !== 'tools' }))) };
}

function promptCheck(receipt, before = '', setup = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vsb-prompts-'));
  const side = path.join(root, 'side');
  try {
    fs.mkdirSync(path.join(side, 'bin'), { recursive: true });
    fs.symlinkSync(process.execPath, path.join(side, 'bin/node'));
    fs.mkdirSync(path.join(side, 'node_modules/synthetic-native'), { recursive: true });
    fs.writeFileSync(path.join(side, 'node_modules/synthetic-native/index.js'), 'module.exports = {};');
    setup(root, side);
    fs.writeFileSync(path.join(side, 'serve.mjs'), `
      if (!process.argv.includes('--verify-role-prompts')) throw Error('wrong phase');
      if (process.env.PAPERCUSP_PROMPT_ROOT || process.env.PAPERCUSP_INTEGRATION_ROOT) throw Error('developer root leaked');
      ${before}
      console.log('PAPERCUSP_ROLE_PROMPT_ASSETS ' + JSON.stringify(${JSON.stringify(receipt)}));`);
    return spawnSync('bash', ['-c', `set -uo pipefail\nREQUIRED_NATIVE_MODULES=synthetic-native\n${closureFunction}\ncheck_boot_import_closure "$1" prompts`, 'fixture', side], {
      encoding: 'utf8', timeout: 120_000, env: { ...process.env,
        PAPERCUSP_PROMPT_ROOT: '/synthetic-developer-root', PAPERCUSP_INTEGRATION_ROOT: '/synthetic-developer-root' },
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('prompt metadata accepts explicit unavailable capabilities without accepting installed use', () => {
  const result = promptCheck(promptReceipt(), `import fs from 'node:fs'; fs.writeSync(2, 'synthetic qualification diagnostic\\n');`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout.trim().slice('PAPERCUSP_ROLE_PROMPT_ASSETS '.length));
  assert.deepEqual(receipt, promptReceipt());
  assert.doesNotMatch(result.stdout, /vsb-prompts-|synthetic-developer-root/);
});

test('prompt metadata rejects false availability, unverified refusals, omissions, privacy leaks and use claims', () => {
  const mutations = [
    r => { r.documents[0].disposition = 'available'; },
    r => { r.documents[0].refusalVerified = false; },
    r => { r.documents.pop(); },
    r => { r.documents = r.documents.filter(doc => doc.role !== 'oracle'); },
    r => { r.roles.push('oracle'); },
    r => { r.roles = ['oracle']; },
    r => { r.documents[0].path = '/private/persona.md'; },
    r => { r.documents[0].text = 'SYNTHETIC PRIVATE BYTES'; },
    r => { r.installedUseVerified = true; },
    r => { r.documents[0].disposition = 'unclassified'; },
  ];
  for (const mutate of mutations) {
    const receipt = promptReceipt(); mutate(receipt);
    const result = promptCheck(receipt);
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /PROMPT_ASSET_CONTRACT_INVALID/);
  }
});

test('prompt qualification denies writes, network and reads outside the final image even if caught', () => {
  for (const operation of [
    `import fs from 'node:fs'; try { fs.writeFileSync('operator.lock', 'forbidden'); } catch {}`,
    `import fs from 'node:fs'; try { fs.createWriteStream('operator.lock'); } catch {}`,
    `import fs from 'node:fs'; try { fs.copyFileSync('serve.mjs', 'operator.lock'); } catch {}`,
    `import fs from 'node:fs'; try { fs.writeSync(9, 'forbidden'); } catch {}`,
    `import net from 'node:net'; try { net.connect({ port: 1 }); } catch {}`,
    `import dgram from 'node:dgram'; try { dgram.createSocket('udp4').send('forbidden', 9, '127.0.0.1'); } catch {}`,
    `import fs from 'node:fs'; try { fs.readFileSync('../outside.persona.md', 'utf8'); } catch {}`,
    `import fs from 'node:fs'; try { fs.createReadStream('../outside.persona.md'); } catch {}`,
  ]) {
    const result = promptCheck(promptReceipt(), operation, root => fs.writeFileSync(path.join(root, 'outside.persona.md'), 'SYNTHETIC OUTSIDE CONTENT'));
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /BOOT_IMPORT_IO_FORBIDDEN/);
    assert.doesNotMatch(result.stdout + result.stderr, /SYNTHETIC OUTSIDE CONTENT/);
  }
});

test('cross images defer prompt execution to the target', () => {
  const dispatch = verifierSource.slice(verifierSource.lastIndexOf('if [[ "$CROSS" == "0" ]]'));
  assert.match(dispatch, /check_boot_import_closure "\$SIDECAR" prompts/);
  assert.match(dispatch.split('\nelse\n')[1], /prompt dispositions MUST be qualified on target/);
  assert.doesNotMatch(dispatch.split('\nelse\n')[1], /check_boot_import_closure/);
});

function machOSidecar() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vsb-target-os-'));
  fs.mkdirSync(path.join(root, 'bin'));
  const header = Buffer.alloc(32 + 64);
  header.writeUInt32LE(0xfeedfacf, 0); // MH_MAGIC_64
  header.writeInt32LE(0x01000007, 4); // CPU_TYPE_X86_64
  header.writeInt32LE(3, 8); // CPU_SUBTYPE_X86_64_ALL
  header.writeUInt32LE(2, 12); // MH_EXECUTE
  fs.writeFileSync(path.join(root, 'bin', 'node'), header, { mode: 0o755 });
  return root;
}

function stepThree(targetOs) {
  const root = machOSidecar();
  try {
    const result = spawnSync('bash', [scriptPath, root, '--target-os', targetOs, '--target-arch', 'x64'], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    assert.equal(result.error, undefined, String(result.error));
    const lines = result.stdout.split('\n');
    const start = lines.findIndex((line) => line.startsWith('[3/7]'));
    const end = lines.findIndex((line) => line.startsWith('[4/7]'));
    assert.ok(start >= 0 && end > start, `[3/7]..[4/7] not found in output:\n${result.stdout}`);
    return lines.slice(start + 1, end).join('\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('[3/7] skips the ELF closure for a darwin target, whatever the build host', () => {
  const section = stepThree('darwin');
  assert.match(section, /skipped — target is not linux/);
  assert.doesNotMatch(section, /ELF target inventory failed/);
});

test('[3/7] still runs the ELF closure for a linux target and rejects a non-ELF node', {
  skip: process.platform !== 'linux' && 'the linux-target closure needs objdump on a Linux build host',
}, () => {
  const section = stepThree('linux');
  assert.doesNotMatch(section, /skipped/);
  assert.match(section, /complete ELF target inventory failed/);
});

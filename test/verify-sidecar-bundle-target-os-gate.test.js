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

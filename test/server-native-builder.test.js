const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const recipe = fs.readFileSync(path.resolve(__dirname, '../../infra/images/server/NativeBuilder.Containerfile'), 'utf8');
const preflight = recipe.split('# NATIVE_PREFLIGHT_BEGIN\n')[1].split('# NATIVE_PREFLIGHT_END')[0];

// Execute the actual build preflight with both process probes, without apt or
// downloads. A wrong rootfs must refuse before the first mutating build layer.
function probe(target, distroArch, nodeArch, versions = {}) {
  const script = preflight.replaceAll('/usr/local/bin/node', 'node');
  return spawnSync('bash', ['-euo', 'pipefail', '-c',
    'dpkg() { printf "%s\\n" "$FIXTURE_DISTRO_ARCH"; };\n' +
    'node() { printf "%s\\n" "$FIXTURE_NODE_ARCH"; };\n' + script], {
    encoding: 'utf8',
    env: { ...process.env, TARGETARCH: target, BUILD_NODE_VERSION: '25.9.0',
      RUST_VERSION: '1.97.1', RUSTUP_VERSION: '1.28.2',
      FIXTURE_DISTRO_ARCH: distroArch, FIXTURE_NODE_ARCH: nodeArch, ...versions },
  });
}

test('native builder admits matching ARM64 and AMD64 process/rootfs pairs', () => {
  for (const [arch, nodeArch] of [['arm64', 'arm64'], ['amd64', 'x64']]) {
    const r = probe(arch, arch, nodeArch);
    assert.equal(r.status, 0, r.stderr);
  }
});

test('native builder rejects host bytes, mixed runtime/rootfs and unsupported targets before installation', () => {
  for (const tuple of [['arm64', 'amd64', 'arm64'], ['arm64', 'arm64', 'x64'],
    ['amd64', 'amd64', 'arm64'], ['riscv64', 'riscv64', 'riscv64']]) {
    const r = probe(...tuple);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /architecture differs|requires amd64 or arm64/);
  }
});

test('native builder refuses moving or shell-looking toolchain versions', () => {
  for (const key of ['BUILD_NODE_VERSION', 'RUST_VERSION', 'RUSTUP_VERSION']) {
    for (const value of ['latest', '', '25.9.0; touch /tmp/unwanted']) {
      const r = probe('arm64', 'arm64', 'arm64', { [key]: value });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /require exact versions/);
    }
  }
});

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(
  path.resolve(__dirname, '../bin/lib/vm-release-trust-toolchain.sh'), 'utf8',
);
function helper(name) {
  const match = source.match(new RegExp(`${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} is missing`);
  return match[0];
}

function probeTarget(metadata, targetOs, targetArch) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-go-target-'));
  try {
    const go = path.join(fixture, 'go');
    const binary = path.join(fixture, 'kopia');
    fs.writeFileSync(binary, 'fixture');
    fs.writeFileSync(path.join(fixture, 'metadata'), metadata);
    fs.writeFileSync(go, '#!/bin/sh\ncat "$PC_GO_METADATA"\n');
    fs.chmodSync(go, 0o755);
    return spawnSync('bash', ['-c', [
      'set -euo pipefail', helper('_pc_vm_assert_go_target'),
      '_pc_vm_assert_go_target "$1" "$2" "$3" "$4"',
    ].join('\n'), 'fixture', go, binary, targetOs, targetArch], {
      encoding: 'utf8',
      env: { ...process.env, PC_GO_METADATA: path.join(fixture, 'metadata') },
    });
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

function validateReleaseTarget(targetOs, targetArch) {
  return spawnSync('bash', ['-c', [
    'set -euo pipefail', helper('papercusp_validate_vm_release_target'),
    'papercusp_validate_vm_release_target "$1" "$2"',
  ].join('\n'), 'fixture', targetOs, targetArch], { encoding: 'utf8' });
}

test('vm-release candidate qualification accepts the supported Linux x64 target', () => {
  const result = validateReleaseTarget('linux', 'x64');
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('vm-release candidate qualification rejects unsupported native targets', () => {
  for (const [targetOs, targetArch] of [
    ['darwin', 'x64'], ['darwin', 'arm64'],
    ['windows', 'x64'], ['linux', 'arm64'],
  ]) {
    const result = validateReleaseTarget(targetOs, targetArch);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, `${targetOs}-${targetArch}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /supports only linux-x64/);
    assert.ok(result.stderr.includes(`requested: ${targetOs}-${targetArch}`), result.stderr);
    assert.match(result.stderr, /refusing to fall back to stale ambient binaries/);
  }
});

test('pinned Go CLI target guard accepts complete Linux and Darwin target metadata', () => {
  for (const [os, arch] of [['linux', 'amd64'], ['darwin', 'amd64'], ['darwin', 'arm64']]) {
    const result = probeTarget(`\tbuild\tGOOS=${os}\n\tbuild\tGOARCH=${arch}\n`, os, arch);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});

test('pinned Go CLI target guard rejects host binary, wrong arch, and incomplete metadata', () => {
  for (const metadata of [
    '\tbuild\tGOOS=linux\n\tbuild\tGOARCH=amd64\n',
    '\tbuild\tGOOS=darwin\n\tbuild\tGOARCH=arm64\n',
    '\tbuild\tGOOS=darwin\n',
    'unrecognized file format\n',
  ]) {
    const result = probeTarget(metadata, 'darwin', 'amd64');
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /does not embed target darwin\/amd64/);
  }
});

test('shared source recipe pins both compiler targets and preserves Linux protocol probes', () => {
  const build = helper('_pc_vm_build_go_tools');
  assert.equal((build.match(/CGO_ENABLED=0 GOOS="\$target_os" GOARCH="\$target_arch"/g) || []).length, 2);
  assert.equal((build.match(/_pc_vm_assert_go_target "\$go_bin"/g) || []).length, 2);
  assert.equal((build.match(/if \[\[ "\$target_os\/\$target_arch" == "linux\/amd64" \]\]/g) || []).length, 2);
  assert.match(build, /snapshot create --help/);
  assert.match(build, /_pc_vm_assert_module "\$go_bin" "\$output\/bin\/kopia" google\.golang\.org\/grpc/);
  // No change to the VM profile's public target contract.
  assert.match(helper('papercusp_validate_vm_release_target'),
    /"\$target_os" != "linux" \|\| "\$target_arch" != "x64"/);
});

test('shared source recipe refuses unsupported target before network or source mutation', () => {
  const result = spawnSync('bash', ['-c', [
    'set -euo pipefail', helper('_pc_vm_build_go_tools'),
    '_pc_vm_build_go_tools /unused/work /unused/output /unused/go windows amd64',
  ].join('\n')], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /unsupported pinned Go CLI target windows\/amd64/);
});

test('Kopia compress security pin participates in build, embedded-version assertion and both cache manifests', () => {
  assert.match(source, /PAPERCUSP_VM_KOPIA_COMPRESS_VERSION="v1\.18\.7"/);
  assert.match(source, /PAPERCUSP_VM_TRUST_REVISION="2026-10-23-r1"/);
  const build = helper('_pc_vm_build_go_tools');
  assert.ok(build.includes('"github.com/klauspost/compress@$PAPERCUSP_VM_KOPIA_COMPRESS_VERSION"'));
  assert.ok(build.includes('_pc_vm_assert_module "$go_bin" "$output/bin/kopia" github.com/klauspost/compress "$PAPERCUSP_VM_KOPIA_COMPRESS_VERSION"'));
  assert.equal(source.split('"github.com/klauspost/compress": "$PAPERCUSP_VM_KOPIA_COMPRESS_VERSION"').length - 1, 2);
});

test('actual Go-module verifier rejects vulnerable and missing embedded compress metadata', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-kopia-compress-'));
  try {
    const go = path.join(fixture, 'go');
    const metadata = path.join(fixture, 'metadata');
    fs.writeFileSync(go, '#!/bin/sh\ncat "$PC_GO_METADATA"\n'); fs.chmodSync(go, 0o755);
    for (const version of ['v1.18.6', '', 'v1.18.7']) {
      fs.writeFileSync(metadata, version ? `\tdep\tgithub.com/klauspost/compress\t${version}\th1:fixture\n` : '');
      const result = spawnSync('bash', ['-c', [
        'set -euo pipefail', helper('_pc_vm_assert_module'),
        '_pc_vm_assert_module "$1" /fixture/kopia github.com/klauspost/compress v1.18.7',
      ].join('\n'), 'fixture', go], { encoding: 'utf8', env: { ...process.env, PC_GO_METADATA: metadata } });
      assert.equal(result.status, version === 'v1.18.7' ? 0 : 1, result.stdout + result.stderr);
      if (version !== 'v1.18.7') assert.match(result.stderr, /does not embed github.com\/klauspost\/compress@v1\.18\.7/);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

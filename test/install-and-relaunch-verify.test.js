'use strict';

// EI-21098317150752345 — Windows is a split GUI + Server product. The GUI never
// owns the operator, so an update proof that installs only the GUI can relaunch
// the old Server and falsely attribute the resulting no-flip to EI-9002. Drive
// the real Bash verifier through hermetic ssh/scp shims and require the complete,
// provenance-matched Server Inno span to install before either app relaunches.
// The Linux fixture also models a pristine overlay whose cached apt lists are
// stale, so the verifier must refresh them before resolving the local .deb.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { test } = require('node:test');

const SCRIPT = join(__dirname, '..', 'bin', 'install-and-relaunch-verify.sh');
const TARGET_SHA = '2363b77a68dee8d79528a4a6a94321cc324ed2f7';
const VERSION = '0.0.18';

function executable(dir, name, source) {
  const file = join(dir, name);
  writeFileSync(file, source);
  chmodSync(file, 0o755);
  return file;
}

function writeProvenance(dir, sha = TARGET_SHA) {
  const names = [
    `Papercusp GUI_${VERSION}_x64-setup.exe`,
    `Papercusp Server_${VERSION}_x64-setup.exe`,
    `Papercusp Server_${VERSION}_x64-setup-1.bin`,
    `Papercusp Server_${VERSION}_x64-setup-2.bin`,
  ];
  writeFileSync(join(dir, 'build-provenance.json'), JSON.stringify({
    version: VERSION,
    buildSha: sha,
    artifacts: names.map((name) => ({ name })),
  }));
}

function fixture({ requireHostKeyOptions = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'install-relaunch-server-'));
  const artifacts = join(root, 'artifacts');
  const shims = join(root, 'shims');
  mkdirSync(artifacts);
  mkdirSync(shims);

  const gui = join(artifacts, `Papercusp GUI_${VERSION}_x64-setup.exe`);
  const server = join(artifacts, `Papercusp Server_${VERSION}_x64-setup.exe`);
  const slices = [1, 2].map((index) => join(artifacts, `Papercusp Server_${VERSION}_x64-setup-${index}.bin`));
  for (const file of [gui, server, ...slices]) writeFileSync(file, basename(file));
  writeProvenance(artifacts);

  const log = join(root, 'transport.log');
  const flipped = join(root, 'flipped');
  const ssh = executable(shims, 'ssh', `#!/usr/bin/env bash
printf 'SSH %s\\n' "$*" >> "$MOCK_LOG"
if [[ "$MOCK_REQUIRE_HOST_KEY_OPTIONS" == "1" && "$*" != *"StrictHostKeyChecking=no"* ]]; then
  printf 'Host key verification failed: rotated host key\\n' >&2
  exit 255
fi
case "$*" in
  *"cmd /c echo VM-OK"*) printf 'VM-OK\\n' ;;
  *"--exec cat /home/papercup/.papercusp/operator.json"*) printf '{"port":15747}\\n' ;;
  *"--exec curl -sS -m 5 http://127.0.0.1:15747/api/health"*)
    if [[ -f "$MOCK_FLIPPED" ]]; then
      printf '{"sha":"${TARGET_SHA}","version":"${VERSION}"}\\n'
    else
      printf '{"sha":"old-sha","version":"0.0.17"}\\n'
    fi
    ;;
  *"schtasks /run /tn papercusp-e2e"*) : > "$MOCK_FLIPPED" ;;
esac
`);
  const scp = executable(shims, 'scp', `#!/usr/bin/env bash
printf 'SCP %s\\n' "$*" >> "$MOCK_LOG"
if [[ "$MOCK_REQUIRE_HOST_KEY_OPTIONS" == "1" && "$*" != *"StrictHostKeyChecking=no"* ]]; then
  printf 'Host key verification failed: rotated host key\\n' >&2
  exit 255
fi
`);

  return { root, gui, server, slices, log, flipped, ssh, scp, requireHostKeyOptions };
}

function linuxFixture() {
  const root = mkdtempSync(join(tmpdir(), 'install-relaunch-linux-'));
  const artifacts = join(root, 'artifacts');
  const shims = join(root, 'shims');
  mkdirSync(artifacts);
  mkdirSync(shims);

  const deb = join(artifacts, `papercusp-gui_${VERSION}_amd64.deb`);
  writeFileSync(deb, 'pristine ubuntu deb fixture');
  writeFileSync(join(artifacts, 'build-provenance.json'), JSON.stringify({
    version: VERSION,
    buildSha: TARGET_SHA,
  }));

  const log = join(root, 'transport.log');
  const flipped = join(root, 'flipped');
  const configured = join(root, 'configured');
  const updated = join(root, 'updated');
  const ssh = executable(shims, 'ssh', `#!/usr/bin/env bash
printf 'SSH %s\\n' "$*" >> "$MOCK_LOG"
if [[ "$*" == *"apt-get update -qq"* ]]; then
  : > "$MOCK_UPDATED"
fi
if [[ "$*" == *"apt-get install --yes"* ]]; then
  if [[ ! -f "$MOCK_UPDATED" ]]; then
    printf 'E: stale package indexes; refresh apt lists before installing\\n' >&2
    exit 100
  fi
  : > "$MOCK_CONFIGURED"
fi
case "$*" in
  *"echo VM-OK"*) printf 'VM-OK\\n' ;;
  *"operator.json"*) printf '{"port":15747}\\n' ;;
  *"api/health"*)
    if [[ -f "$MOCK_FLIPPED" ]]; then
      printf '{"sha":"${TARGET_SHA}","version":"${VERSION}"}\\n'
    else
      printf '{"sha":"old-sha","version":"0.0.17"}\\n'
    fi
    ;;
  *"dpkg-query -W"*)
    if [[ -f "$MOCK_CONFIGURED" ]]; then
      printf 'install ok installed\\n'
    else
      printf 'install ok unpacked\\n'
    fi
    ;;
  *"dpkg-deb -f"*) printf 'papercusp-gui\\n' ;;
  *"dpkg -i"*)
    printf 'dpkg: dependency problems: libwebkit2gtk-4.1-0 is not installed\\n' >&2
    exit 1
    ;;
  *"relaunch-fails"*)
    printf 'error while loading shared libraries: libwebkit2gtk-4.1.so.0\\n' >&2
    exit 1
    ;;
  *"setsid bash -c"*)
    if [[ -f "$MOCK_CONFIGURED" ]]; then
      : > "$MOCK_FLIPPED"
    else
      printf 'error while loading shared libraries: libwebkit2gtk-4.1.so.0\\n' >&2
      exit 1
    fi
    ;;
esac
`);
  const scp = executable(shims, 'scp', `#!/usr/bin/env bash
printf 'SCP %s\\n' "$*" >> "$MOCK_LOG"
`);

  return { root, deb, log, flipped, configured, updated, ssh, scp };
}

function runVerify(f, extraArgs = [], platform = 'windows', artifact = f.gui) {
  const env = {
    ...process.env,
    HOME: f.root,
    PC_SSH: f.ssh,
    PC_SCP: f.scp,
    MOCK_LOG: f.log,
    MOCK_FLIPPED: f.flipped,
  };
  if (f.configured) env.MOCK_CONFIGURED = f.configured;
  if (f.updated) env.MOCK_UPDATED = f.updated;
  if (f.requireHostKeyOptions) env.MOCK_REQUIRE_HOST_KEY_OPTIONS = '1';
  return spawnSync('bash', [
    SCRIPT,
    '--platform', platform,
    '--artifact', artifact,
    '--expected-sha', TARGET_SHA,
    '--expected-version', VERSION,
    '--install-timeout', '2',
    '--flip-timeout', '2',
    '--poll-interval', '0',
    '--json',
    ...extraArgs,
  ], {
    encoding: 'utf8',
    env,
  });
}

test('Windows auto-resolves, pushes, and installs the complete Server span before relaunch', () => {
  const f = fixture();
  try {
    const result = runVerify(f);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.flipped, true);
    assert.equal(verdict.portHeld, true);
    assert.equal(verdict.serverArtifact, f.server);
    assert.equal(verdict.serverCompanionCount, 2);

    const lines = readFileSync(f.log, 'utf8').trim().split('\n');
    for (const file of [f.gui, f.server, ...f.slices]) {
      assert.ok(lines.some((line) => line.startsWith('SCP ') && line.includes(file)), `missing push for ${file}`);
    }
    const guiInstall = lines.findIndex((line) => line.startsWith('SSH ') && line.includes(`Papercusp GUI_${VERSION}_x64-setup.exe`) && line.includes('/VERYSILENT'));
    const serverInstall = lines.findIndex((line) => line.startsWith('SSH ') && line.includes(`Papercusp Server_${VERSION}_x64-setup.exe`) && line.includes('/VERYSILENT'));
    const relaunch = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('schtasks /run /tn papercusp-e2e'));
    assert.ok(guiInstall >= 0, 'GUI installer was not invoked');
    assert.ok(serverInstall > guiInstall, 'Server must install after GUI');
    assert.ok(relaunch > serverInstall, 'neither app may relaunch before matching Server install finishes');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Windows refuses a provenance-listed Server span when any disk is absent', () => {
  const f = fixture();
  try {
    unlinkSync(f.slices[1]);
    const result = runVerify(f);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /provenance-listed Server artifact missing/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('diagnoses a rotated host key instead of reporting only vm unreachable', () => {
  const f = fixture({ requireHostKeyOptions: true });
  try {
    const result = runVerify(f);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /host-key verification failed/);
    assert.doesNotMatch(result.stderr, /cannot establish the pre-update baseline/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('accepts explicit SSH and SCP host-key options for a reset VM', () => {
  const f = fixture({ requireHostKeyOptions: true });
  try {
    const result = runVerify(f, [
      '--ssh-option', 'StrictHostKeyChecking=no',
      '--ssh-option', 'UserKnownHostsFile=/dev/null',
      '--scp-option', 'StrictHostKeyChecking=no',
      '--scp-option', 'UserKnownHostsFile=/dev/null',
    ]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const lines = readFileSync(f.log, 'utf8').trim().split('\n');
    assert.ok(lines.some((line) => line.startsWith('SSH ') && line.includes('StrictHostKeyChecking=no') && line.includes('UserKnownHostsFile=/dev/null')));
    assert.ok(lines.some((line) => line.startsWith('SCP ') && line.includes('StrictHostKeyChecking=no') && line.includes('UserKnownHostsFile=/dev/null')));
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('an explicit Server installer must attest the same build sha as the GUI', () => {
  const f = fixture();
  try {
    const other = join(f.root, 'other-build');
    mkdirSync(other);
    const otherServer = join(other, basename(f.server));
    writeFileSync(otherServer, 'server');
    for (const slice of f.slices) writeFileSync(join(other, basename(slice)), 'slice');
    writeProvenance(other, 'different-build-sha');

    const result = runVerify(f, ['--server-artifact', otherServer]);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /server artifact buildSha mismatch/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Linux resolves missing WebKit dependencies before relaunching the installed deb', () => {
  const f = linuxFixture();
  try {
    const result = runVerify(f, [], 'linux', f.deb);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.flipped, true);
    assert.equal(verdict.portHeld, true);

    const lines = readFileSync(f.log, 'utf8').trim().split('\n');
    const update = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('apt-get update -qq'));
    const install = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('apt-get install --yes'));
    const packageCheck = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('dpkg-query -W'));
    const relaunch = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('setsid bash -c'));
    assert.ok(update >= 0, 'Linux must refresh apt indexes before installing a local deb');
    assert.ok(update < install, 'Linux must refresh apt indexes before dependency resolution');
    assert.ok(install >= 0, 'Linux must use apt-get local-file installation, not dpkg -i');
    assert.equal(lines.some((line) => line.includes('dpkg -i')), false, 'Linux default must not use dependency-blind dpkg -i');
    assert.ok(packageCheck > install, 'package configuration must be checked after installation');
    assert.ok(relaunch > packageCheck, 'Linux must not relaunch before package configuration is confirmed');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Linux blocks relaunch when dpkg reports the WebKit dependency is missing', () => {
  const f = linuxFixture();
  try {
    const result = runVerify(f, ['--install-cmd', 'sudo dpkg -i __ARTIFACT__'], 'linux', f.deb);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join('\n'), /GUI install failed/);
    assert.match(verdict.failures.join('\n'), /libwebkit2gtk-4\.1-0/);
    const lines = readFileSync(f.log, 'utf8').trim().split('\n');
    assert.equal(lines.some((line) => line.includes('setsid bash -c')), false, 'a failed install must block relaunch');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Linux includes relaunch stderr in a failed verdict', () => {
  const f = linuxFixture();
  try {
    const result = runVerify(f, ['--relaunch-cmd', 'relaunch-fails'], 'linux', f.deb);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join('\n'), /relaunch command failed/);
    assert.match(verdict.failures.join('\n'), /libwebkit2gtk-4\.1\.so\.0/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

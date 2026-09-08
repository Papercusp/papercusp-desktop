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
const { createHash } = require('node:crypto');
const {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, join } = require('node:path');
const { test } = require('node:test');

const SCRIPT = join(__dirname, '..', 'bin', 'install-and-relaunch-verify.sh');
const TARGET_SHA = '2363b77a68dee8d79528a4a6a94321cc324ed2f7';
const VERSION = '0.0.18';
const SMOKE_TAG = `desktop-v${VERSION}-alpha`;

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
    artifacts: names.filter((name) => existsSync(join(dir, name))).map((name) => {
      const file = join(dir, name);
      return {
        name,
        bytes: statSync(file).size,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      };
    }),
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
  *"schtasks /run /tn papercusp-e2e"*)
    if [[ "$*" != *"cmd /c"* ]]; then
      printf 'Input redirection is not supported: relaunch must use cmd /c\\n' >&2
      exit 1
    fi
    : > "$MOCK_FLIPPED"
    ;;
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

function linuxFixture({ emitDpkgWarning = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'install-relaunch-linux-'));
  const artifacts = join(root, 'artifacts');
  const shims = join(root, 'shims');
  mkdirSync(artifacts);
  mkdirSync(shims);

  const deb = join(artifacts, `papercusp-gui_${VERSION}_amd64.deb`);
  const server = join(artifacts, `Papercusp Server_${VERSION}_amd64.deb`);
  writeFileSync(deb, 'pristine ubuntu deb fixture');
  writeFileSync(server, 'pristine ubuntu server deb fixture');
  writeFileSync(join(artifacts, 'build-provenance.json'), JSON.stringify({
    version: VERSION,
    buildSha: TARGET_SHA,
    artifacts: [deb, server].map((file) => ({
      name: basename(file),
      bytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    })),
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
    if [[ "$MOCK_EMIT_DPKG_WARNING" == "1" ]]; then
      printf 'Warning: Permanently added 127.0.0.1 (ED25519) to the list of known hosts.\\n' >&2
    fi
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

  return { root, deb, server, log, flipped, configured, updated, ssh, scp, emitDpkgWarning };
}

function macFixture({ executeInstall = false, freeGb = 20, nativePreflight = 'healthy', installedMismatch = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'install-relaunch-mac-'));
  const artifacts = join(root, 'artifacts');
  const shims = join(root, 'shims');
  mkdirSync(artifacts);
  mkdirSync(shims);

  const dmg = join(artifacts, `Papercusp GUI_${VERSION}_universal-apple-darwin.dmg`);
  const server = join(artifacts, `Papercusp Server_${VERSION}_universal-apple-darwin.dmg`);
  writeFileSync(dmg, 'signed macOS GUI dmg fixture');
  writeFileSync(server, 'signed macOS Server dmg fixture');
  writeFileSync(join(artifacts, 'build-provenance.json'), JSON.stringify({
    version: VERSION,
    buildSha: TARGET_SHA,
    artifacts: [dmg, server].map((file) => ({
      name: basename(file),
      bytes: statSync(file).size,
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    })),
  }));

  const log = join(root, 'transport.log');
  const flipped = join(root, 'flipped');
  const applications = join(root, 'Applications');
  mkdirSync(applications);
  for (const product of ['Papercusp GUI', 'Papercusp Server']) {
    mkdirSync(join(applications, `${product}.app`));
    writeFileSync(join(applications, `${product}.app`, 'payload'), 'known-good');
    mkdirSync(join(applications, `${product}.app.rollback`));
    writeFileSync(join(applications, `${product}.app.rollback`, 'payload'), 'retained-rollback');
  }
  executable(shims, 'hdiutil', `#!/usr/bin/env bash
if [[ "$1" == attach ]]; then
  while [[ "$1" != -mountpoint ]]; do shift; done
  mount_dir="$2"
  for product in 'Papercusp GUI' 'Papercusp Server'; do
    mkdir -p "$mount_dir/$product.app"
    printf 'new-build' > "$mount_dir/$product.app/payload"
  done
elif [[ "$1" == detach ]]; then
  rm -rf "$2"
fi
`);
  executable(shims, 'du', `#!/usr/bin/env bash
# Expanded app is just over 2 GiB; admission must round UP to 3 GiB.
printf '2097153\\t%s\\n' "\${@: -1}"
`);
  executable(shims, 'df', `#!/usr/bin/env bash
printf 'DF %s\\n' "\${@: -1}" >> "$MOCK_LOG"
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n'
printf 'fixture 104857600 0 %s 0%% /fixture-app-volume\\n' "$((MOCK_FREE_GB * 1024 * 1024))"
`);
  executable(shims, 'ditto', `#!/usr/bin/env bash
reserved=0
for claim in "$PAPERCUSP_DISK_RESERVATION_DIR"/*/*.res; do
  [[ -f "$claim" ]] && grep -q '^gb=3$' "$claim" && reserved=1
done
[[ "$reserved" == 1 ]] || { printf 'copy had no disk reservation\\n' >&2; exit 99; }
printf 'COPY %s\\n' "\${@: -1}" >> "$MOCK_LOG"
cp -R "\${@: -2:1}" "\${@: -1}"
`);
  for (const name of ['xattr', 'codesign']) executable(shims, name, '#!/usr/bin/env bash\nexit 0\n');
  const ssh = executable(shims, 'ssh', `#!/usr/bin/env bash
printf 'SSH %s\\n' "$*" >> "$MOCK_LOG"
case "$*" in
  *"echo VM-OK"*) printf 'VM-OK\\n' ;;
  *"PAPERCUSP_NATIVE_MAC_PREFLIGHT"*)
    case "$MOCK_NATIVE_PREFLIGHT" in
      no-console) printf 'macOS native preflight: SSH user must own the logged-in GUI console\\n' >&2; exit 2 ;;
      no-domain) printf 'macOS native preflight: logged-in GUI launch domain is unavailable\\n' >&2; exit 2 ;;
      competing-supervisor) printf 'macOS native preflight: competing system/com.papercusp.server is loaded\\n' >&2; exit 2 ;;
      native-shell) printf 'macOS native preflight: native shell holds the single-instance lock\\n' >&2; exit 2 ;;
      empty) exit 0 ;;
      *) printf 'PAPERCUSP_NATIVE_MAC_PREFLIGHT_OK\\n' ;;
    esac
    ;;
  *"operator.json"*) printf '{"port":3070}\\n' ;;
  *"api/health"*)
    if [[ -f "$MOCK_FLIPPED" ]]; then
      printf '{"sha":"${TARGET_SHA}","version":"${VERSION}"}\\n'
    else
      printf '{"sha":null,"version":"0.0.0"}\\n'
    fi
    ;;
  *"PAPERCUSP_VERIFY_INSTALLED_MAC"*)
    if [[ "$MOCK_INSTALLED_MISMATCH" == 1 ]]; then
      echo 'installed macOS bundle differs from the supplied DMG' >&2
      exit 2
    fi
    printf 'PAPERCUSP_VERIFY_INSTALLED_MAC_OK\\n'
    ;;
  *"codesign --verify --deep --strict"*)
    if [[ "$*" != *"ditto --noextattr --noqtn"* || "$*" != *"xattr -cr"* ]]; then
      printf 'resource fork, Finder information, or similar detritus not allowed\\n' >&2
      exit 1
    fi
    if [[ "$MOCK_EXECUTE_INSTALL" == 1 ]]; then
      command="\${@: -1}"
      app_root=/Applications
      mount_prefix=/tmp/papercusp-dmg
      command="\${command//"$app_root"/$MOCK_APPLICATIONS}"
      command="\${command//"$mount_prefix"/$MOCK_ROOT/papercusp-dmg}"
      bash -c "$command"
      exit $?
    fi
    ;;
  *"open -n"*"Papercusp GUI.app"*) : > "$MOCK_FLIPPED" ;;
esac
`);
  const scp = executable(shims, 'scp', `#!/usr/bin/env bash
printf 'SCP %s\\n' "$*" >> "$MOCK_LOG"
`);

  return { root, dmg, server, log, flipped, ssh, scp, shims, applications, executeInstall, freeGb, nativePreflight, installedMismatch };
}

function runVerify(f, extraArgs = [], platform = 'windows', artifact = f.gui) {
  const env = {
    ...process.env,
    HOME: f.root,
    PC_SSH: f.ssh,
    PC_SCP: f.scp,
    MOCK_LOG: f.log,
    MOCK_FLIPPED: f.flipped,
    PAPERCUSP_SMOKE_RECEIPT_ROOT: f.root,
  };
  if (f.configured) env.MOCK_CONFIGURED = f.configured;
  if (f.updated) env.MOCK_UPDATED = f.updated;
  if (f.emitDpkgWarning) env.MOCK_EMIT_DPKG_WARNING = '1';
  if (f.requireHostKeyOptions) env.MOCK_REQUIRE_HOST_KEY_OPTIONS = '1';
  if (f.nativePreflight) env.MOCK_NATIVE_PREFLIGHT = f.nativePreflight;
  if (f.installedMismatch) env.MOCK_INSTALLED_MISMATCH = '1';
  if (f.executeInstall) {
    env.PATH = `${f.shims}:${process.env.PATH}`;
    env.MOCK_EXECUTE_INSTALL = '1';
    env.MOCK_APPLICATIONS = f.applications;
    env.MOCK_ROOT = f.root;
    env.MOCK_FREE_GB = String(f.freeGb);
    env.PAPERCUSP_DISK_RESERVATION_DIR = join(f.root, 'reservations');
  }
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
    assert.match(lines[relaunch], /cmd \/c .*schtasks \/run \/tn papercusp-e2e.*schtasks \/run \/tn papercusp-server-e2e/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a passing installed update writes a tag-scoped receipt bound to provenance bytes', () => {
  const f = fixture();
  try {
    const result = runVerify(f, ['--smoke-receipt-tag', SMOKE_TAG]);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    const receiptPath = join(f.root, `papercusp-smoke-${SMOKE_TAG}-windows.json`);
    assert.equal(verdict.smokeReceipt, receiptPath);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.result, 'pass');
    assert.equal(receipt.tag, SMOKE_TAG);
    assert.equal(receipt.platform, 'windows');
    assert.equal(receipt.buildSha, TARGET_SHA);
    assert.deepEqual(
      receipt.artifacts.map((artifact) => artifact.name).sort(),
      [basename(f.gui), basename(f.server), ...f.slices.map((file) => basename(file))].sort(),
    );
    assert.ok(receipt.exercisedArtifacts.some((artifact) => artifact.name === basename(f.gui)));
    assert.ok(receipt.exercisedArtifacts.some((artifact) => artifact.name === basename(f.server)));
    assert.equal(
      existsSync(join(f.root, 'artifacts', `platform-smoke-${SMOKE_TAG}-windows.json`)),
      true,
      'the auditable copy must live beside build-provenance.json',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('a failed update never writes a smoke receipt', () => {
  const f = fixture();
  try {
    const result = runVerify(f, [
      '--relaunch-cmd', 'exit 17',
      '--smoke-receipt-tag', SMOKE_TAG,
    ]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(
      existsSync(join(f.root, `papercusp-smoke-${SMOKE_TAG}-windows.json`)),
      false,
    );
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
    assert.ok(lines.some((line) => line.startsWith('SCP ') && line.includes(f.server)), 'Linux Server deb must be pushed');
    const update = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('apt-get update -qq'));
    const install = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('apt-get install --yes') && line.includes(basename(f.deb)));
    const serverInstall = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('apt-get install --yes') && line.includes(basename(f.server)));
    const packageCheck = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('dpkg-query -W'));
    const relaunch = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('setsid bash -c'));
    assert.ok(update >= 0, 'Linux must refresh apt indexes before installing a local deb');
    const installLine = lines[install] || '';
    assert.ok(
      update < install
        || (update === install
          && installLine.indexOf('apt-get update -qq') < installLine.indexOf('apt-get install --yes')),
      'Linux must refresh apt indexes before dependency resolution',
    );
    assert.ok(install >= 0, 'Linux must use apt-get local-file installation, not dpkg -i');
    assert.ok(serverInstall > install, 'Linux must install the matching Server after the GUI');
    assert.equal(lines.some((line) => line.includes('dpkg -i')), false, 'Linux default must not use dependency-blind dpkg -i');
    assert.ok(packageCheck > serverInstall, 'package configuration must be checked after both installations');
    assert.ok(relaunch > packageCheck, 'Linux must not relaunch before package configuration is confirmed');
    assert.ok(lines[relaunch].includes('papercusp-server.service'), 'Linux must restart the Server-owned runtime before the GUI');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('macOS native preflight executes console/domain/supervisor/single-instance predicates', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const command = source.match(/cat <<'MAC_PREFLIGHT'\n([\s\S]*?)\nMAC_PREFLIGHT\n/);
  assert.ok(command, 'the real remote preflight command must be discoverable');
  const root = mkdtempSync(join(tmpdir(), 'native-mac-preflight-'));
  try {
    executable(root, 'stat', '#!/bin/sh\nprintf "%s\\n" "$TEST_CONSOLE"\n');
    executable(root, 'id', '#!/bin/sh\ncase "$1" in -un) echo fixture ;; -u) echo 501 ;; *) exit 99 ;; esac\n');
    executable(root, 'ps', '#!/bin/sh\n[ "$TEST_PS_FAIL" != 1 ] || exit 1\nprintf "%s\\n" "$TEST_NATIVE_PROCESS"\n');
    executable(root, 'launchctl', `#!/bin/sh
case "$*" in
  "print gui/501") [ "$TEST_DOMAIN" = available ] ;;
  "print system/com.papercusp.server") [ "$TEST_SUPERVISOR" = loaded ] ;;
  *) exit 99 ;;
esac
`);
    for (const [consoleUser, domain, supervisor, nativeProcess, psFail, expected] of [
      ['fixture', 'available', 'absent', '/usr/bin/other', '', 0],
      ['root', 'available', 'absent', '', '', 2],
      ['loginwindow', 'available', 'absent', '', '', 2],
      ['other-user', 'available', 'absent', '', '', 2],
      ['fixture', 'absent', 'absent', '', '', 2],
      ['fixture', 'available', 'loaded', '', '', 2],
      ['fixture', 'available', 'absent', '/Applications/Papercusp Server.app/Contents/MacOS/papercusp-desktop', '', 2],
      ['fixture', 'available', 'absent', '/Applications/Papercusp Server.app.pre-old/Contents/MacOS/papercusp-desktop', '', 2],
      ['fixture', 'available', 'absent', '/Applications/Papercusp Server.app.pre-old/Contents/MacOS/papercusp-desktop --headless-service', '', 0],
      ['fixture', 'available', 'absent', '/Applications/Papercusp Server.app.pre-old/Contents/MacOS/papercusp-desktop --headless-service-other', '', 2],
      ['fixture', 'available', 'absent', '/Applications/Papercusp GUI.app/Contents/MacOS/papercusp-desktop', '', 2],
      ['fixture', 'available', 'absent', '/Applications/Papercusp Server.app.pre-old/Contents/Resources/sidecar/bin/node', '', 0],
      ['fixture', 'available', 'absent', '', '1', 2],
    ]) {
      const result = spawnSync('bash', ['-c', command[1]], {
        encoding: 'utf8',
        env: {
          ...process.env, PATH: `${root}:${process.env.PATH}`,
          TEST_CONSOLE: consoleUser, TEST_DOMAIN: domain, TEST_SUPERVISOR: supervisor,
          TEST_NATIVE_PROCESS: nativeProcess, TEST_PS_FAIL: psFail,
        },
      });
      assert.equal(result.status, expected, `${consoleUser}/${domain}/${supervisor}: ${result.stderr}`);
      if (expected === 0) assert.match(result.stdout, /^PAPERCUSP_NATIVE_MAC_PREFLIGHT_OK$/m);
      else assert.doesNotMatch(result.stdout, /PAPERCUSP_NATIVE_MAC_PREFLIGHT_OK/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('installed-DMG resume compares real file content, inventory, permissions and symlink targets', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  const command = source.match(/cat <<'VERIFY_INSTALLED'\n([\s\S]*?)\nVERIFY_INSTALLED\n/);
  assert.ok(command, 'exercise the actual remote comparison body');
  const root = mkdtempSync(join(tmpdir(), 'native-mac-installed-tree-'));
  try {
    const shims = join(root, 'shims');
    mkdirSync(shims);
    executable(shims, 'codesign', '#!/bin/sh\nexit 0\n');
    const app = join(root, 'source');
    mkdirSync(app);
    writeFileSync(join(app, 'payload'), 'same-size-content-A');
    chmodSync(join(app, 'payload'), 0o755);
    symlinkSync('payload', join(app, 'link'));
    for (const mutation of ['none', 'content', 'missing', 'extra', 'permissions', 'symlink']) {
      const target = join(root, mutation);
      cpSync(app, target, { recursive: true, verbatimSymlinks: true });
      if (mutation === 'content') writeFileSync(join(target, 'payload'), 'same-size-content-B');
      if (mutation === 'missing') unlinkSync(join(target, 'payload'));
      if (mutation === 'extra') writeFileSync(join(target, 'extra'), 'unexpected');
      if (mutation === 'permissions') chmodSync(join(target, 'payload'), 0o644);
      if (mutation === 'symlink') {
        unlinkSync(join(target, 'link'));
        symlinkSync('elsewhere', join(target, 'link'));
      }
      const result = spawnSync('bash', ['-euc', command[1]], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${shims}:${process.env.PATH}`, app_src: app, target },
      });
      assert.equal(result.status, mutation === 'none' ? 0 : 2, `${mutation}: ${result.stderr}`);
      if (mutation !== 'none') assert.match(result.stderr, /differs from the supplied DMG/);
      assert.equal(readFileSync(join(app, 'payload'), 'utf8'), 'same-size-content-A');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const installedMismatch of [false, true]) {
  test(`macOS installed-DMG resume ${installedMismatch ? 'rejects changed bytes' : 'attests both roles without copying'}`, () => {
    const f = macFixture({ installedMismatch });
    try {
      const result = runVerify(f, ['--verify-installed-mac'], 'mac', f.dmg);
      assert.equal(result.status, installedMismatch ? 1 : 0, result.stdout + result.stderr);
      const verdict = JSON.parse(result.stdout);
      assert.equal(verdict.installationMode, 'verify-existing-dmg');
      const log = readFileSync(f.log, 'utf8');
      assert.match(log, /PAPERCUSP_VERIFY_INSTALLED_MAC/);
      assert.doesNotMatch(log, /ditto --noextattr|rm -rf/);
      assert.equal(existsSync(f.flipped), !installedMismatch);
      if (!installedMismatch) assert.match(verdict.notes.join(' '), /both installed apps match/);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

for (const nativePreflight of ['no-console', 'no-domain', 'competing-supervisor', 'native-shell', 'empty']) {
  test(`macOS refuses ${nativePreflight} before reading baseline or changing installed apps`, () => {
    const f = macFixture({ nativePreflight });
    try {
      const result = runVerify(f, [], 'mac', f.dmg);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /macOS native preflight failed/);
      const log = readFileSync(f.log, 'utf8');
      assert.match(log, /PAPERCUSP_NATIVE_MAC_PREFLIGHT/);
      assert.doesNotMatch(log, /^SCP /m);
      // Multiline SSH payloads include comments describing commands that must
      // NOT run. Assert dispatched command headers, not words in that prose.
      const calls = log.split('\n').filter((line) => line.startsWith('SSH '));
      for (const call of calls) assert.doesNotMatch(call, /operator\.json|codesign --verify|open -n/);
      assert.equal(existsSync(f.flipped), false);
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
}

test('macOS DMG install verifies matching GUI and Server apps before split-role relaunch', () => {
  const f = macFixture();
  try {
    const result = runVerify(f, [], 'mac', f.dmg);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.flipped, true);
    assert.equal(verdict.portHeld, true);

    const lines = readFileSync(f.log, 'utf8').trim().split('\n');
    const guiPush = lines.findIndex((line) => line.startsWith('SCP ') && line.includes(f.dmg));
    const serverPush = lines.findIndex((line) => line.startsWith('SCP ') && line.includes(f.server));
    const install = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('hdiutil attach') && line.includes(basename(f.dmg)));
    const serverInstall = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('hdiutil attach') && line.includes(basename(f.server)));
    const relaunch = lines.findIndex((line) => line.startsWith('SSH ') && line.includes('open -n') && line.includes('Papercusp GUI.app'));
    assert.ok(guiPush >= 0, 'macOS GUI DMG must be pushed');
    assert.ok(serverPush > guiPush, 'matching macOS Server DMG must be pushed after the GUI DMG');
    assert.ok(install >= 0, 'macOS DMG must use the guarded mount/copy install path');
    assert.ok(serverInstall > install, 'matching Server must install after the GUI');
    assert.ok(relaunch > serverInstall, 'macOS must not relaunch before both staged apps verify');

    const command = lines[install];
    assert.ok(command.includes('ditto --noextattr --noqtn'), 'DMG copy must suppress extended attributes and quarantine');
    assert.ok(command.includes('xattr -cr'), 'staged app must clear any residual extended attributes');
    const codesign = command.indexOf('codesign --verify --deep --strict');
    const replace = command.indexOf('rm -rf "$target"');
    assert.ok(codesign >= 0, 'staged app must pass strict codesign verification');
    assert.ok(replace > codesign, 'the known-good installed app must not be replaced before strict codesign passes');

    const serverCommand = lines[serverInstall];
    assert.ok(serverCommand.includes('ditto --noextattr --noqtn'));
    assert.ok(serverCommand.includes('codesign --verify --deep --strict'));
    assert.ok(serverCommand.includes('Papercusp Server.app'));
    const relaunchCommand = lines[relaunch];
    assert.ok(
      relaunchCommand.indexOf('Papercusp Server.app') < relaunchCommand.indexOf('Papercusp GUI.app'),
      'new Server must launch first so its serve --ensure owns the identity flip',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('macOS refuses low-space staging before copy and preserves installed and rollback apps', () => {
  const f = macFixture({ executeInstall: true, freeGb: 2 });
  try {
    const result = runVerify(f, [], 'mac', f.dmg);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /insufficient disk/);
    assert.match(result.stdout, /need ~3GB/);
    const log = readFileSync(f.log, 'utf8');
    assert.doesNotMatch(log, /^COPY /m);
    assert.equal(existsSync(f.flipped), false);
    for (const product of ['Papercusp GUI', 'Papercusp Server']) {
      assert.equal(readFileSync(join(f.applications, `${product}.app`, 'payload'), 'utf8'), 'known-good');
      assert.equal(readFileSync(join(f.applications, `${product}.app.rollback`, 'payload'), 'utf8'), 'retained-rollback');
    }
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('macOS reserves the expanded app on its destination filesystem before each role copy', () => {
  const f = macFixture({ executeInstall: true, freeGb: 3 });
  try {
    const result = runVerify(f, [], 'mac', f.dmg);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const log = readFileSync(f.log, 'utf8');
    assert.ok(log.includes(`DF ${f.applications}\n`));
    for (const product of ['Papercusp GUI', 'Papercusp Server']) {
      assert.equal(readFileSync(join(f.applications, `${product}.app`, 'payload'), 'utf8'), 'new-build');
      assert.equal(readFileSync(join(f.applications, `${product}.app.rollback`, 'payload'), 'utf8'), 'retained-rollback');
    }
    assert.equal(existsSync(f.flipped), true);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('macOS refuses a GUI-only transition when the matching Server DMG is absent', () => {
  const f = macFixture();
  try {
    unlinkSync(f.server);
    const result = runVerify(f, [], 'mac', f.dmg);
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /need --server-artifact/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('Linux ignores SSH diagnostics when checking exact dpkg status', () => {
  const f = linuxFixture({ emitDpkgWarning: true });
  try {
    const result = runVerify(f, [], 'linux', f.deb);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const verdict = JSON.parse(result.stdout);
    assert.equal(verdict.ok, true);
    assert.equal(verdict.flipped, true);
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

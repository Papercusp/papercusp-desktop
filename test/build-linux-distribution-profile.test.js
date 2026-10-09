const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const linuxScript = fs.readFileSync(path.join(root, 'bin/build-linux-local.sh'), 'utf8');
const hetznerFederationScript = fs.readFileSync(
  path.join(root, 'bin/deb-hetzner-federation.sh'),
  'utf8',
);
const hetznerRigScript = fs.readFileSync(path.join(root, 'bin/lib/deb-hetzner-rig.sh'), 'utf8');
const vmConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'src-tauri/tauri.vm-release.conf.json'), 'utf8'),
);

test('Linux self-snapshot keeps current helpers while selecting a frozen product root', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-source-seam-'));
  try {
    const tooling = path.join(fixture, 'tooling');
    const product = path.join(fixture, 'product');
    for (const dir of [tooling, product]) fs.mkdirSync(path.join(dir, 'bin/lib'), { recursive: true });
    const entry = path.join(tooling, 'bin/build-linux-local.sh');
    fs.writeFileSync(entry, linuxScript);
    fs.writeFileSync(path.join(tooling, 'bin/lib/distribution-profile.sh'), 'printf "tooling=%s\\nproduct=%s\\n" "$HERE" "$ROOT"\nexit 0\n');
    fs.writeFileSync(path.join(product, 'bin/lib/distribution-profile.sh'), 'echo wrong-frozen-helper\nexit 71\n');
    for (const target of ['', product]) {
      const result = spawnSync('bash', [entry], { encoding: 'utf8', env: { ...process.env,
        PAPERCUSP_BUILD_LINUX_SELF_SNAPSHOT: '', PAPERCUSP_BUILD_LINUX_ROOT: '',
        PAPERCUSP_DESKTOP_TARGET_ROOT: target,
      } });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(result.stdout, `tooling=${tooling}/bin\nproduct=${target || tooling}\n`);
    }
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('Linux help and invalid arguments exit before snapshot or build side effects', { skip: process.platform !== 'linux' }, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-linux-cli-help-'));
  try {
    const fakeBin = path.join(fixture, 'bin');
    fs.mkdirSync(fakeBin);
    const sedSource = process.env.PATH.split(path.delimiter)
      .map((dir) => path.join(dir, 'sed'))
      .find((candidate) => {
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          return fs.statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
    assert.ok(sedSource, 'the help printer needs a read-only sed executable');
    fs.symlinkSync(sedSource, path.join(fakeBin, 'sed'));

    const env = {
      ...process.env,
      PATH: fakeBin,
      PAPERCUSP_BUILD_LINUX_SELF_SNAPSHOT: '',
      PAPERCUSP_BUILD_LINUX_ROOT: '',
      PAPERCUSP_DESKTOP_TARGET_ROOT: '',
    };
    const run = (args) => spawnSync('/bin/bash', [path.join(root, 'bin/build-linux-local.sh'), ...args], {
      encoding: 'utf8',
      env,
    });

    for (const flag of ['-h', '--help']) {
      const result = run([flag]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.match(result.stdout, /--finalize-deb/);
      assert.match(result.stdout, /Env passthrough/);
    }

    const unknown = run(['--not-a-build-option']);
    assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
    assert.match(unknown.stderr, /unknown argument: --not-a-build-option/);

    const malformedFinalize = run(['--finalize-deb']);
    assert.equal(malformedFinalize.status, 2, malformedFinalize.stdout + malformedFinalize.stderr);
    assert.match(malformedFinalize.stderr, /--finalize-deb requires/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Linux reuse qualification runs the maintained tooling verifier and audit', () => {
  const reuse = linuxScript.slice(linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'), linuxScript.indexOf('echo "==> [4/5]'));
  assert.match(reuse, /bash "\$HERE\/verify-provenance.sh"/);
  assert.match(reuse, /bash "\$HERE\/verify-sidecar-bundle.sh"/);
  assert.match(reuse, /python3 "\$HERE\/audit-release-bundle.py"/);
  assert.doesNotMatch(reuse, /\$ROOT\/bin\//);
});

test('current Debian repacker invokes Tauri from the frozen product directory', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-repacker-source-seam-'));
  try {
    const tooling = path.join(fixture, 'tooling');
    const product = path.join(fixture, 'product');
    const fakeBin = path.join(fixture, 'fake-bin');
    const receipt = path.join(fixture, 'cwd.txt');
    fs.mkdirSync(path.join(tooling, 'bin'), { recursive: true });
    fs.mkdirSync(product);
    fs.mkdirSync(fakeBin);
    const entry = path.join(tooling, 'bin/build-deb-repacked.sh');
    fs.copyFileSync(path.join(root, 'bin/build-deb-repacked.sh'), entry);
    fs.writeFileSync(path.join(fakeBin, 'cargo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, 'tauri'), '#!/bin/sh\nprintf "%s" "$PWD" > "$PC_TEST_CWD"\nexit 77\n', { mode: 0o755 });
    const result = spawnSync('bash', [entry], { encoding: 'utf8', env: { ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`, PAPERCUSP_DESKTOP_TARGET_ROOT: product,
      TAURI_SIGNING_PRIVATE_KEY: 'fixture-only', PC_TEST_CWD: receipt,
    } });
    assert.equal(result.status, 77, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(receipt, 'utf8'), product);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

const expectedVmResources = [
  'sidecar/apps/**/*',
  'sidecar/bin/**/*',
  'sidecar/build-provenance.json',
  'sidecar/cpu-task-worker.script.mjs',
  'sidecar/db-seed.dump',
  'sidecar/db-sql/**/*',
  'sidecar/event-loop-sentinel.worker.mjs',
  'sidecar/git-ext-bridge.mjs',
  'sidecar/harness/**/*',
  'sidecar/internal-docs/**/*',
  'sidecar/local-embedder-worker.script.mjs',
  'sidecar/local-reranker-worker.script.mjs',
  'sidecar/mcp-proxy.mjs',
  'sidecar/node_modules/**/*',
  'sidecar/opusscript_native_wasm.wasm',
  'sidecar/orchestrator/**/*',
  'sidecar/pui-companion.wasm',
  'sidecar/pui-install.json',
  'sidecar/scripts/**/*',
  'sidecar/serve.mjs',
  'sidecar/sidecar-preload.js',
  'sidecar/spa/**/*',
  'sidecar/sql/**/*',
];

test('Hetzner .deb federation defaults to the Ubuntu 24.04 ABI while retaining an explicit image override', () => {
  assert.match(
    hetznerFederationScript,
    /LOCS="ash,ash"; STYPE="cpx31"; DEB=""; KEEP_UP=0; IMAGE="ubuntu-24\.04"/,
    'the packaged-.deb proof must not fall back to Ubuntu 22.04 (glibc 2.35)',
  );
  assert.match(
    hetznerFederationScript,
    /--image=\*\) IMAGE="\$\{arg#--image=\}" ;;/,
    'deliberate compatibility probes must retain the --image override',
  );
  assert.match(hetznerRigScript, /GLIBC_2\.38[\s\S]*ubuntu-24\.04/);
  assert.match(
    hetznerRigScript,
    /RIG_IMAGE="\$\{2:-\$\{RIG_IMAGE:-ubuntu-24\.04\}\}"/,
    'direct rig consumers need the same ABI-safe fallback as the two-frame driver',
  );
});

// open-source-release-2026-09-29 D-005 / P-019 moved the absent-knob default into
// bin/lib/distribution-profile.sh (`dogfood` unless a public MANIFEST.json says `public`).
// The helper's behaviour — including "no manifest keeps dogfood" — is exercised in
// test/distribution-profile.test.js; here we pin that this entrypoint actually uses it.
const PROFILE_DEFAULT_LINE =
  'DISTRIBUTION_PROFILE="${PAPERCUSP_DISTRIBUTION_PROFILE:-$(default_distribution_profile "$ROOT")}"';

test('dogfood remains the absent-knob default with both roles and developer staging', () => {
  assert.match(linuxScript, /\. "\$HERE\/lib\/distribution-profile\.sh"/);
  assert.ok(
    linuxScript.includes(PROFILE_DEFAULT_LINE),
    'the absent knob must resolve through default_distribution_profile (dogfood in the private tree)',
  );
  assert.match(linuxScript, /dogfood\|public\)\n\s+ROLES="\$\{PAPERCUSP_BUILD_ROLES:-gui server\}"/);

  const freshSidecar = linuxScript.slice(
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
    linuxScript.indexOf('# Never clobber a caller-supplied key'),
  );
  assert.match(freshSidecar, /DISTRIBUTION_PROFILE" == "dogfood"/);
  assert.match(freshSidecar, /bash "\$HERE\/stage-env-sidecars\.sh"/);
  assert.match(freshSidecar, /bash "\$HERE\/stage-source-tree\.sh"/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/env-sidecars\/staging/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/source\.tar\.zst/);
  assert.match(
    linuxScript,
    /else\n\s+role_cfg=\(--config src-tauri\/tauri\.server\.conf\.json\)/,
    'dogfood Server builds must retain the established broad Server overlay',
  );
});

test('vm-release is fail-closed, Server-only and disables source staging', () => {
  const blockStart = linuxScript.indexOf(PROFILE_DEFAULT_LINE);
  // D-112 renamed the section that follows the profile block.
  const blockEnd = linuxScript.indexOf('# ── IDENTITY-POLICY COMPATIBILITY PREFLIGHT');
  // A moved anchor must fail HERE, loudly — a -1 start silently slices to '' and every
  // assertion below then reads as "the block lost its vm-release arm".
  assert.ok(blockStart >= 0 && blockEnd > blockStart, 'profile block anchors not found');
  const profileBlock = linuxScript.slice(blockStart, blockEnd);
  assert.match(profileBlock, /vm-release\)/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES\+x/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES" != "server"/);
  assert.match(profileBlock, /ROLES="server"/);
  assert.match(profileBlock, /export PAPERCUSP_BUILD_ROLES="\$ROLES"/);
  assert.match(profileBlock, /export PAPERCUSP_STAGE_SOURCE=0/);
  assert.match(profileBlock, /must be dogfood, public or vm-release/);

  assert.match(
    linuxScript,
    /role_cfg=\(--config src-tauri\/tauri\.vm-release\.conf\.json\)/,
  );
  assert.match(linuxScript, /vm-release — skipping env-sidecars and editable source staging/);
});

test('the sidecar provenance receives the immutable build SHA and version', () => {
  assert.match(
    linuxScript,
    /PAPERCUSP_BUILD_SHA="\$BUILD_SHA" PAPERCUSP_DESKTOP_VERSION="\$VERSION" \\\n\s+bash "\$HERE\/build-desktop-sidecar\.sh"/,
    'the sidecar provenance emitter must not fall back to empty SHA or unknown version',
  );
});

test('vm-release sidecar reuse rejects provenance that differs from the launcher build SHA', () => {
  const reuseBlock = linuxScript.slice(
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
    linuxScript.indexOf('# Never clobber a caller-supplied key'),
  );
  const verifierAt = reuseBlock.indexOf('verify-provenance.sh');
  const structureAt = reuseBlock.indexOf('verify-sidecar-bundle.sh');

  assert.ok(verifierAt >= 0, 'vm-release reuse must run the maintained provenance verifier');
  assert.ok(
    verifierAt < structureAt,
    'mixed-SHA reuse must fail before the broader sidecar validation and Tauri build',
  );
  assert.match(
    reuseBlock,
    /if \[\[ "\$DISTRIBUTION_PROFILE" == "vm-release" \]\]; then[\s\S]*verify-provenance\.sh" "\$ROOT\/src-tauri\/sidecar" \\\n\s+--health-sha "\$BUILD_SHA" --allow-dirty/,
  );
  assert.match(
    reuseBlock,
    /vm-release sidecar reuse must match build SHA \$BUILD_SHA; rebuild without PAPERCUSP_REUSE_SIDECAR=1/,
  );
});

test('vm-release Tauri overlay is an exact runtime allowlist with Server identity', () => {
  assert.equal(vmConfig.productName, 'Papercusp Server');
  assert.equal(vmConfig.mainBinaryName, 'papercusp-server');
  assert.equal(vmConfig.identifier, 'com.papercusp.server');
  assert.deepEqual(vmConfig.bundle.resources, expectedVmResources);
  assert.deepEqual(vmConfig.bundle.linux.deb.files, {
    '/usr/lib/systemd/user/papercusp-server.service': 'systemd/papercusp-server.service',
  });

  for (const forbidden of [
    'sidecar/**/*',
    'sidecar/source.tar.zst',
    'sidecar/env-sidecars/**/*',
    'resources/*',
    'seed/**/*',
  ]) {
    assert.equal(
      vmConfig.bundle.resources.includes(forbidden),
      false,
      `vm-release must not admit dogfood/dev resource glob ${forbidden}`,
    );
  }
});

test('vm-release collects only one fresh Debian-identified Server artifact', () => {
  const selectionAt = linuxScript.indexOf('vm_release_debs=()');
  const appImageAt = linuxScript.indexOf('if [[ " $ROLES " == *" gui "* ]]');
  const selection = linuxScript.slice(selectionAt, appImageAt);

  assert.match(selection, /VM_RELEASE_FRESHNESS_MARKER/);
  assert.match(selection, /"\$deb" -nt "\$VM_RELEASE_FRESHNESS_MARKER"/);
  assert.match(selection, /dpkg-deb -f "\$deb" Package/);
  assert.match(selection, /== "papercusp-server"/);
  assert.match(selection, /\$\{#vm_release_debs\[@\]\} -eq 1/);
  assert.match(selection, /for deb in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(selection, /assert_vm_release_deb_runtime_only "\$deb"/);

  const collectorAt = linuxScript.indexOf('collected=()');
  const retainedAt = linuxScript.indexOf('papercusp_retain_release_paths');
  const collector = linuxScript.slice(collectorAt, retainedAt);
  assert.match(collector, /DISTRIBUTION_PROFILE" == "vm-release"/);
  assert.match(collector, /for f in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(collector, /for deb in "\$\{vm_release_debs\[@\]\}"/);
  assert.match(collector, /collected\+=\("\$f" "\$f\.sig"\)/);
});

test('finished vm-release deb inspection rejects every dogfood-only payload class', () => {
  const audit = linuxScript.slice(
    linuxScript.indexOf('assert_vm_release_deb_runtime_only()'),
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
  );
  for (const forbidden of [
    '/sidecar/source.tar.zst',
    '/sidecar/env-sidecars',
    '/seed',
    '/resources/',
  ]) {
    assert.match(audit, new RegExp(forbidden.replaceAll('/', '\\/')));
  }
  assert.match(audit, /dpkg-deb --fsys-tarfile/);
  assert.match(audit, /audit-release-bundle\.py" --scan-artifact --licenses "\$deb"/);
});

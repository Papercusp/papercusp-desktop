const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const linuxScript = fs.readFileSync(path.join(root, 'bin/build-linux-local.sh'), 'utf8');
const vmConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'src-tauri/tauri.vm-release.conf.json'), 'utf8'),
);

const expectedVmResources = [
  'sidecar/apps/**/*',
  'sidecar/bin/**/*',
  'sidecar/build-provenance.json',
  'sidecar/cpu-task-worker.script.mjs',
  'sidecar/db-seed.tar.gz',
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
  'sidecar/prompts/**/*',
  'sidecar/pui-companion.wasm',
  'sidecar/rubrics/**/*',
  'sidecar/scripts/**/*',
  'sidecar/serve.mjs',
  'sidecar/sidecar-preload.js',
  'sidecar/spa/**/*',
  'sidecar/sql/**/*',
  'sidecar/templates/**/*',
];

test('dogfood remains the absent-knob default with both roles and developer staging', () => {
  assert.match(
    linuxScript,
    /DISTRIBUTION_PROFILE="\$\{PAPERCUSP_DISTRIBUTION_PROFILE:-dogfood\}"/,
  );
  assert.match(linuxScript, /dogfood\)\n\s+ROLES="\$\{PAPERCUSP_BUILD_ROLES:-gui server\}"/);

  const freshSidecar = linuxScript.slice(
    linuxScript.indexOf('case "${PAPERCUSP_REUSE_SIDECAR:-0}"'),
    linuxScript.indexOf('# Never clobber a caller-supplied key'),
  );
  assert.match(freshSidecar, /DISTRIBUTION_PROFILE" == "dogfood"/);
  assert.match(freshSidecar, /bash "\$ROOT\/bin\/stage-env-sidecars\.sh"/);
  assert.match(freshSidecar, /bash "\$ROOT\/bin\/stage-source-tree\.sh"/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/env-sidecars\/staging/);
  assert.match(freshSidecar, /src-tauri\/sidecar\/source\.tar\.zst/);
  assert.match(
    linuxScript,
    /else\n\s+role_cfg=\(--config src-tauri\/tauri\.server\.conf\.json\)/,
    'dogfood Server builds must retain the established broad Server overlay',
  );
});

test('vm-release is fail-closed, Server-only and disables source staging', () => {
  const profileBlock = linuxScript.slice(
    linuxScript.indexOf('DISTRIBUTION_PROFILE="${PAPERCUSP_DISTRIBUTION_PROFILE:-dogfood}"'),
    linuxScript.indexOf('# ── OWNER-NAME PREFLIGHT'),
  );
  assert.match(profileBlock, /vm-release\)/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES\+x/);
  assert.match(profileBlock, /PAPERCUSP_BUILD_ROLES" != "server"/);
  assert.match(profileBlock, /ROLES="server"/);
  assert.match(profileBlock, /export PAPERCUSP_BUILD_ROLES="\$ROLES"/);
  assert.match(profileBlock, /export PAPERCUSP_STAGE_SOURCE=0/);
  assert.match(profileBlock, /must be dogfood or vm-release/);

  assert.match(
    linuxScript,
    /role_cfg=\(--config src-tauri\/tauri\.vm-release\.conf\.json\)/,
  );
  assert.match(linuxScript, /vm-release — skipping env-sidecars and editable source staging/);
});

test('the sidecar provenance receives the immutable build SHA and version', () => {
  assert.match(
    linuxScript,
    /PAPERCUSP_BUILD_SHA="\$BUILD_SHA" PAPERCUSP_DESKTOP_VERSION="\$VERSION" \\\n\s+bash "\$ROOT\/bin\/build-desktop-sidecar\.sh"/,
    'the sidecar provenance emitter must not fall back to empty SHA or unknown version',
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
  assert.match(audit, /audit-release-bundle\.py" --scan-artifact "\$deb"/);
});

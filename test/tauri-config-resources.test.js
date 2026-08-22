const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', name), 'utf8'));
}

function readText(...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8');
}

function readDistributionContract() {
  return JSON.parse(readText('src-tauri', 'distribution-contract.json'));
}

test('GUI/Server distribution contract is fail-closed and archive-aware', () => {
  const contract = readDistributionContract();
  const mib = 1024 * 1024;

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.sharedSpa.source, 'apps/operator-vite/dist');
  assert.deepEqual(contract.sharedSpa.browserTransport, ['http', 'sse']);
  assert.deepEqual(contract.sharedSpa.desktopTransport, [
    'tauri-endpoint-ipc',
    'http-fallback',
    'sse-adapter',
  ]);

  const guiGlobs = contract.gui.resourceAllowlist.map(({ glob }) => glob);
  assert.deepEqual(guiGlobs, [
    'sidecar/spa/**/*',
    'resources/libPapercuspTermShim.dylib',
  ]);
  for (const forbiddenBroadGlob of ['sidecar/**/*', 'resources/*', 'seed/**/*']) {
    assert(!guiGlobs.includes(forbiddenBroadGlob), `GUI allowlist widened to ${forbiddenBroadGlob}`);
  }
  for (const requiredServerOnlyPrefix of [
    'seed/',
    'sidecar/bin/',
    'sidecar/node_modules/',
    'sidecar/serve.mjs',
    'resources/papercup-runtime.tar.gz',
  ]) {
    assert(
      contract.gui.forbiddenResourcePrefixes.includes(requiredServerOnlyPrefix),
      `GUI forbidden-resource contract lost ${requiredServerOnlyPrefix}`,
    );
  }

  assert.equal(contract.gui.budgets.initialDownloadCeiling, 250 * mib);
  assert.match(contract.gui.budgets.tighteningRule, /Replace the 250 MiB safety ceiling/);
  assert.deepEqual(Object.keys(contract.gui.budgets.platforms).sort(), [
    'linux',
    'macos',
    'windows',
  ]);
  for (const platform of Object.values(contract.gui.budgets.platforms)) {
    assert.equal(platform.mustRemeasureFreshArtifact, true);
  }
  assert.equal(contract.gui.budgets.platforms.linux.downloadBytes, 80_082_225);
  assert.equal(contract.gui.budgets.platforms.linux.unpackedBytes, 241_816_623);
  assert.deepEqual(contract.gui.budgets.measurement, [
    'compressed-artifact-bytes',
    'unpacked-unique-inode-bytes',
    'unpacked-logical-bytes',
    'archive-member-bytes',
  ]);

  assert.deepEqual(contract.coinstall.conflicts, []);
  assert.deepEqual(contract.coinstall.replaces, []);
  const guiDeb = readConfig('tauri.conf.json').bundle?.linux?.deb ?? {};
  const serverDeb = readConfig('tauri.server.conf.json').bundle?.linux?.deb ?? {};
  for (const [role, deb] of [['GUI', guiDeb], ['Server', serverDeb]]) {
    assert.deepEqual(
      deb.conflicts ?? [],
      [],
      `${role} Debian package must remain co-installable with its sibling product`,
    );
    assert.deepEqual(
      deb.replaces ?? [],
      [],
      `${role} Debian package must not replace its sibling product`,
    );
  }
  assert.notEqual(contract.gui.identifier, contract.server.identifier);
  assert.notEqual(contract.gui.productName, contract.server.productName);
  assert.deepEqual(contract.coinstall.sharedExecutablePaths, []);
  for (const key of [
    'linuxExecutable',
    'linuxDesktopEntry',
    'linuxIcon',
    'linuxResourceRoot',
    'macosInstallRoot',
    'windowsInstallRoot',
  ]) {
    assert.notEqual(
      contract.gui.installedIdentities[key],
      contract.server.installedIdentities[key],
      `${key} must be independently owned by GUI and Server`,
    );
  }
  assert.equal(
    readConfig('tauri.server.conf.json').mainBinaryName,
    path.posix.basename(contract.server.installedIdentities.linuxExecutable),
    'the Server overlay must make Tauri package the Server-owned executable name',
  );
  assert.equal(contract.verification.archiveAware, true);
  assert.equal(contract.verification.installedTreeAware, true);
  assert.equal(contract.verification.browserTransportParityRequired, true);
  assert.equal(contract.verification.desktopTransportParityRequired, true);
});

test('Server distribution contract retains every backend runtime class before GUI exclusion', () => {
  const contract = readDistributionContract();
  const required = new Set(contract.server.requiredResources);
  for (const resource of [
    'sidecar/serve.mjs',
    'sidecar/sidecar-preload.js',
    'sidecar/spa/index.html',
    'sidecar/bin/node',
    'sidecar/db-sql/',
    'sidecar/harness/',
    'sidecar/internal-docs/',
    'sidecar/node_modules/',
    'sidecar/prompts/',
    'sidecar/rubrics/',
    'sidecar/scripts/',
    'sidecar/templates/',
  ]) {
    assert(required.has(resource), `Server required-resource manifest lost ${resource}`);
  }

  const packs = new Map(contract.server.optionalPacks.map((pack) => [pack.name, pack]));
  assert.deepEqual([...packs.keys()].sort(), [
    'bootstrap-seed',
    'dev-source',
    'local-models',
    'windows-wsl-runtime',
  ]);
  assert.deepEqual(packs.get('local-models').forbidden, ['*.tmp.*', '*.partial', '*.part']);
  assert.deepEqual(packs.get('bootstrap-seed').paths, ['seed/**/*']);
  assert.deepEqual(packs.get('dev-source').paths, ['sidecar/source.tar.zst']);
  assert.deepEqual(packs.get('windows-wsl-runtime').platforms, ['windows']);

  assert.equal(contract.gui.connection.readinessProbe, '/api/health');
  assert.equal(contract.gui.connection.versionProbe, '/api/desktop/version');
  assert.deepEqual(contract.gui.connection.missingServerChoices, [
    'install-or-start-local-server',
    'connect-remote-or-hosted-server',
  ]);
  assert.equal(
    contract.gui.connection.remoteTransport,
    'credential-free-https-origin-with-browser-http-sse',
  );
  assert.equal(
    contract.gui.versionNegotiation.releaseRule,
    'gui-and-server-must-share-release-version',
  );
  assert.deepEqual(Object.keys(contract.server.capabilitySmoke).sort(), [
    'agent',
    'database',
    'health',
    'spa',
    'stream',
    'version',
  ]);
});

test('Tauri seed bundle is server-only, not duplicated into the GUI bundle', () => {
  const base = readConfig('tauri.conf.json');
  const guiMac = readConfig('tauri.gui.macos.conf.json');
  const server = readConfig('tauri.server.conf.json');
  const contract = readDistributionContract();

  // NOTE (WI-6075): 'sidecar/db-sql/*' is intentionally absent — the recursive
  // 'sidecar/**/*' already covers it. Verified in the shipped artifact, not
  // assumed: dpkg-deb -c on the gate deb lists ./usr/lib/<product>/sidecar/
  // db-sql/000-baseline.sql even though only the recursive glob is declared.
  const baseResources = base.bundle.resources;
  assert.deepEqual(
    baseResources,
    ['sidecar/spa/**/*'],
    'the cross-platform GUI base must carry only the shared bootstrap SPA',
  );
  assert.deepEqual(
    guiMac.bundle.resources,
    contract.gui.resourceAllowlist.map(({ glob }) => glob),
    'the macOS GUI overlay may add only the reviewed native terminal shim',
  );
  assert(!baseResources.some((resource) => resource.includes('seed')), 'GUI/base resources must not include the multi-GB seed');

  // Tauri --config overwrites conflicting values, so the server override must
  // carry the complete resources list, not just the extra seed entry.
  assert.deepEqual(server.bundle.resources, [
    'sidecar/**/*',
    'resources/*',
    'seed/**/*',
  ]);
});

// WI-6075 / P-007: the live-federation gate needs the full seeded runtime, so
// its archived deb is a Server artifact. A one-off full-runtime GUI overlay was
// the exact exception that let the shared GUI contract widen again.
test('archived federation deb reuses the canonical Server overlay', () => {
  // Resolve `--config <token>` against the script's own simple VAR="..."
  // assignments, so the check follows the indirection instead of demanding an
  // inline literal (the script quite reasonably uses a variable).
  const script = fs.readFileSync(path.join(root, 'bin', 'build-and-archive-deb.sh'), 'utf8');
  const vars = new Map();
  for (const [, name, value] of script.matchAll(/^\s*([A-Z_][A-Z0-9_]*)="([^"\n]*)"/gm)) {
    if (!vars.has(name)) vars.set(name, value);
  }
  const configured = [...script.matchAll(/--config\s+"?(\S+?)"?(?:\s|$)/g)].map(([, token]) => {
    const varRef = token.match(/^\$\{?([A-Z_][A-Z0-9_]*)\}?$/);
    return varRef ? vars.get(varRef[1]) : token;
  });

  assert(
    configured.includes('src-tauri/tauri.server.conf.json'),
    `build-and-archive-deb.sh must produce a seeded Server artifact (resolved --config values: ${JSON.stringify(configured)})`,
  );
  assert.equal(
    fs.existsSync(path.join(root, 'src-tauri', 'tauri.gate.conf.json')),
    false,
    'a full-runtime GUI gate overlay must not reappear',
  );
});

// release-build-vm-dev-parity-audit-2026-08-13 D-020 / P-007:
// Release variants are allowed to change identity, packaging and lifecycle,
// but not silently fork the GUI's user-facing plugin/capability contract. A
// newly-added overlay override therefore fails here until its difference is
// reviewed and classified in the parity ledger.
test('release overlays preserve the shared GUI feature contract', () => {
  const base = readConfig('tauri.conf.json');
  const overlays = [
    ['server', readConfig('tauri.server.conf.json')],
    ['gui-macos', readConfig('tauri.gui.macos.conf.json')],
    ['windows', readConfig('tauri.windows.conf.json')],
    ['nightly', readConfig('tauri.nightly.conf.json')],
  ];

  assert.equal(base.build.beforeDevCommand, 'bash bin/dev-operator-ifneeded.sh');
  assert.equal(base.build.devUrl, 'http://127.0.0.1:3270');
  assert.equal(base.build.frontendDist, 'http://127.0.0.1:3070');
  assert.equal(base.plugins.updater.active, true, 'the shared GUI config must retain updater support');

  for (const [name, overlay] of overlays) {
    assert.equal(
      overlay.build,
      undefined,
      `${name} overlay must not fork the shared frontend/dev command contract`,
    );
    assert.equal(
      overlay.plugins,
      undefined,
      `${name} overlay must not replace the shared plugin contract`,
    );
    assert.equal(
      overlay.capabilities,
      undefined,
      `${name} overlay must not select a platform/role-specific capability set`,
    );
    assert.equal(
      overlay.app?.security,
      undefined,
      `${name} overlay must not weaken or fork the shared webview security contract`,
    );
  }

  const capabilitiesDir = path.join(root, 'src-tauri', 'capabilities');
  const capabilityFiles = fs.readdirSync(capabilitiesDir).filter((name) => name.endsWith('.json'));
  assert.deepEqual(
    capabilityFiles,
    ['default.json'],
    'every shipped role/platform must consume one reviewed capability contract; classify any split before adding it',
  );

  const capability = JSON.parse(readText('src-tauri', 'capabilities', 'default.json'));
  const requiredPermissions = [
    'shell:allow-open',
    'dialog:default',
    'fs:default',
    'os:default',
    'updater:default',
    'process:default',
    'notification:default',
    'allow-check-for-update',
    'allow-install-update',
    'allow-pty-spawn',
    'allow-endpoint-invoke',
    'allow-open-docs-search-palette',
  ];
  for (const permission of requiredPermissions) {
    assert(
      capability.permissions.includes(permission),
      `shared release/dev capability contract lost ${permission}`,
    );
  }
});

test('manual platform producers preserve the exact thin-GUI allowlist', () => {
  const appImage = readText('bin', 'build-appimage.sh');
  const macCross = readText('bin', 'build-mac-cross.sh');
  const macVm = readText('bin', 'mac-vm-build.sh');
  const windowsCross = readText('bin', 'build-windows-cross.sh');
  const inno = readText('src-tauri', 'windows', 'inno', 'papercusp.iss');

  assert.match(appImage, /GUI_SPA_SOURCE="\$DESK\/src-tauri\/sidecar\/spa"/);
  assert.match(appImage, /find "\$APPDIR_SIDECAR"[^\n]+! -name spa[^\n]+rm -rf/);
  assert.match(appImage, /rm -rf -- "\$LIBDIR\/resources" "\$LIBDIR\/seed"/);
  assert.doesNotMatch(
    appImage,
    /rsync -a --delete "\$DESK\/src-tauri\/sidecar"\//,
    'AppImage post-processing must never widen the staged GUI back to the full sidecar',
  );

  assert.match(macCross, /if \[\[ "\$role" == "server" \]\]; then[\s\S]*copying darwin Server sidecar/);
  assert.match(macCross, /cp -a "\$DARWIN_SIDECAR\/spa" "\$app\/Contents\/Resources\/sidecar\/spa"/);
  assert.match(macCross, /if \[\[ "\$role" == "gui" \]\]; then[\s\S]*libPapercuspTermShim\.dylib/);

  assert.match(
    macVm,
    /gui\)\s+role_cfg=\(--config src-tauri\/tauri\.gui\.macos\.conf\.json\)/,
    'native macOS Tauri builds must opt into the reviewed GUI-only mac resource overlay',
  );
  assert.match(macVm, /P-007 GUI resource-hygiene: rebuilt allowlisted sidecar\/spa/);

  const filesSection = inno.slice(inno.indexOf('[Files]'), inno.indexOf('[Icons]'));
  const guiBlock = filesSection.match(/#if AppId == "com\.papercusp\.gui"([\s\S]*?)#endif/)?.[1] ?? '';
  const serverBlock = filesSection.match(/#if AppId == "com\.papercusp\.server"([\s\S]*?)#endif/)?.[1] ?? '';
  assert(guiBlock.includes('sidecar\\spa\\*'), 'Windows GUI must package the shared SPA');
  for (const forbidden of ['sidecar\\*', 'resources\\*', 'seed\\*']) {
    assert(!guiBlock.includes(`{#BuildRoot}\\${forbidden}`), `Windows GUI widened to ${forbidden}`);
  }
  for (const required of ['sidecar\\*', 'resources\\*', 'seed\\*']) {
    assert(serverBlock.includes(`{#BuildRoot}\\${required}`), `Windows Server lost ${required}`);
  }
  assert.match(windowsCross, /if \[\[ "\$role" == "gui" \]\]; then[\s\S]*"\$SRC_TAURI\/sidecar\/spa"/);
});

test('all public platform writers consume the shared sidecar, source and command registry', () => {
  const releaseLocal = readText('bin', 'release-local.sh');
  const windows = readText('bin', 'build-windows-cross.sh');
  const mac = readText('bin', 'build-mac-cross.sh');
  const main = readText('src-tauri', 'src', 'main.rs');

  assert.match(
    releaseLocal,
    /PAPERCUSP_RELEASE_AUDIT=1[\s\S]*build-desktop-sidecar\.sh[\s\S]*stage-source-tree\.sh/,
    'the release chokepoint must build one audited sidecar and stage the same runnable source before platform fan-out',
  );
  assert.match(
    releaseLocal,
    /role_cfg=\(\); \[\[ "\$role" == "server" \]\] && role_cfg=\(--config src-tauri\/tauri\.server\.conf\.json\)/,
    'Linux release roles must differ only through the reviewed server overlay',
  );

  for (const [name, source] of [
    ['windows', windows],
    ['mac', mac],
  ]) {
    assert.match(
      source,
      /server\).*tauri_cfg="\$SRC_TAURI\/tauri\.server\.conf\.json"/,
      `${name} release roles must select the same reviewed server overlay`,
    );
    assert.match(
      source,
      /PAPERCUSP_REQUIRE_SIDECAR_RELEASE_AUDIT=1/,
      `${name} release build must refuse a sidecar that missed the final release audit`,
    );
    assert.match(
      source,
      /PAPERCUSP_BUILD_SHA=/,
      `${name} release build must receive the shared source identity`,
    );
    assert.match(
      source,
      /PAPERCUSP_BUILD_VERSION=/,
      `${name} release build must receive the shared version identity`,
    );
  }

  assert.equal(
    (main.match(/\.invoke_handler\(specta_builder\.invoke_handler\(\)\)/g) ?? []).length,
    1,
    'dev and every release role must register one shared Tauri command surface',
  );
});

test('every debug-versus-release compile fork is explicitly classified', () => {
  const main = readText('src-tauri', 'src', 'main.rs');
  const lines = main.split('\n');
  const gates = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*#\[cfg\([^\]]*debug_assertions[^\]]*\)\]/.test(lines[index])) {
      gates.push(lines.slice(index, index + 12).join('\n'));
    }
  }

  const intendedForks = [
    'const BINDINGS_HEADER', // generated bindings exist only in a developer build
    'specta_builder', // generation side effect, not a product command
    'PAPERCUSP_DISABLE_SINGLE_INSTANCE', // release-only lifecycle protection
    'tauri_plugin_mcp_bridge', // localhost developer inspection bridge
    'redirect_own_stdio', // packaged apps have no inherited terminal
    'PAPERCUSP_AUTO_DEVTOOLS', // opt-in developer inspector
    'std::env::var_os("HOME")', // dev IPC discovers the externally-run operator
  ];

  assert.equal(
    gates.length,
    intendedForks.length,
    `main.rs added or removed a debug/release compile fork; classify it here before shipping (${gates.length} found)`,
  );
  intendedForks.forEach((fingerprint, index) => {
    assert.match(
      gates[index],
      new RegExp(fingerprint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `debug/release fork ${index + 1} is no longer the reviewed ${fingerprint} case`,
    );
  });
});

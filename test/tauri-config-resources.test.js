const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
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

function writeFixture(rootDir, relative, contents = 'fixture') {
  const target = path.join(rootDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

function buildDistributionDeb(role, { forbiddenGui = false, modelFragment = false } = {}) {
  const contract = readDistributionContract();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `papercusp-distribution-${role}-`));
  const packageRoot = path.join(temp, 'package');
  const packageName = role === 'gui' ? 'papercusp-gui-fixture' : 'papercusp-server-fixture';
  writeFixture(
    packageRoot,
    'DEBIAN/control',
    `Package: ${packageName}\nVersion: 1.0.0\nArchitecture: amd64\nMaintainer: Test <test@example.invalid>\nDescription: distribution census fixture\n`,
  );

  const resourceRoot = contract[role].installedIdentities.linuxResourceRoot.replace(/^\//, '');
  if (role === 'gui') {
    writeFixture(packageRoot, path.join(resourceRoot, 'sidecar/spa/index.html'), 'spa');
    const primary = writeFixture(packageRoot, path.join(resourceRoot, 'sidecar/spa/chunk.js'), 'shared-chunk');
    fs.linkSync(primary, path.join(packageRoot, resourceRoot, 'sidecar/spa/chunk-copy.js'));
    if (forbiddenGui) writeFixture(packageRoot, path.join(resourceRoot, 'sidecar/serve.mjs'), 'server');
  } else {
    for (const required of contract.server.requiredResources) {
      const relative = path.join(resourceRoot, required.replace(/\/$/, ''));
      if (required.endsWith('/')) fs.mkdirSync(path.join(packageRoot, relative), { recursive: true });
      else writeFixture(packageRoot, relative, required);
    }
    if (modelFragment) {
      writeFixture(
        packageRoot,
        path.join(resourceRoot, 'sidecar/node_modules/model/onnx/model.onnx_data.part'),
        'partial',
      );
    }
  }

  const artifact = path.join(temp, `${packageName}.deb`);
  const built = spawnSync('dpkg-deb', ['--build', packageRoot, artifact], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  return { temp, artifact };
}

function buildDistributionAppImage() {
  const contract = readDistributionContract();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-distribution-gui-appimage-'));
  const resourceRoot = contract.gui.installedIdentities.linuxResourceRoot.replace(/^\//, '');
  const artifact = path.join(temp, 'papercusp-gui-fixture.AppImage');
  fs.writeFileSync(
    artifact,
    `#!/bin/sh
set -eu
[ "\${1:-}" = "--appimage-extract" ]
root="squashfs-root/${resourceRoot}"
mkdir -p "$root/sidecar/spa"
printf spa > "$root/sidecar/spa/index.html"
head -c 4096 /dev/zero > "$root/sidecar/spa/chunk.js"
`,
    { mode: 0o755 },
  );
  return { temp, artifact };
}

function runDistributionCensus(role, artifact, env = {}) {
  const audit = path.join(root, 'bin', 'audit-release-bundle.py');
  const run = spawnSync(
    'python3',
    [audit, '--distribution-census', role, 'linux', artifact],
    { encoding: 'utf8', env: { ...process.env, ...env } },
  );
  const lines = (run.stdout ?? '').trim().split('\n').filter(Boolean);
  const report = lines.length ? JSON.parse(lines.at(-1)) : null;
  return { ...run, report };
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
  assert.match(contract.gui.budgets.tighteningRule, /fresh artifact must pin exact measured bytes/);
  assert.match(contract.gui.budgets.tighteningRule, /cannot pass distribution census until measured/);
  assert.deepEqual(Object.keys(contract.gui.budgets.platforms).sort(), [
    'linux',
    'macos',
    'windows',
  ]);
  for (const platform of Object.values(contract.gui.budgets.platforms)) {
    assert.equal(platform.mustRemeasureFreshArtifact, true);
  }
  const linuxFormats = contract.gui.budgets.platforms.linux.formats;
  assert.deepEqual(Object.keys(linuxFormats).sort(), ['appimage', 'deb']);
  assert.equal(linuxFormats.deb.downloadBytes, 49_547_020);
  assert.equal(linuxFormats.deb.unpackedBytes, 241_963_741);
  assert.equal(linuxFormats.deb.downloadCeilingBytes, 64 * mib);
  assert.equal(linuxFormats.deb.unpackedCeilingBytes, 256 * mib);
  assert.equal(linuxFormats.appimage.downloadBytes, 141_175_288);
  assert.equal(linuxFormats.appimage.unpackedBytes, 514_901_883);
  assert.equal(linuxFormats.appimage.downloadCeilingBytes, 150 * mib);
  assert.equal(linuxFormats.appimage.unpackedCeilingBytes, 512 * mib);
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
  assert.equal(contract.gui.installedIdentities.linuxDesktopEntry, 'Papercusp GUI.desktop');
  assert.equal(contract.server.installedIdentities.linuxDesktopEntry, 'Papercusp Server.desktop');
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

test('distribution census reads archive members, separates hardlinks, and enforces GUI budgets', () => {
  const fixture = buildDistributionDeb('gui');
  try {
    const clean = runDistributionCensus('gui', fixture.artifact);
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(clean.report.ok, true);
    const measured = clean.report.reports[0];
    assert.equal(measured.archiveMemberBytesSource, 'deb-data-tar');
    assert(measured.compressedArtifactBytes > 0);
    assert(measured.archiveMemberBytes > 0);
    assert(
      measured.unpackedLogicalBytes > measured.unpackedUniqueInodeBytes,
      'two installed hardlink paths must count logically while their inode bytes count once',
    );

    const tinyContractPath = path.join(fixture.temp, 'tiny-contract.json');
    const tiny = readDistributionContract();
    tiny.gui.budgets.platforms.linux.formats.deb.downloadCeilingBytes = 1;
    tiny.gui.budgets.platforms.linux.formats.deb.unpackedCeilingBytes = 1;
    fs.writeFileSync(tinyContractPath, `${JSON.stringify(tiny)}\n`);
    const overBudget = runDistributionCensus('gui', fixture.artifact, {
      PAPERCUSP_DISTRIBUTION_CONTRACT: tinyContractPath,
    });
    assert.equal(overBudget.status, 1);
    assert.equal(overBudget.report.ok, false);
    assert.match(overBudget.stderr, /compressed artifact .* exceeds ceiling 1/);
    assert.match(overBudget.stderr, /unique-inode unpacked bytes .* exceed ceiling 1/);
  } finally {
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test('distribution census normalizes the AppImage squashfs root and uses its format budget', () => {
  const fixture = buildDistributionAppImage();
  try {
    const clean = runDistributionCensus('gui', fixture.artifact);
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(clean.report.ok, true);
    assert.equal(clean.report.reports[0].artifactFormat, 'appimage');
    assert.equal(clean.report.reports[0].violations.length, 0);

    const tinyContractPath = path.join(fixture.temp, 'tiny-appimage-contract.json');
    const tiny = readDistributionContract();
    tiny.gui.budgets.platforms.linux.formats.appimage.downloadCeilingBytes = 1;
    tiny.gui.budgets.platforms.linux.formats.appimage.unpackedCeilingBytes = 1;
    fs.writeFileSync(tinyContractPath, `${JSON.stringify(tiny)}\n`);
    const overBudget = runDistributionCensus('gui', fixture.artifact, {
      PAPERCUSP_DISTRIBUTION_CONTRACT: tinyContractPath,
    });
    assert.equal(overBudget.status, 1);
    assert.match(overBudget.stderr, /compressed artifact .* exceeds ceiling 1/);
    assert.match(overBudget.stderr, /unique-inode unpacked bytes .* exceed ceiling 1/);
  } finally {
    fs.rmSync(fixture.temp, { recursive: true, force: true });
  }
});

test('distribution census rejects GUI Server resources and incomplete model fragments', () => {
  const gui = buildDistributionDeb('gui', { forbiddenGui: true });
  const server = buildDistributionDeb('server');
  const fragmentedServer = buildDistributionDeb('server', { modelFragment: true });
  try {
    const guiResult = runDistributionCensus('gui', gui.artifact);
    assert.equal(guiResult.status, 1);
    assert.match(guiResult.stderr, /GUI resource escaped the allowlist: sidecar\/serve\.mjs/);
    assert.match(guiResult.stderr, /GUI contains forbidden Server resource: sidecar\/serve\.mjs/);

    const serverResult = runDistributionCensus('server', server.artifact);
    assert.equal(serverResult.status, 0, serverResult.stderr);
    assert.equal(serverResult.report.ok, true);

    const fragmentResult = runDistributionCensus('server', fragmentedServer.artifact);
    assert.equal(fragmentResult.status, 1);
    assert.match(fragmentResult.stderr, /Server model download fragment survived: .*\.part/);
  } finally {
    fs.rmSync(gui.temp, { recursive: true, force: true });
    fs.rmSync(server.temp, { recursive: true, force: true });
    fs.rmSync(fragmentedServer.temp, { recursive: true, force: true });
  }
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
  assert.match(
    appImage,
    /while IFS= read -r -d '' _stale_sidecar; do[\s\S]*release_artifacts_guarded_delete "\$_stale_sidecar"[\s\S]*done < <\(find "\$APPDIR_SIDECAR"[^)]*! -name spa -print0\)/,
    'the AppImage producer must delete every non-SPA sidecar member through the retention-aware guard',
  );
  assert.match(
    appImage,
    /release_artifacts_guarded_delete "\$LIBDIR\/resources" "\$LIBDIR\/seed"/,
    'Server-only resource roots must be removed through the retention-aware guard',
  );
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

test('direct Tauri builds reject a raw SPA docs duplicate before bundling', () => {
  const buildRs = readText('src-tauri', 'build.rs');
  const mainAt = buildRs.indexOf('fn main()');
  const guardAt = buildRs.indexOf('reject_unpruned_spa_docs(&manifest_dir)', mainAt);
  const placeholderAt = buildRs.indexOf('ensure_sidecar_placeholder(&manifest_dir)', mainAt);
  const tauriBuildAt = buildRs.indexOf('tauri_build::try_build', mainAt);

  assert.match(
    buildRs,
    /fn reject_unpruned_spa_docs[\s\S]*sidecar\/spa\/internal\/docs[\s\S]*panic!\(/,
    'build.rs must fail instead of signing a raw Vite docs duplicate',
  );
  assert.match(
    buildRs,
    /cargo:rerun-if-changed=sidecar\/spa\/internal\/docs/,
    'adding the forbidden directory must invalidate a cached build-script verdict',
  );
  assert.ok(mainAt > 0 && guardAt > mainAt, 'the raw-SPA-docs guard must be called from build.rs main');
  assert.ok(
    guardAt < placeholderAt && placeholderAt < tauriBuildAt,
    'reject the duplicate before placeholder repair and before Tauri sees bundle resources',
  );
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

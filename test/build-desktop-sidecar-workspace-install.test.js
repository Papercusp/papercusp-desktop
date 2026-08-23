// WI-38142 — keep the sidecar dependency install aligned with the package
// names npm actually resolves. A stale @papercusp/operator selector fuzzily
// matched only operator-vite and omitted every apps/operator dependency.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const { builtinModules, createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const desktopRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(desktopRoot, '..');
const builder = fs.readFileSync(
  path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);

/** Extract a top-level shell helper from the real builder for behavioral tests. */
function extractFunction(name) {
  const lines = builder.split('\n');
  const start = lines.findIndex((line) => line === `${name}() {`);
  assert(start >= 0, `${name}() is missing from build-desktop-sidecar.sh`);
  const end = lines.findIndex((line, index) => index > start && line === '}');
  assert(end > start, `${name}() has no top-level closing brace`);
  return lines.slice(start, end + 1).join('\n');
}

const LDCONFIG_RESOLVER = extractFunction('resolve_ldconfig');

function runLdconfigResolver(pathValue) {
  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise the builder helper');
  return childProcess.spawnSync(
    bash,
    ['-c', `set -euo pipefail\n${LDCONFIG_RESOLVER}\nresolve_ldconfig`],
    { encoding: 'utf8', env: { ...process.env, PATH: pathValue } },
  );
}

const HOST_LDCONFIG = ['/usr/sbin/ldconfig', '/sbin/ldconfig'].find((candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
});

test('ldconfig resolver finds admin-directory ldconfig under a minimal PATH', { skip: !HOST_LDCONFIG }, () => {
  const missingPath = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-no-ldconfig-'));
  try {
    const result = runLdconfigResolver(missingPath);
    assert.equal(
      result.status,
      0,
      `resolver failed with minimal PATH (status ${result.status}):\n${result.stdout}${result.stderr}`,
    );
    assert.equal(result.stdout.trim(), HOST_LDCONFIG);
  } finally {
    fs.rmSync(missingPath, { recursive: true, force: true });
  }
});

test('ldconfig resolver prefers the executable selected by PATH', () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-ldconfig-path-'));
  try {
    const pathLdconfig = path.join(bin, 'ldconfig');
    fs.writeFileSync(pathLdconfig, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(pathLdconfig, 0o755);
    const result = runLdconfigResolver(bin);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(result.stdout.trim(), pathLdconfig);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
  }
});

test('Linux PostgreSQL library copy loop invokes the resolved ldconfig path', () => {
  assert.match(builder, /_ldconfig="\$\(resolve_ldconfig\)"/);
  assert.match(builder, /\$\("\$_ldconfig" -p 2>\/dev\/null/);
  assert.doesNotMatch(
    builder,
    /_libpath="\$\(ldconfig -p/,
    'the library-copy loop must not invoke ldconfig through PATH directly',
  );
});

test('chat-dock cargo target discovery is fail-soft and leaves diagnostics visible', () => {
  assert.match(builder, /if ! CARGO_TGT="\$\(/);
  assert.match(builder, /cargo metadata could not resolve the pui target directory/);
  assert.match(builder, /CARGO_TGT=""/);
  assert.doesNotMatch(
    builder,
    /CARGO_TGT="\$\(cd "\$REPO\/apps\/tui" && cargo metadata[^\n]*2>\/dev\/null/,
    'a cargo metadata failure must not silently abort the build under set -e/pipefail',
  );
});

test('sidecar build restores Cargo from CARGO_HOME before the expensive build', () => {
  const cargoGuard = builder.indexOf('_cargo_home="${CARGO_HOME:-$HOME/.cargo}"');
  const firstCargoUse = builder.indexOf('cargo metadata --no-deps --format-version 1');

  assert(cargoGuard >= 0, 'missing systemd-safe Cargo PATH normalization');
  assert(firstCargoUse > cargoGuard, 'Cargo must be resolved before its first build-time use');
  const guard = builder.slice(cargoGuard, firstCargoUse);
  assert.match(guard, /! command -v cargo[^\n]+&& \[\[ -x "\$_cargo_home\/bin\/cargo" \]\]/);
  assert.match(guard, /export PATH="\$_cargo_home\/bin:\$PATH"/);
  assert.match(guard, /hash -r/);
  assert.match(guard, /sidecar release build requires Cargo/);
  assert.match(guard, /exit 1/);
});

test('sidecar build fails closed unless all five official mobile templates are packaged', () => {
  for (const ref of [
    'papercusp-mobile-base',
    'papercusp-android-shell',
    'papercusp-android-app',
    'papercusp-iphone-shell',
    'papercusp-iphone-app',
  ]) {
    assert.match(builder, new RegExp(`\\b${ref}\\b`), `${ref} is absent from the packaged-template guard`);
  }
  assert.match(builder, /REQUIRED_MOBILE_TEMPLATES/);
  assert.match(builder, /listing\.json template\.yaml GUIDE\.md/);
  assert.match(builder, /required official mobile template entry missing from sidecar/);
});

test('sidecar dependency install includes both source workspaces with exact names', () => {
  const operatorName = require(path.join(repoRoot, 'apps/operator/package.json')).name;
  const viteName = require(path.join(repoRoot, 'apps/operator-vite/package.json')).name;

  assert.equal(operatorName, '@papercusp/web');
  assert.equal(viteName, '@papercusp/operator-vite');
  const installStart = builder.indexOf(
    '(cd "$REPO_ROOT" && npm install --legacy-peer-deps',
  );
  const installEnd = builder.indexOf(
    ')\n\n# POST-INSTALL RUNTIME BUILDS',
    installStart,
  );
  assert(installStart >= 0, 'missing scoped sidecar dependency install');
  assert(installEnd > installStart, 'could not isolate scoped sidecar dependency install');
  const install = builder.slice(installStart, installEnd).replace(/\\\r?\n/g, ' ');

  assert.match(install, /--workspace=@papercusp\/web(?:\s|$)/);
  assert.match(install, /--workspace=@papercusp\/operator-vite(?:\s|$)/);
  assert.doesNotMatch(install, /--workspace=@papercusp\/operator(?:\s|$)/);
});

test('sidecar runtime workspace builds require native TypeScript 7 plus the TypeScript 6 API alias', () => {
  const ssePackage = require(path.join(repoRoot, 'libs/generic/sse/package.json'));

  assert.equal(ssePackage.devDependencies['@typescript/native'], 'npm:typescript@7.0.2');
  assert.equal(
    ssePackage.devDependencies.typescript,
    'npm:@typescript/typescript6@6.0.2',
  );
  assert.match(builder, /require\("@typescript\/native\/package\.json"\)/);
  assert.match(builder, /require\("typescript\/package\.json"\)/);
  assert.match(builder, /actualNative\.name === "typescript"/);
  assert.match(builder, /actualApi\.name === "@typescript\/typescript6"/);
  assert.match(builder, /native TypeScript/);
  assert.match(builder, /API compatibility/);
});

test('Debian removal tears down only verified Papercusp process ownership', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const preRemove = fs.readFileSync(preRemovePath, 'utf8');

  assert.equal(baseConfig.bundle.linux.deb.preRemoveScript, 'deb/preremove.sh');
  // The Server overlay intentionally inherits the base Debian maintainer
  // scripts; adding a second script here would let the two bundles drift.
  assert.equal(serverConfig.bundle.linux.deb.preRemoveScript, undefined);
  assert.equal(childProcess.spawnSync('sh', ['-n', preRemovePath]).status, 0);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_PROC_ROOT/);
  assert.match(preRemove, /PAPERCUSP_PREREMOVE_HOME_ROOT/);
  assert.match(preRemove, /operator\.json/);
  assert.match(preRemove, /processIdentity/);
  assert.match(preRemove, /linux:%s:%s/);
  assert.match(preRemove, /serve\.mjs\*\|\*serve\.ts\*/);
  assert.match(preRemove, /hono-host\.mjs\*\|\*hono-host\.ts\*/);
  assert.match(preRemove, /proc_pgid/);
  assert.match(preRemove, /\[ "\$\(proc_pgid "\$pid"\)" = "\$pid" \]/);
  assert.match(preRemove, /kill -TERM -- "-\$operator_pid"/);
  assert.match(preRemove, /kill -KILL -- "-\$operator_pid"/);
  assert.match(preRemove, /is_operator_authority_valid "\$operator_pid" "\$operator_identity"/);
  assert.match(preRemove, /is_packaged_desktop/);
  assert.match(preRemove, /kill -TERM "\$pid"/);
  assert.match(preRemove, /kill -KILL "\$pid"/);
  assert.match(preRemove, /papercusp-gui\)[\s\S]*DESKTOP_EXEC=\/usr\/bin\/papercusp-desktop[\s\S]*OWNS_OPERATOR=0/);
  assert.match(preRemove, /papercusp-server\)[\s\S]*DESKTOP_EXEC=\/usr\/bin\/papercusp-server[\s\S]*OWNS_OPERATOR=1/);
  assert.match(preRemove, /deb-systemd-invoke --user stop "\$SERVER_USER_UNIT"/);
  assert.ok(
    preRemove.indexOf('deb-systemd-invoke --user stop "$SERVER_USER_UNIT"')
      < preRemove.indexOf('for proc_dir in "$PROC_ROOT"/[0-9]*'),
    'Server removal must stop the user unit before direct PID cleanup can trigger Restart=on-failure',
  );
  assert.match(preRemove, /if \[ "\$OWNS_OPERATOR" = 1 \]; then[\s\S]*signal_operator_group/);
});

test('Debian Server removal stops the user unit without changing GUI removal or upgrade behavior', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-systemd-'));
  const procRoot = path.join(root, 'proc');
  const bin = path.join(root, 'bin');
  const invokeLog = path.join(root, 'deb-systemd-invoke.log');
  const invokeShim = path.join(bin, 'deb-systemd-invoke');

  try {
    fs.mkdirSync(procRoot, { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(
      invokeShim,
      ['#!/bin/sh', 'printf "%s\\n" "$*" >> "$PAPERCUSP_SYSTEMD_INVOKE_LOG"', ''].join('\n'),
    );
    fs.chmodSync(invokeShim, 0o755);

    const run = (packageName, action) => childProcess.spawnSync('sh', [preRemovePath, action], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        DPKG_MAINTSCRIPT_PACKAGE: packageName,
        PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
        PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
        PAPERCUSP_SYSTEMD_INVOKE_LOG: invokeLog,
      },
    });

    const serverRemove = run('papercusp-server', 'remove');
    assert.equal(serverRemove.status, 0, `${serverRemove.stdout}${serverRemove.stderr}`);
    assert.equal(fs.readFileSync(invokeLog, 'utf8').trim(), '--user stop papercusp-server.service');

    fs.rmSync(invokeLog);
    const guiRemove = run('papercusp-gui', 'remove');
    assert.equal(guiRemove.status, 0, `${guiRemove.stdout}${guiRemove.stderr}`);
    assert.equal(fs.existsSync(invokeLog), false, 'GUI removal must not stop the Server unit');

    const serverUpgrade = run('papercusp-server', 'upgrade');
    assert.equal(serverUpgrade.status, 0, `${serverUpgrade.stdout}${serverUpgrade.stderr}`);
    assert.equal(fs.existsSync(invokeLog), false, 'upgrade keeps the existing restart-on-replacement behavior');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Debian removal stays quiet when the packaged desktop exits during the TERM wait', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-race-'));
  const procRoot = path.join(root, 'proc');
  const pid = '999999999';
  const pidRoot = path.join(procRoot, pid);
  const bin = path.join(root, 'bin');
  const sleepShim = path.join(bin, 'sleep');

  try {
    fs.mkdirSync(pidRoot, { recursive: true });
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(pidRoot, 'cmdline'), '/usr/bin/papercusp-desktop\0');
    fs.writeFileSync(path.join(pidRoot, 'environ'), 'HOME=/nonexistent\0');
    fs.writeFileSync(
      sleepShim,
      [
        '#!/bin/sh',
        `rm -f ${JSON.stringify(path.join(pidRoot, 'cmdline'))} ${JSON.stringify(path.join(pidRoot, 'environ'))}`,
        `rmdir ${JSON.stringify(pidRoot)} 2>/dev/null || true`,
        '',
      ].join('\n'),
    );
    fs.chmodSync(sleepShim, 0o755);

    const result = childProcess.spawnSync('sh', [preRemovePath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
        PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
        PAPERCUSP_PREREMOVE_WAIT_SEC: '1',
        DPKG_MAINTSCRIPT_PACKAGE: 'papercusp-gui',
      },
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, new RegExp(`stopping packaged desktop pid=${pid}`));
    assert.doesNotMatch(
      result.stderr,
      /cmdline: No such file|cmdline: cannot open/,
      'a disappearing process must not leak a /proc/cmdline redirection diagnostic',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Debian sibling removal selects only the executable owned by that package', () => {
  const preRemovePath = path.join(desktopRoot, 'src-tauri/deb/preremove.sh');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-prerm-siblings-'));
  const procRoot = path.join(root, 'proc');
  const guiPid = '999999991';
  const serverPid = '999999992';

  try {
    for (const [pid, executable] of [
      [guiPid, '/usr/bin/papercusp-desktop'],
      [serverPid, '/usr/bin/papercusp-server'],
    ]) {
      const pidRoot = path.join(procRoot, pid);
      fs.mkdirSync(pidRoot, { recursive: true });
      fs.writeFileSync(path.join(pidRoot, 'cmdline'), `${executable}\0`);
      fs.writeFileSync(path.join(pidRoot, 'environ'), 'HOME=/nonexistent\0');
    }

    for (const { packageName, ownedPid, siblingPid } of [
      { packageName: 'papercusp-gui', ownedPid: guiPid, siblingPid: serverPid },
      { packageName: 'papercusp-server', ownedPid: serverPid, siblingPid: guiPid },
    ]) {
      const result = childProcess.spawnSync('sh', [preRemovePath], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DPKG_MAINTSCRIPT_PACKAGE: packageName,
          PAPERCUSP_PREREMOVE_PROC_ROOT: procRoot,
          PAPERCUSP_PREREMOVE_HOME_ROOT: path.join(root, 'home'),
          PAPERCUSP_PREREMOVE_WAIT_SEC: '0',
        },
      });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stderr, new RegExp(`stopping packaged desktop pid=${ownedPid}`));
      assert.doesNotMatch(
        result.stderr,
        new RegExp(`stopping packaged desktop pid=${siblingPid}`),
        `${packageName} removal must not stop its sibling executable`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Linux Server deb installs and package-enables one systemd user service', () => {
  const baseConfig = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  const serverConfig = require(path.join(desktopRoot, 'src-tauri/tauri.server.conf.json'));
  const unitPath = path.join(desktopRoot, 'src-tauri/systemd/papercusp-server.service');
  const unit = fs.readFileSync(unitPath, 'utf8');
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(postinstallPath, 'utf8');
  const postremovePath = path.join(desktopRoot, 'src-tauri/deb/postremove.sh');
  const postremove = fs.readFileSync(postremovePath, 'utf8');
  const rustMain = fs.readFileSync(path.join(desktopRoot, 'src-tauri/src/main.rs'), 'utf8');

  assert.equal(baseConfig.bundle.linux.deb.files, undefined, 'the GUI package must not ship the Server unit');
  assert.deepEqual(serverConfig.bundle.linux.deb.files, {
    '/usr/lib/systemd/user/papercusp-server.service': 'systemd/papercusp-server.service',
  });
  assert.equal(serverConfig.mainBinaryName, 'papercusp-server');

  assert.match(unit, /^\[Unit\]$/m);
  assert.match(unit, /^ConditionFileIsExecutable=\/usr\/bin\/papercusp-server$/m);
  assert.match(
    unit,
    /^Environment="PAPERCUSP_SIDECAR_DIR=\/usr\/lib\/Papercusp Server\/sidecar"$/m,
  );
  assert.match(unit, /^ExecStart=\/usr\/bin\/papercusp-server --headless-service$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^KillMode=mixed$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.doesNotMatch(
    unit,
    /graphical-session\.target/,
    'lightweight Linux sessions do not reliably activate graphical-session.target',
  );

  const systemdAnalyze = ['/usr/bin/systemd-analyze', '/bin/systemd-analyze'].find((candidate) => fs.existsSync(candidate));
  if (systemdAnalyze) {
    const unitSearchPath = [
      path.dirname(unitPath),
      '/etc/systemd/user',
      '/usr/local/lib/systemd/user',
      '/usr/lib/systemd/user',
      '/usr/share/systemd/user',
    ].join(':');
    const verified = childProcess.spawnSync(
      systemdAnalyze,
      ['--user', 'verify', 'papercusp-server.service'],
      {
        encoding: 'utf8',
        env: { ...process.env, SYSTEMD_UNIT_PATH: unitSearchPath },
      },
    );
    const unexpectedDiagnostics = verified.stderr
      .split('\n')
      .filter(Boolean)
      // The package binary is intentionally absent on a source/CI checkout.
      .filter((line) => !line.includes('Command /usr/bin/papercusp-server is not executable'));
    assert.deepEqual(
      unexpectedDiagnostics,
      [],
      `systemd-analyze rejected papercusp-server.service:\n${verified.stderr}`,
    );
  }
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);
  assert.equal(childProcess.spawnSync('sh', ['-n', postremovePath]).status, 0);

  assert.match(postinstall, /DPKG_MAINTSCRIPT_PACKAGE:-.*papercusp-server/);
  assert.ok(
    postinstall.indexOf('DPKG_MAINTSCRIPT_PACKAGE:-') < postinstall.indexOf('SERVER_USER_UNIT='),
    'the Server package gate must precede every postinstall side effect',
  );
  assert.match(postinstall, /SC="\/usr\/lib\/Papercusp Server\/sidecar"/);
  assert.doesNotMatch(postinstall, /ls -d \/usr\/lib\/Papercusp\*/);
  assert.match(postinstall, /^Icon=papercusp-server$/m);
  assert.match(postinstall, /deb-systemd-helper --quiet --user debian-installed "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /deb-systemd-helper --user enable "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /deb-systemd-helper --quiet --user was-enabled "\$SERVER_USER_UNIT"/);
  assert.match(
    postinstall,
    /CURRENT_SERVER_USER_LINK="\/etc\/systemd\/user\/default\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /LEGACY_SERVER_USER_LINK="\/etc\/systemd\/user\/graphical-session\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /CURRENT_SERVER_USER_STATE="\/var\/lib\/systemd\/deb-systemd-user-helper-enabled\/default\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /LEGACY_SERVER_USER_STATE="\/var\/lib\/systemd\/deb-systemd-user-helper-enabled\/graphical-session\.target\.wants\/\$SERVER_USER_UNIT"/,
  );
  assert.match(
    postinstall,
    /readlink -f -- "\$1"[^\n]+\$SERVER_USER_PATH/,
    'link ownership must compare canonical package paths so /lib and /usr/lib aliases agree',
  );
  assert.match(postinstall, /server_user_link_is_package_owned "\$LEGACY_SERVER_USER_LINK"/);
  assert.match(postinstall, /deb-systemd-helper --user reenable "\$SERVER_USER_UNIT"/);
  assert.match(postinstall, /server_user_link_is_package_owned "\$CURRENT_SERVER_USER_LINK"/);
  assert.match(postinstall, /SERVER_USER_NEEDS_STATE_REPAIR=0/);
  assert.match(postinstall, /SERVER_USER_NEEDS_STATE_REPAIR=1/);
  assert.match(postinstall, /rm -f -- "\$CURRENT_SERVER_USER_STATE"/);
  assert.match(postinstall, /rm -f -- "\$LEGACY_SERVER_USER_LINK"/);
  assert.match(postinstall, /rm -f -- "\$LEGACY_SERVER_USER_STATE"/);
  const debianInstalledIndex = postinstall.indexOf(
    'deb-systemd-helper --quiet --user debian-installed "$SERVER_USER_UNIT"',
  );
  const firstInstallEnableIndex = postinstall.indexOf(
    'deb-systemd-helper --user enable "$SERVER_USER_UNIT"',
  );
  const wasEnabledIndex = postinstall.indexOf(
    'deb-systemd-helper --quiet --user was-enabled "$SERVER_USER_UNIT"',
  );
  assert.ok(
    debianInstalledIndex < firstInstallEnableIndex && firstInstallEnableIndex < wasEnabledIndex,
    'fresh installs must enable before the upgrade-only enabled-state branch',
  );
  assert.ok(
    postinstall.indexOf('rm -f -- "$CURRENT_SERVER_USER_STATE"')
      < postinstall.indexOf('deb-systemd-helper --user reenable "$SERVER_USER_UNIT"'),
    'the exact blocking helper stamp must be cleared before reenable',
  );
  assert.ok(
    postinstall.indexOf('deb-systemd-helper --user reenable "$SERVER_USER_UNIT"')
      < postinstall.indexOf('server_user_link_is_package_owned "$CURRENT_SERVER_USER_LINK"'),
    'the current link must be checked only after reenable runs',
  );
  assert.ok(
    postinstall.indexOf('server_user_link_is_package_owned "$CURRENT_SERVER_USER_LINK"')
      < postinstall.indexOf('rm -f -- "$LEGACY_SERVER_USER_STATE"'),
    'legacy recovery state must survive until the current link is proven',
  );
  assert.match(postinstall, /deb-systemd-helper --user update-state "\$SERVER_USER_UNIT"/);
  assert.match(postremove, /deb-systemd-invoke --user daemon-reload/);
  assert.match(postremove, /deb-systemd-helper --user purge "\$SERVER_USER_UNIT"/);
  assert.ok(
    postremove.indexOf('deb-systemd-invoke --user daemon-reload')
      < postremove.indexOf('deb-systemd-helper --user purge "$SERVER_USER_UNIT"'),
    'live user managers must discard the removed fragment before purge state is considered',
  );
  assert.ok(
    postremove.indexOf('DPKG_MAINTSCRIPT_PACKAGE:-') < postremove.indexOf('case "$1" in'),
    'the Server package gate must precede manual launcher removal',
  );

  assert.match(rustMain, /#\[cfg\(not\(target_os = "linux"\)\)\]\s+fn enable_login_autostart/s);
  assert.match(rustMain, /#\[cfg\(target_os = "linux"\)\]\s+fn enable_login_autostart/s);
  assert.match(rustMain, /login auto-start is managed by papercusp-server\.service/);
  const headlessGate = rustMain.indexOf('if headless_service_requested(std::env::args_os())');
  const tauriBuilder = rustMain.indexOf('let base = tauri::Builder::default()');
  assert.ok(headlessGate >= 0, 'Linux service flag must have an explicit pre-Tauri branch');
  assert.ok(
    headlessGate < tauriBuilder,
    'the headless service branch must run before Tauri/GTK initialization',
  );
  assert.match(rustMain, /fn run_linux_headless_service\(\) -> !/);
  assert.match(rustMain, /spawn_serve\([\s\S]*?&INSTALL_DEFECT/);
});

test('sidecar ships the standalone project-history generator with the shared ESM banner', () => {
  const postinstall = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/deb/postinstall.sh'),
    'utf8',
  );

  assert.match(builder, /libs\/papercusp\/packages\/cli\/src\/project-history-entry\.ts/);
  assert.match(builder, /scripts\/project-history\.mjs/);
  assert.match(builder, /--banner:js="\$HOST_BANNER"/);
  assert.match(
    postinstall,
    /project-history\) shift; exec "\$SC\/bin\/node" "\$SC\/scripts\/project-history\.mjs"/, 
  );
});

test('sidecar build closes direct linked-workspace peer contracts and hoists dockview v6', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackage = require(path.join(repoRoot, 'apps/operator/package.json'));
  const vitePackage = require(path.join(repoRoot, 'apps/operator-vite/package.json'));
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const workspaceRoot = path.join(repoRoot, 'libs/generic/dock-workbench');
  const installedDeclarations = {
    ...operatorPackage.dependencies,
    ...operatorPackage.devDependencies,
    ...vitePackage.dependencies,
    ...vitePackage.devDependencies,
  };
  const missingPeerDeclarations = [];

  for (const [consumerRel, consumer] of [
    ['apps/operator', operatorPackage],
    ['apps/operator-vite', vitePackage],
  ]) {
    for (const [dep, spec] of Object.entries(consumer.dependencies || {})) {
      if (!spec.startsWith('file:')) continue;
      const dependencyRoot = path.resolve(repoRoot, consumerRel, spec.slice('file:'.length));
      const dependencyPackagePath = path.join(dependencyRoot, 'package.json');
      if (!fs.existsSync(dependencyPackagePath)) continue;
      const dependencyPackage = JSON.parse(fs.readFileSync(dependencyPackagePath, 'utf8'));
      for (const peer of Object.keys(dependencyPackage.peerDependencies || {})) {
        if (dependencyPackage.peerDependenciesMeta?.[peer]?.optional) continue;
        if (!(peer in installedDeclarations)) missingPeerDeclarations.push(`${dep} -> ${peer}`);
      }
    }
  }
  assert.deepEqual(missingPeerDeclarations, []);

  for (const peer of ['dockview', 'dockview-react']) {
    assert.equal(
      rootPackage.dependencies[peer],
      operatorPackage.dependencies[peer],
      `${peer} root constraint must stay aligned so the scoped install can hoist it`,
    );
    assert.match(
      lock.packages[`node_modules/${peer}`].version,
      /^6\./,
      `${peer} must be hoisted at the root on the operator v6 line`,
    );
    assert.equal(
      lock.packages[`apps/operator/node_modules/${peer}`],
      undefined,
      `${peer} must not be locked only beneath the consuming app`,
    );
    assert.doesNotThrow(
      () => require.resolve(peer, { paths: [workspaceRoot] }),
      `${peer} must resolve from the workspace realpath Vite uses`,
    );
  }

  assert.match(builder, /spec\.startsWith\("file:"\)/);
  assert.match(builder, /workspacePackage\.peerDependenciesMeta\?\.\[peer\]\?\.optional/);
  assert.match(builder, /createRequire\(workspacePackagePath\)/);
});

test('sidecar source union declares every bare runtime import in operator-core', () => {
  const manifests = [
    require(path.join(repoRoot, 'packages/operator-core/package.json')),
    require(path.join(repoRoot, 'apps/operator/package.json')),
    require(path.join(repoRoot, 'apps/operator-vite/package.json')),
  ];
  const declared = new Set(
    manifests.flatMap((manifest) => [
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
    ]),
  );
  const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
  const missing = new Map();
  const packageName = (specifier) =>
    specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0];
  const inspectSpecifier = (specifier, file) => {
    if (
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:') ||
      builtins.has(specifier.split('/')[0])
    ) return;
    const dependency = packageName(specifier);
    if (declared.has(dependency)) return;
    if (!missing.has(dependency)) missing.set(dependency, new Set());
    missing.get(dependency).add(path.relative(repoRoot, file));
  };
  const visitDirectory = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['dist', 'node_modules'].includes(entry.name)) visitDirectory(file);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(test|spec)\.[^.]+$/.test(entry.name)) continue;
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visitNode = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            inspectSpecifier(node.moduleSpecifier.text, file);
          }
        } else if (
          ts.isCallExpression(node) &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
        ) {
          inspectSpecifier(node.arguments[0].text, file);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(source);
    }
  };

  visitDirectory(path.join(repoRoot, 'packages/operator-core/lib'));
  assert.deepEqual(
    [...missing].map(([dependency, files]) => [dependency, [...files].sort()]).sort(),
    [],
  );
});

test('sidecar server bundle declares DBOS telemetry runtime requirements', () => {
  const rootPackage = require(path.join(repoRoot, 'package.json'));
  const operatorPackagePath = path.join(repoRoot, 'apps/operator/package.json');
  const operatorPackage = require(operatorPackagePath);
  const lock = require(path.join(repoRoot, 'package-lock.json'));
  const requireFromOperator = createRequire(operatorPackagePath);

  // @dbos-inc/dbos-sdk's telemetry module requires these packages at runtime,
  // but its published manifest does not declare them. The root only carried
  // them as devDependencies, so the release builder's scoped workspace install
  // pruned them before esbuild followed the server graph. Keep the bundle's
  // actual runtime contract on the installed app workspace.
  for (const dependency of ['winston', 'winston-transport']) {
    assert.equal(
      operatorPackage.dependencies[dependency],
      rootPackage.devDependencies[dependency],
      `${dependency} must remain a production dependency of the installed operator workspace`,
    );
    assert.equal(
      lock.packages[`node_modules/${dependency}`].dev,
      undefined,
      `${dependency} must not be locked as dev-only`,
    );
    assert.doesNotThrow(
      () => requireFromOperator.resolve(dependency),
      `${dependency} must resolve from the operator workspace used by the sidecar server bundle`,
    );
  }
});

test('sidecar build resolves and verifies the repo-pinned Node runtime before npm install', () => {
  const runtimeStart = builder.indexOf('PAPERCUSP_REQUIRED_NODE_MAJOR=');
  const installStart = builder.indexOf('npm install --legacy-peer-deps');
  assert(runtimeStart >= 0, 'missing repo-pinned Node runtime selector');
  assert(installStart > runtimeStart, 'Node runtime selection must happen before npm install');

  const runtimeBlock = builder.slice(runtimeStart, installStart);
  assert.match(runtimeBlock, /REPO_ROOT\/\.nvmrc/);
  assert.match(runtimeBlock, /papercusp_node_major/);
  assert.match(runtimeBlock, /home\/linuxbrew\/\.linuxbrew\/bin\/node/);
  assert.match(runtimeBlock, /opt\/homebrew\/bin\/node/);
  assert.match(runtimeBlock, /\.nvm\/versions\/node/);
  assert.match(runtimeBlock, /export PATH="\$\(dirname "\$_selected_node"\):\$PATH"/);
  assert.match(runtimeBlock, /\[ "\$_node_major" -ge "\$PAPERCUSP_REQUIRED_NODE_MAJOR" \]/);
  assert.match(runtimeBlock, /ERROR: sidecar release build requires Node/);
});

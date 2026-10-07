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
// Overridable so scripts/mutation-probe.sh can point the suite at a mutated copy (copy-out mode).
const builder = fs.readFileSync(
  process.env.BUILD_DESKTOP_SIDECAR_PATH ?? path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);
const sidecarVerifier = fs.readFileSync(
  path.join(desktopRoot, 'bin/verify-sidecar-bundle.sh'),
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

test('every sidecar esbuild package runner holds the host package-cache lease', () => {
  const runners = builder.split('\n').filter(line => line.includes('npx --yes esbuild@0.25.0'));
  assert.ok(runners.length >= 8, 'all sidecar bundle phases must be covered');
  for (const runner of runners) {
    assert.ok(runner.includes('node "$REPO_ROOT/scripts/npm-install-safe.mjs" --repo-root "$WEB_DIR" --exec-under-cache-lock -- npx'), runner);
  }
});

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

test('sidecar target architecture stays shell-local before native GNU Make builds', () => {
  const start = builder.indexOf('TARGET_OS="${TARGET_OS:-$_host_os}"');
  const end = builder.indexOf('CROSS_BUILD=0', start);
  const trustBuild = builder.indexOf('papercusp_prepare_vm_release_trust_toolchain', end);
  assert(start >= 0 && end > start, 'could not isolate target normalization');
  assert(trustBuild > end, 'native trust build must follow target normalization');

  const normalization = builder.slice(start, end);
  assert.match(normalization, /TARGET_ARCH="\$\{TARGET_ARCH:-\$_host_arch\}"/);
  assert.match(normalization, /export -n TARGET_ARCH/);
  assert.match(normalization, /GNU Make reserves TARGET_ARCH/);

  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise target normalization');
  const result = childProcess.spawnSync(
    bash,
    [
      '-c',
      [
        'set -euo pipefail',
        '_host_os=linux',
        '_host_arch=x64',
        normalization,
        'printf "shell=%s\\n" "$TARGET_ARCH"',
        "if env | grep -q '^TARGET_ARCH='; then exit 97; fi",
      ].join('\n'),
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, TARGET_OS: 'linux', TARGET_ARCH: 'x64' },
    },
  );
  assert.equal(
    result.status,
    0,
    `target normalization leaked TARGET_ARCH to child processes: ${result.stdout}${result.stderr}`,
  );
  assert.equal(result.stdout.trim(), 'shell=x64');
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

test('sidecar privacy prune covers every assembled documentation copy', () => {
  const start = builder.indexOf('python3 "$_audit_py" --prune-docs');
  const end = builder.indexOf('\n  # The prune above deletes by PATH', start);
  assert(start >= 0 && end > start, 'could not isolate the sidecar docs-prune invocation');

  const prune = builder.slice(start, end);
  for (const docsRoot of [
    '$SIDECAR_DIR',
    '$SIDECAR_DIR/internal-docs',
    '$SIDECAR_DIR/apps/operator-docs/src/content/docs',
    '$SIDECAR_DIR/spa/docs',
  ]) {
    assert.match(prune, new RegExp(docsRoot.replaceAll('$', '\\$')));
  }
});

test('sidecar dependency install includes both source workspaces with exact names', () => {
  const operatorName = require(path.join(repoRoot, 'apps/operator/package.json')).name;
  const viteName = require(path.join(repoRoot, 'apps/operator-vite/package.json')).name;

  assert.equal(operatorName, '@papercusp/web');
  assert.equal(viteName, '@papercusp/operator-vite');
  const installStart = builder.indexOf(
    '(cd "$REPO_ROOT" && node scripts/npm-install-safe.mjs install',
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
  assert.doesNotMatch(install, /&& npm install /, 'the shared root install must never bypass npm-install-safe');
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

test('runtime workspace build retries transient post-install extraction gaps under the safe install mutex', () => {
  const start = builder.indexOf('build_runtime_workspace_outputs_after_install() {');
  const end = builder.indexOf('\nbuild_runtime_workspace_outputs_after_install\n', start);
  assert(start >= 0 && end > start, 'could not isolate runtime workspace build helper');
  const helper = builder.slice(start, end);

  assert.match(helper, /runtime_build_attempts=3/);
  assert.match(helper, /for runtime_build_attempt in \$\(seq 1 "\$runtime_build_attempts"\)/);
  assert.match(helper, /npm --workspace "\$workspace" run build/);
  assert.match(helper, /node scripts\/npm-install-safe\.mjs install[\s\S]*--include=dev --workspace="\$workspace"/);
  assert.match(helper, /retrying in 2s/);
  assert.match(helper, /failed after \$runtime_build_attempts reify\+build attempts/);
  assert.doesNotMatch(helper, /&& npm install /, 'runtime reification must never bypass npm-install-safe');
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

test('macOS Server starts without a console login (LaunchDaemon, not a gui-domain LaunchAgent)', () => {
  const launchdDir = path.join(desktopRoot, 'src-tauri/launchd');
  const templatePath = path.join(launchdDir, 'com.papercusp.server.plist.template');
  const currentTemplatePath = path.join(launchdDir, 'com.papercusp.server.current.plist.template');
  const installerPath = path.join(launchdDir, 'install-launchdaemon.sh');
  const currentLauncherPath = path.join(desktopRoot, 'bin/vm-rig/boot-headless-current.sh');
  const template = fs.readFileSync(templatePath, 'utf8');
  const currentTemplate = fs.readFileSync(currentTemplatePath, 'utf8');
  const installer = fs.readFileSync(installerPath, 'utf8');
  const currentLauncher = fs.readFileSync(currentLauncherPath, 'utf8');
  const rustMain = fs.readFileSync(path.join(desktopRoot, 'src-tauri/src/main.rs'), 'utf8');
  const contract = require(path.join(desktopRoot, 'src-tauri/distribution-contract.json'));

  // THE DEFECT THIS PINS (WI-475896). The headless entrypoint was
  // #[cfg(target_os = "linux")] while headless_service_requested() stayed
  // platform-neutral, so on macOS `--headless-service` parsed, was ignored, and
  // the binary fell through into tauri::Builder::default(). With no console
  // session there is no window server to attach to, so the peer stalled at 0%
  // CPU and the federation link went silent with no error anywhere. An
  // accepted-and-ignored flag is worse than a rejected one.
  assert.match(
    rustMain,
    /#\[cfg\(any\(target_os = "linux", target_os = "macos"\)\)\]\s*\n\s*if headless_service_requested/,
    '--headless-service must be honoured on macOS, not parsed and silently ignored',
  );
  assert.doesNotMatch(
    rustMain,
    /run_linux_headless_service/,
    'the headless entrypoint is no longer Linux-only; the Linux-specific name would re-imply it is',
  );

  // A LaunchAgent loads into launchd's gui/<uid> domain, which does not exist
  // while the Mac sits at the login window. Only a system-domain LaunchDaemon
  // delivers "up whenever the machine is up".
  assert.match(installer, /\/Library\/LaunchDaemons/, 'the service must install into the system domain');
  assert.match(installer, /launchctl bootstrap system/);
  assert.doesNotMatch(
    template,
    /LimitLoadToSessionType/,
    'a session-type restriction would re-bind the service to a GUI login',
  );

  assert.match(template, /<key>RunAtLoad<\/key>\s*<true\/>/, 'must start at boot');
  assert.match(template, /<key>KeepAlive<\/key>/, 'must restart after a crash');
  assert.match(template, /<key>UserName<\/key>/, 'running as root would create a root-owned state tree');
  assert.match(template, /--headless-service/);

  // EI-21708848218896947: launchd defaults CWD to "/" and the shipped sidecar
  // fatals during prompt assembly anywhere but its own directory.
  assert.match(
    template,
    /<key>WorkingDirectory<\/key>\s*<string>\/Applications\/Papercusp Server\.app\/Contents\/Resources\/sidecar<\/string>/,
    'without WorkingDirectory the daemon boots embedded Postgres and then dies on prompt assembly',
  );
  // `UserName` alone does NOT populate HOME — launchd leaves it unset or at
  // /var/root — and every workspace path the sidecar resolves hangs off HOME.
  assert.match(template, /<key>HOME<\/key>/);

  // Any placeholder the template declares must be one the installer actually
  // substitutes, or a live plist ships pointing at a literal __TOKEN__ path.
  const declared = [...new Set(template.match(/__PAPERCUSP_[A-Z_]+__/g) || [])];
  assert.ok(declared.length > 0, 'the template is expected to carry install-time placeholders');
  for (const token of declared) {
    assert.ok(
      installer.includes(`//${token}/`),
      `install-launchdaemon.sh declares no substitution for ${token}`,
    );
  }

  // EI-216508 / D-104: the exact tower-composed payload uses the same system
  // service identity instead of a second daemon that can race it for PG/:3070.
  assert.match(currentTemplate, /<string>com\.papercusp\.server<\/string>/);
  assert.match(currentTemplate, /__PAPERCUSP_CURRENT_LAUNCHER__<\/string>\s*<string>--launchd-run<\/string>/);
  assert.match(currentTemplate, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(currentTemplate, /<key>KeepAlive<\/key>[\s\S]*?<key>SuccessfulExit<\/key>\s*<false\/>/);
  assert.match(currentTemplate, /<key>WorkingDirectory<\/key>\s*<string>__PAPERCUSP_CURRENT_PAYLOAD__<\/string>/);
  assert.match(currentTemplate, /<key>HOME<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>USERPROFILE<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_RIG_HOME<\/key>\s*<string>__PAPERCUSP_SERVICE_HOME__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_RIG_SIDECAR_DIR<\/key>\s*<string>__PAPERCUSP_CURRENT_PAYLOAD__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_HONO_PORT<\/key>\s*<string>__PAPERCUSP_CURRENT_PORT__<\/string>/);
  // EI-22368205971185543: a generated current-payload sidecar has no baked
  // source SHA. The LaunchDaemon must receive the exact payload identity so a
  // healthy :3070 response cannot be mistaken for an unproven bundle.
  assert.match(currentTemplate, /<key>PAPERCUSP_BUILD_SHA<\/key>\s*<string>__PAPERCUSP_CURRENT_BUILD_SHA__<\/string>/);
  assert.match(currentTemplate, /<key>PAPERCUSP_BUILD_VERSION<\/key>\s*<string>__PAPERCUSP_CURRENT_BUILD_VERSION__<\/string>/);
  assert.match(installer, /--build-sha\)/);
  assert.match(installer, /--build-version\)/);
  assert.match(installer, /CURRENT_PAYLOAD}\/BUILD-STAMP\.txt/);
  assert.match(installer, /health_sha=/);
  assert.match(installer, /CURRENT_BUILD_SHA/);

  const currentDeclared = [...new Set(currentTemplate.match(/__PAPERCUSP_[A-Z_]+__/g) || [])];
  for (const token of currentDeclared) {
    assert.ok(installer.includes(`//${token}/`), `installer does not substitute current-payload token ${token}`);
  }

  // EI-218402: the rig's current-payload service executes the checked-in
  // launcher + bundled Node directly. It must remain installable when the
  // unrelated native Tauri binary is absent, while ordinary packaged-service
  // mode still fails closed without that binary.
  const currentBranchStart = installer.indexOf('if [ -n "$CURRENT_PAYLOAD" ] || [ -n "$CURRENT_LAUNCHER" ]');
  const packagedBranchStart = installer.indexOf('\nelse\n  [ -x "$BINARY" ]', currentBranchStart);
  assert.ok(currentBranchStart >= 0 && packagedBranchStart > currentBranchStart);
  const currentPreflight = installer.slice(currentBranchStart, packagedBranchStart);
  assert.doesNotMatch(currentPreflight, /\[ -x "\$BINARY" \]/);
  assert.match(currentPreflight, /\[ -x "\$\{SIDECAR_DIR\}\/bin\/node" \]/);
  assert.match(installer.slice(packagedBranchStart), /\[ -x "\$BINARY" \]/);

  const unload = installer.indexOf('unload_if_present\nif [ "$SERVICE_KIND" = "current" ]');
  const exactStop = installer.indexOf('"$CURRENT_LAUNCHER" --stop-only');
  const enable = installer.indexOf('launchctl enable "system/${LABEL}"');
  const bootstrap = installer.indexOf('launchctl bootstrap system "$PLIST_DEST"');
  assert.ok(
    unload >= 0 && exactStop > unload && enable > exactStop && bootstrap > enable,
    'bootout + exact stop + enable must precede bootstrap',
  );
  assert.match(installer, /operator_pid" = "\$service_pid"/);
  assert.match(installer, /lsof -nP -a -p "\$service_pid" -iTCP:"\$CURRENT_PORT" -sTCP:LISTEN/);
  assert.match(installer, /curl -fsS -m 2 "http:\/\/127\.0\.0\.1:\$\{CURRENT_PORT\}\/api\/health"/);

  // EI-22367240585613586: if launchd's discovery/PID files are stale, the
  // exact-owner stop may recover from a unique port listener only after its
  // executable + serve path are validated; it must never fall back to a broad
  // `pkill`/process-table sweep.
  assert.match(currentLauncher, /process_executable\(\)/);
  assert.match(currentLauncher, /pid_from_unique_port_owner\(\)/);
  assert.match(currentLauncher, /lsof -nP -iTCP:"\$HONO_PORT" -sTCP:LISTEN -t/);
  assert.match(currentLauncher, /pid_from_file "\$PIDFILE" \|\| pid_from_unique_port_owner/);

  // The contract recorded linuxUserUnit and no macOS counterpart, which is how
  // the platform asymmetry stayed invisible. Keep both named.
  assert.equal(
    contract.server.installedIdentities.macosServiceDaemon,
    '/Library/LaunchDaemons/com.papercusp.server.plist',
  );
  assert.equal(
    contract.server.installedIdentities.linuxUserUnit,
    '/usr/lib/systemd/user/papercusp-server.service',
  );

  assert.equal(childProcess.spawnSync('bash', ['-n', installerPath]).status, 0);
});

test('Linux Server ships an opt-in boot-start helper, because a user unit alone dies with the last login', () => {
  const helperPath = path.join(desktopRoot, 'src-tauri/systemd/enable-boot-start.sh');
  const helper = fs.readFileSync(helperPath, 'utf8');
  const unit = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/systemd/papercusp-server.service'),
    'utf8',
  );
  const contract = require(path.join(desktopRoot, 'src-tauri/distribution-contract.json'));

  // THE DEFECT THIS PINS (WI-479556, sibling of WI-475896's macOS half).
  // papercusp-server.service is a systemd USER unit, and a per-user manager is
  // started at login and torn down with the user's last session. Without
  // lingering, a headless Linux peer is up only while somebody is logged in —
  // and nothing errors, so it reads as a federation fault rather than a service
  // that was never started.
  assert.match(unit, /^WantedBy=default\.target$/m, 'this test only makes sense for a user unit');
  assert.match(helper, /loginctl enable-linger/, 'boot-start requires lingering for the owning account');
  assert.match(helper, /loginctl disable-linger/, 'the helper must be reversible');

  // enable-linger can report success while the state does not stick (a
  // read-only /var/lib/systemd/linger, for one). Verify, do not assume.
  assert.match(
    helper,
    /show-user[^\n]*--property=Linger/,
    'the helper must VERIFY linger took, not just request it',
  );

  // Without XDG_RUNTIME_DIR a `systemctl --user` run under sudo addresses
  // ROOT's manager and reports success while changing nothing for the account
  // that matters — a silent no-op with a green exit code.
  assert.match(
    helper,
    /XDG_RUNTIME_DIR=/,
    'systemctl --user must be pointed at the target account\'s own manager',
  );

  // It is deliberately NOT wired into postinstall: a deb maintainer script runs
  // as root with no SUDO_USER and cannot know which account should own the peer.
  const postinstall = fs.readFileSync(
    path.join(desktopRoot, 'src-tauri/deb/postinstall.sh'),
    'utf8',
  );
  assert.doesNotMatch(
    postinstall,
    /enable-linger/,
    'postinstall cannot know which account to enable linger for; keep this opt-in',
  );

  assert.equal(contract.server.installedIdentities.linuxBootStartHelper, 'systemd/enable-boot-start.sh');
  assert.equal(childProcess.spawnSync('bash', ['-n', helperPath]).status, 0);
});

// EI-21417256075155406: without /etc/codex/skills, Codex's skills watcher watches /etc with
// IN_OPEN, so every process start on the host wakes every Codex agent session.
test('deb postinstall provisions the Codex system skills root for the Server package only', () => {
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(postinstallPath, 'utf8');
  const lines = postinstall.split('\n');
  const serverGate = lines.findIndex((l) => l.includes('DPKG_MAINTSCRIPT_PACKAGE') && l.includes('papercusp-server') && l.includes('exit 0'));
  const mkdir = lines.findIndex((l) => /^mkdir -p "\$\{DPKG_ROOT:-\}\/etc\/codex\/skills"/.test(l));
  assert.ok(serverGate >= 0, 'postinstall keeps its Server-only gate');
  assert.ok(mkdir > serverGate, 'the skills root is created after the Server-only gate, so the GUI package never creates it');
  assert.match(lines[mkdir], /\|\| true$/, 'creating the skills root can never fail the package install');
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);
});

// WI-10004618: on Ubuntu 23.10+ (apparmor_restrict_unprivileged_userns=1) Codex's
// bwrap sandbox cannot create a user namespace without an AppArmor grant, so every
// Codex command fails while the run reports success. Drive the REAL postinst
// function against a temp /etc/apparmor.d with a fake apparmor_parser.
function bwrapProfileHarness() {
  // Overridable so scripts/mutation-probe.sh can point it at a mutated copy.
  const subject = process.env.PAPERCUSP_POSTINSTALL_UNDER_TEST
    || path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const postinstall = fs.readFileSync(subject, 'utf8');
  const lines = postinstall.split('\n');
  const start = lines.findIndex((l) => l.startsWith('papercusp_install_bwrap_userns_profile() {'));
  assert.ok(start >= 0, 'postinstall defines papercusp_install_bwrap_userns_profile');
  // The heredoc'd AppArmor profile has its own bare `}` line, so the function ends at
  // the `}` that follows its final `return 0`, not at the first `}`.
  const end = lines.findIndex((l, i) => i > start && l === '}' && lines[i - 1] === '  return 0');
  assert.ok(end > start, 'found the end of papercusp_install_bwrap_userns_profile');
  const fn = lines.slice(start, end + 1).join('\n');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-bwrap-profile-'));
  const aaDir = path.join(tmp, 'apparmor.d');
  const binDir = path.join(tmp, 'bin');
  fs.mkdirSync(aaDir);
  fs.mkdirSync(binDir);
  const sysctl = path.join(tmp, 'apparmor_restrict_unprivileged_userns');
  const bwrap = path.join(tmp, 'bwrap');
  fs.writeFileSync(bwrap, '#!/bin/sh\n', { mode: 0o755 });
  const parserLog = path.join(tmp, 'parser.log');
  fs.writeFileSync(
    path.join(binDir, 'apparmor_parser'),
    `#!/bin/sh\necho "$@" >> '${parserLog}'\nexit "\${FAKE_PARSER_RC:-0}"\n`,
    { mode: 0o755 },
  );
  const script = path.join(tmp, 'run.sh');
  fs.writeFileSync(script, `set -e\n${fn}\npapercusp_install_bwrap_userns_profile "$1" "$2" "$3"\necho RC=$?\n`);
  const run = (env = {}) => childProcess.spawnSync('sh', [script, aaDir, sysctl, bwrap], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin`, ...env },
  });
  const profile = path.join(aaDir, 'bwrap');
  const parserCalls = () => (fs.existsSync(parserLog) ? fs.readFileSync(parserLog, 'utf8').trim().split('\n') : []);
  return { tmp, aaDir, sysctl, bwrap, profile, run, parserCalls };
}

test('deb postinstall grants /usr/bin/bwrap userns only on AppArmor-restricted kernels, scoped and reversible', () => {
  const h = bwrapProfileHarness();
  try {
    // Kernel without the restriction: nothing to grant, nothing written.
    let r = h.run();
    assert.match(r.stdout, /RC=0/);
    assert.equal(fs.existsSync(h.profile), false, 'no profile without the restriction sysctl');
    assert.deepEqual(h.parserCalls(), []);

    // Restricted kernel: a profile scoped to the bwrap binary, loaded with -r.
    fs.writeFileSync(h.sysctl, '1\n');
    r = h.run();
    assert.match(r.stdout, /RC=0/);
    const body = fs.readFileSync(h.profile, 'utf8');
    assert.match(body, /^# Managed by the papercusp-server package \(WI-10004618\)\./);
    assert.ok(body.includes(`profile bwrap ${h.bwrap} flags=(unconfined) {`), 'attaches to exactly the bwrap binary');
    assert.match(body, /^\s+userns,$/m);
    assert.match(body, /include if exists <local\/bwrap>/);
    assert.deepEqual(h.parserCalls(), [`-r ${h.profile}`]);

    // Upgrade: our own profile is rewritten in place.
    fs.appendFileSync(h.profile, '# stale\n');
    h.run();
    assert.equal(fs.readFileSync(h.profile, 'utf8').includes('# stale'), false, 'our profile is refreshed on upgrade');

    // A parser that rejects the profile (AppArmor without userns rules) leaves NO file behind.
    fs.rmSync(h.profile);
    r = h.run({ FAKE_PARSER_RC: '1' });
    assert.match(r.stdout, /RC=0/, 'a rejected profile never fails the install');
    assert.equal(fs.existsSync(h.profile), false, 'an unloadable profile is removed so apparmor.service cannot fail at boot');

    // An administrator-owned /etc/apparmor.d/bwrap is never touched.
    fs.writeFileSync(h.profile, 'profile bwrap /usr/bin/bwrap { }\n');
    const callsBefore = h.parserCalls().length;
    h.run();
    assert.equal(fs.readFileSync(h.profile, 'utf8'), 'profile bwrap /usr/bin/bwrap { }\n');
    assert.equal(h.parserCalls().length, callsBefore, 'parser not invoked for a foreign profile');

    // Another package's profile already attaching to bwrap: we stay out.
    fs.rmSync(h.profile);
    fs.writeFileSync(path.join(h.aaDir, 'bwrap-userns-restrict'), `profile bwrap ${h.bwrap} flags=(unconfined) {\n  userns,\n}\n`);
    h.run();
    assert.equal(fs.existsSync(h.profile), false, 'no second profile for the same attachment');
  } finally {
    fs.rmSync(h.tmp, { recursive: true, force: true });
  }
});

test('deb packaging wires the bwrap grant for the Server only: call site, Depends, and removal', () => {
  const postinstallPath = path.join(desktopRoot, 'src-tauri/deb/postinstall.sh');
  const lines = fs.readFileSync(postinstallPath, 'utf8').split('\n');
  const serverGate = lines.findIndex((l) => l.includes('DPKG_MAINTSCRIPT_PACKAGE') && l.includes('papercusp-server') && l.includes('exit 0'));
  const call = lines.findIndex((l) => /^\s+papercusp_install_bwrap_userns_profile \/etc\/apparmor\.d \\$/.test(l));
  assert.ok(call > serverGate && serverGate >= 0, 'the grant is installed after the Server-only gate');
  assert.match(lines[call + 1], /\/proc\/sys\/kernel\/apparmor_restrict_unprivileged_userns \/usr\/bin\/bwrap \|\| true$/);
  assert.match(lines[call - 1], /^if \[ -z "\$\{DPKG_ROOT:-\}" \]; then$/, 'never touches the live kernel during a DPKG_ROOT bootstrap');
  assert.equal(childProcess.spawnSync('sh', ['-n', postinstallPath]).status, 0);

  const base = require(path.join(desktopRoot, 'src-tauri/tauri.conf.json'));
  assert.deepEqual(base.bundle.linux.deb.depends, [], 'the thin GUI does not pull bubblewrap');
  for (const overlay of ['tauri.server.conf.json', 'tauri.vm-release.conf.json']) {
    const cfg = require(path.join(desktopRoot, 'src-tauri', overlay));
    assert.ok(cfg.bundle.linux.deb.depends.includes('bubblewrap'), `${overlay} depends on bubblewrap (Codex runs /usr/bin/bwrap)`);
  }

  const postremovePath = path.join(desktopRoot, 'src-tauri/deb/postremove.sh');
  const postremove = fs.readFileSync(postremovePath, 'utf8');
  assert.match(postremove, /grep -qF '# Managed by the papercusp-server package \(WI-10004618\)\.' \/etc\/apparmor\.d\/bwrap/, 'only our marked profile is removed');
  assert.match(postremove, /apparmor_parser -R \/etc\/apparmor\.d\/bwrap/, 'the grant is unloaded from the kernel, not just deleted');
  assert.equal(childProcess.spawnSync('sh', ['-n', postremovePath]).status, 0);
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
  assert.match(unit, /^StateDirectory=papercusp\/controller$/m);
  assert.match(unit, /^StateDirectoryMode=0700$/m);
  assert.doesNotMatch(
    unit,
    /PAPERCUSP_WORKSPACE_HOST_(?:SSH_USER|KNOWN_HOSTS|REMOTE_ENTRYPOINT)=/,
    'the resolver must derive workspace-host controller defaults from the deployment contract and systemd StateDirectory',
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
  assert.ok(headlessGate >= 0, 'the service flag must have an explicit pre-Tauri branch');
  assert.ok(
    headlessGate < tauriBuilder,
    'the headless service branch must run before Tauri/GTK initialization',
  );
  // Renamed from run_linux_headless_service on 2026-08-28 (WI-475896) when the
  // branch was widened to macOS. The macOS-specific coverage — that the cfg gate
  // actually names darwin, so the flag cannot go back to being parsed-and-ignored
  // — lives in the LaunchDaemon test above.
  assert.match(rustMain, /fn run_headless_service\(\) -> !/);
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

test('sidecar ships and verifies the complete packaged OMP native MCP asset pair', () => {
  const pairLoop = 'for native_mcp_asset in native-client.cjs native-extension.mjs; do';
  assert.ok(
    builder.includes(pairLoop),
    'the producer must stage native-client.cjs and native-extension.mjs as one named pair',
  );
  assert.ok(
    builder.includes('NATIVE_MCP_DIST="$REPO_ROOT/packages/omp-plugin/dist"'),
    'the producer must copy the post-install build outputs from the pinned source tree',
  );
  assert.ok(
    builder.includes('cp -a "$NATIVE_MCP_DIST/$native_mcp_asset" "$SIDECAR_DIR/scripts/$native_mcp_asset"'),
    'the runtime file-URL assets must remain adjacent to packaged scripts/psu.mjs',
  );
  assert.ok(
    builder.includes('[[ -s "$NATIVE_MCP_DIST/$native_mcp_asset" ]]'),
    'the producer must fail closed when either built source asset is absent or empty',
  );
  assert.ok(
    sidecarVerifier.includes(pairLoop),
    'the finished-sidecar verifier must independently require the same complete asset pair',
  );
  assert.ok(
    sidecarVerifier.includes('native_mcp_path="$SIDECAR/scripts/$native_mcp_asset"'),
    'the verifier must inspect the packaged-adjacent layout the launcher actually resolves',
  );
  assert.ok(
    sidecarVerifier.includes('[[ -s "$native_mcp_path" ]]'),
    'the verifier must reject an absent or empty packaged asset',
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
  // Source-tree-only entries that no bundled runtime ever loads, so their imports never
  // reach the sidecar. snapshot-fold.worker.dev.mjs loads the .ts worker through tsx for
  // tsx/vitest runtimes; the sidecar loads the esbuilt snapshot-fold.worker.mjs instead
  // (snapshot-fold-offload.ts picks the bundled worker whenever it exists).
  // admission-jobs.tsx-worker.mjs is the same pattern for the release-admission worker: it
  // registers tsx on an unbundled host's worker thread, while bundled hosts load the esbuilt
  // admission-jobs.worker.mjs (admission-offthread.ts, WI-10005223 / WI-10005359).
  const sourceTreeOnly = new Set([
    'packages/operator-core/lib/sync/hyperbee/snapshot-fold.worker.dev.mjs',
    'packages/operator-core/lib/release/admission-jobs.tsx-worker.mjs',
  ]);
  for (const relative of sourceTreeOnly) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, relative)),
      `stale sourceTreeOnly entry (file is gone): ${relative}`,
    );
  }
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
      if (sourceTreeOnly.has(path.relative(repoRoot, file))) continue;
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
  const installStart = builder.indexOf('node scripts/npm-install-safe.mjs install');
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

// WI-10006694 — an ESM bundle that reaches a CommonJS require() throws "Dynamic require of ... is
// not supported" at load unless it carries the createRequire banner. The orchestrator bins shipped
// without it, so every packaged dbos-invoke role spawn (the D-055 merge-resolver on c1007k) died
// before main.
const ESM_REQUIRE_SHIM_GUARD = extractFunction('assert_esm_require_shim');

function runEsmRequireShimGuard(files) {
  const bash = ['/usr/bin/bash', '/bin/bash'].find((candidate) => fs.existsSync(candidate));
  assert.ok(bash, 'a bash interpreter is required to exercise the builder helper');
  return childProcess.spawnSync(
    bash,
    ['-c', `set -euo pipefail\n${ESM_REQUIRE_SHIM_GUARD}\nassert_esm_require_shim "$@"`, 'guard', ...files],
    { encoding: 'utf8' },
  );
}

test('assert_esm_require_shim refuses a bundle with the dynamic-require stub and no createRequire banner', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-esm-shim-'));
  try {
    // esbuild's stub, as minified into the c1007k invoke-once.mjs.
    const stub = 'var __require=(x=>{throw Error(\'Dynamic require of "\'+x+\'" is not supported\')});__require("process");\n';
    const bare = path.join(dir, 'bare.mjs');
    fs.writeFileSync(bare, stub);
    const bannered = path.join(dir, 'bannered.mjs');
    fs.writeFileSync(
      bannered,
      `#!/usr/bin/env node\nimport{createRequire as __pcr}from'module';const require=__pcr(import.meta.url);\n${stub}`,
    );
    const plain = path.join(dir, 'plain.mjs');
    fs.writeFileSync(plain, 'console.log(1);\n');

    const refused = runEsmRequireShimGuard([plain, bare]);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /bare\.mjs reaches a CommonJS require\(\) but has no createRequire banner/);

    const accepted = runEsmRequireShimGuard([plain, bannered]);
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every ESM esbuild bundle in the builder carries the createRequire banner or is checked by assert_esm_require_shim', () => {
  const lines = builder.split('\n');
  const invocations = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/npx --yes esbuild@/.test(lines[i])) continue;
    let end = i;
    let text = lines[i];
    while (/\\\s*$/.test(lines[end]) && end + 1 < lines.length) {
      end += 1;
      text += `\n${lines[end]}`;
    }
    invocations.push({ start: i + 1, end: end + 1, text });
  }
  const esm = invocations.filter((inv) => /--format=esm/.test(inv.text));
  assert.ok(esm.length >= 7, `expected the builder's ESM bundles, found ${esm.length}`);
  const unguarded = esm.filter(
    (inv) =>
      !/--banner:js="\$HOST_BANNER"/.test(inv.text) &&
      !lines.slice(inv.end, inv.end + 25).some((line) => /^\s*assert_esm_require_shim /.test(line)),
  );
  assert.deepEqual(unguarded.map((inv) => `build-desktop-sidecar.sh:${inv.start}`), []);

  const orchestrator = esm.find((inv) => inv.text.includes('"$ORCH_SRC/bin/$b.ts"'));
  assert.ok(orchestrator, 'the orchestrator bins bundle is missing from the builder');
  assert.match(orchestrator.text, /--banner:js="\$HOST_BANNER"/);
  assert.match(builder, /^assert_esm_require_shim "\$ORCH_DST"\/bin\/\*\.mjs \|\| exit 1$/m);
});

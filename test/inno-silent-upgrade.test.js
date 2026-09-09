const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const iss = fs.readFileSync(process.env.PAPERCUSP_ISS
  || path.join(root, 'src-tauri', 'windows', 'inno', 'papercusp.iss'), 'utf8');
const code = iss.slice(iss.indexOf('[Code]'));

// EI-20984135666314897 / real Windows :2223 acceptance (2026-08-20):
// Restart Manager could not close a GUI running in the interactive console
// session when a silent installer was launched from another session. Inno
// then defaulted the suppressed file-in-use prompt to Abort (exit 5) after a
// two-minute rollback. The fix must be in the installer itself, not only in a
// release-verification command that happens to taskkill before invoking it.
test('Inno silent upgrades close only the role-scoped executable before copying', () => {
  assert.match(iss, /^CloseApplications=yes$/m, 'keep Inno Restart Manager as the normal close path');
  assert.match(code, /function CloseRoleScopedRunningApplication: String;/);
  assert.match(code, /WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(code, /Get-CimInstance Win32_Process/);
  assert.match(
    code,
    /\$_.Name -eq ''papercusp-desktop\.exe'' -and/,
    'the process query must match both the shared image name and the installed role path',
  );
  assert.match(code, /\$_.ExecutablePath -eq \$target/);
  assert.match(code, /Stop-Process -Id \(\[int\]\$p\.ProcessId\)/);
  assert.match(code, /-Force -ErrorAction Stop/);
  assert.match(code, /\$remaining\.Count -eq 0/);
  assert.match(code, /windows-role-close-failed:/);
  assert.match(code, /function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(
    code,
    /function PrepareToInstall[\s\S]*?CloseRoleScopedRunningApplication/s,
    'role-scoped close must run from Inno’s pre-install hook',
  );
  assert.doesNotMatch(
    code,
    /taskkill\s+\/f\s+\/im\s+papercusp-desktop\.exe/i,
    'an image-name taskkill would terminate the sibling GUI/Server role',
  );
});

test('the role predicate cannot select the sibling role with the same executable basename', () => {
  assert.match(code, /\$_.Name -eq ''papercusp-desktop\.exe'' -and/);
  assert.match(code, /\$_.ExecutablePath -eq \$target/);

  const processes = [
    { Name: 'papercusp-desktop.exe', ExecutablePath: 'C:\\Users\\Avi\\AppData\\Local\\Papercusp GUI\\papercusp-desktop.exe' },
    { Name: 'papercusp-desktop.exe', ExecutablePath: 'C:\\Users\\Avi\\AppData\\Local\\Papercusp Server\\papercusp-desktop.exe' },
  ];
  const target = processes[0].ExecutablePath;
  const selected = processes.filter(
    (process) => process.Name === 'papercusp-desktop.exe' && process.ExecutablePath === target,
  );
  assert.deepEqual(selected, [processes[0]]);
});

const serverFiles = iss.slice(
  iss.indexOf('#if AppId == "com.papercusp.server"', iss.indexOf('[Files]')),
  iss.indexOf('[Icons]'),
);
const stampEntry = serverFiles.split('\n').find(
  (line) => line.startsWith('Source: ') && line.includes('sidecar\\.sidecar-build-stamp"'),
);

test('Windows packaging explicitly requires the stamp consumed before WSL runtime staging', () => {
  assert.ok(stampEntry, 'a wildcard alone silently omitted the runtime stamp from 0.0.19');
  assert.match(stampEntry, /DestDir: "\{app\}\\sidecar"/);
  assert.match(stampEntry, /Flags: ignoreversion/);
  assert.doesNotMatch(stampEntry, /skipifsourcedoesntexist/);
  const launcher = fs.readFileSync(path.join(root, 'src-tauri/src/main.rs'), 'utf8');
  assert.match(launcher, /sidecar_dir\.join\("\.sidecar-build-stamp"\)/);
  const builder = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
  const closure = builder.indexOf('_runtime_scan_args+=(--require-windows-server-runtime)');
  const signing = builder.indexOf('echo "==> signing installers"');
  assert.ok(closure >= 0 && closure < signing, 'finished runtime closure must gate updater signing');
  assert.match(builder, /--scan-artifact "\$\{_runtime_scan_args\[@\]\}" "\$_finished_installer"/);
});

// Explicit native-producer leg: ordinary unit runs do not start Wine, but a
// release verifier can run this exact test with PAPERCUSP_TEST_REAL_INNO=1.
// Once selected, absent tools, unreadable outputs, or skipped compilation FAIL.
test('real Inno packages the mandatory stamp and refuses a missing input', {
  skip: process.env.PAPERCUSP_TEST_REAL_INNO !== '1'
    ? 'native producer leg: set PAPERCUSP_TEST_REAL_INNO=1 and PAPERCUSP_INNOEXTRACT'
    : false,
}, (t) => {
  assert.ok(stampEntry, 'production stamp entry missing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-inno-runtime-stamp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prefix = process.env.PAPERCUSP_WINE_INNO_PREFIX
    || path.join(os.homedir(), '.papercusp/wine-inno');
  const compiler = process.env.PAPERCUSP_ISCC_EXE
    || path.join(prefix, 'drive_c/InnoSetup6/ISCC.exe');
  const extractor = process.env.PAPERCUSP_INNOEXTRACT;
  assert.ok(extractor, 'select the producer-compatible extractor explicitly');
  assert.ok(fs.existsSync(compiler), `missing ISCC: ${compiler}`);
  const env = {
    ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all',
    WINEDLLOVERRIDES: 'mscoree=d;mshtml=d;winemenubuilder.exe=d',
    PAPERCUSP_RELEASE_OWNER_NAME: 'Zzsynthetic Gateowner',
  };
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 120000 });
    assert.ifError(result.error);
    return result;
  };
  const winpath = (file) => {
    const result = run('winepath', ['-w', file]);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  fs.mkdirSync(path.join(dir, 'sidecar'));
  const serve = 'visible-runtime-control\n';
  const stamp = JSON.stringify({
    serveSha256: require('node:crypto').createHash('sha256').update(serve).digest('hex'),
  });
  const input = path.join(dir, 'sidecar/.sidecar-build-stamp');
  fs.writeFileSync(input, stamp);
  fs.writeFileSync(path.join(dir, 'sidecar/serve.mjs'), serve);
  fs.writeFileSync(path.join(dir, 'sidecar/coverage.bin'), Buffer.alloc(2 * 1024 * 1024));
  const wildcard = serverFiles.split('\n').find(
    (line) => line.startsWith('Source: "{#BuildRoot}\\sidecar\\*"'),
  );
  assert.ok(wildcard, 'production runtime payload entry missing');
  const setup = [
    '[Setup]', 'AppName=Runtime stamp fixture', 'AppVersion=1.0.0',
    'DefaultDirName={localappdata}\\RuntimeStampFixture',
    'Uninstallable=no', 'PrivilegesRequired=lowest', 'Compression=none',
    'OutputDir=out', 'OutputBaseFilename=stamp', '[Files]',
    stampEntry, wildcard,
  ].join('\n').replaceAll('{#BuildRoot}', winpath(dir));
  const source = path.join(dir, 'stamp.iss');
  fs.writeFileSync(source, setup);
  const compile = () => run('xvfb-run', ['-a', 'wine', compiler, winpath(source)]);
  const built = compile();
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const destination = path.join(dir, 'extracted');
  const unpacked = run(extractor, [
    '--silent', '--extract', '--output-dir', destination, path.join(dir, 'out/stamp.exe'),
  ]);
  assert.equal(unpacked.status, 0, unpacked.stdout + unpacked.stderr);
  assert.equal(fs.readFileSync(path.join(destination, 'app/sidecar/.sidecar-build-stamp'), 'utf8'), stamp);
  assert.equal(fs.readFileSync(path.join(destination, 'app/sidecar/serve.mjs'), 'utf8'), 'visible-runtime-control\n');
  const closure = run('python3', [
    path.join(root, 'bin/audit-release-bundle.py'), '--scan-artifact',
    '--require-windows-server-runtime', path.join(dir, 'out/stamp.exe'),
  ]);
  assert.equal(closure.status, 0, closure.stdout + closure.stderr);
  assert.match(closure.stdout, /expanded via innoextract/);
  fs.unlinkSync(input);
  const missing = compile();
  assert.notEqual(missing.status, 0, 'the real producer accepted a missing mandatory runtime stamp');
  assert.match(missing.stdout + missing.stderr, /\.sidecar-build-stamp/);
});

// Execute the shipping [Code], not a JS model of its directory operations.
// The prefix and install root are disposable; no installed GUI/Server or WSL
// baseline is stopped, edited, or used as the fixture.
test('real Inno upgrade replaces owned payload, preserves data, and rolls back a failed copy', {
  skip: process.env.PAPERCUSP_TEST_REAL_INNO !== '1'
    ? 'native producer leg: set PAPERCUSP_TEST_REAL_INNO=1'
    : false,
}, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-inno-payload-upgrade-'));
  const prefix = fs.mkdtempSync(path.join(os.homedir(), '.cache/inno-upgrade-prefix-'));
  const compiler = process.env.PAPERCUSP_ISCC_EXE
    || path.join(os.homedir(), '.papercusp/wine-inno/drive_c/InnoSetup6/ISCC.exe');
  assert.ok(fs.existsSync(compiler), `missing ISCC: ${compiler}`);
  const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all',
    WINEDLLOVERRIDES: 'mscoree,mshtml,winemenubuilder.exe=' };
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', env, timeout: 120000 });
    assert.ifError(result.error);
    return result;
  };
  t.after(() => {
    run('wineserver', ['-k']);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(prefix, { recursive: true, force: true });
  });
  const winpath = (file) => {
    const r = run('winepath', ['-w', file]);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const boot = run('xvfb-run', ['-a', 'wineboot', '-i']);
  assert.equal(boot.status, 0, boot.stderr);
  const app = path.join(dir, 'installed-role');
  const sibling = path.join(dir, 'sibling-role');
  fs.mkdirSync(app);
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(app, 'user-config.json'), 'preserve-app-data');
  fs.writeFileSync(path.join(sibling, 'serve.mjs'), 'preserve-sibling');
  const input = path.join(dir, 'input.txt');
  const install = (version, entries, failCopy = false) => {
    fs.writeFileSync(input, `payload-${version}`);
    const setup = [
      '#define AppName "Papercusp GUI"', '#define AppId "com.papercusp.gui"',
      '[Setup]', 'AppId=PapercuspPayloadSelftest', 'AppName=Papercusp Payload Selftest',
      `AppVersion=${version}`, `DefaultDirName=${winpath(app)}`,
      'PrivilegesRequired=lowest', 'DisableDirPage=yes', 'DisableProgramGroupPage=yes',
      'Uninstallable=no', 'Compression=none', 'OutputDir=out', 'OutputBaseFilename=upgrade',
      '[Files]',
      ...entries.map((entry, index) => `Source: "${winpath(input)}"; `
        + `DestDir: "{app}\\${path.posix.dirname(entry).replaceAll('/', '\\')}"; `
        + `DestName: "${path.posix.basename(entry)}"; Flags: ignoreversion`
        + (failCopy && index === entries.length - 1 ? '; Check: InjectCopyFailure' : '')),
      code,
      ...(failCopy ? [
        'function InjectCopyFailure: Boolean;',
        'begin', "  RaiseException('intentional-copy-failure');", '  Result := False;', 'end;',
      ] : []),
    ].join('\n');
    const source = path.join(dir, 'upgrade.iss');
    fs.writeFileSync(source, setup);
    const built = run('xvfb-run', ['-a', 'wine', compiler, winpath(source)]);
    assert.equal(built.status, 0, (built.stdout + built.stderr).slice(-5000));
    const result = run('xvfb-run', ['-a', 'wine', winpath(path.join(dir, 'out/upgrade.exe')),
      '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/LOG=${winpath(path.join(dir, 'install.log'))}`]);
    return { status: result.status, log: fs.readFileSync(path.join(dir, 'install.log'), 'utf8') };
  };
  const first = install('1.0.0', ['sidecar/serve.mjs', 'sidecar/obsolete.js',
    'sidecar/nested/old.json', 'resources/old.bin', 'seed/old.bin']);
  assert.equal(first.status, 0, first.log.slice(-5000));
  fs.writeFileSync(path.join(app, 'sidecar/private-local-config.json'), 'preserve-nested-data');
  const second = install('2.0.0', ['sidecar/serve.mjs', 'sidecar/new.js', 'resources/new.bin']);
  assert.equal(second.status, 0, second.log.slice(-5000));
  for (const removed of ['sidecar/obsolete.js', 'sidecar/nested/old.json',
    'sidecar/private-local-config.json', 'resources/old.bin', 'seed/old.bin']) {
    assert.equal(fs.existsSync(path.join(app, removed)), false, `obsolete active payload: ${removed}`);
  }
  assert.equal(fs.readFileSync(path.join(app, 'sidecar/serve.mjs'), 'utf8'), 'payload-2.0.0');
  const backupRoot = path.join(app, '.papercusp-upgrade-backups');
  const preserved = fs.readdirSync(backupRoot).map((name) => path.join(backupRoot, name));
  assert.ok(preserved.some((backup) => fs.existsSync(path.join(backup, 'sidecar/private-local-config.json'))
    && fs.readFileSync(path.join(backup, 'sidecar/private-local-config.json'), 'utf8') === 'preserve-nested-data'),
  'unknown data inside the old payload must be retained, never recursively deleted');

  const failed = install('3.0.0', ['sidecar/serve.mjs', 'sidecar/never.txt'], true);
  assert.notEqual(failed.status, 0, 'injected copy failure was not exercised');
  assert.match(failed.log, /intentional-copy-failure/);
  assert.equal(fs.readFileSync(path.join(app, 'sidecar/serve.mjs'), 'utf8'), 'payload-2.0.0');
  assert.equal(fs.readFileSync(path.join(app, 'sidecar/new.js'), 'utf8'), 'payload-2.0.0');
  assert.equal(fs.readFileSync(path.join(app, 'resources/new.bin'), 'utf8'), 'payload-2.0.0');
  assert.equal(fs.readFileSync(path.join(app, 'user-config.json'), 'utf8'), 'preserve-app-data');
  assert.equal(fs.readFileSync(path.join(sibling, 'serve.mjs'), 'utf8'), 'preserve-sibling');
  assert.equal(fs.existsSync(path.join(app, '.papercusp-payload-rollback')), false);
});

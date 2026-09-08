const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const iss = fs.readFileSync(path.join(root, 'src-tauri', 'windows', 'inno', 'papercusp.iss'), 'utf8');
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
  const stamp = JSON.stringify({ serveSha256: 'a'.repeat(64) });
  const input = path.join(dir, 'sidecar/.sidecar-build-stamp');
  fs.writeFileSync(input, stamp);
  fs.writeFileSync(path.join(dir, 'sidecar/serve.mjs'), 'visible-runtime-control\n');
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
  fs.unlinkSync(input);
  const missing = compile();
  assert.notEqual(missing.status, 0, 'the real producer accepted a missing mandatory runtime stamp');
  assert.match(missing.stdout + missing.stderr, /\.sidecar-build-stamp/);
});

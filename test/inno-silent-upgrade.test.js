const assert = require('node:assert/strict');
const fs = require('node:fs');
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

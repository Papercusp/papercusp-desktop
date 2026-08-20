const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const vmctlPath = path.join(root, 'scripts/linux-test-vm/vmctl');
const vmctl = fs.readFileSync(vmctlPath, 'utf8');
const common = fs.readFileSync(path.join(root, 'scripts/linux-test-vm/lib/common.sh'), 'utf8');

function updaterFunction() {
  const start = vmctl.indexOf('cmd_updater_e2e()');
  const end = vmctl.indexOf('\ncmd_gui()', start);
  assert(start >= 0 && end > start, 'cmd_updater_e2e must exist before cmd_gui');
  return vmctl.slice(start, end);
}

function mainWindowVisible(tree) {
  const result = spawnSync(
    'bash',
    [
      '-c',
      'PAPERCUSP_VMCTL_SOURCE_ONLY=1 source "$1"; papercusp_window_tree_has_main',
      'bash',
      vmctlPath,
    ],
    { encoding: 'utf8', input: tree },
  );
  return result.status === 0;
}

test('updater E2E is pinned to a dedicated disposable VM lane', () => {
  const fn = updaterFunction();
  assert.match(common, /updater\) idx=3/);
  assert.match(fn, /updater\|updater-/);
  assert.match(fn, /cmd_reset "\$name"/);
  assert(fn.indexOf('cmd_reset "$name"') < fn.indexOf('cmd_up "$name"'));
  assert.match(fn, /PAPERCUSP_E2E_RUNTIME_DEB/);
  assert(fn.indexOf('cmd_install "$name" "$runtime_deb"') < fn.indexOf('vm_scp "$name" "$appimage"'));
  assert.match(common, /grep -v '\/Papercusp Server_'/);
});

test('updater E2E proves a different kernel and never seeds live home state', () => {
  const fn = updaterFunction();
  assert.match(fn, /systemd-detect-virt/);
  assert.match(fn, /guest_boot.*!=.*host_boot/);
  assert.match(fn, /PAPERCUSP_E2E_PID_ISOLATED=1/);
  assert.match(fn, /e2e_home="\$e2e_root\/home"/);
  assert.match(fn, /forbidden PID-bearing seed/);
  assert.doesNotMatch(fn, /(?:rsync|cp -a).*\.papercusp/);
});

test('guest startup validates operator birth identity against guest procfs', () => {
  const fn = updaterFunction();
  assert.match(fn, /operator\.json/);
  assert.match(fn, /processIdentity/);
  assert.match(fn, /fields\[19\]/);
  assert.match(fn, /isolation-proof\.json/);
  assert.match(fn, /operatorIdentityVerified":false/);
  assert.match(fn, /operatorIdentityVerified":true/);
  assert.match(fn, /artifact predates the.*stale-PID cleanup fix/s);
  assert(
    fn.indexOf('operatorIdentityVerified":false') < fn.indexOf('record.get("processIdentity")'),
    'kernel-isolation evidence must survive rejection of a stale artifact',
  );
});

test('VM verification accepts only a full-size Papercusp main window', () => {
  assert.equal(
    mainWindowVisible(
      '0x800242 (has no name): () 1280x800+0+0\n' +
        '  0xa00003 "Papercusp": ("papercusp-desktop" "Papercusp-desktop") 1278x775+1+20\n',
    ),
    true,
  );

  assert.equal(
    mainWindowVisible(
      '0xc00001 "papercusp-desktop": ("papercusp-desktop" "Papercusp-desktop") 10x10+10+10\n' +
        '0xa00024 "xmessage": ("xmessage" "Xmessage") 207x52+537+400\n',
    ),
    false,
    'tray/server placeholders and unrelated dialogs must not satisfy GUI verification',
  );

  assert.equal(
    mainWindowVisible(
      '0xa00003 "Papercusp": ("papercusp-desktop" "Papercusp-desktop") 799x599+1+20\n',
    ),
    false,
    'a titled placeholder below the configured minimum geometry must not pass',
  );
});

'use strict';

// Exercise the real packaging functions without a cross-compile or a real key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const sourcePath = process.env.BUILD_MAC_CROSS_SCRIPT
  || path.join(__dirname, '../bin/build-mac-cross.sh');
const source = fs.readFileSync(sourcePath, 'utf8');
function functionBody(name) {
  const start = source.indexOf(`${name}() {`);
  const terminator = name === 'gen_info_plist' ? '\nPY\n}\n' : '\n}\n';
  const end = source.indexOf(terminator, start);
  assert.ok(start >= 0 && end > start, `${name} shell function is missing`);
  return source.slice(start, end + terminator.length);
}

const packagingNames = ['gen_info_plist', 'strip_mac_signing_xattrs',
  'verify_mac_signing_xattrs', 'stage_update_helper', 'sign_app', 'make_updater', 'build_tutorial_app', 'make_dmg'];
function exportPackaging(script = sourcePath) {
  const result = spawnSync('bash', [script, '--export-packaging-functions'], {
    encoding: 'utf8', timeout: 10_000,
    // Export must precede source/toolchain/key discovery, not merely skip cargo.
    env: { ...process.env, PAPERCUSP_DESKTOP_TARGET_ROOT: '/missing-export-product-root' },
  });
  if (result.error) result.stderr += `\npackaging export subprocess: ${result.error.code}; signal=${result.signal}\n`;
  return result;
}

test('packaging export parses all selected real functions and invokes the complete plist writer', t => {
  const f = fixture(t);
  const exported = exportPackaging();
  assert.equal(exported.status, 0, exported.stdout + exported.stderr);
  for (const name of packagingNames) assert.ok(exported.stdout.includes(functionBody(name)), name);
  const parsed = spawnSync('bash', ['-n'], { input: exported.stdout, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const tauri = path.join(f.root, 'src-tauri');
  fs.mkdirSync(tauri);
  fs.writeFileSync(path.join(tauri, 'tauri.conf.json'), JSON.stringify({
    bundle: { macOS: { minimumSystemVersion: '14.0' } },
  }));
  const user = spawnSync('python3', ['-c',
    'import plistlib,sys;plistlib.dump({},open(sys.argv[1],"wb"))', path.join(tauri, 'Info.plist')],
  { encoding: 'utf8' });
  assert.equal(user.status, 0, user.stderr);
  const out = path.join(f.root, 'generated.plist');
  const invoked = spawnSync('bash', ['-c', [
    'set -euo pipefail', exported.stdout,
    ...packagingNames.map(name => `declare -F ${name} >/dev/null`),
    'gen_info_plist com.papercusp.server "Papercusp Server" "$PLIST_OUT"',
  ].join('\n')], { encoding: 'utf8', timeout: 10_000,
    env: { ...f.env, SRC_TAURI: tauri, DARWIN_SIDECAR: f.root,
      PAPERCUSP_DARWIN_NATIVE_INPUTS: '', PLIST_OUT: out } });
  assert.equal(invoked.status, 0, invoked.stdout + invoked.stderr);
  const read = spawnSync('python3', ['-c',
    'import plistlib,json,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))', out],
  { encoding: 'utf8' });
  assert.equal(read.status, 0, read.stderr);
  const actual = JSON.parse(read.stdout);
  assert.equal(actual.CFBundleIdentifier, 'com.papercusp.server');
  assert.equal(actual.LSMinimumSystemVersion, '14.0');

  // Exact D200 counterfactual: the first brace truncates the Python heredoc.
  const old = packagingNames.map(name => {
    const start = source.indexOf(`${name}() {`);
    return source.slice(start, source.indexOf('\n}\n', start) + 3);
  }).join('\n');
  const refused = spawnSync('bash', ['-n'], { input: old, encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /here-document|unexpected end/);
});

test('packaging export refuses a missing selected-function boundary before emitting any code', t => {
  const f = fixture(t);
  const changed = path.join(f.root, 'changed-producer.sh');
  // Still valid Bash; the export boundary contract has changed and needs review.
  fs.writeFileSync(changed, source.replace('\nPY\n}\n', '\nPY\n }\n'));
  const whole = spawnSync('bash', ['-n', changed], { encoding: 'utf8' });
  assert.equal(whole.status, 0, whole.stderr);
  const refused = exportPackaging(changed);
  assert.notEqual(refused.status, 0);
  assert.equal(refused.stdout, '');
  assert.match(refused.stderr, /substring not found/);
});

for (const name of packagingNames) {
  test(`packaging export rejects invalid ${name} code before emitting any function`, t => {
    const f = fixture(t);
    const changed = path.join(f.root, 'invalid-producer.sh');
    fs.writeFileSync(changed, source.replace(`${name}() {`, `${name}() {\n)`));
    const refused = exportPackaging(changed);
    assert.notEqual(refused.status, 0);
    assert.equal(refused.stdout, '');
    assert.match(refused.stderr, /syntax error/);
  });
}

function fixture(t, { inheritedPath = true, password = '', mode = 'sign', stale = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-cross-signing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const out = path.join(root, 'bundle');
  const app = path.join(out, 'macos/Papercusp GUI.app');
  const key = path.join(root, 'fixture.key');
  const record = path.join(root, 'signer.json');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(out, 'dmg'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents/MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents/MacOS/papercusp-desktop'), 'fixture-binary');
  fs.writeFileSync(key, 'fixture-key-content');
  const script = (name, body) => fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  script('dd', '#!/bin/sh\nexit 0\n');
  script('mkfs.hfsplus', '#!/bin/sh\nexit 0\n');
  script('hfsplus', '#!/bin/sh\nexit 0\n');
  script('dmg', '#!/bin/sh\nprintf fixture-dmg > "$2"\n');
  script('7z', '#!/bin/sh\nprintf "%s\\n" "Papercusp GUI.app/Contents/MacOS/papercusp-desktop"\n');
  const preflight = path.join(root, 'preflight.py');
  fs.writeFileSync(preflight, 'import sys\nprint("fixture-qualified")\n');
  script('npx', `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const env = process.env;
const pathIndex = args.indexOf('--private-key-path');
const passwordIndex = args.indexOf('--password');
const content = env.TAURI_SIGNING_PRIVATE_KEY;
const keyPath = env.TAURI_SIGNING_PRIVATE_KEY_PATH || args[pathIndex + 1];
const hasPath = Boolean(env.TAURI_SIGNING_PRIVATE_KEY_PATH) || pathIndex >= 0;
if (content && hasPath) {
  console.error('conflicting private key content and path');
  process.exit(2);
}
const actualKey = content || (hasPath && fs.readFileSync(keyPath, 'utf8'));
const actualPassword = passwordIndex >= 0 ? args[passwordIndex + 1] : env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
fs.writeFileSync(env.SIGNER_RECORD, JSON.stringify({
  args, keyMatches: actualKey === 'fixture-key-content',
  passwordMatches: actualPassword === env.EXPECT_PASSWORD,
  contentPresent: Boolean(content), inheritedPathPresent: Boolean(env.TAURI_SIGNING_PRIVATE_KEY_PATH),
}));
if (actualKey !== 'fixture-key-content') process.exit(3);
if (env.SIGNER_MODE === 'fail') process.exit(9);
if (env.SIGNER_MODE === 'sign') fs.writeFileSync(args.at(-1) + '.sig', 'fixture-signature');
if (env.SIGNER_MODE === 'empty') fs.writeFileSync(args.at(-1) + '.sig', '');
`);
  const dmg = path.join(out, 'dmg/Papercusp GUI_0.0.26_x64.dmg');
  if (stale) fs.writeFileSync(dmg + '.sig', 'stale-signature');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: root, ROOT: root, OUT_BUNDLE: out, APP: app,
    HERE: path.dirname(sourcePath), PAPERCUSP_HFSPLUS_TOOL_CACHE: path.join(root, 'tool-cache'),
    DARWIN_SIDECAR: root, SRC_TAURI: root,
    VERSION: '0.0.26', DMG_ARCH: 'x64', MAC_CERT_P12: '',
    DMG_TOOL: path.join(bin, 'dmg'), HFSPLUS_TOOL: path.join(bin, 'hfsplus'),
    PAPERCUSP_HFSPLUS_PREFLIGHT_SCRIPT: preflight,
    PAPERCUSP_RELEASE_RETENTION_ROOT: path.join(root, 'retention'),
    PAPERCUSP_RELEASE_DELETION_AUDIT_PATH: path.join(root, 'deletion-audit.tsv'),
    PAPERCUSP_DISK_RESERVATION_DIR: path.join(root, 'reservations'),
    PAPERCUSP_DMG_NO_MOUNT: '1', TAURI_CLI_VERSION: '2.11.0',
    KEY_FILE: key, KEY_PASSWORD: password,
    SIGNER_RECORD: record, SIGNER_MODE: mode, EXPECT_PASSWORD: password };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (inheritedPath) env.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
  return { root, app, out, key, dmg, record, env, inheritedPath };
}

function run(f, name = 'make_dmg') {
  const exported = exportPackaging();
  assert.equal(exported.status, 0, exported.stdout + exported.stderr);
  return spawnSync('bash', ['-c', [
    'set -euo pipefail',
    'fail() { echo "ERROR: $*" >&2; exit 1; }',
    exported.stdout,
    'build_tutorial_app() { :; }',
    `${name} "$APP" 'Papercusp GUI'`,
    'if [[ "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" == "$KEY_FILE" ]]; then echo CALLER_PATH_PRESERVED; fi',
  ].join('\n')], { encoding: 'utf8', timeout: 10_000, env: f.env });
}

// Exercise administrator delivery effects without root or a Mac. Only this
// copy substitutes system paths/Apple tools; production has no test-root knob.
function adminFixture(t, mode) {
  const f = fixture(t);
  const system = path.join(f.root, 'system');
  for (const dir of ['private/var/root', 'private/etc', 'Library']) {
    fs.mkdirSync(path.join(system, dir), { recursive: true, mode: 0o755 });
  }
  const tools = path.join(f.root, 'admin-tools');
  fs.mkdirSync(tools);
  const calls = path.join(f.root, 'admin-calls');
  const tool = (name, body) => {
    const file = path.join(tools, name);
    fs.writeFileSync(file, '#!' + process.execPath + '\n' + body, { mode: 0o755 });
    return file;
  };
  const replacements = new Map([
    ['/usr/bin/uname', tool('uname', `console.log('Darwin')`)],
    ['/usr/bin/id', tool('id', `console.log(process.env.ADMIN_MODE==='non-root'?'501':'0')`)],
    ['/usr/bin/stat', tool('stat', `
const fs=require('node:fs'),args=process.argv.slice(2),s=fs.lstatSync(args.at(-1));
console.log(args[1]==='%u'?'0':(s.mode&0o7777).toString(8));`)],
    ['/bin/ls', tool('ls', `console.log(process.env.ADMIN_MODE==='acl'?'0: everyone allow write':'no ACL grants')`)],
    // Unit effects must never flush the shared build host's entire filesystem.
    // This fixture does not qualify native persistence or Apple trust services.
    ['/bin/sync', tool('sync', 'process.exit(0)')],
  ]);
  for (const name of ['codesign', 'pkgutil', 'spctl', 'installer']) {
    replacements.set((name === 'codesign' ? '/usr/bin/' : '/usr/sbin/') + name, tool(name, `
const fs=require('node:fs'),path=require('node:path'),name=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.ADMIN_CALLS,JSON.stringify({name,args})+'\\n');
if(process.env.ADMIN_MODE===name+'-fail')process.exit(9);
if(name==='codesign'&&!args[args.indexOf('-R')+1].includes('subject.OU] = "ABC1234567"'))process.exit(10);
if(name==='spctl')console.error('origin=Developer ID Installer: Fixture ('+(process.env.ADMIN_MODE==='wrong-team'?'WRONG12345':'ABC1234567')+')');
if(name==='installer'){
 const bytes=fs.readFileSync(args[args.indexOf('-pkg')+1],'utf8');
 fs.writeFileSync(process.env.ADMIN_INSTALLED,bytes);
}
// Change the original only AFTER its private copy was approved.
if(process.env.ADMIN_MODE==='source-swap'&&(name==='codesign'||name==='spctl'))fs.writeFileSync(process.env.ADMIN_INPUT,'swapped attacker bytes');
`));
  }
  let library = fs.readFileSync(path.join(__dirname, '../bin/lib/mac-protected-installer.sh'), 'utf8');
  library = library.replaceAll('/private', system + '/private').replaceAll('/Library', system + '/Library');
  for (const [before, after] of replacements) library = library.replaceAll(before, after);
  const copy = path.join(f.root, 'admin-library.sh');
  fs.writeFileSync(copy, library);
  const input = path.join(f.root, 'candidate');
  const policy = path.join(f.root, 'policy');
  fs.writeFileSync(input, 'administrator approved candidate');
  fs.writeFileSync(policy, '{"version":1,"administrator":"fixture"}');
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const expected = digest(input), policyExpected = digest(policy);
  const helper = path.join(system, 'Library/PrivilegedHelperTools/com.papercusp.update-installer');
  const targetPolicy = path.join(system, 'private/etc/papercusp/managed-policy.json');
  if (mode === 'writable-ancestor') fs.chmodSync(path.join(system, 'private/var/root'), 0o777);
  if (mode === 'existing' || mode === 'alias') {
    fs.mkdirSync(path.dirname(helper));
    if (mode === 'existing') fs.writeFileSync(helper, 'existing administrator trust');
    else fs.symlinkSync(input, helper);
  }
  const installed = path.join(f.root, 'installer-effect');
  const invoke = operation => {
    const result = spawnSync('bash', ['-x', '-c',
    'source "$ADMIN_LIBRARY"\n' + (operation === 'bootstrap'
      ? 'bootstrap_protected_mac_verifier "$ADMIN_INPUT" "$ADMIN_POLICY" "$ADMIN_EXPECTED" "$ADMIN_POLICY_EXPECTED" "$ADMIN_TEAM"'
      : 'install_protected_mac_package "$ADMIN_INPUT" "$ADMIN_EXPECTED" "$ADMIN_TEAM"')],
  { encoding: 'utf8', timeout: 10_000, env: { ...f.env, ADMIN_LIBRARY: copy,
    ADMIN_MODE: mode, ADMIN_CALLS: calls, ADMIN_INPUT: input, ADMIN_POLICY: policy,
    ADMIN_EXPECTED: mode === 'hash' ? '0'.repeat(64) : expected,
    ADMIN_POLICY_EXPECTED: mode === 'policy-hash' ? '0'.repeat(64) : policyExpected,
    ADMIN_TEAM: mode === 'invalid-team' ? 'TEAM" OR true' : 'ABC1234567', ADMIN_INSTALLED: installed } });
    // Neither a timeout nor a signal is evidence of a deliberate refusal.
    assert.equal(result.error, undefined, `${result.error || ''}\n${result.stderr}`);
    assert.equal(result.signal, null, result.stderr);
    return result;
  };
  return { ...f, invoke, helper, targetPolicy, input, installed, calls };
}

for (const mode of ['normal', 'source-swap', 'hash', 'policy-hash', 'invalid-team', 'non-root', 'acl', 'writable-ancestor', 'codesign-fail', 'existing', 'alias']) {
  test(`independent administrator bootstrap authorizes only pinned copied bytes: ${mode}`, t => {
    const f = adminFixture(t, mode);
    const result = f.invoke('bootstrap');
    if (mode === 'normal' || mode === 'source-swap') {
      assert.equal(result.status, 0, `${result.error || ''}; signal=${result.signal}\n${result.stdout}${result.stderr}`);
      assert.equal(fs.readFileSync(f.helper, 'utf8'), 'administrator approved candidate');
      assert.equal(fs.readFileSync(f.targetPolicy, 'utf8'), '{"version":1,"administrator":"fixture"}');
      assert.equal(fs.statSync(f.helper).nlink, 1);
      assert.equal(fs.statSync(f.helper).mode & 0o777, 0o755);
      assert.equal(fs.statSync(f.targetPolicy).mode & 0o777, 0o644);
      // A second bootstrap may not replace already established trust.
      assert.notEqual(f.invoke('bootstrap').status, 0);
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.existsSync(f.targetPolicy), false);
      if (mode === 'existing') assert.equal(fs.readFileSync(f.helper, 'utf8'), 'existing administrator trust');
      else if (mode === 'alias') assert.equal(fs.lstatSync(f.helper).isSymbolicLink(), true);
      else assert.equal(fs.existsSync(f.helper), false);
    }
  });
}

for (const mode of ['normal', 'source-swap', 'hash', 'invalid-team', 'non-root', 'acl', 'writable-ancestor', 'pkgutil-fail', 'spctl-fail', 'wrong-team']) {
  test(`trusted delivery authenticates outer package before root scripts: ${mode}`, t => {
    const f = adminFixture(t, mode);
    const result = f.invoke('package');
    if (mode === 'normal' || mode === 'source-swap') {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.readFileSync(f.installed, 'utf8'), 'administrator approved candidate');
      const calls = fs.readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse);
      assert.deepEqual(calls.map(c => c.name), ['pkgutil', 'spctl', 'installer']);
      assert.notEqual(calls[2].args[1], f.input);
      assert.deepEqual(calls[2].args.slice(-2), ['-target', '/']);
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.existsSync(f.installed), false, 'no root package scripts may run before approval');
    }
  });
}

for (const operation of ['--bootstrap-protected-verifier', '--install-protected-package']) {
  test(`native administrator entry point refuses incomplete authorization before build setup: ${operation}`, () => {
    const result = spawnSync('bash', [path.join(__dirname, '../bin/mac-vm-build.sh'), operation],
      { encoding: 'utf8', timeout: 10_000, env: { ...process.env, PAPERCUSP_DESKTOP_TARGET_ROOT: '/missing-admin-dispatch' } });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /independently approved/);
    assert.equal(result.stdout, '');
  });
}

for (const mode of ['normal', 'missing-identity', 'unattributed', 'wrong-artifact',
  'wrong-helper', 'wrong-platform', 'codesign-fail', 'productsign-fail', 'pkgutil-fail']) {
  test(`administrator package binds the existing approved request and validates signing: ${mode}`, t => {
    const f = fixture(t);
    const helperDir = path.join(f.app, 'Contents/Library/HelperTools');
    fs.mkdirSync(helperDir, { recursive: true });
    const helper = path.join(helperDir, 'com.papercusp.update-installer');
    fs.writeFileSync(helper, 'approved-helper');
    const plist = spawnSync('python3', ['-c',
      'import plistlib,sys;plistlib.dump(dict(CFBundleIdentifier="com.papercusp.gui",CFBundleShortVersionString="1.2.3"),open(sys.argv[1],"wb"))',
      path.join(f.app, 'Contents/Info.plist')], { encoding: 'utf8' });
    assert.equal(plist.status, 0, plist.stderr);
    const archive = path.join(f.root, 'approved.tar.gz');
    const packed = spawnSync('tar', ['-czf', archive, '-C', path.dirname(f.app), path.basename(f.app)], { encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const artifact = fs.readFileSync(archive);
    if (mode === 'wrong-helper') fs.writeFileSync(helper, 'unapproved-replacement');
    const manifest = path.join(f.root, 'manifest.json');
    const metadata = { product: 'com.papercusp.gui', version: '1.2.3', platform: 'darwin-x86_64',
      authorIds: mode === 'unattributed' ? [] : ['fixture-author'],
      artifactSha256: mode === 'wrong-artifact' ? '0'.repeat(64) : createHash('sha256').update(artifact).digest('hex') };
    // These framing fixtures do not claim signature authenticity. Native tests
    // exercise real independent signatures and CURRENT-policy refusal.
    const data = { updateAuthorization: { payload: Buffer.from(JSON.stringify(metadata)).toString('base64'),
      signature: 'fixture-release-signature', approvalSignature: 'fixture-independent-signature' } };
    fs.writeFileSync(manifest, JSON.stringify(data));
    for (const tool of ['codesign', 'pkgbuild', 'productsign', 'pkgutil']) {
      fs.writeFileSync(path.join(f.root, 'bin', tool), `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const tool=path.basename(process.argv[1]),args=process.argv.slice(2);
fs.appendFileSync(process.env.PKG_CALLS,JSON.stringify({tool,args})+'\\n');
if(process.env.PKG_MODE===tool+'-fail')process.exit(9);
if(tool==='pkgbuild') {
 if(!args.includes('--nopayload')||args.includes('--root'))throw new Error('candidate package may not install its verifier');
 const scripts=args[args.indexOf('--scripts')+1];
 fs.copyFileSync(path.join(scripts,'approved-request'),process.env.PKG_REQUEST);
 for(const name of ['preinstall','postinstall'])fs.copyFileSync(path.join(scripts,name),process.env.PKG_REQUEST+'.'+name);
 fs.writeFileSync(args.at(-1),'unsigned-package');
}
if(tool==='productsign')fs.copyFileSync(args.at(-2),args.at(-1));
`, { mode: 0o755 });
    }
    const request = path.join(f.root, 'request');
    const calls = path.join(f.root, 'pkg-calls');
    const output = path.join(f.root, 'Papercusp GUI.pkg');
    const result = spawnSync('bash', ['-c',
      'source "$PKG_LIBRARY"\nmake_protected_mac_package "$APP" "$PKG_ARCHIVE" "$PKG_MANIFEST" "$PKG_PLATFORM" "$PKG_OUTPUT"'],
    { encoding: 'utf8', timeout: 10_000, env: { ...f.env,
      PKG_LIBRARY: path.join(__dirname, '../bin/lib/mac-protected-installer.sh'),
      MAC_INSTALLER_SIGNING_IDENTITY: mode === 'missing-identity' ? '' : 'Developer ID Installer: Fixture',
      PKG_ARCHIVE: archive, PKG_MANIFEST: manifest, PKG_PLATFORM: mode === 'wrong-platform' ? 'linux-x86_64' : 'darwin-x86_64',
      PKG_OUTPUT: output, PKG_CALLS: calls, PKG_REQUEST: request, PKG_MODE: mode } });
    if (mode !== 'normal') {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.equal(fs.existsSync(output), false, 'failed packaging must not publish an installer');
      return;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(output, 'utf8'), 'unsigned-package'); // signer is mocked
    const frame = fs.readFileSync(request);
    const length = frame.readUInt32BE(0);
    assert.equal(frame.readBigUInt64BE(4), BigInt(artifact.length));
    assert.deepEqual(JSON.parse(frame.subarray(12, 12 + length)), {
      manifest: data, version: '1.2.3', product: 'com.papercusp.gui', platform: 'darwin-x86_64',
    });
    assert.deepEqual(frame.subarray(12 + length), artifact);
    const recorded = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(recorded.map(c => c.tool), ['codesign', 'codesign', 'pkgbuild', 'productsign', 'pkgutil']);
    assert.ok(recorded[1].args.includes('-R'));
    assert.ok(recorded[2].args.includes('--nopayload'));
    assert.equal(recorded[2].args.includes('--root'), false);
    for (const script of ['preinstall', 'postinstall']) {
      const parsed = spawnSync('sh', ['-n', request + '.' + script], { encoding: 'utf8' });
      assert.equal(parsed.status, 0, parsed.stderr);
    }
    assert.match(fs.readFileSync(request + '.postinstall', 'utf8'), /com\.papercusp\.update-installer --provision/);
    assert.match(fs.readFileSync(request + '.postinstall', 'utf8'), /< "\$scripts\/approved-request"/);
    assert.match(fs.readFileSync(request + '.preinstall', 'utf8'), /candidate package cannot bootstrap its own verifier/);
  });
}

for (const mode of ['normal', 'missing-cert', 'aliased-cert', 'missing', 'symlink', 'linux', 'sign-fail', 'verify-fail']) {
  test(`protected update helper staging and signature validation: ${mode}`, t => {
    const f = fixture(t);
    const binary = path.join(f.root, 'helper');
    const certificate = path.join(f.root, 'developer-id.p12');
    fs.writeFileSync(certificate, 'fixture-certificate');
    if (mode === 'aliased-cert') {
      fs.renameSync(certificate, certificate + '.actual');
      fs.symlinkSync(certificate + '.actual', certificate);
    }
    // A non-executed Mach-O header lets the real file classifier distinguish
    // this local packaging fixture from a Linux executable. Signing is mocked.
    const bytes = Buffer.alloc(32);
    bytes.writeUInt32LE(0xfeedfacf); bytes.writeUInt32LE(0x01000007, 4);
    bytes.writeUInt32LE(3, 8); bytes.writeUInt32LE(2, 12);
    if (mode !== 'missing') fs.writeFileSync(binary, mode === 'linux' ? 'Linux helper' : bytes);
    if (mode === 'symlink') {
      fs.renameSync(binary, binary + '.actual'); fs.symlinkSync(binary + '.actual', binary);
    }
    const calls = path.join(f.root, 'helper-calls.jsonl');
    fs.writeFileSync(path.join(f.root, 'bin/rcodesign'), `#!/usr/bin/env node
const fs=require('node:fs'); const args=process.argv.slice(2);
fs.appendFileSync(process.env.HELPER_CALLS, JSON.stringify(args)+'\\n');
if (process.env.HELPER_MODE===args[0]+'-fail') process.exit(9);
`, { mode: 0o755 });
    const exported = exportPackaging();
    assert.equal(exported.status, 0, exported.stderr);
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'fail() { echo "ERROR: $*" >&2; exit 1; }', exported.stdout,
      'stage_update_helper "$HELPER_BINARY" "$APP"',
    ].join('\n')], { encoding: 'utf8', timeout: 10_000,
      env: { ...f.env, MAC_CERT_P12: mode === 'missing-cert' ? '' : certificate,
        HELPER_BINARY: binary, HELPER_CALLS: calls, HELPER_MODE: mode } });
    const helper = path.join(f.app, 'Contents/Library/HelperTools/com.papercusp.update-installer');
    if (mode === 'normal') {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(fs.readFileSync(helper), bytes);
      assert.equal(fs.statSync(helper).mode & 0o777, 0o755);
      assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse),
        [['sign', '--for-notarization', '--binary-identifier', 'com.papercusp.update-installer',
          '--p12-file', certificate, '--p12-password', '', helper], ['verify', helper]]);
    } else {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /protected update helper/);
      if (['missing-cert', 'aliased-cert', 'missing', 'symlink', 'linux'].includes(mode)) {
        assert.equal(fs.existsSync(helper), false);
        assert.equal(fs.existsSync(calls), false);
      }
    }
  });
}

test('DMG packaging rejects an unsafe allocator before copying or allocating the app image', t => {
  const f = fixture(t);
  fs.writeFileSync(f.env.PAPERCUSP_HFSPLUS_PREFLIGHT_SCRIPT,
    'import sys\nprint("catalog offset wrapped", file=sys.stderr)\nsys.exit(1)\n');
  fs.writeFileSync(path.join(f.root, 'bin/curl'), '#!/bin/sh\nexit 8\n', { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/dd'), '#!/bin/sh\ntouch "$ROOT/image-started"\n', { mode: 0o755 });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /catalog offset wrapped/);
  assert.match(result.stderr, /HFS allocation preflight failed/);
  assert.equal(fs.existsSync(path.join(f.root, 'image-started')), false);
  assert.equal(fs.existsSync(f.dmg), false);
});

for (const name of ['DARWIN_SIDECAR', 'SRC_TAURI']) {
  test(`DMG packaging requires ${name} before any tool or image phase`, t => {
    const f = fixture(t);
    delete f.env[name];
    fs.writeFileSync(f.env.PAPERCUSP_HFSPLUS_PREFLIGHT_SCRIPT,
      'import os\nopen(os.environ["ROOT"]+"/preflight-started","w").write("started")\n');
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`requires ${name}`));
    assert.equal(fs.existsSync(path.join(f.root, 'preflight-started')), false);
    assert.equal(fs.existsSync(f.dmg), false);
  });
}

for (const phase of ['mkfs', 'addall', 'chmod', 'convert']) {
  test(`DMG packaging retains ${phase} failure diagnostics and refuses signing`, t => {
    const f = fixture(t);
    const bin = path.join(f.root, 'bin');
    const message = `${phase}-direct-utility-cause`;
    if (phase === 'mkfs') {
      fs.writeFileSync(path.join(bin, 'mkfs.hfsplus'), `#!/bin/sh\necho ${message} >&2\nexit 8\n`, { mode: 0o755 });
    } else if (phase === 'convert') {
      fs.writeFileSync(path.join(bin, 'dmg'), `#!/bin/sh\necho ${message} >&2\nexit 8\n`, { mode: 0o755 });
    } else {
      fs.writeFileSync(path.join(bin, 'hfsplus'),
        `#!/bin/sh\nif [ "$2" = "${phase}" ]; then echo ${message} >&2; exit 8; fi\nexit 0\n`, { mode: 0o755 });
      if (phase === 'chmod') fs.chmodSync(path.join(f.app, 'Contents/MacOS/papercusp-desktop'), 0o755);
    }
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(message));
    assert.equal(fs.existsSync(f.record), false);
    const logs = path.join(f.out, 'dmg/diagnostics');
    const attempt = fs.readdirSync(logs);
    assert.equal(attempt.length, 1);
    assert.match(fs.readFileSync(path.join(logs, attempt[0], `${phase}.log`), 'utf8'), new RegExp(message));
    const leases = fs.readdirSync(f.env.PAPERCUSP_RELEASE_RETENTION_ROOT)
      .filter(name => name.startsWith('lease-'));
    assert.equal(leases.length, 1, 'failed packaging must retain its scratch lease');
    const lease = fs.readFileSync(path.join(f.env.PAPERCUSP_RELEASE_RETENTION_ROOT, leases[0]), 'utf8');
    const paths = lease.split('\n').filter(line => line.startsWith('path=')).map(line => line.slice(5));
    assert.equal(paths.length, 3);
    assert.ok(paths.every(p => fs.existsSync(p)), 'lease binds preserved stage, raw image, and diagnostics');
    assert.ok(Number(lease.match(/^expires_ns=(\d+)$/m)[1]) > Date.now() * 1e6, 'failure lease has a bounded lifetime');
  });
}

for (const explicit of [false, true]) {
  test(`DMG temporary files use ${explicit ? 'explicit TMPDIR' : 'the output volume by default'}`, t => {
    const f = fixture(t);
    if (!explicit) delete f.env.TMPDIR;
    const expected = explicit ? f.root : path.join(f.out, 'dmg');
    const record = path.join(f.root, 'temporary-roots');
    f.env.TEMP_ROOT_RECORD = record;
    const realMktemp = spawnSync('sh', ['-c', 'command -v mktemp'], { encoding: 'utf8' }).stdout.trim();
    assert.ok(realMktemp, 'mktemp must be on PATH');
    fs.writeFileSync(path.join(f.root, 'bin/mktemp'), `#!/bin/sh
printf '%s\\n' "\${TMPDIR:-/tmp}" >> "$TEMP_ROOT_RECORD"
exec ${JSON.stringify(realMktemp)} "$@"
`, { mode: 0o755 });
    const result = run(f);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const roots = fs.readFileSync(record, 'utf8').trim().split('\n');
    assert.ok(roots.length >= 2, 'stage and image must allocate temporary paths');
    assert.ok(roots.every(root => root === expected), JSON.stringify(roots));
    assert.equal(fs.existsSync(f.dmg + '.sig'), true);
  });
}

test('DMG packaging refuses insufficient scratch space before allocating an image', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'bin/df'),
    '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 100 100 0 100%% /fixture\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/dd'), '#!/bin/sh\ntouch "$ROOT/image-started"\n', { mode: 0o755 });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /insufficient disk/);
  assert.equal(fs.existsSync(path.join(f.root, 'image-started')), false);
  assert.equal(fs.existsSync(f.env.PAPERCUSP_RELEASE_RETENTION_ROOT), false);
});

test('DMG packaging reserves concurrent scratch and output footprint on a shared filesystem', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'bin/df'),
    '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 40000000 0 18874368 0%% /fixture\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/du'), '#!/bin/sh\nprintf "5368709120\\tfixture\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/dd'), '#!/bin/sh\ntouch "$ROOT/image-started"\n', { mode: 0o755 });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DMG scratch and output/);
  assert.equal(fs.existsSync(path.join(f.root, 'image-started')), false);
});

test('DMG packaging checks output space separately when scratch is on another filesystem', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'bin/df'), `#!/bin/sh
case "$2" in *bundle/dmg*) available=0; mount=/output ;; *) available=8388608; mount=/scratch ;; esac
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 10000000 0 %s 0%% %s\\n' "$available" "$mount"
`, { mode: 0o755 });
  // papercusp_mount_key prefers the stat device id over df's mount column (f7eb5332), so a
  // separate output filesystem must be faked at the device-id layer too; any other stat call
  // goes to the real binary.
  const realStat = spawnSync('sh', ['-c', 'command -v stat'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realStat, 'stat must be on PATH');
  fs.writeFileSync(path.join(f.root, 'bin/stat'), `#!/bin/sh
if [ "$1" = -L ] && [ "$2" = -c ] && [ "$3" = %d ]; then
  case "$4" in *bundle/dmg*) echo 2 ;; *) echo 1 ;; esac
  exit 0
fi
exec ${JSON.stringify(realStat)} "$@"
`, { mode: 0o755 });
  fs.writeFileSync(path.join(f.root, 'bin/dd'), '#!/bin/sh\ntouch "$ROOT/image-started"\n', { mode: 0o755 });
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DMG output disk reservation failed/);
  assert.equal(fs.existsSync(path.join(f.root, 'image-started')), false);
});

test('successful DMG conversion releases scratch leases and filesystem reservations', t => {
  const f = fixture(t);
  const result = run(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(fs.readdirSync(f.env.PAPERCUSP_RELEASE_RETENTION_ROOT).filter(n => n.startsWith('lease-')), []);
  const reservations = fs.existsSync(f.env.PAPERCUSP_DISK_RESERVATION_DIR)
    ? fs.readdirSync(f.env.PAPERCUSP_DISK_RESERVATION_DIR).flatMap(n =>
      fs.readdirSync(path.join(f.env.PAPERCUSP_DISK_RESERVATION_DIR, n)).filter(p => p.endsWith('.res')))
    : [];
  assert.deepEqual(reservations, []);
});

test('allocation preflight rejects catalog corruption even when the HFS utility reports success', t => {
  const f = fixture(t);
  const mkfs = path.join(f.root, 'fake-mkfs');
  const tool = path.join(f.root, 'fake-hfsplus');
  fs.writeFileSync(mkfs, `#!/usr/bin/env python3
import struct,sys
with open(sys.argv[-1],'r+b') as f:
 h=bytearray(512);h[:2]=b'H+';struct.pack_into('>II',h,40,4096,1310720)
 struct.pack_into('>I',h,128,2);struct.pack_into('>I',h,288,10)
 f.seek(1024);f.write(h);f.seek(40960);f.write(b'C'*4096)
`, { mode: 0o755 });
  fs.writeFileSync(tool, `#!/usr/bin/env python3
import os,sys
if sys.argv[2]=='add':
 if os.environ.get('CORRUPT')=='1':
  with open(sys.argv[1],'r+b') as f:f.seek(40960);f.write(bytes(4096))
 else:
  # A valid catalog insertion changes header counters, not the descriptor.
  with open(sys.argv[1],'r+b') as f:f.seek(40960+14);f.write(b'D'*16)
else:
 open(sys.argv[4],'wb').write(bytes(range(256))*16)
`, { mode: 0o755 });
  const helper = path.join(__dirname, '../bin/lib/hfsplus-allocation-preflight.py');
  for (const corrupt of ['1', '0']) {
    const result = spawnSync('python3', [helper, '--tool', tool, '--mkfs', mkfs, '--work-root', f.root],
      { encoding: 'utf8', env: { ...process.env, CORRUPT: corrupt }, timeout: 10_000 });
    if (corrupt === '1') {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /corrupted its catalog/);
    } else {
      assert.equal(result.status, 0, result.stdout + result.stderr);
      const proof = JSON.parse(result.stdout);
      assert.ok(proof.physicalOffset > 2 ** 32);
      assert.equal(proof.catalogDescriptorPreserved, true);
      assert.notEqual(proof.catalogBeforeSha256, proof.catalogAfterSha256);
    }
  }
});

for (const mode of ['normal', 'companion-change', 'shallow-change', 'pre-sign-change', 'generation-change', 'deep-fail', 'shallow-fail']) {
  test(`app signing seals the final PUI generation and rejects ${mode} corruption`, t => {
    const f = fixture(t);
    const sidecar = path.join(f.app, 'Contents/Resources/sidecar');
    fs.mkdirSync(path.join(sidecar, 'bin'), { recursive: true });
    const binary = path.join(sidecar, 'bin/pui');
    const companion = path.join(sidecar, 'pui-companion.wasm');
    const manifest = path.join(sidecar, 'pui-install.json');
    fs.writeFileSync(binary, 'unsigned PUI');
    fs.writeFileSync(companion, 'fixed companion');
    const helper = process.env.PUI_MANIFEST_HELPER || path.resolve(__dirname, '../../apps/tui/scripts/write-install-manifest.py');
    const product = path.join(f.root, 'tooling');
    const selectedHelper = path.join(product, 'apps/tui/scripts/write-install-manifest.py');
    fs.mkdirSync(path.dirname(selectedHelper), { recursive: true });
    fs.copyFileSync(helper, selectedHelper);
    const here = path.join(product, 'papercusp-desktop/bin');
    fs.mkdirSync(path.join(here, 'lib'), { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../bin/lib/source-roots.sh'), path.join(here, 'lib/source-roots.sh'));
    const write = spawnSync('python3', [helper, 'write', '--manifest', manifest,
      '--binary', binary, '--companion', companion, '--relative-paths', '--source-sha', 'fixture-source',
      '--source-dirty', '0', '--built-at-epoch', '1', '--version', 'fixture-version', '--target', 'darwin-x64'], { encoding: 'utf8' });
    assert.equal(write.status, 0, write.stdout + write.stderr);
    const original = JSON.parse(fs.readFileSync(manifest));
    if (mode === 'pre-sign-change') fs.appendFileSync(binary, 'unexpected');
    fs.writeFileSync(path.join(f.root, 'bin/rcodesign'), `#!/usr/bin/env node
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const args=process.argv.slice(2), app=args.at(-1), shallow=args.includes('--shallow');
const sidecar=path.join(app,'Contents/Resources/sidecar'), manifest=path.join(sidecar,'pui-install.json');
fs.appendFileSync(process.env.SIGNING_CALLS, shallow ? 'shallow\\n' : 'deep\\n');
if (process.env.PUI_SIGNING_MODE===(shallow?'shallow-fail':'deep-fail')) {
  console.error('insufficient room to write code signature load command'); process.exit(8);
}
if (!shallow || process.env.PUI_SIGNING_MODE==='shallow-change') fs.appendFileSync(path.join(sidecar,'bin/pui'),'signature');
if (process.env.PUI_SIGNING_MODE==='companion-change') fs.appendFileSync(path.join(sidecar,'pui-companion.wasm'),'corruption');
if (process.env.PUI_SIGNING_MODE==='generation-change') { const j=JSON.parse(fs.readFileSync(manifest)); j.binarySha256='wrong'; fs.writeFileSync(manifest,JSON.stringify(j)); }
fs.mkdirSync(path.join(app,'Contents/_CodeSignature'),{recursive:true});
fs.writeFileSync(path.join(app,'Contents/_CodeSignature/CodeResources'),crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'));
`, { mode: 0o755 });
    Object.assign(f.env, { HERE: here, REPO_ROOT: path.join(f.root, 'pinned-product-with-older-writer'),
      ENTITLEMENTS: path.join(f.root, 'fixture-entitlements'), PUI_SIGNING_MODE: mode,
      SIGNING_CALLS: path.join(f.root, 'calls') });
    const result = run(f, 'sign_app');
    if (mode === 'deep-fail' || mode === 'shallow-fail') {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /insufficient room to write code signature load command/);
      assert.match(result.stderr, /diagnostics=/);
      const attempts = fs.readdirSync(path.join(f.out, 'macos/diagnostics'));
      assert.equal(attempts.length, 1);
      const phase = mode === 'deep-fail' ? 'deep' : 'shallow';
      const log = path.join(f.out, 'macos/diagnostics', attempts[0], `${phase}.log`);
      assert.match(fs.readFileSync(log, 'utf8'), /insufficient room to write code signature load command/);
      return;
    }
    if (mode !== 'normal') {
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /PUI generation|companion changed|binary generation changed|cannot bind/);
      return;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const generation = JSON.parse(fs.readFileSync(manifest));
    const { createHash } = require('node:crypto');
    const digest = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    assert.equal(generation.binarySha256, digest(binary));
    assert.deepEqual({ ...generation, binarySha256: original.binarySha256 }, original);
    assert.equal(fs.readFileSync(path.join(f.app, 'Contents/_CodeSignature/CodeResources'), 'utf8'), digest(manifest));
    assert.equal(fs.readFileSync(f.env.SIGNING_CALLS, 'utf8'), 'deep\nshallow\n');
  });
}

for (const inheritedPath of [true, false]) {
  test(`DMG signer receives only key content with inherited path ${inheritedPath}`, t => {
    const f = fixture(t, { inheritedPath, password: 'fixture-password' });
    const result = run(f);
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(fs.readFileSync(f.record, 'utf8'));
    assert.equal(record.keyMatches, true);
    assert.equal(record.passwordMatches, true);
    assert.equal(record.contentPresent, true);
    assert.equal(record.inheritedPathPresent, false);
    assert.deepEqual(record.args.slice(0, -1),
      ['--yes', '-p', '@tauri-apps/cli@2.11.0', 'tauri', 'signer', 'sign']);
    assert.equal(record.args.at(-1), f.dmg);
    assert.equal(fs.readFileSync(f.dmg + '.sig', 'utf8'), 'fixture-signature');
    assert.equal(result.stdout.includes('CALLER_PATH_PRESERVED'), inheritedPath);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-key-content|fixture-password/);
  });
}

for (const [mode, stale] of [['fail', false], ['missing', false], ['empty', false], ['missing', true]]) {
  test(`DMG signing refuses ${mode} output with stale signature ${stale}`, t => {
    const f = fixture(t, { inheritedPath: false, mode, stale });
    const result = run(f);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /tauri signer (failed|produced no .sig)/);
    assert.doesNotMatch(result.stdout, /CALLER_PATH_PRESERVED/);
    if (stale) assert.equal(fs.existsSync(f.dmg + '.sig'), false);
  });
}

test('updater tar signer retains its explicit path contract and caller setting', t => {
  const f = fixture(t);
  const result = run(f, 'make_updater');
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(fs.readFileSync(f.record, 'utf8'));
  assert.equal(record.keyMatches, true);
  assert.equal(record.contentPresent, false);
  assert.equal(record.inheritedPathPresent, false);
  assert.equal(record.args[record.args.indexOf('--private-key-path') + 1], f.key);
  assert.match(result.stdout, /CALLER_PATH_PRESERVED/);
});

for (const mode of ['fail', 'missing', 'empty']) {
  test(`updater tar signing refuses ${mode} output and cannot reuse a stale signature`, t => {
    const f = fixture(t, { mode });
    const sig = path.join(f.out, 'macos/Papercusp GUI.app.tar.gz.sig');
    fs.writeFileSync(sig, 'stale-signature');
    const result = run(f, 'make_updater');
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /tauri signer (failed|produced no .sig)/);
    if (mode !== 'empty') assert.equal(fs.existsSync(sig), false);
  });
}

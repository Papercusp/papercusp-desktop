// EI-22764638031916839 — native sidecar addons must match the Node binary that
// the builder vendors, and the bundle verifier must exercise lazy addon loads.

'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');
const builder = fs.readFileSync(
  path.join(desktopRoot, 'bin/build-desktop-sidecar.sh'),
  'utf8',
);
const verifier = fs.readFileSync(
  path.join(desktopRoot, 'bin/verify-sidecar-bundle.sh'),
  'utf8',
);

const darwinInputHelper = path.join(desktopRoot, 'bin/lib/darwin-native-inputs.py');
function pythonProbe(script) {
  return spawnSync('python3', ['-c', [
    'import importlib.util, pathlib, tempfile, json, hashlib, shutil',
    `s=importlib.util.spec_from_file_location('native_inputs', ${JSON.stringify(darwinInputHelper)})`,
    'm=importlib.util.module_from_spec(s); s.loader.exec_module(m)', script,
  ].join('\n')], { encoding: 'utf8', timeout: 10_000 });
}

test('native minimum OS parser excludes adjacent linker/dylib versions and supports legacy macOS commands', () => {
  const commands = 'Load command 0\n cmd LC_BUILD_VERSION\n platform macos\n minos 14.0\n sdk 15.2\n tool LD\n version 1115.7.3\nLoad command 1\n cmd LC_LOAD_DYLIB\n current version 78.3.0\nLoad command 2\n cmd LC_VERSION_MIN_MACOSX\n version 13.1\n sdk 14.0\n';
  const result = pythonProbe(`assert m.minimum_os(${JSON.stringify(commands)}) == ['14.0', '13.1']\ntry: m.minimum_os('cmd LC_LOAD_DYLIB\\n version 1115.7.3\\n')\nexcept ValueError: pass\nelse: raise AssertionError('unmeasured minimum accepted')`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('normalization makes the copied bottle writable for signer replacement without changing source modes', () => {
  const result = pythonProbe(`
root=pathlib.Path(tempfile.mkdtemp())
try:
    source=root/'source'; source.mkdir(); (source/'pg_regress').write_bytes(b'fixture')
    source.chmod(0o555); (source/'pg_regress').chmod(0o555)
    shutil.copytree(source,root/'copy'); m.make_copy_writable(root/'copy')
    assert (source.stat().st_mode & 0o777)==0o555
    assert ((source/'pg_regress').stat().st_mode & 0o777)==0o555
    assert (root/'copy').stat().st_mode & 0o200
    assert (root/'copy/pg_regress').stat().st_mode & 0o200
finally:
    m.make_copy_writable(root); shutil.rmtree(root)
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('private input validation rejects target, profile, file and rig-proof mismatches before assembly', () => {
  const result = pythonProbe(`
root=pathlib.Path(tempfile.mkdtemp())
try:
    required=['postgresql/bin/'+n for n in ('postgres','initdb','pg_ctl','pg_dump','pg_dumpall','pg_restore','psql')]
    required+=['postgresql/lib/postgresql/vector.dylib','postgresql/share/postgresql/extension/vector.control','bin/gh','bin/kopia']
    for name in required:
        p=root/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(b'fixture'); p.chmod(0o755)
    m.check_closure=lambda root,arch,floor: {n:{} for n in required if not n.endswith('.control')}
    files=m.file_inventory(root)
    manifest={'schemaVersion':'darwin-native-inputs/v1','privateOnly':True,'target':{'os':'darwin','arch':'x64'},'postgresqlVersion':'18.6','minimumMacOS':'14.0','files':files,'upstreamReceipts':[{'sha256':'a'*64}]}
    def write():
        (root/'manifest.json').write_text(json.dumps(manifest)); return m.sha(root/'manifest.json')
    digest=write()
    m.verify(root,digest,'x64','dogfood')
    for arch,profile,expected in [('arm64','dogfood',digest),('x64','public',digest),('x64','vm-release',digest),('x64','dogfood','0'*64)]:
        try: m.verify(root,expected,arch,profile)
        except ValueError: pass
        else: raise AssertionError('invalid input accepted')
    try: m.verify(root,digest,'x64','dogfood',True)
    except ValueError: pass
    else: raise AssertionError('unqualified rig accepted')
    import base64
    receipt={'target':manifest['target'],'minimumMacOS':'14.0','nativeFilesSha256':m.files_hash(files),'checks':{n:True for n in ('pgInitStartQueryStop','pgvector','gh','kopia')},'evidence':['fixture-protocol-output']}
    raw=json.dumps(receipt).encode()
    manifest['runtimeQualification']={**receipt,'receiptSha256':hashlib.sha256(raw).hexdigest()}
    manifest['runtimeQualificationReceiptBase64']=base64.b64encode(raw).decode()
    digest=write(); m.verify(root,digest,'x64','dogfood',True)
    manifest['runtimeQualification']['receiptSha256']='a'*64
    try: m.verify(root,write(),'x64','dogfood',True)
    except ValueError: pass
    else: raise AssertionError('arbitrary receipt token accepted')
    manifest['runtimeQualification']['receiptSha256']=hashlib.sha256(raw).hexdigest()
    digest=write()
    (root/'bin/kopia').write_bytes(b'changed')
    try: m.verify(root,digest,'x64','dogfood',True)
    except ValueError: pass
    else: raise AssertionError('changed native bytes accepted')
finally: shutil.rmtree(root)
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('native closure rejects an unresolved or external loader path and an understated macOS floor', () => {
  const result = pythonProbe(`
root=pathlib.Path(tempfile.mkdtemp())
try:
    p=root/'postgres'; p.write_bytes(bytes.fromhex('cffaedfe')+b'fixture')
    for dep,floor in [('@loader_path/missing.dylib','14.0'),('/opt/homebrew/lib/ambient.dylib','14.0'),('/usr/lib/libSystem.B.dylib','13.0')]:
        m.inspect=lambda path,arch: {'minimumOS':['14.0'],'dylibs':[dep]}
        try: m.check_closure(root,'x64',floor)
        except ValueError: pass
        else: raise AssertionError('bad closure accepted')
    m.inspect=lambda path,arch: {'minimumOS':['14.0'],'dylibs':['/usr/lib/libSystem.B.dylib']}
    assert len(m.check_closure(root,'x64','14.0'))==1
finally: shutil.rmtree(root)
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('native protocols stop the owned PostgreSQL and emit no success receipt after a failed query', () => {
  const result = pythonProbe(`
from types import SimpleNamespace
root=pathlib.Path(tempfile.mkdtemp());calls=[]
try:
    manifest={'target':{'os':'darwin','arch':'x64'},'minimumMacOS':'14.0'}
    m.verify=lambda *a:manifest
    m.file_inventory=lambda *a:{'fixture':'sha'}
    m.platform.system=lambda:'Darwin';m.platform.machine=lambda:'x86_64';m.platform.mac_ver=lambda:('14.8','','')
    def execute(command,**kwargs):
        calls.append(command)
        if command[0].endswith('initdb'):
            data=pathlib.Path(command[command.index('-D')+1]);data.mkdir()
        if command[0].endswith('pg_ctl') and command[-1]=='start':
            data=pathlib.Path(command[command.index('-D')+1]);(data/'postmaster.pid').write_text('fixture')
        if command[0].endswith('psql'):return SimpleNamespace(returncode=1,stdout='',stderr='query failed')
        return SimpleNamespace(returncode=0,stdout='',stderr='')
    m.subprocess.run=execute
    args=SimpleNamespace(root=root,sha256='sha',arch='x64',receipt=root/'receipt.json',evidence=root/'evidence')
    try:m.qualify_runtime(args)
    except ValueError as e:assert 'pg-vector-query failed' in str(e)
    else:raise AssertionError('query failure accepted')
    assert any(c[0].endswith('pg_ctl') and c[-1]=='stop' for c in calls)
    assert not args.receipt.exists()
    assert len(list(args.evidence.glob('*.json')))==4
finally:shutil.rmtree(root)
`);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('private native inputs fail before SPA assembly and require actual rig qualification', () => {
  const start = builder.indexOf('validate_darwin_native_inputs()');
  const end = builder.indexOf('validate_darwin_native_inputs || exit 1', start);
  assert(start > 0 && end > start);
  assert(end < builder.indexOf('→ building operator-vite SPA'));
  const fn = builder.slice(start, end);
  assert.match(fn, /--require-runtime/);
  for (const profile of ['public', 'vm-release']) {
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail', 'DARWIN_NATIVE_INPUTS=/does-not-exist; TARGET_OS=darwin',
      `DISTRIBUTION_PROFILE=${profile}`, fn, 'validate_darwin_native_inputs',
    ].join('\n')], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /Darwin dogfood/);
  }
});

test('moved qualified PG clients resolve the normalized embedded library directory', () => {
  const fn = builder.match(/_cross_darwin_vendor_pg_tool\(\) \{[\s\S]*?\n\}/)[0];
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-private-pg-client-'));
  try {
    const native = path.join(fixture, 'native');
    const sidecar = path.join(fixture, 'sidecar');
    fs.mkdirSync(path.join(native, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(sidecar, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(native, 'lib/libpq.5.dylib'), 'fixture');
    fs.writeFileSync(path.join(sidecar, 'bin/psql'), 'fixture');
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail', 'SIDECAR_DIR="$1/sidecar"; EMBEDDED_PG_BIN_DIR="$1/native/bin"; DARWIN_NATIVE_INPUTS="$1/input"',
      'llvm-otool-18() { printf "psql:\\n  @loader_path/../lib/libpq.5.dylib (compatibility version 5.0.0)\\n"; }',
      'llvm-install-name-tool-18() { printf "%s\\n" "$*"; }', 'rcodesign() { :; }', fn,
      '_cross_darwin_vendor_pg_tool "$SIDECAR_DIR/bin/psql"',
    ].join('\n'), 'fixture', fixture], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /-change @loader_path\/\.\.\/lib\/libpq\.5\.dylib @executable_path\/\.\.\/\.\.\/native\/lib\/libpq\.5\.dylib/);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

function runEsbuildTargetFixture({ wrongVersion = false, wrongFormat = false, missingPin = false, arch = 'x64' } = {}) {
  const match = builder.match(/align_darwin_esbuild_runtime_closures\(\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'Darwin runtime esbuild alignment helper is missing');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-esbuild-target-'));
  const nm = path.join(fixture, 'node_modules');
  const roots = [
    path.join(nm, 'esbuild'),
    path.join(nm, 'lost-pixel/node_modules/esbuild'),
  ];
  const versions = ['0.28.2', '0.24.0'];
  const target = `@esbuild/darwin-${arch}`;
  try {
    fs.mkdirSync(path.join(nm, 'lost-pixel'), { recursive: true });
    fs.writeFileSync(path.join(nm, 'lost-pixel/package.json'), '{"name":"lost-pixel","version":"3.22.0"}');
    for (const [i, root] of roots.entries()) {
      fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
      fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
        name: 'esbuild', version: versions[i],
        optionalDependencies: missingPin ? {} : { [target]: versions[i] },
      }));
      fs.writeFileSync(path.join(root, 'lib/main.js'), '// runtime consumer entrypoint');
      fs.writeFileSync(path.join(root, 'bin/esbuild'), 'ELF host optimized CLI');
      fs.writeFileSync(path.join(root, 'lib/downloaded-@esbuild-linux-x64-esbuild'), 'ELF host fallback');
      const host = path.join(path.dirname(root), '@esbuild/linux-x64/bin');
      fs.mkdirSync(host, { recursive: true });
      fs.writeFileSync(path.join(host, 'esbuild'), 'ELF optional dependency');
    }
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail', 'TARGET_OS=darwin; TARGET_ARCH="$2"',
      'fetch_cross_npm_pkg() {',
      '  local spec="$1" nm="$2" name="${1%@*}" version="${1##*@}"',
      '  mkdir -p "$nm/$name/bin"',
      wrongVersion ? '  version=0.0.1' : ':',
      '  printf \'{"name":"%s","version":"%s"}\\n\' "$name" "$version" > "$nm/$name/package.json"',
      wrongFormat ? '  printf "ELF x86-64\\n" > "$nm/$name/bin/esbuild"' :
        '  printf "Mach-O %s\\n" "$([[ "$TARGET_ARCH" == x64 ]] && echo x86_64 || echo arm64)" > "$nm/$name/bin/esbuild"',
      '}',
      'file() { cat "${@: -1}"; }',
      match[0],
      'align_darwin_esbuild_runtime_closures "$1"',
    ].join('\n'), 'fixture', fixture, arch], { encoding: 'utf8', timeout: 10_000 });
    if (result.status === 0) {
      const { createRequire } = require('node:module');
      for (const [i, root] of roots.entries()) {
        const resolved = createRequire(path.join(root, 'lib/main.js')).resolve(`${target}/package.json`);
        assert.equal(JSON.parse(fs.readFileSync(resolved, 'utf8')).version, versions[i]);
        const binary = path.join(path.dirname(resolved), 'bin/esbuild');
        assert.deepEqual(fs.readFileSync(path.join(root, 'bin/esbuild')), fs.readFileSync(binary));
        assert.equal(fs.existsSync(path.join(root, 'lib/downloaded-@esbuild-linux-x64-esbuild')), false);
        assert.equal(fs.existsSync(path.join(path.dirname(root), '@esbuild/linux-x64')), false);
      }
      assert.equal(JSON.parse(fs.readFileSync(path.join(nm, 'lost-pixel/package.json'), 'utf8')).version, '3.22.0');
    }
    return result;
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
}

test('Darwin runtime esbuild replaces all three host-binary paths while preserving nested versions and lost-pixel', () => {
  for (const arch of ['x64', 'arm64']) {
    const result = runEsbuildTargetFixture({ arch });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const call = builder.indexOf('align_darwin_esbuild_runtime_closures "$SIDECAR_DIR" || exit 1');
  assert(call > builder.indexOf('copy_pkg_closure lost-pixel'));
  assert(call < builder.indexOf('assert_runtime_dependency_closure "$SIDECAR_DIR" || exit 1'));
});

test('Darwin runtime esbuild refuses missing exact platform pin, wrong version, and host ELF', () => {
  for (const options of [{ missingPin: true }, { wrongVersion: true }, { wrongFormat: true }]) {
    const result = runEsbuildTargetFixture(options);
    assert.equal(result.status, 1, result.stdout + result.stderr);
  }
});

test('required local-model backend missing from a cross-target bundle is fatal, not advisory', () => {
  const start = verifier.indexOf('REQUIRED_NATIVE_MODULES="');
  const end = verifier.indexOf('\nelse\n  NODE_BIN=""', start);
  assert(start > 0 && end > start);
  const nativeBlock = verifier.slice(start, end) + '\nfi';
  const required = verifier.match(/REQUIRED_NATIVE_MODULES="\n([\s\S]*?)\n"/)[1].trim().split('\n');
  assert(required.includes('onnxruntime-node'));
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-required-onnx-'));
  try {
    for (const module of required) {
      const dir = path.join(fixture, 'node_modules', module);
      fs.mkdirSync(dir, { recursive: true });
      if (module !== 'onnxruntime-node') fs.writeFileSync(path.join(dir, 'fixture.node'), 'target-format fixture');
    }
    // An arm64 binding exists, but the Intel runtime cannot resolve it.
    const arm = path.join(fixture, 'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64');
    fs.mkdirSync(arm, { recursive: true });
    fs.writeFileSync(path.join(arm, 'onnxruntime_binding.node'), 'target-format fixture');
    const probe = () => spawnSync('bash', ['-c', [
      'set -uo pipefail', 'FAIL=0; CROSS=1; TARGET_OS_N=darwin; TARGET_ARCH_N=x64',
      'SIDECAR="$1"', 'fail() { echo "$*"; FAIL=1; }', 'ok() { :; }',
      '_is_target_format() { test -s "$1"; }', nativeBlock, 'exit "$FAIL"',
    ].join('\n'), 'test', fixture], { encoding: 'utf8' });
    const missing = probe();
    assert.equal(missing.status, 1, missing.stdout + missing.stderr);
    assert.match(missing.stdout, /onnxruntime-node: no darwin-x64/);
    const intel = path.join(fixture, 'node_modules/onnxruntime-node/bin/napi-v6/darwin/x64');
    fs.mkdirSync(intel, { recursive: true });
    fs.writeFileSync(path.join(intel, 'onnxruntime_binding.node'), 'target-format fixture');
    const complete = probe();
    assert.equal(complete.status, 0, complete.stdout + complete.stderr);
  } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('native target preflight precedes expensive SPA assembly in the real producer', () => {
  const guard = builder.indexOf('papercusp_verify_transformers_native_target "$REPO_ROOT" "$TARGET_OS" "$TARGET_ARCH"');
  assert(guard > builder.indexOf('TARGET_ARCH="${TARGET_ARCH:-$_host_arch}"'));
  assert(guard < builder.indexOf('→ building operator-vite SPA (vite build → locked sidecar snapshot)'));
  assert(guard > builder.indexOf('papercusp_verify_transformers_dependencies "$REPO_ROOT" 1'));
});

test('existing runtime copier stages validated source-native bytes before target pruning', () => {
  const start = builder.indexOf('if [[ "$cur" == "onnxruntime-node" ]]');
  const end = builder.indexOf('prune_foreign_onnx_bins "$dest"', start);
  assert(start > 0 && end > start);
  assert.match(builder.slice(start, end), /papercusp_verify_transformers_native_target "\$REPO_ROOT" "\$TARGET_OS" "\$TARGET_ARCH" "\$dest"/);
});

function extractAlignmentFunction(source) {
  const match = source.match(
    /align_better_sqlite3_native\(\) \{[\s\S]*?\n\}\n\n# Windows packaging/,
  );
  assert.ok(match, 'align_better_sqlite3_native() is missing');
  return match[0].replace(/\n\n# Windows packaging[\s\S]*$/, '');
}

function extractVerifierGuard() {
  const match = verifier.match(
    /cat >"\$_guard_js" <<'GUARD_EOF'\n([\s\S]*?)\nGUARD_EOF/,
  );
  assert.ok(match, 'native verifier guard heredoc is missing');
  return match[1];
}

function runPgvectorBottleFixture({ major = 18, architecture = 'x86_64', selectFails = false } = {}) {
  const match = builder.match(/fetch_pgvector_darwin_bottle\(\) \{[\s\S]*?\n\}\necho "→ bundling pgvector/);
  assert.ok(match, 'pgvector bottle normalizer is missing');
  const fn = match[0].replace(/\necho "→ bundling pgvector$/, '');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-pgvector-bottle-'));
  const keg = path.join(fixture, 'keg');
  const extension = path.join(keg, `share/postgresql@${major}/extension`);
  fs.mkdirSync(path.join(keg, `lib/postgresql@${major}`), { recursive: true });
  fs.mkdirSync(extension, { recursive: true });
  fs.writeFileSync(path.join(keg, `lib/postgresql@${major}/vector.dylib`), 'fixture');
  fs.writeFileSync(path.join(extension, 'vector.control'), "default_version = '0.8.6'\n");
  fs.writeFileSync(path.join(extension, 'vector--0.8.6.sql'), '-- fixture\n');
  try {
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'EMBEDDED_PG_MAJOR=18',
      '_brew_ver_with_darwin_bottle() {',
      '  [[ "$*" == "pgvector 0.8.7 x64 homebrew/core/pgvector" ]] || return 9',
      selectFails ? '  return 1' : '  printf "0.8.6\\n"',
      '}',
      '_fetch_brew_bottle_raw() {',
      '  printf "%s\\n" "$*" > "$PC_FETCH_ARGS"',
      '  printf "%s\\n" "$PC_KEG"',
      '}',
      `file() { printf "Mach-O 64-bit ${architecture} bundle\\n"; }`,
      fn,
      'if normalized="$(fetch_pgvector_darwin_bottle 0.8.7 x64)"; then',
      '  [[ -f "$normalized/vector.dylib" && -f "$normalized/extension/vector.control" ]]',
      '  rm -rf "$normalized"',
      'else exit 1; fi',
    ].join('\n')], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PC_KEG: keg, PC_FETCH_ARGS: path.join(fixture, 'fetch.args') },
    });
    const argsPath = path.join(fixture, 'fetch.args');
    return { ...result, fetchArgs: fs.existsSync(argsPath) ? fs.readFileSync(argsPath, 'utf8').trim() : null };
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test('pgvector uses the maintained target-compatible bottle selector before fetching', () => {
  const result = runPgvectorBottleFixture();
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.equal(result.fetchArgs, 'pgvector 0.8.6 x64 homebrew/core/pgvector');
});

test('pgvector rejects an older PostgreSQL ABI instead of accepting any vector.dylib', () => {
  const result = runPgvectorBottleFixture({ major: 17 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /postgresql@18\/vector\.dylib not found/);
});

test('pgvector rejects a bottle whose actual Mach-O architecture disagrees with the target', () => {
  const result = runPgvectorBottleFixture({ architecture: 'arm64' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not Mach-O x86_64/);
});

test('pgvector stops before downloading when target bottle selection fails', () => {
  const result = runPgvectorBottleFixture({ selectFails: true });
  assert.equal(result.status, 1);
  assert.equal(result.fetchArgs, null);
});

test('private bottle selection requires the rig macOS floor and fails closed without an eligible version', () => {
  const fn = builder.match(/_brew_ver_with_darwin_bottle\(\) \{[\s\S]*?\n\}/)[0];
  for (const eligible of [true, false]) {
    const result = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'curl() {',
      '  case "${@: -1}" in',
      '    *token*) printf \'{"token":"fixture"}\\n\' ;;',
      '    *tags/list*) printf \'{"tags":["0.8.7","0.8.6"]}\\n\' ;;',
      '    */manifests/0.8.7) printf \'{"manifests":[{"platform":{"os":"darwin","architecture":"arm64","os.version":"macOS 15.8"}}]}\\n\' ;;',
      `    */manifests/0.8.6) printf '{"manifests":[{"platform":{"os":"darwin","architecture":"arm64","os.version":"macOS ${eligible ? '14.8' : '15.8'}"}}]}\\n' ;;`,
      '    *) return 9 ;;', '  esac', '}', fn,
      '_brew_ver_with_darwin_bottle pgvector 0.8.7 arm64 homebrew/core/pgvector 14',
    ].join('\n')], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, eligible ? 0 : 1, result.stdout + result.stderr);
    if (eligible) assert.equal(result.stdout.trim(), '0.8.6');
    else assert.match(result.stderr, /no pinned darwin\/arm64 version supports macOS <=14/);
  }
});

test('desktop worker builds before Node staging and is executed by the finished-bundle verifier', () => {
  const buildStart = builder.indexOf('DESKTOP_SESSION_BIN=');
  const buildEnd = builder.indexOf('# Bundle the embedded-postgres-server', buildStart);
  const verifyStart = verifier.indexOf('_desktop_session=');
  const verifyEnd = verifier.indexOf('_ri=', verifyStart);
  const scanStart = verifier.indexOf('echo "[2/7] script-shim scan');
  const scanEnd = verifier.indexOf('# ── [3]', scanStart);
  const isScript = verifier.match(/^_is_script\(\).*$/m)?.[0];
  assert.ok(buildStart >= 0 && buildEnd > buildStart, 'desktop worker build phase is missing');
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart, 'packaged worker check is missing');
  assert.ok(scanStart >= 0 && scanEnd > scanStart && isScript, 'script-shim check is missing');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-desktop-worker-staging-'));
  const fakeBin = path.join(fixture, 'tools');
  const sidecar = path.join(fixture, 'sidecar');
  const bin = path.join(sidecar, 'bin');
  try {
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.writeFileSync(path.join(fixture, 'scripts/npm-install-safe.mjs'), [
      'export function withPackageCacheReadLease(fn) { return fn(); }',
    ].join('\n'));
    fs.writeFileSync(path.join(fakeBin, 'npx'), [
      '#!/bin/sh',
      'for arg in "$@"; do',
      '  case "$arg" in --outfile=*) printf "#!/usr/bin/env node\\nprocess.exit(0);\\n" > "${arg#--outfile=}";; esac',
      'done',
      '',
    ].join('\n'), { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      SIDECAR_DIR: sidecar,
      REPO_ROOT: fixture,
      WEB_DIR: fixture,
      BIN: bin,
      NODE_BIN: path.join(bin, 'node'),
      OS: 'Linux',
    };
    const built = spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'MINIFY_ARGS=()',
      builder.match(/run_sidecar_cached_package\(\) \{[\s\S]*?\n\}/)[0],
      builder.slice(buildStart, buildEnd),
    ].join('\n')], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(built.status, 0, `${built.stdout}${built.stderr}`);
    assert.equal(fs.existsSync(env.NODE_BIN), false, 'this phase must not require the later Node copy');
    const worker = path.join(bin, 'papercusp-desktop-session.cjs');
    assert.ok(fs.statSync(worker).mode & 0o111, 'the worker must be executable');

    const scan = () => spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'FAIL=0',
      'fail() { printf "%s\\n" "$*" >&2; FAIL=1; }',
      'ok() { :; }',
      isScript,
      verifier.slice(scanStart, scanEnd),
      'exit "$FAIL"',
    ].join('\n')], { env, encoding: 'utf8', timeout: 10_000 });
    const productScript = scan();
    assert.equal(productScript.status, 0, `${productScript.stdout}${productScript.stderr}`);
    const unknownShim = path.join(bin, 'host-only-shim');
    fs.writeFileSync(unknownShim, '#!/bin/sh\nexec /build-host-only/tool\n', { mode: 0o755 });
    const unknown = scan();
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /host-only-shim: unexpected #!-script/);
    fs.unlinkSync(unknownShim);

    // The final verifier must exercise the packaged runtime and reject a broken worker.
    fs.symlinkSync(process.execPath, env.NODE_BIN);
    const verify = () => spawnSync('bash', ['-c', [
      'set -euo pipefail',
      'fail() { printf "%s\\n" "$*" >&2; exit 1; }',
      'ok() { :; }',
      verifier.slice(verifyStart, verifyEnd),
    ].join('\n')], { env, encoding: 'utf8', timeout: 10_000 });
    const good = verify();
    assert.equal(good.status, 0, `${good.stdout}${good.stderr}`);
    fs.writeFileSync(worker, 'process.exit(23);\n');
    const broken = verify();
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /desktop session worker failed packaged execution/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('builder refreshes better-sqlite3 for the bundled Node target ABI', () => {
  const align = extractAlignmentFunction(builder);
  const nodeSelection = builder.indexOf('NODE_VERSION="${NODE_VERSION:-v24.18.1}"');
  const alignAt = builder.indexOf('align_better_sqlite3_native() {');

  assert.ok(nodeSelection >= 0, 'bundled Node version selector is missing');
  assert.ok(alignAt > nodeSelection, 'ABI alignment must happen after Node selection');
  assert.match(align, /rm -f "\$bsq_dir"\/build\/Release\/\*\.node/);
  assert.match(align, /prebuild-install/);
  assert.match(align, /--platform="\$TARGET_OS"/);
  assert.match(align, /--arch="\$TARGET_ARCH"/);
  assert.match(align, /--target="\$target_version"/);
  assert.match(align, /--runtime=node/);
  assert.match(align, /npm rebuild --runtime=node --target="\$target_version" --build-from-source better-sqlite3/);
  assert.match(builder, /\[\[ "\$TARGET_OS" == "linux" \|\| "\$TARGET_OS" == "darwin" \]\]/);
});

test('builder passes the exact Node target to prebuild-install', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-abi-'));
  const fakeBin = path.join(fixture, 'bin');
  const sidecar = path.join(fixture, 'sidecar');
  const packageDir = path.join(sidecar, 'node_modules/better-sqlite3');
  const argsFile = path.join(fixture, 'npx-args');
  try {
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.mkdirSync(path.join(packageDir, 'build/Release'), { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'build/Release/wrong-abi.node'), 'wrong');
    fs.writeFileSync(
      path.join(fakeBin, 'npx'),
      [
        '#!/bin/sh',
        'printf "%s\\n" "$@" > "$PC_NPX_ARGS"',
        'mkdir -p "$PWD/build/Release"',
        'printf target > "$PWD/build/Release/target.node"',
        '',
      ].join('\n'),
    );
    fs.chmodSync(path.join(fakeBin, 'npx'), 0o755);

    const align = extractAlignmentFunction(builder);
    const result = spawnSync(
      'bash',
      [
        '-c',
        [
          'set -euo pipefail',
          `SIDECAR_DIR=${JSON.stringify(sidecar)}`,
          'NODE_VERSION=v24.18.1',
          'TARGET_OS=linux',
          'TARGET_ARCH=x64',
          align,
          'align_better_sqlite3_native',
        ].join('\n'),
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          PC_NPX_ARGS: argsFile,
        },
      },
    );

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
    assert.ok(args.includes('--target=24.18.1'));
    assert.ok(args.includes('--runtime=node'));
    assert.ok(args.includes('--platform=linux'));
    assert.ok(args.includes('--arch=x64'));
    assert.equal(
      fs.existsSync(path.join(packageDir, 'build/Release/wrong-abi.node')),
      false,
      'the host-ABI addon must be removed before target repair',
    );
    assert.equal(fs.existsSync(path.join(packageDir, 'build/Release/target.node')), true);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('verifier opens better-sqlite3 so lazy ABI failures are observable', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-sidecar-native-guard-'));
  const sidecar = path.join(fixture, 'sidecar');
  const marker = path.join(fixture, 'constructor-marker');
  const guard = path.join(fixture, 'guard.js');
  try {
    fs.mkdirSync(path.join(sidecar, 'node_modules/better-sqlite3'), { recursive: true });
    fs.writeFileSync(path.join(sidecar, 'serve.mjs'), '');
    fs.writeFileSync(
      path.join(sidecar, 'node_modules/better-sqlite3/index.js'),
      [
        'const fs = require("node:fs");',
        'module.exports = class Database {',
        '  constructor(filename) { fs.writeFileSync(process.env.PC_CONSTRUCTOR_MARKER, filename); }',
        '  close() {}',
        '};',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(guard, extractVerifierGuard());
    const result = spawnSync(process.execPath, [guard, 'better-sqlite3'], {
      cwd: sidecar,
      encoding: 'utf8',
      env: {
        ...process.env,
        PC_SIDECAR_ROOT: sidecar,
        PC_CONSTRUCTOR_MARKER: marker,
      },
    });

    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(fs.readFileSync(marker, 'utf8'), ':memory:');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

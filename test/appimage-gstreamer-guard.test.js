'use strict';

// EI-20082216700215037 — WebKitGTK's GStreamer libraries are not the element
// plugins. Keep the real build seam and AppRun wiring guarded so a future
// linuxdeploy change cannot silently reintroduce the pristine-host appsink miss.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const CODE = SRC.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

function extractClosureBlock() {
  const start = SRC.indexOf('copy_gstreamer_plugin_closure() {');
  const end = SRC.indexOf('\ncopy_gstreamer_plugin_closure || exit 1', start);
  assert.ok(start >= 0, 'the real GStreamer closure walker is missing');
  assert.ok(end > start, 'the real GStreamer closure walker has no call site');
  return SRC.slice(start, end);
}

function commandPath(name) {
  const result = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

const CC = commandPath('cc') || commandPath('gcc');
const OBJDUMP = commandPath('objdump');

function compileFixtureTree({ privateRunpath = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-gst-closure-'));
  const host = path.join(root, 'host-libs');
  const privateHost = path.join(root, 'private-libs');
  const source = path.join(root, 'plugins');
  const appdir = path.join(root, 'appdir');
  fs.mkdirSync(host, { recursive: true });
  fs.mkdirSync(privateHost, { recursive: true });
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(appdir, 'usr', 'lib'), { recursive: true });

  const write = (name, body) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, body);
    return file;
  };
  const compile = (output, input, args = []) => {
    const result = spawnSync(CC, ['-shared', '-fPIC', '-Wl,-z,now', '-o', output, input, ...args], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `fixture compile failed: ${result.stdout}${result.stderr}`);
  };
  const leafSource = write('leaf.c', 'const char *gst_fixture_leaf(void) { return "leaf"; }\n');
  const depSource = write('dep.c', privateRunpath
    ? 'extern const char *gst_fixture_private(void);\n' +
      'const char *gst_fixture_dep(void) { return gst_fixture_private(); }\n'
    : 'extern const char *gst_fixture_leaf(void);\n' +
      'const char *gst_fixture_dep(void) { return gst_fixture_leaf(); }\n');
  const pluginSource = write(
    'plugin.c',
    'extern const char *gst_fixture_dep(void);\n' +
      'void gst_fixture_plugin(void) { (void)gst_fixture_dep(); }\n',
  );
  const leaf = path.join(host, 'libgstfixtureleaf.so.1.0');
  const dep = path.join(host, 'libgstfixturedep.so.1.0');
  compile(leaf, leafSource, ['-Wl,-soname,libgstfixtureleaf.so.1']);
  fs.symlinkSync('libgstfixtureleaf.so.1.0', path.join(host, 'libgstfixtureleaf.so.1'));
  let privateLeaf = '';
  if (privateRunpath) {
    const privateSource = write(
      'private.c',
      'const char *gst_fixture_private(void) { return "private"; }\n',
    );
    privateLeaf = path.join(privateHost, 'libgstfixtureprivate.so.1.0');
    compile(privateLeaf, privateSource, ['-Wl,-soname,libgstfixtureprivate.so.1']);
    fs.symlinkSync(
      'libgstfixtureprivate.so.1.0',
      path.join(privateHost, 'libgstfixtureprivate.so.1'),
    );
    compile(dep, depSource, [
      '-Wl,-soname,libgstfixturedep.so.1',
      '-L',
      privateHost,
      `-Wl,-rpath,${privateHost}`,
      '-Wl,-l:libgstfixtureprivate.so.1',
    ]);
  } else {
    compile(dep, depSource, [
      '-Wl,-soname,libgstfixturedep.so.1',
      '-L',
      host,
      '-Wl,-rpath,$ORIGIN',
      '-Wl,-l:libgstfixtureleaf.so.1',
    ]);
  }
  fs.symlinkSync('libgstfixturedep.so.1.0', path.join(host, 'libgstfixturedep.so.1'));
  compile(path.join(source, 'libgstapp.so'), pluginSource, [
    '-Wl,-soname,libgstapp.so',
    '-L',
    host,
    '-Wl,-rpath,$ORIGIN',
    '-Wl,-l:libgstfixturedep.so.1',
  ]);

  const scanner = path.join(root, 'gst-plugin-scanner');
  const trueBinary = ['/usr/bin/true', '/bin/true'].find((candidate) => fs.existsSync(candidate));
  assert.ok(trueBinary, 'the fixture scanner needs a host ELF');
  fs.copyFileSync(trueBinary, scanner);
  fs.chmodSync(scanner, 0o755);

  return {
    root,
    host,
    privateHost,
    privateLeaf,
    source,
    appdir,
    scanner,
    closure: extractClosureBlock(),
  };
}

function runClosureFixture(fixture, hostDirs = fixture.host) {
  const script = [
    'set -uo pipefail',
    `APPDIR=${JSON.stringify(fixture.appdir)}`,
    `GST_PLUGIN_DEST=${JSON.stringify(path.join(fixture.appdir, 'usr', 'lib', 'gstreamer-1.0'))}`,
    `GST_SCANNER_DEST=${JSON.stringify(path.join(fixture.appdir, 'usr', 'libexec', 'gst-plugin-scanner'))}`,
    'mkdir -p "$GST_PLUGIN_DEST" "$(dirname "$GST_SCANNER_DEST")"',
    `cp -a ${JSON.stringify(fixture.source)}/. "$GST_PLUGIN_DEST/"`,
    `cp -a ${JSON.stringify(fixture.scanner)} "$GST_SCANNER_DEST"`,
    fixture.closure,
    'copy_gstreamer_plugin_closure',
  ].join('\n');
  return spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: process.env.PATH,
      OBJDUMP,
      PAPERCUSP_GSTREAMER_LIBRARY_DIRS: hostDirs,
      // An empty resolver is intentional: the fixture proves the explicit
      // host-directory seam, not whatever happens to be installed globally.
      PAPERCUSP_GSTREAMER_LDCONFIG: '/bin/false',
    },
  });
}

test('the AppImage copies the GStreamer plugin directory and scanner', () => {
  assert.match(
    CODE,
    /GST_PLUGIN_SOURCE="\$\{PAPERCUSP_GSTREAMER_PLUGIN_DIR:-\/usr\/lib\/x86_64-linux-gnu\/gstreamer-1\.0\}"/,
  );
  assert.match(CODE, /cp -a "\$GST_PLUGIN_SOURCE"\/\. "\$GST_PLUGIN_DEST"\//);
  assert.match(CODE, /GST_SCANNER_DEST="\$APPDIR\/usr\/lib\/gstreamer1\.0\/gstreamer-1\.0\/gst-plugin-scanner"/);
  assert.match(CODE, /cp -a "\$GST_SCANNER_SOURCE" "\$GST_SCANNER_DEST"/);
});

test('the closure walker is wired into the build and walks DT_NEEDED transitively', { skip: !CC || !OBJDUMP }, () => {
  const fixture = compileFixtureTree();
  try {
    const result = runClosureFixture(fixture);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.ok(fs.existsSync(path.join(fixture.appdir, 'usr', 'lib', 'libgstfixturedep.so.1')));
    assert.ok(fs.existsSync(path.join(fixture.appdir, 'usr', 'lib', 'libgstfixtureleaf.so.1')));
    assert.match(result.stdout, /GStreamer plugin ELF closure verified/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the closure walker honors a dependency DT_RUNPATH outside the flat host directories', { skip: !CC || !OBJDUMP }, () => {
  const fixture = compileFixtureTree({ privateRunpath: true });
  try {
    const result = runClosureFixture(fixture);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.ok(
      fs.existsSync(path.join(fixture.appdir, 'usr', 'lib', 'libgstfixtureprivate.so.1')),
      'the private DT_RUNPATH dependency must be copied into the AppDir',
    );
    assert.match(result.stdout, /GStreamer plugin ELF closure verified/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the closure guard fails closed when a plugin dependency cannot resolve', { skip: !CC || !OBJDUMP }, () => {
  const fixture = compileFixtureTree();
  const missingDir = path.join(fixture.root, 'no-such-host-libs');
  try {
    const result = runClosureFixture(fixture, missingDir);
    assert.notEqual(result.status, 0, 'an unresolved plugin dependency must fail the build');
    assert.match(result.stderr, /libgstfixturedep\.so\.1/);
    assert.match(result.stderr, /no host or AppDir copy resolves it/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('the bundle fails closed when the appsink provider or scanner is absent', () => {
  assert.match(CODE, /\[ ! -f "\$GST_PLUGIN_SOURCE\/libgstapp\.so" \]/);
  assert.match(CODE, /\[ -f "\$GST_PLUGIN_DEST\/libgstapp\.so" \]/);
  assert.match(CODE, /\[ ! -x "\$GST_SCANNER_SOURCE" \]/);
  assert.match(CODE, /\[ -x "\$GST_SCANNER_DEST" \]/);
});

test('the GStreamer guard requires an ELF closure walker and a fail-closed call site', () => {
  assert.match(CODE, /copy_gstreamer_plugin_closure\(\) \{/);
  assert.match(CODE, /objdump.*required to resolve the GStreamer plugin ELF closure/);
  assert.match(CODE, /copy_gstreamer_plugin_closure \|\| exit 1/);
  assert.match(CODE, /PAPERCUSP_GSTREAMER_LIBRARY_DIRS/);
  assert.match(CODE, /RUNPATH.*RPATH/);
});

test('AppRun directs GStreamer to the bundled plugin and scanner paths', () => {
  assert.match(CODE, /export GST_PLUGIN_SYSTEM_PATH_1_0="\$HERE\/usr\/lib\/gstreamer-1\.0"/);
  assert.match(CODE, /export GST_PLUGIN_SCANNER="\$_gst_scanner"/);
});

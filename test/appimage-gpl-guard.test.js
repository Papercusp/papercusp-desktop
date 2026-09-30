'use strict';

// open-source-release-2026-09-29 P-020 / D-003 — Papercusp ships under the
// Elastic License 2.0, so the AppImage must not redistribute GPL libraries.
// The 0.0.22 AppImage bundled Ubuntu's GPL libavcodec-extra via the
// gst-libav plugin. These tests run the REAL snippets extracted from
// bin/build-appimage.sh (no re-implementation) against a fixture AppDir.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

function slice(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  assert.ok(start >= 0, `build-appimage.sh no longer contains ${startMarker}`);
  const end = SRC.indexOf(endMarker, start);
  assert.ok(end > start, `build-appimage.sh no longer contains ${endMarker} after ${startMarker}`);
  return SRC.slice(start, end + endMarker.length);
}

const DROP_BLOCK = slice('GST_GPL_PLUGINS=', '\ndone');
const GUARD_BLOCK = slice('GST_GPL_LIB_ERE=', 'echo "   GPL library guard: no GPL codec/media libraries in the AppDir"');

function fixture(pluginNames, libNames) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-gpl-guard-'));
  const appdir = path.join(root, 'AppDir');
  const plugins = path.join(appdir, 'usr', 'lib', 'gstreamer-1.0');
  const libs = path.join(appdir, 'usr', 'lib');
  fs.mkdirSync(plugins, { recursive: true });
  for (const name of pluginNames) fs.writeFileSync(path.join(plugins, name), 'x');
  for (const name of libNames) fs.writeFileSync(path.join(libs, name), 'x');
  return { root, appdir, plugins };
}

function run(script, env) {
  return spawnSync('bash', ['-c', `set -u\n${script}`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

test('the GPL-linked GStreamer plugins are removed before the ELF closure copies their dependencies', () => {
  const gpl = ['libgstlibav.so', 'libgstx264.so', 'libgstx265.so', 'libgsta52dec.so', 'libgstfaad.so'];
  const keep = ['libgstapp.so', 'libgstvorbis.so', 'libgstopus.so', 'libgstvpx.so'];
  const fx = fixture([...gpl, ...keep], []);
  try {
    const result = run(DROP_BLOCK, { GST_PLUGIN_DEST: fx.plugins });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(fx.plugins).sort(), [...keep].sort());
    // The removal must run BEFORE the closure walker, or the GPL
    // dependencies would already have been copied into the AppDir.
    assert.ok(
      SRC.indexOf('GST_GPL_PLUGINS=') < SRC.indexOf('\ncopy_gstreamer_plugin_closure || exit 1'),
      'GPL plugin removal must precede the closure copy',
    );
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('the guard fails the build when a GPL codec library reaches the AppDir', () => {
  const fx = fixture(['libgstapp.so'], ['libavcodec.so.60', 'libglib-2.0.so.0']);
  try {
    const result = run(GUARD_BLOCK, { APPDIR: fx.appdir });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /GPL-licensed libraries are in the AppDir/);
    assert.match(result.stderr, /libavcodec\.so\.60/);
    assert.doesNotMatch(result.stderr, /libglib/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('the guard passes an AppDir with only LGPL/permissive media libraries', () => {
  // libavcodec-free, but with near-miss names that must NOT match.
  const fx = fixture(['libgstapp.so'], ['libavahi-client.so.3', 'libavif.so.16', 'libvorbis.so.0', 'libglib-2.0.so.0']);
  try {
    const result = run(GUARD_BLOCK, { APPDIR: fx.appdir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /no GPL codec\/media libraries/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

// D-013: GPL-only libraries reached through optional components other than
// the codec plugins (installer license leg over the 0.0.25 AppImage).
const NON_GST_DROP_BLOCK = slice(
  'APPIMAGE_GPL_NON_GST_DROP=',
  'echo "   GPL non-media libraries dropped (TIFF pixbuf loader, jbig, tray indicator)"',
);

test('D-013: the extra GPL-linked plugins are in the default drop list', () => {
  const fx = fixture(
    ['libgstaasink.so', 'libgstcacasink.so', 'libgstfluidsynthmidi.so', 'libgstdtsdec.so',
      'libgstladspa.so', 'libgstteletext.so', 'libgstneonhttpsrc.so', 'libgstspandsp.so',
      'libgstcdparanoia.so', 'libgstapp.so'],
    [],
  );
  try {
    const result = run(DROP_BLOCK, { GST_PLUGIN_DEST: fx.plugins });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(fx.plugins), ['libgstapp.so']);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('D-013: the non-media drop removes the TIFF loader, jbig and the tray indicator, and prunes loaders.cache', () => {
  const fx = fixture([], ['libtiff.so.6', 'libjbig.so.0', 'libayatana-indicator3.so.7',
    'libayatana-appindicator3.so.1', 'libdbusmenu-gtk3.so.4', 'libglib-2.0.so.0', 'libwebp.so.7']);
  const loaders = path.join(fx.appdir, 'usr', 'lib', 'x86_64-linux-gnu', 'gdk-pixbuf-2.0', '2.10.0', 'loaders');
  fs.mkdirSync(loaders, { recursive: true });
  fs.writeFileSync(path.join(loaders, 'libpixbufloader-tiff.so'), 'x');
  fs.writeFileSync(path.join(loaders, 'libpixbufloader-png.so'), 'x');
  const cache = path.join(loaders, '..', 'loaders.cache');
  fs.writeFileSync(cache, [
    '# header',
    '"libpixbufloader-png.so"\n"png" 5 "gdk-pixbuf" "PNG" "LGPL"',
    '"libpixbufloader-tiff.so"\n"tiff" 5 "gdk-pixbuf" "TIFF" "LGPL"',
  ].join('\n\n'));
  try {
    const result = run(NON_GST_DROP_BLOCK, { APPDIR: fx.appdir });
    assert.equal(result.status, 0, result.stderr);
    const libs = fs.readdirSync(path.join(fx.appdir, 'usr', 'lib')).filter((n) => /\.so(\.|$)/.test(n)).sort();
    assert.deepEqual(libs, ['libglib-2.0.so.0', 'libwebp.so.7']);
    assert.deepEqual(fs.readdirSync(loaders), ['libpixbufloader-png.so']);
    const after = fs.readFileSync(cache, 'utf8');
    assert.match(after, /libpixbufloader-png\.so/);
    assert.doesNotMatch(after, /tiff/);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('D-013: the guard fails on each newly covered GPL library', () => {
  for (const lib of ['libslang.so.2', 'libgpm.so.2', 'libreadline.so.8', 'libjbig.so.0', 'libayatana-indicator3.so.7', 'libzvbi.so.0']) {
    const fx = fixture(['libgstapp.so'], [lib]);
    try {
      const result = run(GUARD_BLOCK, { APPDIR: fx.appdir });
      assert.equal(result.status, 1, `${lib} should fail the guard`);
      assert.match(result.stderr, new RegExp(lib.replace(/\./g, '\\.')));
    } finally {
      fs.rmSync(fx.root, { recursive: true, force: true });
    }
  }
});

test('D-013: the drop follows the linuxdeploy merge and precedes the GPL library guard', () => {
  const drop = SRC.indexOf('APPIMAGE_GPL_NON_GST_DROP=');
  assert.ok(drop > SRC.indexOf('rm -rf "$DEPLOY_STAGE"'), 'drop must follow the linuxdeploy merge');
  assert.ok(drop < SRC.indexOf('GST_GPL_LIB_ERE='), 'drop must precede the GPL library guard');
});

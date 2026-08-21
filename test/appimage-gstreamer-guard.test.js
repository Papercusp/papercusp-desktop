'use strict';

// EI-20082216700215037 — WebKitGTK's GStreamer libraries are not the element
// plugins. Keep the real build seam and AppRun wiring guarded so a future
// linuxdeploy change cannot silently reintroduce the pristine-host appsink miss.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');
const CODE = SRC.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

test('the AppImage copies the GStreamer plugin directory and scanner', () => {
  assert.match(
    CODE,
    /GST_PLUGIN_SOURCE="\$\{PAPERCUSP_GSTREAMER_PLUGIN_DIR:-\/usr\/lib\/x86_64-linux-gnu\/gstreamer-1\.0\}"/,
  );
  assert.match(CODE, /cp -a "\$GST_PLUGIN_SOURCE"\/\. "\$GST_PLUGIN_DEST"\//);
  assert.match(CODE, /GST_SCANNER_DEST="\$APPDIR\/usr\/lib\/gstreamer1\.0\/gstreamer-1\.0\/gst-plugin-scanner"/);
  assert.match(CODE, /cp -a "\$GST_SCANNER_SOURCE" "\$GST_SCANNER_DEST"/);
});

test('the bundle fails closed when the appsink provider or scanner is absent', () => {
  assert.match(CODE, /\[ ! -f "\$GST_PLUGIN_SOURCE\/libgstapp\.so" \]/);
  assert.match(CODE, /\[ -f "\$GST_PLUGIN_DEST\/libgstapp\.so" \]/);
  assert.match(CODE, /\[ ! -x "\$GST_SCANNER_SOURCE" \]/);
  assert.match(CODE, /\[ -x "\$GST_SCANNER_DEST" \]/);
});

test('AppRun directs GStreamer to the bundled plugin and scanner paths', () => {
  assert.match(CODE, /export GST_PLUGIN_SYSTEM_PATH_1_0="\$HERE\/usr\/lib\/gstreamer-1\.0"/);
  assert.match(CODE, /export GST_PLUGIN_SCANNER="\$_gst_scanner"/);
});

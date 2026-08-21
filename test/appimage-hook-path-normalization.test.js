'use strict';

// EI-21022986568452723 — linuxdeploy-plugin-gtk can write the absolute build
// AppDir into GIO_EXTRA_MODULES when the executable comes from the final AppDir
// but the plugin is assembling a separate deployment stage. The hook is copied
// into the published AppImage, so that path is shipped unless the COPY seam
// normalizes it. Exercise the real Python heredoc from build-appimage.sh rather
// than restating its replacement logic in this test.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'bin', 'build-appimage.sh');
const SRC = fs.readFileSync(SCRIPT, 'utf8');

function realNormalizerBody() {
  const match = SRC.match(
    /python3 - "\$APPDIR" <<'PY_NORMALIZE_APPIMAGE_HOOKS'\n([\s\S]*?)\nPY_NORMALIZE_APPIMAGE_HOOKS/,
  );
  assert.ok(match, 'build-appimage.sh must retain the hook-path normalizer heredoc');
  return match[1];
}

test('real hook normalizer replaces only the exact build AppDir prefix', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'appimage-hook-normalizer-'));
  const appdir = path.join(fixtureRoot, 'Papercusp GUI.AppDir');
  const hooks = path.join(appdir, 'apprun-hooks');
  const hook = path.join(hooks, 'linuxdeploy-plugin-gtk.sh');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(
    hook,
    [
      'export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas"',
      `export GIO_EXTRA_MODULES="$APPDIR/usr/lib/gio/modules\n${appdir}/usr/lib/i386-linux-gnu/gio/modules"`,
      'export UNRELATED_SYSTEM_PATH="/opt/vendor/lib"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const result = spawnSync('python3', ['-', appdir], {
    input: realNormalizerBody(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);

  const normalized = fs.readFileSync(hook, 'utf8');
  assert.ok(!normalized.includes(appdir), 'the build AppDir must not survive in the shipped hook');
  assert.match(normalized, /\$APPDIR\/usr\/lib\/i386-linux-gnu\/gio\/modules/);
  assert.match(normalized, /UNRELATED_SYSTEM_PATH="\/opt\/vendor\/lib"/);
  assert.equal(fs.statSync(hook).mode & 0o777, 0o755, 'rewriting must preserve executable mode');

  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

test('normalization runs after hooks are copied and before the deployment stage is removed', () => {
  const copied = SRC.indexOf('cp -an "$DEPLOY_STAGE/apprun-hooks" "$APPDIR/"');
  const normalized = SRC.indexOf("PY_NORMALIZE_APPIMAGE_HOOKS");
  const removed = SRC.indexOf('rm -rf "$DEPLOY_STAGE"', copied);

  assert.ok(copied >= 0, 'the linuxdeploy hook copy seam must remain explicit');
  assert.ok(normalized > copied, 'normalization must run on the copied, publishable hook');
  assert.ok(removed > normalized, 'normalization must finish before DEPLOY_STAGE is removed');
});

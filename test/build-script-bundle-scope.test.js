'use strict';
/**
 * The default build scripts must SCOPE their bundle targets.
 *
 * WHY THIS EXISTS (EI-18887487... — the 11-hour build)
 * ------------------------------------------------------------------
 * `src-tauri/tauri.conf.json` lists every platform's bundle target
 * (`app,dmg,msi,nsis,deb,rpm,appimage`) because that config is also the RELEASE
 * config. On Linux `tauri build` with no `--bundles` filter therefore builds
 * deb AND rpm AND appimage — three full packagings of the same tree.
 *
 * That was merely wasteful until the sidecar became real. The bundled sidecar is
 * ~4.7 GB, and tauri's rpm bundler compresses IN-PROCESS and SINGLE-THREADED (no
 * child process — it is the `rpm` Rust crate, not a fork of rpmbuild). Measured on
 * this box: the deb — the ONLY artifact anything reads — was complete 2 minutes in,
 * after which the same build sat at 99% CPU on one core compressing an rpm nobody
 * consumes. A sibling build caught in the same step had been burning a core for
 * 10.9 HOURS and had still not reached appimage.
 *
 * The cost is not the wasted core; it is that `npm run build` never returns. Anything
 * that waits for the build to COMPLETE before proceeding — a script, a CI leg, an
 * agent following a runbook — waits effectively forever, while the artifact it wanted
 * has been sitting finished on disk since minute two. The build looks hung; it is
 * actually just still working, on something nobody asked for.
 *
 * Every DEDICATED build path in this repo had already worked this out independently:
 *   bin/build-linux-local.sh   → tauri build --bundles deb
 *   bin/build-appimage.sh      → tauri build --bundles appimage
 * Only the bare `npm run build` — the one a human or agent reaches for first, and the
 * one the docs and runbooks name — inherited the unfiltered list.
 *
 * `build:all-bundles` remains for the genuine every-format case. This guard only
 * pins the DEFAULT, so the fast path stays the default path.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);
const buildWrapperRel = 'bin/build-deb-repacked.sh';
const buildWrapper = fs.readFileSync(path.join(__dirname, '..', buildWrapperRel), 'utf8');

/** Scripts whose whole purpose is "give me a local build, now". */
const DEFAULT_BUILD_SCRIPTS = ['build', 'build:debug'];

test('default build scripts route through the explicitly scoped Debian wrapper', () => {
  for (const name of DEFAULT_BUILD_SCRIPTS) {
    const script = pkg.scripts?.[name];
    assert.ok(script, `package.json is missing the "${name}" script`);
    assert.match(
      script,
      /bin\/build-deb-repacked\.sh/,
      `"${name}" is "${script}" — it must use ${buildWrapperRel}; an unscoped Tauri build also packages ` +
        `rpm and appimage, each a single-threaded in-process compression of the ~4.7GB ` +
        `sidecar. The deb finishes in ~2min and is the only artifact consumed, but the ` +
        `command does not RETURN for hours, so anything awaiting completion hangs. ` +
        `Use ${buildWrapperRel}; run ` +
        `"npm run build:all-bundles" for the rare every-format case.`,
    );
  }
  assert.match(buildWrapper, /BUNDLE_ARGS=\(--bundles deb\)/, `${buildWrapperRel} must retain the Debian-only default`);
});

test('the escape hatch for every-format builds still exists', () => {
  assert.match(
    pkg.scripts?.['build:all-bundles'] ?? '',
    /bin\/build-deb-repacked\.sh --all-bundles/,
    'build:all-bundles must preserve every-format output while routing its Debian artifact through the repacker.',
  );
});

test('the scoped default still builds the artifact the perf suite resolves', () => {
  // tools/perf-test/wdio resolves a binary under release/bundle/deb/**, and
  // papercusp-desktop/bin/lib/installed-app-tree.js only ever inspects deb trees.
  // If the default build ever stops emitting deb, that suite silently falls back to
  // an older/incomplete tree — the exact failure EI-18885442084466501 was about.
  assert.match(
    buildWrapper,
    /BUNDLE_ARGS=\(--bundles deb\)/,
    `${buildWrapperRel} must still include the deb target — it is what ` +
      `bin/lib/installed-app-tree.js inspects and what the packaged perf suite measures.`,
  );
});

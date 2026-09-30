const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'bin/build-windows-cross.sh'), 'utf8');
const linuxScript = fs.readFileSync(path.join(root, 'bin/build-linux-local.sh'), 'utf8');
const appimageScript = fs.readFileSync(path.join(root, 'bin/build-appimage.sh'), 'utf8');
const stageSource = fs.readFileSync(path.join(root, 'bin/stage-source-tree.sh'), 'utf8');
const audit = path.join(root, 'bin/audit-release-bundle.py');
const repoRoot = path.resolve(root, '..');
const supportSources = [
  path.join(repoRoot, 'apps/operator-vite/src/routes/support.tsx'),
  path.join(repoRoot, 'apps/operator/app/support/page.tsx'),
];

// WHY THIS GUARD EXISTS (2026-08-10, WI-37553 / EI-20094260886633250)
//
// The shipped Windows papercusp-desktop.exe carried 359 occurrences of the
// build box's $HOME — 316 from ~/.cargo, 192 from ~/.rustup, 1 workspace path.
// The linux binary carried ZERO for the same source, because the ELF link
// dead-strips those unreferenced rodata panic-location strings; PE/COFF retains
// them, exactly as Mach-O does (EI-20044309663936316). Windows runs no identity
// scan of its own, so nothing ever reported it and it shipped to testers.
//
// The remedy is TWO parts, and BOTH are load-bearing:
//   1. --remap-path-prefix on the cargo-xwin build  ->  359 leaks become 1.
//   2. --scrub-app-binary on the produced .exe      ->  that last 1 becomes 0.
// Part 2 cannot be dropped "because we remap now": the survivor is an absolute
// CARGO_MANIFEST_DIR baked by tauri's permission codegen via env!(), and remap
// only ever rewrites rustc SOURCE paths. Part 1 cannot be dropped "because we
// scrub now" either: the scrub replaces explicit known literals, and leaving 359
// of them for it to find is a far larger surface than leaving 1.
//
// PROPERTY-BASED, NOT SHAPE-BASED — deliberately. The sibling guard in
// build-desktop-sidecar-lock.test.js was a literal-shape matcher and went stale
// the instant a `RUSTFLAGS="..."` was inserted between `&&` and `cargo`,
// producing a FALSE RED that red-pinned the whole @papercusp/desktop task
// (EI-20095745825604620) against a script that had not regressed. So: assert the
// PROPERTY, per occurrence, and name the offending line.
//
// Comment and `echo` lines are excluded throughout. The script legitimately
// DISCUSSES both `--scrub-app-binary` and `run_iscc` in a long explanatory
// comment block, and matching that prose would be the same spelling-vs-property
// error one level up — a guard that passes because it matched its own docs.

const isProse = (line) => /^\s*(?:#|echo\b)/.test(line);

const lines = script.split('\n').map((line, i) => ({ line, lineNo: i + 1 }));
const code = lines.filter(({ line }) => !isProse(line));

const find = (re) => code.filter(({ line }) => re.test(line));

// A backslash-continued command block: walk BACKWARD from an invocation line
// while the preceding line ends in `\`. This is what makes the RUSTFLAGS check
// order-independent — the env assignment may sit anywhere in the block.
function commandBlock(allLines, lineNo) {
  let start = lineNo - 1; // 0-based index of the invocation line
  while (start > 0 && /\\\s*$/.test(allLines[start - 1])) start -= 1;
  return allLines.slice(start, lineNo).join('\n');
}

const scriptLines = script.split('\n');
const CARGO_WIN_BUILD = /cargo\s+xwin\s+build\b/;
const SCRUB_CALL = /--scrub-app-binary\b/;
const ASSEMBLED_SCAN_CALL = /--scan-dir\s+"\$\{_WIN_SCAN_DIRS\[@\]\}"/;
// The CALL, not the definition (`run_iscc() {`).
const ISCC_CALL = /^\s*run_iscc\s+["'$]/;

function extractBashFunction(source, name) {
  const sourceLines = source.split('\n');
  const start = sourceLines.findIndex((line) => line === `${name}() {`);
  assert.ok(start >= 0, `expected ${name}() in the Windows build script`);
  const end = sourceLines.findIndex((line, index) => index > start && line === '}');
  assert.ok(end > start, `expected a closing brace for ${name}()`);
  return sourceLines.slice(start, end + 1).join('\n');
}

function runIsccHarness(compilerExit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-iscc-status-'));
  const stage = path.join(dir, 'stage');
  const outDir = path.join(dir, 'collected');
  const binDir = path.join(dir, 'bin');
  const appName = 'Fixture App';
  const version = '9.8.7-test';
  fs.mkdirSync(binDir, { recursive: true });

  const xvfbRun = path.join(binDir, 'xvfb-run');
  fs.writeFileSync(
    xvfbRun,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'mkdir -p "$TEST_STAGE/out"',
      'printf "  Compressing fixture payload\\n"',
      'printf "fixture compiler result\\n"',
      // A failed compiler that leaves an artifact is the dangerous case: the
      // old `|| true` path moved this file and returned success.
      'touch "$TEST_STAGE/out/${TEST_APP_NAME}_${TEST_VERSION}_x64-setup.exe"',
      'exit "$TEST_COMPILER_EXIT"',
    ].join('\n'),
  );
  fs.chmodSync(xvfbRun, 0o755);

  const harness = [
    'set -euo pipefail',
    `STAGE=${JSON.stringify(stage)}`,
    `OUT_DIR=${JSON.stringify(outDir)}`,
    `VERSION=${JSON.stringify(version)}`,
    `WINEPREFIX_INNO=${JSON.stringify(path.join(dir, 'wine'))}`,
    `ISCC_EXE=${JSON.stringify(path.join(dir, 'ISCC.exe'))}`,
    `ISS_WIN=${JSON.stringify(path.join(dir, 'fixture.iss'))}`,
    'BUILDROOT_WIN="$STAGE"',
    'SPAN_DEFINE=()',
    'mkdir -p "$STAGE" "$OUT_DIR"',
    'winpath() { printf "%s\\n" "$1"; }',
    'fail() { echo "ERROR: $*" >&2; exit 1; }',
    extractBashFunction(script, 'run_iscc'),
    'run_iscc fixture-id "$TEST_APP_NAME"',
  ].join('\n');

  try {
    return {
      result: spawnSync('bash', ['-c', harness], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH || ''}`,
          TEST_STAGE: stage,
          TEST_APP_NAME: appName,
          TEST_VERSION: version,
          TEST_COMPILER_EXIT: String(compilerExit),
        },
      }),
      artifact: path.join(outDir, `${appName}_${version}_x64-setup.exe`),
    };
  } finally {
    // The returned artifact path is useful only for the immediate assertion;
    // defer cleanup to the caller so it can inspect the filesystem verdict.
  }
}

test('run_iscc rejects a failed compiler even when it leaves an expected artifact', () => {
  const { result, artifact } = runIsccHarness(23);
  try {
    assert.notEqual(result.status, 0, `failed ISCC was accepted:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /ISCC failed for role 'Fixture App' \(exit 23\)/);
    assert.equal(
      fs.existsSync(artifact),
      false,
      'an artifact left by failed ISCC must not be moved into the collected release output',
    );
  } finally {
    fs.rmSync(path.dirname(path.dirname(artifact)), { recursive: true, force: true });
  }
});

test('run_iscc preserves successful compilation while filtering progress noise', () => {
  const { result, artifact } = runIsccHarness(0);
  try {
    assert.equal(result.status, 0, `successful ISCC was rejected:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /fixture compiler result/);
    assert.doesNotMatch(result.stdout, /Compressing fixture payload/);
    assert.equal(fs.existsSync(artifact), true, 'successful ISCC artifact was not collected');
  } finally {
    fs.rmSync(path.dirname(path.dirname(artifact)), { recursive: true, force: true });
  }
});

test('the Windows cross-build defines a path remap containing --remap-path-prefix', () => {
  const def = find(/^_WIN_REMAP=/);
  assert.equal(def.length, 1, 'expected exactly one _WIN_REMAP definition');
  assert.match(
    def[0].line,
    /--remap-path-prefix=/,
    '_WIN_REMAP must actually carry --remap-path-prefix; without it the exe re-acquires ~350 leaked $HOME paths',
  );
});

test('every cargo-xwin build passes RUSTFLAGS carrying the remap', () => {
  const builds = find(CARGO_WIN_BUILD);
  assert.ok(builds.length > 0, 'expected at least one `cargo xwin build` invocation to guard');

  const unremapped = builds
    .filter(({ lineNo }) => {
      const block = commandBlock(scriptLines, lineNo);
      return !(/RUSTFLAGS=/.test(block) && /_WIN_REMAP|--remap-path-prefix/.test(block));
    })
    .map(({ lineNo, line }) => `${lineNo}: ${line.trim()}`);

  assert.deepEqual(
    unremapped,
    [],
    'these cargo-xwin builds run WITHOUT the path remap, so the .exe will bake the build box $HOME',
  );
});

test('the Windows cross-build compiles an immutable source snapshot and pins its stamp', () => {
  assert.match(
    script,
    /BUILD_COMMIT_SHA="\$\(git -C "\$SOURCE_ROOT" rev-parse HEAD/,
    'the producer must resolve the source commit before cargo starts',
  );
  assert.match(
    script,
    /git -C "\$SOURCE_ROOT" worktree add --detach "\$BUILD_ROOT" "\$BUILD_COMMIT_SHA"/,
    'the producer must build from a private worktree, not the shared checkout',
  );
  assert.match(
    script,
    /PAPERCUSP_BUILD_SHA=.*does not identify source HEAD/,
    'a caller-supplied build stamp must be rejected when it names a different commit',
  );
  assert.match(
    script,
    /ROOT="\$BUILD_ROOT"\nSRC_TAURI="\$ROOT\/src-tauri"/,
    'cargo and packaging inputs must switch to the isolated source after snapshotting',
  );
  assert.match(
    script,
    /OUT_DIR="\$OUTPUT_SRC_TAURI\/target\/windows-vm\/bundle\/inno"/,
    'artifacts must remain in the canonical collector tree after the source snapshot is removed',
  );
  assert.match(
    script,
    /git -C "\$SOURCE_ROOT" worktree remove --force "\$BUILD_ROOT"/,
    'the temporary source worktree must be cleaned up on exit',
  );
});

test('the produced .exe is identity-scrubbed BEFORE ISCC packs it', () => {
  const scrubs = find(SCRUB_CALL);
  assert.ok(
    scrubs.length > 0,
    'no --scrub-app-binary call: the env!()-baked CARGO_MANIFEST_DIR that remap cannot reach will ship',
  );

  const packs = find(ISCC_CALL);
  assert.ok(packs.length > 0, 'expected at least one run_iscc call to order against');

  // Ordering is the whole point. On mac this identical call once sat in
  // sign_app(), which runs after the identity scan, so it never executed and the
  // cut died with the leak intact. Presence is not enough; placement is.
  const firstScrub = Math.min(...scrubs.map((s) => s.lineNo));
  const firstPack = Math.min(...packs.map((p) => p.lineNo));
  assert.ok(
    firstScrub < firstPack,
    `scrub (line ${firstScrub}) must precede the first run_iscc call (line ${firstPack}) — scrubbing after packaging leaves the leaky bytes inside the installer`,
  );
});

test('each Windows role scans the assembled payload before ISCC packs it', () => {
  const scanAt = script.indexOf('python3 "$HERE/audit-release-bundle.py" --scan-dir "${_WIN_SCAN_DIRS[@]}"');
  const copyAt = script.indexOf('cp -f "$EXE" "$STAGE/target/release/papercusp-desktop.exe"');
  const packAt = script.indexOf('run_iscc "$app_id" "$app_name"');

  assert.ok(scanAt > -1, 'Windows must run the assembled-payload identity gate');
  assert.ok(copyAt > -1, 'the assembled payload must contain the role exe before the scan');
  assert.ok(scanAt > copyAt, 'the scan must inspect the staged role exe, not only the pre-stage binary');
  assert.ok(packAt > scanAt, 'the installer must not be packed before the assembled-payload scan passes');

  // The BuildRoot is symlinked for speed; passing it to grep -r would skip the
  // directories Inno follows. These real roots are the shipped inputs, and the
  // server-only roots protect the conditional [Files] entries in papercusp.iss.
  for (const root of ['$STAGE/target/release', '$SRC_TAURI/sidecar', '$SRC_TAURI/resources']) {
    assert.match(script, new RegExp(`"\\${root}"`), `assembled scan must include ${root}`);
  }
  assert.match(
    script,
    /_WIN_SCAN_DIRS\+=\("\$SRC_TAURI\/seed"\s+"\$SRC_TAURI\/env-sidecars\/staging"\)/,
    'server payload roots (seed and env-sidecars) must be scanned too',
  );
});

test('source staging runs the owner-name preflight before creating or compressing the archive', () => {
  const preflightAt = stageSource.indexOf(
    'python3 "$HERE/audit-release-bundle.py" --owner-preflight',
  );
  const outputAt = stageSource.indexOf('OUT_TMP="$(mktemp "${OUT}.tmp.XXXXXX")"');
  const tarAt = stageSource.indexOf('"$TAR_BIN" --numeric-owner');

  assert.ok(preflightAt >= 0, 'stage-source-tree.sh must invoke --owner-preflight');
  assert.ok(outputAt >= 0, 'stage-source-tree.sh must still create its temporary archive');
  assert.ok(tarAt >= 0, 'stage-source-tree.sh must still invoke the archive producer');
  assert.ok(preflightAt < outputAt, 'owner preflight must run before OUT_TMP is created');
  assert.ok(preflightAt < tarAt, 'owner preflight must run before tar/zstd archive work');
});

test('the Linux local release entrypoint runs owner-name preflight before sidecar assembly', () => {
  const preflightAt = linuxScript.indexOf(
    'python3 "$HERE/audit-release-bundle.py" --owner-preflight',
  );
  const sidecarAt = linuxScript.indexOf('bash "$ROOT/bin/build-desktop-sidecar.sh"');

  assert.ok(preflightAt >= 0, 'build-linux-local.sh must invoke --owner-preflight');
  assert.ok(sidecarAt >= 0, 'build-linux-local.sh must retain sidecar assembly');
  assert.ok(
    preflightAt < sidecarAt,
    'Linux must reject a missing owner assertion before sidecar assembly starts; the shared stage guard is too late',
  );
  assert.match(
    linuxScript.slice(0, preflightAt),
    /PAPERCUSP_RELEASE_OWNER_NAME/,
    'the Linux entrypoint header must document the required runtime-only owner-name contract',
  );
});

test('the Linux local release entrypoint restores Cargo from CARGO_HOME before build work', () => {
  const preflightAt = linuxScript.indexOf(
    'python3 "$HERE/audit-release-bundle.py" --owner-preflight',
  );
  const cargoGuardAt = linuxScript.indexOf('_cargo_home="${CARGO_HOME:-$HOME/.cargo}"');
  const sidecarAt = linuxScript.indexOf('bash "$ROOT/bin/build-desktop-sidecar.sh"');
  const metadataAt = linuxScript.indexOf('cargo metadata --no-deps --format-version 1');

  assert.ok(cargoGuardAt > preflightAt, 'Cargo resolution must preserve owner-preflight ordering');
  assert.ok(sidecarAt > cargoGuardAt, 'Cargo must fail closed before sidecar assembly starts');
  assert.ok(metadataAt > cargoGuardAt, 'Cargo must be resolved before parent target discovery');
  const guard = linuxScript.slice(cargoGuardAt, sidecarAt);
  assert.match(guard, /! command -v cargo[^\n]+&& \[\[ -x "\$_cargo_home\/bin\/cargo" \]\]/);
  assert.match(guard, /export PATH="\$_cargo_home\/bin:\$PATH"/);
  assert.match(guard, /hash -r/);
  assert.match(guard, /Linux release build requires Cargo/);
  assert.match(guard, /exit 1/);

  const runPreflight = ({ installCargo, installAmbientCargo = false }) => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wi240169-linux-cargo-'));
    const cargoHome = path.join(home, 'cargo-home');
    const ambientBin = path.join(home, 'ambient-bin');
    fs.mkdirSync(path.join(cargoHome, 'bin'), { recursive: true });
    if (installCargo) {
      const cargo = path.join(cargoHome, 'bin', 'cargo');
      fs.writeFileSync(cargo, '#!/bin/sh\necho "cargo 1.99.0-test"\n');
      fs.chmodSync(cargo, 0o755);
    }
    if (installAmbientCargo) {
      fs.mkdirSync(ambientBin, { recursive: true });
      const cargo = path.join(ambientBin, 'cargo');
      fs.writeFileSync(cargo, '#!/bin/sh\necho "cargo 2.0.0-ambient"\n');
      fs.chmodSync(cargo, 0o755);
    }

    const env = {
      ...process.env,
      PATH: installAmbientCargo ? `${ambientBin}:/usr/bin:/bin` : '/usr/bin:/bin',
      HOME: home,
      CARGO_HOME: cargoHome,
      CARGO_TARGET_DIR: path.join(home, 'cargo-target'),
      PAPERCUSP_RELEASE_OWNER_NAME: 'Synthetic Gateowner',
      PAPERCUSP_RELEASE_HOST: 'updates.invalid.test',
      PAPERCUSP_SKIP_SEED_CUT: '1',
      TAURI_SIGNING_PRIVATE_KEY_PATH: path.join(home, 'missing-signing-key'),
    };
    delete env.TAURI_SIGNING_PRIVATE_KEY;

    try {
      return spawnSync('bash', [path.join(root, 'bin/build-linux-local.sh')], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  };

  const restored = runPreflight({ installCargo: true });
  const restoredOutput = `${restored.stdout}${restored.stderr}`;
  assert.equal(restored.status, 1, restoredOutput);
  assert.match(restoredOutput, /using Cargo toolchain: .*cargo-home\/bin\/cargo \(cargo 1\.99\.0-test\)/);
  assert.match(restoredOutput, /minisign signing key not found/,
    'the probe must advance beyond Cargo and stop before sidecar assembly at the missing signing key');
  assert.doesNotMatch(restoredOutput, /\[1\/5\] building sidecar/);

  const missing = runPreflight({ installCargo: false });
  const missingOutput = `${missing.stdout}${missing.stderr}`;
  assert.equal(missing.status, 1, missingOutput);
  assert.match(missingOutput, /Linux release build requires Cargo/);
  assert.doesNotMatch(missingOutput, /minisign signing key not found|\[1\/5\] building sidecar/,
    'missing Cargo must fail before later release preflights or build work');

  const callerSelected = runPreflight({ installCargo: true, installAmbientCargo: true });
  const callerSelectedOutput = `${callerSelected.stdout}${callerSelected.stderr}`;
  assert.equal(callerSelected.status, 1, callerSelectedOutput);
  assert.match(callerSelectedOutput, /using Cargo toolchain: .*ambient-bin\/cargo \(cargo 2\.0\.0-ambient\)/,
    'an existing caller-selected Cargo must win over CARGO_HOME/bin');
  assert.doesNotMatch(callerSelectedOutput, /cargo 1\.99\.0-test/);
});

test('the Linux local release entrypoint self-snapshots before long-running work', () => {
  const snapshotAt = linuxScript.indexOf('PAPERCUSP_BUILD_LINUX_SELF_SNAPSHOT');
  const reexecAt = linuxScript.indexOf('exec bash "$BUILD_LINUX_SNAPSHOT_DIR/build-linux-local.sh"');
  const preflightAt = linuxScript.indexOf(
    'python3 "$HERE/audit-release-bundle.py" --owner-preflight',
  );

  assert.ok(snapshotAt >= 0, 'build-linux-local.sh must declare its immutable self-snapshot guard');
  assert.ok(reexecAt >= 0, 'build-linux-local.sh must re-exec the private snapshot');
  assert.ok(preflightAt >= 0, 'build-linux-local.sh must retain the owner preflight');
  assert.ok(
    reexecAt < preflightAt,
    'the immutable re-exec must happen before any long-running release work can observe a live-tree rewrite',
  );
  assert.match(
    linuxScript.slice(snapshotAt, preflightAt),
    /PAPERCUSP_BUILD_LINUX_ROOT/,
    'the snapshot must preserve the original repo root instead of resolving resources under /tmp',
  );
});

test('the Linux local release entrypoint can resume from a fully staged sidecar', () => {
  const resumeAt = linuxScript.indexOf('PAPERCUSP_REUSE_SIDECAR=1 — validating');
  const packageAt = linuxScript.indexOf('tauri build --bundles deb');

  assert.ok(resumeAt >= 0, 'build-linux-local.sh must expose the existing PAPERCUSP_REUSE_SIDECAR convention');
  assert.ok(packageAt > resumeAt, 'sidecar validation must precede Tauri packaging');
  for (const required of [
    'src-tauri/sidecar/serve.mjs',
    'src-tauri/sidecar/spa/index.html',
    'src-tauri/sidecar/env-sidecars/staging',
    'src-tauri/sidecar/source.tar.zst',
    'src-tauri/sidecar/build-provenance.json',
  ]) {
    assert.match(
      linuxScript.slice(resumeAt, packageAt),
      new RegExp(required.replaceAll('.', '\\.').replaceAll('/', '\\/')),
      `resume mode must fail closed when ${required} is absent`,
    );
  }
  assert.match(
    linuxScript.slice(resumeAt, packageAt),
    /verify-sidecar-bundle\.sh/,
    'resume mode must rerun the canonical sidecar verifier before packaging reused bytes',
  );
  const verifyAt = linuxScript.indexOf('verify-sidecar-bundle.sh', resumeAt);
  const privacyAt = linuxScript.indexOf('audit-release-bundle.py', verifyAt);
  assert.ok(
    privacyAt > verifyAt && privacyAt < packageAt,
    'resume mode must identity-scan reused sidecar bytes before spending time packaging them',
  );
  assert.match(
    linuxScript.slice(privacyAt, packageAt),
    /--scan-dir "\$ROOT\/src-tauri\/sidecar"/,
    'the reuse privacy gate must scan the complete staged sidecar, not only selected paths',
  );
});

test('support publishing examples never embed the owner identity in shipped SPA source', () => {
  for (const source of supportSources) {
    const content = fs.readFileSync(source, 'utf8');
    assert.doesNotMatch(
      content,
      // Any personal scope on the template example — generic, so this file never has to
      // name the owner (it ships in the public export).
      /@(?!yourname\/)[\w-]+\/my-template/i,
      `${path.relative(repoRoot, source)} must use a generic namespace example`,
    );
    assert.match(content, /@yourname\/my-template/);
  }
});

test('the Linux AppImage producer removes Tauri intermediates before audited packaging', () => {
  const tauriAt = appimageScript.indexOf(
    'npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri build --bundles appimage',
  );
  const purgeAt = appimageScript.indexOf(
    'purging Tauri-produced same-version AppImage intermediates before audited packaging',
  );
  const packageAt = appimageScript.indexOf(
    'run_appimage_tool_isolated "$PLUGIN" "$OUT" "$APPDIR"',
  );

  assert.ok(tauriAt >= 0, 'build-appimage.sh must retain the Tauri AppDir producer');
  assert.ok(purgeAt > tauriAt, 'Tauri outputs can only be purged after Tauri finishes producing the AppDir');
  assert.ok(packageAt > purgeAt, 'the audited custom AppImage must be packaged only after intermediates are purged');

  const purgeBlock = appimageScript.slice(purgeAt, packageAt);
  assert.match(
    purgeBlock,
    /release_artifacts_guarded_delete/,
    'intermediate cleanup must use the retention-aware deletion guard',
  );
  assert.match(
    purgeBlock,
    /"\$APPIMG_DIR"\/\*_"\$VERSION"_\*\.AppImage/,
    'every same-version Tauri AppImage must be removed instead of relying on one product-name spelling',
  );
  assert.match(
    purgeBlock,
    /"\$APPIMG_DIR"\/\*_"\$VERSION"_\*\.AppImage\.sig/,
    'the matching updater signature must not survive as an orphaned publish candidate',
  );
});

test('the Linux AppImage producer preflights owner identity before toolchain work', () => {
  const preflightAt = appimageScript.indexOf('python3 "$AUDIT_PY" --owner-preflight');
  const metadataAt = appimageScript.indexOf('cargo metadata --no-deps --format-version 1');
  const tauriAt = appimageScript.indexOf(
    'npx --yes -p @tauri-apps/cli@"$TAURI_CLI_VERSION" tauri build --bundles appimage',
  );

  assert.ok(preflightAt >= 0, 'build-appimage.sh must fail fast on a missing owner-name assertion');
  assert.ok(metadataAt >= 0, 'build-appimage.sh must retain Cargo target discovery');
  assert.ok(tauriAt >= 0, 'build-appimage.sh must retain the Tauri AppDir producer');
  assert.ok(preflightAt < metadataAt, 'owner-name preflight must precede Cargo metadata/toolchain work');
  assert.ok(preflightAt < tauriAt, 'owner-name preflight must precede Tauri packaging');
  assert.match(
    appimageScript.slice(preflightAt, metadataAt),
    /owner-name preflight failed.*AppImage build/i,
    'the direct AppImage failure must identify the early owner-name boundary',
  );
});

test('the Linux local release entrypoint claims one Cargo target slot before either role builds', () => {
  const claimAt = linuxScript.indexOf('source "$HERE/lib/claim-target-dir.sh"');
  const metadataAt = linuxScript.indexOf('cargo metadata --no-deps --format-version 1');
  const packageAt = linuxScript.indexOf('tauri build --bundles deb');

  assert.ok(claimAt >= 0, 'build-linux-local.sh must source the shared target-slot claimant');
  assert.ok(metadataAt >= 0, 'build-linux-local.sh must retain Cargo target discovery');
  assert.ok(packageAt >= 0, 'build-linux-local.sh must retain Tauri packaging');
  assert.ok(claimAt < metadataAt, 'the claimed CARGO_TARGET_DIR must drive Cargo metadata');
  assert.ok(claimAt < packageAt, 'the target slot must be held before either GUI or Server build starts');
});

test('the Linux local release entrypoint pins one immutable sidecar snapshot through packaging', () => {
  const helperAt = linuxScript.indexOf('hold_sidecar_read_lock()');
  const freshCallAt =
    /bash "\$ROOT\/bin\/stage-source-tree\.sh"\r?\n\s+hold_sidecar_read_lock/.exec(linuxScript)?.index ?? -1;
  const reuseAt = linuxScript.indexOf('PAPERCUSP_REUSE_SIDECAR=1 — validating');
  const reuseCallAt = linuxScript.indexOf('hold_sidecar_read_lock', reuseAt);
  const verifyAt = linuxScript.indexOf('verify-sidecar-bundle.sh', reuseAt);
  const packageAt = linuxScript.indexOf('tauri build --bundles deb');

  assert.ok(helperAt >= 0, 'build-linux-local.sh must define the sidecar reader-lock helper');
  assert.ok(freshCallAt >= 0, 'a fresh build must pin the published sidecar after staging');
  assert.ok(reuseAt >= 0 && reuseCallAt > reuseAt, 'resume mode must pin the reused sidecar');
  assert.ok(reuseCallAt < verifyAt, 'resume validation must run against the already-pinned sidecar tree');
  assert.ok(verifyAt < packageAt, 'sidecar validation must precede Tauri packaging');
  assert.match(
    linuxScript.slice(helperAt, reuseAt),
    /exec 9>>"\$lock"[\s\S]*flock -sn 9[\s\S]*flock -s 9/,
    'the helper must reuse the existing shared-fd9 reader protocol, including a blocking writer wait',
  );
});

test('owner preflight fails closed for an automation Git identity without an asserted owner name', () => {
  const env = { ...process.env,
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'user.name',
    GIT_CONFIG_VALUE_0: 'ci-build-bot',
    GIT_CONFIG_KEY_1: 'user.email',
    GIT_CONFIG_VALUE_1: 'ci-build-bot@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  delete env.PAPERCUSP_RELEASE_OWNER_NAME;
  delete env.PAPERCUSP_RELEASE_OWNER_EMAIL;

  const missing = spawnSync('python3', [audit, '--owner-preflight'], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  assert.equal(
    missing.status,
    2,
    `automation identity without an owner assertion must refuse staging:\n${missing.stdout}\n${missing.stderr}`,
  );
  assert.match(`${missing.stdout}\n${missing.stderr}`, /no owner-name literal resolved/i);

  const asserted = spawnSync('python3', [audit, '--owner-preflight'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...env, PAPERCUSP_RELEASE_OWNER_NAME: 'Synthetic Gateowner' },
  });
  assert.equal(
    asserted.status,
    0,
    `an explicit owner assertion must satisfy the preflight:\n${asserted.stdout}\n${asserted.stderr}`,
  );
});

// FALSIFIABILITY — the guard-for-the-guard.
//
// A guard that has never failed is a guard nobody has tested. These prove the
// matchers CATCH the regressions they exist for, and (critically) that they do
// NOT match the script's own prose. Proved against SYNTHETIC strings only: this
// tree is swept into commits every few minutes, so briefly mutating the real
// script to test a guard can get that mutation committed even when nothing goes
// wrong and no handler fails.
test('the matchers catch a regressed script and ignore prose', () => {
  const analyse = (text) => {
    const all = text.split('\n');
    const codeOnly = all
      .map((line, i) => ({ line, lineNo: i + 1 }))
      .filter(({ line }) => !isProse(line));
    const builds = codeOnly.filter(({ line }) => CARGO_WIN_BUILD.test(line));
    return {
      remapped: builds.every(({ lineNo }) => /RUSTFLAGS=/.test(commandBlock(all, lineNo))),
      buildCount: builds.length,
      scrubCount: codeOnly.filter(({ line }) => SCRUB_CALL.test(line)).length,
      assembledScanCount: codeOnly.filter(({ line }) => ASSEMBLED_SCAN_CALL.test(line)).length,
      packLine: Math.min(
        ...codeOnly.filter(({ line }) => ISCC_CALL.test(line)).map((p) => p.lineNo),
        Infinity,
      ),
      scrubLine: Math.min(
        ...codeOnly.filter(({ line }) => SCRUB_CALL.test(line)).map((s) => s.lineNo),
        Infinity,
      ),
    };
  };

  // 1. An unremapped build is caught.
  const unremapped = analyse(['( cd "$SRC_TAURI" && env \\', '    cargo xwin build --release )'].join('\n'));
  assert.equal(unremapped.buildCount, 1, 'sanity: the sample contains one build');
  assert.equal(unremapped.remapped, false, 'a build with no RUSTFLAGS must be reported as unremapped');

  // 2. A remapped build passes.
  const remapped = analyse(
    ['( cd "$SRC_TAURI" && env \\', '    "RUSTFLAGS=$_WIN_REMAP" \\', '    cargo xwin build --release )'].join('\n'),
  );
  assert.equal(remapped.remapped, true, 'a build carrying RUSTFLAGS must pass');

  // 3. Prose is NOT counted — the exact error this guard is written to avoid.
  const prose = analyse(
    [
      '# we call --scrub-app-binary before run_iscc "gui" for identity reasons',
      'echo "  running --scrub-app-binary before run_iscc \\"x\\""',
    ].join('\n'),
  );
  assert.equal(prose.scrubCount, 0, 'a commented/echoed --scrub-app-binary must not count as a real call');
  assert.equal(prose.packLine, Infinity, 'a commented/echoed run_iscc must not count as a real call');

  // 4. The assembled-payload gate is a real call, not prose.
  const realScan = analyse('python3 "$HERE/audit-release-bundle.py" --scan-dir "${_WIN_SCAN_DIRS[@]}"');
  assert.equal(realScan.assembledScanCount, 1, 'a real assembled-payload scan must be counted');

  // 5. Scrub AFTER packing is caught — the mac failure mode, restated.
  const late = analyse(['run_iscc "$APP_ID" "$APP_NAME"', 'python3 audit.py --scrub-app-binary "$EXE"'].join('\n'));
  assert.ok(
    !(late.scrubLine < late.packLine),
    'scrubbing after run_iscc must NOT be accepted — the installer already carries the leaky bytes',
  );
});

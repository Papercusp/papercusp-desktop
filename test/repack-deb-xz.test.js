const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
// Overridable so scripts/mutation-probe.sh can point the suite at an out-of-tree mutant copy.
const helper = process.env.PAPERCUSP_REPACK_HELPER_UNDER_TEST || path.join(root, 'bin', 'repack-deb-xz.sh');
const buildWrapperRel = 'bin/build-deb-repacked.sh';
const tauriGuardRel = 'bin/tauri-guarded';

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  assert.equal(res.status, 0, `${cmd} failed (${res.status}): ${res.stderr}`);
  return res.stdout;
}

test('bounds xz workers and compression memory independently of host core count', () => {
  const source = fs.readFileSync(helper, 'utf8');
  assert.doesNotMatch(source, /\bxz\s+-9\s+-T0\b/, 'the release repacker must never scale workers to every host core');
  assert.match(source, /PAPERCUSP_XZ_THREADS:-4/, 'the default worker budget must remain explicit and bounded');
  assert.match(source, /PAPERCUSP_XZ_MEMORY_LIMIT:-4GiB/, 'the default compression-memory budget must remain explicit');
  assert.match(
    source,
    /xz -9 "-T\$\{XZ_THREADS\}" "--memlimit-compress=\$\{XZ_MEMORY_LIMIT\}" -c/,
    'the canonical xz invocation must apply both budgets',
  );
  assert.match(source, /PAPERCUSP_XZ_THREADS must be a positive integer/);
  assert.match(source, /PAPERCUSP_XZ_MEMORY_LIMIT must be a non-zero KiB\/MiB\/GiB value/);
});

test('a repack pipeline failure names every component and preserves the original deb', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-failure-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-failure-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: repack failure fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'original bytes survive\n');
    const deb = path.join(tmp, 'fixture.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    const original = fs.readFileSync(deb);

    const fakeBin = path.join(tmp, 'bin');
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'xz'), '#!/usr/bin/env bash\nexit 42\n', { mode: 0o755 });
    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        TAURI_SIGNING_PRIVATE_KEY: '',
      },
    });

    assert.equal(res.status, 9, `expected dedicated repack-pipeline failure, got ${res.status}: ${res.stderr}`);
    assert.match(res.stderr, /FATAL: Debian data repack pipeline failed/);
    assert.match(
      res.stderr,
      /component statuses: ar=0 decompress\(gzip\)=0 dedupe-python=[1-9][0-9]* xz=42/,
      'the primary xz failure and its upstream BrokenPipe must both remain attributable',
    );
    assert.deepEqual(fs.readFileSync(deb), original, 'a failed pipeline must not replace the known-good gzip deb');
    assert.match(run('ar', ['t', deb]), /data\.tar\.gz/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('replaces only data.tar.gz with data.tar.xz and remains dpkg-readable', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-test-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'usr', 'share', 'papercusp'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: repack fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'usr', 'share', 'papercusp', 'payload.txt'), 'payload survives recompression\n');
    const sidecar = path.join(pkg, 'usr', 'lib', 'Papercusp GUI', 'sidecar');
    const staging = path.join(sidecar, 'env-sidecars', 'staging');
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(sidecar, 'serve.mjs'), 'console.log("same staged bundle");\n');
    fs.copyFileSync(path.join(sidecar, 'serve.mjs'), path.join(staging, 'serve.mjs'));

    const deb = path.join(tmp, 'fixture.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    assert.match(run('ar', ['t', deb]), /data\.tar\.gz/);

    run('bash', [helper, deb], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' } });
    const members = run('ar', ['t', deb]).trim().split('\n');
    assert.deepEqual(members, ['debian-binary', 'control.tar.gz', 'data.tar.xz']);

    const extracted = path.join(tmp, 'extracted');
    run('dpkg-deb', ['-x', deb, extracted]);
    assert.equal(fs.readFileSync(path.join(extracted, 'usr', 'share', 'papercusp', 'payload.txt'), 'utf8'), 'payload survives recompression\n');
    const primaryStat = fs.statSync(path.join(extracted, 'usr', 'lib', 'Papercusp GUI', 'sidecar', 'serve.mjs'));
    const stagedStat = fs.statSync(path.join(extracted, 'usr', 'lib', 'Papercusp GUI', 'sidecar', 'env-sidecars', 'staging', 'serve.mjs'));
    assert.equal(primaryStat.ino, stagedStat.ino, 'dpkg extraction must restore staging as a hardlink to the primary payload');

    const listing = run('bash', ['-c', 'dpkg-deb --fsys-tarfile "$1" | tar -tvf -', '_', deb]);
    assert.match(listing, /env-sidecars\/staging\/serve\.mjs link to .*sidecar\/serve\.mjs/);

    // A second pass is deliberately idempotent and still validates the package.
    run('bash', [helper, deb], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' } });
    assert.deepEqual(run('ar', ['t', deb]).trim().split('\n'), members);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('WI-39357: repacked deb with paths >100 chars installs via `dpkg --unpack` (not just `dpkg-deb -x`)', () => {
  // Regression guard for WI-39357. Prior to the fix, dedupe-env-sidecar-tar.py
  // opened its output stream in tarfile.PAX_FORMAT, which emits type-'x' extended
  // headers for any entry whose path exceeds the USTAR 100-char limit — the
  // packaged Papercusp deb hits that on every deep sidecar path. libdpkg's
  // install/--unpack walker rejects PAX 'x' ("unsupported PAX tar header type
  // 'x'"), refusing every end-user install of the 0.0.17 debs. But `dpkg-deb -x`,
  // `dpkg -x`, and `dpkg-deb --fsys-tarfile | tar tv` TOLERATE PAX 'x' — so a
  // fixture-only extraction test misses the regression. This test exercises the
  // exact strict path with a path long enough to force the header format matter,
  // AND greps the produced tar for PAX-x metadata as a belt-and-braces check.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-pax-regression-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    // Sidecar path deliberately >100 chars to force USTAR overflow → PAX/GNU headers.
    const longDeepDir = path.join(
      'usr', 'lib', 'Papercusp GUI', 'sidecar',
      'deeply', 'nested', 'path', 'that', 'exceeds', 'one', 'hundred',
      'characters', 'for', 'sure', 'testing', 'paxrejection',
    );
    const longStagingDir = path.join(
      'usr', 'lib', 'Papercusp GUI', 'sidecar', 'env-sidecars', 'staging',
      'deeply', 'nested', 'path', 'that', 'exceeds', 'one', 'hundred',
      'characters', 'for', 'sure', 'testing', 'paxrejection',
    );
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, longDeepDir), { recursive: true });
    fs.mkdirSync(path.join(pkg, longStagingDir), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-pax-fix-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: WI-39357 <test@example.invalid>',
      'Description: PAX header regression fixture',
      '',
    ].join('\n'));
    const payload = 'identical bytes\n';
    fs.writeFileSync(path.join(pkg, longDeepDir, 'file.txt'), payload);
    fs.writeFileSync(path.join(pkg, longStagingDir, 'file.txt'), payload);

    const deb = path.join(tmp, 'fixture.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    run('bash', [helper, deb], { env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' } });

    // Belt: the produced tar must not contain PAX-x header markers.
    const tarBytes = spawnSync(
      'bash',
      ['-c', `ar p "${deb}" data.tar.xz | xz -dc | head -c $((256 * 1024))`],
      { encoding: 'buffer' },
    ).stdout ?? Buffer.alloc(0);
    const tarPreview = tarBytes.toString('latin1');
    assert.equal(
      /(PaxHeader|SCHILY\.xattr|paxheader)/.test(tarPreview),
      false,
      'repacked tar must not contain PAX extended-header markers (WI-39357 regression: PAX_FORMAT emitted type-x headers that dpkg install-refuses)',
    );

    // Braces: the strict libdpkg install walker (the exact code path that
    // refuses the shipped 0.0.17 debs) must accept the repacked deb. Rootless
    // via --root/--admindir/--force-not-root so this runs in-CI as any user.
    const dpkgRoot = path.join(tmp, 'dpkgroot');
    fs.mkdirSync(path.join(dpkgRoot, 'var', 'lib', 'dpkg', 'updates'), { recursive: true });
    fs.mkdirSync(path.join(dpkgRoot, 'var', 'lib', 'dpkg', 'info'), { recursive: true });
    fs.mkdirSync(path.join(dpkgRoot, 'var', 'lib', 'dpkg', 'triggers'), { recursive: true });
    fs.writeFileSync(path.join(dpkgRoot, 'var', 'lib', 'dpkg', 'status'), '');
    const unpack = spawnSync('dpkg', [
      `--root=${dpkgRoot}`,
      `--instdir=${dpkgRoot}`,
      `--admindir=${path.join(dpkgRoot, 'var', 'lib', 'dpkg')}`,
      '--force-not-root',
      '--no-triggers',
      '--unpack',
      deb,
    ], { encoding: 'utf8' });
    assert.equal(
      unpack.status,
      0,
      `dpkg --unpack must succeed on the repacked deb (WI-39357): ${unpack.stderr || unpack.stdout}`,
    );
    // And the extracted tree must include both the long-path files.
    assert.ok(
      fs.existsSync(path.join(dpkgRoot, longDeepDir, 'file.txt')),
      'long-path primary file must be unpacked',
    );
    assert.ok(
      fs.existsSync(path.join(dpkgRoot, longStagingDir, 'file.txt')),
      'long-path staging hardlink must be unpacked',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function shellEntrypointsUnder(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'target'].includes(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      shellEntrypointsUnder(absolute, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    if (entry.name.endsWith('.sh') || /^#![^\n]*(?:ba|z|k)?sh\b/.test(source)) {
      files.push({ label: path.relative(path.dirname(root), absolute), source });
    }
  }
  return files;
}

function logicalShellLines(source) {
  const logical = [];
  let text = '';
  let startLine = 1;
  source.split('\n').forEach((line, index) => {
    if (!text) startLine = index + 1;
    if (/\\\s*$/.test(line)) {
      text += `${line.replace(/\\\s*$/, '')} `;
      return;
    }
    logical.push({ line: startLine, text: text + line });
    text = '';
  });
  if (text) logical.push({ line: startLine, text });
  return logical;
}

const KNOWN_BUNDLES = new Set(['app', 'dmg', 'msi', 'nsis', 'deb', 'rpm', 'appimage', 'updater']);

function unquoteShellToken(token) {
  return token.replace(/^["']|["'\\),]+$/g, '');
}

function directTauriCommandCanEmitDeb(command, subcommand) {
  if (subcommand === 'build' && /(?:^|\s)--no-bundle(?:\s|$)/.test(command)) return false;

  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g)?.map(unquoteShellToken) ?? [];
  let sawBundleFilter = false;
  let sawBundleValue = false;
  let unknownBundleValue = false;
  let includesDeb = false;
  let target = '';

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    let inlineBundles;
    if (token === '-b' || token === '--bundles') {
      sawBundleFilter = true;
      let sawKnownValueForThisFilter = false;
      for (let j = i + 1; j < tokens.length && !tokens[j].startsWith('-'); j += 1) {
        const values = tokens[j].split(',');
        const allValuesKnown = values.every((value) => KNOWN_BUNDLES.has(value));
        // Once a literal list is complete, a later shell-array expansion is
        // the next option group (for example role/config args), not another
        // bundle value. A wholly variable list remains conservatively unknown.
        if (!allValuesKnown && sawKnownValueForThisFilter) break;
        sawBundleValue = true;
        for (const value of values) {
          if (value === 'deb') includesDeb = true;
          else if (!KNOWN_BUNDLES.has(value)) unknownBundleValue = true;
        }
        if (allValuesKnown) sawKnownValueForThisFilter = true;
      }
    } else if (token.startsWith('--bundles=')) {
      sawBundleFilter = true;
      inlineBundles = token.slice('--bundles='.length);
    } else if (/^-b=?[^-].*/.test(token)) {
      sawBundleFilter = true;
      inlineBundles = token.replace(/^-b=?/, '');
    }

    if (inlineBundles !== undefined) {
      if (inlineBundles) sawBundleValue = true;
      for (const value of inlineBundles.split(',').filter(Boolean)) {
        if (value === 'deb') includesDeb = true;
        else if (!KNOWN_BUNDLES.has(value)) unknownBundleValue = true;
      }
    }

    if (token === '-t' || token === '--target') target = tokens[i + 1] ?? '';
    else if (token.startsWith('--target=') || token.startsWith('-t=')) target = token.split('=').slice(1).join('=');
  }

  if (sawBundleFilter) {
    // Tauri treats a zero-value --bundles as an explicit empty package set.
    return includesDeb || (sawBundleValue && unknownBundleValue);
  }
  if (/(?:apple|darwin|windows|msvc)/i.test(target)) return false;
  return true;
}

function executableSegments(entry) {
  const segments = [];
  for (const logical of logicalShellLines(entry.source)) {
    if (/^\s*#/.test(logical.text)) continue;
    for (const raw of logical.text.split(/&&|\|\||;/)) {
      const text = raw.trim();
      if (!text || /^#|^["']/.test(text)) continue;
      segments.push({ ...logical, text });
    }
  }
  return segments;
}

function insideShellQuote(text, end) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let i = 0; i < end; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && !single) {
      escaped = true;
    } else if (char === "'" && !double) {
      single = !single;
    } else if (char === '"' && !single) {
      double = !double;
    }
  }
  return single || double;
}

function directTauriCommands(entry) {
  const commands = [];
  for (const segment of executableSegments(entry)) {
    const pattern = /\btauri\s+(build|bundle)\b/g;
    for (let match = pattern.exec(segment.text); match; match = pattern.exec(segment.text)) {
      const prefix = segment.text.slice(0, match.index);
      // Diagnostic/search prose names commands but cannot produce an artifact.
      if (/\b(?:echo|printf|pgrep|grep)\b/.test(prefix)) continue;
      if (
        insideShellQuote(segment.text, match.index) &&
        !/(?:\b(?:bash|sh)\s+-c\s+|(?:^|\s)[A-Za-z_][A-Za-z0-9_]*(?:CMD|COMMAND)=)["'][^"']*$/i.test(prefix)
      ) continue;
      const command = segment.text.slice(match.index);
      commands.push({
        ...segment,
        command,
        subcommand: match[1],
        canEmitDeb: directTauriCommandCanEmitDeb(command, match[1]),
      });
    }
  }
  return commands;
}

function repackLines(entry) {
  return executableSegments(entry)
    .filter(({ text }) => {
      const at = text.indexOf('repack-deb-xz.sh');
      return at !== -1 && !/\b(?:echo|printf|pgrep|grep)\b/.test(text.slice(0, at));
    })
    .map(({ line }) => line);
}

function unrepackedDirectDebianProducers(entries) {
  const offenders = [];
  for (const entry of entries) {
    const commands = directTauriCommands(entry);
    const repacks = repackLines(entry);
    commands.forEach((command, index) => {
      if (!command.canEmitDeb) return;
      const nextProducerLine = commands[index + 1]?.line ?? Number.POSITIVE_INFINITY;
      const repacksBeforeNextProducer = repacks.some(
        (line) => line >= command.line && line < nextProducerLine,
      );
      if (!repacksBeforeNextProducer) {
        offenders.push(`${entry.label}:${command.line}: ${command.command}`);
      }
    });
  }
  return offenders;
}

test('source-wide shell scan requires every direct Debian-producing Tauri path to repack', () => {
  const entries = [
    ...shellEntrypointsUnder(path.join(root, 'bin')),
    ...shellEntrypointsUnder(path.join(root, 'scripts')),
    ...shellEntrypointsUnder(path.join(path.dirname(root), 'scripts')),
  ];
  const offenders = unrepackedDirectDebianProducers(entries);
  assert.deepEqual(
    offenders,
    [],
    'direct Tauri build/bundle commands that can emit deb must invoke repack-deb-xz.sh before the next producer:\n' +
      offenders.join('\n'),
  );
});

test('the source-wide producer detector catches an unknown sixth path and ignores non-Debian output', () => {
  assert.deepEqual(
    unrepackedDirectDebianProducers([{
      label: 'bin/future-sixth-producer.sh',
      source: '#!/usr/bin/env bash\nnpx tauri build --bundles deb\n',
    }]),
    ['bin/future-sixth-producer.sh:2: tauri build --bundles deb'],
  );
  assert.deepEqual(
    unrepackedDirectDebianProducers([{
      label: 'bin/future-safe-producers.sh',
      source: [
        '#!/usr/bin/env bash',
        'npx tauri build -brpm',
        'npx tauri bundle --bundles deb,rpm',
        'bash "$ROOT/bin/repack-deb-xz.sh" "$deb"',
        '',
      ].join('\n'),
    }]),
    [],
    'an explicit rpm-only build is not a Debian producer, while a following deb bundle is guarded by its repack',
  );
});

test('every direct Debian-producing npm script is discovered and routes through a repacking chokepoint', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageEntries = Object.entries(pkg.scripts ?? {}).map(([name, source]) => ({
    label: `papercusp-desktop/package.json scripts.${name}`,
    source,
  }));
  const directOffenders = unrepackedDirectDebianProducers(packageEntries);
  assert.deepEqual(
    directOffenders,
    [],
    'a package script added later must not introduce a direct Debian-producing Tauri bypass:\n' +
      directOffenders.join('\n'),
  );

  assert.match(
    pkg.scripts?.tauri ?? '',
    /bin\/tauri-guarded/,
    'the generic `npm run tauri -- build|bundle` producer surface must remain wired to its routing chokepoint',
  );
  const tauriGuard = fs.readFileSync(path.join(root, tauriGuardRel), 'utf8');
  assert.match(
    tauriGuard,
    /build-deb-repacked\.sh/,
    `${tauriGuardRel} must route Debian-capable build and bundle invocations through ${buildWrapperRel}`,
  );

  const wrapper = fs.readFileSync(path.join(root, buildWrapperRel), 'utf8');
  assert.match(wrapper, /BUNDLE_ARGS=\(--bundles deb\)/, `${buildWrapperRel} must default to Debian-only bundles`);
  assert.match(wrapper, /repack-deb-xz\.sh/, `${buildWrapperRel} must invoke the canonical repacker`);
});

test('the npm build wrapper repacks fresh release, debug, and all-bundles Debian output', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-build-wrapper-test-'));
  try {
    const pkgDir = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkgDir, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, 'opt', 'papercusp'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'DEBIAN', 'control'), [
      'Package: papercusp-build-wrapper-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: build wrapper fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkgDir, 'opt', 'papercusp', 'payload'), 'wrapper payload\n');

    const sourceDeb = path.join(tmp, 'source.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkgDir, sourceDeb]);

    const fakeBin = path.join(tmp, 'bin');
    const targetDir = path.join(tmp, 'target');
    const argsLog = path.join(tmp, 'tauri-args.log');
    fs.mkdirSync(fakeBin, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, 'cargo'), [
      '#!/usr/bin/env bash',
      'printf \'{"target_directory":"%s"}\\n\' "$FAKE_TARGET_DIR"',
      '',
    ].join('\n'), { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, 'tauri'), [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'profile=release',
      'target=',
      'expect_target=0',
      'for arg in "$@"; do',
      '  [[ "$arg" == "--debug" || "$arg" == "-d" ]] && profile=debug',
      '  if [[ "$expect_target" == 1 ]]; then target="$arg"; expect_target=0; continue; fi',
      '  case "$arg" in',
      '    -t|--target) expect_target=1 ;;',
      '    -t=*|--target=*) target="${arg#*=}" ;;',
      '  esac',
      'done',
      'printf \'%s\\n\' "$*" > "$FAKE_ARGS_LOG"',
      'bundle_root="$FAKE_TARGET_DIR"',
      '[[ -n "$target" ]] && bundle_root="$bundle_root/$target"',
      'mkdir -p "$bundle_root/$profile/bundle/deb"',
      'cp "$FAKE_DEB_SOURCE" "$bundle_root/$profile/bundle/deb/Papercusp_1.0.0_all.deb"',
      '',
    ].join('\n'), { mode: 0o755 });

    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_ARGS_LOG: argsLog,
      FAKE_DEB_SOURCE: sourceDeb,
      FAKE_TARGET_DIR: targetDir,
      TAURI_SIGNING_PRIVATE_KEY: '',
    };
    for (const { args, profile, expectedArgs } of [
      { args: [], profile: 'release', expectedArgs: 'build --bundles deb' },
      { args: ['--debug'], profile: 'debug', expectedArgs: 'build --bundles deb --debug' },
      { args: ['--all-bundles'], profile: 'release', expectedArgs: 'build' },
      {
        args: ['--tauri-subcommand=bundle', '--all-bundles'],
        profile: 'release',
        expectedArgs: 'bundle',
      },
      {
        args: ['--tauri-subcommand=bundle', '--bundles', 'rpm,deb', '--debug'],
        profile: 'debug',
        expectedArgs: 'bundle --bundles rpm,deb --debug',
      },
      {
        args: ['--tauri-subcommand=bundle', '--bundles=deb', '--target=aarch64-unknown-linux-gnu'],
        profile: 'aarch64-unknown-linux-gnu/release',
        expectedArgs: 'bundle --bundles=deb --target=aarch64-unknown-linux-gnu',
      },
      {
        args: ['--tauri-subcommand=bundle', '-brpm,deb'],
        profile: 'release',
        expectedArgs: 'bundle -brpm,deb',
      },
    ]) {
      const result = spawnSync('bash', [path.join(root, buildWrapperRel), ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
      });
      assert.equal(result.status, 0, `wrapper failed (${result.status}): ${result.stderr}`);
      assert.equal(fs.readFileSync(argsLog, 'utf8'), `${expectedArgs}\n`);
      const builtDeb = path.join(targetDir, profile, 'bundle', 'deb', 'Papercusp_1.0.0_all.deb');
      assert.deepEqual(run('ar', ['t', builtDeb]).trim().split('\n'), [
        'debian-binary',
        'control.tar.gz',
        'data.tar.xz',
      ]);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('refuses to invalidate an existing updater signature without a signing key', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-sig-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-signature-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: signature guard fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'signed bytes\n');
    const deb = path.join(tmp, 'signed.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
    fs.writeFileSync(`${deb}.sig`, 'signature-for-original-bytes\n');
    const original = fs.readFileSync(deb);

    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' },
    });
    assert.equal(res.status, 5);
    assert.match(res.stderr, /refusing to create a stale signature/);
    assert.deepEqual(fs.readFileSync(deb), original, 'refusal must preserve the original package bytes');
    assert.equal(fs.readFileSync(`${deb}.sig`, 'utf8'), 'signature-for-original-bytes\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function signingFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-repack-signing-env-'));
  const pkg = path.join(tmp, 'pkg');
  fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
    'Package: papercusp-signing-env-test', 'Version: 1.0.0', 'Architecture: all',
    'Maintainer: Papercusp <test@example.invalid>', 'Description: signer environment fixture', '',
  ].join('\n'));
  fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'original signed payload\n');
  const deb = path.join(tmp, 'fixture.deb');
  run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
  fs.writeFileSync(`${deb}.sig`, 'original signature\n');
  const original = fs.readFileSync(deb);
  const key = path.join(tmp, 'key');
  fs.writeFileSync(key, 'fixture-key-content\n');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const record = path.join(tmp, 'signer.jsonl');
  const xzRan = path.join(tmp, 'xz-ran');
  const realXz = run('bash', ['-c', 'command -v xz']).trim();
  fs.writeFileSync(path.join(bin, 'xz'), `#!/usr/bin/env bash\nprintf xz > "$FIXTURE_XZ_RAN"\nexec "${realXz}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npx'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const env = process.env;
fs.appendFileSync(env.FIXTURE_SIGNER_RECORD, JSON.stringify({
  content: env.TAURI_SIGNING_PRIVATE_KEY === 'fixture-key-content',
  pathPresent: Object.hasOwn(env, 'TAURI_SIGNING_PRIVATE_KEY_PATH'),
  argvLeaksKey: args.some(x => x.includes('fixture-key-content')),
}) + '\\n');
if (env.TAURI_SIGNING_PRIVATE_KEY && env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
  console.error('private-key conflicts with private-key-path'); process.exit(2);
}
if (env.FIXTURE_SIGNER_FAIL === '1') process.exit(23);
fs.writeFileSync(args.at(-1) + '.sig', 'replacement signature\\n');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`,
    FIXTURE_SIGNER_RECORD: record, FIXTURE_XZ_RAN: xzRan,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '' };
  delete env.TAURI_SIGNING_PRIVATE_KEY;
  delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  return { tmp, deb, original, key, record, xzRan, env };
}

for (const channel of ['content', 'content-and-path', 'content-as-path', 'path-only']) {
  test(`signer child normalizes ${channel} without leaking or changing caller settings`, () => {
    const f = signingFixture();
    try {
      if (channel !== 'path-only') f.env.TAURI_SIGNING_PRIVATE_KEY = channel === 'content-as-path' ? f.key : 'fixture-key-content';
      if (channel === 'path-only' || channel === 'content-and-path') f.env.TAURI_SIGNING_PRIVATE_KEY_PATH = f.key;
      const result = spawnSync('bash', ['-c', 'bash "$1" "$2" || exit $?; test "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" = "$3"', '_', helper, f.deb, f.env.TAURI_SIGNING_PRIVATE_KEY_PATH || ''], {
        encoding: 'utf8', env: f.env,
      });
      assert.equal(result.status, 0, result.stderr);
      const rows = fs.readFileSync(f.record, 'utf8').trim().split('\n').map(JSON.parse);
      assert.ok(rows.length >= 2, 'the same signer contract must be exercised before compression and for final bytes');
      for (const row of rows) assert.deepEqual(row, { content: true, pathPresent: false, argvLeaksKey: false });
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-key-content/);
      assert.equal(fs.readFileSync(`${f.deb}.sig`, 'utf8'), 'replacement signature\n');
      assert.match(run('ar', ['t', f.deb]), /data\.tar\.xz/);
    } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
  });
}

test('signer failure is detected before compression and preserves original package and signature', () => {
  const f = signingFixture();
  try {
    const result = spawnSync('bash', [helper, f.deb], { encoding: 'utf8', env: {
      ...f.env, TAURI_SIGNING_PRIVATE_KEY: 'fixture-key-content', TAURI_SIGNING_PRIVATE_KEY_PATH: f.key, FIXTURE_SIGNER_FAIL: '1',
    } });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(f.xzRan), false, 'a broken signer must fail before expensive xz work');
    assert.deepEqual(fs.readFileSync(f.deb), f.original);
    assert.equal(fs.readFileSync(`${f.deb}.sig`, 'utf8'), 'original signature\n');
  } finally { fs.rmSync(f.tmp, { recursive: true, force: true }); }
});

test('announces an unsigned output when repacking without a signing key', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-xz-unsigned-'));
  try {
    const pkg = path.join(tmp, 'pkg');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
      'Package: papercusp-repack-unsigned-test',
      'Version: 1.0.0',
      'Architecture: all',
      'Maintainer: Papercusp <test@example.invalid>',
      'Description: unsigned status fixture',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'unsigned bytes\n');
    const deb = path.join(tmp, 'unsigned.deb');
    run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);

    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /repacked data member as xz -9: .* \(UNSIGNED\)/);
    assert.match(res.stderr, /UNSIGNED: no TAURI_SIGNING_PRIVATE_KEY supplied/);
    assert.equal(fs.existsSync(`${deb}.sig`), false, 'unsigned output must not claim a signature');
    assert.deepEqual(run('ar', ['t', deb]).trim().split('\n'), [
      'debian-binary',
      'control.tar.gz',
      'data.tar.xz',
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// WI-10006665: guard-only mode (test artifacts) keeps the checks but skips the xz -9 recompression.
function buildGuardFixture(tmp, extraRel) {
  const pkg = path.join(tmp, 'pkg');
  fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
  fs.mkdirSync(path.join(pkg, 'opt', 'fixture'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'DEBIAN', 'control'), [
    'Package: papercusp-repack-guard-only-test',
    'Version: 1.0.0',
    'Architecture: all',
    'Maintainer: Papercusp <test@example.invalid>',
    'Description: guard-only fixture',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(pkg, 'opt', 'fixture', 'payload'), 'guard-only bytes\n');
  if (extraRel) {
    fs.mkdirSync(path.dirname(path.join(pkg, extraRel)), { recursive: true });
    fs.writeFileSync(path.join(pkg, extraRel), 'stale scrub copy\n');
  }
  const deb = path.join(tmp, 'guard.deb');
  run('dpkg-deb', ['-Zgzip', '-b', pkg, deb]);
  fs.writeFileSync(`${deb}.sig`, 'signature-for-original-bytes\n');
  return deb;
}

test('guard-only mode leaves the package bytes and signature untouched and never runs xz', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-guard-only-'));
  try {
    const deb = buildGuardFixture(tmp);
    const original = fs.readFileSync(deb);
    const fakeBin = path.join(tmp, 'bin');
    fs.mkdirSync(fakeBin);
    // Any xz invocation fails loudly, so a recompression attempt cannot pass silently.
    fs.writeFileSync(path.join(fakeBin, 'xz'), '#!/usr/bin/env bash\necho XZ-CALLED >&2\nexit 42\n', { mode: 0o755 });
    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      // No signing key: the normal path would refuse (exit 5) to stale the .sig.
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TAURI_SIGNING_PRIVATE_KEY: '', PAPERCUSP_DEB_REPACK_GUARD_ONLY: '1' },
    });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /guard-only: checked .*; data member left as data\.tar\.gz \(no recompression\)/);
    assert.doesNotMatch(res.stderr, /XZ-CALLED/);
    assert.deepEqual(fs.readFileSync(deb), original, 'guard-only must not rewrite the package');
    assert.equal(fs.readFileSync(`${deb}.sig`, 'utf8'), 'signature-for-original-bytes\n');

    // Calibration: the same fixture without guard-only takes the recompression path.
    const normal = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TAURI_SIGNING_PRIVATE_KEY: '' },
    });
    assert.equal(normal.status, 5, 'without guard-only the signed fixture reaches the stale-signature refusal');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('guard-only mode still refuses a package carrying stale .stage-scrub members', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-guard-only-scrub-'));
  try {
    const deb = buildGuardFixture(tmp, 'usr/lib/Papercusp Server/sidecar/.stage-scrub-abc123/SCRUBBED/leak.txt');
    const original = fs.readFileSync(deb);
    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '', PAPERCUSP_DEB_REPACK_GUARD_ONLY: '1' },
    });
    assert.equal(res.status, 8, res.stderr);
    assert.match(res.stderr, /stale \.stage-scrub members/);
    assert.deepEqual(fs.readFileSync(deb), original);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('guard-only mode rejects a value other than 0 or 1', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-deb-guard-only-bad-'));
  try {
    const deb = buildGuardFixture(tmp);
    const res = spawnSync('bash', [helper, deb], {
      encoding: 'utf8',
      env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: '', PAPERCUSP_DEB_REPACK_GUARD_ONLY: 'yes' },
    });
    assert.equal(res.status, 7, res.stderr);
    assert.match(res.stderr, /PAPERCUSP_DEB_REPACK_GUARD_ONLY must be 0 or 1/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('build-and-archive-deb.sh selects guard-only for test artifacts only, and the opt-in restores xz', () => {
  // Evaluate the wrapper's REAL decision block (from its WI-10006665 marker through the export)
  // under each input, rather than matching its text.
  const src = fs.readFileSync(path.join(root, 'bin', 'build-and-archive-deb.sh'), 'utf8');
  const start = src.indexOf('# WI-10006665:');
  const end = src.indexOf('export PAPERCUSP_DEB_REPACK_GUARD_ONLY', start);
  assert.ok(start >= 0 && end > start, 'decision block not found in build-and-archive-deb.sh');
  const block = src.slice(start, end) + 'export PAPERCUSP_DEB_REPACK_GUARD_ONLY\nprintf %s "$PAPERCUSP_DEB_REPACK_GUARD_ONLY"\n';
  const decide = (testArtifact, optIn) => {
    const env = { ...process.env, TEST_ARTIFACT: testArtifact };
    delete env.PAPERCUSP_TEST_ARTIFACT_XZ;
    delete env.PAPERCUSP_DEB_REPACK_GUARD_ONLY;
    if (optIn !== undefined) env.PAPERCUSP_TEST_ARTIFACT_XZ = optIn;
    return run('bash', ['-c', `TEST_ARTIFACT="$TEST_ARTIFACT"\n${block}`], { env });
  };
  assert.equal(decide('1'), '1', 'a test artifact skips xz');
  assert.equal(decide('1', '1'), '0', 'PAPERCUSP_TEST_ARTIFACT_XZ=1 restores the release-shaped repack');
  assert.equal(decide('0'), '0', 'a release build always recompresses');
  assert.equal(decide('0', '0'), '0');
  // The decision must be exported BEFORE the repack phase is launched.
  assert.ok(end < src.indexOf('repack-deb-xz.sh" "$DEB_PATH" &'), 'the export must precede the repack launch');
});

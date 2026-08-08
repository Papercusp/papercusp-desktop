#!/usr/bin/env -S npx tsx
/**
 * Papercusp desktop release CLI — kit-driven (ADDITIVE; runs alongside
 * bin/release-local.sh until Linux parity is signed off).
 *
 *   npx tsx bin/release.ts <version> <channel> [flags]
 *   flags: --plan        print the resolved plan + exit (no build/git/publish)
 *          --with-arm64  also build linux-aarch64 (needs `cross`)
 *          --with-windows  also build windows-x86_64 (VM :2223, owner-gated)
 *          --with-mac    also build macos-universal (VM :2222, owner-gated)
 *          --skip-git    do not commit/tag/push
 *          --skip-publish  do not create the GitHub release
 *
 *   npx tsx bin/release.ts publish --platform <linux|darwin|windows> --incremental <version> <channel>
 *     ADD one already-built platform's artifacts onto the LIVE latest.json
 *     without touching any other platform's entry (EI-18683062996592825 —
 *     the durable, kit-shared fix for what used to be hand-work; mirrors
 *     bin/publish-platform-incremental.sh but through the shared TS core, so
 *     oddsmith's `gh release upload --clobber` path can reuse the identical
 *     merge semantics). Requires the release host env
 *     (~/.papercusp/release-host.env, PAPERCUSP_UPDATE_BASE_URL) sourced
 *     first, and the platform already built (bin/build-linux-local.sh /
 *     bin/build-mac-cross.sh / bin/build-windows-cross.sh). Does NOT upload —
 *     run bin/upload-release.sh <version> <channel> afterwards, same as
 *     always.
 */
import {
  CHANNELS,
  assertValidVersion,
  defaultTagFor,
  fetchHttpGetPort,
  isValidChannel,
  nodePorts,
  parsePublishArgs,
  runIncrementalPublish,
  runRelease,
  type Channel,
} from '../../libs/generic/tauri-release-kit/src/index.js';
import { makePapercuspConfig, registerPapercuspDrivers } from './release.config.js';

async function runPublishSubcommand(argv: string[]): Promise<void> {
  const args = parsePublishArgs(argv);
  const base = (process.env.PAPERCUSP_UPDATE_BASE_URL ?? '').replace(/\/+$/, '');
  if (!base) {
    console.error(
      'ERROR: PAPERCUSP_UPDATE_BASE_URL is not set — source ~/.papercusp/release-host.env first' +
        ' (see bin/lib/release-host.sh); an incremental publish must merge onto the genuinely' +
        ' LIVE manifest, so it cannot guess where that is.',
    );
    process.exit(1);
  }

  registerPapercuspDrivers();
  const cfg = makePapercuspConfig({ version: args.version, channel: args.channel, targets: [args.targetKey] });

  const ports = nodePorts();
  const res = await runIncrementalPublish(cfg, args.targetKey, ports, {
    liveManifestUrl: `${base}/latest.json`,
    http: fetchHttpGetPort,
  });
  console.log(
    `\n✓ incremental publish ${res.tag} platform=${args.platform} (merged from: ${res.mergedFrom}) — ` +
      `${res.artifacts.length} artifact(s)`,
  );
  console.log(`  manifest: ${res.latestJsonPath}`);
  console.log(`  next:     bin/upload-release.sh ${args.version} ${args.channel}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'publish') {
    await runPublishSubcommand(argv);
    return;
  }
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [version, channel = 'stable'] = argv.filter((a) => !a.startsWith('--'));

  if (!version) {
    console.error(`usage: release.ts <version> <channel: ${CHANNELS.join('|')}> [--plan] [--with-arm64] [--with-windows] [--with-mac]`);
    console.error('   or: release.ts publish --platform <linux|darwin|windows> --incremental <version> <channel>');
    process.exit(1);
  }
  assertValidVersion(version);
  if (!isValidChannel(channel)) {
    console.error(`ERROR: channel must be ${CHANNELS.join('|')} (got "${channel}")`);
    process.exit(1);
  }

  const targets = ['linux-x86_64'];
  if (flags.has('--with-arm64') || process.env.WITH_ARM64 === '1') targets.push('linux-aarch64');
  if (flags.has('--with-windows') || process.env.WITH_WINDOWS === '1') targets.push('windows-x86_64');
  if (flags.has('--with-mac') || process.env.WITH_MAC === '1') targets.push('macos-universal');

  registerPapercuspDrivers();
  const cfg = makePapercuspConfig({ version, channel: channel as Channel, targets });

  if (flags.has('--plan')) {
    const tag = defaultTagFor(version, channel);
    console.log(
      JSON.stringify(
        {
          mode: 'plan',
          appName: cfg.appName,
          appId: cfg.appId,
          version,
          channel,
          tag,
          targets,
          versionFiles: cfg.versionFiles.map((v) => `${v.path} (${v.kind})`),
          signingKey: cfg.signing.keyPath,
          repo: `${cfg.repo.owner}/${cfg.repo.name}`,
          latestJsonUrlSample: cfg.latestJsonUrl({ tag, name: `Papercusp_${version}_amd64.AppImage` }),
        },
        null,
        2,
      ),
    );
    return;
  }

  const ports = nodePorts();
  const res = await runRelease(cfg, ports, {
    skipGit: flags.has('--skip-git'),
    skipPublish: flags.has('--skip-publish'),
  });
  console.log(
    `\n✓ released ${res.tag} — ${res.artifacts.length} artifact(s), ${res.published?.action ?? 'not published'}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

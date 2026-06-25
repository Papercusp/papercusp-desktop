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
 */
import {
  assertValidVersion,
  defaultTagFor,
  isValidChannel,
  nodePorts,
  runRelease,
  type Channel,
} from '../../libs/generic/tauri-release-kit/src/index.js';
import { makePapercuspConfig, registerPapercuspDrivers } from './release.config.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [version, channel = 'stable'] = argv.filter((a) => !a.startsWith('--'));

  if (!version) {
    console.error('usage: release.ts <version> <channel: alpha|beta|stable> [--plan] [--with-arm64] [--with-windows] [--with-mac]');
    process.exit(1);
  }
  assertValidVersion(version);
  if (!isValidChannel(channel)) {
    console.error(`ERROR: channel must be alpha|beta|stable (got "${channel}")`);
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

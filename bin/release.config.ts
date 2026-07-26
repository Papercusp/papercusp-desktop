/**
 * Papercusp desktop release config for @papercusp/tauri-release-kit.
 *
 * ADDITIVE: this does NOT replace bin/release-local.sh. It is a parallel,
 * kit-driven path proven for Linux; Windows/Mac DELEGATE to the native
 * cross-build scripts (build-windows-cross.sh / build-mac-cross.sh) so the kit
 * adopts them rather than reimplementing them. Both QEMU build VMs were retired
 * as build legs (WI-5651) — the cross scripts build on this Linux box. Once
 * Linux parity is signed off (and the in-flight public release lands),
 * release-local.sh can become a thin wrapper over `bin/release.ts`.
 *
 * Run via:  npx tsx bin/release.ts <version> <channel> [--plan]
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  type Channel,
  type TargetDriver,
  type TauriReleaseConfig,
  collectArtifacts,
  defaultClassifyArtifact,
  linuxArm64Driver,
  linuxX86Driver,
  registerTargetDriver,
} from '../../libs/generic/tauri-release-kit/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** papercusp-desktop/ (this file lives in bin/). */
export const DESKTOP_ROOT = resolve(HERE, '..');

const home = process.env.HOME ?? '';

/**
 * A target driver that DELEGATES to an existing host-side script, then collects
 * the artifacts it produced. Used for Windows (build-windows-cross.sh) and Mac
 * (build-mac-cross.sh) — each is itself the host-side build→package orchestrator
 * (cross-compiled natively on this Linux box, no QEMU build VM) — so we keep
 * those proven paths and just fold their output into the kit's release flow.
 */
function scriptDelegatingDriver(
  key: string,
  scriptRelPath: string,
  bundleRelDir: string,
  subdirs: string[],
): TargetDriver {
  return {
    key,
    async build(cfg, ports) {
      ports.log.info(`delegating ${key} to ${scriptRelPath}`);
      const res = await ports.exec.run('bash', [resolve(cfg.root, scriptRelPath)], {
        cwd: cfg.root,
        // process.env (incl. TAURI_SIGNING_* + WINDOWS_CERT_*) is inherited by nodeExec.
      });
      if (res.code !== 0) throw new Error(`${scriptRelPath} failed (exit ${res.code})`);
      return collectArtifacts(
        ports,
        resolve(cfg.root, bundleRelDir),
        subdirs,
        cfg.classifyArtifact ?? defaultClassifyArtifact,
      );
    },
  };
}

/**
 * Register every driver papercusp can use. Linux is the kit's own driver
 * (the parity target). Windows + Mac are owner-gated (need signing certs; both
 * are cross-compiled natively on this Linux box since WI-5651 retired their
 * QEMU build VMs — no VM is needed for the build itself anymore, see below);
 * they're registered but only run when the corresponding target is requested.
 */
export function registerPapercuspDrivers(): void {
  registerTargetDriver(linuxX86Driver);
  registerTargetDriver(linuxArm64Driver);

  // Windows: cross-compiled natively on this Linux box (cargo-xwin + Inno under
  // wine) — the QEMU Windows VM was retired (WI-5651). The host-side script still
  // does pack→ship→build→collect, just without a VM. Output dir is unchanged
  // (build-windows-cross.sh writes byte-shape-identical artifacts there).
  registerTargetDriver(
    scriptDelegatingDriver(
      'windows-x86_64',
      'bin/build-windows-cross.sh',
      'src-tauri/target/windows-vm/bundle',
      ['inno'],
    ),
  );

  // Mac: cross-compiled natively on this Linux box (cargo-zigbuild per arch →
  // llvm-lipo universal → hand-assembled .app → rcodesign → libdmg-hfsplus dmg)
  // by bin/build-mac-cross.sh — the QEMU mac VM was retired as a BUILD leg
  // (WI-5651). Mirrors the Windows cross path: the script does the whole build,
  // the kit just collects its output (dmg/ + macos/). (The mac VM is left
  // startable for on-device TESTING; it is no longer a release producer.)
  registerTargetDriver(
    scriptDelegatingDriver(
      'macos-universal',
      'bin/build-mac-cross.sh',
      'src-tauri/target/universal-apple-darwin/release/bundle',
      ['dmg', 'macos'],
    ),
  );
}

export function makePapercuspConfig(opts: {
  version: string;
  channel: Channel;
  targets?: string[];
}): TauriReleaseConfig {
  return {
    appName: 'Papercusp',
    appId: 'com.papercusp.desktop',
    root: DESKTOP_ROOT,
    repo: { owner: 'Papercusp', name: 'papercusp-desktop' },
    version: opts.version,
    channel: opts.channel,
    versionFiles: [
      { path: 'package.json', kind: 'json' },
      { path: 'src-tauri/tauri.conf.json', kind: 'json' },
      { path: 'src-tauri/Cargo.toml', kind: 'cargo-toml' },
    ],
    targets: opts.targets ?? ['linux-x86_64'],
    signing: {
      keyPath: resolve(home, '.papercusp/signing/papercusp.key'),
      passwordEnv: 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    },
    buildSidecar: async ({ root, ports }) => {
      const r = await ports.exec.run('bash', [resolve(root, 'bin/build-desktop-sidecar.sh')], {
        cwd: root,
      });
      if (r.code !== 0) throw new Error(`build-desktop-sidecar.sh failed (exit ${r.code})`);
    },
    latestJsonUrl: ({ tag, name }) =>
      `https://github.com/Papercusp/papercusp-desktop/releases/download/${tag}/${name}`,
  };
}

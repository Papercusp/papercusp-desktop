/**
 * Papercusp desktop release config for @papercusp/tauri-release-kit.
 *
 * ADDITIVE: this does NOT replace bin/release-local.sh. It is a parallel,
 * kit-driven path proven for Linux; Windows/Mac DELEGATE to the existing
 * battle-tested scripts (build-windows-on-vm.sh / mac-vm-build.sh) so the kit
 * adopts them rather than reimplementing them. Once Linux parity is signed off
 * (and the in-flight public release lands), release-local.sh can become a thin
 * wrapper over `bin/release.ts`.
 *
 * Run via:  npx tsx bin/release.ts <version> <channel> [--plan]
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  type Channel,
  type TargetDriver,
  type TauriReleaseConfig,
  type VmConfig,
  collectArtifacts,
  defaultClassifyArtifact,
  linuxArm64Driver,
  linuxX86Driver,
  makeVmBuildDriver,
  registerTargetDriver,
} from '../../libs/generic/tauri-release-kit/src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** papercusp-desktop/ (this file lives in bin/). */
export const DESKTOP_ROOT = resolve(HERE, '..');

const home = process.env.HOME ?? '';

/**
 * A target driver that DELEGATES to an existing host-side script, then collects
 * the artifacts it produced. Used for Windows (build-windows-on-vm.sh is itself
 * the host-side pack→ship→build→collect orchestrator), so we keep that proven
 * path and just fold its output into the kit's release flow.
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

/** Mac VM frame from env (defaults match mac-vm-build.sh's header). */
function macVm(): VmConfig {
  return {
    host: process.env.MAC_VM_HOST ?? '127.0.0.1',
    port: Number(process.env.MAC_VM_PORT ?? '2222'),
    user: process.env.MAC_VM_USER ?? 'aviweiss',
    identityFile: process.env.MAC_VM_KEY ?? resolve(home, '.ssh/papercup-vm-mac'),
    buildDir: process.env.MAC_VM_BUILD_DIR ?? 'papercup-build-mac/papercup/papercusp-desktop',
  };
}

/**
 * Register every driver papercusp can use. Linux is the kit's own driver
 * (the parity target). Windows + Mac are owner-gated (need the VMs + certs);
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

  // Mac: SSH into the darwin VM (build-in-place) and run mac-vm-build.sh there,
  // then download the universal .dmg. Uses the kit's generic VM driver.
  registerTargetDriver(
    makeVmBuildDriver('macos-universal', (cfg) => {
      const vm = cfg.vm?.['macos-universal'] ?? macVm();
      const keyPrefix = `TAURI_SIGNING_PRIVATE_KEY=${cfg.signing.keyPath}`;
      const remoteDmgDir = `${vm.buildDir}/src-tauri/target/universal-apple-darwin/release/bundle/dmg`;
      return {
        remoteBuildCommand: `${keyPrefix} bash ${vm.buildDir}/bin/mac-vm-build.sh`,
        assertSuccess: (log) => /mac build done/.test(log),
        listCommand: `ls -1 ${remoteDmgDir}`,
        remoteBundlePath: (name) => `${remoteDmgDir}/${name}`,
        collectDir: resolve(
          cfg.root,
          'src-tauri/target/universal-apple-darwin/release/bundle/dmg',
        ),
      };
    }),
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
    vm: { 'macos-universal': macVm() },
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

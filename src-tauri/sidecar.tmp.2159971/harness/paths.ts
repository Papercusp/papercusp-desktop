/**
 * @papercusp/harness/paths — runtime resolver for the harness install root.
 *
 * Replaces the old `~/autonomous-harness` symlink convention with proper
 * package resolution. Consumers do:
 *
 *   import { harnessPath } from '@papercusp/harness/paths';
 *   const promptsDir = harnessPath('prompts');
 *   const runSh = harnessPath('run.sh');
 *
 * Works in Next.js (transpilePackages), Node ESM, and tsx without any
 * configuration beyond adding `@papercusp/harness` to the workspace.
 *
 * The `PAPERCUSP_HARNESS_DIR` env var still overrides this for cases where
 * a different install root is wanted (Tauri sidecar runtime, container
 * mounts, fixture-controlled tests).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function packageRoot(): string {
  // ESM path: paths.ts → import.meta.url → .../libs/papercusp/packages/harness/
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return dirname(fileURLToPath(import.meta.url));
  }
  // CJS fallback (Next.js sometimes emits CommonJS for server bundles):
  // __dirname will already point at the transpiled location of this file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cjsDirname = (globalThis as any).__dirname;
  if (typeof cjsDirname === 'string') return cjsDirname;
  // Last-ditch fallback: use process.cwd() relative search
  return resolve(process.cwd(), 'libs/papercusp/packages/harness');
}

export function harnessRoot(): string {
  return process.env.PAPERCUSP_HARNESS_DIR ?? packageRoot();
}

export function harnessPath(...parts: string[]): string {
  return join(harnessRoot(), ...parts);
}

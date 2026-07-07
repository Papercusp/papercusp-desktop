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
import { existsSync } from 'node:fs';
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

/**
 * The harness install root used SPECIFICALLY for AGENT PROMPT resolution.
 *
 * decouple-agent-prompts-from-release-gate-2026-06-20 (D-001 — prompts-only):
 * agent PROMPT files (`blueprints/<id>/prompts/<role>.md`, `agent-base-*.md`,
 * `<role>.base.md`) are resolved from the integration/staging tree so a prompt
 * edit goes live WITHOUT a code-release (green-gate) promotion — while CODE +
 * TEMPLATE resolution stays on the running (deployed) checkout via
 * `harnessRoot()`/`harnessPath()`. This is the ONLY place the two roots diverge.
 *
 * Precedence (first existing wins; a misconfigured override never strands
 * resolution — it degrades to the running tree):
 *   1. `PAPERCUSP_PROMPT_ROOT`      — explicit harness-prompt-root override.
 *   2. `PAPERCUSP_INTEGRATION_ROOT` — repo root; derive `<root>/libs/papercusp/packages/harness`.
 *   3. `fallback` (default `harnessRoot()`) — byte-identical to pre-decouple behavior.
 *
 * Zero filesystem cost when neither env var is set (the common case): both
 * lookups short-circuit on the absent env before any `existsSync`.
 */
export function promptHarnessRoot(fallback?: string): string {
  const direct = process.env.PAPERCUSP_PROMPT_ROOT?.trim();
  if (direct && existsSync(direct)) return direct;
  const integ = process.env.PAPERCUSP_INTEGRATION_ROOT?.trim();
  if (integ) {
    const derived = join(integ, 'libs', 'papercusp', 'packages', 'harness');
    if (existsSync(derived)) return derived;
  }
  return fallback ?? harnessRoot();
}

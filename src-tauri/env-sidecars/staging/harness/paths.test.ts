/**
 * paths.ts unit tests — focused on promptHarnessRoot, the prompt-resolution
 * root override that decouples agent PROMPT edits from the code-release gate
 * (decouple-agent-prompts-from-release-gate-2026-06-20 P-002 / D-001).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { harnessRoot, promptHarnessRoot, resolveHarnessPackageRoot } from './paths.js';

describe('promptHarnessRoot — prompt-root override', () => {
  const saved: Record<string, string | undefined> = {};
  const tmps: string[] = [];

  beforeEach(() => {
    saved.PAPERCUSP_PROMPT_ROOT = process.env.PAPERCUSP_PROMPT_ROOT;
    saved.PAPERCUSP_INTEGRATION_ROOT = process.env.PAPERCUSP_INTEGRATION_ROOT;
    delete process.env.PAPERCUSP_PROMPT_ROOT;
    delete process.env.PAPERCUSP_INTEGRATION_ROOT;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'papercusp-promptroot-'));
    tmps.push(d);
    return d;
  };

  it('resolveHarnessPackageRoot recovers the source harness package from a bundled dist-host start dir', () => {
    const root = mk();
    const harness = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkdirSync(join(harness, 'blueprints', 'base'), { recursive: true });
    writeFileSync(join(harness, 'blueprints', 'base', 'blueprint.yaml'), 'id: base\nkind: harness\n');
    mkdirSync(join(root, 'apps', 'operator', 'dist-host'), { recursive: true });
    const start = join(root, 'apps', 'operator', 'dist-host');
    expect(resolveHarnessPackageRoot([start])).toBe(harness);
  });

  it('resolveHarnessPackageRoot prefers PAPERCUSP_INTEGRATION_ROOT when it has harness assets', () => {
    const root = mk();
    const harness = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkdirSync(join(harness, 'blueprints', 'base'), { recursive: true });
    writeFileSync(join(harness, 'blueprints', 'base', 'blueprint.yaml'), 'id: base\nkind: harness\n');
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(resolveHarnessPackageRoot(['/missing/start'])).toBe(harness);
  });

  it('resolveHarnessPackageRoot returns null when no candidate has harness assets', () => {
    const root = mk();
    expect(resolveHarnessPackageRoot([root])).toBeNull();
  });

  it('UNSET ⇒ returns the explicit fallback (byte-identical to pre-decouple)', () => {
    expect(promptHarnessRoot('/some/fallback')).toBe('/some/fallback');
  });

  it('UNSET + no fallback ⇒ defaults to harnessRoot()', () => {
    expect(promptHarnessRoot()).toBe(harnessRoot());
  });

  it('PAPERCUSP_PROMPT_ROOT (an existing dir) wins over the fallback', () => {
    const d = mk();
    process.env.PAPERCUSP_PROMPT_ROOT = d;
    expect(promptHarnessRoot('/fallback')).toBe(d);
  });

  it('PAPERCUSP_PROMPT_ROOT pointing at a non-existent dir falls through to the fallback', () => {
    process.env.PAPERCUSP_PROMPT_ROOT = join(tmpdir(), 'papercusp-prompt-root-does-not-exist-xyz');
    expect(promptHarnessRoot('/fallback')).toBe('/fallback');
  });

  it('PAPERCUSP_INTEGRATION_ROOT derives <root>/libs/papercusp/packages/harness', () => {
    const root = mk();
    const derived = join(root, 'libs', 'papercusp', 'packages', 'harness');
    mkdirSync(derived, { recursive: true });
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe(derived);
  });

  it('PAPERCUSP_INTEGRATION_ROOT without the harness subtree falls through to the fallback', () => {
    const root = mk(); // no libs/papercusp/packages/harness created
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe('/fallback');
  });

  it('PAPERCUSP_PROMPT_ROOT takes precedence over PAPERCUSP_INTEGRATION_ROOT', () => {
    const direct = mk();
    const root = mk();
    mkdirSync(join(root, 'libs', 'papercusp', 'packages', 'harness'), { recursive: true });
    process.env.PAPERCUSP_PROMPT_ROOT = direct;
    process.env.PAPERCUSP_INTEGRATION_ROOT = root;
    expect(promptHarnessRoot('/fallback')).toBe(direct);
  });
});

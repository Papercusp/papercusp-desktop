#!/usr/bin/env node
// WI-6554700010012487 — post-bundle self-check for the shipped ptool CLI.
//
// build-desktop-sidecar.sh esbuild-bundles apps/operator/scripts/ptool.mjs into
// sidecar/scripts/ptool.mjs and ships NO @modelcontextprotocol tree, so the SDK
// must be inlined. esbuild inlines an import() only when its specifier is a
// string literal; a computed `import(specifier)` survives the bundle as a
// runtime package lookup. On the build host that lookup silently succeeds
// (the repo's node_modules is an ancestor of the sidecar dir) and on every
// packaged install it fails with "Cannot find package
// '@modelcontextprotocol/sdk'" (Papercusp Server 0.0.26, P-010a).
//
// This check copies the bundle into a fresh directory that has NO node_modules
// ancestor, imports it there, and awaits every loader in its exported
// PTOOL_SDK_MODULE_LOADERS table. Any loader that still needs a runtime package
// lookup fails here, at build time, instead of on a customer's machine.
//
// Usage: node check-ptool-sdk-bundle.mjs <path/to/bundled/ptool.mjs> [--tmp-root <dir>]
// Exit 0 = every loader resolved from the isolated copy; 1 = a loader failed or
// the bundle exports no loader table; 2 = usage or isolation error.

import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PTOOL_SDK_LOADER_EXPORT = 'PTOOL_SDK_MODULE_LOADERS';

export class PtoolSdkBundleIsolationError extends Error {}

/** First ancestor of `dir` (inclusive) that contains a node_modules directory, else null. */
export function findNodeModulesAncestor(dir) {
  let current = resolve(dir);
  for (;;) {
    if (existsSync(join(current, 'node_modules'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Import `bundlePath` from an isolated copy and await every SDK loader.
 * Resolves `{ loaded: string[] }`; rejects when a loader fails, when the bundle
 * exports no loader table, or when the isolation directory could still reach a
 * node_modules tree (which would mask exactly the failure this check exists for).
 */
export async function checkPtoolSdkBundle(bundlePath, { tmpRoot = tmpdir() } = {}) {
  if (!existsSync(bundlePath)) {
    throw new PtoolSdkBundleIsolationError(`bundle not found: ${bundlePath}`);
  }
  const isolated = mkdtempSync(join(tmpRoot, 'ptool-sdk-check-'));
  try {
    const ancestor = findNodeModulesAncestor(isolated);
    if (ancestor) {
      throw new PtoolSdkBundleIsolationError(
        `isolation dir ${isolated} can reach ${join(ancestor, 'node_modules')}, which would mask ` +
          'an unbundled SDK import; pass --tmp-root <dir> with no node_modules ancestor',
      );
    }
    const copy = join(isolated, 'ptool.mjs');
    copyFileSync(bundlePath, copy);
    const mod = await import(pathToFileURL(copy).href);
    const loaders = mod[PTOOL_SDK_LOADER_EXPORT];
    if (!loaders || typeof loaders !== 'object' || Object.keys(loaders).length === 0) {
      throw new Error(`bundle exports no ${PTOOL_SDK_LOADER_EXPORT} table: ${bundlePath}`);
    }
    const loaded = [];
    for (const [specifier, load] of Object.entries(loaders)) {
      try {
        await load();
      } catch (err) {
        const code = err && typeof err === 'object' && 'code' in err ? ` [${err.code}]` : '';
        throw new Error(
          `bundled ptool cannot load ${specifier} without a node_modules tree${code}: ` +
            `${err instanceof Error ? err.message : String(err)}. Its import() is not ` +
            'bundle-traceable; give it a string-literal specifier in PTOOL_SDK_MODULE_LOADERS',
        );
      }
      loaded.push(specifier);
    }
    return { loaded };
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { bundlePath: null, tmpRoot: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--tmp-root') {
      args.tmpRoot = argv[i + 1];
      i += 1;
    } else if (!args.bundlePath) {
      args.bundlePath = argv[i];
    } else {
      return null;
    }
  }
  return args.bundlePath ? args : null;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error('usage: check-ptool-sdk-bundle.mjs <bundled ptool.mjs> [--tmp-root <dir>]');
    process.exit(2);
  }
  try {
    const { loaded } = await checkPtoolSdkBundle(args.bundlePath, { tmpRoot: args.tmpRoot });
    console.log(`  ptool SDK self-check: ${loaded.length} loader(s) resolve from an isolated copy`);
  } catch (err) {
    console.error(`ERROR: ptool SDK self-check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(err instanceof PtoolSdkBundleIsolationError ? 2 : 1);
  }
}

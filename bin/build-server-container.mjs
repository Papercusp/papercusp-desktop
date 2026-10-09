#!/usr/bin/env node
import { buildServerContainer, preflightServerContainer } from './lib/server-container.mjs';

const args = process.argv.slice(2);
const options = {};
let preflightOnly = false;
const keys = new Map([['--platform', 'platform'], ['--tag', 'tag'], ['--rootfs', 'rootfs'],
  ['--sidecar', 'sidecar'], ['--out', 'out'], ['--engine', 'engine'], ['--syft', 'syft'],
  ['--source-commit', 'sourceCommit']]);
try {
  if (args.includes('--help')) {
    console.log('Usage: node bin/build-server-container.mjs --platform linux/amd64|linux/arm64 --tag REF --rootfs FILE --sidecar DIR [--preflight-only | --out DIR] [--engine docker|podman] [--syft PATH] [--source-commit FULL_SHA]');
    process.exit(0);
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === '--preflight-only') { preflightOnly = true; continue; }
    const key = keys.get(arg);
    if (!key || !args.length || args[0].startsWith('--')) throw new Error('Unknown or incomplete option: ' + arg);
    if (options[key]) throw new Error('Repeated option: ' + arg);
    options[key] = args.shift();
  }
  for (const key of ['platform', 'tag', 'rootfs', 'sidecar', ...(preflightOnly ? [] : ['out'])]) {
    if (!options[key]) throw new Error('Missing --' + key);
  }
  const result = await (preflightOnly ? preflightServerContainer(options) : buildServerContainer(options));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Server container build refused: ' + error.message);
  process.exitCode = 1;
}

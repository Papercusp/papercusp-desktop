#!/usr/bin/env node
import { buildServerContainer, preflightServerContainer, publishServerContainers } from './lib/server-container.mjs';

const args = process.argv.slice(2);
const publish = args[0] === 'publish';
if (publish) args.shift();
const options = {};
let preflightOnly = false;
const keys = new Map([['--platform', 'platform'], ['--tag', 'tag'], ['--rootfs', 'rootfs'],
  ['--sidecar', 'sidecar'], ['--out', 'out'], ['--engine', 'engine'], ['--syft', 'syft'],
  ['--source-commit', 'sourceCommit'], ['--amd64-receipt', 'amd64Receipt'], ['--arm64-receipt', 'arm64Receipt'],
  ['--key', 'key'], ['--pubkey', 'pubkey']]);
try {
  if (args.includes('--help')) {
    console.log('Usage: node bin/build-server-container.mjs --platform linux/amd64|linux/arm64 --tag REF --rootfs FILE --sidecar DIR [--preflight-only | --out DIR] [--engine docker|podman] [--syft PATH] [--source-commit FULL_SHA]');
    console.log('Publish: node bin/build-server-container.mjs publish --amd64-receipt FILE --arm64-receipt FILE --tag REGISTRY/REPO:VERSION --key FILE --out DIR [--pubkey FILE] [--engine docker|podman] [--insecure-registry]');
    process.exit(0);
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === '--preflight-only') { preflightOnly = true; continue; }
    if (arg === '--insecure-registry' && publish) { options.insecureRegistry = true; continue; }
    const key = keys.get(arg);
    if (!key || !args.length || args[0].startsWith('--')) throw new Error('Unknown or incomplete option: ' + arg);
    if (options[key]) throw new Error('Repeated option: ' + arg);
    options[key] = args.shift();
  }
  if (publish && preflightOnly) throw new Error('Publication cannot be combined with --preflight-only');
  for (const key of (publish ? ['amd64Receipt', 'arm64Receipt', 'tag', 'key', 'out'] :
    ['platform', 'tag', 'rootfs', 'sidecar', ...(preflightOnly ? [] : ['out'])])) {
    if (!options[key]) throw new Error('Missing --' + key);
  }
  const result = await (publish ? publishServerContainers(options) :
    preflightOnly ? preflightServerContainer(options) : buildServerContainer(options));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Server container build refused: ' + error.message);
  process.exitCode = 1;
}

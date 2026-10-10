#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildServerContainer, preflightServerContainer, publishServerContainers, runOwnedContainer } from './lib/server-container.mjs';

const args = process.argv.slice(2);
if (args[0] === 'native') {
  if (args.length !== 3 || args[1] !== '--config') throw new Error('Native producer: native --config FILE');
  try {
    const result = await runOwnedContainer(JSON.parse(await readFile(args[2], 'utf8')));
    process.stdout.write(result.output);
    console.log(JSON.stringify({ ...result, output: undefined }));
  } catch (error) {
    console.error('Native producer refused: ' + error.message); process.exitCode = 1;
  }
} else {
const publish = args[0] === 'publish';
if (publish) args.shift();
const options = { onProgress: phase => console.error('[server-container] ' + phase) };
let preflightOnly = false;
const keys = new Map([['--platform', 'platform'], ['--tag', 'tag'], ['--rootfs', 'rootfs'],
  ['--sidecar', 'sidecar'], ['--out', 'out'], ['--engine', 'engine'], ['--syft', 'syft'],
  ['--source-commit', 'sourceCommit'], ['--image-id', 'imageId'], ['--amd64-receipt', 'amd64Receipt'], ['--arm64-receipt', 'arm64Receipt'],
  ['--key', 'key'], ['--pubkey', 'pubkey'],
  ['--amd64-archive', 'amd64Archive'], ['--arm64-archive', 'arm64Archive']]);
try {
  if (args.includes('--help')) {
    console.log('Usage: node bin/build-server-container.mjs --platform linux/amd64|linux/arm64 --tag REF --rootfs FILE --sidecar DIR [--preflight-only | --out DIR] [--engine docker|podman] [--syft PATH] [--source-commit FULL_SHA] [--image-id sha256:FULL_HASH (qualify without rebuilding)]');
    console.log('Publish: node bin/build-server-container.mjs publish --amd64-receipt FILE --arm64-receipt FILE --tag REGISTRY/REPO:VERSION --key FILE --out DIR [--pubkey FILE] [--engine docker|podman] [--amd64-archive FILE] [--arm64-archive FILE] [--insecure-registry]');
    console.log('Archives bind imported engine config IDs to the original immutable native receipts; required when importing from another engine.');
    console.log('publish --preflight-only verifies imports, native payload parity and full boot of both members without a registry, signing key or publication.');
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
  if (options.imageId && (publish || preflightOnly)) throw new Error('--image-id requires local image qualification');
  if (!publish && (options.amd64Archive || options.arm64Archive)) throw new Error('Archive imports require publication mode');
  for (const key of (publish ? ['amd64Receipt', 'arm64Receipt', ...(preflightOnly ? [] : ['tag', 'key', 'out'])] :
    ['platform', 'tag', 'rootfs', 'sidecar', ...(preflightOnly ? [] : ['out'])])) {
    if (!options[key]) throw new Error('Missing --' + key);
  }
  const result = await (publish ? publishServerContainers({ ...options, preflightOnly }) :
    preflightOnly ? preflightServerContainer(options) : buildServerContainer(options));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error('Server container build refused: ' + error.message);
  process.exitCode = 1;
}
}

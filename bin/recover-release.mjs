#!/usr/bin/env node
// Explicit recovery for installed clients whose immutable baked R2 address
// cannot be redirected. Stage a replacement verified by the existing updater
// key; the normal installer performs the upgrade without deleting user data.
import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile, link, unlink, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);

function releaseBase(value) {
  const base = new URL(value);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
    /(?:^|\.)r2\.(?:dev|cloudflarestorage\.com)$/.test(base.hostname) ||
    !/^\/releases\/[A-Za-z0-9_-]{32,}\/?$/.test(base.pathname)) {
    throw new Error('Recovery requires the new HTTPS release delivery address.');
  }
  base.pathname = `${base.pathname.replace(/\/$/, '')}/`;
  return base;
}

async function response(fetchImpl, url) {
  let result;
  try { result = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(900_000) }); }
  catch { throw new Error('Replacement release host could not be reached; update status is unknown.'); }
  if (!result.ok || !result.body) throw new Error(`Replacement release read failed (HTTP ${result.status}); update status is unknown.`);
  return result;
}

async function boundedJson(result) {
  const chunks = []; let size = 0;
  for await (const chunk of Readable.fromWeb(result.body)) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Replacement manifest exceeds its size limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/**
 * @param {{ baseUrl?: string, platform: string, outputDir: string, product?: string,
 *   fetchImpl?: (input: string | URL, init?: any) => Promise<Response>, configPath?: string }} options
 */
export async function recoverRelease({ baseUrl, platform, outputDir, product = 'desktop', fetchImpl = fetch,
  configPath = join(here, '../src-tauri/tauri.conf.json') }) {
  const base = releaseBase(baseUrl);
  if (!['desktop', 'server'].includes(product)) throw new Error('Product must be desktop or server.');
  if (!/^(linux|darwin|windows)-(x86_64|aarch64)$/.test(platform)) throw new Error('Unsupported updater platform.');
  // Trust stays local. The replacement host cannot nominate a verification key.
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const publicKey = config.plugins?.updater?.pubkey;
  if (typeof publicKey !== 'string' || !publicKey) throw new Error('The installed updater verification key is missing.');
  const manifest = await boundedJson(await response(fetchImpl, new URL(product === 'server' ? 'latest-server.json' : 'latest.json', base)));
  const artifact = manifest.platforms?.[platform];
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(manifest.version) ||
    typeof artifact?.url !== 'string' || typeof artifact?.signature !== 'string' || !artifact.signature) {
    throw new Error('No signed replacement is available for this platform; update status is unknown.');
  }
  const url = new URL(artifact.url);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Replacement artifact is outside the new release delivery address.');
  }
  let name;
  try { name = decodeURIComponent(url.pathname.split('/').at(-1)); } catch { /* refused below */ }
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Invalid replacement artifact name.');
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(outputDir, 'papercusp-recovery-'));
  const partial = join(directory, '.download'); const signature = join(directory, '.signature');
  try {
    const downloaded = await response(fetchImpl, url);
    await pipeline(Readable.fromWeb(downloaded.body), createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    await writeFile(signature, artifact.signature, { flag: 'wx', mode: 0o600 });
    let proof;
    try {
      const verified = await exec(process.execPath, [join(here, 'verify-tauri-signature.mjs'), publicKey, partial, signature, '--json'],
        { maxBuffer: 64 * 1024, timeout: 900_000 });
      proof = JSON.parse(verified.stdout);
      if (proof.valid !== true) throw new Error('invalid signature');
    } catch { throw new Error('Replacement signature verification failed; the download was not accepted.'); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(partial)) hash.update(chunk);
    const artifactPath = join(directory, name);
    await link(partial, artifactPath); await unlink(partial); await unlink(signature);
    const receipt = { schemaVersion: 1, product, platform, version: manifest.version,
      artifact: name, artifactSha256: hash.digest('hex'), signatureVerified: true, keyId: proof.keyId,
      releaseAddressSha256: createHash('sha256').update(base.href).digest('hex'),
      disposition: 'verified-replacement-staged', installationPerformed: false, userDataModified: false };
    await writeFile(join(directory, 'recovery.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { artifactPath, receipt };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [baseUrl, platform, outputDir, product = 'desktop'] = process.argv.slice(2);
  if (!baseUrl || !platform || !outputDir) {
    console.error('Usage: node bin/recover-release.mjs <new-release-address> <updater-platform> <download-directory> [desktop|server]');
    process.exitCode = 2;
  } else {
    recoverRelease({ baseUrl, platform, outputDir, product }).then(({ artifactPath }) => {
      console.log(`Signature-verified replacement saved to ${artifactPath}`);
      console.log('Install this replacement through the normal installer. Keep the existing Papercusp user data directory.');
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

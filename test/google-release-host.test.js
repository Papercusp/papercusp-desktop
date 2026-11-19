'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createReadStream, closeSync, mkdtempSync, openSync, rmSync, truncateSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

// This integration runs the exact maintained host config. Checking its text
// cannot prove that nginx actually removes its internal Content-Length value.
const IMAGE = 'openresty/openresty@sha256:a4a059a09c8a368c61f8247a186f4681941aedd49250db85fdf0caca31750366';
const CONFIG = resolve(__dirname, '../bin/google-release-host.conf');

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}

test('Google release delivery streams complete bytes across the Cloud Run response boundary', { timeout: 180_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'google-release-host-'));
  let container;
  try {
    const sizes = [32 * 1024 * 1024 - 1, 32 * 1024 * 1024, 32 * 1024 * 1024 + 1];
    for (const size of sizes) {
      const file = join(root, `${size}.bin`);
      closeSync(openSync(file, 'w'));
      truncateSync(file, size);
    }
    container = docker(['run', '--rm', '-d', '-p', '127.0.0.1::8080',
      '-v', `${CONFIG}:/etc/nginx/conf.d/default.conf:ro`, '-v', `${root}:/srv/releases:ro`, IMAGE]);
    const address = docker(['port', container, '8080/tcp']);
    const base = `http://${address}`;
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch(base, { signal: AbortSignal.timeout(500) });
        await response.arrayBuffer();
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    assert.ok(ready, 'release server did not start');
    for (const size of sizes) {
      const expected = createHash('sha256');
      for await (const chunk of createReadStream(join(root, `${size}.bin`))) expected.update(chunk);
      const response = await fetch(`${base}/${size}.bin`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-length'), null);
      assert.equal(response.headers.get('transfer-encoding'), 'chunked');
      let received = 0;
      const actual = createHash('sha256');
      for await (const chunk of response.body) { received += chunk.length; actual.update(chunk); }
      assert.equal(received, size);
      assert.equal(actual.digest('hex'), expected.digest('hex'));
    }
    const range = await fetch(`${base}/${sizes[2]}.bin`, { headers: { range: 'bytes=0-63' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 64);
    const listing = await fetch(base);
    assert.equal(listing.status, 403);
    await listing.arrayBuffer();
    const config = await fetch(`${base}/google-release-host.conf`);
    assert.equal(config.status, 404);
    await config.arrayBuffer();
  } finally {
    if (container) docker(['rm', '-f', container]);
    rmSync(root, { recursive: true, force: true });
  }
});

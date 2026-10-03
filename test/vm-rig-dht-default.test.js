// D-168 (p2p-public-release-endgame-2026-09-01, 2026-10-03): the Mac rig launcher defaults to
// the PUBLIC DHT, the product topology the tower bg-host runs since D-167. The isolated rig
// testnet is selected only by an explicit PAPERCUSP_DHT_BOOTSTRAP, and the swarm.ts marker-file
// fallback (~/.papercusp/dht-bootstrap, expected-dht-bootstrap) must follow the selection: a public
// boot that leaves an old isolated marker behind is silently pinned back to the testnet, which
// splits the rig from the tower (WI-10004745). Exercise the real selector through bash.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const launcher = path.join(import.meta.dirname, '..', 'bin', 'vm-rig', 'boot-headless-current.sh');

test('launcher self-test proves the PUBLIC default, stale-marker removal and the explicit isolated override', () => {
  const env = { ...process.env };
  delete env.PAPERCUSP_DHT_BOOTSTRAP;
  const result = spawnSync('bash', [launcher, '--self-test'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /SELF-TEST PASS: rig DHT defaults to PUBLIC \(stale isolated markers removed\)/);
});

test('launcher carries no hard-coded isolated-testnet default and routes the boot through the selector', () => {
  const source = fs.readFileSync(launcher, 'utf8');
  assert.doesNotMatch(
    source,
    /PAPERCUSP_DHT_BOOTSTRAP:-[0-9]/,
    'a ${PAPERCUSP_DHT_BOOTSTRAP:-<addr>} default re-pins every rig boot to the isolated testnet (D-168)',
  );
  assert.match(source, /^select_rig_dht_bootstrap "\$REAL_HOME" \|\|/m);
  assert.match(source, /boot-current: DHT=\$\{PAPERCUSP_DHT_BOOTSTRAP:-PUBLIC\}/);
});

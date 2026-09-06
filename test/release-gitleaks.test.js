'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'bin', 'release-gitleaks.toml');
const scriptPath = path.join(root, 'bin', 'release-local.sh');
const gitleaksBin = process.env.GITLEAKS_BIN || 'gitleaks';

function scan(entries, { config = true } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-release-gitleaks-'));
  try {
    for (const [relative, contents] of Object.entries(entries)) {
      const file = path.join(temp, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents);
    }

    const args = [
      'dir',
      temp,
      ...(config ? ['--config', configPath] : []),
      '--no-banner',
      '--log-level=error',
      '--redact=100',
      '--report-format=json',
      '--report-path=-',
    ];
    const result = spawnSync(gitleaksBin, args, { encoding: 'utf8' });
    assert.equal(result.error, undefined, 'gitleaks could not run: ' + (result.error?.message || 'unknown error'));
    let report = [];
    if (result.stdout.trim()) {
      report = JSON.parse(result.stdout);
    }
    return { status: result.status, report };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function generatedFixtures() {
  // These are deterministic, synthetic values. They are assembled at runtime
  // so the canaries never become findings in this test source itself.
  const publicGcpKey = ['AIzaSy', 'B9cD7eF1gH2jK3mN4pQ5rS6tU7vW8xY0z'].join('');
  const generatedValue = ['N3y-9Aq2P1', 'rS7vX4cL'].join('');
  const serveLines = [
    'const iterator = { key: "' + generatedValue + '" }; // case key/value iterator',
    'const bpe = { tokenTable: "secretaries IOKApiI= 50257 ICA= ICAg ICAgIA==" , key: "' + generatedValue + '" };',
    'const sort = "sortKey3=e17.sortKey===void 0?null:String(e17.sortKey)";',
    'const signerImport = ".signWithDeviceKey,verdictFns=await ";',
    'const certBattery = "token3,consumed=await ";',
    'const firebase = { projectKey: "' + generatedValue + '" };',
    'const roles = { fullAccessRoles: "' + generatedValue + '" };',
    'const invite = { "invite-secret": "' + generatedValue + '" };',
    'const canonicalInvite = { CANONICAL_INVITE_SECRET: "' + generatedValue + '" };',
    'const generatedToken = { token, "' + generatedValue + '" };',
    'const guidance = { accountToken: "' + generatedValue + '" }; // token/account guidance',
  ];
  const decodedBpePrefix = 'Authentication IFJhbms=';
  serveLines.push(
    'const bpeVocabulary = "' +
      Buffer.from(decodedBpePrefix + ' ' + generatedValue, 'utf8').toString('base64') +
      '";',
  );
  return {
    'spa/assets/chunk-TEST.js':
      'const firebase = { apiKey: "' + publicGcpKey + '", authDomain: "example.firebaseapp.com", projectId: "public" };',
    'spa/excalidraw/chunk-TEST.js':
      'const firebase = { apiKey: "' + publicGcpKey + '", authDomain: "example.firebaseapp.com", projectId: "public" };',
    'spa/monaco/vs/editor-TEST.js':
      'const l = { NKeyMap: "' + generatedValue + '" };',
    'serve.mjs': serveLines.join('\n') + '\n',
    'apps/operator-docs/src/content/docs/privacy/personal-vault.mdx':
      'same-key restore succeeds, "' + generatedValue + '"\n',
    'internal-docs/privacy/personal-vault.html':
      'same-key restore succeeds, "' + generatedValue + '"\n',
    'internal-docs/privacy/personal-vault.md':
      'same-key restore succeeds, "' + generatedValue + '"\n',
  };
}

test('release gitleaks config keeps default detectors and uses conjunctive generated-byte exceptions', () => {
  const config = fs.readFileSync(configPath, 'utf8');
  assert.match(config, /minVersion = "v8\.30\.1"/);
  assert.match(config, /\[extend\]\s+useDefault = true/);
  assert.equal((config.match(/condition = "AND"/g) || []).length, 7);
  assert.match(config, /targetRules = \["gcp-api-key"\]/);
  assert.match(config, /targetRules = \["generic-api-key"\]/);
  assert.match(config, /regexTarget = "line"/);
  assert.match(config, /spa\/assets\/chunk-/);
  assert.match(config, /spa\/excalidraw\/chunk-/);
  assert.match(config, /spa\/monaco\/vs\/editor-/);
  assert.ok(config.includes('(?:^|/)serve\\.mjs$'));
  assert.match(config, /\\bsecretaries\\b/);
  assert.match(config, /IOKApiI=/);
  assert.match(config, /\\b50257\\b/);
  assert.ok(config.includes('canonical[-_ ])?invite[-_ ]secret'));
  assert.match(config, /\\btoken,/);
  assert.match(config, /regexTarget = "match"/);
  assert.match(config, /Authentication IFJhbms=/);
  assert.match(config, /\\.ContainsKey IGNvbGxhcHNlZA==/);
  assert.match(config, /\\.signWithDeviceKey,verdictFns=await/);
  assert.match(config, /token\[0-9\]\+,consumed=await/);
  assert.match(config, /personal-vault/);
});

test('known generated contexts pass only under their path-and-line allowlists', () => {
  const fixtures = generatedFixtures();
  const baseline = scan(fixtures, { config: false });
  const baselineRules = new Set(baseline.report.map((finding) => finding.RuleID));
  assert.equal(baseline.status, 1, 'synthetic generated contexts did not exercise the default detector set');
  assert.ok(baselineRules.has('gcp-api-key'), 'the GCP fixture no longer exercises gcp-api-key');
  assert.ok(baselineRules.has('generic-api-key'), 'the generated-code fixtures no longer exercise generic-api-key');

  const allowed = scan(fixtures);
  assert.equal(allowed.status, 0, 'known generated contexts must be suppressed by the release config');
  assert.deepEqual(allowed.report, []);
});

test('decoded BPE match allowlist is exact and remains path-constrained', () => {
  const generatedValue = ['N3y-9Aq2P1', 'rS7vX4cL'].join('');
  const known = Buffer.from('Authentication IFJhbms= ' + generatedValue, 'utf8').toString('base64');
  const nearMiss = Buffer.from('Authentication DIFFERENT= ' + generatedValue, 'utf8').toString('base64');
  const fixtures = {
    'serve.mjs': 'const known = "' + known + '";\nconst nearMiss = "' + nearMiss + '";\n',
  };

  const baseline = scan(fixtures, { config: false });
  assert.equal(baseline.status, 1, 'decoded BPE canaries did not exercise the default detector');
  assert.ok(
    baseline.report.some((finding) => finding.Tags?.includes('decoded:base64')),
    'the BPE fixture did not exercise gitleaks base64 decoding',
  );

  const result = scan(fixtures);
  assert.equal(result.status, 1, 'the near-match unexpectedly passed the release gate');
  assert.ok(
    result.report.some((finding) => finding.Match?.includes('Authentication DIFFERENT=')),
    'the near-match was not retained as a finding',
  );
  assert.ok(
    !result.report.some((finding) => finding.Match?.includes('Authentication IFJhbms=')),
    'the known public BPE match was not suppressed',
  );
});

test('minified first-party expression exceptions survive symbol renumbering but remain exact', () => {
  const knownLines = [
    'sortKey3=e42.sortKey===void 0?null:String(e42.sortKey)',
    '.signWithDeviceKey,verdictFns=await ',
    'token17,consumed=await ',
  ];
  const baseline = scan({ 'serve.mjs': knownLines.join('\n') + '\n' }, { config: false });
  assert.equal(baseline.status, 1, 'known minified expressions no longer exercise the default detector');
  assert.ok(baseline.report.length >= knownLines.length);

  const allowed = scan({ 'serve.mjs': knownLines.join('\n') + '\n' });
  assert.equal(allowed.status, 0, 'known minified expressions must pass in serve.mjs');
  assert.deepEqual(allowed.report, []);

  const nearMisses = [
    'sortKey3=e42.otherKey===void 0?null:String(e42.otherKey)',
    '.signWithDeviceKey,otherVerdictFns=await ',
    'token17,produced=await ',
  ];
  const nearMiss = scan({ 'serve.mjs': nearMisses.join('\n') + '\n' });
  assert.equal(nearMiss.status, 1, 'nearby generated expressions were over-allowlisted');
  assert.ok(nearMiss.report.length >= nearMisses.length);

  const wrongPath = scan({ 'other.mjs': knownLines.join('\n') + '\n' });
  assert.equal(wrongPath.status, 1, 'serve.mjs exceptions escaped their path constraint');
});

test('an unrelated raw token remains a release-gate finding', () => {
  const canary = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
  const result = scan({
    'unrelated/raw.js': 'const token = "' + canary + '";\n',
  });
  assert.equal(result.status, 1, 'an unrelated token-shaped value unexpectedly passed the release gate');
  assert.ok(
    result.report.some((finding) => finding.RuleID === 'generic-api-key'),
    'the unrelated token canary was not classified by generic-api-key',
  );
});

test('release-local runs gitleaks after the Python assembled-bundle audit and before the boot gate', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const pythonGate = source.indexOf('python3 "$ROOT/bin/audit-release-bundle.py"');
  const gitleaksGate = source.indexOf('release-gitleaks.toml');
  const bootGate = source.indexOf('# ── BOOT GATE');
  assert.ok(pythonGate >= 0, 'the Python assembled-bundle audit is missing');
  assert.ok(gitleaksGate > pythonGate, 'gitleaks must run after the Python assembled-bundle audit');
  assert.ok(gitleaksGate < bootGate, 'gitleaks must run before the boot/platform-leg gates');
  assert.match(source, /"\$ROOT\/src-tauri\/sidecar" "\$ROOT\/src-tauri\/resources"/);
  assert.match(source, /--redact=100/);
  assert.match(source, /--report-path=\/dev\/null/);
});

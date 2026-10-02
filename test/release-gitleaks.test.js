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
const reportFormatterPath = path.join(root, 'bin', 'lib', 'print-gitleaks-findings.py');
const gitleaksBin = process.env.GITLEAKS_BIN || 'gitleaks';

test('D-142 secret-key detector catches serialized keys and recipient seeds without leaking values', () => {
  const crypto = require('node:crypto');
  const pair = crypto.generateKeyPairSync('ed25519');
  const der = pair.privateKey.export({ type: 'pkcs8', format: 'der' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  const seed = Buffer.from(jwk.d, 'base64url');
  const publicKey = Buffer.from(jwk.x, 'base64url');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-private-key-control-'));
  try {
    const cases = {
      rawDer: der,
      hexDer: Buffer.from(der.toString('hex')),
      base64Der: Buffer.from(der.toString('base64')),
      pem: Buffer.from(pair.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      jwk: Buffer.from(JSON.stringify(jwk)),
      hexSeed: Buffer.from(seed.toString('hex')),
      base64Seed: Buffer.from(seed.toString('base64')),
      base64urlSeed: Buffer.from(seed.toString('base64url')),
      sodiumSecret: Buffer.from(Buffer.concat([seed, publicKey]).toString('base64')),
      rawSodiumSecret: Buffer.concat([seed, publicKey]),
      x25519SeedHex: Buffer.from(crypto.createHash('sha512').update(seed).digest().subarray(0, 32).toString('hex')),
      x25519SeedBase64: Buffer.from(crypto.createHash('sha512').update(seed).digest().subarray(0, 32).toString('base64')),
    };
    const program = 'import importlib.util,json,base64,sys\ns=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.scan_secret_key_bytes(open(sys.argv[2],"rb").read(),{base64.b64decode(sys.argv[3])})))';
    for (const [encoding, data] of Object.entries(cases)) {
      const input = path.join(temp, encoding);
      fs.writeFileSync(input, data, { mode: 0o600 });
      const result = spawnSync('python3', ['-c', program, reportFormatterPath, input, publicKey.toString('base64')], { encoding: 'utf8' });
      assert.equal(result.status, 0, `${encoding}: ${result.stderr}`);
      const proof = JSON.parse(result.stdout);
      assert.ok(proof.realFindings > 0, `${encoding}: private key missed`);
      assert.ok(proof.derivationMatches > 0, `${encoding}: recipient derivation missed`);
      assert.ok(proof.tokensChecked > 0);
      assert.ok(!(result.stdout + result.stderr).includes(seed.toString('hex')));
      assert.ok(!(result.stdout + result.stderr).includes(seed.toString('base64')));
    }
    // A raw libsodium secret is structurally private even for a different recipient.
    const other = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    const input = path.join(temp, 'sodiumSecret');
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, input,
      Buffer.from(other.x, 'base64url').toString('base64')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(JSON.parse(result.stdout).realFindings > 0);
    assert.equal(JSON.parse(result.stdout).derivationMatches, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-142 secret-key detector distinguishes source vocabulary and unrelated public keys', () => {
  const program = 'import importlib.util,json,base64,sys\ns=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nsodium=m._sodium();public,_=m._key_publics(sodium,bytes(range(32)))\ndata=b"BEGIN PRIVATE KEY papercusp-hive-epoch-key 302e020100300506032b657004220420 " + public.hex().encode()\nprint(json.dumps(m.scan_secret_key_bytes(data,{public})))';
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { realFindings: 0, derivationMatches: 0, tokensChecked: 1, rawSkMatches: 0, literalOnlyMarkers: 2 });
});

test('D-142 inventory scan binds input hashes, detects keystore names, and runs the same planted controls', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-key-inventory-'));
  try {
    const plain = path.join(temp, 'plaintext.jsonl');
    const bundle = path.join(temp, 'serve.mjs');
    fs.writeFileSync(plain, '{"public":"example"}\n');
    fs.writeFileSync(bundle, 'const service="papercusp-hive-epoch-key";\n');
    const program = 'import importlib.util,json,sys,pathlib\ns=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\npublic,_=m._key_publics(m._sodium(),bytes(range(32)))\npaths=[pathlib.Path(p) for p in sys.argv[2:]]\nprint(json.dumps(m.scan_identity_secret_inputs(paths,{public},paths)))';
    const run = (...files) => spawnSync('python3', ['-c', program, reportFormatterPath, ...files], { encoding: 'utf8' });
    const result = run(plain, bundle);
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.realFindings, 0);
    assert.equal(proof.derivationMatches, 0);
    assert.equal(proof.nameScanHits, 0);
    assert.equal(proof.literalOnlyMarkers, 1);
    assert.equal(proof.controls.length, 12);
    assert.ok(proof.controls.every(row => row.detected && row.derivationDetected));
    assert.ok(proof.controls.every(row => /^[a-f0-9]{64}$/.test(row.plantedSha256)));
    const hash = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(proof.scannerSha256, hash(reportFormatterPath));
    assert.deepEqual(proof.inputs, [plain, bundle].map(file => ({ path: file, sha256: hash(file) })));
    const named = path.join(temp, 'device-keypair.enc');
    fs.writeFileSync(named, 'opaque-keystore');
    assert.equal(JSON.parse(run(named).stdout).nameScanHits, 1);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

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
  assert.equal((config.match(/condition = "AND"/g) || []).length, 9);
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
  assert.match(config, /SESSION_PORT_TOKEN_ESTIMATOR=\"utf8-byte-upper-bound-v1\"/);
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

test('Monaco generated contexts cover both shipped directory layouts and environment copies', () => {
  const generated = generatedFixtures()['spa/monaco/vs/editor-TEST.js'];
  const fixtures = Object.fromEntries([
    'spa/monaco/vs/editor-TEST.js',
    'spa/monaco/monaco/vs/editor-TEST.js',
    'env-sidecars/staging/spa/monaco/vs/editor-TEST.js',
    'env-sidecars/staging/spa/monaco/monaco/vs/editor-TEST.js',
  ].map((file) => [file, generated]));

  const baseline = scan(fixtures, { config: false });
  assert.equal(baseline.status, 1);
  assert.equal(new Set(baseline.report.map((finding) => finding.File)).size, 4,
    'every shipped-layout fixture must exercise the credential detector');

  const allowed = scan(fixtures);
  assert.equal(allowed.status, 0, 'the nested shipped Monaco layout was not recognized');
  assert.deepEqual(allowed.report, []);
});

test('nested Monaco exception still requires the exact path shape and generated line marker', () => {
  const generated = generatedFixtures()['spa/monaco/vs/editor-TEST.js'];
  const canary = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
  const fixtures = {
    'spa/monaco/monaco/monaco/vs/editor-TEST.js': generated,
    'spa/monaco/monaco/vs/unrelated-TEST.js': generated,
    'unrelated/editor-TEST.js': generated,
    'spa/monaco/monaco/vs/editor-TEST.js':
      generated + '\nconst token = "' + canary + '";\n',
  };
  const result = scan(fixtures);
  assert.equal(result.status, 1, 'unrelated paths or a separate raw-token line passed');
  for (const relative of Object.keys(fixtures)) {
    assert.ok(result.report.some((finding) => finding.File.endsWith(relative)),
      'the path-and-line constraint missed its negative canary: ' + relative);
  }
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

test('session-port estimator marker is allowed only in generated serve.mjs', () => {
  const marker = 'SESSION_PORT_TOKEN_ESTIMATOR="utf8-byte-upper-bound-v1"';
  const allowed = scan({ 'serve.mjs': marker + '\n' });
  assert.equal(allowed.status, 0, 'the public session-port estimator marker should be allowlisted');
  assert.deepEqual(allowed.report, []);

  const wrongPath = scan({ 'other.mjs': marker + '\n' });
  assert.equal(wrongPath.status, 1, 'the estimator exception must remain serve.mjs scoped');
  assert.ok(wrongPath.report.some((finding) => finding.RuleID === 'generic-api-key'));

  const nearMiss = scan({ 'serve.mjs': 'SESSION_PORT_TOKEN_ESTIMATOR="utf8-byte-upper-bound-v2"\n' });
  assert.equal(nearMiss.status, 1, 'a changed estimator value must remain a finding');
  assert.ok(nearMiss.report.some((finding) => finding.RuleID === 'generic-api-key'));
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

test('D-112 seed credential scan detects raw tokens in data and script files', () => {
  const canary = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
  const result = scan({
    'seed/corestore/db/fixture.json': '{"token":"' + canary + '"}\n',
    'seed/serve.mjs': 'const token = "' + canary + '";\n',
  });
  assert.equal(result.status, 1);
  assert.ok(result.report.some((finding) => finding.File.endsWith('seed/corestore/db/fixture.json')));
  assert.ok(result.report.some((finding) => finding.File.endsWith('seed/serve.mjs')));
});

test('redacted gitleaks diagnostics expose locators but never matched values or host paths', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gitleaks-report-'));
  try {
    const secret = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
    const reportPath = path.join(temp, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify([{
      RuleID: 'generic-api-key',
      Description: 'Detected a Generic API Key.',
      File: '/build-box/src-tauri/sidecar/serve.mjs',
      StartLine: 54,
      EndLine: 54,
      Match: 'token = "' + secret + '"',
      Secret: secret,
    }]));
    const result = spawnSync(
      'python3',
      [reportFormatterPath, reportPath, 'src-tauri/sidecar'],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /RuleID=generic-api-key/);
    assert.match(result.stderr, /File=serve\.mjs/);
    assert.match(result.stderr, /Lines=54-54/);
    assert.match(result.stderr, /Description=Detected a Generic API Key\./);
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.doesNotMatch(result.stderr, /build-box/);
    assert.doesNotMatch(result.stderr, /Match|Secret/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('release-local runs redacted gitleaks diagnostics after the Python assembled-bundle audit and before the boot gate', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const pythonGate = source.indexOf('python3 "$ORCHESTRATOR_HERE/audit-release-bundle.py"');
  const gitleaksGate = source.indexOf('release-gitleaks.toml');
  const bootGate = source.indexOf('# ── BOOT GATE');
  assert.ok(pythonGate >= 0, 'the Python assembled-bundle audit is missing');
  assert.ok(gitleaksGate > pythonGate, 'gitleaks must run after the Python assembled-bundle audit');
  assert.ok(gitleaksGate < bootGate, 'gitleaks must run before the boot/platform-leg gates');
  assert.match(source, /"\$ROOT\/src-tauri\/sidecar" "\$ROOT\/src-tauri\/resources"/);
  assert.match(source, /for _gitleaks_root in "src-tauri\/sidecar" "src-tauri\/resources" "src-tauri\/seed"; do/);
  assert.match(source, /\( cd "\$ROOT" && gitleaks dir "\$_gitleaks_root"/);
  assert.match(source, /_gitleaks_redact=100/);
  assert.match(source, /--redact="\$_gitleaks_redact"/);
  assert.match(source, /--filter-seed/);
  assert.match(source, /--report-format=json/);
  assert.match(source, /--report-path="\$_gitleaks_report_path"/);
  assert.doesNotMatch(source, /--report-path=\/dev\/null/);
  assert.match(source, /print-gitleaks-findings\.py/);
  assert.match(source, /_GITLEAKS_REPORT_DIR=.*mktemp -d/);
  assert.match(source, /rm -rf -- "\$_GITLEAKS_REPORT_DIR"/);
});

test('gitleaks diagnostics aggregate repeated locators and bound unique output', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gitleaks-bounded-'));
  try {
    const repeated = { RuleID: 'generic-api-key', File: 'src-tauri/seed/corestore/db/fixture.blob', StartLine: 7, EndLine: 7 };
    const findings = [...Array(1000).fill(repeated), ...Array.from({ length: 60 }, (_, i) => ({
      ...repeated, File: `src-tauri/seed/fixture-${i}.json`,
    }))];
    const reportPath = path.join(temp, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(findings));
    const result = spawnSync('python3', [reportFormatterPath, reportPath, 'src-tauri/seed'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /1060 finding records; 61 unique locators/);
    assert.match(result.stderr, /Occurrences=1000/);
    assert.equal((result.stderr.match(/- RuleID=/g) || []).length, 50);
    assert.match(result.stderr, /11 additional locators retained/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('failed scans retain private evidence while successful scans remove reports', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const cleanup = source.slice(source.indexOf('cleanup_release_local() {'), source.indexOf('# Override any inherited value'));
  const reportSetup = source.slice(source.indexOf('if [[ -n "${VH_RUN_DIR:-}" && -d "$VH_RUN_DIR" ]]'), source.indexOf('_GITLEAKS_STATUS=0'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-gitleaks-retention-'));
  try {
    for (const status of [0, 1]) {
      const runDir = path.join(temp, `run-${status}`);
      fs.mkdirSync(runDir);
      const script = `set -eu\n${cleanup}\nreap_release_legs() { :; }\nVH_RUN_DIR=$1\n${reportSetup}\nprintf '[]' > "$_GITLEAKS_REPORT_DIR/report.json"\nprintf '%s' "$_GITLEAKS_REPORT_DIR" > "$VH_RUN_DIR/report-path"\n_GITLEAKS_STATUS=$2\ntrap cleanup_release_local EXIT\nexit "$2"`;
      const result = spawnSync('bash', ['-c', script, 'retention-test', runDir, String(status)], { encoding: 'utf8' });
      assert.equal(result.status, status, result.stderr);
      const reportDir = fs.readFileSync(path.join(runDir, 'report-path'), 'utf8');
      assert.equal(fs.existsSync(path.join(reportDir, 'report.json')), status === 1);
      if (status === 1) {
        assert.equal(fs.statSync(reportDir).mode & 0o777, 0o700);
        assert.match(result.stderr, /evidence retained privately/);
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('seed classification indexes once, resolves split fields, and keeps raw tokens unclassified', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-seed-classify-'));
  try {
    const messageId = ['abcdefgh', '0000', '1234567890abcdef'.repeat(2)].join('-');
    const ciphertext = Buffer.from(Array.from({ length: 80 }, (_, i) => i)).toString('base64');
    const rawToken = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
    const blob = path.join(temp, 'fixture.blob');
    fs.writeFileSync(blob, JSON.stringify({ hbKey: messageId, value: { __rekey: ciphertext }, token: rawToken }));
    const finding = (field, value) => ({ RuleID: 'generic-api-key', Match: `${field}":"${value}"`, Secret: value });
    const report = path.join(temp, 'report.json');
    fs.writeFileSync(report, JSON.stringify([
      ...Array(1000).fill(finding('hbKey', messageId)),
      finding('__rekey', ciphertext),
      ...Array(20).fill(finding('rekey', ciphertext)),
      finding('token', rawToken),
      finding('__rekey', rawToken),
      { ...finding('hbKey', messageId), RuleID: 'other-rule' },
    ]));
    const result = spawnSync('python3', [reportFormatterPath, '--classify-seed', report, blob], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.deepEqual(summary.classes, { 'public-message-id': 1000, 'ciphertext-envelope-framing': 21, unclassified: 3 });
    assert.equal(summary.indexPasses, 1);
    assert.equal(summary.fullBlobSearches, 1, 'repeated fragments must share one source lookup');
    assert.ok(summary.residuals.every((row) => row.originalField === '__rekey'));
    for (const value of [messageId, ciphertext, rawToken, blob]) {
      assert.ok(!(result.stdout + result.stderr).includes(value), 'classification disclosed a value or path');
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('seed classification refuses redacted findings and invalid ciphertext without printing values', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-seed-classify-negative-'));
  try {
    const blob = path.join(temp, 'fixture.blob');
    const invalid = 'not-ciphertext!';
    fs.writeFileSync(blob, JSON.stringify({ __rekey: invalid }));
    const report = path.join(temp, 'report.json');
    fs.writeFileSync(report, JSON.stringify([
      { RuleID: 'generic-api-key', Match: `__rekey":"${invalid}"`, Secret: invalid },
      { RuleID: 'generic-api-key', Match: 'hbKey":"REDACTED"', Secret: 'REDACTED' },
    ]));
    const result = spawnSync('python3', [reportFormatterPath, '--classify-seed', report, blob], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).classes, { unclassified: 2 });
    assert.ok(!(result.stdout + result.stderr).includes(invalid));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('private seed scan persists before classification and reuses only unchanged input and report bytes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-seed-scan-private-'));
  try {
    fs.chmodSync(temp, 0o700);
    const blob = path.join(temp, 'fixture.blob');
    const report = path.join(temp, 'report.json');
    const meta = path.join(temp, 'report.meta.json');
    const rawToken = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
    fs.writeFileSync(blob, JSON.stringify({ token: rawToken }));
    const run = () => spawnSync('python3', [reportFormatterPath, '--scan-seed', report, blob, configPath], { encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).privateReportReused, false);
    assert.deepEqual(JSON.parse(first.stdout).classes, { unclassified: 1 });
    assert.equal(fs.statSync(report).mode & 0o777, 0o600);
    assert.equal(fs.statSync(meta).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(report, 'utf8'))[0].Secret, rawToken);
    assert.equal(JSON.parse(run().stdout).privateReportReused, true);
    // Corrupting the report without touching its metadata must force a rescan.
    fs.writeFileSync(report, '[]');
    assert.equal(JSON.parse(run().stdout).privateReportReused, false);
    fs.writeFileSync(blob, '{}');
    const changed = run();
    assert.equal(changed.status, 0, changed.stderr);
    assert.equal(JSON.parse(changed.stdout).privateReportReused, false);
    assert.equal(JSON.parse(changed.stdout).findings, 0);
    for (const result of [first, changed]) {
      assert.ok(!(result.stdout + result.stderr).includes(rawToken));
      assert.ok(!(result.stdout + result.stderr).includes(temp));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('private seed scanner keeps completed evidence when classification fails and refuses public report directories', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-seed-scan-failure-'));
  try {
    fs.chmodSync(temp, 0o700);
    const bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    const fake = path.join(bin, 'gitleaks');
    const marker = path.join(temp, 'scanner-called');
    const blob = path.join(temp, 'fixture.blob');
    const report = path.join(temp, 'report.json');
    fs.writeFileSync(blob, '{}');
    fs.writeFileSync(fake, '#!/bin/sh\nif [ "$1" = version ]; then echo test-v1; exit 0; fi\nwhile [ "$1" != --report-path ]; do shift; done\nprintf \'[]\' > "$2"\nprintf x >> "$SCANNER_MARKER"\nrm "$SCANNER_BLOB"\n');
    fs.chmodSync(fake, 0o700);
    const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
      SCANNER_MARKER: marker, SCANNER_BLOB: path.join(temp, 'unused') };
    // Inject only a classification failure; scanning and input stability succeed.
    const program = 'import importlib.util, pathlib, sys\ns=importlib.util.spec_from_file_location("formatter",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef fail(*args): raise ValueError("classification failed")\nm.classify_seed_findings=fail\nraise SystemExit(m.main([sys.argv[1],"--scan-seed",*sys.argv[2:]]))';
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, report, blob, configPath], { encoding: 'utf8', env });
    assert.equal(result.status, 2);
    assert.ok(fs.existsSync(report), 'completed scan must survive classification failure');
    assert.ok(fs.existsSync(path.join(temp, 'report.meta.json')));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'x');
    assert.doesNotMatch(result.stderr, /classification failed|papercusp-seed-scan-failure/);
    fs.chmodSync(temp, 0o755);
    const refused = spawnSync('python3', [reportFormatterPath, '--scan-seed', report, blob, configPath], { encoding: 'utf8', env });
    assert.equal(refused.status, 2);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'x', 'unsafe directory must be refused before scan');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

function seedProofFixture({ extraCredential = false } = {}) {
  const crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-exact-seed-proof-'));
  const seed = path.join(temp, 'seed');
  const evidence = path.join(temp, 'evidence');
  fs.mkdirSync(path.join(seed, 'corestore', 'db'), { recursive: true });
  fs.mkdirSync(evidence, { mode: 0o700 });
  const relative = 'corestore/db/000080.blob';
  const blob = path.join(seed, relative);
  const id = ['su-', 'f42a22d4-08e3-41e3-b181-561049962f21'].join('');
  const token = ['A9f3Kx7L', 'm2Qp8Rz4', 'V6nC1wH7'].join('');
  const publicLine = JSON.stringify({ writer_key: id, surface: 'messages' });
  fs.writeFileSync(blob, publicLine.slice(0, -1) + (extraCredential ? ',"token":"' + token + '"}' : '}'));
  fs.writeFileSync(path.join(seed, 'epoch-keys.json'), '{}');
  fs.writeFileSync(path.join(seed, 'manifest.json'), '{}');
  const write = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value), { mode: 0o600 });
  const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const digest = row => crypto.createHash('sha256').update(JSON.stringify([row.RuleID, row.Match, row.Secret])).digest('hex');
  const report = file => {
    const result = spawnSync(gitleaksBin, ['dir', file, '--config', configPath, '--no-banner', '--log-level=error',
      '--redact=0', '--report-format=json', '--report-path=-'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    return JSON.parse(result.stdout);
  };
  const current = report(blob);
  const approved = current.filter(row => row.Secret === id);
  assert.ok(approved.length > 0, 'real scanner must flag the public identifier fixture');
  const plaintext = path.join(evidence, 'seed-000080.plaintext.jsonl');
  fs.writeFileSync(plaintext, publicLine + '\n', { mode: 0o600 });
  const plain = report(plaintext);
  const version = spawnSync(gitleaksBin, ['version'], { encoding: 'utf8' }).stdout.trim();
  const identity = file => ({ blobSha256: hash(file), configSha256: hash(configPath), scannerVersion: version });
  write('ciphertext-auth-safe.json', { ciphertextFields: 1, parsedRows: 1,
    classes: { authenticated_ciphertext: 1 }, unparsedCiphertextFields: 0,
    negativeControls: { tamper_rejected: true, wrong_key_rejected: true } });
  write('plaintext-classification-safe.json', { plaintextSha256: hash(plaintext), findings: plain.length,
    classes: { 'public-coord-sender-identifier': plain.length }, unclassifiedLocators: [] });
  write('plaintext-exact-finding-digests.json', plain.map(row => ({ rule: row.RuleID, digest: digest(row),
    class: 'public-coord-sender-identifier' })));
  write('seed-000080.plaintext.private.json', plain);
  write('seed-000080.plaintext.private.meta.json', { identity: identity(plaintext), scannerExit: 1,
    findings: plain.length, reportSha256: hash(path.join(evidence, 'seed-000080.plaintext.private.json')) });
  write('seed-classification-verified-safe.json', { sourceSha256: hash(blob), findings: approved.length,
    classes: { 'public-agent-or-session-id': approved.length }, unclassifiedLocators: [],
    plaintextProofSha256: hash(path.join(evidence, 'plaintext-classification-safe.json')) });
  write('seed-exact-finding-digests.json', approved.map(row => ({ rule: row.RuleID, digest: digest(row),
    class: 'public-agent-or-session-id' })));
  write('seed-000080.private.json', approved);
  write('seed-000080.private.meta.json', { identity: identity(blob), scannerExit: 1, findings: approved.length });
  const assembled = spawnSync('python3', [reportFormatterPath, '--assemble-seed-proof', evidence, seed,
    configPath, relative, 'test:independently-reviewed-fixture'], { encoding: 'utf8' });
  assert.equal(assembled.status, 0, assembled.stderr);
  const proof = path.join(evidence, 'seed-finding-proof.json');
  const filter = (rows = current, proofPath = proof) => {
    write('current.json', rows);
    const result = spawnSync('python3', [reportFormatterPath, '--filter-seed', path.join(evidence, 'current.json'),
      seed, proofPath, configPath], { encoding: 'utf8' });
    for (const value of [id, token, temp]) assert.ok(!(result.stdout + result.stderr).includes(value));
    return result;
  };
  return { temp, seed, evidence, blob, proof, current, approved, filter, write, hash };
}

test('D-140 exact-content proof retains a new credential on the same blob line', () => {
  const f = seedProofFixture({ extraCredential: true });
  try {
    assert.equal(f.filter(f.approved).status, 0);
    const failed = f.filter();
    assert.equal(failed.status, 1);
    assert.ok(JSON.parse(failed.stdout).remaining > 0);
    const residual = JSON.parse(fs.readFileSync(path.join(f.evidence, 'current.json')));
    assert.ok(residual.every(row => row.Match === 'REDACTED' && row.Secret === 'REDACTED'));
    assert.ok(fs.existsSync(path.join(f.evidence, 'current.private.json')));
    // Native fingerprints/line numbers are deliberately unchanged in this control.
    assert.equal(f.filter(f.approved.map(row => ({ ...row, Match: row.Match + 'changed' }))).status, 1);
    assert.equal(f.filter(f.approved.map(row => ({ ...row, RuleID: 'another-rule' }))).status, 1);
    assert.equal(f.filter(f.approved.map(row => ({ ...row, File: path.join(f.seed, 'other.blob') }))).status, 1);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
});

test('D-140 proof refuses changed source, epoch keys, missing proof, and failed decrypt attestation', () => {
  const f = seedProofFixture();
  try {
    assert.equal(f.filter().status, 0);
    assert.equal(f.filter(undefined, f.proof + '.missing').status, 2);
    const original = fs.readFileSync(f.blob);
    fs.appendFileSync(f.blob, 'changed');
    assert.equal(f.filter().status, 2);
    fs.writeFileSync(f.blob, original);
    fs.writeFileSync(path.join(f.seed, 'epoch-keys.json'), '{"changed":true}');
    assert.equal(f.filter().status, 2);
    fs.writeFileSync(path.join(f.seed, 'epoch-keys.json'), '{}');
    const auth = path.join(f.evidence, 'ciphertext-auth-safe.json');
    const failedAuth = JSON.parse(fs.readFileSync(auth));
    failedAuth.classes = { authentication_failed: 1 };
    f.write('ciphertext-auth-safe.json', failedAuth);
    // Reseal the hash so the semantic decrypt check, beyond hash tampering, must reject.
    const proof = JSON.parse(fs.readFileSync(f.proof));
    proof.evidence['ciphertext-auth-safe.json'] = f.hash(auth);
    fs.writeFileSync(f.proof, JSON.stringify(proof));
    assert.equal(f.filter().status, 2);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
});

test('D-140 proof refuses surplus classified digests hidden by duplicate report findings', () => {
  for (const plaintext of [true, false]) {
    const f = seedProofFixture();
    try {
      const reportName = plaintext ? 'seed-000080.plaintext.private.json' : 'seed-000080.private.json';
      const entriesName = plaintext ? 'plaintext-exact-finding-digests.json' : 'seed-exact-finding-digests.json';
      const summaryName = plaintext ? 'plaintext-classification-safe.json' : 'seed-classification-verified-safe.json';
      const metaName = plaintext ? 'seed-000080.plaintext.private.meta.json' : 'seed-000080.private.meta.json';
      const read = name => JSON.parse(fs.readFileSync(path.join(f.evidence, name)));
      const report = read(reportName);
      const entries = read(entriesName);
      const summary = read(summaryName);
      const meta = read(metaName);
      report.push(report[0]);
      entries.push({ ...entries[0], digest: 'f'.repeat(64) });
      summary.findings++;
      summary.classes[entries[0].class]++;
      meta.findings++;
      f.write(reportName, report);
      meta.reportSha256 = f.hash(path.join(f.evidence, reportName));
      f.write(entriesName, entries);
      f.write(summaryName, summary);
      f.write(metaName, meta);
      if (plaintext) {
        const seedSummary = read('seed-classification-verified-safe.json');
        seedSummary.plaintextProofSha256 = f.hash(path.join(f.evidence, summaryName));
        f.write('seed-classification-verified-safe.json', seedSummary);
      }
      // Reseal every changed evidence file: reject the semantic mismatch even
      // when report counts, class counts, input identities, and hashes agree.
      const proof = read('seed-finding-proof.json');
      for (const name of Object.keys(proof.evidence)) proof.evidence[name] = f.hash(path.join(f.evidence, name));
      f.write('seed-finding-proof.json', proof);
      assert.equal(f.filter().status, 2, plaintext ? 'plaintext surplus digest passed' : 'seed surplus digest passed');
    } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
  }
});

test('D-140 storage-segment proofs compose while preserving per-file exact-content boundaries', () => {
  const f = seedProofFixture({ extraCredential: true });
  try {
    const second = 'corestore/db/000094.blob';
    fs.copyFileSync(f.blob, path.join(f.seed, second));
    const evidence2 = path.join(f.evidence, 'segment2');
    fs.mkdirSync(evidence2, { mode: 0o700 });
    for (const name of fs.readdirSync(f.evidence)) {
      if (name !== 'segment2') fs.copyFileSync(path.join(f.evidence, name), path.join(evidence2, name));
    }
    const child = path.join(evidence2, 'seed-finding-proof.json');
    const proof2 = JSON.parse(fs.readFileSync(child));
    proof2.file = second;
    fs.writeFileSync(child, JSON.stringify(proof2), { mode: 0o600 });
    const collection = { schemaVersion: proof2.schemaVersion, reviewRef: proof2.reviewRef,
      proofs: [{ path: 'seed-finding-proof.json', sha256: f.hash(f.proof) },
        { path: 'segment2/seed-finding-proof.json', sha256: f.hash(child) }] };
    const master = path.join(f.evidence, 'collection.json');
    const seal = () => fs.writeFileSync(master, JSON.stringify(collection), { mode: 0o600 });
    seal();
    const secondRows = f.approved.map(row => ({ ...row, File: path.join(f.seed, second) }));
    assert.equal(f.filter([...f.approved, ...secondRows], master).status, 0);
    assert.equal(f.filter([...f.current, ...secondRows], master).status, 1,
      'composition must retain a new raw credential on an approved segment line');
    assert.equal(f.filter(f.approved.map(row => ({ ...row, File: path.join(f.seed, 'third.blob') })), master).status, 1);
    collection.proofs[1].sha256 = '0'.repeat(64); seal();
    assert.equal(f.filter(secondRows, master).status, 2);
    collection.proofs[1].sha256 = f.hash(child);
    collection.proofs.push(collection.proofs[0]); seal();
    assert.equal(f.filter(secondRows, master).status, 2, 'duplicate segment proofs must fail closed');
    collection.proofs.pop();
    collection.proofs[1].path = '../outside.json'; seal();
    assert.equal(f.filter(secondRows, master).status, 2);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
});

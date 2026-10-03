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

test('D-166 authenticates the full supplied row census, drops the class and mirrors, and preserves honest counts', () => {
  const crypto = require('node:crypto');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-uuid-census-'));
  fs.chmodSync(temp, 0o700);
  try {
    const sodium = require('sodium-native');
    const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
    const key = crypto.randomBytes(32);
    const tokenA = 'c539c37e-09d8-49b6-928b-706f25c70852';
    const tokenB = 'd8b5ad5a-7e05-4d70-878d-61e937d60439';
    const values = [{ payload: { idempotencyKey: tokenA } },
      { body: JSON.stringify({ idempotencyKey: tokenB }) },
      { body: `historical mirror ${tokenA} ${tokenB} ${tokenB}` },
      { operation_id: '92f716c7-43e3-423e-9e3b-c9b063f03ecd', safe: 'unchanged' },
      { nested: [{ idempotencyKey: tokenA }] }];
    const rows = values.map((value, index) => {
      const row = { table: 'harness_plans', hbKey: `row-${index}`, author_pubkey: index === 0 ? '' : 'synthetic-public-author',
        ts: 100 + index, epoch: 0, segment: 'segment-000001.blob', line: index + 1 };
      if (index === 4) { delete row.epoch; return { ...row, value }; }
      const opId = hash(JSON.stringify([row.table, row.hbKey, row.author_pubkey]));
      const aad = Buffer.concat(['fixture-pot', '0', opId].flatMap(part => {
        const bytes = Buffer.from(part); const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
        return [length, bytes];
      }));
      const nonce = crypto.randomBytes(24); const plain = Buffer.from(JSON.stringify(value));
      const ciphertext = Buffer.alloc(plain.length + 16);
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, plain, aad, null, nonce, key);
      return { ...row, value: { __rekey: Buffer.concat([nonce, ciphertext]).toString('base64') } };
    });
    const write = (name, content) => {
      const file = path.join(temp, name); fs.writeFileSync(file, content, { mode: 0o600 }); return file;
    };
    const rowsPath = write('original.jsonl', rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    const keysPath = write('epoch-keys.json', JSON.stringify({ 'fixture-pot': { 0: key.toString('base64') } }));
    const source = { sourceKeyHex: 'a'.repeat(64), sourceLength: 5, rowCount: 5, rowsPath, rowsSha256: hash(fs.readFileSync(rowsPath)) };
    const configPath = write('config.json', JSON.stringify({ reviewRef: 'p2p-public-release-endgame-2026-09-01#D-166',
      potId: 'fixture-pot', epochKeysPath: keysPath, epochKeysSha256: hash(fs.readFileSync(keysPath)), sources: [source] }));
    write('output.jsonl', JSON.stringify(rows[3]) + '\n');
    const program = String.raw`
import importlib.util,json,sys,pathlib,copy
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);config=base/'config.json';original_bytes=(base/'original.jsonl').read_bytes()
plan=m.assemble_uuid_idempotency_drop_plans(config)
assert plan['counts']=={'originalRows':5,'originalAuthenticated':4,'originalPlaintext':1,'droppedRows':4,'droppedAuthenticated':3,'privacyDroppedRows':0,'privacyDroppedAuthenticated':0,'privacyRedactedPlaintext':0,'authenticatedOriginalRetained':1,'redactedReattested':0,'occurrenceCount':6}
assert len(plan['plans'])==1 and len(plan['plans'][0]['rows'])==4
source=json.loads(config.read_text())['sources'][0]
output={**source,'rowCount':1,'rowsPath':str(base/'output.jsonl'),'rowsSha256':m._sha256(base/'output.jsonl')}
p=plan['plans'][0]
reports=[{'schema':'papercusp-uuid-idempotency-redaction-manifest-v1','reviewRef':p['reviewRef'],'replacement':m._UUID_MARKER,'authenticationDisposition':'dropped','ciphertextAuthentication':'requires-independent-candidate-validation','droppedRows':4,'occurrenceCount':6,'occurrences':[o for r in p['rows'] for o in r['occurrences']]}]
manifest=base/'manifest.json';manifest.write_text(json.dumps({'stores':[{'meta':{'uuidIdempotencyRedactions':reports}}]}))
valid=lambda p=plan,o=[output],r=reports,files=[manifest]:m.validate_uuid_idempotency_row_drops(config,p,o,r,files)
result=valid();assert result['rawClassHits']==0
def refused(fn):
 try:fn();raise AssertionError('invalid UUID proof passed')
 except (ValueError,KeyError):pass
bad=copy.deepcopy(plan);bad['counts']['droppedRows']=0;refused(lambda:valid(p=bad))
bad=copy.deepcopy(plan);bad['plans'][0]['rows'][0]['valueSha256']='0'*64;refused(lambda:valid(p=bad))
bad=copy.deepcopy(reports);bad[0]['authenticationDisposition']='authenticated-original';refused(lambda:valid(r=bad))
bad=copy.deepcopy(reports);bad[0]['occurrences'].pop();refused(lambda:valid(r=bad))
refused(lambda:valid(o=[]));refused(lambda:valid(o=[output,output]));refused(lambda:valid(files=[]))
originals=[json.loads(t) for t in original_bytes.decode().splitlines()]
out=base/'output.jsonl'
for changed in [originals,[],[{**originals[3],'ts':999}],[{**originals[3],'author_pubkey':'changed'}],[{**originals[3],'value':{'safe':'changed'}}]]:
 out.write_text(''.join(json.dumps(row)+'\n' for row in changed));o={**output,'rowCount':len(changed),'rowsSha256':m._sha256(out)};refused(lambda:valid(o=[o]))
out.write_text(json.dumps(originals[3])+'\n');output['rowsSha256']=m._sha256(out)
doc=base/'doc.txt';doc.write_text('idempotencyKey: <redacted:idempotency-key>');valid(files=[manifest,doc])
token=m._uuid_open_row(originals[0],'fixture-pot',json.loads((base/'epoch-keys.json').read_text())['fixture-pot'])[0]['payload']['idempotencyKey']
new_token='14be300d-'+'6014-47a7-bb41-62c5b782971d'
for content in [token,'idempotencyKey: '+new_token,'x'*(1024*1024-18)+token,
                'idempotencyKey:'+(' '*(1024*1024))+new_token]:
 doc.write_text(content);refused(lambda:valid(files=[manifest,doc]))
encoded=base/'encoded.json';encoded.write_text('{"idempotencyKey":"\\u0063'+token[1:]+'"}');refused(lambda:valid(files=[manifest,encoded]))
assert m._uuid_occurrences(token,{token})==[['<value>']]
sourcefile=base/'original.jsonl';cfg=json.loads(config.read_text())
def assemble_changed(rows):
 sourcefile.write_text(''.join(json.dumps(row)+'\n' for row in rows));cfg['sources'][0]['rowsSha256']=m._sha256(sourcefile);config.write_text(json.dumps(cfg));m.assemble_uuid_idempotency_drop_plans(config)
for changed in [[{**originals[0],'author_pubkey':'changed'},*originals[1:]], [{**originals[0],'hbKey':'changed'},*originals[1:]],originals[:-1],[originals[0],*originals[:-1]]]:refused(lambda:assemble_changed(changed))
sourcefile.write_bytes(original_bytes);cfg['sources'][0]['rowsSha256']=m._sha256(sourcefile);config.write_text(json.dumps(cfg));assert m.assemble_uuid_idempotency_drop_plans(config)['counts']==plan['counts']
header_row={'table':'harness_plans','hbKey':token,'value':{'public':'retained otherwise'},'segment':'segment-000001.blob','line':6}
header_cfg=copy.deepcopy(cfg);header_cfg['sources'][0]['rowCount']=6;header_cfg['sources'][0]['sourceLength']=6
sourcefile.write_text(original_bytes.decode()+json.dumps(header_row)+'\n');header_cfg['sources'][0]['rowsSha256']=m._sha256(sourcefile);config.write_text(json.dumps(header_cfg))
header_plan=m.assemble_uuid_idempotency_drop_plans(config);assert header_plan['counts']['droppedRows']==5 and header_plan['counts']['occurrenceCount']==7
assert header_plan['plans'][0]['rows'][-1]['occurrences'][0]['fieldPath']==['<row-header>','hbKey']
sourcefile.write_bytes(original_bytes);config.write_text(json.dumps(cfg))
assert sourcefile.read_bytes()==original_bytes
print(json.dumps({'counts':result['counts'],'failClosed':True,'privateHashes':[r['valueSha256'] for r in p['rows']]}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.deepEqual(proof.privateHashes, [0, 1, 2, 4].map(index => hash(JSON.stringify(rows[index].value))));
    assert.equal(proof.counts.occurrenceCount, 6);
    assert.ok(proof.failClosed);
    assert.ok(!(result.stdout + result.stderr).includes(tokenA));
    assert.ok(!(result.stdout + result.stderr).includes(tokenB));
    const planOutput = path.join(temp, 'plan-set.json');
    const assembled = spawnSync('python3', [reportFormatterPath, '--assemble-uuid-row-drops', configPath, planOutput], { encoding: 'utf8' });
    assert.equal(assembled.status, 0, assembled.stderr);
    assert.equal(JSON.parse(assembled.stdout).counts.droppedRows, 4);
    assert.equal(fs.statSync(planOutput).mode & 0o077, 0);
    const repeated = spawnSync('python3', [reportFormatterPath, '--assemble-uuid-row-drops', configPath, planOutput], { encoding: 'utf8' });
    assert.equal(repeated.status, 2, 'assembler must not overwrite prior evidence');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

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

test('D-150 source-name exclusions require exact frozen bytes and refuse private serialization or matching seeds', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-source-name-proof-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,base64
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);source=base/'keychain.ts';data=b'export const service="public-keystore-name";\n';source.write_bytes(data)
public,_=m._key_publics(m._sodium(),bytes(range(32)))
entry={'path':str(source),'sha256':m._sha256(source),'class':'frozen-public-source-vocabulary','sourceRef':{'tree':'superproject','path':'src/keychain.ts','blob':'b'*40}}
with patch.object(m,'_frozen_source_bytes',return_value=data):
 scan=m.scan_identity_secret_inputs([source],{public},[source],name_exclusions=[entry])
 assert scan['nameScanHits']==0 and scan['realFindings']==0
 assert scan['nameExclusionCounts']=={entry['sha256']:1}
for changed in [{**entry,'sha256':'0'*64},{**entry,'path':str(base/'missing.pem')},{**entry,'class':'public-fixture'}]:
 try:m.validate_identity_name_exclusions([changed],{source},{public},set(),{});raise AssertionError('invalid source proof passed')
 except ValueError:pass
with patch.object(m,'_frozen_source_bytes',return_value=b'changed frozen bytes'):
 try:m.validate_identity_name_exclusions([entry],{source},{public},set(),{});raise AssertionError('changed source passed')
 except ValueError:pass
for private in [m._ED25519_DER_PREFIX+bytes(range(32)),bytes(range(32)),bytes(range(32)).hex().encode()]:
 source.write_bytes(private);changed={**entry,'sha256':m._sha256(source)}
 with patch.object(m,'_frozen_source_bytes',return_value=private):
  try:m.validate_identity_name_exclusions([changed],{source},{public},set(),{});raise AssertionError('private source bytes passed')
  except ValueError:pass
source.write_bytes(data)
with patch.object(m,'_frozen_source_bytes',return_value=data):
 try:m.validate_identity_name_exclusions([entry,entry],{source},{public},set(),{});raise AssertionError('duplicate exclusion passed')
 except ValueError:pass
print(json.dumps({'sourcePositive':True,'negativeControls':7}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { sourcePositive: true, negativeControls: 7 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-150 public certificate exclusions parse each certificate and reject labels, changed provenance and private keys of another algorithm', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-certificate-name-proof-'));
  try {
    const cert = path.join(temp, 'certificate.pem');
    const privateKey = path.join(temp, 'private.pem');
    const generated = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', privateKey, '-out', cert, '-days', '1', '-subj', '/CN=Release Proof Fixture'], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,tarfile,io,base64
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);cert=base/'certificate.pem';data=cert.read_bytes();certs=m._parsed_public_certificates(data)
entry={'path':str(cert),'sha256':m._sha256(cert),'class':'parsed-public-x509-certificate','certificates':certs,'sourceRef':{}}
with patch.object(m,'_frozen_source_bytes',return_value=data):
 scan=m.scan_identity_secret_inputs([cert],set(),[cert],name_exclusions=[entry])
 assert scan['nameScanHits']==0 and scan['realFindings']==0
 for changed in [{**entry,'certificates':[{'sha256':'0'*64,'subject':certs[0]['subject']}]},{**entry,'certificates':[]}]:
  try:m.validate_identity_name_exclusions([changed],{cert},set(),set(),{});raise AssertionError('changed certificate identity passed')
  except ValueError:pass
with patch.object(m,'_frozen_source_bytes',return_value=b'other certificate'):
 try:m.validate_identity_name_exclusions([entry],{cert},set(),set(),{});raise AssertionError('changed certificate provenance passed')
 except ValueError:pass
package=base/'node_modules/cert-fixture';package.mkdir(parents=True)
(package/'package.json').write_text(json.dumps({'name':'cert-fixture','version':'1.0.0'}))
vendor_cert=package/'certificate.pem';vendor_cert.write_bytes(data)
archive=base/'package.tgz'
with tarfile.open(archive,'w:gz') as out:
 metadata=(package/'package.json').read_bytes();row=tarfile.TarInfo('package/package.json');row.size=len(metadata);out.addfile(row,io.BytesIO(metadata))
 member=tarfile.TarInfo('package/certificate.pem');member.size=len(data);out.addfile(member,io.BytesIO(data))
integrity='sha512-'+base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
lock=json.dumps({'packages':{'node_modules/cert-fixture':{'version':'1.0.0','resolved':'https://registry.npmjs.org/cert-fixture/-/cert-fixture-1.0.0.tgz','integrity':integrity}}}).encode()
ref={'lockRef':{'tree':'superproject','path':'package-lock.json'},'name':'cert-fixture','packagePath':'node_modules/cert-fixture','version':'1.0.0','integrity':integrity,'archive':str(archive),'member':'package/certificate.pem'}
vendored={k:v for k,v in entry.items() if k!='sourceRef'};vendored['packageRef']=ref;vendored['path']=str(vendor_cert)
with patch.object(m,'_frozen_source_bytes',return_value=lock):
 m.validate_identity_name_exclusions([vendored],{vendor_cert},set(),set(),{})
 for changed in [{**ref,'version':'2.0.0'},{**ref,'integrity':'sha512-'+base64.b64encode(bytes(64)).decode()}]:
  try:m.validate_identity_name_exclusions([{**vendored,'packageRef':changed}],{vendor_cert},set(),set(),{});raise AssertionError('changed package passed')
  except ValueError:pass
for invalid in [b'-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----',data+(base/'private.pem').read_bytes()]:
 cert.write_bytes(invalid);changed={**entry,'sha256':m._sha256(cert)}
 with patch.object(m,'_frozen_source_bytes',return_value=invalid):
  try:m.validate_identity_name_exclusions([changed],{cert},set(),set(),{});raise AssertionError('private/malformed certificate passed')
  except ValueError:pass
print(json.dumps({'certificatePositive':True,'packagePositive':True,'negativeControls':7}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { certificatePositive: true, packagePositive: true, negativeControls: 7 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-142 detector recognizes X25519 PKCS8 in raw, hex and base64 encodings', () => {
  const crypto = require('node:crypto');
  const der = crypto.generateKeyPairSync('x25519').privateKey.export({ type: 'pkcs8', format: 'der' });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-x25519-control-'));
  try {
    const program = 'import importlib.util,json,sys\ns=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.scan_secret_key_bytes(open(sys.argv[2],"rb").read(),set())))';
    for (const data of [der, Buffer.from(der.toString('hex')), Buffer.from(der.toString('base64'))]) {
      const input = path.join(temp, 'input'); fs.writeFileSync(input, data);
      const result = spawnSync('python3', ['-c', program, reportFormatterPath, input], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(JSON.parse(result.stdout).realFindings > 0);
      assert.ok(!(result.stdout + result.stderr).includes(der.toString('hex')));
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-151 vendored vocabulary binds the exact bundled package identity, file and frozen sha512 lock entry', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-vendor-source-proof-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,tarfile,io,base64
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);pkg=base/'node_modules/source-fixture';pkg.mkdir(parents=True)
data=b'export const keyStoreName="public-vocabulary";\n';source=pkg/'KeyStore.js';source.write_bytes(data)
package={'name':'source-fixture','version':'1.0.0'};(pkg/'package.json').write_text(json.dumps(package))
archive=base/'package.tgz'
with tarfile.open(archive,'w:gz') as out:
 metadata=json.dumps(package).encode();row=tarfile.TarInfo('package/package.json');row.size=len(metadata);out.addfile(row,io.BytesIO(metadata))
 row=tarfile.TarInfo('package/KeyStore.js');row.size=len(data);out.addfile(row,io.BytesIO(data))
integrity='sha512-'+base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
lock=json.dumps({'packages':{'node_modules/source-fixture':{'version':'1.0.0','resolved':'https://registry.npmjs.org/source-fixture/-/source-fixture-1.0.0.tgz','integrity':integrity}}}).encode()
ref={'lockRef':{'tree':'superproject','path':'package-lock.json'},'name':'source-fixture','packagePath':'node_modules/source-fixture','version':'1.0.0','integrity':integrity,'archive':str(archive),'member':'package/KeyStore.js'}
entry={'path':str(source),'sha256':m._sha256(source),'class':'frozen-public-source-vocabulary','packageRef':ref}
with patch.object(m,'_frozen_source_bytes',return_value=lock):
 assert m.validate_identity_name_exclusions([entry],{source},set(),set(),{})=={entry['sha256']:1}
 for changed in [{**ref,'version':'2.0.0'},{**ref,'member':'package/Other.js'},{**ref,'integrity':'sha512-'+base64.b64encode(bytes(64)).decode()}]:
  try:m.validate_identity_name_exclusions([{**entry,'packageRef':changed}],{source},set(),set(),{});raise AssertionError('changed package witness passed')
  except ValueError:pass
 (pkg/'package.json').write_text(json.dumps({**package,'name':'other'}))
 try:m.validate_identity_name_exclusions([entry],{source},set(),set(),{});raise AssertionError('wrong bundled identity passed')
 except ValueError:pass
 (pkg/'package.json').write_text(json.dumps(package));source.write_bytes(b'changed source')
 try:m.validate_identity_name_exclusions([{**entry,'sha256':m._sha256(source)}],{source},set(),set(),{});raise AssertionError('changed bundled bytes passed')
 except ValueError:pass
print(json.dumps({'positive':True,'negativeControls':5}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { positive: true, negativeControls: 5 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-164 vendored provenance accepts the SSH2 archive root and refuses ambiguous identity, paths and fixtures', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-vendor-archive-root-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,tarfile,io,base64
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);pkg=base/'node_modules/ssh2';pkg.mkdir(parents=True)
identity={'name':'ssh2','version':'1.17.0'};(pkg/'package.json').write_text(json.dumps(identity))
relative='test/fixtures/https_cert.pem';bundled=pkg/relative;bundled.parent.mkdir(parents=True);data=b'public certificate member';bundled.write_bytes(data)
def packet(prefix='mscdex-ssh2-5c506eb',extra=(),metadata=None,include_metadata=True):
 archive=base/'package.tgz';rows=[]
 if include_metadata:rows.append((prefix+'/package.json',json.dumps(identity if metadata is None else metadata).encode(),tarfile.REGTYPE))
 rows.append((prefix+'/'+relative,data,tarfile.REGTYPE));rows.extend(extra)
 with tarfile.open(archive,'w:gz') as out:
  for name,content,kind in rows:
   row=tarfile.TarInfo(name);row.type=kind;row.size=len(content) if kind==tarfile.REGTYPE else 0;out.addfile(row,io.BytesIO(content) if row.isfile() else None)
 integrity='sha512-'+base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
 locked={'version':'1.17.0','resolved':'https://registry.npmjs.org/ssh2/-/ssh2-1.17.0.tgz','integrity':integrity}
 ref={'lockRef':{'tree':'superproject','path':'package-lock.json'},'name':'ssh2','packagePath':'node_modules/ssh2','version':'1.17.0','integrity':integrity,'archive':str(archive),'member':prefix+'/'+relative}
 return ref,locked
def read(ref,locked,path=bundled):
 with patch.object(m,'_frozen_source_bytes',return_value=json.dumps({'packages':{'node_modules/ssh2':locked}}).encode()):return m._vendored_package_bytes(ref,{},path)
def refused(ref,locked,path=bundled):
 try:read(ref,locked,path);raise AssertionError('invalid archive provenance passed')
 except ValueError:pass
for prefix in ['package','mscdex-ssh2-5c506eb']:
 ref,locked=packet(prefix);assert read(ref,locked)==data
for metadata in [{'name':'other','version':'1.17.0'},{'name':'ssh2','version':'2.0.0'}]:
 ref,locked=packet(metadata=metadata);refused(ref,locked)
ref,locked=packet(include_metadata=False);refused(ref,locked)
for extra in [[('other/package.json',json.dumps(identity).encode(),tarfile.REGTYPE)],[('mscdex-ssh2-5c506eb/package.json',json.dumps(identity).encode(),tarfile.REGTYPE)],[('mscdex-ssh2-5c506eb/'+relative,data,tarfile.REGTYPE)]]:
 ref,locked=packet(extra=extra);refused(ref,locked)
ref,locked=packet()
for member in ['/mscdex-ssh2-5c506eb/'+relative,'mscdex-ssh2-5c506eb/../'+relative,'mscdex-ssh2-5c506eb//'+relative,'mscdex-ssh2-5c506eb/./'+relative,'other/'+relative,'mscdex-ssh2-5c506eb/']:
 refused({**ref,'member':member},locked)
for resolved in [None,'https://example.invalid/ssh2.tgz','http://registry.npmjs.org/ssh2/-/ssh2-1.17.0.tgz','https://registry.npmjs.org/ssh2/-/ssh2-1.16.0.tgz']:
 refused(ref,{**locked,'resolved':resolved})
for fixture in ['test/fixtures/https_key.pem','test/fixtures/keyParser/public.pub','test/fixtures/unknown.pem']:
 ref,locked=packet(extra=[('mscdex-ssh2-5c506eb/'+fixture,data,tarfile.REGTYPE)]);path=pkg/fixture;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data);refused({**ref,'member':'mscdex-ssh2-5c506eb/'+fixture},locked,path)
for kind in [tarfile.SYMTYPE,tarfile.LNKTYPE]:
 ref,locked=packet(extra=[('mscdex-ssh2-5c506eb/'+relative,b'',kind)]);refused(ref,locked)
print(json.dumps({'packageRoot':True,'ssh2Root':True,'failClosed':True}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { packageRoot: true, ssh2Root: true, failClosed: true });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-151 OS certificate provenance requires apt SHA256 and exact dpkg package member, not md5sums', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-os-cert-proof-'));
  try {
    const pkg = path.join(temp, 'deb');
    fs.mkdirSync(path.join(pkg, 'DEBIAN'), { recursive: true });
    fs.mkdirSync(path.join(pkg, 'usr/share/cert-fixture'), { recursive: true });
    fs.writeFileSync(path.join(pkg, 'DEBIAN/control'),
      'Package: proof-certificate\nVersion: 1.0\nArchitecture: all\nMaintainer: Fixture <test@example.invalid>\nDescription: certificate provenance fixture\n');
    fs.writeFileSync(path.join(pkg, 'usr/share/cert-fixture/cert.pem'), 'synthetic certificate member\n');
    const built = spawnSync('dpkg-deb', ['-b', pkg, path.join(temp, 'package.deb')], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);archive=base/'package.deb';index=base/'Packages';data=(base/'deb/usr/share/cert-fixture/cert.pem').read_bytes()
index.write_text('Package: proof-certificate\nVersion: 1.0\nSHA256: '+m._sha256(archive)+'\n\n')
ref={'name':'proof-certificate','version':'1.0','archive':str(archive),'archiveSha256':m._sha256(archive),'index':str(index),'indexSha256':m._sha256(index),'member':'./usr/share/cert-fixture/cert.pem'}
bundled=base/'runtime/usr/share/cert-fixture/cert.pem'
assert m._dpkg_certificate_bytes(ref,bundled)==data
for changed in [{**ref,'version':'2.0'},{**ref,'archiveSha256':'0'*64},{**ref,'member':'./usr/share/other.pem'}]:
 try:m._dpkg_certificate_bytes(changed,bundled);raise AssertionError('changed OS proof passed')
 except ValueError:pass
index.write_text('Package: proof-certificate\nVersion: 1.0\nMD5sum: irrelevant\n\n')
try:m._dpkg_certificate_bytes({**ref,'indexSha256':m._sha256(index)},bundled);raise AssertionError('md5sums-only passed')
except ValueError:pass
print(json.dumps({'positive':True,'negativeControls':4}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { positive: true, negativeControls: 4 });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-147 secret proof collector and validator bind complete seed, plaintext and assembled inputs', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-secret-proof-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);base.chmod(0o700);seed=base/'seed';bundle=base/'bundle';seed.mkdir();bundle.mkdir()
(seed/'manifest.json').write_text('{}');(bundle/'serve.mjs').write_text('const publicValue=42;')
plain=base/'plain.jsonl';digest='a'*64;plain.write_text(json.dumps({'credentialSha256':digest})+'\n')
recipients=[m._key_publics(m._sodium(),bytes([i])*32)[0] for i in range(33)]
import base64
config={'bundleRoots':[str(bundle)],'plaintextInputs':[str(plain)],'controlSamples':[str(plain),str(bundle/'serve.mjs')],'recipients':[base64.b64encode(p).decode() for p in recipients],'credentialDigests':[digest]}
cfg=base/'config.json';cfg.write_text(json.dumps(config));cfg.chmod(0o600)
scan=m.scan_identity_proof(cfg,seed,base/'scan.json')
ref={'bundleRoots':[str(bundle)],'plaintextInputs':['plain.jsonl']}
m.validate_identity_secret_proof(scan,seed,base,set(recipients),ref)
assert scan['credentialDigestScan']['digests']==[digest]
for changed in [{**scan['credentialDigestScan'],'rawCredentialHits':1},{**scan['credentialDigestScan'],'digestOfCredentialHits':1},{**scan['credentialDigestScan'],'hashControlDetected':False},{**scan['credentialDigestScan'],'rawControlDetected':False}]:
 try:m.validate_identity_secret_proof({**scan,'credentialDigestScan':changed},seed,base,set(recipients),ref);raise AssertionError('credential exposure proof passed')
 except ValueError:pass
for changed in [{**scan,'inputs':scan['inputs'][:-1]},{**scan,'scannerSha256':'0'*64},{**scan,'recipientSetSha256':'0'*64},{**scan,'controls':[]},{**scan,'realFindings':1}]:
 try: m.validate_identity_secret_proof(changed,seed,base,set(recipients),ref);raise AssertionError('incomplete secret proof passed')
 except ValueError: pass
(bundle/'serve.mjs').write_text('Authorization: Bearer '+digest)
exposed=m.scan_identity_proof(cfg,seed,base/'exposed.json')
assert exposed['credentialDigestScan']['rawCredentialHits']>0
import subprocess
cli=subprocess.run([sys.executable,sys.argv[1],'--scan-identity-proof',str(cfg),str(seed),str(base/'cli-exposed.json')],capture_output=True,text=True)
assert cli.returncode==1 and json.loads(cli.stdout)['rawCredentialHits']>0 and digest not in cli.stdout
try:m.validate_identity_secret_proof(exposed,seed,base,set(recipients),ref);raise AssertionError('raw digest bearer passed')
except ValueError:pass
try: m.validate_identity_secret_proof(scan,seed,base,set(recipients),ref);raise AssertionError('changed bundle passed')
except ValueError: pass
print(json.dumps({'inputs':len(scan['inputs']),'controls':len(scan['controls']),'complete':True}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).complete, true);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-142 secret inventory hashes symlink contents without following host targets and rejects link changes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-secret-links-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,base64,hashlib,os
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);base.chmod(0o700);seed=base/'seed';bundle=base/'bundle';seed.mkdir();bundle.mkdir()
(seed/'manifest.json').write_text('{}');(bundle/'serve.mjs').write_text('const publicValue=42;')
plain=base/'plain.jsonl';plain.write_text('{}\n')
recipients=[m._key_publics(m._sodium(),bytes([i])*32)[0] for i in range(33)]
outside=base/'outside';outside.write_bytes(m._ED25519_DER_PREFIX+bytes(range(32)))
link=bundle/'command';link.symlink_to('serve.mjs')
(bundle/'dangling').symlink_to('not-present')
(bundle/'host-reference').symlink_to(outside)
(bundle/'directory-link').symlink_to('nested',target_is_directory=True)
(bundle/'nested').mkdir();(bundle/'nested'/'public.txt').write_text('public')
config={'bundleRoots':[str(bundle)],'plaintextInputs':[str(plain)],'controlSamples':[str(plain),str(bundle/'serve.mjs')],'recipients':[base64.b64encode(p).decode() for p in recipients]}
cfg=base/'config.json';cfg.write_text(json.dumps(config));cfg.chmod(0o600)
scan=m.scan_identity_proof(cfg,seed,base/'scan.json')
ref={'bundleRoots':[str(bundle)],'plaintextInputs':['plain.jsonl']}
m.validate_identity_secret_proof(scan,seed,base,set(recipients),ref)
assert scan['realFindings']==0 and scan['derivationMatches']==0
links=[r for r in scan['inputs'] if r.get('contentKind')=='symlink-target']
assert len(links)==4 and len({r['path'] for r in scan['inputs']})==len(scan['inputs'])
assert next(r for r in links if r['path']==str(link))['sha256']==hashlib.sha256(b'serve.mjs').hexdigest()
try: m.validate_identity_secret_proof({**scan,'inputs':[r for r in scan['inputs'] if r['path']!=str(link)]},seed,base,set(recipients),ref);raise AssertionError('omitted link passed')
except ValueError: pass
link.unlink();link.symlink_to('changed-target')
try: m.validate_identity_secret_proof(scan,seed,base,set(recipients),ref);raise AssertionError('changed link passed')
except ValueError: pass
link.unlink();link.write_text('changed-target')
try: m.validate_identity_secret_proof(scan,seed,base,set(recipients),ref);raise AssertionError('changed link kind passed')
except ValueError: pass
link.unlink();link.symlink_to((bytes([0])*32).hex())
detected=m.scan_identity_secret_inputs([link,plain],set(recipients),[plain])
assert detected['derivationMatches']>0 and detected['realFindings']>0
print(json.dumps({'linksChecked':len(links),'complete':True,'linkSecretDetected':True}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { linksChecked: 4, complete: true, linkSecretDetected: true });
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
  const forbidden = ['fixture-forbidden-', 'literal-independent-of-scanner'].join('');
  write('forbidden-literals.private.json', [{ literal: forbidden,
    sha256: crypto.createHash('sha256').update(forbidden).digest('hex') }]);
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

test('D-148 literal guard refuses scanner-invisible residue and incomplete identities', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-literal-guard-'));
  try {
    const value = ['fixture-hidden-', 'credential'].join('');
    const input = path.join(temp, 'plaintext.jsonl');
    const crypto = require('node:crypto');
    const digest = crypto.createHash('sha256').update(value).digest('hex');
    const program = 'import importlib.util,json,pathlib,sys\ns=importlib.util.spec_from_file_location("f",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nprint(json.dumps(m.verify_literal_absence([pathlib.Path(sys.argv[2])],json.loads(sys.argv[3]),set(json.loads(sys.argv[4])))))';
    const run = (entries = [{ literal: value, sha256: digest }], required = [digest]) =>
      spawnSync('python3', ['-c', program, reportFormatterPath, input,
        JSON.stringify(entries), JSON.stringify(required)], { encoding: 'utf8' });
    fs.writeFileSync(input, JSON.stringify({ body: 'review text' }));
    assert.equal(run().status, 0);
    // No scanner report contains this value: the raw-byte check must still refuse it.
    fs.writeFileSync(input, JSON.stringify({ body: value }));
    assert.notEqual(run().status, 0);
    // Exercise a literal crossing the chunk boundary as well.
    fs.writeFileSync(input, 'x'.repeat(1024 * 1024 - 4) + value);
    assert.notEqual(run().status, 0);
    fs.writeFileSync(input, '{}');
    assert.notEqual(run([{ literal: value, sha256: '0'.repeat(64) }]).status, 0);
    assert.notEqual(run([], []).status, 0);
    assert.notEqual(run(undefined, ['f'.repeat(64)]).status, 0);
    assert.ok(!(run().stdout + run().stderr).includes(value));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-148 exact proof refuses literal residue even with matching report and evidence hashes', () => {
  const f = seedProofFixture();
  try {
    const crypto = require('node:crypto');
    const plain = path.join(f.evidence, 'seed-000080.plaintext.jsonl');
    const rows = fs.readFileSync(plain, 'utf8');
    const literal = JSON.parse(fs.readFileSync(path.join(f.evidence, 'forbidden-literals.private.json')))[0].literal;
    fs.appendFileSync(plain, JSON.stringify({ body: literal }) + '\n');
    const update = name => JSON.parse(fs.readFileSync(path.join(f.evidence, name)));
    const meta = update('seed-000080.plaintext.private.meta.json');
    meta.identity.blobSha256 = f.hash(plain); f.write('seed-000080.plaintext.private.meta.json', meta);
    const summary = update('plaintext-classification-safe.json');
    summary.plaintextSha256 = f.hash(plain); f.write('plaintext-classification-safe.json', summary);
    const seedSummary = update('seed-classification-verified-safe.json');
    seedSummary.plaintextProofSha256 = f.hash(path.join(f.evidence, 'plaintext-classification-safe.json'));
    f.write('seed-classification-verified-safe.json', seedSummary);
    const proof = update('seed-finding-proof.json');
    for (const name of Object.keys(proof.evidence)) proof.evidence[name] = f.hash(path.join(f.evidence, name));
    f.write('seed-finding-proof.json', proof);
    assert.equal(f.filter().status, 2);
    // The refusal is semantic, even after all changed input hashes are resealed.
    assert.ok(rows.length > 0);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
});

test('D-147 mechanical class predicates require exact public values and refuse credentials', () => {
  const program = String.raw`
import importlib.util,json,sys,base64,hashlib,subprocess
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
public,_=m._key_publics(m._sodium(),bytes(range(32)));pk=base64.b64encode(public).decode()
identifier='abcdefgh-0000-'+'1234567890abcdef'*2;digest='a'*64;gitid='b'*40
ctx={'seedFields':{('hbKey','engineer-issues::WI-42')},'publicKeys':{public},'plainRows':{},'idFields':{'id'},'publicReferences':{digest},'trees':{'superproject':{'sha':m._FROZEN_TREES['superproject'],'path':'/fixture'}}}
def case(kind,value,field='id',seed=False,**extra):
 finding={'RuleID':'generic-api-key','Secret':value,'Match':field+'":"'+value+'"','StartLine':1}
 entry={'class':kind,'rule':finding['RuleID'],'digest':m.finding_digest(finding),'fieldPath':[field],**extra}
 ctx['plainRows'][1]={field:value};return entry,finding
results=[]
for kind in ['public-condition-reference','public-opaque-operation-reference','public-schema-bound-reference']:
 e,f=case(kind,identifier);assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(kind)
e,f=case('public-hash-or-log-reference',digest);assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(e['class'])
e,f=case('public-cryptographic-key',pk,'bkey');assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(e['class'])
e,f=case('reviewed-descriptive-source-text','tag-set','body');ctx['plainRows'][1]['body']=f['Match'];assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(e['class'])
e,f=case('public-projection-row-key','engineer-issues::WI-42','hbKey',seed=True);assert m.mechanical_class_valid(e,f,ctx,seed=True);results.append(e['class'])
e,f=case('public-hypercore-log-key',public.hex(),seed=True);assert m.mechanical_class_valid(e,f,ctx,seed=True);results.append(e['class'])
def git(args,**kwargs):
 if args[-2:] == ['rev-parse','HEAD']: out=(m._FROZEN_TREES['superproject']+'\n').encode()
 elif 'rev-parse' in args: out=(gitid+'\n').encode()
 else: out=b'id":"public-fixture"'
 return subprocess.CompletedProcess(args,0,out)
with patch.object(m.subprocess,'run',side_effect=git) as calls:
 e,f=case('public-git-object-reference',gitid,sourceRef={'tree':'superproject'});assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(e['class'])
 e,f=case('reviewed-public-source-literal','public-fixture',sourceRef={'tree':'superproject','path':'src/example.ts','blob':gitid});assert m.mechanical_class_valid(e,f,ctx,seed=False);results.append(e['class'])
 assert calls.call_count >= 5
 e['sourceRef']['blob']='c'*40;assert not m.mechanical_class_valid(e,f,ctx,seed=False)
for field in ['apiKey','key','keys','token','idempotencyKey','watchdogKey','conditionKey','credentialSha256']:
 e,f=case('public-opaque-operation-reference',identifier,field);assert not m.mechanical_class_valid(e,f,ctx,seed=False)
e,f=case('public-condition-reference','rawcredential');assert not m.mechanical_class_valid(e,f,ctx,seed=False)
e,f=case('public-hash-or-log-reference','c'*64);assert not m.mechanical_class_valid(e,f,ctx,seed=False)
e,f=case('public-cryptographic-key',base64.b64encode(bytes(64)).decode(),'bkey')
try: m.mechanical_class_valid(e,f,ctx,seed=False);raise AssertionError('64-byte key passed')
except ValueError: pass
e,f=case('public-projection-row-key','engineer-issues::WI-42','password',seed=True);assert not m.mechanical_class_valid(e,f,ctx,seed=True)
e,f=case('reviewed-descriptive-source-text','public-text','body');f['RuleID']='curl-auth-user';e['rule']=f['RuleID'];e['digest']=m.finding_digest(f);assert not m.mechanical_class_valid(e,f,ctx,seed=False)
e,f=case('public-condition-reference',identifier);f['Secret']='changed';assert not m.mechanical_class_valid(e,f,ctx,seed=False)
print(json.dumps({'positiveClasses':results,'negativeControls':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).positiveClasses.length, 10);
  assert.equal(JSON.parse(result.stdout).negativeControls, true);
});

test('D-147 envelope predicate rederives all 62 findings and the historical 33 recipients', () => {
  const program = String.raw`
import importlib.util,json,sys,base64,hashlib
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
recipients=[base64.b64encode(m._key_publics(m._sodium(),bytes([i])*32)[0]).decode() for i in range(33)]
ops=[{'table':'hive-members','hbKey':'member','value':{'device_attestations':[{'device_pubkey':p} for p in recipients]}}];report=[]
for i in range(62):
 value=base64.b64encode(bytes([i])*80).decode();p=recipients[i%33];epoch=i%2
 ops.append({'table':'hive-epoch-keys','hbKey':str(epoch)+':'+p,'value':{'harness_slug':'papercusp','epoch':epoch,'member_device_pubkey':p,'wrapped_key':value}})
 report.append({'RuleID':'generic-api-key','Match':'wrapped_key":"'+value+'"','Secret':value})
source=b'\n'.join(json.dumps(op,separators=(',',':')).encode() for op in ops)
proof={'count':62,'digests':[m.finding_digest(f) for f in report],'recipients':recipients,'sourceSha256':hashlib.sha256(source).hexdigest()}
digests=m.validate_envelope_structure(proof,source,report,{0,1});assert len(digests)==62
entry={'class':'recipient-sealed-epoch-key-envelope','rule':report[0]['RuleID'],'digest':m.finding_digest(report[0])}
assert m.mechanical_class_valid(entry,report[0],{'seedFields':set(),'envelopeDigests':digests},seed=True)
for changed in [{**proof,'count':61},{**proof,'digests':proof['digests'][:-1]},{**proof,'recipients':recipients[:-1]}]:
 try: m.validate_envelope_structure(changed,source,report,{0,1});raise AssertionError('bad envelope proof passed')
 except ValueError: pass
try: m.validate_envelope_structure(proof,source,report,{0});raise AssertionError('unknown epoch passed')
except ValueError: pass
print(json.dumps({'envelopes':len(digests),'countMismatchRefused':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).envelopes, 62);
});

test('D-150 embedded references require one JSON parse, an exact pointer and the existing name/value predicates', () => {
  const program = String.raw`
import importlib.util,json,sys
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
identifier='abcdefgh-0000-'+'1234567890abcdef'*2
ctx={'plainRows':{1:{}},'idFields':{'id'},'publicReferences':{'a'*64}}
def check(body,pointer,value=identifier,kind='public-opaque-operation-reference'):
 finding={'RuleID':'generic-api-key','Match':'id":"'+value+'"','Secret':value,'StartLine':1}
 entry={'rule':finding['RuleID'],'digest':m.finding_digest(finding),'class':kind,'fieldPath':['body'],'embeddedJsonPointer':pointer}
 ctx['plainRows'][1]={'body':body}
 try:return m.mechanical_class_valid(entry,finding,ctx,seed=False)
 except (ValueError,KeyError,TypeError,IndexError):return False
assert check(json.dumps({'a/b':{'~field':[{'id':identifier}]}}),'/a~1b/~0field/0/id')
assert check(json.dumps({'refs':{'hash':'a'*64}}),'/refs/hash','a'*64,'public-hash-or-log-reference')
assert not check('prefix '+json.dumps({'id':identifier}),'/id')
assert not check(json.dumps({'nested':json.dumps({'id':identifier})}),'/nested/id')
assert not check(json.dumps({'id':identifier}),'/missing/id')
assert not check(json.dumps({'id':identifier}),'/~2/id')
assert not check(json.dumps([{'id':identifier}]),'/00/id')
assert not check(json.dumps({'apiKey':identifier}),'/apiKey')
assert not check(json.dumps({'id':'not-an-approved-id'}),'/id','not-an-approved-id')
assert not check(json.dumps({'hash':'b'*64}),'/hash','b'*64,'public-hash-or-log-reference')
assert not check(json.dumps({'id':identifier}),'/id',kind='reviewed-descriptive-source-text')
print(json.dumps({'positivePointer':True,'negativeControls':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { positivePointer: true, negativeControls: true });
});

test('D-151 generated sender identifiers require exact field, frozen maker and complete maker-specific shape', () => {
  const program = String.raw`
import importlib.util,json,sys,hashlib
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
paths=list(m._RESPAWN_MAKERS);ctx={'plainRows':{},'plainRowDigests':{},'publicKeys':set(),'trees':{}}
def valid(value,field='writer_key',maker=0,blob=None):
 finding={'RuleID':'generic-api-key','Secret':value,'Match':field+'":"'+value+'"','StartLine':1}
 entry={'class':'public-generated-agent-identifier','rule':finding['RuleID'],'digest':m.finding_digest(finding),'fieldPath':[field],'makerRef':{'tree':'superproject','path':paths[maker],'blob':blob or m._RESPAWN_MAKERS[paths[maker]][0]}}
 ctx['plainRows'][1]={field:value}
 ctx['plainRowDigests'][1]=hashlib.sha256(json.dumps(ctx['plainRows'][1]).encode()).hexdigest()
 entry['line']=1;entry['rowSha256']=ctx['plainRowDigests'][1]
 return m.mechanical_class_valid(entry,finding,ctx,seed=False)
hexid='su-respawn-'+'a'*32;uuid='su-respawn-12345678-1234-4234-8234-123456789abc'
with patch.object(m,'_frozen_source_bytes',return_value=b'frozen maker'):
 assert valid(hexid) and valid(uuid) and valid(hexid,maker=1)
 assert not valid(uuid,maker=1)
 for field in ['key','id','body','ownerId','apiKey']:assert not valid(hexid,field)
 for value in ['prefix-'+hexid,hexid+'suffix','su-respawn-'+'a'*24,'su-respawn-12345678-1234-1234-8234-123456789abc','su-respawn-12345678-1234-4234-1234-123456789abc']:
  assert not valid(value)
 assert not valid(hexid,blob='0'*40)
with patch.object(m,'_frozen_source_bytes',side_effect=ValueError('source drift')):
 ctx.pop('_makerProofCache',None)
 try:valid(hexid);raise AssertionError('changed maker passed')
 except ValueError:pass
with patch.object(m,'_frozen_source_bytes',return_value=b'frozen maker'):assert valid(hexid)
with patch.object(m,'_source_tree',side_effect=ValueError('HEAD changed')):
 try:m._validate_mechanical_entries([],[],ctx,seed=False);raise AssertionError('cached maker HEAD drift passed')
 except ValueError:pass
print(json.dumps({'positive':3,'negative':14}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { positive: 3, negative: 14 });
});

test('D-149 closed fields require frozen citations, exact occurrences and public or scanned values', () => {
  const program = String.raw`
import importlib.util,json,sys,hashlib,subprocess
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
identifier='12345678-1234-4234-8234-123456789abc';digest='a'*64
ctx={'plainRows':{},'plainRowDigests':{},'publicIds':{identifier},'publicReferences':{digest},'nonBearerFields':{},
     'trees':{kind:{'path':kind,'sha':sha} for kind,sha in m._FROZEN_TREES.items()},'identityScanValidated':True,
     'credentialDigestScan':{'digests':[digest],'digestOfCredentialHits':0,'rawCredentialHits':0,'hashControlDetected':True,'rawControlDetected':True}}
path=m._CREDENTIAL_DIGEST_VERIFIER['path'];blob=m._CREDENTIAL_DIGEST_VERIFIER['blob'];ref={'tree':'superproject','path':path,'blob':blob}
source=b' '.join(name.encode() for name in sorted(m._NON_BEARER_FIELDS))+b" createHash('sha256').update(bytes).digest('hex') admissionCredentialDigest(token) !== authority.credentialSha256 admissionCredentialDigest(decodeOperatorSecretKey(key.value_b64, 'spawn-signing-key')) !== authority.credentialSha256"
def git(args,**kwargs):
 if 'grep' in args:
  out=(m._FROZEN_TREES['superproject']+':'+path+'\n').encode() if args[2]=='superproject' else b''
  return subprocess.CompletedProcess(args,0 if out else 1,out)
 if args[-2:]==['rev-parse','HEAD']:out=(m._FROZEN_TREES[args[2]]+'\n').encode()
 elif 'rev-parse' in args:out=(blob+'\n').encode()
 else:out=source
 return subprocess.CompletedProcess(args,0,out)
def case(field,value):
 row={field:value};ctx['plainRows'][1]=row;ctx['plainRowDigests'][1]=hashlib.sha256(json.dumps(row).encode()).hexdigest()
 f={'RuleID':'generic-api-key','Secret':value,'Match':field+'":"'+value+'"','StartLine':1}
 e={'class':'public-non-bearer-field-reference','rule':f['RuleID'],'digest':m.finding_digest(f),'fieldPath':[field],'line':1,'rowSha256':ctx['plainRowDigests'][1]}
 return e,f
for field in m._NON_BEARER_FIELDS:
 ctx['nonBearerFields'][field]={'field':field,'shape':'hex64' if field=='credentialSha256' else 'uuid','toolingSha256':m._sha256(Path(sys.argv[1])),
  'reviewRef':'p2p-public-release-endgame-2026-09-01#D-149','writers':[ref],'readers':[ref],'verifier':ref}
with patch.object(m.subprocess,'run',side_effect=git):
 for field in sorted(m._NON_BEARER_FIELDS):
  e,f=case(field,digest if field=='credentialSha256' else identifier);assert m.mechanical_class_valid(e,f,ctx,seed=False),field
 e,f=case('apiKey',identifier);assert not m.mechanical_class_valid(e,f,ctx,seed=False)
 for field in ['idempotencyKey','conditionKey','watchdogKey']:
  e,f=case(field,'00000000-0000-4000-8000-000000000000');assert not m.mechanical_class_valid(e,f,ctx,seed=False)
 e,f=case('credentialSha256',digest);e['rowSha256']='0'*64;assert not m.mechanical_class_valid(e,f,ctx,seed=False)
 e,f=case('credentialSha256',digest)
 for key in ['digestOfCredentialHits','rawCredentialHits']:
  ctx['credentialDigestScan'][key]=1;assert not m.mechanical_class_valid(e,f,ctx,seed=False);ctx['credentialDigestScan'][key]=0
 ctx['identityScanValidated']=False;assert not m.mechanical_class_valid(e,f,ctx,seed=False);ctx['identityScanValidated']=True
 for key in ['hashControlDetected','rawControlDetected']:
  ctx['credentialDigestScan'][key]=False;assert not m.mechanical_class_valid(e,f,ctx,seed=False);ctx['credentialDigestScan'][key]=True
 ctx['nonBearerFields']['conditionKey']['readers']=[];e,f=case('conditionKey',identifier)
 try:m.mechanical_class_valid(e,f,ctx,seed=False);raise AssertionError('missing reader passed')
 except ValueError:pass
 ctx['nonBearerFields']['conditionKey']['readers']=[ref];ctx['nonBearerFields']['conditionKey']['toolingSha256']='0'*64
 try:m.mechanical_class_valid(e,f,ctx,seed=False);raise AssertionError('tooling drift passed')
 except ValueError:pass
 ctx['nonBearerFields']['conditionKey']['toolingSha256']=m._sha256(Path(sys.argv[1]));ctx['_nonBearerSourceCache']={}
 with patch.object(m,'_frozen_source_bytes',side_effect=ValueError('blob changed')):
  try:m.mechanical_class_valid(e,f,ctx,seed=False);raise AssertionError('blob drift passed')
  except ValueError:pass
 assert m.mechanical_class_valid(e,f,ctx,seed=False)
 ctx['_nonBearerSourceCache']={}
 with patch.object(m.subprocess,'run',return_value=subprocess.CompletedProcess([],0,(m._FROZEN_TREES['superproject']+':uncited.ts\n').encode())):
  try:m.mechanical_class_valid(e,f,ctx,seed=False);raise AssertionError('missing consumer passed')
  except ValueError:pass
with patch.object(m,'_source_tree',side_effect=ValueError('HEAD changed')):
 ctx['_nonBearerSourceCache']={'witness':[ref]}
 try:m._validate_mechanical_entries([],[],ctx,seed=False);raise AssertionError('cached HEAD drift passed')
 except ValueError:pass
print(json.dumps({'eligibleNames':sorted(m._NON_BEARER_FIELDS),'negativeControls':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    eligibleNames: ['conditionKey', 'credentialSha256', 'idempotencyKey', 'watchdogKey'], negativeControls: true,
  });
});

test('D-149 digest exposure detector refuses preimages and digest reuse outside direct JSON fields', () => {
  const program = String.raw`
import importlib.util,json,sys,hashlib,os
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
raw=os.urandom(32).hex().encode();digest=hashlib.sha256(raw).hexdigest();targets={digest}
assert m.scan_credential_digest_bytes(raw,targets)['digestOfCredentialHits']>0
binary=os.urandom(32);binary_digest=hashlib.sha256(binary).hexdigest()
assert m.scan_credential_digest_bytes(binary,{binary_digest})['digestOfCredentialHits']>0
header_digest=hashlib.sha256(b'Bearer '+raw).hexdigest()
assert m.scan_credential_digest_bytes(raw,{header_digest})['digestOfCredentialHits']>0
assert m.scan_credential_digest_bytes(b'Authorization: Bearer '+raw,{header_digest})['digestOfCredentialHits']>0
short=b'abcd';short_digest=hashlib.sha256(short).hexdigest()
assert m.scan_credential_digest_bytes(short,{short_digest})['digestOfCredentialHits']>0
assert m.scan_credential_digest_bytes(digest.encode(),targets)['rawCredentialHits']==1
assert m.scan_credential_digest_bytes(json.dumps({'credentialSha256':digest}).encode(),targets)['rawCredentialHits']==0
assert m.scan_credential_digest_bytes(json.dumps({'credentialSha256':digest,'apiKey':digest}).encode(),targets)['rawCredentialHits']==1
for content in [b'Authorization: Bearer '+digest.encode(),json.dumps({'body':json.dumps({'credentialSha256':digest})}).encode(),b'"credentialSha256":"'+digest.encode()+b'"']:
 assert m.scan_credential_digest_bytes(content,targets)['rawCredentialHits']>0
print(json.dumps({'hashControl':True,'rawControl':True,'typedField':True,'negativeControls':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { hashControl: true, rawControl: true, typedField: true, negativeControls: true });
});

test('D-157 token scan masks exact UTF-8 spans and refuses prefixes, overlaps and credential digests', () => {
  const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
config=pathlib.Path(sys.argv[2]);public,_=m._key_publics(m._sodium(),bytes(range(32)))
token='su-12345678-1234-4234-8234-123456789abc';text='Quoted café: '+token+'; retained suffix.'
raw=text.encode();start=raw.index(token.encode());span={'byteStart':start,'byteEnd':start+len(token),'sha256':hashlib.sha256(token.encode()).hexdigest()}
proof=m.scan_quoted_token_remainder(text,[span],{public},config,set())
masked=raw[:start]+b' '*len(token)+raw[start+len(token):]
assert proof['sourceSha256']==hashlib.sha256(raw).hexdigest()
assert proof['remainderSha256']==hashlib.sha256(masked).hexdigest()
assert proof['gitleaks']['blobSha256']==proof['remainderSha256'] and proof['remainderFindings']==0
assert proof['tokens'][0]['sha256']==span['sha256'] and token not in json.dumps(proof)
for changed in [[{**span,'byteEnd':span['byteEnd']-1}], [span,span], [{**span,'byteStart':True}], [{**span,'sha256':'0'*64}]]:
 try:m.scan_quoted_token_remainder(text,changed,{public},config,set());raise AssertionError('invalid span passed')
 except ValueError:pass
for surrounding in [token+'extra','prefix_'+token]:
 raw=surrounding.encode();start=raw.index(token.encode());changed={**span,'byteStart':start,'byteEnd':start+len(token)}
 try:m.scan_quoted_token_remainder(surrounding,[changed],{public},config,set());raise AssertionError('nonmaximal token passed')
 except ValueError:pass
digest=hashlib.sha256(b'example credential').hexdigest();changed={'byteStart':0,'byteEnd':len(digest),'sha256':hashlib.sha256(digest.encode()).hexdigest()}
try:m.scan_quoted_token_remainder(digest,[changed],{public},config,{digest});raise AssertionError('E3 digest masked')
except ValueError:pass
print(json.dumps({'exactMask':True,'negativeControls':7,'remainderScan':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath, configPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exactMask: true, negativeControls: 7, remainderScan: true });
});

test('secret-key derivation catches all encoded seed assignments without accepting partial tokens', () => {
  const program = String.raw`
import importlib.util,json,sys,base64
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
seed=bytes(range(32));public,_=m._key_publics(m._sodium(),seed);secret=seed+public
encodings=[seed.hex().encode(),base64.b64encode(seed),base64.urlsafe_b64encode(seed).rstrip(b'='),secret.hex().encode(),base64.b64encode(secret),base64.urlsafe_b64encode(secret).rstrip(b'=')]
for encoded in encodings:
 for prefix,suffix in [(b'key=',b''),(b'key=',b';'),(b'key = ',b'\n'),(b'key="',b'"')]:
  proof=m.scan_secret_key_bytes(prefix+encoded+suffix,{public})
  assert proof['derivationMatches']>0 and proof['tokensChecked']>0
 for prefix,suffix in [(b'_',b''),(b'x',b''),(b'',b'x'),(b'',b'_')]:
  proof=m.scan_secret_key_bytes(prefix+encoded+suffix,{public})
  assert proof['derivationMatches']==0
print(json.dumps({'assignmentControls':24,'maximalBoundaryControls':24}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { assignmentControls: 24, maximalBoundaryControls: 24 });
});

test('D-157 remainder scan catches an adjacent credential and private key after masking a public token', () => {
  const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
config=pathlib.Path(sys.argv[2]);seed=bytes(range(32));public,_=m._key_publics(m._sodium(),seed)
token='su-12345678-1234-4234-8234-123456789abc'
span={'byteStart':0,'byteEnd':len(token),'sha256':hashlib.sha256(token.encode()).hexdigest()}
for suffix in ['; apiKey="ghp_'+'Ab3De4Fg5Hi6Jk7Lm8No9Pq0Rs1Tu2Vw3Xy4'+'"', '; key='+seed.hex()]:
 try:m.scan_quoted_token_remainder(token+suffix,[span],{public},config,set());raise AssertionError('adjacent secret passed')
 except ValueError:pass
private=seed.hex();private_span={'byteStart':0,'byteEnd':len(private),'sha256':hashlib.sha256(private.encode()).hexdigest()}
try:m.scan_quoted_token_remainder(private,[private_span],{public},config,set());raise AssertionError('private token passed')
except ValueError:pass
print(json.dumps({'adjacentCredentialRefused':True,'adjacentPrivateKeyRefused':True,'privateTokenRefused':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath, configPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { adjacentCredentialRefused: true, adjacentPrivateKeyRefused: true, privateTokenRefused: true });
});

test('D-160 EI reference requires a validated exact twin, frozen maker and every containing-string rescan', () => {
  const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,copy
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
config=pathlib.Path(sys.argv[2]);public,_=m._key_publics(m._sodium(),bytes(range(32)))
value='EI-24900000000000000';finding={'RuleID':'generic-api-key','Secret':value,'Match':'"accessBug":"'+value+'"','StartLine':1}
row={'payload':{'out':{'accessBug':value}}};rowsha=hashlib.sha256(json.dumps(row).encode()).hexdigest()
spans=[{'byteStart':0,'byteEnd':len(value),'sha256':hashlib.sha256(value.encode()).hexdigest()}]
scan=m.scan_quoted_token_remainder(value,spans,{public},config,set())
entry={'class':'public-quoted-issue-reference','digest':m.finding_digest(finding),'rule':finding['RuleID'],'reviewRef':'p2p-public-release-endgame-2026-09-01#D-160','line':1,'rowSha256':rowsha,'fieldPath':['payload','out','accessBug'],'sourceRef':m._PUBLIC_ISSUE_MAKER,'twinProofSha256':'a'*64,'containingStrings':[{'fieldPath':['payload','out','accessBug'],'spans':spans,'scan':scan}]}
ctx={'plainRows':{1:row},'plainRowDigests':{1:rowsha},'quotedIssueTwins':{value:{'a'*64}},'identityScanValidated':True,'identityRecipients':{public},'scannerConfig':config,'credentialDigests':set(),'trees':{}}
maker=b'const ms = BigInt(Math.max(0, Date.now() - EI_ID_EPOCH_MS)); const rand = BigInt(randomInt(0, EI_ID_RAND_SPACE)); return ((ms << EI_ID_RAND_BITS) + rand).toString(); const candidate = '+bytes([96])+b'EI-'+bytes([36])+b'{newCollisionResistantIssueTail()}'+bytes([96])+b';'
def valid(e=entry,f=finding):return m.mechanical_class_valid(e,f,ctx,seed=False)
with patch.object(m,'_frozen_source_bytes',return_value=maker):
 assert valid()
 for e in [{**entry,'twinProofSha256':'b'*64},{**entry,'rowSha256':'0'*64},{**entry,'sourceRef':{**m._PUBLIC_ISSUE_MAKER,'blob':'0'*40}},{**entry,'line':2},{**entry,'fieldPath':['payload','out','apiKey']},{**entry,'containingStrings':[]},{**entry,'containingStrings':entry['containingStrings']*2}]:assert not valid(e)
 ctx['identityScanValidated']=False;assert not valid();ctx['identityScanValidated']=True
 e=copy.deepcopy(entry);e['containingStrings'][0]['scan']['remainderSha256']='0'*64;assert not valid(e)
 f={**finding,'Secret':'12345678-1234-4234-8234-123456789abc'};e={**entry,'digest':m.finding_digest(f)};assert not valid(e,f)
 row['body']=finding['Match'];assert not valid()
 text=row['body'];offset=text.index(value);extra={'fieldPath':['body'],'spans':[{'byteStart':offset,'byteEnd':offset+len(value),'sha256':spans[0]['sha256']}]};extra['scan']=m.scan_quoted_token_remainder(text,extra['spans'],{public},config,set());e={**entry,'containingStrings':[entry['containingStrings'][0],extra]};assert valid(e)
 row['body']+='; apiKey="ghp_'+'Ab3De4Fg5Hi6Jk7Lm8No9Pq0Rs1Tu2Vw3Xy4'+'"'
 try:valid(e);raise AssertionError('adjacent credential passed')
 except ValueError:pass
with patch.object(m,'_frozen_source_bytes',return_value=b'wrong maker'):assert not valid()
print(json.dumps({'exactEI':True,'allOccurrences':True,'negativeControls':True}))
`;
  const result = spawnSync('python3', ['-c', program, reportFormatterPath, configPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { exactEI: true, allOccurrences: true, negativeControls: true });
});

test('D-160 structured twins require an independently valid same-seed proof and cannot form a cycle', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'papercusp-issue-twin-proof-'));
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib
from unittest.mock import patch
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
base=pathlib.Path(sys.argv[2]);current=base/'current';current.mkdir(mode=0o700);other=base/'other';other.mkdir(mode=0o700);config=base/'config';config.write_text('test')
parent={'manifestSha256':'a'*64,'epochKeysSha256':'b'*64};proof=dict(parent);child=other/'seed-finding-proof.json';child.write_text(json.dumps(proof));child.chmod(0o600)
plain=other/'seed-000080.plaintext.jsonl';text=json.dumps({'issue_id':'EI-24900000000000000'})+'\n';plain.write_text(text);plain.chmod(0o600)
entries=other/'plaintext-exact-finding-digests.json';entries.write_text('[]');reference=other/'mechanical-class-proof.private.json';reference.write_text('{}')
ref={'proofPath':'other/seed-finding-proof.json','proofSha256':m._sha256(child),'plaintextSha256':m._sha256(plain),'line':1,'rowSha256':hashlib.sha256(text.encode()).hexdigest(),'fieldPath':['issue_id']}
def valid(r=ref):return m.validate_quoted_issue_twins([r],current,base,config,parent)
def refused(r=ref):
 try:valid(r);raise AssertionError('invalid twin passed')
 except ValueError:pass
with patch.object(m,'validate_seed_proof',return_value=set()) as check:
 assert valid()=={'EI-24900000000000000':{ref['proofSha256']}};check.assert_called_once()
 for r in [{**ref,'proofPath':'../outside.json'},{**ref,'proofSha256':'0'*64},{**ref,'plaintextSha256':'0'*64},{**ref,'rowSha256':'0'*64},{**ref,'fieldPath':['id']},{**ref,'line':True},{**ref,'line':2}]:refused(r)
 for changed in [{**proof,'manifestSha256':'c'*64},{**proof,'epochKeysSha256':'c'*64},{**proof,'proofs':[]}]:
  child.write_text(json.dumps(changed));refused({**ref,'proofSha256':m._sha256(child)})
 child.write_text(json.dumps(proof))
 entries.write_text(json.dumps([{'class':'public-quoted-issue-reference'}]));refused()
 entries.write_text('[]');reference.write_text(json.dumps({'quotedIssueTwinProofs':[ref]}));refused();reference.write_text('{}')
with patch.object(m,'validate_seed_proof',side_effect=ValueError('authentication failed')):refused()
print(json.dumps({'validatedTwin':True,'negativeControls':True,'cyclesRefused':True}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { validatedTwin: true, negativeControls: true, cyclesRefused: true });
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('D-165 authenticated EI occurrence supplies a twin while preserving every refused segment finding', () => {
  const f = seedProofFixture();
  try {
    const program = String.raw`
import importlib.util,json,sys,pathlib,hashlib,copy,subprocess
s=importlib.util.spec_from_file_location('f',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
directory=pathlib.Path(sys.argv[2]);root=pathlib.Path(sys.argv[3]);config=pathlib.Path(sys.argv[4]);proof_path=directory/'seed-finding-proof.json';proof=json.loads(proof_path.read_text())
plaintext=directory/'seed-000080.plaintext.jsonl';row=json.loads(plaintext.read_text());value='EI-24900000000000000';row['issue_id']=value;row['body']='apiKey="ghp_'+'Ab3De4Fg5Hi6Jk7Lm8No9Pq0Rs1Tu2Vw3Xy4'+'"';text=json.dumps(row)+'\n';plaintext.write_text(text)
scan=subprocess.run(['gitleaks','dir',str(plaintext),'--config',str(config),'--no-banner','--log-level=error','--redact=0','--report-format=json','--report-path=-'],capture_output=True,text=True);assert scan.returncode==1
report=json.loads(scan.stdout);assert len(report)>0
def write(name,data):
 p=directory/name;p.write_text(json.dumps(data));p.chmod(0o600);return m._sha256(p)
write('seed-000080.plaintext.private.json',report)
identity={'blobSha256':m._sha256(plaintext),'configSha256':m._sha256(config),'scannerVersion':proof['scannerVersion']}
write('seed-000080.plaintext.private.meta.json',{'identity':identity,'scannerExit':1,'findings':len(report),'reportSha256':m._sha256(directory/'seed-000080.plaintext.private.json')})
write('plaintext-exact-finding-digests.json',[{'rule':r['RuleID'],'digest':m.finding_digest(r),'class':'unclassified'} for r in report])
write('plaintext-classification-safe.json',{'plaintextSha256':m._sha256(plaintext),'findings':len(report),'classes':{'unclassified':len(report)},'unclassifiedLocators':[{'line':r['StartLine']} for r in report]})
auth=json.loads((directory/'ciphertext-auth-safe.json').read_text());auth['sourceSha256']=proof['sourceSha256'];write('ciphertext-auth-safe.json',auth);write('mechanical-class-proof.private.json',{})
for name in [*proof['evidence'],'mechanical-class-proof.private.json']:proof['evidence'][name]=m._sha256(directory/name)
public,_=m._key_publics(m._sodium(),bytes(range(32)));ctx={'identityScanValidated':True,'identityRecipients':{public},'credentialDigests':set()}
spans=[{'byteStart':0,'byteEnd':len(value),'sha256':hashlib.sha256(value.encode()).hexdigest()}]
ref={'proofPath':'evidence/seed-finding-proof.json','plaintextSha256':m._sha256(plaintext),'line':1,'fieldPath':['issue_id'],'rowSha256':hashlib.sha256(text.encode()).hexdigest()}
proof['reviewRef']='p2p-public-release-endgame-2026-09-01#D-165';proof['toolingSha256']=m._sha256(pathlib.Path(sys.argv[1]));proof['occurrenceScope']={'kind':'public-issue-id-twin','line':1,'fieldPath':['issue_id'],'rowSha256':ref['rowSha256'],'remainingPlaintextFindings':len(report),'tokenScan':m.scan_quoted_token_remainder(value,spans,{public},config,set())}
def valid(p=proof,r=ref,c=ctx):return m.validate_seed_proof(p,directory,root,config,issue_twin=r,identity_context=c)
def refused(p=proof,r=ref,c=ctx):
 try:valid(p,r,c);raise AssertionError('invalid scoped twin passed')
 except ValueError:pass
assert valid()==set();ref['occurrenceScope']=proof['occurrenceScope']
proof=m.assemble_seed_proof(directory,root,config,proof['file'],proof['reviewRef'],issue_twin=ref,identity_context=ctx);ref['proofSha256']=m._sha256(proof_path)
current=directory.parent/'current';current.mkdir(mode=0o700)
assert m.validate_quoted_issue_twins([ref],current,root,config,proof,ctx)=={value:{ref['proofSha256']}}
assert ctx['quotedIssueTwinResiduals']=={ref['proofSha256']:len(report)}
try:m.validate_seed_proof(proof,directory,root,config);raise AssertionError('partial proof cleared segment')
except ValueError:pass
for changed in [{**ref,'line':2},{**ref,'fieldPath':['id']},{**ref,'rowSha256':'0'*64},{**ref,'plaintextSha256':'0'*64}]:refused(r=changed)
for changed in [{**ctx,'identityScanValidated':False},{**ctx,'identityRecipients':set()}]:refused(c=changed)
for changed in [{**proof,'reviewRef':'other'},{**proof,'toolingSha256':'0'*64},{**proof,'sourceSha256':'0'*64},{**proof,'epochKeysSha256':'0'*64},{**proof,'manifestSha256':'0'*64}]:refused(p=changed)
for key,wrong in [('kind','other'),('fieldPath',['id']),('line',True),('rowSha256','0'*64),('remainingPlaintextFindings',0),('remainingPlaintextFindings',True),('tokenScan',{})]:
 changed=copy.deepcopy(proof);changed['occurrenceScope'][key]=wrong;refused(p=changed)
for key,wrong in [('sourceSha256','0'*64),('ciphertextFields',2),('ciphertextFields',True),('negativeControls',{'tamper_rejected':False,'wrong_key_rejected':True})]:
 changed={**auth,key:wrong};digest=write('ciphertext-auth-safe.json',changed);p=copy.deepcopy(proof);p['evidence']['ciphertext-auth-safe.json']=digest;refused(p=p)
write('ciphertext-auth-safe.json',auth)
assert json.loads((directory/'plaintext-classification-safe.json').read_text())['classes']=={'unclassified':len(report)}
print(json.dumps({'scopedTwin':True,'remaining':len(report),'rawCredentialStillRefused':True,'failClosed':True}))
`;
    const result = spawnSync('python3', ['-c', program, reportFormatterPath, f.evidence, f.seed, configPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const proof = JSON.parse(result.stdout);
    assert.equal(proof.scopedTwin, true);
    assert.ok(proof.remaining > 0);
    assert.equal(proof.rawCredentialStillRefused, true);
    assert.equal(proof.failClosed, true);
  } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
});

test('D-147 integrated proof refuses newly labelled classes without mechanical evidence and unclassified entries', () => {
  for (const kind of ['public-opaque-operation-reference', 'unclassified']) {
    const f = seedProofFixture();
    try {
      const read = name => JSON.parse(fs.readFileSync(path.join(f.evidence, name)));
      const entries = read('plaintext-exact-finding-digests.json');
      entries.forEach(entry => { entry.class = kind; entry.fieldPath = ['id']; });
      f.write('plaintext-exact-finding-digests.json', entries);
      const summary = read('plaintext-classification-safe.json');
      summary.classes = { [kind]: entries.length }; f.write('plaintext-classification-safe.json', summary);
      const seedSummary = read('seed-classification-verified-safe.json');
      seedSummary.plaintextProofSha256 = f.hash(path.join(f.evidence, 'plaintext-classification-safe.json'));
      f.write('seed-classification-verified-safe.json', seedSummary);
      const proof = read('seed-finding-proof.json');
      for (const name of Object.keys(proof.evidence)) proof.evidence[name] = f.hash(path.join(f.evidence, name));
      f.write('seed-finding-proof.json', proof);
      assert.equal(f.filter().status, 2, `${kind} passed without its predicate proof`);
    } finally { fs.rmSync(f.temp, { recursive: true, force: true }); }
  }
});

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

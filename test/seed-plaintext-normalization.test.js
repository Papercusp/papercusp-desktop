'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('seed diagnostic normalization preserves nested plaintext and refuses missing, changed or unopened children', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-normalization-'));
  fs.chmodSync(temp, 0o700);
  try {
    const helper = path.resolve(__dirname, '../bin/lib/print-gitleaks-findings.py');
    const program = String.raw`
import copy, importlib.util, json, pathlib, sys
s=importlib.util.spec_from_file_location('formatter',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
b=pathlib.Path(sys.argv[2])
def write(name, value):
 p=b/name;p.write_text(value);p.chmod(0o600);return p
leaf={'table':'fixture','hbKey':'row','value':{'__rekey':'sealed-fixture'},'epoch':1,'author_pubkey':'original-author'}
opened={**leaf,'value':{'token':'planted-secret-must-survive'}}
inner={'table':'__snapshot__','hbKey':'inner','value':{'coversUpTo':1,'rows':[leaf]}}
outer={'table':'__snapshot__','hbKey':'outer','value':{'coversUpTo':2,'rows':[inner],'chunkCount':1}}
source=write('source.blob','physical-source-fixture')
def run(originals, plaintext, change=None, rewrite=None):
 rows=write('rows.jsonl',''.join(json.dumps(r)+'\n' for r in originals))
 plain=write('plain.jsonl',''.join(json.dumps(r)+'\n' for r in plaintext))
 auth={'sourceSha256':m._sha256(source),'rowsSha256':m._sha256(rows),'plaintextSha256':m._sha256(plain),
       'rows':len(originals),'parsedRows':len(originals),'ciphertextFields':sum(isinstance(r['value'],dict) and '__rekey' in r['value'] for r in originals),
       'negativeControls':{'tamper_rejected':True,'wrong_key_rejected':True}}
 auth['authenticatedCiphertext']=auth['ciphertextFields']
 if change:change(auth)
 receipt=write('auth.json',json.dumps(auth))
 if rewrite:rewrite(rows,plain)
 return m.normalize_seed_plaintext(source,rows,plain,receipt,b/'output.jsonl',b/'receipt.json')
def clean():
 for name in ['output.jsonl','receipt.json']:
  (b/name).unlink(missing_ok=True)
def refuse(originals, plaintext, change=None, rewrite=None):
 clean()
 try:run(originals,plaintext,change,rewrite)
 except (ValueError,OSError):pass
 else:raise AssertionError('invalid representation accepted')
 assert not (b/'output.jsonl').exists() and not (b/'receipt.json').exists()
 assert not list(b.glob('*.partial'))
result=run([outer,inner,leaf],[outer,inner,opened])
assert result['counts']=={'inputRowsConsumed':3,'topLevelRows':1,'snapshotWrappers':2,'snapshotChildrenCoalesced':2,'authenticatedRowsReused':1,'remainingStructuralEnvelopes':0}
normalized=[json.loads(x) for x in (b/'output.jsonl').read_text().splitlines()]
assert normalized[0]['value']['rows'][0]['value']['rows'][0]==opened
assert 'planted-secret-must-survive' in (b/'output.jsonl').read_text()
assert '__rekey' not in (b/'output.jsonl').read_text()
assert result['outputSha256']==m._sha256(b/'output.jsonl') and (b/'output.jsonl').stat().st_mode & 0o077==0
assert 'not signed-log completeness' in result['scope']
# Existing destinations are never replaced.
try:run([outer,inner,leaf],[outer,inner,opened])
except ValueError:pass
else:raise AssertionError('existing output replaced')
assert m._sha256(b/'output.jsonl')==result['outputSha256']
refuse([outer,inner],[outer,inner])
refuse([outer,inner,{**leaf,'hbKey':'different'}],[outer,inner,{**opened,'hbKey':'different'}])
refuse([outer,inner,leaf],[outer,inner,{**opened,'author_pubkey':'wrong-author'}])
refuse([outer,inner,leaf],[outer,inner,leaf])
refuse([outer,inner,leaf],[outer,inner,{**opened,'value':{'nested':{'__rekey':'still-sealed'}}}])
refuse([outer,inner,leaf],[outer,inner,opened],lambda a:a.update(parsedRows=4))
refuse([outer,inner,leaf],[outer,inner,opened],lambda a:a['negativeControls'].update(tamper_rejected=False))
refuse([outer,inner,leaf],[outer,inner,opened],rewrite=lambda r,p:p.write_text(p.read_text()+'{}\n'))
# Even an ordinary plaintext row must keep its original value.
plain={'table':'fixture','hbKey':'plain','value':{'text':'original'}}
refuse([plain],[{**plain,'value':{'text':'changed'}}])
# A genuine independent occurrence is retained rather than deduplicated globally.
clean();r=run([outer,inner,leaf,leaf],[outer,inner,opened,opened])
assert r['counts']['inputRowsConsumed']==4 and r['counts']['topLevelRows']==2
assert (b/'output.jsonl').read_text().count('planted-secret-must-survive')==2
print('normalization-regressions-pass')
`;
    const result = spawnSync('python3', ['-c', program, helper, temp], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'normalization-regressions-pass');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

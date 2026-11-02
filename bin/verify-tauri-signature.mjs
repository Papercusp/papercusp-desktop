#!/usr/bin/env node
// Verify a Tauri updater (minisign) signature over an artifact using the
// embedded Ed25519 public key — WITHOUT an external `minisign`/`rsign2` binary.
// Node's crypto provides Blake2b-512 + Ed25519, the EXACT scheme Tauri's updater
// uses (minisign PREHASHED: Ed25519 over Blake2b-512(file)). Keeping this in
// Node means the local release box needs no extra system dependency to run the
// P-010 signature check (desktop-build-hardening-tri-platform-2026-07-11).
//
// WHY (D-004): the updater's REAL trust decision is this signature verifying
// against the pubkey baked into the app — NOT the sha256 in build-provenance.json.
// A correct-bytes-but-wrong/stale-signature artifact (LABELED!=PACKED at the
// SIGNATURE level) passes every sha256 check and still fails at install. This
// verifier is the executable form of "the signature the updater will actually
// trust does verify, right now, against the embedded key."
//
// Formats (minisign / tauri):
//   pubkey (tauri.conf.json plugins.updater.pubkey) = base64 of the 2-line
//     minisign pubkey FILE; its LAST line = base64([algo(2)|keyId(8)|pub(32)]).
//   .sig file on disk = base64 of the whole minisign sig FILE; that decoded
//     file's 2nd line = base64([algo(2)|keyId(8)|sig(64)]); 4th line = the
//     global signature (over sig||trustedComment) — verified too when present.
//   algo 'ED' = prehashed (Blake2b-512 of the file); 'Ed' = legacy (raw file).
//
// Usage: verify-tauri-signature.mjs <pubkey|path> <artifact> <sigfile> [--json]
//   <pubkey>   the tauri.conf.json updater pubkey (base64 of the 2-line file),
//              a path to a pubkey file, or the bare "RWR..." key line.
// Exit 0 = signature valid; 1 = invalid / key-id mismatch; 2 = usage/parse error.
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyTauriSignature } from '../../libs/generic/tauri-release-kit/src/signature.mjs';

const args = process.argv.slice(2);
const wantJson = args.includes('--json');
const pos = args.filter((a) => a !== '--json');
const [pubArg, artifact, sigPath] = pos;

function finish(code, obj) {
  if (wantJson) process.stdout.write(JSON.stringify(obj) + '\n');
  else {
    const tag = obj.valid ? 'VALID' : 'INVALID';
    const detail = obj.reason || obj.error || '';
    process.stderr.write(`signature ${tag}${detail ? ': ' + detail : ''}\n`);
  }
  process.exit(code);
}

if (!pubArg || !artifact || !sigPath) {
  finish(2, { valid: false, error: 'usage: verify-tauri-signature.mjs <pubkey|path> <artifact> <sigfile> [--json]' });
}
if (!existsSync(artifact)) finish(2, { valid: false, error: `artifact not found: ${artifact}` });
if (!existsSync(sigPath)) finish(2, { valid: false, error: `sig file not found: ${sigPath}` });

function blake2b512File(p) {
  return new Promise((res, rej) => {
    const h = createHash('blake2b512');
    const s = createReadStream(p);
    s.on('error', rej);
    s.on('data', (d) => h.update(d));
    s.on('end', () => res(h.digest()));
  });
}

async function main() {
  const publicKey = existsSync(pubArg) ? readFileSync(pubArg, 'utf8') : pubArg;
  const { code, ...result } = await verifyTauriSignature(publicKey, readFileSync(sigPath, 'utf8'),
    algo => algo === 'ED' ? blake2b512File(artifact) : readFileSync(artifact));
  finish(code, result);
}
main();

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
// Offline authorization ceremony (PUBLIC inputs only; no signing key access):
//   authorization-request <metadata.json> <candidate.json> > request.json
//   authorization-assemble <trust.json> <candidate.json> <request.json> <release.sig> <approval.sig>
// Request stdout is the EXACT bytes both authorities sign, without a newline.
// Assembly verifies both returned signatures. Supplied public trust is a review
// snapshot, not enrollment or activation; installers re-read protected trust.
import { readFileSync, existsSync, createReadStream, openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { encodeTauriUpdateAuthorization, parseTauriUpdateCandidate, verifyTauriSignature,
  verifyTauriUpdateAuthorization } from '../../libs/generic/tauri-release-kit/src/signature.mjs';

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

// Bounded snapshot: a FIFO, growing input or path swap must not hang the review
// command or make it verify bytes different from those emitted for signing.
function readAuthorizationInput(path, limit = 16_384) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(limit)) throw new Error('invalid authorization input size or type');
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (BigInt(size) !== before.size || !['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']
      .every(field => before[field] === after[field])) throw new Error('authorization input changed during snapshot');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally { closeSync(fd); }
}

if (args[0] === 'authorization-request' || args[0] === 'authorization-assemble') {
  try {
    if (args[0] === 'authorization-request') {
      if (args.length !== 3) throw new Error('usage: authorization-request <metadata.json> <candidate.json>');
      const metadata = JSON.parse(readAuthorizationInput(args[1]));
      const candidate = parseTauriUpdateCandidate(JSON.parse(readAuthorizationInput(args[2])));
      const payload = encodeTauriUpdateAuthorization(metadata);
      for (const field of Object.keys(candidate)) {
        if (JSON.stringify(candidate[field]) !== JSON.stringify(metadata[field])) throw new Error(`candidate ${field} differs from signing request`);
      }
      await new Promise((resolve, reject) => process.stdout.write(payload, error => error ? reject(error) : resolve()));
    } else {
      if (args.length !== 6) throw new Error('usage: authorization-assemble <trust.json> <candidate.json> <request.json> <release.sig> <approval.sig>');
      const trust = JSON.parse(readAuthorizationInput(args[1]));
      const candidate = parseTauriUpdateCandidate(JSON.parse(readAuthorizationInput(args[2])));
      const envelope = { payload: readAuthorizationInput(args[3]),
        signature: readAuthorizationInput(args[4], 4096).trim(),
        approvalSignature: readAuthorizationInput(args[5], 4096).trim() };
      const result = await verifyTauriUpdateAuthorization(trust, envelope, candidate, Date.now());
      if (!result.valid) finish(result.code, result);
      await new Promise((resolve, reject) => process.stdout.write(JSON.stringify(envelope) + '\n', error => error ? reject(error) : resolve()));
    }
    process.exit(0);
  } catch (error) { finish(2, { valid: false, error: error.message }); }
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

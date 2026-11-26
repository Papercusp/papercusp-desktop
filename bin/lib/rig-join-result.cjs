// Read the join response on stdin. Stdout carries only the selected member
// for rig_join_hive. Diagnostics on stderr always point back to a private copy.
const fs = require('node:fs');
const path = require('node:path');
const { sanitize, sanitizeText } = require('./rig-evidence-redaction.cjs');

const [frame, run, bank, ownerSlug] = process.argv.slice(2);
const raw = fs.readFileSync(0, 'utf8');
let result;
try {
  result = JSON.parse(raw);
} catch {
  // Keep the full redacted text. A parser exception may quote raw input.
}

const members = Array.isArray(result?.members) ? result.members : [];
const failures = members.map((member, index) => ({ member, index }))
  .filter(({ member }) => member?.ok !== true);
const selfJoin = result?.self_hive === true;
const slug = selfJoin ? ownerSlug : members.find((member) => member?.ok === true && member.slug)?.slug;
const joined = result?.ok === true && typeof slug === 'string' && slug.length > 0 &&
  !/[\x00-\x1f\x7f]/.test(slug) && consoleText(slug) === slug;

function consoleText(text) {
  // Member links carry binding material. Print only the reason and slug,
  // suppressing even links that are repeated inside either of those fields.
  return sanitizeText(text).replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[link]');
}

function reasonPreview(text) {
  const characters = Array.from(consoleText(text));
  const limit = 240;
  if (characters.length <= limit) return JSON.stringify(characters.join(''));
  return JSON.stringify(characters.slice(0, limit).join('')) + ' … (' +
    (characters.length - limit) + ' more characters in the full response)';
}

function bankResponse() {
  const root = path.join(bank, 'fail');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(root, 'join-' + path.basename(run) + '-' + path.basename(frame) + '-'));
  const parsed = result !== undefined;
  const filename = path.join(dir, parsed ? 'response.json' : 'response.txt');
  const evidence = parsed ? JSON.stringify(sanitize(result), null, 2) + '\n' : sanitizeText(raw);
  fs.writeFileSync(filename, evidence, { flag: 'wx', mode: 0o600 });
  return filename;
}

if (!joined || failures.length) {
  const reason = typeof result?.error === 'string' ? reasonPreview(result.error) :
    result === undefined ? 'invalid JSON response' :
    failures.length ? 'member failure' : 'no usable member in the response';
  console.error((joined ? '⚠ ' : '✗ ') + frame + ' join-pot ' + (joined ? 'partially succeeded' : 'failed') + ' — ' + reason);
  for (const { member, index } of failures) {
    const label = typeof member?.slug === 'string' && member.slug ? ' ' + JSON.stringify(consoleText(member.slug)) : '';
    const detail = typeof member?.detail === 'string' ? reasonPreview(member.detail) : 'missing member detail';
    console.error('  member[' + index + ']' + label + ' — ' + detail);
  }
  try {
    console.error('  Full redacted join response at ' + bankResponse());
  } catch (error) {
    console.error('  Could not save the redacted join response (' + (error.code || 'write failed') + ')');
    process.exitCode = 1;
  }
}

if (!joined) process.exitCode = 1;
else if (!process.exitCode) process.stdout.write((selfJoin ? 'owner:' : 'member:') + slug);

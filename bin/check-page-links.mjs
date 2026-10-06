#!/usr/bin/env node
// check-page-links.mjs — refuse to advertise a link that does not resolve.
//
// WI-10006550 (open-source-release-2026-09-29 R-15): the 0.0.25 release page linked
// `desktop-v0.0.25-alpha/Papercusp%20Server_0.0.25_amd64.deb`, which was recorded in the
// release registry but never uploaded, so the public page served a 404 download link.
// publish-release-history.sh verified the index, history.json and ONE detail page, but no
// step checked that every link on the index resolves. Recording an artifact is not the same
// as uploading it, so the page must be checked against what the host actually serves.
//
// publish-release-history.sh runs this BEFORE it uploads index.html (index.html goes last,
// so every page and installer it links to is already uploaded by then):
//
//   node bin/check-page-links.mjs <page.html> <public-base-url>
//
// Only RELATIVE links are checked (installers, change pages, plan and work-item pages):
// those are the objects this channel owns. Absolute links (another host) and in-page
// fragments are out of scope. Output names links relative to the page, never the base URL,
// because the base carries the channel's unguessable path segment.
//
// Exit codes: 0 every link resolved · 1 one or more links did not resolve (listed) ·
//             2 the host was unreachable for every link (nothing measured) or bad usage.

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&lt;': '<', '&gt;': '>' };

/** Every distinct relative href/src on the page, fragment removed, in first-seen order. */
export function extractRelativeLinks(html) {
  const seen = new Set();
  const re = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  for (const match of html.matchAll(re)) {
    let link = (match[1] ?? match[2] ?? '').trim();
    link = link.replace(/&(?:amp|quot|#39|#x27|lt|gt);/g, (entity) => ENTITIES[entity]);
    const hash = link.indexOf('#');
    if (hash >= 0) link = link.slice(0, hash);
    if (!link) continue; // empty, or a pure in-page fragment
    if (link.startsWith('//')) continue; // protocol-relative: another host
    if (/^[a-z][a-z0-9+.-]*:/i.test(link)) continue; // https:, mailto:, data:, javascript:
    seen.add(link);
  }
  return [...seen];
}

function resolve(link, base) {
  return new URL(link, base.endsWith('/') ? base : `${base}/`).toString();
}

async function probeOnce(url, fetchImpl, timeoutMs) {
  try {
    let res = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 405 || res.status === 501) {
      // A host that does not implement HEAD: ask for one byte instead.
      res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      await res.body?.cancel?.();
    }
    return res.status;
  } catch {
    return 0; // connection-level failure: no HTTP answer at all
  }
}

/**
 * Probe each link against the public base. A connection failure or a 5xx is retried once,
 * so one transient blip does not refuse a publish; a 4xx is an answer and is not retried.
 */
export async function checkLinks(links, base, { fetchImpl = fetch, concurrency = 16, timeoutMs = 30000 } = {}) {
  const results = new Array(links.length);
  let next = 0;
  async function worker() {
    while (next < links.length) {
      const index = next++;
      const url = resolve(links[index], base);
      let status = await probeOnce(url, fetchImpl, timeoutMs);
      if (status === 0 || status >= 500) status = await probeOnce(url, fetchImpl, timeoutMs);
      results[index] = { link: links[index], status, ok: status >= 200 && status < 300 };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, worker));
  return results;
}

/** 0 = all resolve, 1 = dead links, 2 = nothing measured (host unreachable for every link). */
export function verdict(results) {
  if (results.length > 0 && results.every((r) => r.status === 0)) return 2;
  return results.some((r) => !r.ok) ? 1 : 0;
}

async function main(argv) {
  const [page, base] = argv;
  if (!page || !base) {
    console.error('usage: check-page-links.mjs <page.html> <public-base-url>');
    return 2;
  }
  const links = extractRelativeLinks(readFileSync(page, 'utf8'));
  const results = await checkLinks(links, base);
  const code = verdict(results);
  if (code === 2) {
    console.error(`  ⚠ the host answered none of the ${links.length} link(s) on the page — nothing was measured`);
  } else if (code === 1) {
    const dead = results.filter((r) => !r.ok);
    console.error(`  ✗ ${dead.length} of ${links.length} link(s) on the page do not resolve:`);
    for (const r of dead) console.error(`      HTTP ${r.status || '000'}  ${r.link}`);
  } else {
    console.log(`  ✓ all ${links.length} relative link(s) on the page resolve`);
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

# Calling defineTool tools from an in-process /admin route
URL: /internal/docs/agent-insights/admin-route-tool-proxy

defineTool projections register POST-only and require identity via readIdentity(ctx). An admin route proxying them needs a synthesized POST + ?superuser=1 + ?client= + validateSuperuser, not a passthrough.

## What

When an admin route (loopback-only, `auth: 'public'`) wants to call a
`defineTool` tool in-process via `handleHttpToolRequest`, the natural
"just pass through the inbound method + searchParams" doesn't work.
Three traps:

1. **Every `defineTool` registers `methods: ['POST']`.** Both
   `registerLegacyAsProjected` and `registerRoleGatedAsProjected` in
   `libs/generic/tooldef/src/define-tool.ts` (the `defineTool` core was
   generalized out of `packages/agent-mcp` into `libs/generic/tooldef` /
   `libs/generic/tooldef-http`; `agent-mcp` re-exports them) hardcode it.
   A GET dispatch returns **405** at the methods gate inside
   `resolveToolAndContext` (now in `libs/generic/tooldef-http/src/http-projection.ts`).
   The browser side can keep cacheable GETs — the *internal* call must be POST.

2. **Tool args come from `req.body`, not `req.searchParams`.** The
   methods gate above is the obvious one; the more subtle one is
   that the dispatcher validates against `body` only. If you stay GET
   internally, your args never reach Zod and the tool runs with
   `{}`. Required fields fail validation.

3. **Writes (and `locks:queue`) need identity.** Tools using
   `with-plan-lock` or `readIdentity(ctx)` call into
   `resolveAgentIdentity`, which throws if ctx carries none of
   `isPowerUser` / `isSuperuser` / `principal`. The superuser branch
   *also* requires `ctx.uiClientId` to be set — otherwise it throws
   `"superuser context is missing uiClientId"`.

## The shape that works

```ts
// In your /admin/<surface>.ts route handler:

const ADMIN_UI_CLIENT_ID = 'pc-admin-<surface>-ui';

const HOST_EXTRAS: HttpToolHostExtras = {
  deps: PROJECTED_DEPS,
  log: () => {},
  // /admin/* is loopback-bound — that's the security boundary.
  validateSuperuser: () => true,
};

function adminSearchParams(inbound: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(inbound);
  sp.set('superuser', '1');                       // → isSuperuser=true
  if (!sp.has('client')) sp.set('client', ADMIN_UI_CLIENT_ID); // → uiClientId
  return sp;
}

// For GETs from the browser — convert searchParams to args body:
function bodyFromSearchParams(p: URLSearchParams): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of new Set(p.keys())) {
    const all = p.getAll(key);
    if (all.length > 1) { body[key] = all; continue; }
    const v = all[0] ?? '';
    if (v === 'true') body[key] = true;
    else if (v === 'false') body[key] = false;
    else body[key] = v;
  }
  return body;
}

async function dispatchRead(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const result = await handleHttpToolRequest({
    method: 'POST',                                       // ← always POST
    pathname: '/api/agent-tools/<group>/<verb>',
    searchParams: adminSearchParams(url.searchParams),    // ← superuser + client
    headers: collectHeaders(req),
    body: bodyFromSearchParams(url.searchParams),         // ← real args
  }, HOST_EXTRAS);
  return unwrap(result);
}
```

Browser-facing GETs stay cacheable / ergonomic; the proxy translates
to the dispatcher's expected POST + body + identity envelope. Writes
(POST in, POST out) work the same way — just pass the inbound JSON
body straight through.

## Required upstream support

`buildHttpSpawnContext` must read `?client=` into `uiClientId`
(landed 2026-05-20 alongside the Plans admin tab). Without that,
`?superuser=1` alone hits the `"superuser context is missing
uiClientId"` throw. If you're on an older revision and see that
error from an admin proxy, that's the symptom.

## Why this matters

The catchall at `/api/agent-tools/*` works because external callers
ARE bearer-authed — they supply identity through bearer. An admin
shell can't present a bearer (the UI doesn't have one). The
"synthesize a superuser identity, gated by loopback" pattern is the
local equivalent and the only working option short of moving the
tools' implementations behind a non-tool route.

The other working option is bypassing `handleHttpToolRequest`
entirely and calling `tool.fn(input, ctx)` directly with a hand-built
ctx — that works but loses the dispatcher's role/quota/audit pipeline.
Prefer the proxy pattern.

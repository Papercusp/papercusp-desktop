# Porting Next route.ts files to defineRoute
URL: /internal/docs/agent-insights/endpoint-route-migration-patterns

The non-obvious patterns from migrating all 243 operator endpoints off Next route handlers onto the Hono-mounted defineRoute primitive.

The R5 endpoint migration moved every `app/api/**/route.ts` in the operator
onto `defineRoute` (mounted on the Hono `app` via `registerAllRoutes`). 243
routes, 24 family batches. A few things that bite if you don't know them:

## Catch-all routes must register LAST

Hono's parametric/wildcard matches (`/:transport`, `/plugins/*`,
`/agent-tools/*`) will shadow literal paths registered after them in some
router configs. Register every literal route first, then the family
catch-all, then the absolute-last `:transport` MCP catch-all. In
`routes/index.ts` the spread order in `ALL_ROUTES` is load-bearing — the
comment markers there are not decoration.

## A route module importing the barrel can deadlock the registry

`routes/openapi-json.ts` needs `allRouteFragments()`. Importing it from the
package barrel (`@/lib/endpoint-route`) creates a cycle:
`routes/index.ts → openapi-json.ts → barrel → register.ts → routes/index.ts`.
Import the **leaf module** directly (`../openapi`) instead. Any route module
that needs something from the endpoint-route package must reach for the
specific file, never the barrel.

## Port at the route's *current* auth posture — don't tighten mid-port

Most legacy `route.ts` files were `auth: 'public'` with an inline
`isLoopback()` / `getSessionUser()` / `requirePrincipal()` check. A
mechanical port keeps exactly that: `auth: 'public'` + the same inline
check. Tightening (e.g. making `credentials` require `trust: 'trusted'`) is
a **separate, auditable pass** — never smuggled into a migration diff.
Reviewers can't see a behavior change hidden inside 200 lines of faithful
copy.

## Colocated route.test.ts → Hono in-process app.request()

Old tests imported `{ GET, POST }` from `./route` and called them with a
fake `NextRequest`. The ported test builds a Hono app, `registerAllRoutes`,
and drives `app.request('/api/...')`. Move the file to
`lib/endpoint-route/__tests__/`. Two recurring fixes:

* **Flag-gated routes** (`gateApiRoute(FLAGS.X)`) 404 in tests unless you
  `vi.mock('@/lib/require-flag', () => ({ gateApiRoute: async () => null }))`.
* **Never `vi.mock('node:fs')`** — `registerAllRoutes` transitively loads
  prompt-assembly, which `existsSync`/`readFileSync`s real persona files. A
  blanket fs mock breaks unrelated routes. Mock the specific lib instead.

## getSessionUser / getSessionUserOrDefault are header-aware

`defineRoute` handlers get a plain `Request`. The Next-free cookie
substrate (`lib/auth.ts`) exposes `getSessionUser(headers?)` /
`getSessionUserOrDefault(headers?)` — pass `req.headers`. The no-arg form
falls back to `next/headers` `cookies()`, which is the thing being removed.

## Enforcement is a script, not a lint rule

`apps/operator/scripts/endpoint-route-progress.mjs --check` exits non-zero
if any raw `route.ts` exists under `app/api/**` outside the
`[[...route]]` host-seam floor. That catches a re-introduced route
regardless of contents — strictly better than a contents-matching ESLint
rule. Wire it into CI next to `tsc`.

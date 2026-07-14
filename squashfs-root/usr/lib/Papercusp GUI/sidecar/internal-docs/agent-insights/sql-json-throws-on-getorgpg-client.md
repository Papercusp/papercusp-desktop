# `sql.json(object)` throws on the getOrgPg pg client — write jsonb via `JSON.stringify(x)::jsonb`
URL: /internal/docs/agent-insights/sql-json-throws-on-getorgpg-client

>-

## Symptom

A jsonb write through the operator's `getOrgPg().sql` client throws, synchronously, **before** hitting Postgres:

```
The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Object
```

…wherever the code binds an object/array with postgres-js's `sql.json(value)`:

```ts
await sql`UPDATE … SET divergence = ${sql.json(obj)} …`;  // ❌ throws on getOrgPg
```

The throw is often **swallowed** by a best-effort `try/catch`, so the failure is silent — the row just never persists. Cost/result counters that read an in-memory value (not the DB) still look fine, which masks it further.

## Root cause (confirmed)

It is **not** the client config. A fresh `postgres(url, …)` client built with the *identical* options as `getOrgPg`'s `buildClient` (`prepare:false` + the custom `bigint` type + `connection.search_path`) accepts `sql.json` without error. The difference is a **postgres-js module-instance mismatch** (a dual-package hazard): the `Parameter` wrapper `sql.json()` produces and the serializer that consumes it resolve to *different* copies of postgres-js, so the `instanceof` check fails, the wrapper is treated as a raw object, and `Buffer.byteLength`/`Buffer.from` is handed an object → the throw.

Empirical check against the real client:

```ts
import { getOrgPg } from '@papercusp/db-org';
const { sql } = getOrgPg();
await sql`SELECT ${sql.json({a:1})}::jsonb`;            // ❌ throws
await sql`SELECT ${JSON.stringify({a:1})}::jsonb`;      // ✅ works
```

**Exact failure point (from the throw's stack):** `Buffer.byteLength(<object>)` inside postgres-js's `Bind` → `reset.str`, in the **CJS build** (`node_modules/postgres/cjs/src/connection.js`, the `prepare:false` `ParameterDescription` path) — the `sql.json` Parameter reaches `Bind` un-serialized. getOrgPg's client resolves the **CJS** build; a fresh `import postgres from 'postgres'` resolves the **ESM** build (`src/`) and serializes the same Parameter correctly. Two builds of one version loaded together is the dual-package hazard. The "true root fix" (dedupe so getOrgPg uses a single build) is deliberately **not** pursued: `${JSON.stringify(x)}::jsonb` is universally correct and enforced by `scripts/check-no-sql-json.mjs`, so restoring `sql.json` has no upside.

## Fix

Bind jsonb as a JSON **string** cast to jsonb — portable across every client:

```ts
// object (always present)
SET col = ${JSON.stringify(obj)}::jsonb
// nullable
SET col = ${obj == null ? null : JSON.stringify(obj)}::jsonb
```

This is semantically identical to `sql.json` for jsonb and works everywhere.

## Read side — `${JSON.stringify(x)}::jsonb` reads back as a STRING on the test pools

A column written this way reads back as a **raw JSON string** under the testcontainer / org-test pools (and any client that doesn't auto-decode jsonb), whereas the prod getOrgPg/CJS client **auto-parses it to an object/array**. So a reader that uses the value as an object/array must decode defensively, or it silently sees a string (e.g. `row.payload.routedRef` → `undefined`, no crash, wrong result). Decode at every jsonb read boundary with the shared `coerceJson<T>(v)` (`packages/operator-core/lib/pg-jsonb.ts`) — it returns an object/array untouched and `JSON.parse`s a string. (Mirrors `coerceJsonArray`, slot-parked-store `parseEnvelope`, pg-log `parseBody`.)

**Trap:** switching a write off `sql.json` UNBLOCKS the write, which can newly EXPOSE a latent read bug whose column was previously never populated (the throwing write meant nothing was ever stored to read). Always fix the write and its reads together — a green write is only half the migration.

## Why tests don't catch it

Integration tests use `createFreshPgDb` (`packages/operator-core/test/_pg-helpers.ts`), a **root-postgres** client that resolves the *tolerant* postgres-js instance — so `sql.json` works there and a green integration test says nothing about prod. **A passing `*.integration.test.ts` is not evidence that a `sql.json` write works in production.** The codebase already worked around this ad hoc (`dock-layouts.ts` uses a separate `db()` pool *because* "the operator getOrgPg client where sql.json throws").

## Safe vs unsafe clients

* **Unsafe** (throws): `getOrgPg().sql` / `getOrgPgApp().sql` / any client from `buildClient` in `libs/papercusp/libs/db/src/connection.ts`, and `getHarnessPg(slug)`.
* **Safe** (tolerates): the root-postgres test client (`createFreshPgDb`), `dock-layouts`' `db()` pool, and a plain `postgres(uri, {prepare:false})` like the gym's `gymSql`.

When in doubt, just use `JSON.stringify(x)::jsonb` — it is correct on every client.

## History

Same class as the experiment-ledger fix (D-018, plan `experiment-registry-invocation-api-2026-06-14`). The sweep that found it (EI-607) fixed five getOrgPg-client sites: `replay/store.ts` `finishRun` (which had broken **every** replay-harness cell's persistence in prod → 0 scored cells, masking the replay/transfer/regret frontier loops as non-functional), `slot-parked-store.ts`, `owner-preference/interactions.ts`, `change-ledger.ts`, `pot-eval/store-pg.ts`. The true root fix (deduping the postgres-js instance so `sql.json` works everywhere) + a static lint guard banning `sql.json(` in getOrgPg-client code remain open on EI-607.

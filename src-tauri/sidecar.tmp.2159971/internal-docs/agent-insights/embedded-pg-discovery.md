# Never hardcode PG port — read embedded-pg.json
URL: /internal/docs/agent-insights/embedded-pg-discovery

Embedded Postgres uses a discovered port written to ~/.papercusp/embedded-pg.json on desktop boot. Hardcoding :5432 or :16534 breaks on any machine that wasn't the one you wrote the code on.

## What

Papercusp ships with **embedded Postgres**, not a host-installed PG.
On desktop boot, the embedded-pg process picks an available port and
writes its connection info to:

```
~/.papercusp/embedded-pg.json
```

Agents and the webapp resolve the connection via
`getHarnessAdminUrl()` (from `packages/operator-core/lib/embedded-pg-discovery.ts`;
the generic resolver is `resolvePgUrl` in `libs/generic/embedded-pg-discovery`),
which reads this file. `getHarnessPg(slug)` (per-harness scoped) lives in
`libs/papercusp/libs/db/src/connection.ts`. The port is **not** stable — it can
shift between boots, machines, and Papercusp installs.

## Why it matters

Code that hardcodes `:5432` (host PG default) or `:16534` (an older
embedded-pg default we've seen) works on the developer's laptop and
**breaks silently on every other machine**. Symptoms:

* "Connection refused" on a freshly cloned machine.
* Tests that pass locally and fail in CI.
* An agent's `psql` invocation that returns nothing because it
  connected to the *wrong* PG instance — possibly the user's
  unrelated host PG, leading to confusing query results.

The native-PG path (`:5432`) is also being retired (memory:
`project_papercusp_pg_topology` — "public release = desktop +
embedded-pg only; native PG :5432 + webapp are dev crutches going
away"). Don't assume it'll be there.

## How to apply

* **Always resolve PG connections through `getHarnessAdminUrl()`**
  (admin role) or `getHarnessPg(slug)` (per-harness scoped).
* **For shell scripts**, read the JSON directly. The discovery file holds a
  single resolved DSN under `.url` (the resolver reads `parsed.url`), so feed it
  straight to psql:
  ```bash
  psql "$(jq -r .url ~/.papercusp/embedded-pg.json)"
  ```
* **Never write a config file** that bakes a PG port at install time.
  Resolve at runtime.
* If embedded-pg.json doesn't exist, the desktop hasn't been booted
  yet — surface that to the user rather than falling back to `:5432`.

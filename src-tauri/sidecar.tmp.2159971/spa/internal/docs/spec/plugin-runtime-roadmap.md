# Plugin runtime — pre-release hardening + roadmap
URL: /internal/docs/spec/plugin-runtime-roadmap

What landed for v1.0, what was deferred, and what's deliberately not on the path.

This page tracks the plugin-runtime hardening pass driven by feedback
from the Rust-port plugin agent (2026-05-10). The pass is split into six
batches; A–E shipped pre-release, F is intentionally deferred.

## Shipped pre-release

| Batch                                 | Theme                       | Key changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** — Manifest hardening            | Reject silent typos         | `papercusp-plugin.schema.json` + ajv `additionalProperties:false`; plugin id regex `^(@scope/)?[a-z][a-z0-9_.-]{2,62}$`; bare-name length floor; `protocol`/`papercusp` separated; hookbus event-namespace rule (substrate-reserved names rejected, plugin events must be `<id>.<rest>`); `apiRoutes` is a structural `PluginApiRoutes` not `unknown`.                                                                                                                                      |
| **B** — Two-tier capability check     | Biggest security win        | `CapabilityCheckContext.granted` ANDs with manifest. PG-canonical store `harness_shared.plugin_capability_grants` (Migration 051). Boot-time silent backfill from `enabled-plugins.json` + legacy file so existing harnesses don't break. `/api/plugins/grants` GET/POST.                                                                                                                                                                                                                   |
| **C** — Lifecycle + audit correctness | Debuggable in prod          | `init/onLoad` failure rolls back `initialized`/`registries`/`grants` so a retry re-runs cleanly. `recordAudit` is async, `invoke()` awaits it, audit-write failure becomes the action's failure (fail-closed). PgAuditWriter against `harness_shared.plugin_audit_log`; `NODE_ENV=test` keeps in-memory. AuditRow gains `capabilitiesUsed[]`, `killedByTimeout`, `stdout/stderrBytes`, `truncated`. New hookbus isolation tests pin the "one bad handler doesn't abort the chain" contract. |
| **D** — Spawn hardening               | Riskiest API tightened      | `FROZEN_PATH` snapshot at host startup; spawn always uses it regardless of `process.env.PATH` mutation. Absolute paths require the manifest to declare the exact path or a covering wildcard like `compute:exec:/usr/bin/*`. Relative paths still rejected.                                                                                                                                                                                                                                 |
| **E** — Author tooling                | Errors at build, not deploy | `PROTOCOL_VERSION = '1.0.0'`; plugins may declare `protocol: '^1.0'` separate from `papercusp` runtime range. `papercusp plugin lint` runs the loader's manifest validation + entry-point check + capabilities sanity at build time.                                                                                                                                                                                                                                                        |

## ~~Deferred to post-v1.0 (Batch F)~~ — all shipped 2026-05-12

* ~~**Typed `ctx.kv` with quotas**~~ — shipped in papercup#46 + papercupai/papercusp#4 (Migration 054). Per-plugin namespace, 10 KiB/key + 1 MiB/plugin defaults, override via `kvQuota` in manifest. PG-backed.
* ~~**Hot-reload state preservation**~~ — shipped in papercup#47 + papercupai/papercusp#5 (Migration 055). Opt-in via `hotReload: { preserveState: true }`; 64 KiB cap; one-shot restore on next init.
* ~~**`papercusp plugin doctor`**~~ — shipped in papercupai/papercusp#3 + papercup#44 (with the `.read` scanner fix in papercupai/papercusp#6 + papercup#49). Regex scanner for `ctx.spawn` / `ctx.fetch` / `ctx.secrets.read` / `ctx.hookBus.{emit,on}` literal arguments; alias-aware (`const spawn = ctx.spawn`); cross-checks against `capabilities[]`; reports missing / unused / dynamic classifications.

## Explicit non-goals

The Rust-port agent flagged three things to NOT do; documenting here so
they don't drift back in:

* **No Node sidecar / WASM hybrid** before v1.0. The TS plugin system's
  value is in-process — the moment we cross a process boundary we lose
  same-language hot-reload AND inherit the Rust system's full sandbox
  cost. Stay in-process for v1.0.
* **No unifying the manifest format with the Rust port's TOML.** Rust
  uses TOML, TS uses JSON. Same concepts, different syntax. Convergence,
  if it ever happens, comes after the Rust runtime can host current-TS
  plugins via a shim.
* **No `apiRoutes: unknown` in the SDK.** Already fixed — A4 changed it
  to `PluginApiRoutes` (structural, pinned to host's Hono major).

## Migration notes

> The numbered migrations referenced below (051, 054, 055) were historical
> incrementals; they are now squashed into the frozen `000-baseline.sql`
> dump (plan `self-contained-migration-baseline-2026-06-02`). The tables they
> created — `harness_shared.{plugin_capability_grants,plugin_kv,plugin_reload_state}`
> — live in the baseline today. Don't expect to find `051-*.sql` on disk.

* Migration 051 must run before the operator boots with B-tier code, or
  every action invocation will be denied (manifest-only Tier-1 still
  allows them, but Tier-2 returns empty grants → `false`). The boot
  backfill in `instrumentation.ts` writes grants for every currently-
  enabled plugin so the upgrade is silent.
* The legacy `~/.papercusp/granted-capabilities.json` is read-only
  fallback for one release cycle. Remove the read path in the cycle
  after the next release.

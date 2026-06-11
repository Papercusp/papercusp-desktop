# Plugin authoring quickstart
URL: /internal/docs/spec/plugin-quickstart

Build, lint, install, and publish a Papercusp plugin in five minutes.

You'll go from blank directory to a published plugin running in a harness, in five commands. Run them top-to-bottom in a fresh terminal.

## Prerequisites

* `papercusp` CLI on PATH (`papercusp --version` prints something).
* A running operator on `localhost:3055` (`bin/dev` from the papercup repo) — needed for in-process testing but not for authoring or publishing.
* A running marketplace API on `localhost:3057` (`systemctl --user status marketplace-api`) — needed for publish.

## 1. Scaffold

```bash
papercusp plugin init my-tool
cd my-tool
```

`init` copies `@papercupai/cloudflare-stack` (the most-thoroughly-exercised first-party plugin) and rewrites every reference to your new slug. You'll get:

```
my-tool/
├── papercusp.json          # manifest — declared capabilities + UI surfaces
├── index.js                # entry point — exports a Plugin object
├── README.md               # user-facing description
└── ...
```

Use `--template <slug>` to pick a different starter (e.g. `--template @papercupai/jira-sync` for an OAuth plugin), or `--from-path <dir>` to fork a local checkout.

## 2. Edit the manifest

Open `papercusp.json`. The fields that matter for your first plugin:

```json
{
  "name": "my-tool",
  "version": "0.1.0",
  "kind": "plugin",
  "description": "What this does in one sentence.",
  "author": "you",
  "license": "MIT",
  "papercusp": "^0.1.0",
  "capabilities": [
    "tasks:read",
    "http:fetch:api.example.com",
    "secrets:read:MY_TOOL_API_KEY"
  ],
  "actions": [
    {
      "name": "ping",
      "label": "Ping the API",
      "icon": "Activity",
      "surfaces": ["harness-toolbar"],
      "capabilities": ["http:fetch:api.example.com"]
    }
  ]
}
```

**Capability strings** are namespace:action\[:resource]. Every host-side I/O — fetch, secrets, spawn — is gated by a capability you must declare here. The two-tier check (manifest ∩ user-granted) means users can also revoke any of these per-harness without uninstalling the plugin.

Reserved namespaces:

* `tasks:` / `features:` / `goals:` — substrate read/write
* `http:fetch:<host>` — outbound HTTP. Wildcard `*.foo.com` matches subdomains.
* `secrets:read:<NAME>` / `secrets:write:<NAME>` — per-secret. Wildcard `MY_*` for families.
* `compute:exec:<binary>` — `ctx.spawn(bin, args)` gate.
* `events:emit:<name>` / `events:listen:<name>` — must be prefixed with your plugin id (`my-tool.foo`); substrate names (`mission.*`, `task.*`, `feature.*`, `proposal.*`, `worker.*`, `validator.*`, `orchestrator.*`, `pending_event.*`) are reserved.
* `ui:dashboard-tab` / `ui:sidebar-item` / `ui:harness-route` — UI surface claims.

**Wildcards** only work in the leaf segment, and only with non-empty heads:

* `*.foo.com` matches subdomains (subdomain form)
* `MY_*` matches prefixes (head must be non-empty)
* Bare `:*` (e.g. `compute:exec:*`) is **not** a wildcard — it only matches the literal cap string. Enumerate or use a non-empty prefix.

### Snapshot version pinning

Plugins can declare how aggressively a snapshot-fork should preserve the installed version:

```json
"versionPin": { "mode": "exact" }
```

* `"mode": "semver"` (default) — fork accepts compatible upgrades.
* `"mode": "exact"` — fork pins to the snapshot's exact version.
* `"mode": "hash"` — fork pins to the snapshot's content hash.

Optional `"allowOverride": "security-patch" | "always" | "never"` controls whether the operator can override the pin (e.g. force a security update). The capture path writes `versionPin` into the snapshot manifest; legacy `pluginVersionPinned: true` is translated to `{ mode: "exact" }` for back-compat.

### Plugin runtime

The optional `"runtime"` field declares which host runtime your plugin needs. It's an **object** with a required `kind` plus kind-specific config:

```json
// WASM plugin
"runtime": {
  "kind": "wasm",
  "wasmPath": "pkg/my-plugin.wasm",
  "memoryBudgetMb": 64,
  "concurrency": "serial"
}

// Daemon plugin
"runtime": {
  "kind": "daemon",
  "daemonCommand": ["/usr/bin/my-daemon", "--stdio"],
  "daemonRestart": { "policy": "on-failure", "maxRestarts": 3 }
}
```

`kind` is one of:

* `"js"` (default) — in-process Node host. Plugin literals exported from `index.cjs`. Omit `runtime` entirely.
* `"wasm"` — WASM component, run via `jco` (TS host) or `wasmtime` (Rust host). See `@papercusp/plugin-wit` for the WIT contract. Requires `wasmPath` relative to the manifest dir. Default `memoryBudgetMb: 64`.
* `"daemon"` — sandboxed subprocess. Requires `daemonCommand`. Reserved for the upcoming subprocess host.

## 3. Lint

```bash
papercusp plugin lint
```

Catches manifest schema errors, missing entry point, malformed capability strings — every check the loader runs at runtime, run at build time. Exits non-zero on any issue.

If you don't run lint, the operator will reject loading at install time with the same error, just later.

### `doctor` — declared vs used capability check

```bash
papercusp plugin doctor
```

Static-analyzes your plugin source against `capabilities[]`. Reports:

* **Missing** caps — `ctx.spawn('git', ...)` in source, no `compute:exec:git` in manifest. Fatal — the loader will deny it at runtime.
* **Unused** caps — declared but no matching call site detected. Warning — review for cap pollution or note false positives (e.g. caps gated through code paths the scanner misses, or `events:listen:` declared as a manifest hook rather than via `ctx.hookBus.on`).
* **Dynamic** lookups — `ctx.spawn(varname, ...)` etc. that can't be statically verified. Informational only.

Run both `lint` and `doctor` pre-commit. Together they catch \~80% of "works in dev, breaks on first prod load" issues without an AST walker.

## `ctx.kv` — plugin-private key/value store

For small structured state (counts, timestamps, last-seen markers) use `ctx.kv` instead of writing JSON files under `pluginDataDir`:

```ts
const last = await ctx.kv?.get<number>('lastSync');
await ctx.kv?.set('lastSync', Date.now());
await ctx.kv?.delete('lastSync');
const keys = await ctx.kv?.list({ prefix: 'sync:', limit: 50 });
```

* **Quota** — default 10 KiB per key, 1 MiB total per plugin. Override via `kvQuota: { maxBytesPerKey, maxBytesPerPlugin }` in the manifest.
* **Isolation** — each plugin sees only its own keys; cross-plugin reads are impossible.
* **Backend** — Postgres in the operator (state survives reload, observable in the operator UI). Optional: missing in `fire-hook` CLI invocations (`ctx.kv?.` guard required).
* **Errors** — quota violations throw `KvQuotaError` from `@papercusp/plugin-sdk`.

Use `pluginDataDir` for blobs > 10 KiB, code, or anything that doesn't need to be scanned/aggregated.

## Hot-reload state preservation (optional)

Plugins with in-flight state that shouldn't reset on every reload (debounce timers, accumulated counters, live connections) can opt in via the manifest:

```json
{ "hotReload": { "preserveState": true } }
```

Then implement two hooks:

```ts
hooks: {
  async getStateForReload(ctx) {
    return { queue: this.queue, debouncer: this.debouncer.flush() };
  },
  async restoreFromReload(ctx, state) {
    this.queue = (state as Saved).queue;
    this.debouncer.resumeFrom((state as Saved).debouncer);
  },
}
```

* **Lifecycle.** Reload begins → `getStateForReload(ctx)` → host stashes the returned value → reload completes → new module instance's `init()` runs → `restoreFromReload(ctx, state)` runs before any other hook.
* **One-shot.** Restore is destructive. If `restoreFromReload` throws, the host logs + discards; the plugin starts fresh on the next reload.
* **Size cap.** State must be JSON-serialisable and ≤ 64 KiB. Bigger state belongs in `ctx.kv` or `pluginDataDir`.
* **Uninstall.** Doesn't trigger these hooks — use `onUnload` for cleanup. Uninstalled plugins have their stashed state cleared.

## 4. Test locally

```bash
papercusp plugin init my-tool --from-path .          # if you're iterating
# OR symlink for fast dev:
ln -sf "$PWD" ~/.papercusp/global-plugins/my-tool
papercusp plugin enable my-tool --harness <your-harness-slug>
```

Open the operator's harness dashboard. Your plugin's actions show up in the toolbar (per the `surfaces[]` you declared). Hot reload: edit your code, restart the operator (`systemctl --user restart papercup-dev`), the loader re-discovers from disk.

To run an action without the UI:

```bash
papercusp plugin invoke my-tool ping --harness <your-harness-slug>
```

## 5. Publish

```bash
papercusp publish .
```

This packs the directory, signs the tarball, and POSTs to the marketplace at `localhost:3057`. The catalog refreshes immediately; install on another harness with:

```bash
papercusp install my-tool
```

For a hosted marketplace publish (papercuspai.com), see [Marketplace publishing](/internal/docs/implementation/marketplace).

## Common pitfalls

* **"unknown property X" at lint time** — the manifest validator is strict on top-level keys. Either move the field into a known one (e.g. `configSchema` for config defaults, `provision` for infra setup) or refer to the [schema](https://papercuspai.com/schema/papercusp-plugin.schema.json).
* **"plugin missing capability X"** at runtime — declare it in `capabilities[]`. If users can revoke it, also acquire user grant via the install consent prompt or `/installed/plugins/<slug>/permissions`.
* **`ctx.spawn('foo')` ENOENT** — `foo` is resolved against the host's `$PATH` snapshot, not the plugin's. Either declare the absolute path in your `compute:exec:/abs/path` capability and call with the full path, or rely on the host having `foo` on its boot-time PATH.
* **Event collision warnings** — your `events:emit:foo` got rejected. Plugin events must be prefixed with the plugin id: `events:emit:my-tool.foo`.

## Next: where to look

* [Plugin runtime hardening + roadmap](/internal/docs/spec/plugin-runtime-roadmap) — what's enforced + what's deferred.
* [Marketplace pipeline](/internal/docs/implementation/marketplace) — publish flow, registry, signing, R2.
* First-party plugins under `~/.papercusp-workspaces/<workspace>/.papercusp/global-plugins/@papercupai/*` are the best reference implementations.

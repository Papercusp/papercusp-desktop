# Plugin migration story
URL: /internal/docs/spec/plugin-migration

How plugin authors and host operators handle Papercusp runtime version bumps, deprecations, and breaking changes.

This page describes the contract Papercusp gives plugin authors when the
runtime evolves: how breaking changes are announced, how the loader treats
out-of-range plugins, and how authors should structure plugins to make
upgrades cheap.

The current runtime version lives at `PAPERCUSP_RUNTIME_VERSION` in
`@papercusp/plugin-sdk` (today: **0.1.1**). Plugins declare a compatible
range via the `papercusp` field in their manifest:

```json
{ "name": "@my/plugin", "version": "0.1.0", "papercusp": "^0.1.0", ... }
```

## Bump rules

The runtime version follows semver, with one twist for the leading-zero
caret semantics every plugin uses today (`^0.1.0` → `>=0.1.0 <0.2.0`).

| Bump  | When                                                               | Plugin author response                       |
| ----- | ------------------------------------------------------------------ | -------------------------------------------- |
| patch | Bug fixes, internals invisible to plugins.                         | None.                                        |
| minor | Adds optional surface (new lifecycle hook, service, ctx field).    | Optional — adopt new features at will.       |
| major | Removes / renames existing surface, or changes existing semantics. | **Required**: see the migration steps below. |

A breaking change is anything that would cause a plugin written against the
old runtime to fail in a way it couldn't have anticipated:

* A capability string is removed or renamed.
* A lifecycle hook's signature changes (added a required positional arg, or
  the host stops calling it).
* A service method is removed, or its return shape narrows.
* The `PapercuspContext` shape loses a field plugins were reading.

Adding a new field to `PapercuspContext`, a new optional method to a service,
or a new lifecycle hook is **never** breaking — those are minor bumps.

## What the loader does to out-of-range plugins

The loader runs `satisfies(PAPERCUSP_RUNTIME_VERSION, manifest.papercusp)`
on every load. Plugins outside the range are **rejected**, not silently
skipped — they appear in `loadErrors` with a clear message:

```
plugin "@my/plugin" requires papercusp runtime "^0.1.0" but host is "0.2.0"
```

The host operator sees this in `GET /api/plugins/runtime/status` and the
operator dashboard's plugins tab. Refusing to load is intentional: a plugin
running against an incompatible runtime can corrupt host state in ways
that no try/catch around its hooks would catch.

## Major-version migration recipe (author side)

When the runtime bumps from `0.x` to `1.0` (the first such bump expected
post-v1.0 freeze), the plugin author:

1. **Read the CHANGELOG entry.** `@papercusp/plugin-sdk/CHANGELOG.md`
   describes every breaking change with a "before / after" snippet.
2. **Update `papercusp:` in the manifest.** Bump from `^0.x.y` to
   whatever range covers the new runtime — typically `^1.0.0`. This is
   the gate; until the plugin's range admits the host runtime, it
   refuses to load.
3. **Bump the plugin's own `version`.** The marketplace requires a fresh
   version per publish, and downstream `papercusp.lock` entries pin the
   old (incompatible) version. Bumping unpins consumers on `papercusp install --update`.
4. **Update code for the breaking changes.** The CHANGELOG specifies
   the migrations; common patterns:
   * Renamed capability → update both manifest `capabilities[]` and
     each service call that referenced the old string.
   * Removed lifecycle hook → move logic to a different hook (the
     CHANGELOG suggests a target).
   * Service-method shape change → adapt the call site; if you can't,
     downgrade to the previous runtime range and refuse to ship.
5. **Republish.** `papercusp publish` from the plugin dir; the
   marketplace catalog updates within seconds.

## Major-version migration recipe (host operator side)

When upgrading the host runtime past the range some installed plugins
declare:

1. **Inventory.** `papercusp doctor` (or the operator dashboard's
   diagnostics page) lists every installed plugin with its declared
   `papercusp:` range and a green/red badge for the new runtime.
2. **Hold or upgrade.** For each red plugin: either pin the host to the
   last compatible runtime (via the `PAPERCUSP_RUNTIME_VERSION_OVERRIDE`
   escape hatch — emergency-only, see below) or update / replace the
   plugin to a version whose range admits the new runtime.
3. **Sweep.** Once every red plugin has a green successor available,
   bump the host runtime via `npm install @papercusp/plugin-sdk@<major>`
   and restart.
4. **Audit.** First request after restart hits `/api/plugins/runtime/status`;
   `loadErrors` should be empty. Stale plugins surface here, not silently.

### Escape hatch: `PAPERCUSP_RUNTIME_VERSION_OVERRIDE`

For incident response only. Setting this env var to e.g. `0.1.99` makes
the loader treat that string as the runtime version when validating
plugin ranges. Useful when an emergency host upgrade revealed an
unanticipated plugin breakage and rolling forward (publishing patched
plugins) is cheaper than rolling the host back.

This override is **not** the way to avoid keeping plugins up to date —
plugins running against a version they weren't tested on can corrupt
data. Use it to buy time, never to skip the work.

## Why "refuse to load" instead of "load with a warning"

A plugin's `init()` may register actions, schedule routines, write to
plugin-private storage, or open an HTTP connection. If the runtime
contract has shifted — say, a service it depends on now returns a
different shape — those side effects may corrupt host state in ways
that surface only on the next mission run, when debugging the plugin
is hard.

Failing fast at load time means:

* The host operator sees a clear "this plugin needs an update" badge.
* No half-initialized plugin state ends up in Postgres.
* Other plugins are unaffected — the loader continues past the failed
  one.

## The "minor bump everywhere" frustration

Plugin authors sometimes want to declare `papercusp: "*"` to dodge the
range game entirely. Don't.

`*` opts you out of the only mechanism that gives you a chance to react
to a breaking change before your users hit it. Declaring `^X.Y.Z` (with
the runtime version current at publish time) is the right default; the
loader's strict-by-default behavior is the SLA you depend on when
shipping a real plugin.

## See also

* [Implementation status](/internal/docs/implementation/status) — current runtime version + recently shipped surface.
* The CHANGELOG at `@papercusp/plugin-sdk/CHANGELOG.md`.

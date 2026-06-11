# 7. Plugin extension points & runtime
URL: /internal/docs/spec/plugins



Plugins extend a Papercusp install along six axes:

Extension pointWhat it addsPlugin SDK type

RolesNew named agent invocations the orchestrator can dispatch`RoleDefinition`
Lifecycle hooksCode that runs before/after iteration phases (e.g. `onPostValidator`)`LifecycleHooks`
UI (full-route)A complete React panel mounted at `/harness/&lt;slug&gt;` — see §8`UiContribution`
API routesHTTP endpoints under `/api/plugins/&lt;name&gt;/*``ApiRoute[]`
DB schemaPostgres migrations under the plugin's own schema`SchemaMigration[]`
RoutinesCron / webhook / API triggers that insert into `pending_events` — see §9`RoutineDefinition[]`

Plugins also declare capabilities (§10) — a permission manifest that the runtime enforces at the DI boundary. Sections 7.1–7.5 below describe the substrate-level concerns that apply to every plugin regardless of which axes it extends.

### 7.1 Inter-plugin dependencies

Plugins frequently rely on services or hooks declared by other
plugins. The substrate makes this dependency explicit in the
manifest so install-time resolution can refuse incoherent
configurations rather than fail at runtime.

```json
// papercusp.json:
{
"name": "shareholder-briefings",
"version": "1.2.0",
"requires": {
// Hard dependency — install fails if not satisfied.
"audit-log": "^1.0",
// Optional — plugin loads either way; check `api.hasPlugin('papercup')` at runtime.
"papercup": { "version": "^0.0.3", "optional": true }
}
// ...
}
```

Resolution at install time.

```
$ papercusp install shareholder-briefings@1.2.0

shareholder-briefings@1.2.0 requires:
audit-log    ^1.0    ✓ found (audit-log@1.4.2 installed)
papercup     ^0.0.3  ⚠ not installed (optional)

Continue? [Y/n]: y
```

If a hard `requires` entry is missing or version-incompatible,
the install aborts with a one-line `papercusp install &lt;dep&gt;`
suggestion. Optional dependencies surface as warnings only;
the plugin must check `api.hasPlugin(name)` at runtime and
degrade gracefully when absent.

Cascading uninstall. Removing plugin A while
plugin B has `requires: { 'A': '^1.0' }` aborts by default; the
user must explicitly `papercusp uninstall A --cascade` (which
uninstalls B too, after a per-plugin confirmation) or
`--orphan` (which leaves B installed but disabled, with a banner
in the UI explaining why).

Runtime version pinning. Independently of
plugin-to-plugin deps, every manifest declares the substrate
runtime semver range it was built against, via the
papercusp field:

```json
// papercusp.json:
{
// ...
"papercusp": "^0.1.0"   // refuses to load outside this range
}
```

This is the same versioning shape as service ABI pinning
(§8.4.1), but at the runtime level. The loader runs
satisfies(PAPERCUSP\_RUNTIME\_VERSION, manifest.papercusp)
on every load and rejects out-of-range plugins, catching the case
where a plugin built against an old runtime would otherwise hit
subtle API drift bugs. (A separate protocol field
pins the plugin-wire protocol — see the runtime roadmap.)

### 7.2 Plugin lifecycle states

Every installed plugin is in exactly one of these states. The
substrate tracks state for plugins installed under
\~/.papercusp/global-plugins/\<name>/ and exposes it
via papercusp plugin list.

StateMeaningHooks fire?UI mounted?

installed
Tarball extracted, migrations run, capabilities granted, but never activated yet (or has been disabled).
No
No

active
Normal running state. Listening to hooks, mounting UI, accepting role dispatches.
Yes
Yes

disabled
User-initiated. Configuration and DB schema retained.
No
No

quarantined
Substrate-initiated after the crash circuit breaker (§7.3) trips. Same as disabled but with a UI banner explaining why and a "re-enable after fix" button.
No
No

updating
Transient. New version downloaded; capability diff being prompted; migrations running. Old version's hooks paused, UI replaced with a spinner.
Paused (queued)
Spinner

uninstalling
Transient. Hooks unregistered; UI unmounted; routines stopped; schema dropped (after confirmation).
No
No

Allowed transitions:

```
        install
           │
           ▼
      installed ─────────► uninstalling ─► (gone)
           │  ▲
  activate │  │ disable
           ▼  │
        active ◄─────► quarantined
           │  ▲
           │  │
           ▼  │
        updating
           │
           ▼
        active (or rolled back to installed if migration fails)
```

Substrate guarantees. While a plugin is in
a transient state (updating, uninstalling),
the substrate enqueues hook fires for it; on transition back to
active within a 30-second window, queued events are
delivered. After 30s they're dropped with an entry in
audit.hook\_executions. This avoids both the silent-loss
footgun and the unbounded queue growth footgun.

State changes never silently fail. Every
transition writes a row to audit.plugin\_lifecycle
with the trigger, the actor (substrate vs user), and any error.
papercusp status \<name> shows the current
state and the last 5 transitions inline.

### 7.3 Crash circuit breaker

Plugins fail. The substrate must not let one plugin's bugs take
down the whole install. The circuit breaker is per-plugin,
per-fault-class:

Fault classThresholdAction

Hook handler throws
5 throws within any 60s window for the same hook
That hook handler is removed from the chain. The plugin stays active; other handlers and hooks are unaffected. Audit row written.

Hook handler hangs past timeout
3 timeouts within any 60s window
Same: handler removed, plugin stays active.

Init function throws
Any throw on onLoad() during activation
Plugin transitions to quarantined. UI shows the throw + stack. papercusp enable \<name> retries init.

Migration throws
Any throw during papercusp install or update
Substrate rolls back the partial migration (transactional DDL where supported), plugin stays in installed at the prior version. User sees the migration error.

UI component renders error 5x in a row
5 consecutive React error-boundary catches
UI surface unmounted; rest of the plugin (hooks, routines) keeps running. UI shows a "this surface crashed — see logs" inline placeholder.

Iframe widget fails to load
3 load failures in 60s
Iframe widget hidden; placeholder shown. Plugin's other surfaces continue.

Defaults are spec-defined; per-plugin overrides via
manifest circuitBreaker field require user opt-in
at install consent (treated as a medium-tier capability).
A plugin author cannot silently raise their own thresholds.

All circuit-breaker actions are audit-logged with the fault
history. `papercusp logs &lt;name&gt; --circuit-breaker`
shows recent trips for debugging.

### 7.4 Failure-mode taxonomy

Substrate behavior must be defined for every failure class —
otherwise authors guess and the install feels flaky. The
substrate enumerates these and documents the response:

FailureSubstrate behaviorWhat the plugin author does about it

Capability revoked mid-call
DI proxy throws MissingCapabilityError (§10.7).
Wrap DI calls in try/catch; degrade to a no-op or prompt the user to re-grant.

Required dependency uninstalled (with `--orphan`)
Plugin transitions to quarantined; UI banner names the missing dep.
Nothing — the user resolves by reinstalling the dep or uninstalling this plugin.

Hook handler hits a deadline
Per-hook timeout (default 5s, override in manifest with capability `hooks:long-running`). Handler is cancelled; circuit breaker increments.
Move long work to a routine; hooks are advisory, not for heavy lifting.

Plugin's API route throws
Substrate returns 500 with the plugin name and a request id; full stack in `audit.api_errors`.
Standard HTTP error handling; the substrate does not retry.

Plugin's routine fire times out
Marked as `failed` in `routine_fires` after the configured deadline; counts toward routine pause threshold (§9.4).
Either reduce work, raise the deadline (via manifest), or split into smaller routines.

Service ABI mismatch on substrate upgrade
Plugin refuses to load (§8.4.1). Status: installed not active. UI shows version mismatch.
Bump the manifest's service range and republish.

Plugin claims a UI slot id another plugin owns
Install-time abort (§10.5). User picks `--rename-id`, `--replace`, or `--supplement`.
Author should publish with a plugin-prefixed id by default.

Unhandled exception in plugin code (anywhere)
Logged to `audit.plugin_errors` with stack + plugin version + recent context. Does not propagate to the substrate's main loop.
Same as any production bug — read the audit log.

Migration fails partway through `papercusp update`
Substrate attempts transactional rollback. If DDL is non-transactional (e.g. some CREATE INDEX CONCURRENTLY) the substrate refuses to apply it without `--allow-non-transactional` and a confirmation. Failed update leaves the plugin at the prior version.
Provide an explicit `down()` migration; test the up→down→up cycle locally.

Plugin tarball corrupt or signature invalid
Install aborted before any filesystem changes. Audit row in `audit.install_attempts`.
Republish; the marketplace re-verifies on upload.

Every behavior here is enforced by the substrate, not the plugin.
A plugin author writes their code and trusts the substrate
to handle the failure cases above — same as a Node program trusts
the OS to handle a SIGSEGV.

### 7.5 Developer experience

The inner loop for plugin authors determines whether the marketplace
ever has third-party content. The substrate ships an opinionated
dev mode aimed at sub-second iteration:

Implemented (current state): the shipped author commands are
papercusp plugin init \<name> \[--template \<slug>]
(scaffold from a reference plugin — default cloudflare-stack),
papercusp plugin lint, papercusp plugin doctor,
and papercusp plugin watch \<slug>. The manifest is a
papercusp.json file (not a TS file); plugins symlink into
\~/.papercusp/global-plugins/ for local dev. The
papercusp dev single-command hot-reload session sketched
below is design intent — see the
authoring quickstart
for the current workflow and the
runtime roadmap
for what shipped vs. deferred.

```
$ papercusp dev ./my-plugin

==> Linked ./my-plugin into ~/.papercusp/installed/my-plugin/ (symlink)
==> Watching: src/**, papercusp.manifest.ts, migrations/**, public/**
==> Substrate state: my-plugin@dev (state=active, hot-reload=on)
==> http://localhost:3055/                ← substrate UI
==> http://localhost:3055/harness/my-plugin   ← your UI surface

[hot-reload] src/components/Tab.tsx changed → React Refresh applied (no remount)
[hot-reload] papercusp.manifest.ts changed → manifest revalidated; new capabilities require consent (paused)
[hot-reload] migrations/0002_add_foo.sql added → applied (foo column exists)
```

Substrate guarantees in dev mode:

UI components hot-swap. React Fast Refresh
is preserved across the substrate-plugin boundary. Component
state survives unless the export shape changes.
Hook handler swaps. Editing a handler's body
replaces the registered function on next file save. In-flight
handler calls continue with the old function; the next fire
uses the new one.
Service ABI mismatches surface immediately
as a substrate banner instead of a runtime crash.
Schema migrations auto-apply on file change.
New `up.sql` files run in order; new `down.sql` siblings allow
the substrate to reverse a migration when the file is reverted
(`papercusp dev --no-auto-migrate` opts out).
Capability changes pause the plugin with a
single-line consent prompt rather than auto-granting in dev.
The author must approve, just as users will. This catches the
"works on my machine, fails on user install" failure mode.
Routines fire at 10× normal cadence when
`papercusp dev --fast-routines` is set, so cron jobs are
observable in a 5-minute session instead of waiting an hour.

What dev mode does not do:

It does not bypass capability checks. A plugin that needs
`secrets:read:FOO` in production needs it in dev too.
It does not change the wire format of any DI service or
hook payload. What works in dev works in install — modulo
environment differences.
It does not auto-publish. Publishing is always
`papercusp publish`, an explicit user action.

Plugin SDK scaffolding.

```
$ papercusp plugin init my-plugin --template cloudflare-stack

==> Creating ./my-plugin/
package.json
papercusp.json
index.cjs
provision/setup.sh
README.md
...

==> Done. Next:
cd my-plugin && papercusp plugin lint
```

papercusp plugin init copies an existing reference
plugin (default cloudflare-stack) and rewrites every
reference to the new slug; --template \<slug> picks
a different starter and --from-path \<dir> forks a
local checkout. Because the scaffold is a real first-party plugin
under libs/papercusp/plugins/, the output is verifiable
from source.

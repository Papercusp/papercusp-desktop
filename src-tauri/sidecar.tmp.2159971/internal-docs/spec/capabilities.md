# 10. Capability-gated plugin permissions
URL: /internal/docs/spec/capabilities



Three layers, modeled on Tauri's capability files + Browser Manifest V3 install consent + Cap'n-Proto-style typed proxies:

### 10.1 Manifest declaration

```
const plugin: PapercuspPlugin = {
  name: 'shareholder-briefings',
  capabilities: [
    // Data access (scoped):
    'tasks:read',
    'comments:write',
    'features:read',
    'routines:write',

    // Plugin-private resources (always granted; declarative):
    'storage:plugin-private',
    'db:plugin-schema',

    // Network — manifest declares allowed domains; iframe CSP enforces:
    'http:fetch:youtube.com',
    'http:fetch:googleapis.com',

    // UI surfaces this plugin claims:
    'ui:dashboard-tab',
    'ui:sidebar-item',

    // Secrets — by name, no wildcard:
    'secrets:read:YOUTUBE_API_KEY',

    // Hooks:
    'events:emit:briefing-ready',
    'events:listen:task-completed',

    // Roles to register:
    'roles:register:narrator',
  ],
};
```

### 10.2 DI container runtime check

```
function createPluginContext(plugin: LoadedPlugin): PapercuspApi {
  return {
    tasks: makeServiceProxy(plugin, TasksService),
    comments: makeServiceProxy(plugin, CommentsService),
    routines: makeServiceProxy(plugin, RoutinesService),
    secrets: makeSecretsProxy(plugin),
    fetch: makeFetchProxy(plugin),     // checks domain against http:fetch:* allowlist
    storage: makePluginStorage(plugin),
    db: makePluginDb(plugin),
    hooks: makeHookBus(plugin),         // checks events:listen:* / events:emit:*
  };
}

function makeServiceProxy(plugin, service) {
  return new Proxy({}, {
    get: (_, method) => {
      const requiredCap = service.methods[method]?.capability;
      if (!requiredCap) throw new MethodNotAllowedError(service.name, method);
      if (!plugin.capabilities.includes(requiredCap)) {
        throw new MissingCapabilityError(plugin.name, requiredCap);
      }
      return realServices[service.name][method];
    }
  });
}
```

### 10.3 Install-time user consent

```
$ papercusp install shareholder-briefings@1.2.0

shareholder-briefings@1.2.0 requests these permissions:

  Read your tasks
  Write comments on tasks
  Register routines (scheduled work)
  Read your YOUTUBE_API_KEY secret
  Make HTTP requests to: youtube.com, googleapis.com
  Add a dashboard tab + sidebar item
  Register a 'narrator' role

Approve all? [y/N/per-capability]: y

Saved to ~/.papercusp/installed/shareholder-briefings/granted-capabilities.json
```

Permissions can be revoked per-capability later via `papercusp permissions revoke &lt;name&gt; &lt;cap&gt;`.

### 10.4 Iframe sandbox network enforcement (v2)

```
<iframe
  src="..."
  sandbox="allow-scripts"
  csp="default-src 'self'; connect-src https://youtube.com https://googleapis.com"
/>
```

Even if a plugin's JS is malicious, it physically cannot reach an unlisted domain. Multiple defenses (manifest + DI proxy + CSP) so that bypassing any one isn't sufficient.

### 10.5 Cross-plugin coordination & conflict resolution

Multiple plugins inevitably want the same surface. The substrate resolves conflicts at install or load time, never silently. Three classes of conflict:

UI surface conflicts (tabs, sidebar items, routes)

Each UI contribution declares a global `id` (e.g. `dashboardTabs[].id = "directives"`). At install time, the substrate checks the registry for collisions:

```
$ papercusp install foo

Error: foo declares dashboardTab id "directives" but papercup already
owns it. Either:
--rename-id directives:foo-directives    (mount as separate tab)
--replace                                (replace papercup's tab — papercup must not be installed)
--supplement                             (run as a sibling action when papercup's tab is rendered; requires papercup to declare it as a slot)
Aborted.
```

Default behavior is abort. The user explicitly picks the resolution. This avoids "I installed plugin X and my dashboard broke" silent breakage.

Hook chain conflicts

Multiple plugins listening to the same hook are not a conflict — they're a chain (§8.5.1). Authors pick priorities. The substrate logs the full chain to `audit.hook_executions` so you can debug surprising filter outputs.

Schema namespace conflicts

Each plugin owns its own Postgres schema (`papercup_shared`, `briefings`, etc.). Two plugins claiming the same schema is rejected at install time. Plugins that share data do so via the substrate's typed services — never by writing into another plugin's schema directly. Cross-plugin reads through the substrate are gated on `data:read:&lt;plugin-name&gt;:&lt;table&gt;` capabilities.

Tenant isolation

When two substrate installs run side-by-side (personal + work), they default to a per-install Postgres database. The plugin schema name (`papercup_shared`) is scoped within the install's DB, so the same plugin running in two installs writes to two independent schemas. Substrate explicitly does not support shared-database multi-tenancy — operators that need multiple users on one DB run their own row-level-security policies on top.

### 10.6 Mitigating permission fatigue

Browser/Android permission systems all converge on the same failure mode: users blindly approve everything because the manifests are long and abstract. Papercusp mitigates with four policy choices baked into the consent flow (§10.3):

Tier capabilities by impact, not count. See §10.6.1 below — the substrate caps high-impact capabilities aggressively (3 default), while low-impact ones (internal reads, UI mounts) are unlimited. This is more honest than counting raw capabilities, since "26 capabilities" can be either trivial (a reference plugin like Papercup) or alarming (a generic plugin reading every secret).

Group at consent. See §10.6.2 — the CLI prompt collapses related capabilities into a single user-facing decision. "Read 3 secrets: A, B, C" is one line, not three. "Network access: youtube.com, googleapis.com" is one line, not two. A plugin declaring 26 capabilities typically reduces to 5–7 user-visible decisions.

Order by blast radius. The grouped-and-tiered list is sorted with secrets and outbound network at the top, internal reads at the bottom. The user reads "Read your YOUTUBE\_API\_KEY" before "Add a sidebar item".

Default-deny new capabilities at update time. When `papercusp update` finds new capabilities in the new version, it prompts only for those — previously-granted ones aren't re-asked. If the user denies, the install runs at the old version's capability set; the plugin must check `api.hasCapability()` and degrade gracefully. See §10.8 for full lifecycle.

#### 10.6.1 Capability tiers

Each capability declared in §10.1 has a tier assigned by the spec.
Tiers are not configurable per-install — they're a property of the
capability namespace itself.

TierExamplesDefault capOverride

low
`tasks:read`, `features:read`, `goals:read`, `ui:dashboard-tab`, `ui:sidebar-item`, `ui:harness-route`, `storage:plugin-private`, `db:plugin-schema`
unlimited
—

medium
`tasks:write`, `comments:write`, `routines:read`, `routines:write`, `events:emit:*`, `events:listen:*`, `roles:register:*`
10
`--allow-medium-cap-overage`

high
`secrets:read:*`, `secrets:write:*`, `http:fetch:*`, `data:read:<plugin>:*` (cross-plugin), `events:guard:*`, `routines:rate-limit-bypass:*`, `budget:daily:*-usd`
3
`--allow-high-cap-overage` (with explicit user confirmation per cap above the cap)

A plugin requesting 4 high-impact capabilities (e.g. 3 outbound
domains plus 1 secret) hits the high-tier cap and triggers a
dedicated "this plugin requests substantial trust" warning before
the regular consent prompt. A plugin requesting 26 low-tier
capabilities (Papercup) sails through with no overage prompt at all.

The reference plugin Papercup declares 26 capabilities total, broken
down as \~16 low (read access + UI surfaces +
plugin-private storage), \~7 medium (writes +
routines + role registrations), and \~3 high
(cross-plugin reads + outbound network) — fitting cleanly under all
three tier caps without any overage flags.

#### 10.6.2 Grouped consent

At consent time, the substrate collapses related capabilities into
single user-facing lines. The grouping rules are part of the spec
(not per-plugin), so two plugins that ask for similar things present
the user with similar prompts.

Grouping rules:

`secrets:read:A`, `secrets:read:B`, `secrets:read:C` → one line: "Read 3 secrets: A, B, C"
`http:fetch:youtube.com`, `http:fetch:googleapis.com` → one line: "Network access: youtube.com, googleapis.com"
`events:listen:X`, `events:listen:Y` → one line: "Subscribe to 2 hooks: X, Y" (only listed if \<=5 hooks; more get summarized)
`events:emit:X`, `events:emit:Y` → one line: "Emit 2 plugin-defined hooks: X, Y"
`roles:register:R1`, `roles:register:R2` → one line: "Register 2 roles: R1, R2"
`tasks:read` + `tasks:write` → one line: "Read and write your tasks" (read-only and read-write are different lines)

Worked example for a plugin declaring 26 capabilities (Papercup):

```
$ papercusp install papercup@0.0.1

papercup@0.0.1 requests these permissions:

HIGH-IMPACT:
✓ Read your tasks, features, goals, projects, and comments
✓ Write to your tasks, features, goals, projects, and comments

MEDIUM-IMPACT:
✓ Read and register routines
✓ Register 5 roles: orchestrator, worker, validator, documenter, curator
✓ Emit 4 plugin-defined hooks: directive-routed, proposal-accepted, budget-allocated, project-launched
✓ Subscribe to 2 hooks: market-signal, capability-released

LOW-IMPACT:
✓ Mount UI surfaces (dashboard tab, sidebar item, harness route)

Approve all? [Y/n/per-line]: y
```

The user makes seven decisions, not 26. The
underlying granted-capabilities.json still records all 26 — grouping
is purely a presentation concern.

### 10.7 Capability lifecycle and revocation

Capability state is read from in-memory state on every method
invocation through the DI proxy — never from disk on the hot
path. The substrate maintains a per-install `Set<Capability>`
in memory; revocation events (CLI command, UI toggle, programmatic
revoke) update both that in-memory set and the install's
`granted-capabilities.json` file atomically. A long-lived
plugin reference like `const tasks = api.tasks` does not
cache the granted state — but reading the in-memory Set is O(1) per
call, not a disk read.

Substrate authors implementing this: keep a durable record-of-truth
(survives restart), but treat the in-memory Set as the runtime
authority. On startup, load the durable record into memory; on
revocation, update memory first, then persist.

Implementation note: in the shipped operator the durable
record-of-truth is Postgres — harness\_shared.plugin\_capability\_grants
(Migration 051), not the file. The CLI consent flow (§10.3) still writes
\~/.papercusp/granted-capabilities.json, but the operator
treats that file as a read-only legacy fallback for installs that predate
the PG store; runtime checks go through plugin-grants.ts's
hasCapability(), which ANDs the manifest caps with the
granted set from PG.

```typescript
// User runs: papercusp permissions revoke briefings tasks:read
// Mid-session, while briefings has an open `api.tasks` reference:

const tasks = api.tasks;     // proxy created with current grants
await tasks.list();          // ✓ if tasks:read still granted
// ... user revokes tasks:read ...
await tasks.list();          // throws MissingCapabilityError immediately
```

Plugins should always wrap DI calls in try/catch and degrade
gracefully when capabilities are revoked mid-session — same pattern
as a network call failing. The substrate will not auto-pause a plugin
on first revocation error; that's a routine-level concern (§9.4).

### 10.8 Capability changes across plugin updates

When `papercusp update &lt;plugin&gt;` finds capability
changes in the new version, the substrate handles each change class
differently:

ChangeSubstrate behaviour

Capability added
Prompt user for the new capability only. If denied, install runs at old version's grants — plugin must check `api.hasCapability()` and degrade.

Capability removed
Silently drop from granted-capabilities.json. No prompt. Plugin no longer has access (or needs access). Audit log records the removal.

Capability renamed (via manifest `aliases` field)
Substrate honors the alias mapping during update. User sees no prompt; the granted state migrates automatically. Plugin authors declare an alias map in their manifest, e.g. mapping `tasks:read-old` to `tasks:read`.

Major version bump (`1.x → 2.0`)
All capabilities re-prompted from scratch. The `aliases` field is ignored. This is the "clean slate" path — equivalent to Android's targetSdkVersion increment forcing permission re-consent.

Tier escalation (a cap moved from medium to high in spec)
Substrate flags the change, prompts user to reapprove explicitly. This is rare (the spec rarely re-tiers caps) but the escalation path matters when it happens.

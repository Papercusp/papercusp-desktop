# The workspaces root lives above the HOME-remap boundary
URL: /internal/docs/agent-insights/workspaces-root-vs-remapped-home

The packaged desktop spawns the operator sidecar with HOME remapped to the active workspace dir, so any TS code resolving ~/.papercusp-workspaces via homedir() lands in a nested per-workspace registry that disagrees with the Rust shell. Resolve the root from PAPERCUSP_WORKSPACES_ROOT instead.

## The trap

`~/.papercusp-workspaces/` holds the workspace **registry.json** plus every
per-workspace directory. It is **bootstrap state that lives above the
per-workspace isolation boundary** — there is exactly one of it per install,
shared by every workspace.

But the packaged desktop spawns the operator sidecar with `HOME` **remapped to
the active workspace dir** (`main.rs`: `.env("HOME", &workspace_home_str)`,
where `workspace_home = ~/.papercusp-workspaces/<current>`). So inside the
sidecar:

```ts
import { homedir } from 'node:os';
join(homedir(), '.papercusp-workspaces', 'registry.json')
// → ~/.papercusp-workspaces/<current>/.papercusp-workspaces/registry.json
//   a NESTED registry, one level inside the active workspace
```

The Rust shell is **never** remapped, so its `switch()` / `ensure_initialized()`
read the real top-level `~/.papercusp-workspaces/registry.json`. The two
disagree. Symptoms:

* A nested junk registry appears at
  `~/.papercusp-workspaces/<ws>/.papercusp-workspaces/registry.json` (and
  nested `backups/`, `db-dumps/`, `clones/` if those resolvers were affected too).
* Entries the operator-side bootstrap writes (e.g. `ensurePapercuspWorkspace`)
  never reach the registry the Rust `switch()` consults — surfacing as
  `switch failed: workspace dir for <id> missing`.

It is **invisible in dev**: `npm run dev` runs the operator with the real
`HOME`, so `homedir()` happens to resolve correctly. The bug only bites in the
packaged build.

## The rule

Resolve the workspaces root from the explicit env the desktop passes, not from
`homedir()`:

```ts
// packages/operator-core/lib/workspace-registry.ts
export function workspacesRoot(): string {
  const env = process.env.PAPERCUSP_WORKSPACES_ROOT;
  if (env && env.trim()) return env;
  return join(homedir(), '.papercusp-workspaces'); // dev fallback — HOME not remapped
}
```

`main.rs` passes `PAPERCUSP_WORKSPACES_ROOT = workspaces::workspaces_root()`
(the real root) to the sidecar. The `homedir()` fallback keeps dev behavior
identical, so migrating call sites is a no-op in dev and a fix in packaged mode.

**Any path that resolves `~/.papercusp-workspaces` must go through
`workspacesRoot()`** — registry, per-workspace dirs, `clones/`, `backups/`,
hyperbee stores. A bare `join(homedir(), '.papercusp-workspaces', …)` is the
smell.

## Related invariant

A registry entry and its on-disk directory are **two halves of one invariant**:
the Rust `switch()` guard refuses to switch to a registered workspace whose dir
is missing. Any code that adds a registry entry must also provision the dir
(`ensureWorkspaceDir`). See also \[\[forward-defined-registry-entries]].

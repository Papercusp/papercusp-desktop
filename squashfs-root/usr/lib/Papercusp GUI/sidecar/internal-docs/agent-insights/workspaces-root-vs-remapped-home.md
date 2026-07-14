# The workspaces root lives above the HOME-remap boundary
URL: /internal/docs/agent-insights/workspaces-root-vs-remapped-home

Any TS code resolving ~/.papercusp-workspaces via homedir() is fragile when the caller's HOME is remapped (per-workspace child processes under P-051). Resolve the root from PAPERCUSP_WORKSPACES_ROOT instead — main.rs always passes it. Phase E (P-050) moved the sidecar itself to shared_sidecar_home() = real HOME, so the original sidecar-level trap is resolved, but the rule stands for spawned children.

## The trap

`~/.papercusp-workspaces/` holds the workspace **registry.json** plus every
per-workspace directory. It is **bootstrap state that lives above the
per-workspace isolation boundary** — there is exactly one of it per install,
shared by every workspace.

**Historical context (Phase D — before 2026-06):** the packaged desktop used to
spawn the operator sidecar with `HOME` **remapped to the active workspace dir**
(`main.rs`: `.env("HOME", &workspace_home_str)`, where
`workspace_home = ~/.papercusp-workspaces/<current>`). Inside that sidecar:

```ts
import { homedir } from 'node:os';
join(homedir(), '.papercusp-workspaces', 'registry.json')
// → ~/.papercusp-workspaces/<current>/.papercusp-workspaces/registry.json
//   a NESTED registry, one level inside the active workspace
```

This made the sidecar's registry disagree with the Rust shell's, surfacing as
nested junk registries and `switch failed: workspace dir for <id> missing`.

**Current state (Phase E, P-050 / D-008 — landed 2026-06):** the sidecar now
runs under the **real user HOME** via `workspaces::shared_sidecar_home()`
(= `real_home()`). One shared sidecar serves ALL workspaces; per-workspace
credential isolation moves to each **spawned child's** HOME, set operator-side
from the job's workspace (P-051). The sidecar's own `HOME` is no longer
remapped.

The original sidecar-level trap is therefore resolved. **The rule below still
applies** because:

1. `main.rs` still passes `PAPERCUSP_WORKSPACES_ROOT` explicitly (belt-and-
   suspenders: future HOME changes won't silently break registry resolution).
2. Spawned CLI children (claude, git, pi, spawned agents) can have their HOME
   overridden to a per-workspace dir (P-051) — any registry-touching code
   running in those children that uses bare `homedir()` would hit the same
   nested-registry trap.

It is **invisible in dev** regardless of phase: `npm run dev` runs the operator
with the real `HOME`, so `homedir()` happens to resolve correctly. Packaged-
build differences only emerge if HOME-remapping returns for a new context.

## The rule

Resolve the workspaces root from the explicit env the desktop passes, not from
`homedir()`:

```ts
// packages/operator-core/lib/workspace-registry.ts
export function workspacesRoot(): string {
  const env = process.env.PAPERCUSP_WORKSPACES_ROOT;
  if (env && env.trim()) return env;
  return join(homedir(), '.papercusp-workspaces'); // dev fallback — HOME not remapped in sidecar
}
```

`main.rs` always passes `PAPERCUSP_WORKSPACES_ROOT = workspaces::workspaces_root()`
(the real root, derived from the Rust-side `real_home()`) to the sidecar,
regardless of what `HOME` is set to. The `homedir()` fallback keeps dev behavior
identical (and also correct in Phase E, since the sidecar HOME is no longer
remapped). For any child process spawned with a per-workspace HOME (P-051), the
`PAPERCUSP_WORKSPACES_ROOT` env is the only reliable anchor.

**Any path that resolves `~/.papercusp-workspaces` must go through
`workspacesRoot()`** — registry, per-workspace dirs, `clones/`, `backups/`,
hyperbee stores. A bare `join(homedir(), '.papercusp-workspaces', …)` is the
smell.

## Related invariant

A registry entry and its on-disk directory are **two halves of one invariant**:
the Rust `switch()` guard refuses to switch to a registered workspace whose dir
is missing. Any code that adds a registry entry must also provision the dir
(`ensureWorkspaceDir`). See also \[\[forward-defined-registry-entries]].

# Named resource locks with drain
URL: /internal/docs/agent-spawning/named-resource-locks

Shared/exclusive locks on registered named resources (the dev server, the DB schema) with a writer-priority drain, broadcasts, and a defineTool-level enforcement path — for coordinating destructive shared actions across the agent fleet.

import { Aside } from '@astrojs/starlight/components';

File locks (`locks:acquire`) guard *files* — exclusive-per-path. **Named
resource locks** guard shared *resources* — the dev server, the DB schema —
where many agents can *use* a resource at once but only one can *restart /
mutate* it. They live in the same `papercusp_su` substrate, reuse the same
`ch_coord_<domain>` NOTIFY channel and the `inWorkspaceTxn` advisory lock, and
are a **separate table** (`agent_resource_locks`) so the file-lock hot path is
untouched. Full design: plan `named-resource-locks-drain-2026-06-02`.

## The model

* **`shared`** — "I'm using it." Many holders coexist.
* **`exclusive`** — "I need to restart/mutate it." Granted only once shared
  holders drain to zero.

A pending `exclusive` is **writer-priority**: new `shared` acquisitions are
refused (`exclusive_pending`) while existing ones run to completion, then the
exclusive is granted. A crashed holder's lease TTL-expires (heartbeat keeps a
long hold alive); `max_drain_sec` caps the wait, after which the requester gets
`drain_timeout` and decides force-proceed or escalate.

```text
B,C hold SHARED ───────────────┐ (working)
R: acquire EXCLUSIVE → DRAINING │  new SHARED refused; broadcast "release please" → B,C
B,C release ───────────────────┘  shared == 0 → R granted EXCLUSIVE → acts → release → "back up"
```

## Registered names only

A resource must be pre-registered in `agent_resource_registry` to be
acquirable (`unknown_resource` otherwise) — free-form names silently fail to
coordinate (`dev-server` vs `devserver` → no mutual exclusion). The registry
is the one home for each lock's **rule text** and **enforcement level**
(the `enforcement` column: `advisory` | `checked` | `enforced`).
`locks:list` is the authoritative discovery surface (names, rules, live
holders, draining flag). Currently registered:

| Resource                   | Enforcement | What it guards                                                                                                                                                  |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev-server`               | `enforced`  | The operator dev server (`:3070` Hono + `:3055` Vite). Promoted advisory → enforced once the raw-Bash gate made `systemctl restart papercup` matchable (P-016). |
| `db-schema`                | `checked`   | The papercusp DB schema — migrations / destructive DDL.                                                                                                         |
| `shop`                     | `enforced`  | The shop build + `:4321` preview (stale-server e2e false-positives + concurrent dist clobbers).                                                                 |
| `desktop-sidecar`          | `enforced`  | The papercusp-desktop sidecar / embedded-pg bundle build (the recurring 0-byte-binary clobber).                                                                 |
| `libs-papercusp-submodule` | `advisory`  | The `libs/papercusp` submodule commit + superproject pointer bump (+ push).                                                                                     |
| `git-sync`                 | `advisory`  | The git-sync auto-commit/push routine.                                                                                                                          |

## The enforcement dial (per resource)

| Level      | What enforces it                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `advisory` | The rule (prompt) + the broadcast + `locks:list` visibility. Honor-system. The level for `libs-papercusp-submodule` + `git-sync` (no hookable "I'm using it" action).    |
| `checked`  | A tool / `locks:check_command` actively refuses while an exclusive is in flight (`db-schema`).                                                                           |
| `enforced` | A handler that cannot run without the lock (see below), or the `PreToolUse` Bash gate that hard-blocks a colliding raw command. `dev-server`, `shop`, `desktop-sidecar`. |

## Tools

* `locks:acquire_resource { resource, mode, wait?: { max_drain_sec } }` /
  `locks:release_resource` / `locks:heartbeat_resource`
* `locks:list` — registry + live holders + drain state.
* `locks:check_command { command }` — does a raw shell command touch a resource
  with an exclusive in flight? Returns `allow | warn | block`.

### Blessed wrappers

`dev:restart` and `db:migrate` are the canonical paths for the two destructive
actions. They run the whole drain protocol (acquire `exclusive` + drain →
act → release → "back up") via `guardResource`. **Dry-run by default**;
`confirm: true` acts, and the real exec is additionally env-gated
(`PAPERCUSP_ALLOW_DEV_RESTART` / `PAPERCUSP_ALLOW_DB_MIGRATE`) so they're safe
on a shared box.

## Enforcement: `guardResource` / `withResourceLock`

The `enforced` rung is a **handler HOF**, not a dispatcher interceptor:
`guardResource(spec, run)` acquires the lock, runs `run()` *only if acquired*,
and releases after — so a tool body cannot run without the lock.
`withResourceLock(spec, handler)` wraps a role-gated handler. This keeps the
borrowable, domain-free `tooldef` lib free of locks coupling (decision D-016).

`locks:check_command` + the registry `match_patterns` back a `PreToolUse`
`Bash` hook that gates raw destructive commands (`systemctl restart …`,
`psql -f …`) which bypass the wrapper tools. `install-standalone-mcp.sh` now
installs `pretooluse-bash-resource-gate.sh` and merges it as its **own**
`PreToolUse` entry (matcher `Bash`) into `~/.claude/settings.json` — so an
in-flight `exclusive` hold on a registered resource *blocks* a colliding raw
restart/migrate, not just warns. It is fail-open with a local keyword
pre-filter, so the vast majority of commands never reach the operator. This is
what let `dev-server` (and the build resources) be `enforced` rather than
advisory.

## Lifecycle notes

* **Delivery is event-push**, never polling: drain completion wakes the
  exclusive waiter via PG `NOTIFY`; "release please" / "back up" ride the coord
  message surface (the same one the mid-turn injection hook reads) and
  `fireNotifications` to `resource:<name>` watchers.
* **Session-end** `locks:release { all_mine: true }` clears named-resource
  locks **and** file locks (separate tables, one call) — TTL is the backstop
  for a crashed session.
* **Not a world mutex.** Dispatch/hook enforcement binds *agents going through
  the operator*; a human at a terminal, paperclip, or the Tauri shell never hit
  it, so for them only the advisory rule + the broadcast apply.

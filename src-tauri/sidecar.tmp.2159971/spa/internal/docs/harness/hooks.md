# Lifecycle hooks
URL: /internal/docs/harness/hooks

Out-of-band shell scripts in .papercusp/hooks/ that the DBOS finalizer runs at mission boundaries — plus how plugin hooks fire alongside them.

Lifecycle hooks are user-supplied shell scripts that the harness runs at fixed
pipeline boundaries. Drop an executable script at
`<project>/.papercusp/hooks/<name>.sh` and the engine invokes it when the
matching event fires. The runner is `runHook()` in
`libs/papercusp/packages/orchestrator/src/hooks.ts`: it looks up
`<stateDir>/hooks/<name>.sh`, skips silently if the file is missing or not
executable (owner-execute bit), runs it with `cwd` set to the project
directory, captures combined stdout+stderr to
`<stateDir>/logs/hooks/<unix-seconds>-<name>.log`, and logs a non-zero exit as
a warning — a failing hook never halts the mission. On Windows the script
needs `bash` on `PATH` (Git for Windows ships one); the desktop bootstrap
surfaces that prerequisite.

## Why hooks instead of in-prompt actions

This is design intent carried over from the first harness generation, and it
still holds: hooks are **out-of-band**. They consume no tokens, add no latency
to any LLM call, and fire **deterministically** — not "if the agent decides
to". Anything you'd otherwise bolt onto a role prompt as "and also send a
Slack message" belongs in a hook, keeping each prompt focused on the role's
one job.

## Hooks that fire today

The legacy bash run-loop fired twelve hook events; that loop is retired
(`libs/papercusp/_retired/orchestrator-run-loop/`). In the current DBOS
pipeline, hooks fire from the **finalizer** — the step list that
`planFinalization()` builds when a feature pipeline ends in DONE or ESCALATE
(`packages/operator-core/lib/dbos/orchestrator-finalize.ts`). Two hook names
are wired:

| Hook          | Fires                                                                                      | Event-specific env                                       | Call site                    |
| ------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------- |
| `on-escalate` | Pipeline finalizes with **ESCALATE**, before the `onEscalate` recipe roles run             | `REASON`, `PROJECT_DIR`, `STATE_DIR`                     | `orchestrator-runner.ts:641` |
| `afterDone`   | Pipeline finalizes **DONE** (and the done-gates pass), after the `onDone` recipe roles run | `TRIGGER=done`, `FEATURE_ID`, `PROJECT_DIR`, `STATE_DIR` | `orchestrator-runner.ts:657` |

A blocked DONE (an open needs-human plan item) skips the whole finalization
step list, hook included.

`runHook()` itself accepts any name — the engine isn't limited to these two —
but no other call site exists in the live tree, so no other event fires. The
pre/post-worker, validator, smoke, checkpoint and competition hooks from the
bash era retired with the run-loop.

### The `afterDone` builtin

`afterDone` has a TS builtin behind it: when **no** user hook script ran, the
finalizer calls `notifyParentOnDone()`
(`packages/operator-core/lib/dbos/notify-parent-done.ts`), which posts a
`Completion` message to this harness's sealed parent once the feature queue
drains — so a parent that spawned this harness as a child learns the sub-work
is done. A per-harness `hooks/afterDone.sh` **overrides the builtin entirely**
(parity with the retired bash builtin resolver). Plugin hooks fire regardless
(below).

## Environment a hook receives

On top of the event-specific variables in the table, `runHook()` auto-injects
context so scripts can query the operator instead of scraping harness files
(`hooks.ts:100–111`):

* `HARNESS_SLUG` — the current harness slug (defaults to the project
  directory's basename when not passed explicitly)
* `WORKSPACE_ID` — the active workspace, when known
* `OPERATOR_BASE` — operator API base URL; defaults to
  `$PAPERCUSP_OPERATOR_BASE`, then `http://localhost:3055`

The full process environment is inherited too; the caller's explicit env wins
over the injected values on conflict.

**Hooks must not read harness state from the filesystem.** Files like
`lanes.json` no longer exist at runtime — PG is the runtime store-of-record
(see [Storage policy](/internal/docs/system/storage-policy)). The contract in
`hooks.ts` is: query the operator API instead.

```bash
#!/usr/bin/env bash
# Example: .papercusp/hooks/afterDone.sh — look up feature state via the API
features=$(curl -fsS "$OPERATOR_BASE/api/harness/$HARNESS_SLUG/features")
status=$(echo "$features" | jq -r '.[] | select(.id == "'"$FEATURE_ID"'") | .status')
```

```bash
#!/usr/bin/env bash
# Example: .papercusp/hooks/on-escalate.sh — page a Slack channel
curl -X POST -H 'Content-type: application/json' \
  --data "{\"text\":\"Mission escalated: $REASON\"}" \
  "$SLACK_WEBHOOK_URL"
```

Make scripts executable (`chmod +x`) — a non-executable file is skipped
without error.

## Plugin hooks fire alongside

User hook scripts are per-harness; **plugins** hook the same lifecycle
globally. At the `afterDone` step the finalizer also calls `firePluginHook()`
(`libs/papercusp/packages/orchestrator/src/plugin-hooks.ts`), which discovers
plugins under `<projectDir>/plugins/`, `~/.papercusp/harnesses/*/plugins/` and
`~/.papercusp/global-plugins/` and invokes the named hook on each via the
`papercusp-fire-hook` CLI — one child process per plugin, so a misbehaving
plugin can't crash the pipeline. Output lands in
`<stateDir>/logs/plugins.log`; failures are logged and ignored. Plugin hooks
fire whether or not a user hook script ran. The in-process plugin host has a
separate lifecycle surface (`plugins:fire_event` tool /
`firePluginLifecycle`) — see [Plugins](/internal/docs/spec/plugins).

## Managing hook scripts over the API

`packages/operator-core/lib/endpoint-route/routes/harness/hooks.ts` exposes
CRUD for hook scripts: `GET /api/harness/:slug/hooks` (list known hooks with
content + executable bit), `PUT`/`DELETE /api/harness/:slug/hooks/:name`
(write with `chmod 755` / remove), and
`GET /api/harness/:slug/hook-logs/:logId` to read a hook-run log. The
`hooks:known` tool returns the same name list.

**Known staleness:** that name list comes from `getKnownHooks()`
(`packages/operator-core/lib/known-hooks.ts`), which greps
`orchestrator/src/main-loop.ts` for `runHook(` calls — but `main-loop.ts` was
retired with the run-loop, so the grep finds nothing and the function falls
back to `['pre-worker']`. Today the API therefore lists only `pre-worker` (a
hook that never fires) and rejects writes to `on-escalate`/`afterDone` (the
two that do). `runHook()` itself never consults this list, so scripts created
directly on disk work regardless. Treat `known-hooks.ts` as needing a re-point
at the live call sites.

## Related

* [Orchestrator + pending\_events](/internal/docs/spec/orchestrator) — the
  DBOS pipeline whose finalizer fires these hooks
* [Plugins](/internal/docs/spec/plugins) — plugin lifecycle states and hook
  handler semantics
* [Storage policy](/internal/docs/system/storage-policy) — why hooks query
  the API instead of reading harness files

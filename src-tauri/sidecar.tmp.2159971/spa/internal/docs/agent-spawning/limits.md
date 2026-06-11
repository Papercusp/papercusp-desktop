# Limits
URL: /internal/docs/agent-spawning/limits

What the spawn primitive does not do (yet) — the honest list of its edges, with workarounds where they exist.

These are the rough edges. Each one is real, each one has a reason, and each one has a path forward when a use case demands it. Until then they're documented so you can plan around them. (Two former limits — subtree cancel and an over-ceiling queue — are now built; they're noted below as resolved.)

## Cancel can't kill the OS process across restarts

`fleet:cancel` against a spawn this host launched fires the held `AbortController` immediately and the runner tears down the child's process group (SIGTERM → SIGKILL after 2s). Against a spawn that lives only in PG (the operator that launched it has since restarted), there is no live `AbortController` — the durable subtree flip to `cancelled` still happens and its claims/locks release, but the orphaned OS process keeps running until it exits on its own.

**Mitigation:** the heartbeat/reclaim sweep is the durability backstop — a dead host stops heartbeating, so its `running`/`restarting` rows go stale past `RECLAIM_STALE_MS` (5 min) and are reclaimed to `failed`, freeing the concurrency ceiling. It doesn't *kill* a still-running orphan process, but it stops one from wedging the ceiling forever. A pid-tracking SIGTERM watcher remains unbuilt and is no longer the planned path.

## Over-ceiling spawn queues on an await key, not a FIFO

The fleet concurrency ceiling is `maxSimultaneousAgents` (default 16, live-editable via `operator:rate_limit_config`, clamped ≤ `RATE_LIMIT_MAX_CEILING`) — not a hardcoded `MAX_CONCURRENT=10`. When the live `running`/`restarting` count is at the ceiling, `fleet:spawn` returns `ok:false` with an `await_event` key (`spawn-slot:freed:<workspace>`) instead of dropping or busy-waiting (D-004).

**Pattern:** the caller does `events:await { event: await_event }`, ends its turn, and retries the **same** spawn when woken — every slot-free (a completion or a reclaim) broadcasts the wake. It is a broadcast-and-recheck, not a granted-ticket FIFO: woken waiters re-check the ceiling on retry, with the await pump's per-tick resume cap pacing a mass wake. True ordered fairness would need a real queue.

## Subtree cancel — now built in

`fleet:cancel { spawn_id }` is **transitive**: it flips the named node AND every descendant in the durable subtree to `cancelled` in one transaction and releases each one's claims + locks immediately. A node's grandchildren are cancelled, not just its immediate child.

The one residual edge: only descendants this host launched are SIGTERMed in-process; descendants on another operator process get the durable flip + claim/lock release, and the heartbeat sweep reclaims their OS processes. `fleet:tree` shows the subtree before you cancel.

## The concurrency ceiling is durable (PG), shared across processes

The ceiling count is a live `SELECT count(*) … WHERE status IN ('running','restarting')` against `spawned_agents`, not a per-process in-memory counter. Two operator processes serving the same workspace draw from the **same** PG ledger, so the ceiling holds cluster-wide rather than multiplying per process. There is no separate depth or children-per-parent admission cap — the single concurrency ceiling is the only hard backstop (`MAX_TREE_DEPTH=32` in the recursive walks is a cycle guard, not an admission cap).

**Note:** the count costs a PG roundtrip per spawn — accepted as the price of a correct, restart-durable, multi-process ceiling.

## `output_tail` is truncated to \~2 KB

When a spawn finishes, the last \~2 KB of output (and, on failure, \~2 KB of stderr) is captured into `spawned_agents.output_tail` / `error_message` (`.slice(-2000)`) for postmortem inspection. Anything beyond that is dropped at write time — full output lives wherever the agent itself logged it.

**Workaround:** for full output, read the operator's per-spawn log. The Intel panel's Spawns tab links to it.

## Reclaim is lazy + periodic, so an orphan row can briefly show "running"

Orphaned active rows are reclaimed opportunistically (on the next `fleet:spawn`, before its ceiling check) and by a periodic sweep — not the instant a host dies. Between a host's death and the next reclaim, its rows still read `running`/`restarting`, and only after `RECLAIM_STALE_MS` (5 min) of stale heartbeat do they qualify for reclaim at all.

**Workaround:** none needed — the 5-minute staleness window deliberately tolerates a briefly-paused live host (GC, restart-in-progress) so a real spawn isn't reclaimed out from under itself. The Intel panel auto-polls, so a reclaimed row updates within a poll cycle.

## Post-restart spawns are read-only history

After restart, `fleet:tree` returns the durable rows (status, exit code, duration, output\_tail) but the spawn itself is gone. You cannot resume it, re-attach to its stream (no controller), or recover output beyond what was tail-captured.

**Workaround:** treat post-restart spawns as immutable history. Launch a fresh spawn if you need new work done.

## Status of each edge

| Edge                                              | Status                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Subtree cancel                                    | ✅ Done — `fleet:cancel` is transitive over the durable subtree                                              |
| Cluster-wide caps                                 | ✅ Done — the ceiling is a live PG count, shared across operator processes                                   |
| Over-ceiling queue                                | ✅ Built as queue+await (`await_event`); a granted-ticket FIFO is the only remaining want                    |
| Cross-restart cancel (kill the orphan OS process) | ⚠️ Mitigated by heartbeat reclaim (frees the ceiling); no live kill of a survived-restart process           |
| Larger output                                     | Open — stream to a scratch file, store path in `output_ref` instead of the \~2 KB `output_tail` (\~0.5 day) |

The spawn primitive is the resting state until a real workflow demands one of the open items.

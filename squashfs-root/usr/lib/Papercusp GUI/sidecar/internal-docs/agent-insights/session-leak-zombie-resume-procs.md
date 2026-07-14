# Box wedge / session leak → zombie `claude --resume` procs (ended session, live process)
URL: /internal/docs/agent-insights/session-leak-zombie-resume-procs

A climbing claude-proc count toward the ~70 bg-host wedge is usually ZOMBIE `claude --resume <uuid>` procs — adv_session ENDED but the OS process never exited. No DB-roster reaper sees them. How to diagnose + the slice-3 zombie reaper that sheds them.

## Symptom

The `claude` process count climbs monotonically toward \~70, the box overloads,
the **papercup-bg-host DBOS ticker** starves (event-loop-lag spikes, `[routines]`
drops to \~1/10min), and everything the ticker drives freezes: git-sync stops
committing, the green-checkpoint stalls, agent loops skip. `dev:service_health`
shows `:3070 up` (it is — the operator and the bg-host ticker are *different*
services; see EI-1832).

## Root cause (EI-1873)

The leak is **zombie processes**, not idle-but-open sessions. Each leaked proc
runs `claude --resume <uuid>` whose `harness_shared.adv_sessions` row is **ENDED**
(`ended_at` set, `exit_code = 0`, often 16–18h prior) — but the OS process never
exited. The session officially concluded; the process lingered, holding LISTEN
conns + polling on the `:3070` event loop.

Why every reaper misses them:

* `idle-session-reaper.ts` slices 1 (dead-ghost) and 2 (live-but-idle) scan
  **OPEN** adv\_sessions (`ended_at IS NULL`). A zombie is **CLOSED** in the DB →
  structurally invisible. Running the reaper's own logic *out-of-band* (a fresh,
  non-starved process) still reaps **0** — proof it is a criteria miss, not just
  starvation.
* The presence-heartbeat liveness signal is *also* unreliable here: the per-60s
  supervisor beat is starved by the very overload the reaper is meant to detect,
  so an alive proc reads as "not live." Liveness that depends on the starved
  resource is a feedback loop.

## Diagnose

The reliable proc↔DB join is **`adv_sessions.session_id` = the `claude --resume <uuid>`** on the OS proc (`adv_sessions.pid` is often null; don't rely on it).

1. Count: `ps -eo comm | grep -c '^claude$'`.
2. For each live `claude --resume <uuid>` proc, look up `adv_sessions` by
   `session_id = <uuid>`. **`ended_at IS NOT NULL` ⇒ zombie** — safe to kill: the
   session is done (`exit_code = 0`), it holds no claim/wake/running-cup, and it
   is **not** any live agent's current session (a live session has `ended_at IS
   NULL` — a disjoint set).

## Fix / shed

`idle-session-reaper.ts` **slice 3** — `reapZombieResumeProcs()` (+ pure
`planZombieReap()` / `discoverResumeProcs()`), wired into the
`system:idle-session-reaper` routine to run first each tick. It enumerates live
`claude --resume` procs via `/proc`, asks PG which of their sessions are ended,
and `SIGTERM`→(grace)→`SIGKILL`s the zombies. **Deterministic** (ended + alive),
**starvation-independent** (no heartbeat dependence), **PID-recycle-guarded**
(re-verifies the cmdline before EACH signal — before SIGTERM AND again before
SIGKILL after the grace pause, so a pid recycled between the two is never hit),
**double-gated** (`papercusp-idle-session-reaper` + `…-terminate`).

Three additional safety guards (all added post-EI-1873):

* **On-desktop spare**: `planZombieReap(procs, ended, onDesktopSessionIds)` — a
  `claude --resume` proc whose session is currently visible in a live OS window is
  NEVER signalled, even if its `adv_session` row reads ended. Belt-and-braces atop
  the foreground-TTY guard below (covers minimized/backgrounded edge cases).
  Best-effort (wmctrl failure → empty) so a failure can only spare fewer.
* **Foreground-TTY guard** (`isForegroundTty` in `discoverResumeProcs`): a proc
  whose `/proc/<pid>/stat` shows it is a foreground, TTY-attached process (a human
  at a terminal) is excluded from the candidate set before any PG lookup. Exported
  as `parseForegroundFromStat` (pure, unit-testable).
* **Live-session HAVING fix**: `defaultEndedSessionIds` uses
  `HAVING COUNT(*) FILTER (WHERE ended_at IS NULL) = 0` — a uuid is a zombie only
  when it has **no open row at all**. A LIVE resumed session REUSES its `session_id`,
  so an OLD ended row can coexist with the CURRENT open row. The earlier
  `AND ended_at IS NOT NULL` matched the old ended row and killed the live session
  (the `claude --resume` proc of a LIVE operator session was killed in a kill → re-resume
  → kill loop until it was noticed). The HAVING guard makes the live open row veto.

**Manual out-of-band shed during a wedge** (the reaper routine is starved): run it
from a fresh process with the flags forced — the flag resolves OFF in a fresh
process, so inject it:

```ts
const m = await import('<repo>/packages/operator-core/lib/idle-session-reaper.ts');
await m.reapZombieResumeProcs({ dryRun: true,  deps: { isFlagOn: async () => true } }); // confirm scope first
await m.reapZombieResumeProcs({ dryRun: false, deps: { isFlagOn: async () => true } }); // then shed
```

## Slice 4 — dangling inbox-wake await GC (P-004)

`reclaimDanglingInboxWakeAwaits()` (rides the slice-1 master flag — non-destructive,
no second gate). The bug: every idle psu/Mug-launched agent arms a standing
`coord:inbox-wake:<self>` await (turn-lifecycle-control always-arm). A clean session
end cancels it, but a process that DIES never runs that hygiene — the await row persists
forever. `coord:presence/fetchWakeability` reads these rows to derive `wakeable`/`parked`,
so a dead session reads as a live dispatch target (`woken:0` when a coordinator tries to
dispatch) AND `gatherProtectedSessionOwners` (slice 1's keep-gate) counts a standing await
as alive — these dangling rows also PROTECT their ghost `adv_sessions` from being reaped.
Measured live (2026-06-24): 334 inbox-wake awaits, 236 on dead owners.

Fix: cancel an inbox-wake await whose owner is NOT live or resumable. "Live or resumable"
\= fresh presence heartbeat, running cup, in-flight wake delivery, OR an OPEN `adv_session`
(a parked session the wake-executor can `--resume`). A parked-but-resumable session keeps
its await; only a truly dead session loses it → flips from false `parked` to honest `ended`.

## Still open (follow-ups)

* 258 no-owner **OPEN** adv\_session rows also accumulate (no `coord_owner_id` →
  `keptNoOwner`, never reaped) — a separate sweep should end orphaned rows with no
  live proc.
* The **upstream** bug — why a `claude --resume` proc fails to exit after its
  session ends (exit 0) — is unfixed; slice-3 is the safety net, not the cure.
* For full starvation-immunity, run the zombie sweep in the bg-host-watchdog
  (out-of-band), not only the ticker-driven routine.

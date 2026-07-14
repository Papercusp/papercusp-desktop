# Replication-liveness detector: live debugging + the per-join counter blind spot
URL: /internal/docs/agent-insights/replication-liveness-detector-live-debugging

>-

Written 2026-07-04 (su-b5d1c, plan `shared-pot-p2p-release-readiness-2026-07-03`
P-004 / WI-1840, WI-183 class). Two things live here: the **diagnostic recipe**
for the replication-liveness detector on a live frame, and the **blind-spot
class** its first live proof exposed.

## The one-line lesson

**A detector's own liveness must be live-proven.** WI-1840's
`connected_never_replicated` axis was 17/17 green in-process and completely
silent on a live rig with a genuine stall in front of it (run `m1783120511`).
In-process green ≠ live green applies to the watchdog, not just the watched.

## The blind-spot class: per-join counters on shared event emitters

`joinHarnessSwarm` (operator-core `lib/sync/hyperbee/swarm.ts`) hand-rolled a
`liveConnectionCount` (`++` on `'connection'`, `--` on socket `close`). Two
mechanisms make such a counter read 0 while a peer is demonstrably replicating:

1. **Shared-swarm dedup** — one Hyperswarm instance serves every topic and emits
   `'connection'` ONCE per peer socket. A join registered AFTER the socket
   exists never sees the event (the interface doc on `HyperswarmLike.connections`
   states exactly this).
2. **Rekey reset** — the pot first-join `rekey()` replaces the handle with a
   fresh join whose counter starts at 0; live sockets don't re-emit.

Result: the merge-pass sampler fed `swarmConnections: 0` → the axis treated the
node as offline (never alarms, by design) → silence in exactly the
zombie-connection scenario the axis exists for.

**Fix (landed):** the handle getter prefers the swarm's OWN live set —
`swarm.connections.size` — with the counter only as a fallback for minimal test
fakes. Generalize: when a shared emitter exposes authoritative live state,
**read the state, don't shadow it with event arithmetic**. Regression pins in
`__tests__/swarm.test.ts` ("shared-swarm late join") and the b8 matrix scenario
(a red-SLA soak now asserts the detector line exists — a silent detector on a
real stall self-announces as `DETECTOR REGRESSION`).

## Diagnostic recipe: read the live registry on a frame

The registry lives in whichever process runs the merge loop — under
`papercusp-substrate-sidecar` (default-ON on rig frames, WI-1994) that is the
sidecar child, and its console output lands in `serve.log` prefixed
`[substrate-sidecar]` / `[substrate-sidecar-err]`.

1. **Grep the fire line** (what the b8 scenario pins):

   ```
   grep "replication-liveness" /home/pcusp/serve.log
   # [replication-liveness] replication_stalled (connected_never_replicated) harness=… swarm has N live connection(s) …
   ```

2. **Read the registry** — JSON-RPC 2.0, newline-framed, over the sidecar's unix
   socket (`/tmp/papercusp-substrate-<spawner-pid>.sock`); no auth:

   ```
   {"jsonrpc":"2.0","method":"substrate:getReplicationLiveness","params":{},"id":1}
   ```

   Key fields per log: `verdict` (`live` / `never_connected` / `no_replicator` /
   `frozen` / `sampling_stale` — a FIRED connected-never latch derives
   `no_replicator`), `peersCount`, `msSinceSampled` (\~1s when the merge poll is
   healthy — a big value means the merge loop itself is dead), and
   **`lastSwarmConnections`** — the exact value the axis saw on the last sample.
   `null` = the sampler never passed one (axis disabled at the source); `0`
   while a peer is connected = the counter blind spot above.

3. **Durable escalation** — EIs land in `harness_shared.engineer_issues`
   (`psql 'postgresql://harness_admin:harness_admin_pwd@localhost:39532/papercusp'`
   on a rig frame; note the id column is `issue_id`, not `id`). One open EI per
   (harness, log, kind); rows federate to peers once replication heals.

4. **Admin HTTP route** (`/api/admin/dogfood-substrate-status`) is
   trust-gated: bare loopback curl gets 403 `unverified-loopback`. Bearer the
   frame's superuser token (`/home/pcusp/.papercusp/superuser-token`, the
   `rig_ban_member` pattern in `deb-hetzner-rig.sh`). The RPC socket needs none.

## Grace/churn semantics (why the axis is quiet when it should be)

* Fire requires `swarmConnections > 0` samples accumulating ≥ 3min
  (`DEFAULT_LIVENESS_GRACE_MS`) on a log with **zero replicator attach this
  process lifetime**. Zombie connections churn (\~10s lives), so swarm=0 resets
  the window only after 60s sustained (`SWARM_CHURN_TOLERANCE_MS`).
* Edge-triggered once per latch; recovery (a real replicator attach) re-arms.
* The axis never fires when the substrate/swarm never came up (`swarmConnections`
  undefined) — genuinely-offline peers must not page.

Related: the WI-183 stale-DHT-announce zombie-window mechanism (root cause the
detector exists to catch) is written up on WI-183 / ledger row 13 of
`shared-pot-release-testing/RELEASE-READINESS.md`.

# Federation rig — restart / recovery runbook (wedged smokes, stale ports, leaked VMs)
URL: /internal/docs/agent-insights/federation-rig-restart-runbook

How to recover the two-instance federation rig when a run wedges or leaves debris: reap ONLY dead runs (reap-orphans.sh) or one run (cleanup-run.sh) — never a broad pkill/rm (EI-1739); clear stale Xvfb / testnet-DHT / orphaned sidecars; free or self-discover wedged ports (the WI-754 self-heal); reset/relaunch the linux-test-vm VMs (vmctl); restart the scheduled live-federation-gate; and — when a peer is up but silently local-only (announces nothing, discovers nothing) — restore its MISSING gh auth, the most common dead-link cause after a VM reset (WI-757).

import { Aside } from "@astrojs/starlight/components";

The **federation rig** = the `papercusp-desktop/bin/*federation*.sh` /
`bin/two-instance-*.sh` smokes, their shared assert core
`papercusp-desktop/bin/lib/federation-asserts.sh`, and the
`scripts/linux-test-vm/vmctl` VM driver. Each run boots one or two
**isolated** desktop/sidecar instances (own `$HOME` → own `~/.papercusp`,
embedded-PG, corestore, ports) and asserts they federate. When a run crashes,
times out, or is killed, it can leave debris — orphaned sidecars / embedded-PG /
`hyperdht/testnet` nodes, a stale `Xvfb`, a held port, or a powered-on VM. This
is the recovery runbook.

The box runs **many rigs concurrently** (the fleet + the scheduled gate). A
`pkill -f papercusp-desktop`, `pkill -f <rig-name>`, or `rm -rf /tmp/<rig>.*`
matches **every** run and crashes a sibling's **live** run mid-flight (this is
exactly the EI-1739 collision: a glob over all runs + a name-wide pkill deleted a
sibling's `$WORK` mid-`initdb` and killed its processes). Always use the
**run-scoped** reapers below — they refuse anything that isn't a single per-run
`$WORK` dir, so they can never touch a live sibling.

## 1. Reap debris (the safe, default first move)

```sh
cd papercusp-desktop

# Reap ONLY dead runs (processes gone, older than the 5-min startup window).
# A live sibling always has referencing processes → never touched. Safe anytime,
# concurrently, by anyone.
bin/reap-orphans.sh                 # reap all dead runs
bin/reap-orphans.sh --dry-run       # show what WOULD be reaped, touch nothing

# Clean up exactly ONE known run's leftovers (you have its $WORK):
bin/cleanup-run.sh /tmp/pot-fromrepo-smoke.AbC123
```

These wrap `fed_reap_orphans` / `fed_cleanup_run` in `federation-asserts.sh`. The
rig's `$WORK` prefixes are registered in `FED_RIG_TMP_PREFIXES` (e.g.
`/tmp/pot-fromrepo-smoke.`, `/tmp/merge-smoke.`, `/tmp/vm-fed.`,
`/tmp/deb-hzfed.`) — **add a new prefix there** if you add a rig, so the reapers
keep seeing it. The reapers exclude the calling shell + its ancestors, so running
them from inside an agent shell never false-flags or kills the caller.

## 2. Stale `Xvfb`, testnet-DHT, and orphaned sidecars

The smokes run headless on a dedicated `Xvfb` display (never the user's `:0` —
see `fed_ensure_display` / `fed_fresh_display`) and spin a host
`hyperdht/testnet` DHT (`fed_start_testnet_dht`). Both, plus the instance
sidecars, are tracked in `FED_KILL_PIDS` and torn down by the run's `EXIT` trap +
`fed_cleanup_scoped`. After a hard kill (trap never fired) `reap-orphans.sh` (§1)
catches the ones whose argv references the dead run's `$WORK` (testnet nodes ride
`$WORK` on argv exactly so the scoped reaper finds them).

A **truly orphaned** `Xvfb` whose run dir is already gone is the one case the
scoped reaper can't attribute. Identify it by display number and kill **only that
display** — never a bare `pkill -f Xvfb`:

```sh
pgrep -af 'Xvfb :2(5[0-9]|99)'      # the smoke/gate display range (e.g. :99, :250, :252)
kill <pid>                          # the specific stale Xvfb, by pid
```

## 3. Wedged / mismatched ports

Two port strategies are in play:

* **Pre-assigned (robust):** the sidecar-bundle path + `deb-hetzner-federation.sh`
  pick a free port with `fed_pick_free_port`-style `ss` probing and pass it as
  `PAPERCUSP_HONO_PORT` / `PAPERCUSP_PG_PORT` — the instance binds exactly that.
* **Dynamic + discovered:** the packaged `.deb`/Tauri path lets the instance pick
  its own ports; the rig **discovers** them.

Discovery used to be **log-grep only** — it parsed the app log for `[serve]
  listening on http://127.0.0.1:N`. That raced the packaged app's *other* http
listeners (code-server logs a generic `HTTP server listening on …` line), and
a marker drift / log race produced an opaque `BOOT_TIMEOUT` or locked onto the
**wrong** port (every API call then 404/405s). As of WI-754 the assert core
**self-heals**: `fed_wait_api` requires a **2xx on the sidecar-only `GET
  /api/desktop/preflight`** (code-server 404s it), and when the configured port
never answers, `fed_discover_sidecar_os` resolves the **real** sidecar port
from the OS — scoped to THIS instance's own listening sockets + its own log,
so it never probes a concurrent sibling (EI-1739). `fed_wait_boot` does the
same on a boot timeout. So a wrong/missing sidecar marker no longer
false-REDs; you'll see a `sidecar self-discovered on :N … recovered` log line
instead.

If a port is genuinely **held** by a dead run's leftover, §1 frees it (killing the
holder). To see what an instance is actually listening on, the rig now dumps it on
failure (`fed_dump_instance_diag`: listening TCP ports + app-log tail). Manually:

```sh
ss -tlnpH | sort -u        # all listeners + owning pid (own-user pids shown)
```

## 4. VMs (the `vmctl` linux-test-vm + the build VMs)

The `--vms` federation runs (`bin/vm-federation.sh`) drive disposable Ubuntu VMs
via `scripts/linux-test-vm/vmctl`. A wedged VM:

```sh
cd papercusp-desktop/scripts/linux-test-vm
./vmctl status fed-a            # VM up? app up? operator port? disk?
./vmctl reset  fed-a            # recreate a pristine overlay from golden
./vmctl down   fed-a           # graceful power-off (teardown)
./vmctl up     fed-a           # boot a fresh overlay
```

`vm-federation.sh` resets + reinstalls per VM by default (the clean-boot
acceptance run); pass `--no-reset` to reuse overlays while iterating, and
`--keep-up` to leave the VMs running for debugging. For a wedged **Mac** VM
parked at the OpenCore picker / holding SPICE ports, recover via **QMP, never
pkill** — see
[mac-vm-qmp-recovery](/internal/docs/agent-insights/mac-vm-qmp-recovery). General
VM inventory + disk discipline: [build-system/vms](/internal/docs/build-system/vms).

If only the GUI process dies, `vmctl status` can show `app: stopped` while an
**orphaned sidecar/operator survives** the VM boot — launching on top of it then
creates a **second** operator (a stale boot set + incoherent federation, hours to
diagnose before this was understood). `vmctl launch` now **auto-reaps** any
surviving `papercusp-desktop` / `serve.mjs` / `code-server` /
`embedded-postgres` processes before starting the app, so there is always exactly
one operator per launch. `vmctl status` also reports `procs: desktop=N
  serve.mjs=N` and flags `⚠ DUPLICATE desktop — split-brain` when `N>1`, so a
lingering split-brain is visible without digging through `ps`.

`vmctl status` / `vmctl verify` resolve the in-guest operator's DYNAMIC port from
`~/.papercusp/operator.json` (`{port,pid,httpUrl,…}`, written on boot) first, and
only fall back to grepping `papercusp-app.log` for a `listening on …` line. The
packaged build routes `serve.mjs`'s stdout elsewhere, so on a real install the app
log carries only the Tauri binary's libEGL warnings — the old log-grep-only method
found nothing and reported a perfectly healthy install as "operator down." A
pristine first boot can also take up to \~3 minutes (cold-seed corestore restore +
migrations) before the operator answers — `vmctl verify` polls up to 300s for
this, not a short fixed timeout.

## 5. The scheduled gate (`live-federation-gate.sh`)

`papercusp-desktop/bin/live-federation-gate.sh`
runs the smokes on a schedule on a quiet box and files an EI on any RED (the
green-rig/red-binary guard, WI-261/P-013). It:

* runs a **hermetic \~2s assert-core self-test first** (WI-754:
  `bin/lib/federation-asserts.selftest.sh` — proves the port-discovery logic
  before spending minutes on smokes; a fail exits `GATE: RED` with a clear
  message). Set `GATE_SKIP_SELFTEST=1` to skip it.
* **SKIPs (not fails)** when 1-min load exceeds `LOAD_GATE` — the smokes get
  killed under load and false-RED below the kill threshold. Better to skip
  and retry next window than false-RED or pile onto a busy box. **`LOAD_GATE`
  is now core-aware (2026-07-03, P-013):** `max(15, 3*nproc/8)` — an absolute
  `15` never fired on the 128-core fleet box (it sat well below the box's
  ordinary operating load), reproducing the exact "gate never runs" class
  P-013 exists to kill; a first core-aware cut at `nproc/4` *still* undershot
  the observed fleet-era floor (35-46). If a mid-run load spike pushes the
  1-min load above the new `STORM_GATE` (default `nproc*0.6`) by the time the
  verdict is computed, a would-be FAIL is **downgraded to
  `SKIPPED-STORM`** (no EI filed) instead of a false-RED — the exact failure
  mode a load-94 fleet storm caused before this existed.
* **Fresh-exit + staleness guard (2026-07-03, P-013):** a GREEN younger than
  `GATE_SUCCESS_TTL_H` (default 22h) makes the NEXT window's run a no-op exit
  before the self-test even runs (hourly timer, \~daily actual smoke run). If
  no GREEN has landed in `GATE_STALE_DAYS` (default 3) — every window either
  load-skipped, storm-downgraded, all-legs-skipped, or failed — the gate files
  a **loud staleness EI** itself: silence must never look like green. Set
  `GATE_FORCE=1` to ignore the freshness TTL and force a run now (still
  storm-downgrade-protected if the box saturates mid-run).
* **EI filing now requires a superuser bearer** (2026-07-03, WI-1841 follow-up
  to WI-1861): `?superuser=1` on the MCP URL alone is not sufficient — the
  handler also needs `Authorization: Bearer <token>` matching
  `~/.papercusp/superuser-token` (`GATE_SUPERUSER_TOKEN_PATH` overrides the
  path). A missing/short token degrades gracefully to log-only, same as
  before; it is not fatal.
* **Build provenance is stamped** (2026-07-03, WI-1861): each rebuild logs the
  working-tree `HEAD` + dirty-file count, so a "torn-tree build" red (the
  shared checkout was mid-edit by a fleet peer at build time — unreproducible
  at the next build, byte-identical blueprints) is diagnosable instead of a
  mystery.
* **`log()` now writes to stderr, not stdout** (2026-07-03, load-bearing
  P-013 fix): the verdict logic reads a smoke leg's PASS/FAIL via `$(...)`
  command substitution, and with `log` on stdout the captured string became
  `"log-line\nPASS|FAIL"`, so `[ "$RES" = FAIL ]` could never match — a
  genuine content-matrix FAIL was silently masked out of every verdict until
  this fix. journald still captures both streams, so nothing is lost.
* **The from-repo leg's known-red is WI-971, not WI-259** — WI-259 was closed
  as a duplicate of WI-971 (outbox drain never wired for joined/created pot
  harnesses); WI-280/WI-1666 are resolved. A content-matrix FAIL whose only
  `✗` lines match the WI-971 backfill/incr-B→A signature is downgraded to
  `PASS-971` (not a clean pass — WI-971 remains open) rather than a red.
* **A new `local-matrix` leg** (P-002, no-op until `bin/local-matrix.sh`
  exists) runs the full containerized 8-scenario matrix on a weekly cadence
  (`MATRIX_TTL_H`, default 144h), and only on a window whose content-matrix
  smoke already passed.
* **All-legs-skipped is NOT recorded as green** — if load-gate/staleness logic
  let a window through but every leg still SKIPPED (e.g. `SKIP_MATRIX=1
  SKIP_FROMREPO=1`), the gate now exits `GATE: SKIPPED (no legs ran)` rather
  than silently counting as a pass.
* **Run-dir retention (WI-3087, 2026-07-05):** each run's `/tmp/live-fed-gate-*`
  dir (the unpacked `dpkg-deb -R` tree + the repacked gate `.deb`) used to be left
  behind forever — \~3.5GB per heavy run, 67 dirs / 111GB observed before the disk
  filled. The gate now keeps only the newest `GATE_KEEP_RUNS` (default 5) run
  dirs at the top of every invocation, and additionally removes its own `pkg/`
  tree right after a successful repack.

Restart / re-run it manually on a quiet box:

```sh
cd papercusp-desktop
bin/reap-orphans.sh                                   # clear any prior debris first
LOAD_GATE=48 bin/live-federation-gate.sh              # raise only for a dedicated/idle host
GATE_NO_FILE=1 SKIP_FROMREPO=1 bin/live-federation-gate.sh   # log-only, skip the WI-971-RED leg
GATE_FORCE=1 bin/live-federation-gate.sh              # ignore the freshness TTL, force a run now
```

It's a routine — check / re-arm it via `routines:list` / `routines:set` (it does
**not** push the live `:3070`; it builds + boots isolated instances).

## 6. Peer is up but silently local-only — missing gh auth (WI-757)

The single most common reason the live link is dead after a `vmctl reset` /
re-image (§4): the peer has **no GitHub auth**, so it never federates — yet it
boots, serves its API, and looks healthy. The federation **announce binds the
device identity to a GitHub user** (`local-announce-identity.ts`): with no `gh`
token, `resolveLocalAnnounceIdentity` throws and `boot.ts`'s swarm-join catch
treats it as **"stay local-only — don't federate."** The peer then **announces
nothing and discovers nothing**, silently — there is no loud signal; the only
tell is `reachablePeers: 0` on an explicit announce. (This masquerades as a deep
substrate/admission/cursor bug — check auth FIRST.)

Symptoms:

* `GET /api/discovery/pots` on the peer returns `count: 0`.
* `POST /api/discovery/set-pot {visibility:"public"}` and
  `POST /api/harness/pots/from-repo` return
  `announced:false, reachablePeers:0, error:"local-announce-identity: gh not authenticated"`.
* Cross-machine: the peer's pots never appear on any other peer's directory.

Check it FIRST:

```sh
ssh -i ~/.ssh/papercup-vm-linux -p <sshPort> tester@127.0.0.1 'gh auth status'
# "You are not logged into any GitHub hosts" → this IS your dead link.
```

Restore (reversible; **no operator restart needed** — `pot-directory-boot`
lazily re-wires the directory on the next browse/announce):

```sh
# from the HOST (gh-authed); pipe the token over ssh STDIN, never argv:
printf '%s' "$(gh auth token)" | \
  ssh -i ~/.ssh/papercup-vm-linux -p <sshPort> tester@127.0.0.1 'gh auth login --with-token'
# then re-announce (or just browse) → announced:true, reachablePeers>0
```

Use the identity the peer historically announced as (its
`harness_shared.shared_presence.github_user_id`) — for fed-a that is `papercupai`
(279242982); fed-b uses a different account. An operator-process restart
**preserves** `~/.config/gh`; only a full **VM re-image** wipes it — so prefer a
process restart over a reset, and re-auth after any reset.

A restart to force a swarm re-peer must be coordinated with whoever owns the
live federation/self-heal work (FED-2) — don't restart a peer another agent is
actively investigating. The durable fix (persist/restore auth across restart +
a loud no-identity health signal) is tracked in WI-757.

### 6b. Loopback smoke gets 0 peer dials — ambient fleet DHT env leaking in (2026-07-03)

A different silently-local-only cause, specific to `fed_local_launch` /
`fed_local_launch_sidecar` (`bin/lib/federation-asserts.sh`) launches on a
**fleet shell**: fleet desktop sessions carry ambient
`PAPERCUSP_DHT_HOST=<bridge-ip>` / `PAPERCUSP_DHT_BOOTSTRAP=<bridge-ip:port>`
for the tower↔VM rig, and a loopback smoke that inherits either one
swarm-binds/bootstraps on the bridge instead of the loopback DHT the smoke
actually spun up — so peers never dial each other (0 `peer_connected`
fleet-wide, found 2026-07-03). Both launch primitives now **force-empty**
`PAPERCUSP_DHT_HOST`/`PAPERCUSP_DHT_BOOTSTRAP` before `"$@"` — a caller that
*wants* either passes it explicitly in the trailing `VAR=val` args, which win
over the forced-empty default. If you're troubleshooting a hand-rolled smoke
that calls these primitives directly and it can't see its peer, check the
calling shell's environment for `PAPERCUSP_DHT_HOST`/`PAPERCUSP_DHT_BOOTSTRAP`
before suspecting the substrate.

## 7. Driving the live fed VMs — `fed.sh` (port self-discovery, WI-754)

`papercusp-desktop/scripts/linux-test-vm/fed.sh` is the **versioned** driver for
the 2-machine fed-a / fed-b VMs — the reliable replacement for the ad-hoc
`/tmp/fed.sh` that **hardcoded the VMs' dynamic operator/PG ports**. Those ports
are picked fresh on every operator restart and old listeners linger, so a
hardcoded (or even "latest `[serve]` log line") port goes stale and silently hits
the wrong / a dead listener (EI-3409 / WI-559 burned \~30 min on exactly this). The
versioned script **discovers the LIVE ports on each call**: it SSHes in (stable
host-forward port), gathers candidate loopback ports, and picks the operator =
the one answering `GET /api/desktop/preflight` with **2xx** and PG = the one that
accepts a `harness_admin` psql — so it survives app/VM restarts with no edits.

```sh
cd papercusp-desktop/scripts/linux-test-vm
./fed.sh a ports                       # show the discovered operator/PG ports
./fed.sh a sql  "select count(*) from harness_features"
./fed.sh a api  GET /api/discovery/pots
./fed.sh a mcp  pot:report '{"pot":"…"}'
./fed.sh a ssh  'gh auth status'       # raw ssh (used by §6's gh-auth restore)
./fed.sh b rediscover                  # force a fresh probe (after a restart)
```

`sql` uses the guest's own `psql` if it's on `PATH`, else the app's bundled
`sidecar/bin/psql`. Real client binaries have shipped with the app since
2026-07-07 — an install built before that date shipped a broken `pg_wrapper`
shim instead, so on an older install run a fresh `vmctl install` before
relying on `fed.sh a sql`.

Ports are cached per-VM under `~/.papercusp/fed-rig-ports.<vm>` for
`FED_PORT_TTL` (default 600s); `rediscover` (or deleting the cache) forces a fresh
probe. SSH host-forward ports default to `2225` (a) / `2226` (b) — override with
`FED_SSH_A` / `FED_SSH_B`.

For a live two-machine federation witness, do not create an arbitrary
repo-less throwaway with `pot:create`. The cross-machine join path joins the
owner's per-member GitHub links (`joinHiveAsView` parses each member link and
clones the member repo). A repo-less `pot:create` home has no member links
for the peer to join, so the peer never subscribes to that pot's topic and
owner writes have no remote log to arrive on. Use `pot:create_from_repo` (or
an existing repo-bound pot with a joined peer member) for B8/B10-style ban,
dissolve, grant, and receipt witnesses. A valid witness setup is: owner box
owns the pot, peer box has joined at least one repo-bound member, then drive
the federation action.

Superuser MCP resolves `ctx.workspaceId='*'` while the HTTP routes/queue use
`'default'`, so a pot created via `mcp` lands in the wrong workspace and the
routes return `not_owner_swarm`. For a workspace-scoped WRITE tool
(`pot:create` / `pot:takedown` / `pot:report` / `pot:moderation_*`), pass
`"workspace":"default"` in the args — or set `FED_MCP_WS=default` and `fed.sh`
injects it for you (opt-in; off by default because blanket injection breaks
READ tools whose schema rejects an unknown `workspace` key). The durable fix
(superuser ctx resolving the concrete workspace) is tracked on **EI-3409**.

## Quick reference

| symptom                                                                 | do                                                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| drive a live fed VM (stale `/tmp/fed.sh` ports)                         | `scripts/linux-test-vm/fed.sh <a\|b> ports\|sql\|api\|mcp` (§7, WI-754)      |
| crashed/timed-out run left debris                                       | `bin/reap-orphans.sh` (§1)                                                   |
| one known run's `$WORK` to clean                                        | `bin/cleanup-run.sh <WORK>` (§1)                                             |
| "API never came up" / wrong port                                        | now self-heals (WI-754, §3); read the dumped diagnostic                      |
| stale `Xvfb` on a smoke display                                         | `pgrep -af 'Xvfb :…'` → `kill <pid>` (§2)                                    |
| wedged Linux VM                                                         | `./vmctl reset` / `down` / `up <name>` (§4)                                  |
| wedged Mac VM                                                           | QMP recovery, never pkill (§4)                                               |
| re-run the scheduled gate                                               | `bin/reap-orphans.sh` then `bin/live-federation-gate.sh` (§5)                |
| peer up but discovers/announces **nothing** (count:0, reachablePeers:0) | check `gh auth status` FIRST → restore gh auth (§6, WI-757)                  |
| loopback smoke gets 0 peer dials, only on a fleet shell                 | check calling shell for `PAPERCUSP_DHT_HOST`/`PAPERCUSP_DHT_BOOTSTRAP` (§6b) |
| **anything**                                                            | **never** `pkill -f <rig>` / `rm -rf /tmp/<rig>.*` (EI-1739)                 |

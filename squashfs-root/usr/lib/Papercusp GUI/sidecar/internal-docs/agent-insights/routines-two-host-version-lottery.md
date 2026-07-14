# Routines are claimed by WHICHEVER host's tick wins — green and staging race on one table
URL: /internal/docs/agent-insights/routines-two-host-version-lottery

Green (:3070, release tree) and staging (:3170, main) both run routinesTick against one harness_shared.routines table, so which CODE VERSION handles a fire is a lottery — new-code-only payloads fail intermittently until the release deploy.

## Current behavior (2026-07-03)

**The two-host race this doc describes no longer happens — the topology it was written
against has been superseded.** Verified live against the running systemd units +
journal:

* `papercup-dev-api.service` (green, `:3070`, `papercusp-release` checkout) now runs with
  `PAPERCUSP_BACKGROUND_WORKERS=0` (drop-in `50-cluster.conf`). Its journal confirms:
  `[host] PAPERCUSP_BACKGROUND_WORKERS=0 — secondary host: skipping hyperbee substrate,
  git-export, and DBOS background machinery (EI-126)`.
* `papercup-staging-api.service` (`:3170`, `main`/staging checkout) has carried the same
  `BACKGROUND_WORKERS=0` gate since **EI-126** (drop-in `10-background-workers.conf`) —
  also confirmed live in its journal.
* The **sole** DBOS routines primary is now a dedicated third host,
  `papercup-bg-host.service` (`PAPERCUSP_BACKGROUND_WORKERS=1`, cut over 2026-07-03 per
  `operator-scalability-event-loop-2026-06-16` P1-3) — confirmed firing `routinesTick`'s
  sweeps live in its journal. It runs from the **staging/integration checkout**
  (`papercupai-workspace/papercusp`, same tree as `:3170`), **not** `papercusp-release`,
  and pins its own `DBOS__APPVERSION=bg-host-v1` / `DBOS__VMID=bg-host-3270`.

Net effect: exactly ONE process claims `harness_shared.routines` rows now, and it always
runs the current staging/`main` code — never the (older) green/release checkout. The
version-lottery this doc documents is structurally gone for the current
green+staging+bg-host topology.

**This is a topology invariant, not a code guarantee** — nothing stops a future change
from starting a second `BACKGROUND_WORKERS=1` host again (the underlying fact that
`:3070`/`:3170` share the same default `PINNED_APP_VERSION` unless a host sets
`DBOS__APPVERSION` is still true; `bg-host` is simply the only host that currently does).
If you are re-introducing a second background-capable host, the failure mode and
mitigations below still apply verbatim — read on.

***

**What (historical, 2026-06-05).** Since the 2026-06-05 release-gate cutover the dev box runs TWO
operators — green `:3070` from the `papercup-release` checkout (the `ready`
ref) and staging `:3170` from `main` — and **both** register the DBOS
`routinesTick` against the **same** `harness_shared.routines` table (they
share `apps/operator/.env.local`, so both see `PAPERCUSP_DBOS_ROUTINES=1`).
The atomic claim in `claimDueRoutine` guarantees exactly ONE host fires a due
routine, but **which one wins is a race** — so the code version that executes
a routine's payload is a per-fire lottery.

**Why it matters.** A routine whose payload only newer code understands fails
intermittently-to-always until the next release deploy. Observed live
(autoloop-pot-operator-rebuild D-010): a
`system:blueprint-run {blueprintId:'pot'}` wake was claimed by the green
host, whose release tree
had no `pot` blueprint — `fireLaunchBlueprint` threw, and (second, compounding
bug fixed on `main` in `packages/operator-core/lib/harness/routines/claim.ts`) the old claim
semantics left the one-shot row ACTIVE with `next_fire_at=NULL`, which means
"due now" — an infinite 30s refire loop until the row was deactivated by hand.

**How to apply.**

* Don't arm (activate) a routine whose `target_role`/payload needs code that
  hasn't reached the **green** checkout yet — seed it INACTIVE and flip it
  after the release deploy, or verify green has the code first
  (`journalctl --user -u papercup-dev-api` paths name the serving tree).
* A misfiring routine loop is stopped with
  `UPDATE harness_shared.routines SET active=false WHERE name='<name>'`.
* If you change routine CLAIM/fire semantics on `main`, remember the live
  ticker is green's until a deploy — your fix is not protecting production
  rows yet.

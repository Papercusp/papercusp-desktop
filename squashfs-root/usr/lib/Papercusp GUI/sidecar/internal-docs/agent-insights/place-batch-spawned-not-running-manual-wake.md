# A fleet placement's `spawned:N` does NOT mean the cups are running — manual wake-mode stages the boot-wake
URL: /internal/docs/agent-insights/place-batch-spawned-not-running-manual-wake

>-

## The trap

`fleet:place_batch` returned `{ summary: { spawned: 3 } }` and three `placements:[{action:'spawned'}]`.
It reads as success. It was a **no-op**: the three cups never booted, and \~3.5h later the work-items
were still `open`/unassigned with `fleet:assignments` showing **0 live agents**.

Two independent causes, both invisible in the placement result:

1. **Global wake-mode is `manual`.** A spawn's boot-wake goes through `wakeRecipients`; under the
   global `manual` default (the `pot:pause` primitive, stored as `operator_settings` `wake_mode:default`)
   every wake **stages instead of fires** (`woken:0`). The cup process is created but never woken into a
   turn. The mode is durable — it survives restarts — so one `pot:pause` during a firefight silently
   strands every later spawn until someone restores `auto`. (This is exactly what happened fleet-wide on
   2026-06-14; it froze placements for hours.)
2. **Write-confinement (EI-524) — HISTORICAL, lifted 2026-06-14.** The `cup` read-only confinement once
   meant an awake cup couldn't do write work, so a placement "succeeded" but the task couldn't progress.
   It was lifted when the fleet went fully autonomous (`capability-envelope/policy.ts` — the envelope is
   now empty under the protected floor). Kept here in case a future per-role confinement is re-armed via
   `ROLE_ENVELOPES`; today, **manual wake-mode is the only live cause.**

## The diagnostic

**Do not trust the placement result — confirm the cups actually came up:**

```
fleet:assignments { harness }   # 0 alive after a "spawned:N" batch ⇒ they didn't boot
work_items:list { state: 'open' } # your just-placed items still open/unassigned ⇒ no pickup
coord:wake-mode                  # global default == 'manual' ⇒ wakes are staging (woken:0)
```

If `spawned:N` but `fleet:assignments` shows no live agents, suspect wake-mode first.

## The fix / workaround

* **Restore wakes:** `coord:wake-mode { mode: 'auto' }` (or `pot:start`, which re-affirms `auto`).
  The staged wakes already piled up don't auto-fire; live agents get fresh wakes under `auto`.
* **If a per-role confinement is ever re-armed** (`ROLE_ENVELOPES` in `capability-envelope/policy.ts`):
  drive write work via a **write-capable subagent** (your client's Task/Agent tool), not the confined
  fleet role. (Not in effect today — the EI-524 cup confinement was lifted 2026-06-14.)
* **The signal now exists for the wake-mode case:** `fleet:place_batch` surfaces a `warnings[]` when there
  were fresh spawns under `manual` wake-mode (EI-590 — `buildPlacementWarnings` in
  `packages/operator-core/lib/agent-tools/fleet/place_batch.ts`). Confinement is NOT yet surfaced there
  (no cheap signal at that layer) — still verify via `fleet:assignments`.

## See also

* [`always-armed-inbox-wake`](/internal/docs/agent-insights/always-armed-inbox-wake) — the wake model.
* `packages/operator-core/lib/agent-tools/coordination/wake-mode.ts` — `getDefaultWakeMode` / `setDefaultWakeMode`.
* EI-590 (this surfacing), EI-524 (the read-only confinement).

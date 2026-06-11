# The hive:* tool namespace — local hive lifecycle
URL: /internal/docs/agent-insights/hive-tool-namespace

hive:list/get/create/dissolve/update manage a LOCAL hive (a kind:'hive' Pot harness + its bees). Gotchas — create/dissolve/update are root-only; create must stamp harness_kind:'hive' (harness:create doesn't); deploy:hive is a DISTINCT cloud step; wake/bees stay pot:*/fleet:*.

## What

`hive:*` (`packages/operator-core/lib/agent-tools/hive/`) is the **local hive
lifecycle** surface — the verbs that had no existing home:

* **`hive:list`** — workspace-local hives (kind:'hive' harnesses) + a live-agent count (one batched fleet read, no per-hive fan-out).
* **`hive:get`** — one hive in depth: wake schedule + bees `{doing,queued,load}` + todo frontier depth. A pure aggregator.
* **`hive:create`** — stand up a new hive (home harness + pot blueprint + optional Queen wake), transactional with rollback.
* **`hive:dissolve`** — tear one down (clear the wake, cancel bees, deregister; optional schema drop), confirm-gated.
* **`hive:update`** — edit deployment target / per-instance config overrides.

It **composes** existing primitives (`pot:*`, `fleet:*`, `harness:create` internals) rather than reinventing them. A hive is read through one seam, `resolveHive` (`_resolve.ts`), so it re-points onto the forthcoming first-class Hive entity (`shared-hive-federation`) without touching the verbs.

## Gotchas

* **Create/dissolve/update are ROOT-ONLY.** They refuse a parented bee (a `fleet:spawn` child — `resolveAgentIdentity(ctx).source === 'fleet-spawn'`) up front; the `assertNotNestedHive` guard in `fireLaunchBlueprint` is the runtime backstop. Hives are peers, never nested — a bee that needs structure spins a `kind:'harness'` subharness, never a hive.

* **`hive:create` must stamp `harness_kind:'hive'` itself.** `harness:create` never sets `harness_kind`, and `resolveHive`/`hive:list` filter on it — so a hive home harness created any other way (or a pre-existing Pot) is **invisible** to the namespace until stamped. `createHiveHarness` sets it; that's the one non-negotiable difference from a plain `harness:create { blueprintId:'pot' }`.

* **`deploy:hive` / `deploy:teardown_hive` are DISTINCT** — they are the *cloud execution-plane* (provision/destroy frames for an already-existing hive), not local lifecycle. `hive:create` does NOT deploy; `hive:dissolve` does NOT destroy a cloud frame. Order: `hive:create` → (later) `deploy:hive`; `deploy:teardown_hive` → `hive:dissolve`.

* **No `hive:wake`/`hive:pause` aliases** (D-007). Wake = `pot:wake` / `pot:declare-wake`; pause = `pot:declare-wake { mode:'none' }` / `autoloop:control`; bee placement = `fleet:*`. The namespace owns only verbs with no existing home.

* **`hive:dissolve` leaves workspace-scoped event-wake subscriptions.** The pot time-wake routine is per-home-slug (cleared cleanly), but `pot_wake` event subscriptions are one row per *workspace* today — so dissolve clears only the time wake to avoid clobbering sibling hives. The first-class Hive entity makes event subs per-hive.

## Tests

`agent-tools/hive/{_resolve,_create,dissolve,guard}.test.ts` (15 tests): descriptor shaping, `harness_kind` stamping, create rollback-on-failure, dissolve unwind, and the root-only refusal — all PG-free (deps mocked). The live create→wake→dissolve path (a real Queen spawn on shared infra) is a manual smoke, not auto-run.

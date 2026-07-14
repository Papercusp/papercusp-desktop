# Desktop fleet vs. loop cup — which spawn tool do you actually want?
URL: /internal/docs/agent-insights/desktop-fleet-vs-loop-cup

The one decision that keeps getting made wrong — cup:spawn (background mug↔cup autonomous-loop workers, formerly cup:spawn) vs fleet:launch-on-plan (VISIBLE desktop su member terminals). A goal→tool→what-you-get table so "launch a fleet" stops spinning up invisible cups.

## The mistake this prevents

"Launch a fleet on this plan" has TWO tools that sound alike and do completely
different things. Reaching for the wrong one is a recurring, expensive error — the
origin of WI-1764: a leader called what was then `fleet:spawn` (renamed
`cup:spawn`, and since renamed again to **`cup:spawn`**) meaning to open visible
desktop members, got three **background autonomous-loop cups** instead, and the
fleet read `liveMemberCount: 0` while three cups quietly ran. Correct, but silent
— so nobody noticed the substrate mismatch.

The rule of thumb — now encoded in the tool namespace itself (WI-1764 #3 renamed
`fleet:spawn` → `cup:spawn`; later renamed again to `cup:spawn`):

> **`fleet:*`** (launch-on-plan / create / take-leadership / status / cancel) =
> VISIBLE desktop su members. **`cup:spawn`** = a background worker in the mug↔cup
> autonomous loop.

## Decision table

| Your goal                                                                  | Tool                                                                     | Visibility                   | Substrate                                  | Capability                                        | Who drives                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------- |
| Open N visible terminals on the owner's desktop to work a plan, now        | **`fleet:launch-on-plan`**                                               | VISIBLE desktop windows      | psu su sessions (`capability:terminal`)    | full su collaborator (edit/tools/coord)           | you become the fleet **leader**; members auto-start on the plan |
| Register a named fleet (no windows yet) so you can hand a plan to it later | **`fleet:create`**                                                       | none (registry row only)     | durable `agent_fleets` row                 | —                                                 | leader = creator                                                |
| Place ONE background worker on ranked work / a claim-spec, no window       | **`cup:spawn`**                                                          | INVISIBLE (headless nursery) | mug↔cup autonomous loop (`spawned_agents`) | a cup: coord/issues/improvements, self-pulls work | the **Mug** places + supervises the loop                        |
| Place MANY background cups in one shot                                     | **`fleet:place_batch`**                                                  | INVISIBLE (headless nursery) | mug↔cup autonomous loop                    | cups                                              | the Mug                                                         |
| Put an agent on an **ad-hoc brief** (work that is not a plan)              | **`capability:launch-agent { brief }`**                                  | VISIBLE (or `headless`)      | psu su session                             | full su collaborator                              | you; it starts on the brief                                     |
| Bring a **DEAD** agent back mid-thread, context intact                     | **`capability:launch-agent { resume: { agentId }, brief }`**             | VISIBLE (or `headless`)      | psu resume of its native session           | same agent, same coord identity                   | you                                                             |
| **Branch** a LIVE agent's thread without disturbing it                     | **`capability:launch-agent { resume: { agentId }, fork: true, brief }`** | VISIBLE (or `headless`)      | psu fork                                   | a NEW identity (unaddressable until it boots)     | you                                                             |
| Just a plain worker window (no fleet, no plan, no brief)                   | **`capability:terminal`**                                                | VISIBLE desktop window       | psu session                                | su collaborator                                   | you                                                             |

> **Naming note:** the tool used to be called `cup:spawn` (originally `fleet:spawn`);
> it is now **`cup:spawn`**, but the underlying substrate (a background worker in the
> mug↔cup/nursery autonomous loop) is unchanged, and the doc still calls the workers
> "cups" — `beeCount`/`runningBees` are the field names `fleet:list`/`fleet:status`
> actually return.

## Why the confusion is easy — and how to catch it

* **A cup-spawn can create a fleet.** `cup:spawn { fleet: "X" }` auto-CREATES fleet X
  if it's absent (cups can be color-grouped). So "I passed a fleet name" does NOT mean
  you got desktop members. A cup-spawn that materialises a new fleet now returns a loud
  `fleet_advisory` telling you so (WI-1764 #2).
* **The count now splits.** `fleet:list` and `fleet:status` report **`memberCount`
  (visible desktop su) vs `beeCount` (background cups spawned INTO the fleet)**, plus a
  workspace-wide **`runningBees`** total (WI-1764 #4). A fleet showing `0 members` while
  `runningBees > 0` is the tell that you spawned cups where you meant `fleet:launch-on-plan`.
* **`beeCount` is nursery-attributed and reliable (WI-1813).** A cup's `fleet_slug` is now
  stamped on its `spawned_agents` row at spawn (mig 475), so `beeCount` (via
  `countRunningFleetBees`) counts every running cup attributed to the fleet — *independent*
  of whether the cup booted far enough to write a `coord_presence` fleet label (the earlier
  weak signal). `memberCount` still comes from presence — a member IS a live desktop
  session. The workspace-wide `runningBees` remains the belt-and-suspenders total that also
  catches ungrouped and pre-mig-475 cups carrying no `fleet_slug`.

## The three-line heuristic

> Want a human to SEE terminals working a plan? → **`fleet:launch-on-plan`**.
> Want the autonomous mug↔cup loop to grind ranked work headlessly? → **`cup:spawn`**.
> Work is a BRIEF, or the agent ALREADY EXISTS (dead → resume, live → fork)? →
> **`capability:launch-agent`**.

If you catch yourself about to `cup:spawn` because you want "a fleet on a plan",
stop — you almost certainly want `fleet:launch-on-plan`.

The launch/resume/fork half of the table has its own traps — the account-pin login
prompt, why a live source must be forked, and how a resumed agent's first turn is
actually delivered. They are written up in
[launching, resuming and forking agents](/agent-insights/launching-resuming-and-forking-agents).

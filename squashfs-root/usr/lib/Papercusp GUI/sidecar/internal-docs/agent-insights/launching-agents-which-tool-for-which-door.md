# Launching agents — which tool for which door
URL: /internal/docs/agent-insights/launching-agents-which-tool-for-which-door

Canonical four-door routing table for agent launches, plan fleets, arbitrary terminal commands, and the desktop console buttons; capability:launch-agent is the flexible general launcher and fleet:launch-on-plan is the ergonomic N-on-plan door.

## The routing table

Use the narrowest purpose-built door that matches the intent:

| You want to…                                                        | Correct tool                                      |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| Launch / resume / fork an agent (visible or headless, fleet or not) | `capability:launch-agent` — the flexible superset |
| Launch N agents on a plan (the ergonomic door)                      | `fleet:launch-on-plan`                            |
| Run an arbitrary command in a window                                | `capability:terminal`                             |
| Use the “+” / “Resume in new terminal” desktop buttons              | the `/console/launch` route → `spawnConsole`      |

## Why the doors are distinct

`capability:launch-agent` owns agent lifecycle: fresh launch, resume, fork, visible/headless, and optional fleet membership. It injects the first turn and uses the shared agent-launch core.

`fleet:launch-on-plan` is the ergonomic plan-fleet wrapper. It ensures the fleet exists, establishes leadership, binds the plan and claim spec, opens N members, and auto-starts each member. Do not reproduce that choreography with `capability:terminal`.

`capability:terminal` owns arbitrary interactive commands. It opens detached visible command windows and does not own agent lifecycle, plan binding, first-turn delivery, fleet leadership, or member liveness verification.

The desktop “+” and “Resume in new terminal” buttons are UI actions, not agent-tool calls. They enter through `/console/launch`, which validates the request and delegates the actual OS-window spawn to the shared `spawnConsole` primitive.

## Selection heuristic

* If the subject is an **agent**, start with `capability:launch-agent`.
* If the request is specifically **N agents on a plan**, use `fleet:launch-on-plan`.
* If the subject is a **command**, use `capability:terminal`.
* If the action came from the desktop console UI, follow `/console/launch` → `spawnConsole`.

Deep dives: [desktop fleet vs. loop cup](/internal/docs/agent-insights/desktop-fleet-vs-loop-cup), [launching, resuming and forking agents](/internal/docs/agent-insights/launching-resuming-and-forking-agents), and [native console](/internal/docs/desktop/native-console).

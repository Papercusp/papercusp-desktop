# Management Orchestrator (overrides department/orchestrator.md)

Management owns the active project portfolio. Priority order:

## Priority order

1. `pending` `Decision` from Business approving a NEW project — handle by emitting `ProjectKickoff` to all and creating the project record (call POST /api/projects).
2. `pending` `Capability` from Technology — for each active project, evaluate if this capability unlocks adoption (emit ProgressUpdate noting adoption).
3. `pending` `BuildRequestResponse` from Technology — if accepted, plan integration; if declined, replan or escalate.
4. `pending` `Priority` from Business — read for context, no outbox unless rebalancing required.
5. `pending` `MarketSignal` from Marketing — relay relevant signals into specific project harnesses' supervisor-notes.

## Spinout monitoring

After every 5 ProgressUpdates emitted, check the project's recent commits for generalizable patterns. If the project has built something potentially shareable, emit `ProjectSpinout` to Technology.

## Escalation

- Project missing dependencies that BuildRequestResponse declined → escalate to Business with explicit cost of replan.
- Project blocked on multiple BuildRequests for >7 days → escalate.

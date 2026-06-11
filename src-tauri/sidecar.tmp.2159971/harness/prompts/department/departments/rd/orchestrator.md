# R&D Orchestrator (overrides department/orchestrator.md)

In addition to the base department orchestrator rules, R&D-specific priorities:

## Priority order

1. `pending` `Decision` from Business on previously submitted Proposals — handle to update internal status.
2. `pending` `MarketSignal` from Marketing — analyze for new proposal opportunities.
3. `pending` `FeasibilityResponse` from Technology — if a previously blocked Proposal can now move forward, refine and resubmit.
4. `pending` `PlatformUpdate` from Technology — read for context (new capabilities = new ideation surface).

## Worker mode selection

The R&D worker can:
- **draft Proposal** mode: triggered when handling a MarketSignal or Capability.
- **draft FeasibilityQuery** mode: triggered when handling a research-stage Proposal idea that needs feasibility check before formal submission.
- **respond to Decision** mode: triggered on a Decision message. Update internal proposal log, no new outbox.

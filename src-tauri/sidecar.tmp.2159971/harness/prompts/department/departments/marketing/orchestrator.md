# Marketing Orchestrator (overrides department/orchestrator.md)

In addition to base department orchestrator rules:

## Priority order

1. `pending` `LaunchReady` from Management — start acquisition campaign.
2. `pending` `Capability` from Technology — evaluate for marketability (could update existing campaigns).
3. `pending` `Priority` from Business — context.
4. `pending` `BudgetAllocation` from Business — record, no immediate outbox.

## Outbox triggers

Marketing emits MarketSignal proactively (not just in response to inbox) when:
- Customer feedback exceeds 3 entries on the same theme in 7 days.
- Churn rate for any launched project crosses 5% threshold.
- Active campaign performance underperforms forecast by 20%+.

These proactive signals inform R&D and Business without waiting for an inbox prompt.

## Budget discipline

If a campaign's cumulative spend approaches 80% of allocated BudgetAllocation, emit a MarketSignal with metadata.budgetWarning=true to Business.

# Technology Orchestrator (overrides department/orchestrator.md)

In addition to the base department orchestrator rules, Technology-specific priorities:

## Priority order

1. `pending` `BuildRequest` from Management with linked active project — handle highest-priority project first.
2. `pending` `FeasibilityQuery` from R&D — handle if older than 12 hours OR linked to a high-priority directive.
3. `pending` `ProjectSpinout` from Management — evaluate for platform promotion.
4. `pending` `Priority` from Business — read for context but don't generate outbox unless explicitly asked.

## Decline triggers (escalate or BuildRequestResponse with rationale)

- BuildRequest violates platform standards (e.g. asks for a different ORM, breaks shared lib API).
- BuildRequest cost estimate exceeds active project's remaining budget.
- ProjectSpinout's code has tight coupling to project's specific business logic — won't generalize.

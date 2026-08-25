# Architecture Decision Records

Architecture decision records preserve durable technical and domain-architecture
choices for Meal Planner. Product behaviour is owned by
[`../../decisions/product`](../../decisions/product/); ADRs translate accepted
product direction into authority, consistency, persistence, and module
boundaries.

## Status

Records use `Proposed`, `Accepted`, `Superseded`, `Rejected`, or `Deprecated`.
An accepted ADR is direction for new greenfield work. It does not create a
compatibility or migration obligation unless the record explicitly names one.

## Index

- [ADR-0001 — Separate household people from authenticated members](0001-separate-household-people-from-auth-members.md)
- [ADR-0002 — Model plans through meal requirements and explicit coverage](0002-model-plans-through-requirements-and-coverage.md)
- [ADR-0003 — Separate meal content, preparation, and prepared stock](0003-separate-meal-content-preparation-and-stock.md)
- [ADR-0004 — Household agent coordinator and isolated chat agents](0004-household-agent-coordinator-and-isolated-chat-agents.md)

Current-state architecture remains documented by the capability documents in
the parent directory. An ADR may describe accepted future direction that is not
yet implemented; delivery records must state when the cutover occurs.
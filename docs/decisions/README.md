# Decision Records

## Purpose

Meal Planner keeps durable product and architecture decisions in the repository.
A decision that changes household behaviour, privacy, authority, safety,
planning semantics, or a long-lived technical boundary must not exist only in a
conversation, issue, pull-request comment, or implementation detail.

## Record Types

### Product decision records

Product decision records live under [`product/`](product/). They define accepted
user-facing behaviour, MVP boundaries, product invariants, and deliberate
deferrals. They answer **what the product must do and why** without prescribing
every implementation detail.

### Architecture decision records

Architecture decision records live under
[`../architecture/decisions`](../architecture/decisions/). They define durable
technical and domain-architecture choices, alternatives, and consequences. They
answer **how authority and implementation boundaries are structured and why**.

### Delivery records

Current work, stage status, dependencies, and evidence live under
[`../delivery`](../delivery/). Delivery records may narrow an accepted decision
for one vertical slice, but may not silently reverse it.

## Status

Each record uses one of:

- `Proposed` — under active review and not yet implementation authority;
- `Accepted` — approved direction for new work;
- `Superseded` — replaced by another named record;
- `Rejected` — considered and deliberately not selected; or
- `Deprecated` — still present for history but no longer recommended.

Accepted records are greenfield direction. They do not create compatibility,
backfill, dual-write, or migration obligations unless the record explicitly
identifies a real contract that must be preserved.

## Product Decision Index

- [PDR-0001 — Household people, profiles, and interviews](product/0001-household-people-profiles-and-interviews.md)
- [PDR-0002 — Routines, fallbacks, and personalised plan rationale](product/0002-routines-fallbacks-and-plan-rationale.md)
- [PDR-0003 — Complete weekly planning, repair, approval, and review](product/0003-weekly-planning-repair-approval-and-review.md)
- [PDR-0004 — Meal content, portions, prepared food, recipes, and shopping](product/0004-meal-content-portions-recipes-and-shopping.md)
- [PDR-0005 — MVP scope and deliberately deferred capabilities](product/0005-mvp-scope-and-deferrals.md)
- [PDR-0006 — AI evaluation and release evidence](product/0006-ai-evaluation-and-release-evidence.md)

## Decision Process

1. State the household problem and affected users.
2. Identify whether the choice changes privacy, authority, safety, or plan
   semantics.
3. Compare the smallest viable alternatives.
4. Record the accepted answer in one owning decision record.
5. Update affected blueprint and architecture documents.
6. Add delivery work under `docs/delivery` only after the decision is accepted.
7. Link implementation pull requests back to the record and provide evidence.

Do not create a record for a local code choice that is easy to reverse and has
no durable consequence. Do not avoid a record merely because the decision first
appeared obvious during implementation.
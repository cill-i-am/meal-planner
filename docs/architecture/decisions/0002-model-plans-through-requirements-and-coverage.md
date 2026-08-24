# ADR-0002 — Model Plans Through Meal Requirements And Explicit Coverage

- Status: Accepted
- Date: 2026-08-24
- Related product decisions:
  - [PDR-0002](../../decisions/product/0002-routines-fallbacks-and-plan-rationale.md)
  - [PDR-0003](../../decisions/product/0003-weekly-planning-repair-approval-and-review.md)

## Context

The current proof-of-concept planner places recipes into dated meal slots with a
serving count. The intended product must account for every managed person and
meal occasion while supporting shared meals, person exceptions, routines,
leftovers, takeaway, intentional skips, and flexible slots.

A recipe-calendar aggregate cannot reliably prove complete coverage or explain
which people are excluded. A raw person-by-meal matrix is complete but is not an
appropriate default user experience.

## Decision

- A planning period defines dates, managed meal occasions, and the household
  people in scope.
- The planner materializes or can deterministically derive one meal requirement
  for each managed `person × date × meal occasion` combination.
- Every requirement has one explicit current coverage outcome.
- Coverage distinguishes at least:
  - a meal option;
  - a prepared portion or component allocated from an earlier output;
  - an external meal such as takeaway, restaurant, school, or canteen;
  - an intentional skip;
  - a flexible decide-on-the-day resolution; and
  - an unresolved gap.
- Shared meals may resolve several requirements, but the authority retains the
  exact people and requirements covered.
- Routines produce concrete requirement or coverage input for one planning
  period and are versioned separately from the plan.
- Plan approval requires every managed requirement to have a non-gap resolution
  in the MVP.
- Draft mutations execute through repair-aware operations that recalculate
  dependent coverage, preparation, portions, and shopping demand.
- Approved plans are immutable revisions. Changes create a proposed revision
  rather than silently altering the active plan.

The domain may use a discriminated union for coverage outcomes. This ADR does
not require the frontend to consume that union directly. A plan projection may
group shared meals, collapse repeated routines, nest person exceptions, and
show rationale more effectively.

## Consequences

- Completeness and hard-constraint validation become deterministic domain
  invariants rather than prompt instructions.
- A plan mutation cannot safely be modelled as an isolated calendar-cell write
  when it affects leftovers, fallbacks, cook events, or shopping demand.
- The household authority needs stable requirement, resolution, revision, and
  rationale identity or an equivalent transactionally consistent model.
- UI and agent commands should operate on product intentions such as replace,
  move, make easier, scale for leftovers, and replan remaining dates.
- The internal matrix may be inspectable for diagnosis while the ordinary UI
  remains a compressed household week.

## Alternatives Rejected

### Keep recipe-in-slot as the canonical aggregate

Rejected because it cannot truthfully express per-person skips, external meals,
shared coverage, person fallbacks, or complete all-meal accounting.

### Treat absent entries as implicitly handled

Rejected because missing information is indistinguishable from fasting, eating
out, or a forgotten person.

### Make the raw matrix the UI contract

Rejected as a mandatory boundary because a complete authority shape and a good
human projection solve different problems.
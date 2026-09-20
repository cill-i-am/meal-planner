# Stage 5 — Complete Household Planning And Prepared Output

Status: proposed
Owner: unassigned
Depends on: [preceding capability](meal-content.md)

Accepted product direction from the roadmap; implementation is not claimed.
Sequence expresses dependencies and learning, not a requirement to finish every
possible preceding feature before an end-to-end tracer.

## Outcome

The system proposes and revises one complete personalised week for every managed
person and meal occasion while presenting a simple human plan.

## Scope

- planning period and meal-requirement materialization;
- explicit coverage for every managed person-date-occasion requirement;
- shared and individual meal coverage;
- routine-derived coverage;
- external meals, intentional skips, flexible slots, and unresolved gaps;
- one strong recommended plan rather than competing whole weeks;
- cook events separate from consumption;
- finished portions and reusable prepared components;
- per-person, per-occasion serving factors;
- deliberate batch scaling and planned leftover allocation;
- incidental-surplus recording;
- lightweight fridge/freezer prepared stock;
- cross-week carry-over confirmation;
- deterministic hard-constraint and allocation validation;
- draft repair across dependent meals and preparation;
- visible person-level rationale;
- pinned profile/routine versions, affected-meal analysis after a profile
  change, and an explicit remaining-period replan offer;
- compressed visual projection; and
- revisioned adult approval.

## Vertical tracer

A full household week covers all managed meals using routines, shared meals, one
person-level exception, one packaged fallback, eating out, an intentional skip,
a flexible slot, and a cook event that produces finished portions and a prepared
component for later lunches. A draft swap repairs dependencies. An approved-plan
change produces a visible revision rather than a silent rewrite.

## Acceptance

- [ ] every mandatory requirement is explicitly resolved before approval;
- [ ] the UI groups ordinary shared coverage while retaining person exceptions;
- [ ] hard constraints cannot be overridden by model suggestions;
- [ ] allocations cannot exceed produced portions;
- [ ] no per-meal confirmation is required on the happy path;
- [ ] plan revisions are idempotent and auditable; and
- [ ] active planning time is measured from proposal to approval.

This stage owns real planning, rationale, allocation, active-plan impact, and
dependency-repair evaluation under PDR-0006; discovery-stage fixtures cannot
substitute for this evidence.

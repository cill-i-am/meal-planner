# Stage 5 — Plan a complete household week

Status: proposed
Owner: unassigned
Depends on: [preceding capability](meal-content.md)

This is approved product direction, not a claim that the feature is built. The order reflects dependencies and what we need to learn. It does not require every possible earlier feature to be finished before trying a small end-to-end flow.

## Outcome

Propose and revise one understandable week of meals that covers every managed person and meal occasion.

## Scope

- the planning period and the required meals for its dates;
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
- a concise visual plan; and
- adult approval tied to a specific plan revision.

## Example flow

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
- [ ] ordinary use does not require confirming every meal;
- [ ] plan revisions are idempotent and auditable; and
- [ ] active planning time is measured from proposal to approval.

Under PDR-0006, this stage tests actual planning, explanations, food allocation, changes to an active plan and repairs to dependent meals. Discovery test data does not replace those checks.

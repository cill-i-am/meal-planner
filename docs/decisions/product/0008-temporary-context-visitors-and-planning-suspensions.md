# PDR-0008 — Temporary Context, Visitors, And Planning Suspensions

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

Household routines describe the normal week, but real weeks contain temporary
changes: travel, school holidays, unusual office days, overnight shifts,
visitors, split-custody changes, and whole-household holidays.

Those changes must not silently mutate enduring routines. A household travelling
abroad for a week also should not need to create dozens of fake intentional
skips, external meals, or unresolved cells merely to tell Meal Planner that it
is not responsible for that period.

## Decision

### Planning-period exceptions

- A temporary change is recorded as a bounded planning-period exception when it
  applies only to one period or explicit date range.
- Examples include a temporary absence, travel, school holiday, unusual office
  or school day, overnight shift, one-off custody change, and temporary change
  to cooking availability.
- The exception may apply to one person, several people, or the whole household.
- An exception overrides the relevant routine for its dates without editing or
  superseding the routine itself.
- When the exception ends, normal routine expansion resumes automatically for
  later planning periods.
- A stable repeating pattern, such as every second weekend, may instead become a
  versioned routine after adult confirmation.
- Manual entry through the agent or UI is sufficient for the MVP. External
  calendar integration is not required.

### Visitors

- A one-off visitor is represented as temporary meal demand for selected dates
  and occasions, not as a full `HouseholdPerson` by default.
- Visitor input should remain lightweight: display label, occasions covered,
  approximate portion requirement, and any hard suitability facts needed for
  the planned meals.
- A visitor does not receive an account, enduring profile, private interview, or
  ordinary household history in the MVP.
- A frequent visitor may later be promoted through an explicit adult action to
  a managed household person where an enduring profile and routines become
  useful.

### Planning suspension

- An adult may suspend Meal Planner's planning responsibility for a selected
  person set and date range, including a complete planning period for the whole
  household.
- A suspension means the product is not expected to decide or shop for those
  meals. It is distinct from:
  - an intentional skip, where a person deliberately does not eat;
  - an external meal, where the plan intentionally records takeaway,
    restaurant, school, or canteen coverage;
  - a flexible slot, where the household will decide on the day; and
  - an unresolved gap, where the planner failed to find valid coverage.
- Suspended scope does not create managed meal requirements and does not count
  as incomplete coverage, skipped meals, failed planning, or unused plan
  recommendations.
- The product may present this as **away** or **planning paused**. A detailed
  reason is optional; the household is not required to disclose sensitive
  travel, health, or family circumstances.
- If the household still wants assistance while travelling, it should leave
  planning active and use temporary location context or external meals instead
  of suspension.

### Effect on a draft plan

- Applying a suspension to a draft repairs the affected range.
- The repair removes or disables affected meal coverage, cook events, prepared
  outputs, allocations, routine expansions, and shopping preview demand.
- Dependencies outside the suspended range are repaired or shown as conflicts.
  For example, a lunch after the household returns cannot depend on a batch cook
  that was removed during the holiday.
- The draft explains the resulting changes.

### Effect on an approved plan

- Suspending any part of an approved period creates a proposed plan revision
  with a visible diff. It never silently rewrites the active plan.
- Accepting the revision releases future allocations and reservations that no
  longer apply and updates plan-derived shopping demand.
- Manual shopping items and items already checked or purchased remain visible
  under the shopping-state policy; they are not silently erased.
- Historical approved revisions remain available for audit and explanation.
- An adult may resume planning early through another explicit revision.

### Whole-household holiday

A household away for the entire week may suspend the complete period. The
product may represent that implementation as no managed plan for the suspended
range or as a plan with an explicit suspended segment. The implementation must
preserve the accepted semantics above and must not manufacture one skip per
person and meal.

## Consequences

- Requirement generation needs an explicit managed-scope or suspension check
  before producing the `person × date × meal occasion` matrix.
- Plan completeness and product analytics must exclude suspended scope rather
  than treating it as failure or noncompliance.
- Draft repair and approved-plan revision must trace dependencies across the
  suspension boundary.
- Routine state remains stable across one-off changes.
- Visitor support remains lightweight and does not require expanding the
  household-person lifecycle for occasional guests.

## Deferred

- external calendar synchronization;
- travel itinerary and destination-aware meal planning;
- visitor accounts or permanent guest roles;
- complex custody-management workflows;
- automatic detection that a household is away; and
- automatic plan suspension without adult confirmation.

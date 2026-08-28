# Current Delivery State

- Last updated: 2026-08-27
- Delivery source of truth: this repository

## Active Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Active
- Immediate delivery target:
  [`01-person-registry-and-lifecycle.md`](stages/01-household-people/01-person-registry-and-lifecycle.md)
  (`Ready`)

Only the first independently implementable work item is ready. Account linking
and departure, profile authority, and the private interview-session boundary
remain proposed until their recorded dependencies are resolved.

## Completed Foundation

- [PR #189 — household product blueprint](https://github.com/cill-i-am/meal-planner/pull/189)
  merged on 2026-08-27. Its product decisions, ADRs, and repository-owned
  delivery model are accepted direction.
- Stage 0 is complete. The household-authority foundation and cutover landed
  through [PR #182](https://github.com/cill-i-am/meal-planner/pull/182),
  [PR #183](https://github.com/cill-i-am/meal-planner/pull/183),
  [PR #186](https://github.com/cill-i-am/meal-planner/pull/186),
  [PR #187](https://github.com/cill-i-am/meal-planner/pull/187),
  [PR #188](https://github.com/cill-i-am/meal-planner/pull/188),
  [PR #190](https://github.com/cill-i-am/meal-planner/pull/190),
  [PR #191](https://github.com/cill-i-am/meal-planner/pull/191), and
  [PR #192](https://github.com/cill-i-am/meal-planner/pull/192).
- One `HouseholdObject` per Better Auth organization is the canonical writer for
  household product state. Better Auth D1 remains the identity, organization,
  membership, invitation, and role control plane. The remaining shared D1 owns
  only global provider accounting.

## Immediate Next Steps

1. Assign one implementation lane to Work Item 01 from freshly fetched `main`.
2. Deliver its authenticated roster vertical through `HouseholdObject`, public
   API, minimal web UI, and real restart/isolation proof.
3. Review the exact immutable head before merge, then update the work item and
   this current-state record with delivery evidence.
4. Resolve and accept the departure-coordination ADR before promoting Work Item
   02 to `Ready`.

## Deliberate Non-Work

Do not start retailer integration, full pantry inventory, calories/macros,
medical goal systems, MCP delivery, embedded channels, or generic organization
support while the first household vertical remains unproven.

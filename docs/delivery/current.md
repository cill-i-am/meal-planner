# Current Delivery State

- Last updated: 2026-08-29
- Delivery source of truth: this repository

## Active Stage

### Stage 1 — Household people, profiles, and permissions

- Stage record:
  [`stages/01-household-people/README.md`](stages/01-household-people/README.md)
- Status: Active
- Immediate delivery target:
  [`01-person-registry-and-lifecycle.md`](stages/01-household-people/01-person-registry-and-lifecycle.md)
  (`In review`)

The first independently implementable work item has a working implementation
and real-runtime evidence in
[draft PR #198](https://github.com/cill-i-am/meal-planner/pull/198). It remains
in review until the frozen head passes hosted CI and independent exact-head
review. Account linking and departure, profile authority, and the private
interview-session boundary remain proposed until their recorded dependencies
are resolved.

The Work Item 01 identity boundary derives a stable household-scoped linkage
subject from immutable Better Auth user plus organization identity, separately
from its audit actor. Better Auth's actual `owner` membership role is the only
creator-bootstrap authority; other admitted members are denied before private
household routing. Replacement local runtime, repository, build, and
Docker-backed physical gates are green after this acceptance strengthening. The
earlier head remains superseded; replacement hosted CI and a fresh independent
exact-head review are still required before merge authority.

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

1. Run hosted CI on the frozen Work Item 01 draft PR head.
2. Run a fresh independent exact-head review; resolve only proven
   in-scope findings before merge authority is considered.
3. After Work Item 01 is accepted, resolve and accept the
   departure-coordination ADR before promoting Work Item
   02 to `Ready`.

## Deliberate Non-Work

Do not start retailer integration, full pantry inventory, calories/macros,
medical goal systems, MCP delivery, embedded channels, or generic organization
support while the first household vertical remains unproven.

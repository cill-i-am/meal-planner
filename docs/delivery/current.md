# Current Delivery State

- Last updated: 2026-08-24
- Delivery source of truth: this repository

## Active Product Work

### Household product blueprint

- Pull request: [#189 — docs(product): add household product blueprint](https://github.com/cill-i-am/meal-planner/pull/189)
- Status: Draft, active workshop
- Outcome: accept the product blueprint, product decision records, ADRs, and
  repository-owned delivery workflow before Stage 1 implementation planning.

The blueprint workshop is resolving product semantics in the repository branch.
Accepted decisions are recorded under [`../decisions`](../decisions/) and
architecture consequences under
[`../architecture/decisions`](../architecture/decisions/).

## Current Architecture Dependency

The existing household authority migration remains Stage 0 of the product
roadmap.

- Slice 2 evidence metadata merged in
  [#188](https://github.com/cill-i-am/meal-planner/pull/188) on 2026-08-23.
- The accepted migration plan identifies Slice 3 settlement and recovery as the
  next authority cutover, followed by batches and final shared household D1
  retirement.
- New household product capabilities should not introduce another shared-D1
  product authority while that cutover is incomplete.

## Immediate Next Steps

1. Finish the product decision workshop and update PR #189 until the blueprint
   has no material unresolved MVP ambiguity.
2. Review the blueprint and decision records for internal contradictions and
   stale Linear references.
3. Rebase or merge current `main` into the documentation branch before final
   review because Slice 2 landed after the branch was created.
4. Accept and merge the documentation PR.
5. Write the Stage 1 repository record for household people, profiles, and
   account linking.
6. Split Stage 1 into independently reviewable vertical work items with explicit
   runtime and product evidence.

## Deliberate Non-Work

Do not start retailer integration, full pantry inventory, calories/macros,
medical goal systems, MCP delivery, embedded channels, or generic organization
support while the first household vertical remains unproven.
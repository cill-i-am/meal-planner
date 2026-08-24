# Work Item — <Outcome>

- Status: Proposed
- Stage: <stage identifier and link>
- Owner: <implementation lane or person>
- Pull request: Not opened
- Completed by: Not completed

## Household Outcome

Describe the user-visible or operator-visible outcome in one paragraph. Name the
person or household actor affected and the problem removed.

## Accepted Direction

Link the product decision records, ADRs, current architecture documents, and
blueprint sections that constrain this work.

## Scope

### In scope

- <behaviour>
- <behaviour>

### Out of scope

- <explicit exclusion>
- <explicit exclusion>

## Product Semantics

Define the important commands, states, invariants, permissions, and visible
failure behaviour. Do not substitute file names for product behaviour.

## Authority And Privacy

State:

- canonical writer and store;
- admitted actors and authorization path;
- private versus household-visible information;
- transaction boundary;
- external effects and post-commit behaviour; and
- deletion or retention effects, when relevant.

## Failure, Replay, And Concurrency

List expected conflicts, idempotency rules, stale-version behaviour, races, and
recovery semantics.

## Vertical Tracer

Describe one end-to-end scenario that proves the production boundary rather than
isolated helpers.

## Acceptance Evidence

- [ ] Product/domain tests prove the accepted semantics.
- [ ] Real runtime or persistence tests cover the production authority seam.
- [ ] Authorization and cross-household isolation are proven.
- [ ] Replay, collision, restart, and relevant concurrency are proven.
- [ ] Privacy-safe projections and failures are proven.
- [ ] Current-state architecture and public contracts are updated.
- [ ] Required repository checks, tests, lint, formatting, and builds pass.
- [ ] Exact-head review findings are disposed for the risk tier.

Add work-specific evidence below:

- [ ] <evidence>

## Implementation Notes

Record constraints that help implementation without prematurely freezing a file
layout or abstraction. Move a durable choice into an ADR instead of burying it
here.

## Delivery Log

Record meaningful status transitions, exact pull-request head, verification
results, review disposition, merge commit, and any superseding work.
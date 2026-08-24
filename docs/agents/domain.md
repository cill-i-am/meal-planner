# Domain Documentation

Use domain documents to preserve product intent and architecture that should
outlive one work item or pull request.

## Where Durable Intent Lives

- [`../product-blueprint/`](../product-blueprint/) owns the long-horizon
  household product, experience, domain language, beta proof, and capability
  sequence.
- [`../decisions/product/`](../decisions/product/) owns accepted product
  behaviour and deliberate deferrals.
- [`../architecture/decisions/`](../architecture/decisions/) owns durable
  technical and domain-architecture decisions.
- Current architecture documents under `../architecture/` describe implemented
  authority and boundaries.
- [`../delivery/`](../delivery/) owns active stages, work items, status, blockers,
  and evidence.
- Repo instruction rules live in `AGENTS.md` at the nearest semantic scope.
- Feature-specific facts may live beside the feature when they are useful only
  to that capability and do not contradict a durable record.

## Choosing A Record

Create a product decision record when a choice changes:

- user-visible behaviour;
- household privacy or permissions;
- plan completeness or approval;
- safety and hard-constraint semantics;
- MVP scope; or
- a deliberate product deferral.

Create an ADR when a choice changes:

- canonical authority or persistence;
- identity or consistency boundary;
- transaction or orchestration ownership;
- long-lived module or integration structure; or
- an accepted technical alternative that will be expensive to reverse.

Use a delivery work item for exact implementation scope, acceptance evidence,
and mutable status. Do not use it to smuggle in an unresolved product decision.

## Domain Document Rules

- Keep product language separate from implementation chores.
- Name the person, household actor, system principal, or operator involved.
- State invariants and visible failure behaviour.
- Record rejected alternatives when they explain future choices.
- Preserve provenance, confidence, and unresolved uncertainty for imported
  recipe facts; do not invent missing quantities, timings, yield, or nutrition.
- Keep domain terms stable. Rename terms deliberately across decisions,
  architecture, contracts, implementation, and delivery docs.
- Link rather than duplicate. One document should own each durable decision.
- When a decision changes, mark the old record Superseded and name the
  replacement.

## Avoid

- turning every local code change into an ADR;
- burying durable decisions only in PR comments or conversation transcripts;
- copying the same intent across several active documents;
- allowing mutable delivery status to live only in an external tool;
- treating a draft plan, shopping list preview, basket, checkout, or external
  message as approved; and
- building compatibility machinery for greenfield prototypes without an
  accepted decision and real contract.
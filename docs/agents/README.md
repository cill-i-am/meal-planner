# Agent Workflow Docs

These docs define the repository-owned operating loop for Meal Planner work.

## Current Workflow

- [`repository-workflow.md`](repository-workflow.md): authority order and the
  Decide, Plan, Build, Verify, Review, and Complete loop.
- [`domain.md`](domain.md): product, household-domain, decision-record, and ADR
  conventions.
- [`execution-policy.md`](execution-policy.md): dispatch, implementation,
  verification, review authority, finding disposition, and physical proof.
- [`../delivery/work-item-template.md`](../delivery/work-item-template.md):
  template for independently reviewable vertical delivery work.
- [`worker-thread-template.md`](worker-thread-template.md): template for bounded
  implementation handoffs.
- [`reviewer-thread-template.md`](reviewer-thread-template.md): template for
  read-only exact-head review.

## Product And Delivery Sources

Read:

- [`../product-blueprint/`](../product-blueprint/) for the product direction;
- [`../decisions/`](../decisions/) for accepted product choices;
- [`../architecture/decisions/`](../architecture/decisions/) for ADRs;
- [`../delivery/current.md`](../delivery/current.md) for current work; and
- the owning stage/work-item record for exact scope and evidence.

Linear-oriented workflow and templates in this directory are legacy material and
are not authoritative for new work. Do not use them unless the user explicitly
records a decision to restore that workflow.

Role and capability skills provide techniques inside the repository workflow;
they must not invent product decisions, authority transitions, delivery status,
or compatibility requirements.
# Household Product Blueprint

## Purpose

This directory records the accepted long-horizon product direction for Meal
Planner. It defines the product promise, experience bar, domain language, beta
proof, staged capability sequence, and unresolved decisions that should survive
individual implementation issues and pull requests.

It does **not** replace Linear as the live source for current Project/PRD scope,
issue readiness, blockers, delivery status, or implementation ownership. It also
does not replace the current-state architecture documents under
[`../architecture`](../architecture/).

When the three sources answer different questions:

- this blueprint owns the intended household product and experience;
- architecture documents own current and accepted technical boundaries; and
- Linear owns what is being delivered now.

## Product North Star

> Remove the weekly mental load of figuring out what every person in a
> household will eat, while producing a realistic, editable plan that fits the
> household's routines, constraints, cooking capacity, and preferences.

The first product is judged primarily by how quickly a household reaches a good,
approved plan and how little correction is required over time. The AI-led
conversation is itself a differentiating product surface: it should feel like
sitting with an excellent nutrition-aware family meal planner, without becoming
clinical, judgmental, or difficult to use.

## Accepted Direction

- Version one's primary promise is **less time spent planning**.
- The plan covers **all configured meal occasions**, not dinners alone.
- The first release is validated with a **small, invite-only beta**.
- Recipe supply combines a **shared curated catalogue** with **private
  household imports and adaptations**.
- An adult's raw interview transcript is private to that participant.
  Confirmed person-profile facts and shared planning artifacts are visible
  within the household.
- The agent progressively builds editable profiles, routines, and plans rather
  than running a hidden questionnaire and revealing a result only at the end.
- Person routines, household routines, exceptions, intentional leftovers, and
  low-burden fallback meals are first-class planning inputs.
- The planner accounts for every configured `person × date × meal occasion`
  requirement, while presenting a compressed human-readable plan rather than a
  giant matrix.
- Cooking events are distinct from eating events. One cook can produce portions
  for several people and later meals.
- Weekly review is the primary feedback loop; meal-by-meal feedback remains
  optional.
- Retailer authentication, product matching, basket mutation, checkout, and
  partnerships are deliberately deferred.
- MCP and embedded distribution may expose the same product capabilities later,
  but neither is a beta launch dependency.

## Document Map

1. [Vision and scope](vision-and-scope.md) defines the promise, target users,
   product principles, beta capabilities, and explicit non-goals.
2. [Experience blueprint](experience-blueprint.md) defines the AI conversation,
   routine builder, plan review, privacy experience, and weekly learning loop.
3. [Domain model](domain-model.md) defines the core concepts, relationships,
   coverage matrix, cooking/portion model, and non-negotiable invariants.
4. [Recipe strategy](recipe-strategy.md) separates the curated catalogue from
   household recipes and defines import, versioning, forking, scaling, and
   provenance direction.
5. [Beta and success evidence](beta-and-success.md) defines the first complete
   vertical, beta operating model, measures, and evidence required to validate
   the product thesis.
6. [Delivery roadmap](delivery-roadmap.md) sequences capabilities into stages
   without pretending they are calendar commitments.
7. [Open decisions](open-decisions.md) records accepted answers and the product
   questions that still require explicit resolution.

## Reading Order For Product Work

Before changing durable product behavior, read this index, the relevant
blueprint document, the current architecture document for the affected
capability, and the live Linear Project or issue. An implementation issue may
narrow a blueprint stage, but it should not silently reverse an accepted product
invariant.

## Change Discipline

- Update the smallest owning document rather than copying the same decision
  across the directory.
- Add unresolved questions to `open-decisions.md`; do not disguise assumptions
  as accepted requirements.
- Keep product outcomes and domain invariants separate from provisional storage,
  provider, and UI implementation choices.
- When a decision changes, update dependent documents and explain the
  superseded alternative in the pull request.
- Do not infer medical needs, dietary restrictions, or private facts from data
  outside an explicit product interaction.
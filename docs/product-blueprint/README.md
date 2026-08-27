# Household Product Blueprint

## Purpose

This directory records the accepted long-horizon product direction for Meal
Planner. It defines the product promise, experience bar, domain language, beta
proof, staged capability sequence, and unresolved questions that should survive
individual implementation work and pull requests.

The blueprint does not replace:

- accepted product decisions under [`../decisions/product`](../decisions/product/);
- ADRs and current architecture under [`../architecture`](../architecture/); or
- active delivery state under [`../delivery`](../delivery/).

When sources answer different questions:

- this blueprint owns the intended household product and experience;
- product decision records own accepted behavioural choices;
- ADRs own durable technical boundaries;
- current architecture docs own implemented authority; and
- delivery records own what is being built now.

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
- Interviews are repeatable profile reviews, not one-time onboarding forms.
- In the MVP, any adult may edit adult and dependant profiles and shared plans;
  changes remain audited.
- The agent progressively builds editable profiles, routines, and plans rather
  than running a hidden questionnaire and revealing a result only at the end.
- Person routines, household routines, exceptions, intentional leftovers,
  packaged or external meals, and person-specific fallbacks are first-class.
- The planner accounts for every configured `person × date × meal occasion`
  requirement, while presenting one compressed, fully personalised week.
- Cooking events are distinct from eating events. One cook can produce finished
  meals and prepared components for several people and later occasions.
- The ordinary during-week path requires no per-meal logging.
- Weekly review is optional and is the primary feedback and carry-over
  checkpoint.
- The beta creates a retailer-neutral shopping list only after plan approval.
- Retailer fulfilment, complete pantry inventory, calories/macros, generic goals,
  food-safety expiry calculation, MCP, and embedded distribution are deferred.

The accepted detail is recorded in
[`../decisions/product`](../decisions/product/).

## Document Map

1. [Vision and scope](vision-and-scope.md) defines the promise, target users,
   product principles, beta capabilities, and explicit non-goals.
2. [Experience blueprint](experience-blueprint.md) defines the AI conversation,
   routine builder, plan review, privacy experience, and weekly learning loop.
3. [Domain model](domain-model.md) defines the core concepts, relationships,
   coverage model, cooking/portion model, and non-negotiable invariants.
4. [Recipe strategy](recipe-strategy.md) separates the curated catalogue from
   household recipes and defines import, versioning, forking, scaling, and
   provenance direction.
5. [Beta and success evidence](beta-and-success.md) defines the first complete
   vertical, beta operating model, measures, and evidence required to validate
   the product thesis.
6. [Delivery roadmap](delivery-roadmap.md) sequences capabilities into stages
   without pretending they are calendar commitments.
7. [Open decisions](open-decisions.md) contains only questions that still need
   explicit resolution; accepted answers move into decision records.

## Reading Order For Product Work

Before changing durable product behaviour, read:

1. this index and the relevant blueprint document;
2. the accepted product decision records;
3. the current architecture document and ADRs for the capability;
4. `../delivery/current.md`; and
5. the owning delivery work item.

An implementation work item may narrow a stage, but it may not silently reverse
an accepted product invariant.

## Change Discipline

- Update the smallest owning document rather than copying the same decision
  across the directory.
- Add unresolved questions to `open-decisions.md`; do not disguise assumptions
  as accepted requirements.
- Move resolved product behaviour into a product decision record.
- Keep product outcomes and domain invariants separate from provisional storage,
  provider, schema, and UI implementation choices.
- When a decision changes, mark the old record Superseded, name the replacement,
  and update affected blueprint, architecture, and delivery documents.
- Do not infer medical needs, dietary restrictions, or private facts from data
  outside an explicit product interaction.
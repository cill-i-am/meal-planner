# Domain Model

## Purpose

This document defines the stable product language and invariants for household
food planning. It deliberately avoids prescribing every database table, RPC
shape, or service boundary. Current technical authority remains documented
under [`../architecture`](../architecture/).

## Core Model

```text
Household
  ├── Authenticated Members
  ├── Household People
  │     ├── Person Profiles
  │     └── Person Routines
  ├── Household Routines
  ├── Household Recipe Bank
  └── Planning Periods
          ├── Meal Requirements
          ├── Coverage Resolutions
          ├── Cook Events
          ├── Portion Allocations
          ├── Plan Revisions
          └── Approval
```

The shared curated recipe catalogue is separate from household product state.
A household may reference or fork a catalogue recipe, but the catalogue must
not become a global projection of private household recipes.

## Identity And People

### Authenticated member

Better Auth owns accounts, sessions, organizations, memberships, invitations,
and roles. An authenticated member represents authority to access or manage the
household; it is not automatically the complete model of a person who eats.

### Household person

A `HouseholdPerson` represents someone whose food requirements may need to be
planned. It has a stable household-local identity and may be:

- an adult linked to a Better Auth user;
- an invited adult not yet linked to an account; or
- a dependant with no account.

A person's lifecycle is independent of account invitation and session
lifecycle. Linking an account must not create a duplicate eater or lose existing
profile and planning history.

### Person profile

A `PersonProfile` is the confirmed, household-visible set of planning facts for
one person. Facts may include:

- hard safety and dietary constraints;
- dietary pattern;
- strong and weak food preferences;
- accepted foods and fallback meals;
- cuisines, ingredients, textures, and spice tolerance;
- ordinary meal habits and intentional skips;
- context such as office, school, or packed-lunch needs;
- portion or life-stage considerations; and
- user-stated planning goals.

A profile fact should carry enough metadata to distinguish:

```ts
interface PersonProfileFact {
  readonly factId: ProfileFactId
  readonly kind: ProfileFactKind
  readonly value: ProfileFactValue
  readonly strength: "hard" | "strong" | "weak"
  readonly source:
    | "person_stated"
    | "guardian_stated"
    | "household_confirmed"
    | "feedback_observed"
  readonly confidence: number
  readonly confirmedAt: Instant
  readonly reviewAfter: Instant | null
}
```

The exact encoded union belongs to the implementing capability. Model-derived
suggestions do not become confirmed profile facts without an admitted product
transition.

### Interview session

An `InterviewSession` is a private interaction owned by the participating adult.
Its transcript and intermediate reasoning are not household profile state. It
may propose facts, routines, questions, and conflicts for confirmation.

Confirmed outputs may enter the visible person profile. The transcript should
not be required to reconstruct planning authority.

## Routines

A `Routine` is a reusable, versioned rule that contributes requirements or
coverage suggestions to concrete planning periods. A routine belongs to either
one person or the household.

A routine can express:

- applicable weekdays or recurrence;
- a meal occasion;
- people covered;
- a location or context;
- a fixed meal, recipe, category, or intentional skip;
- a leftover-production or leftover-consumption rule;
- a fallback policy;
- priority and conflict behavior;
- effective dates; and
- one-off exceptions.

Routines generate a baseline. A planning-period exception changes one week
without silently mutating the enduring rule.

## Planning Period

A `PlanningPeriod` is a bounded set of dates and configured meal occasions for
one household. The first product normally uses a week, but the domain should not
make seven days an accidental identity rule.

The household configures relevant meal occasions, for example:

```text
breakfast
morning snack
lunch
afternoon snack
dinner
```

Not every household or person must use every conventional occasion.

## Meal Coverage Matrix

For a planning period, the system materializes or can deterministically derive
the required matrix:

```text
household person × date × configured meal occasion
```

Each required cell is represented by a `MealRequirement`. A requirement records
who needs to be accounted for, when, and any relevant context or hard
constraints.

Every requirement has exactly one current `CoverageResolution`:

```ts
type CoverageResolution =
  | SharedMealCoverage
  | IndividualMealCoverage
  | RoutineItemCoverage
  | LeftoverCoverage
  | EatingOutCoverage
  | IntentionalSkipCoverage
  | UnresolvedCoverage
```

A shared meal may resolve many requirements. The UI can group those cells into
one human-readable event, but grouping must not erase person-level exceptions.

### Shared meal coverage

Several people consume the same meal or compatible portions of one meal event.
A person-specific variation may still reference shared components.

### Individual meal coverage

One person receives a separate meal because a shared meal does not fit. The
planner should prefer a low-burden variation or known fallback where possible.

### Routine item coverage

A repeated simple food or routine resolves the requirement without requiring a
new recipe-selection decision each week.

### Leftover coverage

The requirement consumes portions produced by an earlier cook event. The
allocation must identify the producing batch and cannot consume more portions
than remain available.

### Eating out coverage

The household intentionally excludes the meal from home preparation and the
shopping demand produced by this product.

### Intentional skip coverage

The person intentionally has no food requirement for that occasion, such as an
explicit fasting routine. Absence of data is not an intentional skip.

### Unresolved coverage

The planner cannot safely or practically cover the requirement. The gap remains
visible and cannot be disguised by a generic recipe or invented fact.

## Meal Events And Cook Events

A `MealEvent` represents consumption. A `CookEvent` represents preparation.
They are separate because one preparation may satisfy several consumption
events and because some meal events require no cooking.

### Cook event

A cook event records:

- the recipe version or preparation instruction;
- planned date and time;
- people or meal events it supports;
- intended production quantity;
- expected cooking effort and equipment; and
- any shared-component variations.

### Cook batch

A cook event produces one or more `CookBatch` records. A batch has a measurable
or countable quantity and allocation state. The first product may use normalized
portion units while preserving the ability to adopt weight or volume where the
recipe supports it.

### Portion allocation

A `PortionAllocation` assigns part of a batch to one or more meal requirements.
It supports the product statement:

```text
Cook six portions on Monday.
Four cover Monday dinner.
Two cover Tuesday lunch.
```

The planner must not double-allocate portions or claim leftovers that the cook
event did not produce.

## Fallback Meals And Variations

A `FallbackMeal` is an accepted, low-friction resolution for a person when the
shared meal is unsuitable. It may be:

- a variation using shared ingredients or components;
- a simple routine food;
- a known freezer or pantry option; or
- a separate recipe where the household accepts the extra effort.

Fallbacks are not permission to ignore nutritional or safety constraints. They
are also not automatically scheduled whenever a person expresses a weak
dislike; strength, household policy, and variety goals matter.

## Meal Plan Aggregate

A `MealPlan` binds one planning period, its requirements, current coverage,
cook events, allocations, decisions, and revision history.

A plan lifecycle begins as a draft and may be approved or rejected. Any
post-approval edit that changes food coverage, cooking demand, or shopping
demand must create an explicit new revision or return the plan to a draft state.

The plan should pin immutable recipe versions so that later recipe edits do not
silently change an approved historical or active week.

## Weekly Review And Feedback

A `WeeklyReview` gathers lightweight feedback about the previous planning
period. A `FeedbackSignal` belongs to a person, meal event, cook event, recipe,
routine, or plan and may record signals such as:

- liked or disliked;
- skipped or not made;
- too much effort;
- wrong quantity;
- fallback used;
- dependant rejection; or
- make again.

Feedback does not automatically rewrite hard profile facts or enduring routines.
The agent proposes an explicit profile, routine, recipe, or policy change when
the evidence warrants it.

## Shopping Demand

An approved plan produces retailer-neutral `IngredientDemand` from its cook and
meal events. Demand is aggregated across recipes and adjusted only by explicit
product facts, such as confirmed pantry availability.

A shopping list contains food requirements, quantities, acceptable forms, and
manual status. It does not contain retailer credentials or imply an external
basket mutation.

## Non-Negotiable Invariants

1. Every configured person-date-meal requirement has one explicit current
   resolution.
2. Missing information is never interpreted as an intentional skip.
3. Beta plan approval requires every mandatory requirement to be resolved.
4. Hard constraints are evaluated by deterministic domain policy and cannot be
   overridden by a model recommendation.
5. A shared meal records exactly which people and requirements it covers.
6. A person-specific fallback must be safe for that person and represented as
   actual coverage, not a note attached to an incompatible shared meal.
7. Cook events and meal events are distinct.
8. Portion allocations cannot exceed batch production or allocate the same
   portion twice.
9. Approved plans pin recipe versions and retain an auditable revision.
10. Raw interview transcripts are not household planning authority.
11. Confirmed person-profile facts are household-visible by default in the
    accepted beta direction.
12. Agent proposals become authoritative only through typed, validated domain
    commands.
13. Imported recipe uncertainty and provenance survive into review and approved
    versions where relevant.
14. Retailer state and credentials are outside the initial household plan and
    shopping authority.

## Agent And Domain Responsibility

The agent is responsible for:

- understanding natural language;
- choosing valuable follow-up questions;
- proposing profiles and routines;
- generating and revising candidate plans;
- explaining conflicts and trade-offs; and
- summarizing feedback into proposed changes.

The deterministic domain is responsible for:

- authorization and visibility;
- schema decoding;
- profile and routine transitions;
- coverage completeness;
- hard-constraint enforcement;
- recipe-version authority;
- portion arithmetic;
- idempotency and concurrency;
- plan lifecycle and approval; and
- shopping-demand derivation.

The desired product is an unusually capable agent operating through an
unusually strict domain, not a model prompt acting as the database.
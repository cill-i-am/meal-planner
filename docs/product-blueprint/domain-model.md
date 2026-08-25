# Domain Model

## Purpose

This document defines stable product language and invariants for household food
planning. It deliberately avoids prescribing every table, RPC, service, or
frontend projection. Current implemented authority remains documented under
[`../architecture`](../architecture/), and accepted detail is recorded under
[`../decisions/product`](../decisions/product/).

## Core Model

```text
Household
  ├── Authenticated Members
  ├── Household People
  │     ├── Versioned Person Profiles
  │     ├── Person Routines
  │     ├── Portion Defaults
  │     └── Approved Fallbacks
  ├── Household Routines And Capacity
  ├── Household Meal Content
  ├── Prepared Food Stock
  └── Planning Periods
          ├── Meal Requirements
          ├── Coverage Resolutions
          ├── Meal Options
          ├── Cook Events
          ├── Prepared Outputs
          ├── Allocations
          ├── Planning Rationale
          ├── Plan Revisions
          └── Approval
```

The shared curated recipe catalogue is separate from household product state. A
household may reference or fork a catalogue recipe, but the catalogue must not
become a global projection of private household content.

## Identity And People

### Authenticated member

Better Auth owns accounts, sessions, organizations, memberships, invitations,
and roles. An authenticated member represents authority to operate the
household; it is not the complete model of a person who eats.

### Household person

A `HouseholdPerson` is a stable household-local identity for someone whose food
requirements may need planning. It may be:

- an adult linked to a Better Auth user;
- an invited adult not yet linked to an account; or
- a dependant with no MVP account.

Linking an account must not create a duplicate eater or lose profile, routine,
plan, feedback, or recipe history. The lifecycle of a person is distinct from
membership and session lifecycle.

Within one household, one authenticated user links to at most one household
person. The same user may belong to several households and link to one person in
each. An incorrect or duplicate link requires an explicit authorized repair
that preserves the retained person's product history; people are not
heuristically merged or deleted.

Removing an adult's household membership revokes account access immediately but
does not delete the household person. Leaving or removing someone archives the
person by default. An archived person no longer generates future meal
requirements and their routines no longer apply, while historical plans,
feedback, recipe changes, profiles, and audits retain stable references.

Remaining authorized adults may continue to understand household history. The
departed adult cannot read that history after membership removal. Restoring a
person reuses the same household-local identity. Permanent deletion is a
separate explicit lifecycle rather than the default leave-household operation.

## Person Profiles

A `PersonProfile` is a versioned, household-visible set of confirmed planning
facts for one person. In the MVP, any adult may edit any adult or dependant
profile; every mutation records actor, time, source, and before/after state.

### Fact categories

Profile facts may include:

- hard dietary or suitability constraints;
- dietary pattern;
- ingredient, dish, and cuisine preferences;
- strong avoids and ordinary dislikes;
- exact-product preferences and substitution policy;
- meal habits and intentional skips;
- location, school, office, travel, and packed-lunch context;
- preparation windows and household equipment relevance;
- default serving factors by meal occasion; and
- approved context-specific fallbacks.

A generic calorie, macro, weight, muscle, or medical-goal model is outside the
MVP.

### Suitability, preference, and fallback approval

These are distinct concepts:

- **Suitability** records allowed, needs adaptation, or prohibited.
- **Preference** records favourite, likes, neutral, dislikes, or strongly avoids.
- **Fallback approval** records a person-specific meal option that may reliably
  cover a defined context.

Optional applicability tags may scope a preference or fallback to a meal
occasion, packed lunch, location, or named routine. Absence of tags means the
fact applies generally. The MVP does not introduce a general preference rules
language or universal child-specific accepted-food taxonomy.

### Fact state and provenance

A fact distinguishes at least:

- provisional input from another adult;
- person-confirmed input;
- household-confirmed input;
- visible low-weight inference from feedback; and
- superseded historical state.

Hard constraints, dietary rules, routines, and strong avoids require explicit
confirmation. An inferred soft preference may influence ranking only at low
weight and remains visible, reversible, and removable.

Self-confirmed ordinary facts normally replace provisional facts. A hard safety
or dietary fact is never silently removed or weakened.

## Interview Sessions

An `InterviewSession` is a private interaction owned by the participating adult.
Its transcript and intermediate conversation are not household planning
authority.

The session may propose facts, routines, fallbacks, conflicts, and questions.
Confirmed outputs enter household-visible structured state through admitted
commands. The transcript is not required to reconstruct that state.

An interview is repeatable. Adults may start a profile review at any time as
tastes and circumstances change. Transcript retention and deletion policy remain
an explicit open decision.

## Routines

A `Routine` is a reusable, versioned planning rule belonging to one person or the
household. It expands into concrete input for a planning period.

A routine may express:

- applicable weekdays, recurrence, or effective dates;
- one or more meal occasions;
- people covered;
- location or availability context;
- an exact food or small approved set;
- pin, prefer, or rotate behaviour;
- a meal option, external meal, leftover policy, flexible pattern, or skip;
- portion expectations;
- person-specific fallback policy;
- equipment and preparation windows;
- cooking-capacity effect;
- priority and conflict behaviour; and
- one-off exceptions.

Changing a routine affects future periods by default. An approved plan pins the
routine version and expanded entries it used. A one-off exception changes one
period without silently mutating the enduring rule.

## Household Capacity And Effort

The household may set a cooking-capacity target, such as a maximum number of
substantial cook events per week. The agent may propose changing it based on
repeated behaviour, but cannot change it silently.

Effort is multidimensional and may include:

- hands-on time;
- elapsed time;
- sustained attention;
- cleanup burden;
- coordination complexity;
- advance-start requirement; and
- skill or cognitive load.

Labels such as quick, hands-off, involved, assemble, reheat, packaged, and
external are derived summaries. Elapsed time alone does not define effort.

## Planning Period And Meal Requirements

A `PlanningPeriod` is normally seven days with a household-configurable start
day. Partial replanning may cover only the remaining dates.

The household configures managed meal occasions, beginning with breakfast,
lunch, dinner, and snacks. Additional occasions may be added, renamed, disabled,
or scoped by person and day.

For a period, the system materializes or can deterministically derive:

```text
household person × date × managed meal occasion
```

Each required cell is a `MealRequirement`. It records who must be accounted for,
when, and relevant context and constraints.

## Coverage Resolution

Every managed requirement has one explicit current resolution. Directionally:

```ts
type CoverageResolution =
  | { readonly kind: "meal"; readonly option: MealOptionReference }
  | { readonly kind: "prepared_output"; readonly allocationId: AllocationId }
  | { readonly kind: "external_meal"; readonly externalMealId: ExternalMealId }
  | { readonly kind: "intentional_skip" }
  | { readonly kind: "flexible" }
  | { readonly kind: "unresolved"; readonly reason: GapReason }
```

The implementing capability may refine this union. It is a domain direction,
not a required frontend contract.

- A shared meal may resolve many requirements while retaining exact person
  coverage.
- A flexible resolution deliberately leaves the choice to the day and creates
  no shopping assumption.
- An intentional skip is explicit; missing information is never a skip.
- An unresolved gap cannot be hidden by invented content and must be resolved
  before MVP approval.

## Meal Options

A common planning abstraction references distinct content kinds:

### Recipe meal

Has a recipe version, original batch and yield, structured ingredients,
instructions, scaling rules, effort, and possible prepared output.

### Assembled meal

Has components and quantities but no meaningful full recipe method, such as
cereal, sandwiches, toast, fruit, or yoghurt. It may consume an earlier prepared
component.

### Packaged meal

References a generic or exact product, optional preparation notes, and
substitution policy.

### External meal

Represents takeaway, restaurant, school meal, canteen, or another opaque meal.
It covers requirements but normally creates no shopping demand.

Meal-option kinds share planning suitability, portion behaviour, effort,
preferences, fallback use, and rationale, while preserving their own validation,
scaling, and shopping semantics.

## Fallbacks

A fallback belongs to one person and points to an approved meal option plus
applicable context. Several people may independently approve the same option.

- A prohibited or incompatible shared meal requires compatible alternative
  coverage.
- A strong avoid normally receives an approved fallback, with adult override.
- An ordinary dislike lowers ranking but does not automatically force separate
  coverage.
- A new agent-proposed fallback offers use once, approve for future use, or
  reject.

Fallback describes selection reason, not preparation type. It may be a recipe,
assembled meal, packaged product, shared-component variation, takeaway, or
another external option.

## Cook Events And Prepared Output

A `MealEvent` represents consumption. A `CookEvent` represents preparation.
They are separate because one preparation can satisfy several later meal
requirements and because many meal options require no cooking.

A cook event records:

- recipe version or preparation definition;
- planned time and preparation window;
- equipment and effort profile;
- intended yield;
- meal events and requirements supported; and
- planned outputs.

One cook event may produce:

- finished-meal portions;
- reusable prepared components, such as cooked chicken, sauce, rice, or roast
  vegetables; and
- unassigned surplus.

Output uses weight, volume, count, or portions according to what is known and
useful. Prepared components are explicit; the system does not automatically
decompose every meal into speculative inventory.

An allocation assigns output to a requirement, assembled meal, later cook event,
or carry-over stock. Allocations cannot exceed production or double-consume the
same quantity.

## Portion Model

Each person has a default serving factor relative to one recipe reference
serving, optionally different by meal occasion. A meal-specific allocation may
override it.

Labels such as child, small adult, standard adult, and large portion may seed
factors, but they are not calorie or clinical claims. Future verified nutrition
may attach to a reference serving or measured quantity without replacing the
portion model.

## Planned Leftovers And Prepared Stock

A cook event may deliberately scale output for named future meals or freezer
portions. Planned same-week leftovers are part of the approved plan and require
no separate confirmation.

Incidental leftovers use a low-friction record: approximate quantity or
portions, plus fridge or freezer.

The MVP tracks lightweight prepared stock only. Stock records identity,
quantity, storage location, origin where known, and state such as available,
reserved, consumed, discarded, or uncertain.

The ordinary product path does not require users to mark meals cooked or eaten.
The plan is assumed to happen unless an exception is reported. Cross-week stock
must be confirmed before a later plan relies on it.

The product does not request ingredient date labels, calculate safe-to-eat
windows, auto-expire food using guessed rules, or certify food safety.

## Recipe Identity, Versions, And Scaling

A recipe is a stable concept; a `RecipeVersion` is an immutable snapshot. Plans
pin exact versions.

- Editing shared catalogue content creates a private household fork.
- Editing a household recipe creates a new version.
- A genuinely different dish is an explicit separate fork.
- The original batch and stated yield remain authoritative.
- A reference-serving projection may be derived where meaningful.
- Cook-event scaling is plan state, not a recipe edit.
- Ingredient-specific scaling distinguishes linear, discrete, bounded,
  package-constrained, to-taste, and non-scalable behaviour.
- Missing yield or material quantities remain unresolved rather than invented.
- An incomplete recipe may remain in review but cannot drive reliable scaling or
  shopping demand.

See [`recipe-strategy.md`](recipe-strategy.md) for the broader content model.

## Planning Rationale

A meaningful plan decision may cite confirmed profile facts, routines,
fallbacks, locations, equipment, capacity, preferences, or constraints.
Rationale must not quote private transcript text.

The UI may group shared coverage and nest person exceptions. The domain model
does not require the frontend to expose raw internal unions or every rationale
fact by default.

## Meal Plan Aggregate

A `MealPlan` binds one planning period, requirements, current coverage, meal
options, cook events, prepared outputs, allocations, rationale, shopping
preview, decisions, and revision history.

The planner produces one strong recommended plan. While it is a draft, changes
may trigger repair across dependent state and must explain consequential
changes.

Any adult may edit, approve, reject, reopen, or revise in the MVP. Approval pins
profile, routine, recipe, portion, and plan versions. A post-approval change
creates a visible proposed revision rather than rewriting active state.

## Weekly Review And Feedback

A `WeeklyReview` is an optional checkpoint before the next plan. It may collect
signals about people, meals, cook events, routines, portions, fallbacks, and
prepared carry-over.

Signals include liked, disliked, skipped, not made, too much effort, wrong
quantity, fallback outcome, dependant rejection, and make again.

Any adult may record feedback for any adult or dependant in the MVP. Each signal
retains both its subject and reporter. Self-reported preference carries more
weight than another adult's observation, while conflicting reports coexist
rather than being collapsed. Dependant feedback is adult-reported in the MVP.

Review never blocks planning. Feedback does not silently rewrite hard facts or
enduring routines. One explicit strong statement may justify an immediate
proposed change; weaker signals require a repeated pattern across planning
periods. The signal reason determines whether the proposal concerns preference,
effort, quantity, routine, fallback, recipe, or cooking capacity. An enduring
change always requires adult confirmation and remains inspectable and
reversible.

## Shopping Demand

A draft plan exposes a shopping preview. An approved plan creates the active
retailer-neutral shopping list.

- Recipe meals contribute structured ingredient demand.
- Assembled and packaged meals contribute components or exact products.
- Planned leftovers contribute only through their producing cook event.
- External meals, intentional skips, and flexible slots contribute no demand.
- Ingredients aggregate only when identity and unit conversion are reliable.
- Adults may add, split, merge, and adjust items.
- An optional one-off "already have this?" check replaces a pretend live pantry.
- Plan revision presents a shopping delta and preserves manual and purchased
  state.

## Non-Negotiable Invariants

1. Every managed person-date-meal requirement has one explicit current
   resolution.
2. Missing information is never interpreted as an intentional skip.
3. MVP approval requires every managed requirement to be resolved without a
   gap.
4. Hard constraints are deterministic and cannot be overridden by a model.
5. Shared coverage retains exactly which people and requirements it covers.
6. A required fallback is actual compatible coverage, not a note on an
   incompatible shared meal.
7. Cook events, meal consumption, meal content, and prepared stock are distinct
   concepts.
8. Allocations cannot exceed output or double allocate quantity.
9. Approved plans pin relevant versions and remain stable until a visible
   revision is accepted.
10. Raw interview transcripts are not household planning authority.
11. Confirmed profiles are household-visible in the MVP; transcript text is not.
12. Agent proposals become authoritative only through typed, validated domain
   commands.
13. Imported recipe uncertainty and provenance survive review and versioning.
14. The happy path requires no per-meal confirmation.
15. The MVP does not certify food safety, maintain a complete pantry, or perform
   retailer mutations.
16. One authenticated user links to at most one household person within a given
   household, and link repair never silently merges product history.

## Agent And Domain Responsibility

The agent is responsible for:

- understanding natural language;
- choosing valuable follow-up questions;
- proposing and revising profiles, routines, fallbacks, and plans;
- synthesizing one strong recommendation;
- repairing candidate plans through admitted operations;
- explaining rationale, conflicts, and trade-offs; and
- summarizing feedback into proposed changes.

The deterministic domain is responsible for:

- authorization and visibility;
- schema decoding;
- person, profile, and routine transitions;
- coverage completeness;
- hard-constraint enforcement;
- meal-content and recipe-version authority;
- portion and quantity arithmetic;
- prepared-stock reservation and allocation;
- idempotency and concurrency;
- plan lifecycle and approval; and
- shopping-demand derivation.

The desired product is an unusually capable agent operating through an
unusually strict domain, not a model prompt acting as the database.
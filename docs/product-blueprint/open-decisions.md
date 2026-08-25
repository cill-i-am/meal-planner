# Open Decisions

## Purpose

This document contains only material product questions that still need explicit
resolution. Accepted answers live in
[`../decisions/product`](../decisions/product/), and technical consequences live
in [`../architecture/decisions`](../architecture/decisions/).

An implementation work item must not silently answer one of these questions
merely because a code shape is convenient.

## Accepted Decision Summary

The workshop has accepted five product decision records:

- [Household people, profiles, and interviews](../decisions/product/0001-household-people-profiles-and-interviews.md)
- [Routines, fallbacks, and plan rationale](../decisions/product/0002-routines-fallbacks-and-plan-rationale.md)
- [Weekly planning, repair, approval, and review](../decisions/product/0003-weekly-planning-repair-approval-and-review.md)
- [Meal content, portions, recipes, prepared food, and shopping](../decisions/product/0004-meal-content-portions-recipes-and-shopping.md)
- [MVP scope and deferrals](../decisions/product/0005-mvp-scope-and-deferrals.md)

Do not re-open those choices in implementation without proposing a superseding
record.

## Before Stage 1 — People And Profiles

### Person departure and archival

- What happens to a person's profile, routines, feedback, and historical plan
  references when they leave a household?
- Can an adult archive a dependant temporarily and later restore them?
- Is former-person data visible to remaining adults, the departing adult, both,
  or neither?
- Which deletion request owns the difference between removing account access and
  deleting household product history?

### Account-to-person edge cases

- Can one authenticated member ever represent more than one household person in
  the same household?
- Can one user link to person records in several households?
- How is an accidental or duplicate account link repaired without losing
  history?

Recommended MVP direction: one user maps to at most one person per household;
keep multi-household membership possible; require an explicit administrative
repair for duplicate links.

## Before Stage 2 — AI Discovery

### Minimum first-plan profile

- Which facts must be confirmed before the first plan can be generated?
- Which facts may remain provisional or be learned in later reviews?
- When should the agent stop asking and create a first routine or plan artifact?
- What active-time and abandonment baselines define an acceptable interview?

The answer should be measured against first-plan quality and time saved rather
than chosen as an arbitrary questionnaire length.

### Transcript retention and deletion

- Is a private transcript retained after confirmed facts are extracted?
- If retained, for how long and for which user-visible purpose?
- Can the participant delete the transcript without deleting confirmed profile
  state?
- Is explicit consent required for any operator or product-quality review?

Recommended MVP direction: retain as little transcript material as the product
needs, give the participant deletion control, and make confirmed structured
state independent of the transcript.

### Agent evaluation and provider strategy

- Which synthetic household scenarios form the initial evaluation set?
- What rubric measures perceptiveness, unnecessary questions, profile accuracy,
  routine quality, first-plan practicality, and explanation quality?
- Who reviews failures and accepts prompt/tool/policy changes?
- What model and provider strategy meets quality, cost, privacy, and latency
  requirements?
- How are model, prompt, tool, and policy versions tied to evaluation evidence?

Provider choice follows product evaluation and does not define the domain.

## Before Stage 3 — Routines And Fallbacks

### Routine conflict precedence

- What exact precedence applies among hard constraints, one-off exceptions,
  person routines, household routines, approved fallbacks, and model proposals?
- Which low-impact conflicts may the draft-repair operation resolve without a
  separate question?
- How are conflicting adult edits serialized and explained?

### Temporary household context

- How are visitors, temporary absences, school holidays, split custody, and
  overnight shifts represented in the MVP?
- Which are one-off planning exceptions versus enduring routine state?
- Is manual entry sufficient before external calendar integration?

### Fallback repertoire limits

- Does the MVP need a recommended maximum or merely good UI for person-specific
  fallbacks?
- How are temporarily unavailable exact products handled before retailer
  integration?
- When should the agent suggest adding a new fallback rather than leaving a
  flexible slot?

## Before Stage 4 — Meal Content And Recipe Supply

### Curated catalogue source and size

- Who authors or licenses the initial catalogue?
- What rights and attribution are required?
- What is the minimum useful catalogue for the beta cohort?
- Who reviews recipe quality, scaling, effort, dietary metadata, and shopping
  completeness?
- How do catalogue corrections affect households that forked older versions?

### Food concepts, units, and product identity

- Which unit systems and conversions are supported first?
- How are ambiguous household measures represented?
- Which food taxonomy or household-owned concept model is used?
- What confidence is required before ingredient lines aggregate into shopping
  demand?
- How is an exact packaged product identified before a retailer catalogue exists?

### General web-page import

- Which public sites and markup are supported initially?
- What acquisition, robots, terms, rights, size, redirect, and SSRF policies
  apply?
- Is visible-page evidence required when structured data appears complete?
- How are multi-page or interactive recipe cards handled?

## Before Stage 5 — Planning

### Baseline ranking policy

Hard constraints, routines, cooking capacity, and approved fallbacks are already
settled. Remaining ranking questions include:

- How are ordinary preference, effort, repetition, ingredient reuse, and gentle
  qualitative variety weighted?
- Which values are product defaults versus household configuration?
- When does the planner prefer a flexible slot over a low-confidence meal?
- How are ties kept deterministic before optional model assistance?

### Portion defaults and complex serving

- Which initial numeric factors seed child, small-adult, standard-adult, and
  large-portion labels?
- How are shared sides, buffet meals, fractional packaged units, and dishes with
  several independently portioned components represented?
- Which weekly feedback is enough to propose a changed serving factor?

### Plan projection and rationale

- What visual grouping best presents shared meals, personal alternatives,
  routines, cook events, and prepared outputs?
- Which rationale is visible by default and which is expanded on demand?
- How does the UI show a draft repair or approved-plan revision without
  overwhelming the household?

The frontend projection must remain free to differ from internal domain unions.

## Before Stage 7 — Shopping List

### Collaboration and offline behaviour

- Can several adults edit and check the list concurrently?
- What conflict behaviour is acceptable for quantity edits and check-off state?
- Is offline shopping-list use required for the beta?
- What sharing or export behaviour is needed beyond authenticated household
  access?

### Manual-state lifecycle

- When an item is no longer required after a plan revision, how long is it kept
  in the visible list history?
- How are manual non-food items grouped and carried between weeks?
- Should households maintain an optional staples checklist after the one-off
  "already have this?" flow proves useful?

## Beta Operating Decisions

- Exact beta cohort size and recruitment criteria.
- Internal readiness thresholds for time to approved plan and correction burden.
- Support and incident-handling process for the invite-only cohort.
- Which transcript or screen-review evidence may be inspected with participant
  consent.
- The minimum curated recipe set needed before invitations begin.

## Deliberately Deferred

These questions are real but are not prerequisites for the MVP decision
workshop:

- generic calorie, macro, weight, muscle, or medical goals;
- continuous ingredient pantry inventory;
- food-safety expiry calculation or certification;
- retailer partnerships and official authorization;
- product, price, availability, offer, and basket integration;
- MCP tools, resources, elicitation, and tasks;
- embedded and white-label channels;
- public recipe contribution and marketplace policy;
- semantic recipe search infrastructure;
- non-household organization products; and
- fleet-wide product read models without an accepted use case.

## Decision Process

When resolving an item:

1. state the household problem and affected users;
2. identify privacy, authority, safety, and plan-semantics effects;
3. compare the smallest viable alternatives;
4. add or update the owning product decision record;
5. add or update an ADR when a durable technical boundary changes;
6. update affected blueprint documents; and
7. create repository delivery work only after the decision is accepted.
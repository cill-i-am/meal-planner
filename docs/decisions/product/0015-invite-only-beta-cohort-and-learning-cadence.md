# PDR-0015 — Invite-Only Beta Cohort And Learning Cadence

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

The first beta exists to learn whether Meal Planner reduces the recurring work of
feeding a real household. It is not a scale demonstration, a growth launch, or a
single-session usability test.

The product claim depends on repeated weekly use: the household should need less
planning work as profiles, routines, fallbacks, portions, and feedback improve.
One successful generated week cannot establish that claim. At the same time, a
large early cohort would dilute support, make failures harder to understand, and
encourage premature automation.

The initial catalogue and cultural assumptions are also Ireland-first. The beta
should begin with households for whom that content is reasonably relevant while
keeping the domain model portable to other places and cultures.

## Decision

### Staged cohort

The invite-only beta proceeds in three stages:

1. **Dogfood.** Cillian's household uses the complete product path first.
2. **Closely supported pilot.** Add two or three friendly households with direct,
   hands-on support and frequent qualitative review.
3. **First full cohort.** Expand to approximately six to eight participating
   households in total once the end-to-end flow is reliable enough that new
   failures are informative rather than repetitions of known breakage.

The numbers are deliberate operating bounds, not growth targets or permanent
capacity limits. The dogfood household may be reported separately from external
participants where that makes evidence easier to interpret.

Expansion between stages is an explicit product decision based on readiness
evidence. Reaching a date, completing a sprint, or finding willing participants
does not automatically open the next stage.

### Four-cycle learning cadence

- Each household is recruited for at least four genuine weekly planning cycles.
- A cycle means the household had a real opportunity and reason to plan; a
  holiday, suspension, illness, or week in which the household genuinely did not
  need the product does not count as a failed return.
- The product compares later cycles with the household's first usable baseline,
  including active planning time, correction burden, routine reuse, approved-plan
  use, unresolved coverage, and confidence in the recommendation.
- Week-one success is necessary but insufficient. The beta must show whether
  weeks two through four require less household work.
- A participant may pause or leave at any time. Participation does not create an
  obligation to complete four cycles or disclose private conversation content.

### Recruitment shape

Recruit for variation in household planning problems rather than demographic
volume. The first cohort should collectively include, where practical:

- a relatively straightforward household baseline;
- households with dependants and narrow or person-specific fallback needs;
- mixed adult work, school, packed-lunch, and location routines;
- vegetarian and omnivore coexistence or other ordinary mixed preferences;
- planned leftovers, batch cooking, and different cooking-capacity limits;
- eating out, takeaway, intentional skips, or temporary schedule changes; and
- households that already experience meal planning as meaningful recurring work.

Not every household needs to exercise every scenario. The cohort as a whole
should expose enough variation to test the accepted product model.

### Ireland-first operating boundary

- Initial recruitment is Ireland-first and should align reasonably with the
  catalogue, retailer-neutral language, measurements, food conventions, and
  support capacity available at launch.
- Ireland-first recruitment is an operating choice, not a domain invariant.
  Household, food-concept, recipe, unit, planning, and shopping identities must
  not encode Ireland as the only supported market.
- Expansion to other markets follows evidence that catalogue coverage,
  terminology, product expectations, and support can serve them credibly.

### Suitability and expectation boundary

The first beta is not intended for participants who expect Meal Planner to:

- provide clinical, therapeutic, calorie, macro, weight-loss, or medical
  nutrition advice;
- act as the household's sole safeguard for a severe allergy or food-safety
  decision; or
- provide retailer fulfilment, price, availability, basket, or checkout
  capability that remains outside the MVP.

Hard constraints still receive the deterministic product protections already
accepted. This boundary concerns beta expectations and claims, not permission to
ignore confirmed constraints.

### Consent and support

- Direct support, manual curation, and operator intervention are acceptable in
  the small beta when they help distinguish product gaps from premature
  automation.
- Transcript or screen access is never a condition of participation.
- Private transcript access follows PDR-0001: a participant may grant explicit,
  purpose-specific, time-limited, revocable, audited access to a particular
  completed transcript.
- The team should prefer household-visible artifact history, structured product
  state, event evidence, and participant explanation over raw transcript review.
- Recruitment materials state the expected four-cycle learning cadence, the
  invite-only nature of the beta, the product's current boundaries, and the
  participant's ability to pause or withdraw.

### Evidence before further expansion

Before expanding beyond the first full cohort, review at least:

- whether households repeatedly reach complete approved plans;
- active time and correction burden across successive weeks;
- whether routines, fallbacks, leftovers, and prior feedback reduce later work;
- whether catalogue gaps or household imports dominate plan completion;
- whether people-level exceptions create unacceptable extra cooking work;
- whether households understand the plan, rationale, repair, and shopping list;
- privacy, authorization, support, and incident evidence; and
- whether participants return because the product saves work rather than merely
  because they are helping test it.

Exact readiness thresholds and the support and incident process remain separate
operating decisions.

## Consequences

- The beta is a longitudinal product-learning exercise rather than a one-week
  demo or traffic milestone.
- Recruitment, support, and instrumentation need household-level baselines and
  four-cycle comparisons.
- Early product work may remain manually supported without pretending that
  manual intervention is the finished operating model.
- Cohort diversity is judged by planning problems represented, not by maximizing
  participant count.
- Ireland-first content and operations do not authorize Ireland-specific domain
  shortcuts.
- Private transcript sharing remains optional and cannot become an implicit
  recruitment filter.

## Deferred

- public self-service signup;
- beta expansion beyond the first full cohort;
- country-by-country launch sequencing;
- paid acquisition or growth targets;
- final numeric readiness thresholds;
- the detailed support and incident-response runbook; and
- clinical or therapeutic nutrition cohorts.

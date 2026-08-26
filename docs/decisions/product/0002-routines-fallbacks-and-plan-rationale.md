# PDR-0002 — Routines, Fallbacks, And Personalised Plan Rationale

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

Covering all meals must not create a week of individually planned recipes or a
large configuration burden. Real households rely on repeated breakfasts,
packed lunches, intentional skips, takeaway, dependable child alternatives,
location-dependent meals, and a limited amount of cooking energy.

The first recommended week must already understand those patterns. Adults may
change it, but they should not be required to manually personalise a generic
plan after generation.

## Decision

### Meal occasions and routines

- Households begin with breakfast, lunch, dinner, and snacks.
- They may add, rename, disable, or scope meal occasions by person and day.
- A routine is a reusable, versioned rule for one person or the household.
- Routines expand into concrete entries when a planning period is generated.
- An approved plan pins both the expanded entries and the routine versions used.
- Changing a routine affects future weeks unless an adult explicitly replans an
  active period.
- Routines may represent exact foods, a small approved set, leftovers, eating
  out, takeaway, an intentional skip, or another planning rule.
- An exact or set-valued routine declares whether options are pinned, preferred,
  or rotated.

### Routine conflict precedence

Routine evaluation follows this precedence:

1. Hard suitability, dietary, and safety constraints always win. No routine,
   exception, fallback, preference, or model proposal can override them.
2. An explicit one-off change for the current planning period overrides a
   recurring routine where the resulting coverage remains compatible with hard
   constraints.
3. A person routine overrides a household routine for that person only. It does
   not rewrite the household baseline for anyone else.
4. A household routine supplies the baseline where no more-specific person rule
   applies.
5. An approved person-specific fallback repairs an incompatible or strongly
   avoided shared meal according to the accepted fallback policy.
6. Ordinary preferences influence ranking but do not override a confirmed
   routine by themselves.
7. An agent proposal has no authority until an adult accepts it through the
   admitted product transition.

Where this precedence yields one compatible answer, the draft planner may apply
it automatically and must expose the applied rationale. Where two equally
specific rules conflict or the intended answer remains ambiguous, the planner
keeps the conflict visible and asks an adult rather than guessing.

Concurrent adult routine edits use optimistic concurrency against the routine
version. A stale edit fails with a visible conflict and current state; routine
state never uses silent last-write-wins behaviour.

### Context, availability, and equipment

- Person routines may include normal location and availability by meal
  occasion, such as home, office, school, travelling, or working from home.
- One-off weekly overrides may change that baseline.
- The household profile records available equipment and realistic preparation
  windows.
- The planner must account for whether someone can start a hands-off meal at the
  required time, not merely whether the equipment exists.

### Cooking capacity and effort

- A household may set a weekly cooking-capacity target, such as a maximum number
  of substantial cook events.
- The agent may propose changing that target based on repeated observed
  behaviour but never changes it silently.
- Effort is multidimensional. Relevant facts include hands-on time, elapsed
  time, attention, cleanup, coordination, advance planning, and skill or
  cognitive load.
- Friendly labels such as quick cook, hands-off cook, involved cook, assemble,
  reheat, packaged, and external are derived summaries rather than the sole
  source data.
- A long slow-cooker meal may be low effort; a short multi-pan meal may be high
  effort.

### Person-specific fallbacks

- Fallback repertoires belong to individual people. Different people may share
  the same fallback, but one person's approval does not imply another's.
- A fallback describes why a meal option was selected, not how it was produced.
  It may be a shared-component variation, assembled meal, exact packaged
  product, generic product, simple recipe, takeaway, or another external meal.
- An incompatibility or hard constraint requires separate compatible coverage.
- A strong avoid normally triggers an approved fallback, but an adult may
  override it.
- An ordinary dislike lowers ranking but does not automatically exclude the
  shared meal.
- Approved personal fallbacks may be applied automatically in a draft.
- A newly agent-proposed fallback offers three choices: use once, approve for
  future use, or reject.
- Agent-proposed routines use the equivalent choices: apply this period, save
  as recurring, or reject.

### Exact products and substitutions

- A meal or fallback may reference a generic food concept and optionally an
  exact product.
- Exact-product preferences may be person-specific.
- Substitution policy is one of exact only, ask before substituting, or similar
  products acceptable.
- This model is valid before retailer integration; exact products may appear by
  name on a retailer-neutral shopping list.

### Preferences and repetition

- Preference may attach to an ingredient, dish, or cuisine.
- Suitability and preference are separate: prohibited or incompatible is a hard
  block; strongly avoids normally receives an alternative; ordinary dislike
  affects ranking; likes and favourites affect ranking only.
- Preferences are simple by default. Optional meal-occasion or routine tags may
  express a meaningful exception without introducing a general rules language.
- Fallback reliability is separately approved and may be context-specific.
- Recurring foods may use daily, weekday, weekly, fortnightly, make-again-soon,
  paused, or avoid cadence.
- Repetition is person-specific. A reliable child meal is not removed merely to
  improve an abstract household variety score.

### Recommended week and rationale

- The planner produces one strong recommended week by default.
- That week arrives fully personalised with confirmed routines, skips,
  locations, portions, approved fallbacks, cooking capacity, preparation
  windows, and leftover intent already applied.
- Approving the week approves its person-level alternatives; approved fallbacks
  do not require separate acceptance each time.
- Adults may optionally swap meals, alternatives, routines, or days after
  receiving a coherent recommendation.
- Every meaningful exception exposes planning rationale: the person, profile
  fact, routine, fallback, location, capacity rule, or constraint that affected
  the plan.
- Rationale references confirmed product facts, never private transcript text.
- The weekly summary may state how many routines, fallbacks, leftovers,
  external meals, and cook-capacity rules were applied.

## Consequences

- The routine builder is a core product capability, not a convenience around a
  recipe calendar.
- Plan generation needs deterministic routine expansion and conflict handling
  before model-assisted recommendation can be trusted.
- Routine authority needs versioned mutation and optimistic concurrency; stale
  adult edits cannot silently replace current state.
- Automatically resolved routine conflicts need inspectable rationale, while
  equally specific ambiguity remains visible for adult resolution.
- The UI needs a compressed shared-week projection with nested person-level
  exceptions and inspectable rationale.
- No decision here requires the frontend to render the raw domain union
  directly; the appropriate projection may emerge with implementation.

## Deferred

- retailer-backed substitutions;
- a universal child-specific accepted-food taxonomy;
- a general preference rules language;
- automatic permanent routines or fallbacks without confirmation; and
- abstract variety optimization that overrides dependable household patterns.
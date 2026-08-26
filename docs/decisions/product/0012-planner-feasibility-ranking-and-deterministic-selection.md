# PDR-0012 — Planner Feasibility, Ranking, And Deterministic Selection

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

Meal Planner must choose one strong recommended week from many meals that could
technically cover the household. A single opaque score would be dangerous and
hard to explain: enough variety or ingredient-overlap points must never
compensate for an incompatible meal, impossible preparation window, excessive
cooking burden, or ignored routine.

Selection also happens in the context of the whole week. A meal that looks good
in isolation may consume the wrong prepared portion, create an extra substantial
cook, break later leftovers, or duplicate a meal whose cadence says it should be
paused.

The product therefore needs an ordered selection policy that first proves a
candidate is feasible, then compares valid candidates according to the
household's real planning priorities.

## Decision

### Evaluate candidates in plan context

- The planner evaluates meals as part of a coherent period, including their
  effects on people, cook events, prepared outputs, later allocations, routines,
  shopping demand, and cooking capacity.
- Local meal selection may be used as an implementation technique, but it cannot
  ignore plan-level dependencies.
- A requested plan change reruns the relevant feasibility and ranking steps for
  the affected dependency graph rather than swapping one calendar label in
  isolation.

### Ordered selection layers

The MVP uses the following ordered layers.

#### 1. Feasibility and hard rejection

A candidate is removed before preference ranking when it:

- violates a hard suitability, dietary, or safety constraint;
- leaves a managed meal requirement without valid explicit coverage;
- omits a required compatible fallback;
- depends on unavailable or unconfirmed prepared stock;
- overdraws or double-allocates a prepared output;
- cannot fit the relevant location, availability, preparation window, or
  equipment;
- exceeds an admitted cooking-capacity boundary without an adult-approved
  exception; or
- otherwise produces an internally invalid plan.

A lower-priority benefit can never compensate for one of these failures.

#### 2. Fit the people and their established routines

Among feasible candidates, prefer those that:

- apply confirmed person and household routines correctly;
- use approved fallbacks and person-specific alternatives where required;
- allow more people to share the same compatible meal or prepared components;
- respect strong avoids and exact-product or substitution rules; and
- avoid creating unnecessary separate work for one person.

Ordinary likes and dislikes influence this layer without becoming hard
constraints.

#### 3. Reduce household work

Prefer plans that reduce real planning and cooking burden through:

- fewer substantial cook events;
- lower hands-on effort, attention, coordination, and cleanup;
- practical hands-off preparation where someone can start it in time;
- intentional leftovers and reusable prepared components; and
- avoiding a second cook where a compatible low-burden alternative exists.

Elapsed time alone does not define effort.

#### 4. Respect repetition and cadence

- Pinned routines and dependable repeated foods remain eligible at their accepted
  cadence.
- Daily or frequent staples are not displaced merely to increase abstract
  variety.
- Paused, avoided, or cooldown-constrained meals are excluded or down-ranked as
  their accepted state requires.
- `make again soon`, favourite, and recurring preferences raise appropriate
  candidates.

#### 5. Use food and ingredients sensibly

Where the earlier layers are comparable, prefer useful reuse of:

- confirmed prepared food;
- planned cook-event output;
- shared components; and
- ingredients already required elsewhere in the approved candidate week.

Ingredient overlap is a practical benefit, not permission to choose a worse meal
or assume pantry stock.

#### 6. Apply gentle qualitative variety

Variety may distinguish otherwise comparable candidates across dimensions such
as cuisine, protein source, vegetable use, cooking method, and recent household
history.

It is a tie-breaker and low-weight preference. It never overrides a reliable
routine, approved fallback, hard constraint, cooking-capacity boundary, or
strong household preference.

#### 7. Break final ties deterministically

- Equivalent state and accepted policy versions should produce the same selected
  candidate.
- Final tie-breaking uses stable domain identifiers or another explicit stable
  ordering, not random model choice.
- The selected result records the policy and relevant input versions used.

### Flexible slots and low confidence

- The planner does not insert a poor or weakly supported meal merely to make the
  week appear complete.
- When it cannot produce a genuinely credible option, it exposes an unresolved
  gap or proposes a visible `flexible — decide on the day` resolution.
- A flexible slot becomes valid coverage only through the normal adult-visible
  draft and approval flow and contributes no recipe or shopping assumption.
- Low confidence, missing evidence, or insufficient catalogue supply remains
  visible in planning rationale and eval evidence.

### Product defaults and household control

- The ordered policy is a product default for the MVP.
- The MVP does not expose a cockpit of numeric weighting sliders.
- Adults influence selection through ordinary product state and requests:
  profiles, routines, fallbacks, cadence, cooking capacity, equipment, weekly
  exceptions, and focused changes such as `make Tuesday easier`.
- A future configurable objective system requires its own accepted decision; it
  cannot silently turn these priorities into arbitrary user-defined weights.

### Rationale

The recommended plan exposes concise reasons for meaningful choices, for
example:

> Chosen because everyone can share it, it uses Monday's prepared chicken, and
> it keeps the week within five substantial cook events.

Rationale identifies the factors that actually affected selection. It does not
invent a post-hoc explanation, expose private transcript text, or present an
opaque aggregate score as the reason.

## Consequences

- The planner needs an explicit feasibility phase separate from comparative
  ranking.
- Candidate evaluation must preserve plan-level dependency effects, not only
  meal-local attributes.
- Ranking evidence and rationale need traceable factor provenance.
- Test fixtures and synthetic agent evals must include cases where a superficially
  attractive option loses because it creates excess work, breaks cadence, or
  depends on unavailable stock.
- The same accepted household state should not generate a different week merely
  because the model sampled differently.
- Catalogue shortages remain visible product evidence rather than being hidden
  by low-quality recommendations.

## Deferred

- generic user-defined objective weights;
- cost, calorie, macro, weight, muscle, or medical optimization;
- retailer price and promotion scoring;
- stochastic exploration in the ordinary household recommendation path;
- automatic seasonal or fleet-wide preference tuning without explicit product
  policy; and
- a requirement that one implementation formula or optimizer remain permanent.

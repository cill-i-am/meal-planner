# ADR-0008 — Separate Plan Feasibility From Ranked Selection

- Status: Accepted
- Date: 2026-08-26
- Related product decision: [PDR-0012](../../decisions/product/0012-planner-feasibility-ranking-and-deterministic-selection.md)

## Context

The household planner must choose one coherent recommended week while enforcing
hard constraints, explicit coverage, routine and fallback behaviour, preparation
capacity, portion arithmetic, prepared-stock availability, and plan dependencies.
It must then compare the remaining valid possibilities according to household
fit, effort, cadence, reuse, and gentle variety.

A single compensatory scalar would blur those responsibilities. It could allow a
candidate with a hard or practical failure to appear competitive because it
scores well on softer dimensions. A model-only selection path would also make
replay, evaluation, explanation, and exact-head verification unreliable.

## Decision

### Distinct planner phases

The planning capability separates at least these concerns:

1. **Candidate construction.** Produce closed candidate plans or plan fragments
   from admitted household state and recipe or meal-option supply.
2. **Deterministic feasibility validation.** Reject candidates that violate
   authorization-independent domain invariants, hard constraints, coverage,
   capacity, timing, equipment, stock, or allocation rules.
3. **Ordered comparative ranking.** Compare only feasible candidates using the
   ordered product priorities accepted in PDR-0012.
4. **Stable selection and explanation.** Select one candidate with deterministic
   tie-breaking and emit traceable rationale and factor evidence.

The implementation may combine steps for performance, but the contracts and
observability must preserve their semantic separation.

### Feasibility is non-compensatory

- Hard constraints and plan invariants produce typed rejection reasons rather
  than large negative scores.
- No preference, variety, ingredient-overlap, or model-quality value can offset
  a feasibility rejection.
- Plan approval continues to run authoritative deterministic validation even when
  the same candidate was validated during generation.
- Rejected candidates may be retained in privacy-safe diagnostic evidence where
  useful, but never appear as valid recommendations.

### Ordered ranking rather than one opaque total

- Comparative ranking follows ordered tiers: person and routine fit, household
  work reduction, cadence, useful food reuse, and gentle variety.
- An implementation may use bounded scores or heuristics inside a tier, but a
  lower-priority tier cannot compensate for a materially worse higher-priority
  result unless the accepted product policy explicitly allows that comparison.
- The planner records enough factor breakdown to explain meaningful selection
  and to diagnose regressions in deterministic tests and synthetic evals.
- The product does not promise one permanent optimization algorithm. The stable
  boundary is ordered, inspectable, non-compensatory decision semantics.

### Plan-level dependency graph

- Candidate comparison accounts for effects across the complete planning period,
  including cook events, prepared outputs, leftover allocations, person
  alternatives, later meals, and shopping demand.
- The planner maintains or derives dependency information sufficient to repair
  an affected subgraph when a draft changes.
- A meal-local ranking function cannot commit a choice that makes the surrounding
  plan invalid or materially worse without evaluating those consequences.

### Model responsibility

A model may:

- propose candidate meals or complete candidate plans;
- interpret natural-language weekly requests;
- identify qualitative attributes from admitted reviewed state;
- suggest a repair strategy; and
- generate a human-readable summary from recorded rationale factors.

A model may not:

- bypass the deterministic feasibility boundary;
- promote an unresolved assumption into confirmed state;
- assign authority to unavailable stock or an unapproved fallback;
- replace stable tie-breaking with unrecorded sampling; or
- invent selection reasons after the fact.

Model outputs are decoded into closed candidate contracts before domain
validation and selection.

### Determinism and versioning

- Selection records the relevant planner-policy version plus pinned profile,
  routine, recipe, portion, stock, and planning-period inputs.
- Equivalent canonical inputs and policy version produce the same result after
  deterministic tie-breaking.
- Model sampling may produce a wider candidate pool, but the final selected
  candidate and its validation evidence remain reproducible from the admitted
  pool and policy.
- Changes to the ranking policy are versioned and evaluated against deterministic
  fixtures and the accepted synthetic household suite.

### Flexible and unresolved outcomes

- `unresolved` and `flexible` remain explicit coverage semantics rather than
  pseudo-meals with artificially low scores.
- Insufficient candidate quality or confidence may yield an unresolved gap or a
  proposed flexible slot instead of forcing selection.
- The ordinary approval rules decide whether the resulting draft is approvable;
  the ranking engine cannot conceal the outcome.

## Consequences

- Planner modules need typed feasibility failures, factor evidence, stable
  tie-breaking, and policy versioning.
- Candidate generation can evolve independently from domain validation and
  ranking policy.
- Tests can prove that softer benefits never rescue an invalid plan.
- Agent evals can distinguish candidate-generation quality from deterministic
  planner correctness.
- Rationale can be built from recorded decision factors rather than reverse
  engineering an opaque score.
- The planner may use heuristics, search, constraint solving, or a hybrid later
  without changing the accepted domain boundary.

## Alternatives Rejected

### One weighted scalar for every concern

Rejected because it permits accidental compensation across hard constraints,
practical feasibility, household effort, and soft variety preferences, while
making explanations and regressions difficult to inspect.

### Let the language model choose the final plan directly

Rejected because model output alone cannot provide deterministic hard-constraint
enforcement, allocation validity, reproducible selection, or authoritative
rationale provenance.

### Rank each meal independently

Rejected because meal choices affect cook-event count, leftovers, prepared
components, later coverage, and shopping demand across the week.

### Randomly choose among close candidates

Rejected for the MVP because identical household state should not produce an
unexplained different week. Controlled exploration may be reconsidered only
through a later explicit product decision.

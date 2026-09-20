# PDR-0013 — Plan Projection, Rationale, And Experience Experimentation

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

The planning domain accounts for every managed `person × date × meal occasion`
requirement, while also modelling shared meals, personal alternatives, routines,
cook events, prepared outputs, leftovers, shopping effects, and revisions. A UI
that renders those internal structures literally would be complete but difficult
to understand. A UI that hides too much would make the agent feel arbitrary and
make mistakes hard to spot.

The product therefore needs a clear information hierarchy, but the exact weekly
layout, interaction patterns, density, navigation, and component structure will
require prototyping, beta observation, iteration, and controlled experiments.
The decision should preserve the household outcomes and trust requirements
without freezing a speculative frontend before real use.

## Decision

### Default household-week projection

The primary plan experience presents one understandable household week rather
than the raw internal coverage matrix.

Directionally, the projection should:

- organize the week around days and managed meal occasions;
- render a shared meal once while preserving exactly which people it covers;
- nest person-specific alternatives and fallbacks with the shared meal they
  replace or adapt;
- compress repeated routines where repetition is already understood;
- link leftovers and prepared components to the cook event that produces them;
- keep ordinary valid coverage visually quiet; and
- make unresolved coverage, hard conflicts, and consequential assumptions
  prominent.

The complete person-by-date-by-occasion view may remain available as a diagnostic
or advanced inspection surface, but it is not the default household experience.

### Eating and cooking perspectives

The product needs to communicate both:

- **what each person will eat**; and
- **what somebody needs to prepare and when**.

The household-week projection remains focused on eating coverage. A distinct
cooking perspective, layer, filter, or view may organize cook events,
preparation windows, equipment, produced portions, and later allocations.

This record does not prescribe whether those perspectives are separate routes,
tabs, modes, overlays, or one responsive composition. The implementation should
choose the clearest tested interaction.

### Progressive rationale

Rationale is shown according to planning significance rather than as one large
explanation dump.

- Hard conflicts, unresolved coverage, person-specific exceptions, and applied
  fallbacks are visible by default where they affect the week.
- A compact weekly summary may show the major routines, fallbacks, leftovers,
  external meals, suspensions, and cooking-capacity rules applied.
- Deeper explanation is available through a `Why this?` or equivalent expansion
  that cites confirmed product facts, routines, capacity, prepared food, and
  ranking reasons.
- Rationale never quotes or reveals private transcript text.
- Explanations identify the real selection reasons and do not expose a false
  pseudo-scientific score.

### Draft repair and approved-plan revision

A draft repair highlights the meal groups and dependent state that changed and
provides a concise impact summary. The household should be able to understand
changes to people, cook events, prepared outputs, leftovers, and shopping
without diffing internal records.

A post-approval change remains a proposed revision. The experience presents a
clear before-and-after difference and the consequential effects before an adult
accepts it.

The exact visual diff treatment is deliberately not fixed by this record.

### Projection is not product authority

- The frontend may consume one or more purpose-built plan projections rather
  than rendering domain aggregates or discriminated unions directly.
- A projection is rebuildable presentation state. It does not become a second
  authority for coverage, plans, recipes, portions, approvals, or shopping.
- Stable semantic identities and version references allow projections and UI
  experiments to change without losing auditability or sending ambiguous
  mutations.
- UI commands remain typed product operations; a visual experiment cannot
  bypass domain validation or approval rules.

### Explicit experimentation boundary

The following are not frozen product contracts in the MVP:

- the React component tree;
- exact card, grid, calendar, timeline, or list layouts;
- mobile and desktop density;
- route, tab, filter, drawer, or modal choices;
- the default expansion level of non-critical rationale;
- wording and iconography;
- how repeated routines collapse or expand; and
- the exact interaction used to switch between household and cooking
  perspectives.

These details should be refined through prototypes, usability sessions, beta
observation, iterative releases, and A/B or sequential experiments where the
cohort and traffic make the evidence meaningful.

A layout or interaction change does not require a new decision record merely
because it differs from an early mock-up. A new or superseding product decision
is required when a change alters plan semantics, privacy, authority, approval,
coverage truth, or another accepted invariant.

### Non-authoritative agent-interface references

[Beautiful UI](https://www.beautifului.dev/) is a useful visual and interaction
reference for AI-native interface primitives. Patterns worth testing against Meal
Planner's flows include:

- approval cards for confirming routines, fallbacks, profile changes, and plan
  revisions;
- recommendation cards for agent-proposed meals, routines, or repairs;
- context cards for concise source facts and planning rationale;
- task rows, loading states, and streaming states for imports and longer-running
  agent work;
- diff tables for plan, recipe, profile, and shopping changes; and
- chat, prompt-bar, and navigation patterns for shared and private threads.

This reference does not select a component dependency, visual system, licence
strategy, or frontend contract. Patterns are adapted to Meal Planner's
accessibility, responsive, privacy, and household-comprehension requirements and
must earn their place through testing.

A visible `thinking` or task-progress treatment may show bounded status, source
retrieval, tool activity, decisions awaiting approval, and user-relevant action
summaries. It must not expose private model chain-of-thought or imply that an
animated trace is product authority.

### Experience evidence

Projection experiments should be judged primarily by whether adults can:

- understand the recommended week quickly;
- identify who has an exception and why;
- distinguish eating from preparation work;
- spot unresolved or incorrect assumptions;
- understand the effect of a repair or revision;
- make focused changes without reconstructing the whole plan; and
- reach approval with less active time and correction burden.

Interaction telemetry may support those questions, but raw clicks or expansion
counts are not success by themselves.

## Consequences

- Product and design work have stable information-priority principles without a
  frozen frontend contract.
- The implementation may introduce derived plan projections or read models when
  they make the week easier to render, provided they remain rebuildable and
  subordinate to household authority.
- Shared meals, person alternatives, cook events, prepared outputs, rationale,
  and revision effects need stable identifiers even when their visual grouping
  changes.
- External pattern libraries may accelerate prototyping without becoming product
  authority or forcing a design-system dependency.
- The beta should expect meaningful UI iteration rather than treating the first
  projection as finished.
- Domain unions and aggregate shapes remain free to optimize correctness and
  authority instead of becoming accidental component props.

## Deferred

- the final navigation and component system;
- the final mobile and desktop layouts;
- the exact cooking-view interaction;
- advanced diagnostic and operator projections;
- the experiment-assignment and statistical-analysis implementation; and
- personalized UI layouts or household-configurable information density.

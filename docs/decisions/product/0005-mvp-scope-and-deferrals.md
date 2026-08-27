# PDR-0005 — MVP Scope And Deliberately Deferred Capabilities

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

The long-term product may support nutrition goals, pantry state, retailer
fulfilment, MCP, embedded distribution, and other household optimizations. The
MVP must instead prove that a small beta cohort reaches a practical,
fully-personalised weekly plan in less time and needs less correction over
successive weeks.

Adding broad goal systems or fulfilment integrations before the core household
loop is proven would increase complexity, risk, and user friction without
validating the primary promise.

## Decision

### MVP promise

- The primary promise is reducing planning time and mental load.
- The product covers every configured person and managed meal occasion using
  routines, shared meals, individual alternatives, leftovers, external meals,
  intentional skips, or explicit flexible slots.
- The AI experience must be unusually perceptive and impressive, but its value
  is measured by the quality and speed of the resulting plan.

### Included in the MVP direction

- household people distinct from authenticated membership;
- private repeatable adult interviews and household-visible confirmed profiles;
- broad MVP adult edit rights with audit history;
- AI-led person and household routine building;
- configurable meal occasions, locations, equipment, preparation windows, and
  cooking capacity;
- one complete personalised recommended week with visible rationale;
- person-specific approved and agent-proposed fallbacks;
- recipe, assembled, packaged, and external meal options;
- cook events, portions, prepared components, deliberate batch cooking, and
  lightweight prepared-food stock;
- curated catalogue and private household recipe supply;
- immutable recipes and plan revisions;
- optional weekly review and explainable learning proposals; and
- retailer-neutral shopping preview and approved-plan shopping list.

### Planning goals

- A generic goals system is deferred.
- The MVP does not implement calorie targets, macro optimization, weight-loss
  mode, muscle-gain mode, goal tracking, or therapeutic diet planning.
- The model should remain modular so a future planning-goal capability can be
  added without redefining people, routines, portions, recipes, or plans.

### Qualitative observations

- The MVP may offer transparent, non-medical observations such as excessive
  repetition, few vegetables, or an unusually high-effort week.
- Observations are advisory and never block approval.
- They may gently influence tie-breaking between otherwise suitable options.
- They cannot displace hard constraints, dependable routines, approved
  fallbacks, or strong household preferences merely to improve an abstract
  score.
- Explanations state the observable reason rather than presenting an opaque AI
  judgment.

### Explicitly deferred

- retailer login or custody of consumer retailer credentials;
- product, price, offer, and live availability matching;
- basket mutation, checkout, payment, and retailer partnerships;
- full continuous pantry inventory;
- food-safety expiry calculation or certification;
- calories, macros, medical diagnosis, treatment, or prescribed therapeutic
  diets;
- MCP as a beta dependency;
- embedded and white-label distribution;
- public recipe contribution or marketplace policy;
- dependants with authenticated accounts;
- granular household permissions and consensus approval;
- external calendar integrations;
- non-household organization types; and
- fleet-wide product read models introduced without an approved use case.

## Consequences

- Delivery should prioritize the people-to-profile-to-routine-to-plan-to-review
  vertical rather than breadth.
- Technical abstractions should not be introduced only to anticipate deferred
  capabilities.
- Extension points are justified when they preserve a clean current model, not
  when they create unused portability machinery.
- Product and beta evidence live in the repository and are reviewed through pull
  requests.

## Revisit Trigger

A deferred capability should be revisited only when the core beta demonstrates
repeat household use or when a concrete dependency is required to complete the
accepted vertical. The new proposal must identify the user outcome, authority,
privacy and safety effects, and evidence required before changing this record.
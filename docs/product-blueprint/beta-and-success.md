# Beta And Success Evidence

## Beta Objective

The first beta should determine whether Meal Planner can materially reduce the
weekly work of feeding a real household while delivering an AI experience that
feels unusually perceptive, trustworthy, and easy to use.

The beta is invite-only and intentionally small. It is a product-learning phase,
not a scale demonstration. Manual curation, direct support, and operator review
are acceptable where they help distinguish missing product capability from
premature automation.

## Product Thesis To Validate

A household will return each week when the system:

1. understands the people and routines well enough to propose a practical first
   plan;
2. covers every configured meal occasion without turning the week into an
   unrealistic collection of recipes;
3. reduces cooking and planning effort through shared meals, routines,
   leftovers, and low-burden exceptions;
4. makes changes easy through conversation and visual controls; and
5. remembers useful feedback so future weeks need less correction.

## First Complete Vertical

The first meaningful beta tracer is one household that can:

- create and link adult and dependant people;
- complete private adult interviews;
- confirm household-visible person profiles;
- build recurring person and household routines;
- use at least one curated recipe and one private imported recipe;
- produce a plan for all configured meal occasions across a full planning week;
- include a repeated simple meal routine;
- include one intentional skip;
- include one eating-out occasion;
- include one shared household meal with a person-specific exception;
- use one accepted low-burden fallback meal;
- create one cook event that feeds multiple later meal requirements;
- show any remaining coverage conflict explicitly;
- revise the plan conversationally and visually;
- approve the complete plan;
- produce a consolidated retailer-neutral shopping list; and
- complete a weekly review that changes the following proposal.

The example household may contain two adults and two dependants because that
scenario exercises shared meals, account linking, private interviews, dependant
management, and exceptions. The domain must not require exactly that household
shape.

## Primary Measures

### Time to approved plan

Measure elapsed active planning time from beginning the weekly planning session
to approving a complete plan. Separate waiting time for imports or system work
from household interaction time.

### Plan approval rate

Measure the proportion of generated weekly drafts that reach approval. Record
whether abandoned plans failed because of product friction, insufficient recipe
supply, unresolved constraints, or a household choosing not to plan that week.

### Correction burden

Measure meaningful changes before approval, including:

- meal replacements;
- person-level exceptions added;
- routine corrections;
- portion or leftover corrections;
- uncovered cells repaired; and
- cook events added or removed.

Raw edit count alone is insufficient; one large incorrect assumption may matter
more than several preference tweaks.

### Coverage completeness

Measure required matrix cells, how they were resolved, and how many remained
unresolved at first proposal and approval. A high completion number is not
success if the system used inappropriate generic meals to hide uncertainty.

### Plan use

Through weekly review, estimate which planned meals were made, skipped, replaced,
or abandoned. The product should learn the reason rather than treating every
deviation as dislike.

### Returning household use

Measure week-two and week-four return for households that had a genuine
opportunity to plan. The cohort is small enough that qualitative context should
accompany the number.

### Improvement over time

For each household, compare later weeks with the initial baseline:

- time to approval;
- corrections required;
- unresolved coverage;
- routine reuse;
- planned-meal use; and
- household-rated confidence in the proposal.

The core learning claim is not merely that the product remembers data; it is
that the household has to do less work.

## AI Experience Measures

The AI conversation is evaluated as a product capability. Measure:

- interview completion;
- user-rated feeling of being understood;
- important facts missed;
- unnecessary questions asked;
- proposed facts accepted, corrected, or rejected;
- proposed routines accepted or changed;
- high-impact assumptions surfaced before planning;
- conflicts identified accurately;
- first-plan practicality; and
- whether explanations made revisions easier.

A fluent but generic conversation should score poorly. A shorter conversation
that identifies the right household structure and produces an excellent routine
may score highly.

## Representative Evaluation Households

Before and during beta, maintain privacy-safe synthetic scenarios covering at
least:

- two adults with different work and breakfast routines;
- a dependant with a narrow accepted-food repertoire;
- a shared dinner with a low-effort individual variation;
- vegetarian and omnivore coexistence;
- leftovers used for office or school lunches;
- recurring takeaway or eating-out periods;
- an intentional fasting or skipped occasion;
- a hard allergen constraint;
- an unusually busy week overriding the baseline routine;
- insufficient recipe supply for one requirement; and
- conflicting preferences where no person can be ignored.

These scenarios should exercise conversation, structured artifacts, domain
validation, and the final plan rather than prompt output in isolation.

## Privacy-Safe Instrumentation

Operational events should use opaque household and session correlations and
record only the data required for product learning. Useful events include:

- interview started, completed, or abandoned;
- profile fact proposed, confirmed, corrected, or rejected by category;
- routine proposed, accepted, changed, or disabled by category;
- plan proposal created;
- unresolved coverage count and closed reason categories;
- plan revision command category;
- plan approved or abandoned;
- shopping list generated; and
- weekly feedback category.

Do not place transcripts, raw health disclosures, ingredient free text, source
URLs, recipe evidence, or credentials in analytics events.

## Qualitative Beta Practice

For a small cohort, the team should regularly review:

- recordings or transcripts only where the participant explicitly consents;
- the visible artifact history rather than private transcript by default;
- where the agent appeared generic or failed to synthesize;
- why households overrode routines or plans;
- whether fallbacks reduced or increased cooking work;
- whether all-meal coverage felt useful or oppressive; and
- which manual interventions should become product capability.

Households should have a straightforward way to report that a profile or plan
feels wrong without having to identify the underlying technical failure.

## Beta Readiness Evidence

Before inviting external households, the product should demonstrate:

- authorization and cross-household isolation for profiles, interviews,
  routines, plans, recipes, feedback, and shopping lists;
- private transcript handling and household-visible confirmed-profile handling;
- deterministic hard-constraint and coverage validation;
- versioned recipe and plan behavior;
- restart and replay safety for meaningful mutations;
- complete representative vertical tests;
- a privacy-safe operator view for support;
- explicit deletion and retention behavior for interview material;
- no retailer credentials, basket effects, or accidental provider effects in
  the beta path; and
- a clear mechanism to pause or remove a household from the beta.

## Exit Criteria

Exact numeric targets should be set after internal baselines rather than
invented in this blueprint. The beta may be considered directionally successful
when:

- households repeatedly reach complete approved plans;
- median active planning time and correction burden decline over successive
  weeks;
- routines and leftovers are reused rather than repeatedly rebuilt;
- people-level exceptions do not create unacceptable additional cooking work;
- users describe the agent as understanding their household rather than merely
  generating recipes; and
- returning households use the product because it saves work, not only because
  they are helping test it.

Failure to meet those conditions should trigger product-model or experience
changes before retailer, MCP, embedded, or scale expansion.
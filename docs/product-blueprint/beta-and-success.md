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

## Catalogue Readiness Evidence

The shared catalogue is not ready merely because it reaches a recipe count. The
roughly `100–200` active-item target is operating guidance; the beta gate is
coverage and planning usefulness.

Before external invitations, catalogue evidence should show a practical spread
across:

- breakfast, lunch, dinner, and snacks;
- quick, hands-off, assemble-only, and involved meals;
- portable school and office food;
- batch cooking and planned leftovers;
- omnivore, vegetarian, and fish-based options;
- different main proteins, cuisines, equipment needs, and preparation windows;
- low-burden options that can support person-specific fallbacks; and
- enough variety to avoid accidental dependence on the same small set of meals.

The accepted synthetic household suite must be able to receive complete,
realistic weeks without catalogue shortage creating unresolved requirements or
absurd repetition. Specialized needs may still use private household imports;
the shared catalogue does not need to support every possible diet before beta.

## Cohort And Learning Cadence

[PDR-0015](../decisions/product/0015-invite-only-beta-cohort-and-learning-cadence.md)
defines the first beta as a staged longitudinal exercise:

1. dogfood with Cillian's household;
2. add two or three closely supported friendly households; and
3. expand to approximately six to eight participating households in total once
   the complete flow is reliable enough that new failures are informative.

Each household is recruited for at least four genuine weekly planning cycles.
A holiday, planning suspension, illness, or week without a real planning need is
not treated as a failed return merely because no plan was generated. Week-one
success is necessary but insufficient; the evidence must show whether weeks two
through four require less active planning work and fewer meaningful corrections.

Recruitment prioritizes variation in planning problems rather than participant
volume. Across the cohort, include where practical:

- relatively straightforward households;
- dependants with narrow or person-specific fallback needs;
- mixed adult work, school, packed-lunch, and location routines;
- vegetarian and omnivore coexistence or other ordinary mixed preferences;
- planned leftovers, batch cooking, and varied cooking capacity;
- eating out, takeaway, intentional skips, or temporary schedule changes; and
- households that already experience meal planning as recurring work.

The cohort is Ireland-first so the initial catalogue, terminology, measurement,
and support context are credible. That is an operating choice, not a domain
constraint.

The beta is not recruited as a clinical nutrition programme, a sole severe-
allergen or food-safety safeguard, or a preview of retailer fulfilment that the
MVP does not provide. Participants may pause or withdraw at any time. Transcript
or screen access is optional and separately consented to; willingness to expose
private conversations is not a condition of participation.

Expansion between cohort stages is explicit and evidence-based. Dates, available
invites, or delivery milestones do not open the next stage automatically.

## Stage Readiness Gates

### Hard gates

The following block external invitations or cohort expansion regardless of
planning speed or positive qualitative feedback:

- unresolved privacy, authorization, cross-household-isolation, or hard-
  constraint failures;
- approved plans with unresolved managed coverage, invalid required fallbacks,
  impossible cook or leftover dependencies, or invalid portion and prepared-
  output allocations;
- silent rewriting of approved plan or shopping state;
- failing required deterministic tests or hard-blocking synthetic agent evals;
- a normal end-to-end journey that requires out-of-band developer or database
  mutation of canonical product state; or
- a known critical incident whose cause and required corrective action remain
  unresolved.

Hands-on support and explanation are acceptable. Quietly fixing canonical data
behind the product so a household appears successful is not.

### Dogfood to closely supported pilot

Before adding the first external households:

- Cillian's household completes at least two consecutive genuine weekly cycles;
- both cycles reach an approved plan and shopping list, with the second cycle
  exercising the following-week review or equivalent feedback path;
- the second cycle requires no critical planner correction;
- the normal path requires no developer or database intervention; and
- a representative initial setup through first approved plan is achievable in
  approximately `30 minutes` of active household interaction.

The `30-minute` value is an operating target and review trigger. A longer complex
case may still be acceptable when its cause and correction burden are understood;
it must not be hidden by rushing high-impact confirmation.

### Closely supported pilot to first full cohort

Before expanding to approximately six to eight households in total:

- every pilot household completes at least two genuine weekly cycles;
- no pilot household's latest two completed cycles contain a critical planner
  correction;
- median returning-week active planning time is `10 minutes` or less;
- median burden in later pilot cycles is no more than `2` major corrections per
  plan;
- a majority of pilot households improve from their first usable week in active
  time, correction burden, or both;
- support is not required every week to manufacture a complete usable plan; and
- a majority of participants say they would use the product even if they were
  not helping test it.

The longer-term ambition for a mature returning household is closer to a
`5-minute` planning interaction. That is not the gate for entering the first full
cohort.

### Correction categories

A **critical planner correction** repairs a failure that should have prevented or
invalidated the recommendation, such as a missed known hard constraint, invalid
or absent managed coverage, a required fallback that is omitted or incompatible,
or an impossible cook, leftover, prepared-component, or portion dependency.

A **major correction** repairs a substantive misunderstanding while the plan
remains recoverable, such as correcting a routine, adding a missing person-level
alternative, replacing an unsuitable shared meal, or materially restructuring
cook events, portions, prepared outputs, or leftovers.

A preference-only edit—such as swapping one otherwise valid dinner because the
household wants something different—is not counted as a major planner failure.
Metrics retain correction reason and target rather than relying on raw edit
count.

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

Measure meaningful changes before approval, classified as critical, major, or
ordinary preference edits. Relevant changes include:

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

## Evaluation Evidence Stack

[PDR-0006](../decisions/product/0006-ai-evaluation-and-release-evidence.md)
defines three distinct forms of evidence.

### Deterministic domain and software tests

Exact pass-or-fail tests prove authorization, privacy, hard constraints, coverage,
portion and allocation arithmetic, routine and fallback expansion, repair,
versioning, and approval invariants. These tests do not judge whether the
conversation was perceptive or useful.

### Synthetic household agent evals

A fixed, versioned repository suite exercises discovery, profile and routine
synthesis, planning, rationale, and repair against privacy-safe synthetic
households. Each scenario includes required discoveries, prohibited assumptions,
hard invariants, expected artifacts, representative user changes, and a scored
quality rubric.

A scenario need not prescribe one exact golden week where several plans could be
valid. It must reject hard-invariant violations and score the complete
interaction trajectory, including unnecessary questions, missed facts, first-plan
practicality, automatic application of known routines and fallbacks, explanation
quality, and repair behaviour.

The accepted 2026-09-06 staging in
[PDR-0006](../decisions/product/0006-ai-evaluation-and-release-evidence.md#stage-specific-evidence-and-the-complete-beta-gate)
lets Stage 2 establish discovery/profile evidence across all eight families.
Routines, planning/repair, feedback learning, and shopping are exercised in
their owning stages. Unimplemented dimensions are recorded as not exercised, not
passing. Before inviting the first external beta household, the complete
connected eight-family discovery-to-repair journey, including shopping
consequences, must pass with full human calibration. A discovery-only baseline
cannot satisfy that gate.

### Live beta product evidence

Real household measures determine whether the offline evidence translates into
time saved, fewer corrections, returning use, and a genuine sense that the
product understands the household.

Meaningful model, prompt, tool, orchestration-policy, or agent-behaviour changes
must run the relevant deterministic tests and synthetic evals. Results record the
exact model, prompt, tool, policy, scenario, and rubric versions. Offline evals
are a release gate, not a substitute for beta evidence.

## Representative Evaluation Households

Before and during beta, maintain privacy-safe synthetic scenarios covering at
least:

- two adults with different work and breakfast routines;
- a dependant with a narrow fallback repertoire;
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
validation, the final plan, and at least one meaningful repair request rather
than prompt output in isolation. New reusable classes of production failure
should become privacy-safe regression scenarios where practical.

## Privacy-Safe Instrumentation

Operational events should use opaque household and session correlations and
record only the data required for product learning. Useful events include:

- interview started, completed, or abandoned;
- profile fact proposed, confirmed, corrected, or rejected by category;
- routine proposed, accepted, changed, or disabled by category;
- plan proposal created;
- unresolved coverage count and closed reason categories;
- critical, major, and preference-only correction categories;
- plan revision command category;
- plan approved or abandoned;
- shopping list generated; and
- weekly feedback category.

Do not place transcripts, raw health disclosures, ingredient free text, source
URLs, recipe evidence, or credentials in analytics events.

## Qualitative Beta Practice

For a small cohort, the team should regularly review:

- completed transcripts only where the participant grants explicit,
  purpose-specific, time-limited access;
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

- every hard gate above is clear;
- authorization and cross-household isolation for profiles, interviews,
  routines, plans, recipes, feedback, and shopping lists;
- private transcript handling and household-visible confirmed-profile handling;
- deterministic hard-constraint and coverage validation;
- versioned recipe and plan behavior;
- restart and replay safety for meaningful mutations;
- green deterministic tests and accepted synthetic agent-eval evidence for the
  beta scenario set;
- catalogue coverage evidence meeting the gate above, not merely a raw count;
- complete representative vertical tests;
- a privacy-safe operator view for support;
- closed read-only completed interviews and audited participant-consented
  transcript access;
- no retailer credentials, basket effects, or accidental provider effects in
  the beta path; and
- a clear mechanism to pause or remove a household from the beta.

## Exit Criteria

The stage thresholds above are the initial operating gates for the invite-only
beta. Broader product thresholds should be refined from evidence rather than
invented in advance.

The beta may be considered directionally successful when:

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

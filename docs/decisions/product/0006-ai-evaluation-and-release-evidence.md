# PDR-0006 — AI Evaluation And Release Evidence

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

Meal Planner depends on an unusually capable AI-led discovery and planning
experience, but conversational fluency is not proof that the product understood
the household or produced a usable week. Equally, deterministic domain tests
cannot measure whether the agent asked the right questions, synthesized useful
routines, or explained a recommendation well.

The product therefore needs distinct evidence for domain correctness, agent
quality, and real household value. Model or prompt selection must follow that
evidence rather than becoming an architectural assumption chosen in advance.

## Decision

### Three evaluation layers

Meal Planner uses three complementary evaluation layers.

#### 1. Deterministic domain and software tests

Exact pass-or-fail tests prove invariants and implementation behaviour such as:

- authorization and cross-household isolation;
- hard constraints never being bypassed;
- every managed meal requirement receiving an explicit resolution;
- routines and approved fallbacks expanding correctly;
- portions and prepared outputs never being double allocated;
- draft repair preserving dependent leftovers, alternatives, and shopping
  demand; and
- approved plans remaining stable until a visible revision is accepted.

These tests do not judge conversation quality.

#### 2. Synthetic household agent evals

A fixed, versioned suite of privacy-safe synthetic household scenarios exercises
the complete agent trajectory: discovery, artifact creation, routine synthesis,
plan generation, rationale, and repair.

Each scenario defines:

- known household facts and contexts;
- facts the agent is expected to discover;
- facts or claims it must not invent;
- hard invariants and prohibited outcomes;
- expected structured artifacts and transitions;
- representative user changes or challenges; and
- a scored quality rubric.

The eval does not require one exact golden weekly plan where several plans could
be valid. It requires the plan to satisfy the scenario's invariants and scores
quality across dimensions including:

- important facts discovered and missed;
- unnecessary or repeated questions;
- profile and routine synthesis accuracy;
- confirmation of high-impact assumptions;
- conflict recognition;
- first-plan practicality;
- correct automatic application of routines and approved fallbacks;
- clarity and truthfulness of planning rationale;
- repair quality after a requested change;
- unsupported inference or overreach; and
- overall sense that the result is specific to the household.

A scenario fails when it violates a hard invariant or prohibited outcome even if
its prose appears impressive.

#### 3. Live beta product evidence

The invite-only beta measures whether real households receive value through:

- active time to an approved plan;
- correction burden;
- plan approval and use;
- week-two and week-four return;
- whether later weeks require less work;
- user-rated feeling of being understood; and
- qualitative evidence about where the agent or domain model failed.

Offline eval success is required but cannot substitute for this product
evidence.

### Initial synthetic scenario suite

The first release suite contains eight scenario families. Each family exercises
the interview, visible artifacts, recommended plan, rationale, and at least one
follow-up revision rather than judging only a final JSON document.

1. **Simple household baseline.** Straightforward preferences and routines prove
   that the agent can reach a useful plan quickly without exhaustive or repeated
   questioning.
2. **Conflicting adult routines.** Adults have different breakfasts, office
   days, work-from-home availability, packed-lunch needs, and shared dinners.
3. **Dependants and fallbacks.** A dependant strongly avoids a meal category,
   has an approved exact packaged fallback, and must not create unnecessary
   additional cooking work.
4. **Mixed dietary household.** Vegetarian and omnivore household members share
   components and meals where practical while retaining compatible individual
   coverage.
5. **Hard-constraint household.** An allergen or prohibited ingredient must
   never appear through a shared meal, fallback, ingredient substitution, or
   repair operation.
6. **Routine-heavy household.** Repeated breakfasts and lunches, an intentional
   skip, eating out, and a fixed takeaway night test whether routines compress
   planning work rather than creating repeated entry.
7. **Capacity-constrained week.** Limited substantial cook events, one hands-off
   slow-cooker opportunity, available equipment, and several busy evenings test
   realistic effort and preparation-window reasoning.
8. **Dependency and repair.** A planned batch cook supplies later lunches, then
   the user changes the producing meal and the system must repair portions,
   person alternatives, prepared outputs, and shopping demand coherently.

Concrete fixtures may vary within a family, but the family purpose, required
discoveries, hard invariants, prohibited outcomes, and rubric expectations are
versioned repository assets.

### Release gating

- Meaningful changes to the model, prompt, tools, orchestration policy, or agent
  behaviour run the relevant deterministic tests and synthetic eval suite before
  release.
- The exact model, prompt, tool, policy, scenario, and rubric versions used for
  an evaluation are recorded with its result.
- A change that improves one aggregate score cannot ship by silently regressing
  a hard safety, privacy, authority, or plan-completeness invariant.
- Candidate models and providers are compared against the accepted eval suite;
  provider choice does not define the household domain.
- Evals should be small enough to run repeatedly while broad enough to include
  representative household complexity and repair behaviour.

### Blocking and acceptance policy

The following always block release:

- a deterministic hard-invariant failure;
- a safety, privacy, authorization, or cross-household-isolation failure;
- a required meal left without an explicit valid resolution;
- an invented material fact presented as confirmed;
- an incompatible meal assigned despite a hard constraint;
- a required fallback omitted or applied incorrectly;
- an invalid, duplicate, or overdrawn portion or prepared-output allocation;
- a silent rewrite of approved state; or
- any scenario outcome explicitly marked as prohibited.

Quality regressions such as excessive questioning, weaker synthesis, less useful
rationale, or a poorer-but-still-valid plan do not automatically receive the
same binary treatment. They require explicit product review against the scenario
rubric, affected user journey, and aggregate results.

The Meal Planner product owner is the final MVP release-acceptance authority. A
known quality regression may be accepted only when the pull request records:

- the exact regression and affected scenarios;
- why shipping is still preferable;
- why no hard invariant is involved;
- the follow-up work or monitoring required; and
- the evidence used for the decision.

An override cannot waive a hard blocker.

Material changes to scenarios, prohibited outcomes, rubrics, or scoring policy
must be reviewed as repository changes. The suite must not be weakened merely to
allow a candidate model, prompt, or tool change to pass.

### Hybrid judging and calibration

Eval dimensions use the least subjective reliable judge available:

- **Deterministic scoring** owns objectively checkable outcomes, including
  required facts discovered, prohibited assumptions, hard constraints, expected
  artifacts, accepted routines and fallbacks applied, coverage completeness,
  allocation validity, and repair integrity.
- **Programmatic measures** own question count, repeated questions, latency,
  tool and schema failures, token usage, and estimated cost.
- **A fixed model judge** scores softer quality dimensions such as
  perceptiveness, household specificity, value of follow-up questions, clarity
  of rationale, and usefulness of a valid plan or repair.
- **Human review** calibrates the initial rubric and judge, investigates all hard
  failures, resolves close release decisions, and reviews every proposed
  acceptance of a known quality regression.

The model judge runs only after deterministic hard checks pass and cannot waive,
downgrade, or compensate for a hard failure. Its model, prompt, rubric, and
version are recorded with the result.

Model-judge scores are periodically compared with human review on a stable
calibration sample. Material disagreement, drift, or systematic leniency blocks
reliance on the judge until the scoring policy is corrected and revalidated.

### Non-hard quality bands

The first eval implementation uses a five-point rubric for each soft quality
dimension. Thresholds are deliberately simple until real baseline evidence
exists.

The critical soft dimensions are:

- household specificity;
- first-plan practicality;
- profile and routine synthesis quality;
- planning-rationale quality; and
- repair quality.

Candidate results are classified as follows:

- **Green:** every critical dimension is at least `4/5`, and the candidate has no
  meaningful regression from the currently accepted baseline.
- **Review required:** any critical dimension is `3/5`, any critical dimension
  drops by at least `0.5` from the accepted baseline, or question count,
  latency, tool reliability, token usage, or estimated cost worsens materially.
- **Do not release by default:** any critical dimension is below `3/5`, or
  several scenarios are technically valid but clearly generic, impractical, or
  burdensome for the household.

The first accepted baseline is established through human review of the complete
initial scenario suite. Later candidates are judged against both the absolute
bands and that versioned baseline.

A non-hard red result remains eligible only for the documented product-owner
override process. Such an override should be rare, explicit, and cannot affect a
hard blocker.

### Scenario maintenance

- Synthetic scenarios live in the repository as product-quality assets.
- New production failures that reveal a reusable class of agent mistake should
  become a privacy-safe regression scenario where practical.
- Scenario changes that materially make the suite easier require explicit
  review and explanation.
- Scenarios must not contain copied private household transcripts or identifying
  beta data.

## Consequences

- Agent quality is treated as an engineered, versioned product capability rather
  than a one-off prompt demonstration.
- The repository needs an eval harness, scenario format, rubric format, result
  recording, and release evidence before Stage 2 is complete.
- The first harness must cover all eight accepted scenario families and the full
  discovery-to-repair trajectory.
- The harness needs deterministic checks, programmatic telemetry, a versioned
  fixed model-judge path, and a human-calibration workflow.
- The initial baseline needs a human-reviewed `1–5` score for every critical
  soft dimension and scenario.
- Domain correctness and agent quality remain separable: an agent cannot obtain
  credit for violating deterministic rules, and a valid but generic interaction
  can still score poorly.
- Hard blockers cannot be traded against an aggregate score or waived by product
  judgment.
- Non-hard quality regressions remain product decisions and must be documented
  rather than hidden in an average.
- Real beta metrics remain the final evidence for the time-saving product
  promise.

## Deferred

- exact fixture data and secondary variations inside each accepted scenario
  family;
- the first agent model, model judge, and provider selections;
- the size and cadence of the human calibration sample; and
- production experimentation or multi-armed model routing.

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
- Domain correctness and agent quality remain separable: an agent cannot obtain
  credit for violating deterministic rules, and a valid but generic interaction
  can still score poorly.
- Real beta metrics remain the final evidence for the time-saving product
  promise.

## Deferred

- the exact initial scenario inventory;
- numeric thresholds for release;
- the individual or role that approves eval-suite changes;
- the first model and provider selection;
- automated model-based judging versus human review for each rubric dimension;
  and
- production experimentation or multi-armed model routing.
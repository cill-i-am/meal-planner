# PDR-0003 — Complete Weekly Planning, Repair, Approval, And Review

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

The product promises to remove planning work, not to create a meal-tracking
obligation. It must account for every person and managed meal occasion while
presenting one understandable household week. Changes to one meal may affect
leftovers, alternatives, cook events, and shopping demand, so revisions need a
coherent repair model.

## Decision

### Planning period and completeness

- A planning period is seven days by default with a household-configurable
  start day.
- Adults may generate or replan only the remaining dates in an active period.
- For each managed `person × date × meal occasion`, the plan records an explicit
  resolution.
- A resolution may be a meal option, an allocated leftover or prepared
  component, eating out or takeaway, an intentional skip, a flexible
  decide-on-the-day slot, or an unresolved gap.
- A flexible slot counts as deliberate coverage but creates no recipe or
  shopping assumptions.
- An unresolved gap is never disguised by an invented meal. Before approval it
  must become an explicit resolution.
- Households configure which occasions are managed; unmanaged occasions do not
  create hidden gaps.

### One recommended plan

- The planner presents one strong recommended week rather than several complete
  alternatives that return the planning burden to the household.
- The recommendation is already personalised and coherent.
- Adults may request focused alternatives or revisions, such as making one day
  easier, replacing fish, or moving a cook event.

### Draft repair

- While a plan is a draft, a change triggers repair of all affected dependent
  state, including person alternatives, leftover allocations, prepared
  components, portions, cook events, and shopping preview.
- The repaired draft clearly explains consequential changes.
- The agent may carry out low-risk repair automatically within the draft, but it
  cannot hide a hard constraint, unresolved gap, or changed assumption.

### Approval and post-approval revision

- Any adult may edit, approve, reject, reopen, or revise the shared plan in the
  MVP.
- Every action is audited and the household can see who made the latest change.
- Dependants cannot edit or approve plans in the MVP.
- Approval pins the relevant profile, routine, recipe, portion, and plan
  versions.
- Once approved, the plan is never silently rewritten.
- A later change creates a proposed revision with a visible diff.
- An adult may accept the complete revision or continue editing before it
  becomes active.

### Low-friction during-week behaviour

- There is no mandatory per-meal confirmation and no requirement to mark meals
  as cooked or eaten.
- The product assumes the approved plan happened unless an adult reports an
  exception.
- Planned same-week leftovers are part of the plan and need no separate
  inventory confirmation.
- If the producing meal did not happen, the exception can be reported ad hoc or
  during weekly review and affected later coverage is explained.
- Ad hoc reporting remains available but is never required for ordinary use.

### Weekly review

- The normal checkpoint for feedback, skipped meals, unexpected leftovers, and
  cross-week carry-over is the next weekly planning session.
- Weekly review is optional and never blocks generating the next plan.
- The agent may offer a short recap because it can improve the next proposal,
  but the household may skip it.
- Lightweight signals include liked, disliked, skipped, not made, too much
  effort, wrong quantity, successful fallback, rejected by a dependant, and
  make again.
- The agent asks a focused follow-up only when it materially improves future
  planning.
- Feedback may propose profile, routine, recipe, capacity, or cadence changes,
  but enduring changes require the admitted confirmation policy in the owning
  capability.

### Feedback attribution and conflict

- Any adult may record feedback for any household person, including another
  adult or a dependant.
- Each signal records both the subject of the feedback and the adult who
  reported it.
- A signal may instead concern the household, a meal event, a cook event, a
  recipe, a routine, or a plan where person attribution would be misleading.
- Self-reported preference evidence normally carries more weight for that
  person's profile than another adult's observation.
- Adult-reported observations remain valid evidence, especially for dependants
  who do not have accounts in the MVP.
- Conflicting signals are retained with their provenance. They are not collapsed
  into one synthetic household opinion.
- Ordinary feedback is household-visible in the MVP, consistent with confirmed
  person profiles and shared planning state.

### Learning proposal policy

- The product does not use a crude universal threshold such as a fixed number of
  thumbs-down signals to mutate a profile.
- One explicit high-confidence statement, such as "I never want this again",
  may justify an immediate proposed enduring change.
- Weaker signals require a repeated pattern across planning periods before the
  agent proposes a persistent change.
- Signal meaning is contextual. "Too much effort" informs effort, routine,
  capacity, recipe, or cook-event policy; it does not automatically become a
  food dislike.
- "Not made" or "skipped" is not treated as dislike without supporting reason.
- Recency, repetition, reporter, subject, context, and existing confirmed facts
  all contribute to proposal confidence.
- The agent may propose a change to a profile, routine, fallback, cadence,
  portion factor, recipe, or cooking-capacity assumption.
- No enduring state is changed solely because an inference crossed an internal
  threshold. An adult must confirm the proposed change.
- Inferred evidence and accepted changes remain inspectable and reversible.

### Carry-over stock

- Prepared portions intended for a future planning period are shown as expected
  carry-over at the next planning session.
- The next plan cannot depend on that stock until an adult confirms it still
  exists.
- Ignoring or skipping the confirmation leaves the stock unavailable for
  planning rather than assuming a mythical portion exists.

## Consequences

- Plan generation and revision need explicit dependency tracking and a repair
  operation, not independent mutation of calendar cells.
- Product metrics must distinguish first-proposal gaps, adult-requested changes,
  automatic draft repairs, and approved-plan revisions.
- Feedback storage must preserve subject, reporter, target type, context, and
  provenance rather than reducing every signal to a recipe score.
- Learning is proposal-driven and reversible; it is not an autonomous profile
  mutation system.
- The happy path during the week requires no application interaction.
- Inventory accuracy deliberately follows an exception-based model rather than
  demanding perfect event logging.

## Deferred

- mandatory meal tracking;
- automatic rewrite of approved plans;
- household consensus approval;
- dependant self-reporting through accounts;
- private ordinary feedback;
- external calendar integration;
- full custody or visitor scheduling; and
- autonomous learning that changes enduring state without confirmation.
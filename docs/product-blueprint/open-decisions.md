# Open Decisions

## Purpose

This document contains only material product questions that still need explicit
resolution. Accepted answers live in
[`../decisions/product`](../decisions/product/), and technical consequences live
in [`../architecture/decisions`](../architecture/decisions/).

An implementation work item must not silently answer one of these questions
merely because a code shape is convenient.

## Accepted Decision Summary

The workshop has accepted nine product decision records:

- [Household people, profiles, and interviews](../decisions/product/0001-household-people-profiles-and-interviews.md)
- [Routines, fallbacks, and plan rationale](../decisions/product/0002-routines-fallbacks-and-plan-rationale.md)
- [Weekly planning, repair, approval, and review](../decisions/product/0003-weekly-planning-repair-approval-and-review.md)
- [Meal content, portions, recipes, prepared food, and shopping](../decisions/product/0004-meal-content-portions-recipes-and-shopping.md)
- [MVP scope and deferrals](../decisions/product/0005-mvp-scope-and-deferrals.md)
- [AI evaluation and release evidence](../decisions/product/0006-ai-evaluation-and-release-evidence.md)
- [Household agent conversations and visibility](../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [Temporary context, visitors, and planning suspensions](../decisions/product/0008-temporary-context-visitors-and-planning-suspensions.md)
- [Shared catalogue acquisition, curation, and publication](../decisions/product/0009-shared-catalogue-acquisition-curation-and-publication.md)

Do not re-open those choices in implementation without proposing a superseding
record.

## Before Stage 2 — AI Discovery

### Model, judge, and calibration strategy

The three-layer evidence model, eight initial synthetic scenario families,
versioned household evals, hybrid deterministic/programmatic/model/human judging,
non-hard quality bands, hard release blockers, repository review requirements,
and final MVP product-owner acceptance are settled in PDR-0006. Remaining
choices are:

- What first agent model, model judge, and provider strategy meet quality, cost,
  privacy, and latency requirements against the accepted suite?
- How large is the human calibration sample and how often is it rerun?
- Is production model experimentation needed during the invite-only beta?

The household-agent runtime, shared and private conversation model, authority
split, and thin model-adapter boundary are settled in PDR-0007 and ADR-0004.
Provider choice follows product evaluation and does not define the domain.

## Before Stage 3 — Routines And Fallbacks

Temporary absences, visitors, one-off weekly context, stable recurring patterns,
and whole- or partial-household planning suspension are settled in PDR-0008.
Routine-conflict precedence, optimistic concurrency, fallback repertoire size,
manual availability, exact-product substitution, agent-proposed fallbacks, and
the quick compatible-fallback swap interaction are settled in PDR-0002.

## Before Stage 4 — Meal Content And Recipe Supply

### Catalogue rights and beta coverage

Bulk candidate acquisition, the roughly `100–200` active-recipe starting target,
operator-only publication, optional admin UI, private household banks, separate
catalogue authority, immutable catalogue corrections, latest-active future use,
and non-rebasing household forks are settled in PDR-0009 and ADR-0005.
Remaining choices are:

- What exact rights and attribution policy makes each source class publishable?
- Which source evidence and attribution remain visible to households using a
  catalogue recipe?
- What exact minimum content coverage, rather than raw recipe count, is required
  before external invitations begin?

### Food concepts, units, and product identity

- Which unit systems and conversions are supported first?
- How are ambiguous household measures represented?
- Which food taxonomy or household-owned concept model is used?
- What confidence is required before ingredient lines aggregate into shopping
  demand?
- How is an exact packaged product identified before a retailer catalogue exists?

### General web-page import

- Which public sites and markup are supported initially?
- What acquisition, robots, terms, rights, size, redirect, and SSRF policies
  apply?
- Is visible-page evidence required when structured data appears complete?
- How are multi-page or interactive recipe cards handled?

## Before Stage 5 — Planning

### Baseline ranking policy

Hard constraints, routines, cooking capacity, and approved fallbacks are already
settled. Remaining ranking questions include:

- How are ordinary preference, effort, repetition, ingredient reuse, and gentle
  qualitative variety weighted?
- Which values are product defaults versus household configuration?
- When does the planner prefer a flexible slot over a low-confidence meal?
- How are ties kept deterministic before optional model assistance?

### Portion defaults and complex serving

- Which initial numeric factors seed child, small-adult, standard-adult, and
  large-portion labels?
- How are shared sides, buffet meals, fractional packaged units, and dishes with
  several independently portioned components represented?
- Which weekly feedback is enough to propose a changed serving factor?

### Plan projection and rationale

- What visual grouping best presents shared meals, personal alternatives,
  routines, cook events, and prepared outputs?
- Which rationale is visible by default and which is expanded on demand?
- How does the UI show a draft repair or approved-plan revision without
  overwhelming the household?

The frontend projection must remain free to differ from internal domain unions.

## Before Stage 7 — Shopping List

### Collaboration and offline behaviour

- Can several adults edit and check the list concurrently?
- What conflict behaviour is acceptable for quantity edits and check-off state?
- Is offline shopping-list use required for the beta?
- What sharing or export behaviour is needed beyond authenticated household
  access?

### Manual-state lifecycle

- When an item is no longer required after a plan revision, how long is it kept
  in the visible list history?
- How are manual non-food items grouped and carried between weeks?
- Should households maintain an optional staples checklist after the one-off
  "already have this?" flow proves useful?

## Beta Operating Decisions

- Exact beta cohort size and recruitment criteria.
- Internal readiness thresholds for time to approved plan and correction burden.
- Support and incident-handling process for the invite-only cohort.
- The exact catalogue coverage matrix required before invitations begin.

## Deliberately Deferred

These questions are real but are not prerequisites for the MVP decision
workshop:

- generic calorie, macro, weight, muscle, or medical goals;
- continuous ingredient pantry inventory;
- food-safety expiry calculation or certification;
- retailer partnerships and official authorization;
- product, price, availability, offer, and basket integration;
- MCP tools, resources, elicitation, and tasks;
- embedded and white-label channels;
- public recipe contribution and marketplace policy;
- semantic recipe search infrastructure;
- non-household organization products; and
- fleet-wide product read models without an accepted use case.

## Decision Process

When resolving an item:

1. state the household problem and affected users;
2. identify privacy, authority, safety, and plan-semantics effects;
3. compare the smallest viable alternatives;
4. add or update the owning product decision record;
5. add or update an ADR when a durable technical boundary changes;
6. update affected blueprint documents; and
7. create repository delivery work only after the decision is accepted.

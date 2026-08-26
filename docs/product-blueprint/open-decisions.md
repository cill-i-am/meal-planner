# Open Decisions

## Purpose

This document contains only material product questions that still need explicit
resolution. Accepted answers live in
[`../decisions/product`](../decisions/product/), and technical consequences live
in [`../architecture/decisions`](../architecture/decisions/).

An implementation work item must not silently answer one of these questions
merely because a code shape is convenient.

## Accepted Decision Summary

The workshop has accepted sixteen product decision records:

- [Household people, profiles, and interviews](../decisions/product/0001-household-people-profiles-and-interviews.md)
- [Routines, fallbacks, and plan rationale](../decisions/product/0002-routines-fallbacks-and-plan-rationale.md)
- [Weekly planning, repair, approval, and review](../decisions/product/0003-weekly-planning-repair-approval-and-review.md)
- [Meal content, portions, recipes, prepared food, and shopping](../decisions/product/0004-meal-content-portions-recipes-and-shopping.md)
- [MVP scope and deferrals](../decisions/product/0005-mvp-scope-and-deferrals.md)
- [AI evaluation and release evidence](../decisions/product/0006-ai-evaluation-and-release-evidence.md)
- [Household agent conversations and visibility](../decisions/product/0007-household-agent-conversations-and-visibility.md)
- [Temporary context, visitors, and planning suspensions](../decisions/product/0008-temporary-context-visitors-and-planning-suspensions.md)
- [Shared catalogue acquisition, curation, and publication](../decisions/product/0009-shared-catalogue-acquisition-curation-and-publication.md)
- [Food concepts, exact products, and retailer preferences](../decisions/product/0010-food-concepts-exact-products-and-retailer-preferences.md)
- [Recipe URL import and source routing](../decisions/product/0011-recipe-url-import-and-source-routing.md)
- [Planner feasibility, ranking, and deterministic selection](../decisions/product/0012-planner-feasibility-ranking-and-deterministic-selection.md)
- [Plan projection, rationale, and experience experimentation](../decisions/product/0013-plan-projection-rationale-and-experience-experimentation.md)
- [Shared shopping-list collaboration and offline use](../decisions/product/0014-shared-shopping-list-collaboration-and-offline-use.md)
- [Invite-only beta cohort and learning cadence](../decisions/product/0015-invite-only-beta-cohort-and-learning-cadence.md)
- [Beta support, incidents, and operator repair](../decisions/product/0016-beta-support-incidents-and-operator-repair.md)

Do not re-open those choices in implementation without proposing a superseding
record.

## Before Stage 2 — AI Discovery

### Model, judge, and calibration strategy

The three-layer evidence model, eight initial synthetic scenario families,
versioned household evals, hybrid deterministic/programmatic/model/human judging,
non-hard quality bands, hard release blockers, repository review requirements,
and final MVP product-owner acceptance are settled in PDR-0006. The same record
also requires a bounded `@vercel/agent-eval` custom-agent spike before either
adopting that package or building a bespoke harness. Vercel Run SDK is not part
of the current eval design.

Remaining choices are:

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

Bulk candidate acquisition, the roughly `100–200` operating target,
coverage-based beta readiness, operator-only publication, optional admin UI,
private household banks, separate catalogue authority, source URL and creator
attribution retention, lightweight publication policy, immutable catalogue
corrections, latest-active future use, and non-rebasing household forks are
settled in PDR-0009 and ADR-0005.

Metric-first units, source-measure preservation, conservative conversion, and
retention of ambiguous household measures are settled in PDR-0004.

The application-owned food-concept registry, reviewed global aliases,
household-local mapping corrections, provenance-based mapping authority,
fail-closed shopping aggregation, exact product classification, product
attributes, household and retailer-scoped preferences, substitution rules, and
the future separation of retailer listings are settled in PDR-0010 and ADR-0006.

One-URL submission, deterministic source routing, dedicated TikTok acquisition,
a generic public recipe-web-page adapter, structured-markup-first evidence,
visible-card comparison where available, field-level conflict provenance, the
shared downstream import lifecycle, private household admission, honest
unsupported-source behaviour, and the no-browser-automation MVP boundary are
settled in PDR-0011 and ADR-0007.

### Web-page acquisition policy

The remaining implementation decisions for the generic web-page adapter are:

- What exact robots and publisher-policy behaviour applies to an intentionally
  submitted public recipe URL?
- Which MIME types, response-size bounds, redirect limits, timeouts, and
  extraction limits form the initial restricted-fetch policy?

Multi-page, slideshow, highly interactive, and browser-dependent recipe
experiences remain unsupported in the MVP. A later Cloudflare Browser Run path
may be considered only when observed failed-import coverage justifies its cost
and complexity.

## Before Stage 5 — Planning

The feasibility gate, ordered ranking layers, plan-level dependency evaluation,
flexible-slot preference over a poor recommendation, product-default priorities,
traceable rationale, and stable deterministic tie-breaking are settled in
PDR-0012 and ADR-0008.

MVP portion labels and factors, per-person and per-occasion defaults,
meal-specific overrides, serving-equivalent summation, explicit item or
component quantities for packaged, buffet, shared-side, and component meals, and
confirmation-only learning from quantity feedback are settled in PDR-0004.

The default household-week information hierarchy, separate eating and cooking
perspectives, progressive rationale, repair and revision communication, derived
frontend projections, and the explicit prototype, usability, iteration, and A/B
testing boundary are settled in PDR-0013. Exact component trees, layouts,
navigation, density, and interaction details remain implementation experiments
unless they change accepted plan semantics, privacy, authority, or coverage
truth. Beautiful UI is retained there as a non-authoritative agent-interface
reference rather than a selected dependency or frozen design system.

## Before Stage 7 — Shopping List

Shared authenticated-adult access, live item-level collaboration, a narrow
offline cache and operation queue for check state and simple manual additions,
online-only structural edits, optimistic concurrency, replay-safe desired-state
commands, and the absence of public or anonymous editable links are settled in
PDR-0014 and ADR-0009.

The same records now settle manual and removed-item lifecycle: unchecked
plan-derived demand removed by a revision leaves the active list but remains in
history; purchased or checked items remain visible as no longer required until
list archival; plan revisions never remove manual items; unfinished manual items
carry into the next list; completed manual items archive; and a dedicated
recurring-staples system is deferred. No additional Stage 7 product decision is
currently required before MVP implementation.

## Beta Operating Decisions

The dogfood, closely supported pilot, approximately six-to-eight-household first
cohort, four genuine weekly planning cycles, recruitment mix, Ireland-first
operating boundary, beta expectation limits, optional transcript consent, hard
expansion gates, correction-severity definitions, `30-minute` first-setup target,
`10-minute` returning-week gate, and later-pilot correction threshold are settled
in PDR-0015.

Contextual problem reporting, critical/blocking/quality incident levels, critical
containment and participant communication, read-only support access, transcript-
specific consent, audited operator repair commands, sanitized repository
records, and regression-evidence requirements are settled in PDR-0016. No
additional beta operating decision is currently required before MVP
implementation; the implementing stage still needs the concrete support runbook
and operator tooling described by that record.

## Deliberately Deferred

These questions are real but are not prerequisites for the MVP decision
workshop:

- generic calorie, macro, weight, muscle, or medical goals;
- continuous ingredient pantry inventory;
- food-safety expiry calculation or certification;
- retailer partnerships and official authorization;
- product price, availability, offer, listing, and basket integration;
- MCP tools, resources, elicitation, and tasks;
- embedded and white-label channels;
- public recipe contribution and marketplace policy;
- Browser Run recipe acquisition until observed failures justify it;
- semantic recipe search infrastructure;
- a dedicated recurring-staples checklist or recurrence engine;
- public self-service beta signup or growth acquisition;
- large-scale support operations, contractual service levels, and public status
  infrastructure;
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

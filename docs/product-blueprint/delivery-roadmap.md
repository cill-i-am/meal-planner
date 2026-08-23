# Delivery Roadmap

## Purpose

This roadmap sequences product capabilities so that each stage creates a useful,
testable tracer. It is not a calendar commitment and does not replace Linear as
the live delivery system.

A stage may overlap another where an end-to-end tracer requires it. The order
expresses dependency and product-learning priority, not a mandate to complete
every possible feature in one layer before touching the next.

## Delivery Principles

- Complete the current authority migration before placing new canonical
  household state across competing stores.
- Prefer end-to-end product evidence over isolated infrastructure elegance.
- Build the smallest truthful capability that exercises the accepted domain.
- Keep AI behavior behind typed product commands and deterministic invariants.
- Delete superseded greenfield paths rather than preserving parallel models.
- Instrument each stage so it can prove or disprove its product assumption.
- Do not introduce retailer, MCP, embedded, or broad scale work into the beta
  critical path.

## Stage 0 — Close The Current Authority Migration

### Outcome

The repository has one clear canonical authority for existing household product
state and truthful current-state documentation.

### Scope

- complete the household evidence, settlement, recovery, batch, and shared-D1
  retirement sequence already accepted by the architecture migration plan;
- preserve Better Auth D1 as the identity control plane;
- retain only explicitly approved global operational facts outside household
  authority;
- update architecture and API documentation after each cutover;
- reconcile stale product documentation with this blueprint and the current
  implementation; and
- pause infrastructure-led refactoring that does not unlock a defined product
  stage.

### Exit evidence

- one canonical writer for each moved fact;
- repository-wide verification required by the migration plan;
- current documentation matches production composition; and
- the next household product capabilities can be built directly in the
  household authority.

## Stage 1 — Household People, Profiles, And Permissions

### Outcome

The product represents the actual people who eat, not only authenticated
organization members.

### Scope

- `HouseholdPerson` identity and lifecycle;
- adult, invited-adult, and dependant person types;
- account-to-person linking without duplication;
- household-visible confirmed person profiles;
- profile facts with source, strength, confidence, and review metadata;
- adult self-management and dependant guardian management;
- permission and audit rules for profile changes; and
- private interview-session identity and retention boundary.

### Vertical tracer

One adult creates a household, adds another adult and two dependants, links an
invited account, records visible profile facts, and proves cross-household
isolation and correct edit authority.

### Explicit exclusions

No broad AI interview, weekly planner, retailer state, or public profile sharing.

## Stage 2 — AI-Led Discovery And Profile Synthesis

### Outcome

Each adult can complete a private conversation that produces accurate,
confirmed household-visible profile facts with an unusually high experience
bar.

### Scope

- guided but adaptive interview orchestration;
- progressive profile-card artifacts;
- proposed versus confirmed fact transitions;
- intelligent follow-up selection;
- dependant profile assistance;
- conflict and uncertainty surfacing;
- nutrition-aware safety boundaries;
- transcript privacy and retention;
- evaluation scenarios and quality scoring; and
- privacy-safe interview instrumentation.

### Vertical tracer

Two adults complete independent private interviews. Each sees a synthesized
profile during the conversation, corrects at least one assumption, confirms the
result, and the household sees the confirmed profiles without gaining access to
the other adult's transcript.

### Exit evidence

- important planning facts are discovered across representative households;
- high-impact assumptions require confirmation;
- profile mutation occurs only through validated commands;
- the conversation is rated as specific to the household rather than generic;
  and
- interview completion and time remain compatible with the time-saving promise.

## Stage 3 — Person And Household Routine Builder

### Outcome

Recurring meal patterns are represented once and reused, so all-meal coverage
does not become repetitive weekly data entry.

### Scope

- person and household routine rules;
- configurable meal occasions;
- repeated fixed meals and categories;
- intentional skips;
- eating-out periods;
- packed-lunch and location context;
- leftover production and consumption rules;
- dependant fallback rules;
- effective dates and weekly exceptions;
- conflict detection and priority policy;
- AI-led proposal and revision; and
- visual routine editing.

### Vertical tracer

The agent builds weekday breakfast routines, Monday-to-Thursday leftover lunch
rules, Friday eating out, a weekend cooked breakfast, one intentional skip, and
a dependant fallback. A one-off school holiday changes one week without
rewriting the baseline.

### Exit evidence

- routine evaluation deterministically produces the expected concrete week;
- exceptions override without corrupting the enduring baseline;
- conflicts remain visible and resolvable;
- repeated patterns substantially reduce weekly input; and
- users can understand and edit the rules the agent created.

## Stage 4 — Recipe Foundation And Supply

### Outcome

The planner has trustworthy shared and household recipe supply with immutable
versions, structured ingredients, and reliable review.

### Scope

- shared curated-catalogue authority;
- private household recipe bank;
- immutable recipe versions and ancestry;
- household forks and adaptations;
- normalized ingredient quantities and scaling rules;
- planning metadata for effort, leftovers, portability, and dietary fit;
- existing TikTok import integration with the canonical recipe model;
- manual recipe entry;
- curated-content workflow; and
- general web-page import after the normalized model is proven.

### Vertical tracer

A household can select one curated recipe, import one private recipe, correct
and approve it, fork one recipe for a household preference, and pin exact
versions in a planning fixture.

### Exit evidence

- shared content never leaks private household recipes;
- imported uncertainty and provenance survive review;
- material edits create versions rather than rewriting history;
- scaling handles at least linear, discrete, bounded, and unresolved cases; and
- approved recipe data is sufficient for later shopping demand.

## Stage 5 — Complete Household Planning

### Outcome

The system proposes and revises a complete planning period for every configured
person and meal occasion while presenting a simple human week.

### Scope

- planning-period and meal-requirement materialization;
- complete person-date-meal coverage matrix;
- shared and individual meal coverage;
- routine-item coverage;
- eating out and intentional skips;
- unresolved-gap representation;
- cook events and cook batches;
- portion allocation and leftover accounting;
- low-burden variations and fallbacks;
- deterministic hard-constraint validation;
- candidate selection and scoring;
- AI-led proposal, revision, and explanation;
- compressed visual plan; and
- revisioned approval.

### Vertical tracer

A full household week covers all configured meals using repeated routines,
shared meals, one person-level exception, one fallback, eating out, an
intentional skip, and a cook event whose portions satisfy later lunches.
Conversational changes preserve coverage and portion validity.

### Exit evidence

- every mandatory matrix cell is explicitly resolved before beta approval;
- the UI groups ordinary shared coverage while retaining person exceptions;
- hard constraints cannot be overridden by model suggestions;
- allocations cannot exceed produced portions;
- plan revisions are idempotent and auditable; and
- active planning time is measured from proposal to approval.

## Stage 6 — Weekly Review And Household Learning

### Outcome

The next plan improves from real household feedback without turning meals into
constant surveys.

### Scope

- end-of-week review flow;
- lightweight meal, cook, routine, and person signals;
- focused follow-up questions;
- make-again and recurring-meal behavior;
- explicit proposed changes to profiles, routines, recipes, or planning policy;
- household history and explanation; and
- week-over-week product evidence.

### Vertical tracer

A household marks one meal as liked, one as too much effort, one as not made,
and one fallback as successful. The agent proposes a routine and effort-policy
change, the household confirms them, and the next week visibly reflects the
changes.

### Exit evidence

- feedback never silently rewrites hard facts;
- proposed enduring changes require confirmation;
- later weeks require fewer corrections in representative scenarios; and
- users can explain why the product changed its proposal.

## Stage 7 — Retailer-Neutral Shopping List

### Outcome

An approved plan becomes a practical consolidated list without introducing
retailer integration risk.

### Scope

- ingredient demand from pinned recipe versions and routine items;
- aggregation and unit normalization;
- portion-aware quantities;
- explicit pantry confirmation;
- acceptable forms and substitutions at the food-requirement level;
- category grouping;
- manual add, edit, check, and share behavior; and
- regeneration on approved-plan revision.

### Vertical tracer

The approved full-week plan produces one consolidated list, combines repeated
ingredients, subtracts only confirmed pantry stock, updates after a plan
revision, and contains no retailer credentials or external basket effects.

### Exit evidence

- list quantities trace back to approved plan demand;
- unresolved recipe quantities remain visible rather than fabricated;
- regeneration does not lose manual state without an explicit policy; and
- households report that the list is usable for a real shop.

## Beta Milestone

Stages are not valuable merely because their isolated contracts exist. The
first external beta milestone is the connected vertical defined in
[`beta-and-success.md`](beta-and-success.md): people, private interviews,
visible profiles, routines, curated and imported recipes, complete all-meal
coverage, cook and leftover allocations, shared revision and approval, shopping
list, and weekly learning.

Early implementation may use a narrow set of meal occasions, recipe scaling
rules, or routine forms to reach that vertical, provided the accepted domain
invariants remain truthful.

## Later Distribution And Fulfilment

The following are intentionally outside the staged beta roadmap:

- MCP tools, resources, tasks, and interactive apps;
- embedded or white-label retailer channels;
- licensed product, price, offer, and availability feeds;
- retailer product matching and substitutions;
- user-authorized basket creation;
- checkout or payment; and
- other organization types such as sports teams.

When revisited, these capabilities should consume the same validated household
commands and approved plan rather than create a second planning domain.

## Converting Stages To Delivery Work

After this blueprint is accepted:

1. update the live Linear Project or create the next approved product Project;
2. write one stage-level product outcome and dependency map;
3. split it into independently reviewable vertical issues;
4. classify HITL decisions before implementation;
5. preserve current issue status and blockers only in Linear; and
6. require each issue to identify the product evidence it adds, not only the
   code it changes.
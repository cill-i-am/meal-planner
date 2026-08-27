# Delivery Roadmap

## Purpose

This roadmap sequences product capabilities so each stage creates a useful,
testable tracer. It is not a calendar commitment. Active stage status and work
items live under [`../delivery`](../delivery/).

A stage may overlap another where an end-to-end tracer requires it. The order
expresses dependency and product-learning priority, not a mandate to complete
every possible feature in one layer before touching the next.

## Delivery Principles

- Complete the current authority migration before placing new canonical
  household state across competing stores.
- Prefer end-to-end household evidence over isolated infrastructure elegance.
- Build the smallest truthful capability that exercises the accepted domain.
- Keep AI behaviour behind typed product commands and deterministic invariants.
- Make the normal weekly path low-friction; users report exceptions rather than
  confirming every success.
- Delete superseded greenfield paths rather than preserving parallel models.
- Instrument each stage so it can prove or disprove its product assumption.
- Do not introduce retailer, full pantry, nutrition-goal, MCP, embedded, or broad
  scale work into the beta critical path.

## Stage 0 — Close The Current Authority Migration

### Outcome

The repository has one clear canonical authority for existing household product
state and truthful current-state documentation.

### Scope

- complete settlement and recovery, batches, and shared household D1 retirement
  from the accepted migration plan;
- preserve Better Auth D1 as the identity control plane;
- retain only explicitly approved global operational facts outside household
  authority;
- update architecture and API documentation after each cutover;
- reconcile stale product documentation with the accepted blueprint; and
- pause infrastructure-led refactoring that does not unlock a product stage.

Slice 2 evidence metadata merged in PR #188. The current migration plan names
Slice 3 settlement and recovery as the next authority cutover.

### Exit evidence

- one canonical writer for each moved fact;
- repository-wide verification required by the migration plan;
- current documentation matches production composition; and
- new product capabilities can be built directly in household authority.

## Stage 1 — Household People, Profiles, And Permissions

### Outcome

The product represents the people who eat, not only authenticated organization
members.

### Scope

- stable `HouseholdPerson` identity separate from Better Auth membership;
- adult, invited-adult, and dependant person types;
- account-to-person linking without duplication;
- dependants as managed profiles without MVP accounts;
- household-visible confirmed person profiles and versions;
- provisional profile input before invited adults complete reviews;
- broad MVP adult profile-edit permissions with audit history;
- self-confirmed versus provisional fact resolution;
- explicit safety-constraint removal confirmation; and
- private interview-session identity and transcript boundary.

### Vertical tracer

One adult creates a household, adds another adult and two dependants, enters
provisional information, links an invited adult account later, performs profile
updates from both adults, and proves audit, versioning, and cross-household
isolation.

### Explicit exclusions

No broad AI interview, dependant login, granular guardianship, consensus
permissions, weekly planning, or retailer state.

## Stage 2 — AI-Led Discovery And Repeatable Profile Review

### Outcome

Each adult can complete a private, unusually perceptive conversation that
progressively produces accurate, confirmed household-visible profile facts.
Adults can repeat that review whenever tastes or circumstances change.

### Scope

- guided but adaptive interview orchestration;
- progressive profile-card artifacts;
- proposed, inferred, provisional, and confirmed fact transitions;
- intelligent follow-up selection;
- shorter dependant profile assistance;
- conflict and uncertainty surfacing;
- transcript privacy and retention;
- explicit confirmation for safety, dietary rules, strong dislikes, and
  routines;
- visible low-weight inferred preferences;
- profile-version impact analysis for active plans;
- evaluation scenarios and quality scoring; and
- privacy-safe instrumentation.

### Vertical tracer

Two adults complete independent private reviews. Each sees and corrects a
synthesized profile during conversation. The household sees confirmed profile
facts without access to the other adult's transcript. A later repeat review
changes one ordinary preference and offers a remaining-week replan without
silently rewriting the approved week.

### Exit evidence

- important planning facts are discovered across representative households;
- high-impact assumptions require confirmation;
- profile mutation occurs only through validated commands;
- conversation quality feels specific rather than generic; and
- completion time remains compatible with the time-saving promise.

## Stage 3 — Person And Household Routine Builder

### Outcome

Recurring patterns are represented once and reused, so all-meal coverage does
not become repetitive weekly data entry.

### Scope

- configurable meal occasions with sensible defaults;
- person and household routine rules;
- exact-food and small-set routines with pin, prefer, or rotate behaviour;
- recurring cadence, favourites, pauses, and avoid state;
- intentional skips, external meals, and flexible patterns;
- location and availability context;
- equipment and preparation windows;
- multidimensional effort and weekly cooking-capacity targets;
- packed-lunch and leftover rules;
- person-specific approved fallbacks, including exact packaged products;
- substitution policies;
- AI-proposed routines and fallbacks with use-once, save, or reject choices;
- effective dates and one-off weekly exceptions;
- conflict detection and priority policy;
- plan rationale from confirmed facts; and
- visual routine editing.

### Vertical tracer

The agent builds weekday breakfast routines, office and school lunch context,
planned leftover lunches, Friday eating out, a weekend cooked breakfast, one
intentional skip, equipment-aware hands-off cooking, and a dependant packaged
fallback. A one-off school holiday changes one week without rewriting the
baseline.

### Exit evidence

- routine evaluation deterministically produces expected concrete entries;
- exceptions override without corrupting enduring routines;
- conflicts and applied rationale remain visible;
- repeated patterns substantially reduce weekly input; and
- adults understand and edit the rules the agent created.

## Stage 4 — Meal Content, Recipe Foundation, And Supply

### Outcome

The planner has trustworthy shared and household food options without forcing
every real-life meal into a fake recipe.

### Scope

- common planning abstraction for recipe, assembled, packaged, and external meal
  options;
- exact products and substitution policy;
- shared curated-catalogue authority;
- private household recipe bank;
- immutable recipe versions and ancestry;
- household forks and adaptations;
- original batch yield plus derived reference-serving projection;
- structured quantities and ingredient-specific scaling rules;
- recipe completeness gates for planning and shopping;
- multidimensional effort, equipment, portability, and leftover metadata;
- existing TikTok import integration with the canonical recipe model;
- manual recipe and assembled-meal entry;
- curated-content workflow; and
- general web-page import after the normalized model is proven.

### Vertical tracer

A household selects one curated recipe, imports one private recipe, corrects and
approves it, creates an assembled meal and an exact packaged fallback, forks one
catalogue recipe, scales one cook event without changing the recipe version, and
pins exact versions in a planning fixture.

### Exit evidence

- shared content never leaks private household recipes;
- imported uncertainty and provenance survive review;
- material edits create versions rather than rewriting history;
- scaling handles linear, discrete, bounded, package-constrained, to-taste, and
  unresolved cases; and
- admitted content is sufficient for later shopping demand.

## Stage 5 — Complete Household Planning And Prepared Output

### Outcome

The system proposes and revises one complete personalised week for every managed
person and meal occasion while presenting a simple human plan.

### Scope

- planning period and meal-requirement materialization;
- explicit coverage for every managed person-date-occasion requirement;
- shared and individual meal coverage;
- routine-derived coverage;
- external meals, intentional skips, flexible slots, and unresolved gaps;
- one strong recommended plan rather than competing whole weeks;
- cook events separate from consumption;
- finished portions and reusable prepared components;
- per-person, per-occasion serving factors;
- deliberate batch scaling and planned leftover allocation;
- incidental-surplus recording;
- lightweight fridge/freezer prepared stock;
- cross-week carry-over confirmation;
- deterministic hard-constraint and allocation validation;
- draft repair across dependent meals and preparation;
- visible person-level rationale;
- compressed visual projection; and
- revisioned adult approval.

### Vertical tracer

A full household week covers all managed meals using routines, shared meals, one
person-level exception, one packaged fallback, eating out, an intentional skip,
a flexible slot, and a cook event that produces finished portions and a prepared
component for later lunches. A draft swap repairs dependencies. An approved-plan
change produces a visible revision rather than a silent rewrite.

### Exit evidence

- every mandatory requirement is explicitly resolved before approval;
- the UI groups ordinary shared coverage while retaining person exceptions;
- hard constraints cannot be overridden by model suggestions;
- allocations cannot exceed produced portions;
- no per-meal confirmation is required on the happy path;
- plan revisions are idempotent and auditable; and
- active planning time is measured from proposal to approval.

## Stage 6 — Weekly Review And Household Learning

### Outcome

The next plan improves from real feedback without turning meals into constant
surveys.

### Scope

- optional end-of-week review;
- lightweight meal, cook, routine, quantity, and fallback signals;
- grouped exception reconciliation;
- cross-week prepared-stock confirmation;
- focused follow-up questions;
- make-again and recurring-meal behaviour;
- explicit proposed changes to profiles, routines, recipes, capacity, or
  cadence;
- reversible low-weight inferred preferences;
- transparent qualitative observations such as repetition or effort; and
- week-over-week product evidence.

### Vertical tracer

A household skips the review once without being blocked. In another week it
marks one meal liked, one too much effort, one not made, and one fallback
successful; confirms expected freezer carry-over; accepts one routine proposal;
and receives a visibly improved next week.

### Exit evidence

- feedback never silently rewrites hard facts;
- enduring changes follow explicit confirmation policy;
- later weeks require fewer corrections in representative scenarios; and
- users can explain why the product changed its proposal.

## Stage 7 — Retailer-Neutral Shopping List

### Outcome

An approved plan becomes a practical consolidated list without introducing
retailer integration risk or a pretend live pantry.

### Scope

- draft shopping preview;
- active list created only from approved-plan demand;
- demand from recipe, assembled, and packaged meal options;
- cook-event-based demand so leftovers are not double counted;
- reliable ingredient aggregation and unit normalization;
- exact-product preservation and substitution policy;
- optional one-off "already have this?" check;
- category grouping and demand provenance;
- manual add, merge, split, edit, and check behaviour;
- plan-revision shopping delta; and
- preservation of manual and purchased state.

### Vertical tracer

The approved full-week plan produces one consolidated list, combines only
reliably equivalent ingredients, includes exact fallback products, excludes
external/flexible/skip coverage, preserves manual items, and applies a visible
delta after plan revision.

### Exit evidence

- quantities trace back to approved plan demand;
- unresolved recipe quantities remain visible rather than fabricated;
- revision does not silently erase purchased or manual state; and
- beta households report that the list is usable for a real shop.

## Beta Milestone

The first external beta milestone is the connected vertical defined in
[`beta-and-success.md`](beta-and-success.md): household people, private repeated
reviews, visible profiles, routines, curated and imported food options,
complete personalised coverage, cook and leftover allocations, shared revision
and approval, shopping list, and optional weekly learning.

Early implementation may use a narrow set of meal occasions, scaling rules, or
routine forms to reach that vertical, provided accepted product decisions and
domain invariants remain truthful.

## Later Distribution And Fulfilment

The following remain outside the staged beta roadmap:

- generic planning-goal, calorie, macro, or medical optimization;
- continuous ingredient pantry inventory;
- food-safety expiry certification;
- MCP tools, resources, tasks, and interactive apps;
- embedded or white-label channels;
- licensed retailer product, price, offer, and availability feeds;
- retailer product matching and substitutions;
- user-authorized basket creation;
- checkout or payment; and
- non-household organization types.

When revisited, these capabilities should consume the same validated household
commands and approved plan rather than create a second planning domain.

## Converting Stages To Delivery Work

After the blueprint and owning decisions are accepted:

1. create or update the stage record under `docs/delivery/stages/`;
2. define its product outcome, dependency map, and vertical evidence;
3. split the stage into independently reviewable repository work items;
4. resolve product decisions and ADRs before marking a work item Ready;
5. implement through scoped pull requests; and
6. update the work item and `docs/delivery/current.md` after merge.

Use [`../delivery/work-item-template.md`](../delivery/work-item-template.md) and
keep mutable status in the repository.
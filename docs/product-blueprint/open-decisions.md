# Open Decisions

## Purpose

This document separates accepted product direction from questions that still
need explicit resolution. An implementation issue should not silently answer an
open product decision merely because one technical shape is convenient.

## Accepted Decisions

| Area | Accepted direction |
| --- | --- |
| Primary promise | Save households time and mental effort when planning food. |
| Meal scope | Cover all configured meal occasions, not dinners alone. |
| Planning model | Account for every required `person × date × meal occasion` cell, while presenting a compressed week. |
| Routines | Person and household routines, repeated meals, leftovers, eating out, and intentional skips are first-class. |
| Individualization | Shared meals may have person-level variations or low-burden fallback meals. |
| Preparation model | Cooking events are separate from meal-consumption events and may produce portions for later meals. |
| AI experience | The conversation must be unusually perceptive and impressive, while remaining efficient and accountable through visible artifacts. |
| Beta | Validate with a small invite-only external cohort. |
| Recipe supply | Use both a shared curated catalogue and private household imports/adaptations. |
| Interview privacy | Raw adult interview transcripts are private to the participant. |
| Profile visibility | Confirmed person-profile facts are visible within the household by default. |
| Feedback | Weekly recap is the primary learning loop; per-meal feedback is optional. |
| Retail | Retailer integration is deferred; beta ends at a retailer-neutral shopping list. |
| MCP and embedding | Design commands to be channel-neutral, but do not make MCP or embedded distribution a beta dependency. |
| Domain scope | Build a household product first; do not generalize to sports teams or generic organizations yet. |

## Decisions Required Before Stage 1 Completion

### Person and account permissions

- Can another household adult directly edit an adult's confirmed profile, or
  only suggest a change?
- Which adults may create, edit, archive, or link dependant profiles?
- What happens to a person's profile and planning history when they leave the
  household?
- Can one authenticated user represent more than one household person in any
  legitimate case?

Recommended starting point: adults edit their own profiles, household owners or
explicit guardians manage dependants, and other adults may suggest but not
silently overwrite an adult's profile.

### Household roles and approval

- Can any adult member approve the weekly plan?
- Is one owner approval sufficient, or may a household require consensus?
- Can dependants with future accounts rate meals or suggest preferences without
  approving plans?

Recommended starting point: any authorized adult may revise and approve, with
visible audit history; configurable consensus is deferred.

### Profile fact lifecycle

- Which facts expire or require periodic reconfirmation?
- How are contradictory guardian and person statements handled?
- Which feedback patterns are sufficient to propose a persistent profile
  change?
- Does the beta need any private confirmed profile fact, or are private
  transcripts plus household-visible facts sufficient?

Recommended starting point: no hidden private profile-fact system in beta;
introduce one only for a concrete safety, legal, or high-value use case.

## Decisions Required Before Stage 2 Completion

### Interview depth and duration

- What is the target active time for an initial adult interview?
- Which facts are required before the first plan, and which can be learned
  later?
- When should the agent defer a question rather than continue onboarding?

The answer should be tested against planning quality and abandonment rather
than chosen as an arbitrary number.

### Nutrition and health boundary

- Which user-stated goals are supported in beta: balanced variety, protein
  preference, calorie target, weight change, energy, or others?
- Which inputs count as sensitive health data and require additional consent,
  retention, or visibility treatment?
- What claims may the agent make without reviewed nutritional data?
- When must the product advise the user to seek a qualified professional?

Recommended starting point: support ordinary nutrition-aware preferences and
user-stated goals, but do not offer diagnosis, treatment, or prescribed
therapeutic diets.

### Agent quality model

- Which representative household scenarios form the initial evaluation set?
- Who reviews conversation quality and against what rubric?
- What model or provider strategy meets quality, cost, privacy, and latency
  requirements?
- How are prompt, tool, and policy versions tied to evaluation evidence?

Provider choice should follow product evaluation rather than define the domain.

## Decisions Required Before Stage 3 Completion

### Default meal occasions

- Which occasions are offered by default?
- Can occasions vary by person, weekday, or life stage?
- How are overnight shifts, brunch, or multiple snacks represented without
  creating confusing configuration?

Recommended starting point: household-configured named occasions with sensible
defaults and person-level intentional skips.

### Routine conflict policy

- How are overlapping person and household routines prioritized?
- When does a one-off exception supersede a routine?
- Should the agent auto-resolve low-impact conflicts or require confirmation?
- How are routine changes versioned and explained?

### Fallback policy

- When is a disliked shared meal strong enough to schedule a fallback?
- How many fallback meals should one person maintain?
- How does the planner balance accepted safe foods with variety goals?
- Which fallbacks may rely on pantry or freezer assumptions?

Recommended starting point: explicit accepted fallbacks, no assumed stock, and
preference for shared-component variations before unrelated second cooks.

## Decisions Required Before Stage 4 Completion

### Curated catalogue source and size

- Who authors or licenses the initial recipes?
- What rights and attribution are required?
- What is the minimum useful catalogue for the beta cohort?
- Who reviews recipe quality, scaling, and dietary metadata?
- How are catalogue corrections rolled out to households that forked older
  versions?

### Normalized food concepts and units

- Which unit system and conversion model are supported first?
- How are ambiguous household measures represented?
- Which food taxonomy or concept authority is used?
- What confidence is required before an ingredient contributes normalized
  shopping demand?

### General web-page import

- Which public sites and markup are supported initially?
- What acquisition, robots, terms, rights, size, redirect, and SSRF policies
  apply?
- Is visible-page extraction required when structured data is complete?
- How does the product handle recipes split across pages or interactive cards?

## Decisions Required Before Stage 5 Completion

### Planning priorities and scoring

- How are time, household preference, variety, cost, nutrition, waste, and
  repetition weighted?
- Which are hard constraints, household-configurable objectives, or product
  defaults?
- How much repeated food is desirable for different households?
- When should the planner return a gap instead of a lower-quality fallback?

The deterministic hard filter must be settled before any model-assisted ranking
can be trusted.

### Portion representation

- What is the beta's canonical portion unit?
- How are adult, dependant, and recipe yields compared without pretending to
  offer clinical precision?
- How are partial portions, shared sides, and buffet-style meals represented?
- How does the product record actual quantity feedback?

### Plan completeness and approval

- Does every configured snack require explicit resolution, or can households
  declare an occasion unmanaged?
- Can a user explicitly approve an incomplete plan, and if so under what
  visible policy?
- Which revisions return an approved plan to draft?

Recommended starting point: households configure managed occasions; every
managed requirement must resolve before beta approval.

### Calendar and weekly context

- Is manual exception entry sufficient for beta?
- Which external calendar or schedule integrations would later be valuable?
- How are visitors, temporary absences, and changing custody patterns modeled?

External calendar integration is not required for the first vertical.

## Decisions Required Before Stage 6 Completion

### Feedback attribution

- Who may rate a shared meal for whom?
- Can a guardian record a dependant's reaction?
- How are conflicting ratings represented?
- Which feedback remains personal versus household-visible?

### Learning policy

- How many repeated signals justify a proposed profile or routine change?
- How does recency interact with long-standing preferences?
- How are seasonal or temporary dislikes represented?
- Can users inspect and reverse learned changes?

## Decisions Required Before Stage 7 Completion

### Pantry scope

- Is pantry state a durable inventory, a weekly confirmation, or both?
- How are uncertain quantities represented?
- Which staples may be suggested but never assumed?
- How does manual shopping-list state survive regeneration?

Recommended starting point: explicit weekly confirmation and a small editable
staples list, not continuous inferred inventory.

### Shopping list ownership

- Can multiple adults check and edit concurrently?
- Does plan revision regenerate the whole list or apply a traced demand delta?
- How are manual non-food items separated from plan-derived demand?
- What sharing and offline behavior is required for the beta?

## Deferred Decisions

These questions are real but should not distract the beta critical path:

- retailer partnerships and official authorization;
- product, price, availability, and offer matching;
- own-brand versus quality ranking;
- basket creation and checkout;
- MCP tool, resource, elicitation, and task design;
- embedded and white-label channel configuration;
- public recipe contribution and marketplace policy;
- semantic recipe search infrastructure;
- sports-team or other organization products; and
- fleet-wide product read models or cross-household analytics beyond approved
  privacy-safe evidence.

## Decision Process

When resolving an item:

1. state the household problem and the user affected;
2. identify whether it changes privacy, authority, safety, or plan semantics;
3. compare the smallest viable alternatives;
4. record the accepted answer in the owning blueprint document;
5. update or create the corresponding Linear product work; and
6. avoid preserving superseded greenfield behavior unless a real compatibility
   contract has been explicitly approved.
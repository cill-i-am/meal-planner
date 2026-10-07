# PDR-0015 — Run a small beta across several weeks

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Decision and reason

The invite-only beta tests whether households do less planning work over several
weeks. It is not a scale test or one-session demonstration. Start Ireland-first
for credible content, terminology, measurement and support, without making Ireland
a domain constraint. Expand markets only when those needs can be served.

## Cohort and cadence

1. Dogfood with Cillian's household.
2. Add two or three closely supported friendly households.
3. Explicitly approve expansion to approximately six to eight participating
   households in total when new failures become informative.

These are operating bounds, not growth targets; dogfood may be reported
separately. Dates, available invitations and delivery milestones do not authorize
expansion. Recruit each household for at least four genuine weekly cycles.
Holiday, illness, suspension or no real need to plan is not a failed return.
Participants may pause or leave without completing four cycles or exposing
private conversations.

Across the cohort seek practical variation: straightforward households,
dependants/fallbacks, mixed work/school/packed-food routines, vegetarian/omnivore
coexistence, batch cooking, capacity limits, eating out and temporary changes.
Not every household must exercise every case. Compare weeks two through four
with the first usable baseline using active planning time, corrections, routine
reuse, plan use, unresolved coverage and confidence.

The beta offers no clinical/nutrition programme, sole severe-allergy or food-safety
safeguard, or unimplemented retailer fulfilment. Confirmed hard constraints still
receive deterministic protection. Recruitment states current scope, invite-only
status, four-cycle intent and withdrawal rights. Transcript/screen access is
optional, never a participation condition. PDR-0001 governs any transcript grant.
Prefer shared artifacts and participant explanation over private dialogue.

## Stage readiness gates

Block external invitations or expansion for unresolved privacy, authorization,
isolation or hard-constraint failures; invalid approved coverage/fallbacks/
dependencies/allocations; silent approved plan or shopping rewrites; failed required
deterministic tests or hard-blocking evals; normal journeys requiring developer
or out-of-band canonical-state edits; or unresolved critical incidents, including
their cause, containment and corrective action. Explanation and transparent
support are allowed, but hidden database fixes cannot manufacture success.

| Transition | Evidence required |
| --- | --- |
| Dogfood to pilot | Cillian completes at least two consecutive genuine cycles through approval and active shopping. The second exercises review/feedback and needs no critical planner correction. No normal-path developer/database intervention. Representative initial setup through first approval takes approximately 30 active minutes. |
| Pilot to six-to-eight total | Every pilot household completes at least two genuine cycles. Their latest two have no critical planner correction. Returning-week median active time is at most 10 minutes and later-cycle median burden at most 2 major corrections per plan. A majority improve in time, corrections or both; a majority would use it without helping test. Support does not manufacture usable plans every week. |

The 30-minute target prompts review rather than hiding complexity or rushing
confirmation. Explain longer cases before expansion. A mature returning household
might approach five minutes; this is an aspiration, not the first-cohort gate.
PDR-0006 separately requires complete synthetic evidence and human calibration.

## Measurement and correction severity

Critical corrections repair something that should invalidate a recommendation:
missed hard constraints, invalid coverage, missing/incompatible fallbacks,
impossible cooking/stock/portion dependencies or equivalent unsafe/invalid plans.
Major corrections repair substantive misunderstandings in routines, alternatives,
shared meals, cooking, portions or leftovers while the plan remains recoverable.
Preference-only swaps are not major failures. Preserve correction reason and
target instead of counting every edit alike.

Measure active household time separately from system/import waiting. Record
approval and abandonment reasons, valid coverage and first-proposal gaps, reported
plan use and reasons for deviations, genuine week-two/week-four return, and later
improvement. Assess discovered/missed facts, unnecessary questions, accepted or
corrected proposals, assumptions, conflicts, practical recommendations and helpful
explanations. Length or fluency alone is not success.

Use opaque correlations and minimum event categories. Never put raw transcripts,
health disclosures, ingredient free text, source URLs, recipe evidence or
credentials in analytics. Record support frequency and intervention type so
assisted completion cannot silently improve time/correction metrics.

Before expansion beyond the first cohort, review repeated useful approvals,
reduced time/corrections, routine/fallback/leftover reuse, catalogue/import gaps,
extra work from exceptions, comprehension, privacy, incidents and whether people
return because the product saves work. Thresholds may change through reviewed
evidence, never silently to justify expansion.

Public signup, later expansion thresholds, growth/paid acquisition, country
sequencing and clinical cohorts remain deferred. PDR-0016 owns support policy;
the detailed operational runbook remains separate implementation work.

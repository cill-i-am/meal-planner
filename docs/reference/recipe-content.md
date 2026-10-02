# Structured recipe content

Meal Planner uses one recipe content model for import review, the Recipe Bank,
and the recipe snapshot pinned by a meal plan. The shared Effect schemas live in
`packages/recipe-domain/src/content.ts`. An approved recipe retains the complete
confirmed content; planning no longer drops timings, yield, notes or other facts.

The design draws on the [Tinyplates recipe object](https://www.tinyplates.dev/docs/recipe-object).
We adopt structured ingredients, source-preserving text, grouped cooking steps,
explicit yield and durations, nutrition basis, source claims and media roles.
We keep household ownership, evidence grounding and explicit approval in Meal
Planner. Tinyplates is a reference, not a runtime dependency or a second store.

## Content and unknown values

Each ingredient owns its source wording, name, quantity and range, unit,
preparation, section, size, note and optional status. Identity and local names
can be unknown. Quantities and units are no longer separate positional lists.
A missing unit on a known quantity means a count, not an unknown measured unit;
an ambiguous measurement leaves the complete quantity unknown.

Instructions have consecutive step numbers and authoritative text. Their optional
section, duration, temperature, equipment, ingredient references and techniques
can enrich the cooking view. Ingredient references must resolve within the
recipe; media references must point to an existing step. There is at most one
hero image. Groups and flat display lines are derived, never separately edited.

Durations use seconds and distinguish preparation, cooking, inactive and total
time. Zero is a known duration; null is unknown. Prep and cook can overlap, so
total must bound each stated duration rather than equal their sum. Servings retain
the original yield, a positive amount, optional range and yield unit. A cookie
count is not silently interpreted as reference servings.

Nutrition retains source wording, nutrient values and units, and its basis:
per serving, per recipe or per 100 g. Import never computes nutrition from
ingredients. Dietary and allergen claims are source statements with their original
wording, not a medical assessment. No claim means unknown. A negative claim is
kept only when explicitly supported; ingredient absence is not evidence of
allergen absence or manufacturer cross-contact.

Recipe facts do not contain household suitability. The former `dietaryFit` tag
and filter are removed. The current bounded planner filters intrinsic tags only;
it does not yet implement a profile-based dietary or allergen evaluator. Source
claims must not be used to certify that a meal suits a household.

## Grounding, correction and publication

The model proposes the shared draft content shape without citations, confidence
or lifecycle authority. The trusted adapter derives source identity and per-path
citations from the admitted evidence. Nested quantities are checked against their
own ingredient wording; step durations and temperatures against their own step;
recipe durations against their labels; nutrient amounts against their named
nutrients and explicit basis. Unsupported enrichment remains unknown.

Sparse narrated recipes can still produce a review draft without complete yield,
quantities or title. Canonical ingredient identities, media and language are not
invented by the extraction adapter. The model supports these facts for explicit
review and future authoritative source acquisition.

Corrections use the same field schemas as content. Adults can clear optional
facts, remove lists and correct ingredients, steps, yield or timing through the
review form. Clearing a required field restores its approval blocker. Blockers
are recomputed from the complete current content after every answer and again at
confirmation; answering a field does not permanently waive validation.

Confirmation keeps the existing household transaction, optimistic versions,
mutation receipts and source ownership. It publishes the full confirmed recipe
and full planning snapshot together. Private evidence, transcripts and provider
metadata are excluded from the public content. Existing byte budgets and bounded
Recipe Bank pagination remain enforced.

## Scaling preview

`scaleRecipeIngredients` derives an ingredient preview from an exact confirmed
reference yield. It preserves source wording and leaves unresolved quantities
unknown. Fractional whole-item counts and unsupported package measures are surfaced
as unresolved rather than multiplied into false precision. Unknown, ranged or non-serving yields cannot establish a scaling
baseline. It never changes a recipe version, cooking times, nutrition, household
profile, shopping list or basket.

This helper provides arithmetic for a preview, not a completed cook-event or
shopping system. Ingredient-specific package, geometry and non-linear cooking
rules remain part of the [meal content plan](../plans/meal-content.md) and
[PDR-0004](../decisions/pdr-0004-meal-content-portions-recipes-and-shopping.md).
Retailer-neutral demand and household plan approval remain separate capabilities.

## Greenfield delivery

This replaces the old content contract and updates callers and synthetic fixtures
together. There is no legacy decoder, dual write, backfill or compatibility API.
The household continues to own its JSON recipe records through the existing
SQLite tables; this change does not introduce another database authority or a
cloud migration. Existing development data with the old JSON shape is outside
this contract and is not rewritten automatically.

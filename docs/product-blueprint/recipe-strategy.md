# Meal Content And Recipe Strategy

## Purpose

Meal Planner needs enough trustworthy food options to produce practical plans,
while preserving the difference between shared product content, private
household knowledge, exact packaged products, simple assembled meals, and
external meals.

The planner uses a common meal-option concept, but does not force every option
into a recipe shape.

## Meal-Option Kinds

### Recipe meal

A recipe meal has an immutable recipe version, original batch and yield,
structured ingredients, usable instructions, scaling behaviour, effort and
equipment metadata, and possible prepared output.

### Assembled meal

An assembled meal has named components and useful quantities but no meaningful
full recipe method. Examples include cereal and milk, sandwiches, toast, fruit
and yoghurt, or a burger assembled from packaged components.

An assembled meal may consume a prepared component from an earlier cook event,
such as roast chicken in a sandwich.

### Packaged meal

A packaged meal references a generic product concept or an exact household
product preference. It may include preparation notes and one of:

- exact product only;
- ask before substituting; or
- similar products acceptable.

A particular frozen pizza may be an ordinary routine meal, a person-specific
fallback, or both.

### External meal

An external meal represents takeaway, restaurant, school meal, work canteen, or
another opaque food event. It covers one or more meal requirements without
pretending the product knows ingredients, quantities, or nutrition. It normally
contributes no shopping demand.

## Two Recipe Authorities

The product has two recipe domains:

1. a shared curated catalogue; and
2. a private household recipe bank.

They may share normalization and planning contracts, but they do not share
visibility or authority by accident.

## Shared Curated Catalogue

The curated catalogue contains recipes deliberately selected, reviewed, and
made available to beta households. It should prioritize planning usefulness and
quality over raw volume.

A catalogue recipe should have:

- stable recipe and immutable version identity;
- clear source, rights, and attribution provenance;
- reviewed ingredients and instructions;
- confirmed base yield;
- enough structured quantity data to support shopping;
- reviewed scaling behaviour where applicable;
- planning metadata for occasion, effort, equipment, portability, and leftover
  use;
- suitability metadata without unsupported health claims;
- lifecycle state for draft, reviewed, active, or retired content; and
- audit history for material correction.

The exact initial source, licence, size, and curation workflow remain open
product decisions. A smaller reliable catalogue is more useful than a large
weakly normalized bank.

The shared catalogue requires an explicit authority separate from private
household objects. It must not be built by copying or projecting private
household recipes into a global product store.

## Private Household Content

A household recipe may originate from:

- an intentional user-supplied import;
- manual entry;
- a saved or adapted catalogue recipe;
- a household-created fork; or
- a future supported capture source.

A household may also create assembled meals and packaged meal options without
inventing recipe instructions.

Household content is private by default. Importing or adapting content does not
automatically contribute it to the shared catalogue.

A future contribution flow would require explicit submission, provenance and
rights checks, review, and a new catalogue identity. It is outside the beta.

## Recipe And Version Identity

A recipe is a stable concept. A `RecipeVersion` is an immutable snapshot used by
planning and history.

A new version is created when a material change affects:

- ingredients or quantities;
- instructions;
- original yield or reviewed scaling behaviour;
- suitability;
- expected effort, equipment, or time;
- planning metadata; or
- shopping demand.

An approved plan pins the exact version it used. Editing a household recipe must
not rewrite an active or historical plan.

## Forks And Household Adaptations

Changing a shared catalogue recipe creates a private household fork with
recorded ancestry. The catalogue entry remains unchanged.

Ordinary changes to an existing household recipe create a new version of that
recipe. An adult explicitly chooses **save as a separate recipe** for a
materially different dish.

Examples include:

- reducing spice;
- substituting turkey mince;
- changing an ingredient for a household constraint;
- doubling sauce;
- altering the method for available equipment; or
- creating a person-compatible variation.

Ancestry supports attribution and explanation without forcing later catalogue
changes into household versions.

## Original Batch And Reference Serving

The original recipe batch and stated yield remain authoritative. Where scaling
is meaningful, the system derives a reference-serving projection for planning.
The derived projection does not replace the original recipe.

For example:

```text
Original batch: serves 4
500 g mince
1 onion
2 eggs
1 tin tomatoes
salt to taste
```

may derive planning values such as:

```text
mince: 125 g per reference serving — linear
onion: 0.25 per serving — discrete
Eggs: 0.5 per serving — discrete
tomatoes: 0.25 tin per serving — package constrained
salt: unresolved numeric scaling — to taste
```

A lasagne tray, loaf, cake, slow-cooker batch, or recipe with equipment geometry
may have a supported yield range or minimum practical batch. The planner may
recommend producing eight portions rather than forcing exactly seven.

## Plan-Specific Scaling

Scaling from four to seven serving-equivalents for one week is cook-event state,
not a new recipe version.

The plan pins the recipe version, records intended yield, and derives proposed
quantities using ingredient-specific scaling rules:

- linear;
- discrete;
- bounded;
- package constrained;
- to taste; or
- non-scalable.

Ambiguous whole items, tins, package sizes, tray geometry, and cooking-time
changes are surfaced rather than blindly multiplied. Missing quantities or
yield are never invented.

An adult may explicitly save a confirmed scaling adaptation back into the
household recipe as a new version.

## Recipe Completeness

A recipe may remain saved as a draft or review item while incomplete. To drive
reliable planning, scaling, and shopping it needs:

- a confirmed base yield;
- usable instructions; and
- confirmed quantities for ingredients that materially affect shopping.

Values such as salt to taste, optional garnish, or an unresolved exact brand may
remain open when they do not prevent truthful planning. A missing primary
ingredient quantity cannot.

## Normalized Ingredients

Free-text ingredient lines remain valuable evidence and display content, but
they are not sufficient for scaling or shopping demand.

A normalized ingredient should preserve both source text and structured
interpretation, for example:

```ts
interface RecipeIngredient {
  readonly rawText: string
  readonly foodConceptId: FoodConceptId | null
  readonly quantity: Quantity | QuantityRange | null
  readonly unit: Unit | null
  readonly preparation: string | null
  readonly optional: boolean
  readonly scalingRule: ScalingRule
  readonly evidence: readonly EvidenceReference[]
  readonly confidence: number
}
```

The internal model preserves unresolved quantity, unit, food-concept mapping,
and scaling uncertainty rather than manufacturing precision.

Food taxonomy, unit systems, and exact-product identity before retailer
integration remain open decisions.

## Effort And Planning Metadata

Useful reviewed metadata includes:

- meal occasions;
- hands-on and elapsed time;
- attention, cleanup, coordination, and advance-start requirements;
- equipment;
- batch, prepared-component, and leftover suitability;
- portability;
- relevant substitution or fallback use;
- suitability and allergen facts;
- portion type and original yield; and
- ingredient overlap or use-up opportunities.

Friendly labels such as quick or hands-off are derived summaries. Provider or
model labels do not bypass review.

## Import Source Adapters

The existing TikTok pipeline is the first acquisition adapter, not the complete
content domain. Source descriptors remain extensible, for example:

```ts
type RecipeSourceDescriptor =
  | { readonly kind: "tiktok"; readonly url: SourceUrl }
  | { readonly kind: "web_page"; readonly url: SourceUrl }
  | { readonly kind: "manual" }
```

Source-specific acquisition occurs before one evidence-grounded draft and
review flow.

### TikTok

The adapter may acquire public video or carousel evidence, transcribe speech,
extract visible information, and produce a reviewable draft. Unsupported,
private, or unavailable media fails truthfully.

### Recipe web page

A future adapter should:

1. fetch through a restricted acquisition boundary with redirect, size, MIME,
   and SSRF protections;
2. prefer structured recipe markup when present;
3. preserve structured and relevant visible-page evidence;
4. use model extraction only against captured evidence;
5. expose unresolved or conflicting fields; and
6. enter the same review and version-publication flow.

Supported sites, rights, robots, and acquisition policy remain open decisions.

### Manual content

Manual entry creates explicit user-authored content without pretending source
evidence exists. It may create a full recipe, assembled meal, or packaged meal
option.

## Evidence, Review, And Publication

Every imported recipe begins as a draft. Evidence-grounded fields retain
citations, confidence, origin, and unresolved state. A reviewer may correct
facts while preserving the distinction between extracted and corrected values.

Only admitted reviewed recipe versions may enter meal-plan generation. Shared
catalogue publication is a separate future capability from household approval.

## Search And Discovery

Beta discovery should support practical filtering before advanced semantic
recommendation. Useful dimensions include:

- meal occasion;
- hard suitability;
- effort and preparation window;
- equipment;
- cuisine and ordinary preference;
- batch and leftover suitability;
- portability;
- meal-option kind; and
- household history and cadence.

Semantic search may later provide a rebuildable derived index. It must not
become recipe authority or replace structured hard-constraint filtering.

## Initial Beta Boundary

The beta content system should prove:

- curated catalogue recipes can be planned and scaled reliably;
- household imports pass through truthful review;
- a household can create assembled and packaged options;
- a household can fork and version a recipe;
- plans pin immutable content versions;
- one cook event can create finished portions and explicit prepared components;
- the planner can select across catalogue and household content; and
- approved plans derive consolidated shopping demand.

A public marketplace, retailer product mapping, autonomous catalogue
publication, logged-in arbitrary source acquisition, and continuous pantry are
out of scope.
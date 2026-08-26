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
visibility or authority by accident. The durable authority split is accepted in
[ADR-0005](../architecture/decisions/0005-separate-shared-catalogue-from-household-recipe-authority.md).

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

The initial target is roughly `100–200` active, high-quality recipes and meal
options. It is a directional starting point rather than a permanent maximum or
an invented hard beta gate. A smaller reliable catalogue is more useful than a
large weakly normalized bank.

The shared catalogue has an explicit authority separate from private household
objects. It is never built by copying or projecting private household recipes
into a global product store.

### Bulk candidate acquisition

The initial catalogue may be bootstrapped through operator-managed bulk recipe
ingestion. The expected first flow is:

1. collect a larger batch of promising TikTok links;
2. submit them through the existing import pipeline;
3. retain the successful extractions as private catalogue candidates;
4. reject duplicates, incomplete recipes, unreliable extractions, and content
   that adds little planning value;
5. review and normalize the useful candidates; and
6. explicitly publish the accepted immutable versions.

Processing several hundred candidate links to obtain roughly `100–200`
publishable recipes is acceptable. Bulk extraction success never implies shared
publication.

The candidate model is source-neutral so later web-page or manual operator input
can use the same curation and publication boundary.

### Curation and publication

Before publication, the curator reviews the facts that make a recipe useful for
planning, including where applicable:

- source and attribution provenance;
- the rights or permission basis required by the accepted publication policy;
- ingredients, quantities, instructions, and base yield;
- scaling behaviour and unresolved quantities;
- effort, equipment, preparation windows, portability, and leftover use;
- suitability and dietary metadata without unsupported health claims;
- shopping-demand completeness; and
- whether the recipe adds useful coverage rather than duplicating the active
  catalogue.

Cillian is the sole shared-catalogue curator and publication authority for the
MVP. Only that operator authority may publish, correct, activate, retire, or
restore shared catalogue versions.

A small authenticated admin UI may support candidate review and publication.
The UI is a client of typed, audited catalogue commands; it is not itself the
authority.

See
[PDR-0009](../decisions/product/0009-shared-catalogue-acquisition-curation-and-publication.md)
for the accepted governance policy. The exact rights and attribution policy for
each source class remains a separate decision before external beta publication.

## Private Household Content

A household recipe may originate from:

- an intentional user-supplied import;
- manual entry;
- a saved or adapted catalogue recipe;
- a household-created fork; or
- a future supported capture source.

A household may also create assembled meals and packaged meal options without
inventing recipe instructions.

Household content is private by default. Importing, reviewing, approving, or
adapting content does not contribute it to the shared catalogue.

Ordinary household adults cannot publish globally in the MVP. A future
contribution flow would require explicit submission, provenance and rights
checks, curation, and a new catalogue identity. It is outside the beta.

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
changes into household versions. How a household is notified of or adopts a
later catalogue correction remains a separate product decision.

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
eggs: 0.5 per serving — discrete
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

Only admitted reviewed recipe versions may enter meal-plan generation.
Household approval publishes only to that household's private bank. Shared
catalogue publication is a separate operator-only command with its own audit,
rights, curation, and lifecycle policy.

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

- an operator can bulk-ingest source links into private catalogue candidates;
- only explicitly reviewed and published candidates become shared catalogue
  versions;
- roughly `100–200` reliable shared options provide useful planning coverage;
- household imports remain private and pass through truthful review;
- a household can create assembled and packaged options;
- a household can fork and version a recipe;
- plans pin immutable content versions;
- one cook event can create finished portions and explicit prepared components;
- the planner can select across catalogue and household content; and
- approved plans derive consolidated shopping demand.

A public marketplace, ordinary-household catalogue publication, retailer product
mapping, autonomous catalogue publication, logged-in arbitrary source
acquisition, and continuous pantry are out of scope.
# Meal Content And Recipe Strategy

## Purpose

Meal Planner needs enough trustworthy food options to produce practical plans,
while preserving the difference between shared product content, private
household knowledge, exact packaged products, simple assembled meals, and
external meals.

The planner uses a common meal-option concept, but does not force every option
into a recipe shape. Accepted product detail lives in
[`../decisions/product`](../decisions/product/), while durable authority
boundaries live in [`../architecture/decisions`](../architecture/decisions/).

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
visibility or authority by accident. The durable split is accepted in
[ADR-0005](../architecture/decisions/0005-separate-shared-catalogue-from-household-recipe-authority.md).

## Shared Curated Catalogue

The catalogue contains recipes deliberately selected, reviewed, and made
available to beta households. It prioritizes planning usefulness and quality
over raw volume.

A catalogue recipe should have:

- stable recipe and immutable version identity;
- retained source URL and available creator or publisher attribution;
- reviewed ingredients and instructions;
- confirmed base yield;
- enough structured quantity data to support shopping;
- reviewed scaling behaviour where applicable;
- planning metadata for occasion, effort, equipment, portability, and leftover
  use;
- suitability metadata without unsupported health claims;
- lifecycle state for candidate, reviewed, active, retired, or rejected; and
- audit history for material correction.

The initial target is roughly `100–200` active, high-quality recipes and meal
options. It is a directional starting point rather than a permanent maximum or
an invented hard beta gate. A smaller reliable catalogue is more useful than a
large weakly normalized bank.

### Bulk candidate acquisition

The initial catalogue may be bootstrapped through operator-managed bulk recipe
ingestion:

1. collect a larger batch of promising TikTok links;
2. submit them through the existing import pipeline;
3. retain successful extractions as private catalogue candidates;
4. reject duplicates, incomplete recipes, unreliable extractions, and content
   that adds little planning value;
5. review and normalize the useful candidates; and
6. explicitly publish accepted immutable versions.

Processing several hundred candidates to obtain roughly `100–200` publishable
recipes is acceptable. Extraction success never implies shared publication.
The candidate model remains source-neutral so future web-page or manual operator
input can use the same curation boundary.

### Curation and publication

Before publication, the curator reviews the facts that make a recipe useful for
planning, including where applicable:

- source URL and available creator or publisher attribution;
- ingredients, quantities, instructions, and base yield;
- scaling behaviour and unresolved quantities;
- effort, equipment, preparation windows, portability, and leftover use;
- suitability and dietary metadata without unsupported health claims;
- shopping-demand completeness;
- compliance with the current documented publication policy; and
- whether the recipe adds useful coverage rather than duplicating the active
  catalogue.

Cillian is the sole shared-catalogue curator and publication authority for the
MVP. A small authenticated admin UI may support review and publication, but it
remains a client of typed, audited catalogue commands.

The catalogue publishes Meal Planner's normalized, curator-reviewed recipe
record. It does not republish the creator's original video, audio, screenshots,
photographs, transcript, caption, or copied prose as catalogue content. The MVP
retains source and attribution metadata but does not introduce per-recipe licence
workflows, creator-outreach queues, or a detailed rights taxonomy.

Before the shared catalogue opens to the external beta, the overall publication
policy receives one focused review. The catalogue supports retirement or
takedown without rewriting historical plans.

See
[PDR-0009](../decisions/product/0009-shared-catalogue-acquisition-curation-and-publication.md)
for the accepted governance and version-adoption policy.

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
adapting content does not contribute it to the shared catalogue. Ordinary
household adults cannot publish globally in the MVP.

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

### Catalogue corrections and household adoption

A catalogue correction creates a new immutable version under the same stable
catalogue recipe identity.

- Existing approved and historical plans remain pinned to their original
  versions.
- An unforked catalogue reference uses the latest active version for future
  planning by default.
- A household may preserve an older version by forking it into its private bank.
- Existing household forks never change automatically.
- The product may show a readable catalogue diff.
- Selective adoption creates a new immutable household version.
- Retirement affects future selection, not historical plans or existing forks.

### Forks and household adaptations

Changing a catalogue recipe creates a private household fork with ancestry to
the exact source version. Ordinary edits to an existing household recipe create
a new version. A materially different dish is an explicit **save as a separate
recipe** action.

Ancestry supports attribution, update notification, and selective adoption
without forcing later catalogue changes into household versions.

## Food Concepts And Exact Products

Meal Planner owns a small food-concept registry grown from reviewed content and
real planning needs. The accepted semantic and authority boundaries are in
[PDR-0010](../decisions/product/0010-food-concepts-exact-products-and-retailer-preferences.md)
and
[ADR-0006](../architecture/decisions/0006-separate-food-concepts-products-and-retailer-listings.md).

### Food concept

A `FoodConcept` is the stable generic identity used by recipes, preferences,
search, and retailer-neutral shopping demand. It has an ordinary display name
and reviewed aliases.

Aliases do not collapse materially different foods or forms. Fresh tomatoes,
chopped tomatoes, passata, and tomato purée remain separate when their cooking
or shopping behaviour differs. Unknown or ambiguous ingredients remain
unmapped.

### Exact product

A `ProductIdentity` represents one exact marketed or packaged product. Where
meaningful, it links to one primary food concept and preserves brand, product
name, pack, form, and relevant attributes.

For example:

```text
Food concept: ribeye steak

Exact product:
  Tesco 28-Day Dry-Aged Angus Ribeye Steak, 227 g
  primary concept: ribeye steak
  attributes: dry-aged, Angus, 28-day matured
```

The product is not merely an alias of `ribeye steak`; it is classified under
that concept. Composite packaged meals such as frozen lasagne remain packaged
meal options rather than being reduced to one misleading ingredient concept.

### Preferences and future retailer resolution

A person or household may prefer or exclude a concept, brand, exact product, or
product attribute. A preference may also be scoped to a retailer in a future
fulfilment capability.

Examples include:

```text
Demand: butter
Cross-retailer preference: Kerrygold
Exclusion: Tesco own-brand butter
```

```text
Demand: ribeye steak
At Tesco: prefer Tesco 28-Day Dry-Aged Angus Ribeye
At SuperValu: prefer the configured SuperValu ribeye
Substitution: ask before choosing another product
```

Recipes and ordinary planning remain concept-level unless an exact product or
attribute rule is pinned. Future retailer listings, SKUs, prices, promotions,
and availability remain separate integration state rather than stable recipe or
food identity.

The MVP creates only the concepts and product references needed by reviewed
catalogue recipes, household content, fallbacks, and shopping lists. It does not
preload a comprehensive food or retail-product taxonomy.

## Original Batch And Reference Serving

The original recipe batch and stated yield remain authoritative. Where scaling
is meaningful, the system derives a reference-serving projection for planning.
The projection does not replace the original recipe.

For example:

```text
Original batch: serves 4
500 g mince
1 onion
2 eggs
1 tin tomatoes
salt to taste
```

may derive:

```text
mince: 125 g per reference serving — linear
onion: 0.25 per serving — discrete
eggs: 0.5 per serving — discrete
tomatoes: 0.25 tin per serving — package constrained
salt: unresolved numeric scaling — to taste
```

A lasagne tray, loaf, cake, slow-cooker batch, or geometry-sensitive recipe may
have a supported yield range or minimum practical batch. The planner may
recommend eight portions rather than forcing exactly seven.

## Plan-Specific Scaling

Scaling from four to seven serving-equivalents for one week is cook-event state,
not a new recipe version.

The plan pins the version, records intended yield, and derives quantities using
ingredient-specific scaling rules:

- linear;
- discrete;
- bounded;
- package constrained;
- to taste; or
- non-scalable.

Ambiguous whole items, tins, package sizes, tray geometry, and cooking-time
changes are surfaced rather than blindly multiplied. Missing quantities or
yield are never invented. An adult may save a confirmed adaptation as a new
household recipe version.

## Recipe Completeness

A recipe may remain saved as a draft or review item while incomplete. To drive
reliable planning, scaling, and shopping it needs:

- a confirmed base yield;
- usable instructions; and
- confirmed quantities for ingredients that materially affect shopping.

Salt to taste, optional garnish, or an unresolved exact brand may remain open
when they do not prevent truthful planning. A missing primary ingredient
quantity cannot.

## Normalized Ingredients

Free-text ingredient lines remain valuable evidence and display content, but
they are not sufficient for scaling or shopping demand.

A normalized ingredient preserves both source text and structured
interpretation, directionally:

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

The model preserves unresolved quantity, unit, concept mapping, and scaling
uncertainty rather than manufacturing precision.

## Units And Measurement

Meal Planner is metric-first wherever a quantity can be represented truthfully.
Preferred normalized units include:

- grams and kilograms;
- millilitres and litres;
- Celsius;
- teaspoons and tablespoons; and
- item, discrete-unit, or package counts.

Every imported or manually entered measurement preserves its original value and
unit. A normalized metric value may be stored and displayed alongside it only
when a reviewed conversion is reliable for the ingredient and form.

The product does not force conversion merely to make the database look tidy.
Cups of chopped ingredients, handfuls, bunches, large items, loosely packed
volumes, and other context-sensitive measures remain in source form when a
conversion would invent precision.

Uncertain conversion has explicit consequences:

- the recipe may remain saved and reviewed;
- the source line remains usable for cooking;
- scaling or aggregation that depends on the conversion remains unresolved; and
- shopping keeps uncertain demand separate rather than guessing.

Packaged and discrete products use item or pack counts where appropriate.

## Effort And Planning Metadata

Useful reviewed metadata includes:

- meal occasions;
- hands-on and elapsed time;
- attention, cleanup, coordination, and advance-start requirements;
- equipment;
- batch, component, and leftover suitability;
- portability;
- relevant substitution or fallback use;
- suitability and allergen facts;
- portion type and original yield; and
- ingredient overlap or use-up opportunities.

Friendly labels such as quick or hands-off are derived summaries. Provider or
model labels do not bypass review.

## Import Source Adapters

The existing TikTok pipeline is the first acquisition adapter, not the complete
content domain. Source descriptors remain extensible:

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
private, or unavailable media fails truthfully. Source URL and reliably
available creator attribution remain attached.

### Recipe web page

A future adapter should:

1. fetch through a restricted acquisition boundary with redirect, size, MIME,
   and SSRF protections;
2. prefer structured recipe markup when present;
3. preserve structured and relevant visible-page evidence;
4. use model extraction only against captured evidence;
5. expose unresolved or conflicting fields; and
6. enter the same review and publication flow.

Supported sites, robots, and acquisition policy remain open decisions.

### Manual content

Manual entry creates explicit user-authored content without pretending source
evidence exists. It may create a recipe, assembled meal, or packaged meal.

## Evidence, Review, And Publication

Every imported recipe begins as a draft. Evidence-grounded fields retain
citations, confidence, origin, and unresolved state. A reviewer may correct
facts while preserving the distinction between extracted and corrected values.

Only admitted reviewed versions may enter meal-plan generation. Household
approval publishes only to that household's private bank. Shared catalogue
publication is a separate operator-only command with its own audit, curation,
attribution, and lifecycle policy.

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
- source URL and available creator attribution survive processing;
- only explicitly reviewed and published candidates become shared versions;
- roughly `100–200` reliable shared options provide useful planning coverage;
- household imports remain private and pass through truthful review;
- source measurements survive normalization and reliable metric conversion;
- reviewed food concepts normalize useful aliases without forced mappings;
- exact products remain linked to concepts without losing brand or substitution
  rules;
- a household can create assembled and packaged options;
- a household can fork and version a recipe;
- plans pin immutable content versions;
- catalogue corrections affect future unforked use without rewriting plans or
  household forks;
- one cook event can create finished portions and explicit prepared components;
- the planner can select across catalogue and household content; and
- approved plans derive consolidated retailer-neutral shopping demand.

A public marketplace, ordinary-household catalogue publication, live retailer
listings, price or offer matching, autonomous publication, original third-party
media republication, logged-in arbitrary source acquisition, and continuous
pantry are out of scope.

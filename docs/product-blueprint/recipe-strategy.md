# Recipe Strategy

## Purpose

Meal Planner needs enough trustworthy recipe supply to produce practical plans,
while preserving the difference between shared product content and private
household knowledge.

The product therefore has two recipe domains:

1. a shared curated catalogue; and
2. a private household recipe bank.

They may share normalization contracts and planning concepts, but they do not
share authority or visibility by accident.

## Shared Curated Catalogue

The curated catalogue contains recipes deliberately selected, reviewed, and
made available to beta households. It should prioritize planning usefulness and
quality over raw volume.

A catalogue recipe should have:

- stable recipe and version identity;
- clear source and rights provenance;
- reviewed ingredients and instructions;
- yield and scaling information where supported;
- planning tags and constraint metadata;
- enough structured quantity data to derive shopping demand;
- lifecycle state for draft, reviewed, active, or retired content; and
- audit history for material corrections.

The initial catalogue may be manually curated. The exact size, content source,
and curation workflow remain open decisions. A large weakly normalized bank is
not automatically more valuable than a smaller bank that plans and scales
reliably.

The shared catalogue requires its own explicit product and architecture
authority. It must not be built by copying or projecting private household
recipes into a global read model.

## Private Household Recipe Bank

A household recipe may originate from:

- an intentional user-supplied import;
- a manual recipe;
- a saved catalogue recipe;
- a household adaptation or fork; or
- a future supported capture source.

Household recipes are private by default. Importing or adapting a recipe does
not automatically contribute it to the shared catalogue.

A future contribution flow would require an explicit submission, provenance and
rights checks, content review, and a new catalogue identity. It is outside the
initial beta.

## Recipe And Version Identity

A recipe is a stable concept. A `RecipeVersion` is an immutable snapshot used by
planning and history.

A new version is created when a material change affects:

- ingredients or quantities;
- instructions;
- yield or scaling behavior;
- safety or dietary suitability;
- expected effort or time;
- planning tags; or
- shopping demand.

An approved plan pins the exact version it used. Editing a household recipe must
not rewrite an active or historical plan.

## Forks And Household Adaptations

When a household changes a catalogue or imported recipe, the result becomes a
household-owned fork or version with recorded ancestry:

```ts
interface RecipeForkProvenance {
  readonly forkedFromRecipeId: RecipeId
  readonly forkedFromVersionId: RecipeVersionId
}
```

Examples include:

- reducing spice;
- substituting turkey mince;
- changing an ingredient for one household constraint;
- doubling sauce;
- altering the method for available equipment; or
- introducing a child-compatible variation.

Ancestry supports attribution and explanation without forcing later catalogue
changes into the household version.

## Normalized Ingredient Model

Free-text ingredient lines remain valuable evidence and display content, but
they are not sufficient for scaling, leftovers, or shopping demand.

A normalized ingredient should preserve both the source line and structured
interpretation:

```ts
interface RecipeIngredient {
  readonly rawText: string
  readonly foodConceptId: FoodConceptId | null
  readonly quantity: Quantity | QuantityRange | null
  readonly unit: Unit | null
  readonly preparation: string | null
  readonly optional: boolean
  readonly scalingRule:
    | "linear"
    | "discrete"
    | "bounded"
    | "package_constrained"
    | "to_taste"
    | "non_scalable"
  readonly evidence: readonly EvidenceReference[]
  readonly confidence: number
}
```

The internal model should preserve unresolved quantity, unit, or food-concept
mapping rather than manufacture precision.

## Scaling

Recipe scaling is a reviewed domain operation, not a blanket multiplication of
all numbers.

Examples of different behavior include:

- liquids and many bulk ingredients scaling linearly;
- eggs and tins requiring discrete counts;
- salt, chilli, and seasoning scaling within bounds or to taste;
- whole poultry or package sizes constraining available quantities;
- baking-tin geometry affecting yield and cooking time; and
- cooking time remaining unchanged, changing nonlinearly, or requiring review.

The system may propose an inferred scaling rule or quantity, but inferred values
must remain distinguishable and reviewable. Missing yield, quantity, timing, or
nutrition is not silently promoted to fact.

## Recipe Planning Metadata

The current coarse planning tags are a useful baseline, but the full planner may
need reviewed metadata for:

- meal occasions;
- cuisine;
- difficulty and active effort;
- total time and unattended time;
- equipment;
- batch and leftover suitability;
- freezer and reheating suitability;
- portability;
- child variation options;
- dietary and allergen compatibility;
- portion type and yield; and
- ingredient overlap or use-up opportunities.

These values should be derived from reviewed recipe facts or explicit curator
judgment. Provider-generated labels do not bypass review.

## Import Source Adapters

The existing TikTok pipeline is the first acquisition adapter, not the complete
recipe domain. The public source contract should remain extensible, for example:

```ts
type RecipeSourceDescriptor =
  | { readonly kind: "tiktok"; readonly url: SourceUrl }
  | { readonly kind: "web_page"; readonly url: SourceUrl }
  | { readonly kind: "manual" }
```

Source-specific work occurs before a common evidence-grounded draft and review
flow.

### TikTok

The adapter may acquire public video or carousel evidence, transcribe speech,
extract visible information, and produce a reviewable draft. Unsupported,
private, or unavailable media must fail truthfully.

### Recipe web page

A web-page adapter should:

1. fetch through a restricted acquisition boundary with redirect, size, MIME,
   and SSRF protections;
2. prefer structured recipe markup when present;
3. preserve visible-page and structured evidence;
4. use model extraction only against captured evidence;
5. expose unresolved or conflicting fields; and
6. enter the same review and version-publication flow as other sources.

### Manual recipe

A manual flow should create an explicit user-authored draft without pretending
that source evidence exists. It should still support review, versioning,
structured ingredients, and planning metadata.

## Evidence, Review, And Publication

Every imported recipe begins as a draft. Evidence-grounded fields retain
citations, confidence, origin, and unresolved state. A reviewer may correct
facts while preserving the distinction between extracted and corrected values.

Only an admitted reviewed recipe version may enter:

- the household recipe bank;
- the shared catalogue; or
- meal-plan generation.

Shared-catalogue publication is a separate future capability from household
approval.

## Search And Discovery

Beta discovery should support practical filtering and selection before advanced
semantic recommendation. Useful dimensions include:

- meal occasion;
- hard dietary fit;
- active and total time;
- difficulty;
- cuisine;
- batch and leftover suitability;
- portability;
- equipment; and
- household history.

Semantic search or embeddings may later provide a rebuildable derived index.
They must not become recipe authority or replace structured hard-constraint
filtering.

## Initial Beta Boundary

The beta recipe system should prove:

- curated catalogue recipes can be planned and scaled reliably;
- household imports pass through truthful review;
- a household can fork and adapt a recipe;
- plans pin immutable versions;
- the planner can select between catalogue and household recipes; and
- approved plans derive consolidated ingredient demand.

A public marketplace, retailer product mapping, autonomous catalogue
publication, and arbitrary logged-in source acquisition are out of scope.
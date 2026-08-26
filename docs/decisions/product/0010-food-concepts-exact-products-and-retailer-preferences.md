# PDR-0010 — Food Concepts, Exact Products, And Retailer Preferences

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Context

Meal Planner needs to understand both generic food demand and exact products.
A recipe may require `ribeye steak`, while one household may prefer a specific
Tesco dry-aged ribeye. Another household may accept any suitable ribeye, and a
future retailer integration may need to choose different preferred products at
Tesco and SuperValu.

Treating every branded product as unrelated text would prevent useful planning,
shopping aggregation, substitutions, and cross-retailer choice. Treating an
exact product as merely an alias of a generic food concept would erase brand,
pack, quality, retailer, and substitution preferences.

## Decision

### Meal Planner-owned food concepts

- Meal Planner maintains a small application-owned food-concept registry grown
  from reviewed recipes and real planning needs.
- A `FoodConcept` has a stable identity, an ordinary display name, and reviewed
  aliases used to normalize imported wording.
- Concepts remain distinct where the difference materially changes cooking,
  shopping, suitability, or substitution. For example, fresh tomatoes, chopped
  tomatoes, passata, and tomato purée are not collapsed into one concept.
- Unknown or ambiguous ingredients remain unmapped rather than being forced to
  the nearest guess.
- External taxonomies may enrich or cross-reference the registry later, but do
  not become Meal Planner's domain authority.

### Mapping, aliases, and aggregation confidence

- A source ingredient maps automatically when its normalized wording matches a
  reviewed alias or another deterministic mapping already admitted into the
  relevant concept registry.
- The original source wording remains attached to the recipe or shopping demand
  even after a concept mapping is available.
- A new model-inferred or similarity-based mapping is a visible proposal, not
  authoritative identity. Model confidence alone cannot make it global or cause
  shopping lines to merge.
- Ambiguous ingredients remain unmapped and separate. The product prefers two
  honest shopping lines over one confidently wrong aggregation.
- Form and preparation matter. A mapping must not collapse materially different
  concepts such as fresh tomatoes, chopped tomatoes, passata, and tomato purée.
- A household adult may confirm or correct a mapping for that household. The
  correction takes effect immediately for household recipes, planning, and
  shopping demand and records actor, source, and audit history.
- A household correction does not automatically become a global alias.
- In the MVP, only Cillian may promote a reviewed correction or new alias into
  the shared application registry used by all households.
- Shopping demand aggregates automatically only when the concept mapping is
  authoritative through a reviewed global alias, an explicitly curated mapping,
  a household-confirmed mapping within that household, or a reviewed exact
  product-to-concept classification.
- Numeric confidence may be retained as evidence or telemetry, but authority is
  determined by mapping provenance and confirmation state rather than an
  arbitrary probability threshold.
- Changes to the shared alias registry affect future normalization. They do not
  silently rewrite pinned historical recipe versions, approved plans, or their
  recorded source wording.

### Exact products remain distinct but classified

- An exact branded or packaged product is a distinct `ProductIdentity`, not a
  food-concept alias.
- Where meaningful, the product links to one primary food concept.
- Product identity may preserve brand, product name, pack quantity, form, and
  relevant attributes such as dry-aged, Angus, salted, unsalted, or organic.
- Marketing attributes do not automatically become separate food concepts. A
  more specific concept is created only when the distinction materially affects
  planning, suitability, or substitution.
- Composite packaged meals such as frozen lasagne or ready-made curry remain
  packaged meal options rather than being reduced to one misleading ingredient
  concept.

Example:

```text
Food concept: ribeye steak

Exact product:
  Tesco 28-Day Dry-Aged Angus Ribeye Steak, 227 g
  primary concept: ribeye steak
  attributes: dry-aged, Angus, 28-day matured
```

### Preference and exclusion scope

A person or household may express preferences and exclusions at several levels:

- food concept, such as preferring or avoiding ribeye steak;
- brand, such as preferring Kerrygold butter;
- exact product, such as requiring one named packaged item;
- product attributes, such as requiring dry-aged steak; and
- future retailer context, such as preferring one product at Tesco and another
  at SuperValu.

A preference may use one of the accepted substitution policies:

- exact product only;
- ask before substituting; or
- similar products acceptable.

An exclusion can reject a concept, brand, product, or attribute combination.
The planner does not overgeneralize a product preference into an unrelated food
preference or silently weaken an exact-only rule.

### Shopping demand and future retailer resolution

- Recipes and ordinary planning produce demand at food-concept level wherever
  possible.
- A person, household, meal, or routine may optionally pin an exact product or
  require product attributes.
- Before retailer integration, exact products may be recorded manually by name,
  brand, pack, and optional retailer context and may appear directly on the
  retailer-neutral shopping list.
- Future retailer adapters may map a food concept or exact product to one or more
  retailer listings.
- Retailer listing, SKU, price, promotion, availability, and delivery state are
  separate from food-concept and product identity. They are not the stable food
  identity.
- A future shopping agent may resolve one generic demand differently by retailer
  while applying the household's retailer-scoped preferences and exclusions.

Examples:

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

### MVP boundary

- The MVP builds only the food concepts and exact product references needed by
  reviewed catalogue recipes, household recipes, assembled meals, packaged
  meals, fallbacks, and shopping lists.
- It does not attempt to preload a comprehensive food or retail-product
  taxonomy.
- It does not require live retailer catalogues, SKUs, prices, promotions, or
  availability.
- Household-entered exact products may remain household-local references until a
  later product-normalization capability has a concrete need to reconcile them.
- The MVP needs a simple curator path for reviewed aliases and a household path
  for local mapping correction; it does not need a general ontology-management
  product.

## Consequences

- Generic planning and exact household preferences can coexist without losing
  meaning.
- Retailer-neutral demand can later be resolved differently at Tesco,
  SuperValu, or another retailer without redefining recipes.
- Shopping and substitution logic must preserve optional product, brand,
  attribute, retailer, and policy constraints alongside the generic demand.
- The product needs stable concept identity and alias review, but not a massive
  external taxonomy project.
- Exact product references cannot be flattened into free text if they influence
  substitutions or later retailer selection.
- Mapping authority and confidence are provenance-based: reviewed and confirmed
  mappings may aggregate; model-only guesses may not.
- Household corrections can improve one household immediately without silently
  changing every other household.

## Deferred

- live retailer catalogues and product identifiers;
- price, promotion, availability, delivery, and basket state;
- cross-retailer product matching and automatic substitutions;
- globally reconciling every household-created product reference;
- nutrition databases attached to food concepts or products;
- retailer-specific preference UI beyond what is needed for the eventual
  fulfilment capability; and
- a comprehensive ontology editor or automated global alias promotion.

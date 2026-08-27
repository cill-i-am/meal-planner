# ADR-0006 — Separate Food Concepts, Products, And Retailer Listings

- Status: Accepted
- Date: 2026-08-26
- Related product decision: [PDR-0010](../../decisions/product/0010-food-concepts-exact-products-and-retailer-preferences.md)

## Context

The planner needs stable generic food identity for recipe normalization,
preferences, shopping aggregation, and future substitutions. It also needs to
preserve exact products and, later, retailer-specific listings, prices, and
availability.

Using one string for all three concerns would make identity unstable and prevent
reliable cross-retailer behaviour. Using a retailer SKU as food identity would
couple recipes and household preferences to one retailer. Treating exact
products as aliases would erase meaningful brand, pack, attribute, and
substitution constraints.

## Decision

### Food concept

- `FoodConcept` is the application-owned generic identity used by recipes,
  assembled meals, preferences, and retailer-neutral shopping demand.
- It has a stable Meal Planner identifier, reviewed display name, aliases, and
  optional cross-references to external taxonomies.
- Aliases do not collapse materially different foods or forms.
- External taxonomy identifiers are enrichment, not primary keys or authority.

### Mapping state and authority

A source ingredient, exact product, or future retailer listing may have a
mapping state directionally equivalent to:

```ts
type FoodConceptMappingState =
  | { readonly kind: "unresolved" }
  | {
      readonly kind: "proposed"
      readonly proposedConceptId: FoodConceptId
      readonly provenance: MappingProvenance
      readonly confidence: number | null
    }
  | {
      readonly kind: "confirmed"
      readonly foodConceptId: FoodConceptId
      readonly authority: MappingAuthority
      readonly provenance: MappingProvenance
    }
```

The implementing capability may refine this shape. The durable rules are:

- A reviewed global alias or curated mapping may resolve deterministically and
  automatically.
- A model, embedding, similarity search, or heuristic may propose a mapping but
  cannot confirm it merely because its numeric confidence is high.
- Ambiguous mappings remain unresolved and do not aggregate automatically.
- Original source wording remains preserved alongside any mapping.
- Form and preparation are part of identity where they materially affect
  planning or shopping; fresh tomatoes, chopped tomatoes, passata, and tomato
  purée must not collapse into one concept.

### Local and shared correction

- A household adult may confirm or correct a food-concept mapping for household
  content and shopping demand.
- Household-specific mapping corrections are canonical in `HouseholdObject`,
  audited, and immediately usable within that household.
- A household correction does not mutate the shared alias registry.
- Shared reviewed aliases and global mappings belong to the application
  reference-data or catalogue authority.
- In the MVP, only the accepted curator principal may promote a household or
  catalogue correction into a shared alias used by every household.
- Historical recipe versions and approved plans retain their recorded source
  wording and pinned mapping. Shared alias changes affect future normalization
  and do not silently rewrite history.

### Aggregation boundary

Shopping lines may aggregate automatically only when both food identity and unit
conversion are authoritative for that scope.

An authoritative food mapping comes from one of:

- a reviewed global alias;
- an explicitly curated shared mapping;
- a household-confirmed mapping used only within that household; or
- a reviewed exact-product-to-concept classification.

A model-only proposal, unresolved ingredient, or unreviewed similarity match is
insufficient. Numeric confidence may be stored for evidence and evaluation, but
it is not the authority decision.

### Product identity

- `ProductIdentity` represents one exact marketed or packaged product.
- Where meaningful, it references one primary `FoodConcept` and preserves brand,
  name, pack, form, and relevant product attributes.
- A product is not a food-concept alias.
- A composite packaged meal may remain a packaged meal option without a
  misleading primary ingredient concept.
- The initial implementation may support both curated shared product identities
  and household-local exact product references. This ADR does not require a
  premature global reconciliation service.

### Retailer listing and offer

- A future `RetailerListing` represents a retailer's listing or SKU for a
  product, or where necessary a listing mapped directly to a food concept.
- Retailer, SKU, listing title, current price, promotion, availability, fulfilment
  method, and store context belong to retailer integration state.
- Retailer listing and offer data are not stable recipe, food, or household
  preference identity.
- The same product may have listings at several retailers. A retailer-owned
  product may naturally have only that retailer's listing.
- Listing and offer data may be refreshed, rebuilt, or expire without rewriting
  recipes, profiles, routines, or approved historical plans.

### Shopping requirement shape

Retailer-neutral shopping demand is expressed with a food concept plus optional
selection constraints, directionally:

```ts
interface ShoppingRequirement {
  readonly foodConceptId: FoodConceptId
  readonly quantity: Quantity
  readonly preferredProductId: ProductIdentityId | null
  readonly requiredBrand: BrandId | null
  readonly requiredAttributes: readonly ProductAttribute[]
  readonly excludedProductIds: readonly ProductIdentityId[]
  readonly excludedBrands: readonly BrandId[]
  readonly substitutionPolicy:
    | "exact_only"
    | "ask_before_substituting"
    | "similar_products_acceptable"
}
```

The implementing capability may refine this shape. The boundary is that generic
demand and exact selection constraints remain distinct and traceable.

### Authority and ownership

- Shared reviewed food concepts and curated product identities belong to an
  application reference-data or catalogue capability, not to an arbitrary
  household.
- Household-specific preferences, exclusions, local mapping corrections, and
  household-local product references remain canonical in `HouseholdObject`.
- Future retailer listings and offers belong behind retailer adapter or
  integration boundaries and do not become household or recipe authority.
- Mapping a source ingredient, product, or retailer listing to a food concept
  records provenance, authority, and confidence. Ambiguous mappings remain
  unresolved.

### MVP implementation restraint

- Build concepts and product references only as the curated catalogue,
  household content, fallbacks, and shopping list require them.
- Provide only the small reviewed-alias and local-correction operations needed
  by the product; do not build a general ontology-management platform.
- Do not adopt a comprehensive external food taxonomy or construct a retailer
  product graph before a concrete delivery stage needs it.
- Do not introduce live retailer dependencies into recipe review or meal-plan
  authority.

## Consequences

- Recipes can remain retailer-neutral while households retain exact product and
  brand preferences.
- Future Tesco and SuperValu adapters can resolve the same food demand to
  different listings without changing recipe identity.
- Household exclusions and substitution rules survive retailer changes.
- Product mapping, listing freshness, and price availability become explicit
  integration concerns rather than hidden properties of an ingredient string.
- Food-concept and product mapping preserve provenance, authority, confidence,
  and unresolved states.
- Automatic shopping aggregation is fail-closed: reviewed or confirmed identity
  may merge, while model-only guesses remain separate.
- Household mapping correction can improve one household immediately without
  silently redefining the shared registry.

## Alternatives Rejected

### Store only free-text ingredient and product names

Rejected because aliases, preferences, aggregation, substitutions, and
cross-retailer mappings would remain unreliable and untraceable.

### Treat exact products as aliases of generic food concepts

Rejected because brand, pack, attributes, retailer context, and exact-only
selection would be lost.

### Use retailer SKUs as the canonical food or product identity

Rejected because recipes and preferences would become retailer-specific and
would break when listings change or the household shops elsewhere.

### Adopt one external taxonomy as the domain authority

Rejected because external scope, identifiers, licensing, and classification may
not match Meal Planner's planning semantics. External systems may enrich an
application-owned registry later.

### Accept model mappings above one numeric threshold

Rejected because model confidence is not calibrated identity authority and can
still collapse materially different ingredients. Model output may propose; a
reviewed alias or admitted confirmation establishes authority.

### Build the full retailer graph in the MVP

Rejected because retailer fulfilment is deferred and the product first needs to
prove household planning and retailer-neutral shopping demand.

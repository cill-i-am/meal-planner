# PDR-0010 — Generic foods, exact products, and retailer preferences

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product

## Decision and reason

A generic food and a marketed product have different identities. Collapsing them
loses brand, pack and substitution meaning; unrelated product strings make
shopping aggregation unreliable.

Grow a small Meal Planner-owned food-concept registry from actual reviewed content.
Each concept has stable identity, an ordinary name and reviewed aliases. Keep
materially different foods/forms distinct, such as fresh tomatoes and passata.
Unknown ingredients remain unmapped. External taxonomies may enrich this registry
but do not own domain identity.

## Mapping authority

Reviewed aliases or other admitted deterministic mappings may normalize source
wording automatically. Retain the source. Model/similarity matches are proposals;
confidence alone cannot create global identity or merge shopping lines.

An adult may confirm a household-local correction with actor/source/audit history,
effective immediately for that household. Only Cillian may promote reviewed
aliases into the shared registry in the MVP. Automatic aggregation requires a
reviewed global/curated mapping, household-confirmed local mapping or reviewed
product classification plus reliable quantities. Ambiguity leaves separate lines.
Future registry updates do not silently rewrite historical recipes, plans or
source wording.

## Products, preferences and retailer boundary

Exact branded/packaged products retain separate identity, brand, name, pack,
form and relevant attributes. Link a primary food concept where meaningful, not
as an alias. Marketing attributes become new concepts only when they materially
affect planning/suitability/substitution. Composite packaged meals remain meal
options rather than one misleading ingredient.

People or households may prefer/exclude concepts, brands, products or attribute
combinations, with future retailer-specific context. Preserve exact-only,
ask-before-substituting and similar-products-acceptable policies. Do not
broaden a product preference into an unrelated food preference or weaken an
exact-only requirement.

Recipes normally demand generic concepts, optionally pinned to products or
attributes. Before retailer integration, households may name products, brands,
packs and retailer context manually. These may remain household-local references.
Future adapters resolve concepts/products into retailer listings; SKUs, prices,
promotions, availability and delivery remain separate integration state.

Build only the registry and correction paths needed for recipes, meals,
fallbacks and shopping. Comprehensive taxonomy/ontology tooling, automatic global
alias promotion, universal household-product reconciliation, live retailer
matching, pricing, delivery, baskets, nutrition databases and additional
retailer-preference interfaces remain deferred.

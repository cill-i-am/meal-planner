# ADR-0003 — Separate Meal Content, Preparation, And Prepared Stock

- Status: Accepted
- Date: 2026-08-24
- Related product decision: [PDR-0004](../../decisions/product/0004-meal-content-portions-recipes-and-shopping.md)

## Context

A household plan includes recipes, assembled meals, packaged products, opaque
external meals, leftovers, and simple repeated foods. One preparation may
produce several meals or reusable components, while many meal occasions require
no cooking. Prepared portions may persist into another week, but the MVP must
not require per-meal logging or a complete pantry.

Treating a recipe, meal consumption, cook event, and inventory item as one
record would make scaling, leftovers, shopping, revision, and feedback
ambiguous.

## Decision

### Meal content

- A common planning-level meal-option abstraction may reference distinct content
  kinds: recipe, assembled, packaged, and external.
- Each kind retains its own validation, preparation, scaling, substitution, and
  shopping behaviour.
- Intentional skips, flexible coverage, and allocated leftovers remain coverage
  outcomes rather than fake meal content.

### Preparation and output

- A meal event represents consumption; a cook event represents preparation.
- One cook event may support several meal events.
- A cook event may produce finished portions, reusable prepared components, and
  unassigned surplus.
- Prepared output is explicit rather than inferred by decomposing every meal.
- Output may use weight, volume, count, or portions according to what is known
  and useful.
- Portion or component allocations cannot exceed available output or be double
  allocated.

### Prepared stock

- Prepared portions and components may become lightweight household stock.
- Stock state includes availability, reservation, consumption, discard, or
  uncertainty, plus storage location and quantity where known.
- Same-week planned leftovers are governed by the approved plan without
  requiring a separate confirmation event.
- Cross-week stock is not available to a new plan until an adult confirms it
  still exists.
- The happy path does not require marking meals cooked or eaten; exception and
  weekly-review updates reconcile deviations.

### Recipe scaling

- Recipe versions preserve the original batch and stated yield.
- A derived reference-serving projection may support planning without replacing
  the original batch truth.
- A cook event records intended yield and scaled quantities separately from the
  recipe version.
- Scaling rules are ingredient-specific and preserve unresolved values.

### Safety boundary

- Prepared-stock age is operational context, not a safety certificate.
- The MVP does not own use-by calculation, automatic expiry, or safe-to-eat
  assertions.

## Consequences

- Recipe authority, plan authority, preparation state, and prepared stock are
  separate concepts even when implemented in one household database.
- Plan repair can replace a cook event and trace all dependent portions and
  shopping demand.
- Assembled meals can consume prepared components without becoming artificial
  full recipes.
- Later pantry, retailer, and nutrition capabilities can extend the model
  without forcing them into the MVP.
- Domain code needs quantity semantics that do not assume every value is a
  decimal number in a universally convertible unit.

## Alternatives Rejected

### Store leftovers as notes on a meal

Rejected because notes cannot prevent double allocation, support cross-week
stock, or update shopping and dependent meals coherently.

### Require users to confirm every cook and consumption event

Rejected because it contradicts the primary time-saving promise and makes the
product a tracker rather than a planner.

### Treat every food as a recipe

Rejected because it manufactures meaningless methods and yields for packaged,
assembled, and external meals.

### Build a complete pantry before prepared stock

Rejected because continuous ingredient inventory adds high friction and is not
required to prove the planning loop.
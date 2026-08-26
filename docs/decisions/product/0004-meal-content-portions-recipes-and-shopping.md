# PDR-0004 — Meal Content, Portions, Prepared Food, Recipes, And Shopping

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Context

A real household week contains full recipes, cereal, sandwiches, exact frozen
products, takeaway, leftovers, and meals assembled from prepared components.
Forcing those into one recipe shape creates fake instructions and unreliable
shopping demand. Conversely, modelling every food as unrelated would fragment
the planner.

The product also needs deliberate batch cooking and useful cross-week prepared
stock without turning the MVP into a high-friction pantry or food-safety ledger.

## Decision

### Common planning concept with distinct content kinds

The planner uses a common meal-option concept while preserving distinct
underlying behaviours:

- **Recipe meal** — structured ingredients, instructions, yield, scaling,
  preparation, and possible leftovers.
- **Assembled meal** — components and quantities without a meaningful recipe
  method, such as cereal, sandwiches, toast, fruit, or yoghurt.
- **Packaged meal** — a generic or exact product with optional preparation and
  substitution policy.
- **External meal** — takeaway, restaurant, school meal, canteen, or another
  opaque meal that covers an occasion but normally contributes no shopping
  demand.

Leftovers, intentional skips, and flexible slots are coverage outcomes rather
than additional meal kinds.

The domain may use a discriminated union for clarity, but this record does not
require the frontend to render the raw domain union. A separate projection may
better group shared meals, person exceptions, and rationale.

### Assembled meals and prepared components

- An assembled meal may use standalone ingredients, packaged products, or a
  prepared component from an earlier cook event.
- One cook event may intentionally produce several outputs, including finished
  meal portions, reusable prepared components, and surplus.
- Examples include roast dinners plus cooked chicken for sandwiches, sauce for a
  later meal, or roast vegetables for lunch.
- Prepared outputs are explicit—planned by the agent or recorded by an adult.
  The system does not decompose every cooked meal into speculative inventory.
- A prepared component uses a real quantity where natural and known, such as
  grams or millilitres, and portions where measurement would add unnecessary
  friction.
- Partial consumption is allowed where the quantity unit supports it.

### Portion model

- Each person has a default serving factor relative to one recipe reference
  serving.
- The factor may differ by meal occasion.
- A specific meal allocation may override the profile default.
- Friendly labels such as child, small adult, standard adult, and large portion
  may seed values, but the stored factor is not a calorie or clinical claim.
- Future verified nutrition may attach per reference serving or measured
  quantity without replacing the portion model.
- Feedback such as too much or not enough may propose factor changes.

### Planned batch cooking and incidental surplus

- A cook event may be deliberately scaled for current meals, named later meals,
  and freezer portions.
- Planned yield and reserved future allocations are explicit.
- Planned same-week leftovers are part of the approved plan and require no
  success confirmation.
- Incidental leftovers use a low-friction action: approximate quantity or
  portions, plus fridge or freezer.
- Incidental surplus does not cover another meal until recorded.

### Prepared-food stock

- The MVP actively tracks only prepared portions and prepared components, not a
  complete ingredient pantry.
- Stock records what the item is, approximate remaining quantity, storage
  location, source recipe or cook event where known, and whether it is
  available, reserved, consumed, discarded, or uncertain.
- Approved-plan reservations prevent double allocation.
- A reserved portion is treated as consumed after its planned occasion unless
  an adult reports that it still exists.
- If a meal changes before the occasion, its reservation is released.
- Cross-week stock requires lightweight confirmation before a new plan relies
  on it.

### Food-safety boundary

- The MVP does not request ingredient use-by or best-before dates.
- It does not calculate or certify a prepared meal's safe-to-eat deadline.
- It does not automatically expire prepared food using guessed safety rules.
- It does not use product language such as safe, unsafe, or eat by.
- Neutral record age may be shown, but the household decides whether stock is
  still usable.
- Food-safety guidance is not a prerequisite for the inventory model.

### Recipes, versions, and forks

- The shared curated catalogue and private household recipe bank are separate
  authorities.
- Editing a shared catalogue recipe creates a private household fork; the
  catalogue entry remains unchanged.
- Ordinary edits to a household recipe create a new immutable version of the
  same recipe.
- Creating a materially different dish is an explicit separate fork.
- Plans pin the exact recipe version used.

### Yield and scaling

- The original recipe batch and stated yield remain authoritative.
- Where meaningful, the product derives a reference-serving projection for
  planning and scaling.
- Scaling a recipe for one cook event does not create a new recipe version.
- Ingredient-specific rules handle linear, discrete, bounded,
  package-constrained, to-taste, and non-scalable behaviour.
- Ambiguous quantities, whole items, package sizes, geometry, and cooking-time
  changes are surfaced rather than blindly multiplied.
- Missing quantities or yield are never invented.
- A user may explicitly save a confirmed scaling adaptation as a new household
  recipe version.
- A recipe can be saved for review while incomplete, but it cannot drive
  reliable scaling or shopping until base yield, usable instructions, and
  material shopping quantities are confirmed.

### Units and conversion

- The MVP is metric-first wherever a measured value can be represented
  truthfully.
- Preferred normalized units include grams, kilograms, millilitres, litres,
  Celsius, teaspoons, tablespoons, and item or package counts.
- An imported or manually entered source value and unit are preserved alongside
  any normalized representation.
- The product converts a source measurement only when the conversion is
  reliable for that ingredient and form.
- A safe metric conversion may be displayed alongside an imperial or household
  measure, but the source value is not discarded.
- Ambiguous measures such as cups of chopped ingredients, handfuls, bunches,
  large items, or loosely packed volumes remain explicit when conversion would
  manufacture false precision.
- A failed or uncertain conversion never blocks saving a draft, but it may block
  normalized aggregation, scaling, or shopping arithmetic that depends on that
  conversion.
- Packaged and discrete products use item or pack counts where appropriate
  rather than pretending the contents are freely divisible.
- The system may add new reviewed conversion knowledge over time, but it never
  silently rewrites the source evidence or historical recipe version.

### Shopping list

- A draft plan shows a shopping preview.
- Approving a plan creates the active retailer-neutral shopping list.
- Recipe meals contribute structured ingredient demand.
- Assembled and packaged meals contribute components or exact products.
- Planned leftovers contribute demand only through the producing cook event.
- External meals, intentional skips, and flexible slots contribute no shopping
  demand.
- Adults may add unrelated household items manually.
- Ingredients aggregate only when food identity and unit conversion are
  reliable. Uncertain items remain separate.
- Exact products remain distinct unless their substitution policy permits a
  broader match.
- Aggregated items can explain which meals created the requirement.
- Adults may manually merge, split, or adjust quantities.
- The MVP offers an optional one-off "already have this?" check rather than a
  complete live pantry.
- A plan revision shows the shopping-list delta before application and
  preserves manual items and purchased or checked-off state. Items no longer
  required are not silently erased if they may already have been bought.

## Consequences

- Planning can unify real-life meal coverage without forcing fake recipe data.
- Cook-event output and prepared-stock state need stable identity and quantity
  semantics.
- Quantity records need both source-preserving and normalized representations
  rather than one destructive canonical conversion.
- Shopping demand must be derived from the accepted plan model rather than a
  retailer product representation.
- The MVP remains compatible with later pantry, nutrition, and retailer work
  without claiming those capabilities now.

## Deferred

- continuous ingredient pantry inventory;
- food-safety certification and expiry automation;
- calories, macros, and clinical portion targets;
- retailer product matching and live availability;
- basket mutation and checkout;
- comprehensive conversion coverage for every informal household measure; and
- automatic decomposition of recipes into reusable components.
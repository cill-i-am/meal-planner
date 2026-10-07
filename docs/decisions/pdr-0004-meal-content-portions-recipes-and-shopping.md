# PDR-0004 — Food, portions, prepared meals, recipes, and shopping

- Status: Accepted
- Date: 2026-08-24
- Owners: Household product

## Decision and reason

Real weeks include recipes, assembled meals, packaged products and external
meals. Preserve their distinct preparation, quantity and shopping behaviour.
Leftovers, skips and flexible slots are coverage outcomes, not extra recipe kinds.
External meals normally add no shopping demand. Presentation need not expose the
internal content types.

Preparation and eating are separate. A cook event may explicitly produce finished
portions, reusable components and surplus for several later meals. Components may
be used in assembled meals. Use meaningful measured quantities or low-friction
portion estimates, permitting partial use where the unit supports it. Never
invent inventory by automatically decomposing every cooked meal.

## Portion model

Use factors relative to a recipe reference serving, behind ordinary labels:

| Label | Initial factor |
| --- | --- |
| Half portion | 0.5 |
| Small portion | 0.75 |
| Standard portion | 1.0 |
| Large portion | 1.25 |

These describe expected quantity, not age, nutrition or clinical needs. Each
person may have occasion-specific defaults and meal-specific overrides. Sum the
factors before applying practical batch and scaling rules. Packaged meals may
instead use counts; buffets, sides and independent components may use explicit
quantities. Feedback may propose a changed default, but an adult confirms it.
Verified future nutrition may attach to servings or quantities without replacing
this model.

## Prepared food and safety

Planned output and future reservations are explicit; same-week leftovers need no
success confirmation. Record incidental surplus with approximate quantity and
fridge/freezer location before relying on it. Track prepared food only, with
identity, quantity, location, known origin and available, reserved, consumed,
discarded or uncertain state. Prevent duplicate allocation. Treat reservations
as consumed after their occasion unless corrected, release them when meals
change, and confirm cross-week stock before new planning.

Do not request use-by or best-before dates, certify safe-to-eat deadlines,
automatically expire food through guessed rules, or label food safe/unsafe/eat-by.
Neutral record age is permissible; households decide usability.

## Recipes, scaling and units

Shared catalogue and private household banks have separate authority. Editing
catalogue content creates a private fork. Ordinary household edits create
immutable versions; a materially different dish is an explicit separate fork.
Plans pin exact versions.

Keep original batch and stated yield authoritative. A reference-serving
projection may aid planning. Scaling a cook event is plan state, not a recipe
edit, though an adult may save a confirmed adaptation as a version. Preserve
linear, discrete, bounded, package-constrained, to-taste and non-scalable rules.
Surface uncertainty in geometry, whole items, packages, cooking time and yield;
never invent missing quantities. Incomplete recipes may be saved for review but
cannot support reliable scaling/shopping without confirmed yield, usable
instructions and material shopping quantities. Non-material to-taste ingredients,
optional garnishes or unresolved brands may remain open when truthful planning
does not depend on them.

Use metric-first normalized units where truthful, including mass, volume,
Celsius, teaspoons, tablespoons and counts. Always preserve source value and unit.
Convert only with reliable ingredient/form knowledge. Cups, handfuls, bunches and
similar uncertain measures remain explicit; discrete products need not be freely
divisible. Uncertain conversion permits draft saving but blocks dependent
arithmetic. Reviewed conversion updates never silently rewrite historical evidence.

## Shopping demand

Drafts expose a preview; approval creates the active retailer-neutral list.
Recipes contribute ingredients, assembled/packaged meals their components or
products, and leftovers only their producing cook event's demand. External
meals, skips and flexible slots contribute none.

Aggregate only authoritative compatible identities and reliable units; leave
uncertain lines separate. Preserve exact products unless substitution permits a
broader match. Explain source meals. Adults may add unrelated items, merge, split
and adjust quantities. An optional already-have check replaces continuous pantry
tracking. Revisions show their shopping delta and preserve manual and purchased
state under PDR-0014.

Continuous ingredient inventory, clinical targets, expiry automation, live
retailer matching, basket/checkout, exhaustive conversion coverage and automatic
component decomposition remain deferred.

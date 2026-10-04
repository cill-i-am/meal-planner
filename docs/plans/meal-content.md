# Stage 4 — Add recipes and other meal options

Status: active
Owner: unassigned
Depends on: [preceding capability](routines-and-fallbacks.md)

This is approved product direction, not a claim that the feature is built. The order reflects dependencies and what we need to learn. It does not require every possible earlier feature to be finished before trying a small end-to-end flow.

## Outcome

Give the planner reliable shared and household meal options. Packaged food, assembled meals and eating out should not need made-up recipes.

## Scope

- common planning abstraction for recipe, assembled, packaged, and external meal
  options;
- exact products and substitution policy;
- shared curated-catalogue authority;
- private household recipe bank;
- immutable recipe versions and ancestry;
- household forks and adaptations;
- the original batch yield and a calculated amount per reference serving;
- structured quantities and ingredient-specific scaling rules;
- checks that a recipe has enough detail for planning and shopping;
- multidimensional effort, equipment, portability, and leftover metadata;
- existing TikTok import integration with the canonical recipe model;
- manual recipe and assembled-meal entry;
- curated-content workflow; and
- general web-page import after the normalized model is proven.

## Example flow

A household selects one curated recipe, imports one private recipe, corrects and
approves it, creates an assembled meal and an exact packaged fallback, forks one
catalogue recipe, scales one cook event without changing the recipe version, and
pins exact versions in a planning fixture.

## Acceptance

- [ ] shared content never leaks private household recipes;
- [ ] imported uncertainty and provenance survive review;
- [ ] material edits create versions rather than rewriting history;
- [ ] scaling handles linear, discrete, bounded, package-constrained, to-taste, and
  unresolved cases; and
- [ ] food accepted for planning has enough information to calculate what needs buying.

## Implementation status

The current branch stores planning references to canonical saved recipes and
distinct assembled, packaged, and external options. Yield and material
quantities can remain explicitly unresolved. A reviewed shopping projection
requires known yield and quantities before plan approval. Suitability reviews
are pinned to the person profile and exact option version. Prepared portions
record known units, remaining amount, reservations, and week-specific
confirmation. Plan reservations are server-owned. A later week can use recorded
stock only after an adult confirms the remaining amount and the earlier
reserved occasions have passed. Approval checks each prepared portion's exact
source option against the recipient's current food profile. An adult can record
stock with an unknown source, but must link it to a saved option before it can
cover a plan; a person with hard constraints also needs a compatible review for
that option. Plan versions pin the source, exact option display, and reviewed
shopping data used at approval. Recipe editing, forks, scaling rules,
and the full shopping list remain open in the acceptance list above.

## Remaining acquisition decisions

Decisions about food data and its sources stay in [the decision register](../decisions/README.md).

The remaining implementation decisions for the generic web-page adapter are:

- What exact robots and publisher-policy behaviour applies to an intentionally
  submitted public recipe URL?
- Which MIME types, response-size bounds, redirect limits, timeouts, and
  extraction limits form the initial restricted-fetch policy?

Multi-page, slideshow, highly interactive, and browser-dependent recipe
experiences remain unsupported in the MVP. Consider Cloudflare Browser Run later only if actual failed imports show enough need to justify its cost and complexity.

## Structured recipe foundation — 2026-10-02

The authorized Tinyplates-inspired content redesign replaces text-only ingredients
and reduced planning snapshots with the shared
[structured recipe content](../reference/recipe-content.md) model. It connects
extraction, evidence grounding, review corrections, atomic publication, complete
planning snapshots and cooking display. No compatibility path or external
provider effect is part of this change. This foundation does not mark the broader
meal content, household suitability, cook-event or shopping stages complete.

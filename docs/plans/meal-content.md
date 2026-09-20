# Stage 4 — Meal Content, Recipe Foundation, And Supply

Status: proposed
Owner: unassigned
Depends on: [preceding capability](routines-and-fallbacks.md)

Accepted product direction from the roadmap; implementation is not claimed.
Sequence expresses dependencies and learning, not a requirement to finish every
possible preceding feature before an end-to-end tracer.

## Outcome

The planner has trustworthy shared and household food options without forcing
every real-life meal into a fake recipe.

## Scope

- common planning abstraction for recipe, assembled, packaged, and external meal
  options;
- exact products and substitution policy;
- shared curated-catalogue authority;
- private household recipe bank;
- immutable recipe versions and ancestry;
- household forks and adaptations;
- original batch yield plus derived reference-serving projection;
- structured quantities and ingredient-specific scaling rules;
- recipe completeness gates for planning and shopping;
- multidimensional effort, equipment, portability, and leftover metadata;
- existing TikTok import integration with the canonical recipe model;
- manual recipe and assembled-meal entry;
- curated-content workflow; and
- general web-page import after the normalized model is proven.

## Vertical tracer

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
- [ ] admitted content is sufficient for later shopping demand.


## Remaining acquisition decisions

Food/canonical source choices remain in [the decision register](../decisions/README.md).

The remaining implementation decisions for the generic web-page adapter are:

- What exact robots and publisher-policy behaviour applies to an intentionally
  submitted public recipe URL?
- Which MIME types, response-size bounds, redirect limits, timeouts, and
  extraction limits form the initial restricted-fetch policy?

Multi-page, slideshow, highly interactive, and browser-dependent recipe
experiences remain unsupported in the MVP. A later Cloudflare Browser Run path
may be considered only when observed failed-import coverage justifies its cost
and complexity.

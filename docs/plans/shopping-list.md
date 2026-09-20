# Stage 7 — Build a shared shopping list

Status: proposed
Owner: unassigned
Depends on: [preceding capability](weekly-planning.md)

This is approved product direction, not a claim that the feature is built. The order reflects dependencies and what we need to learn. It does not require every possible earlier feature to be finished before trying a small end-to-end flow.

## Outcome

Turn an approved plan into one usable shopping list. Do not add retailer integration or pretend to know the household's live pantry contents.

## Scope

- draft shopping preview;
- active list created only from approved-plan demand;
- demand from recipe, assembled, and packaged meal options;
- cook-event-based demand so leftovers are not double counted;
- reliable ingredient aggregation and unit normalization;
- exact-product preservation and substitution policy;
- optional one-off "already have this?" check;
- category grouping and demand provenance;
- manual add, merge, split, edit, and check behaviour;
- plan-revision shopping delta; and
- preservation of manual and purchased state.

Under PDR-0006, this stage checks that the list follows the approved plan and updates correctly when that plan changes. Before external beta, the complete eight-family scenario must also pass, including how revisions affect planning and shopping.

## Example flow

The approved full-week plan produces one consolidated list, combines only
reliably equivalent ingredients, includes exact fallback products, excludes
external/flexible/skip coverage, preserves manual items, and shows the changes to the shopping list after a plan revision.

## Acceptance

- [ ] each quantity can be traced to the approved plan;
- [ ] unresolved recipe quantities remain visible rather than fabricated;
- [ ] a plan revision does not silently remove manually added items or forget which items were bought; and
- [ ] beta households report that the list is usable for a real shop.

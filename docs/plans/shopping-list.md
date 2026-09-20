# Stage 7 — Retailer-Neutral Shopping List

Status: proposed
Owner: unassigned
Depends on: [preceding capability](weekly-planning.md)

Accepted product direction from the roadmap; implementation is not claimed.
Sequence expresses dependencies and learning, not a requirement to finish every
possible preceding feature before an end-to-end tracer.

## Outcome

An approved plan becomes a practical consolidated list without introducing
retailer integration risk or a pretend live pantry.

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

This stage owns approved-demand and shopping-delta/repair evaluation under
PDR-0006. Before external beta, the complete connected eight-family trajectory
must also pass, including the planning and shopping consequences of revisions.

## Vertical tracer

The approved full-week plan produces one consolidated list, combines only
reliably equivalent ingredients, includes exact fallback products, excludes
external/flexible/skip coverage, preserves manual items, and applies a visible
delta after plan revision.

## Acceptance

- [ ] quantities trace back to approved plan demand;
- [ ] unresolved recipe quantities remain visible rather than fabricated;
- [ ] revision does not silently erase purchased or manual state; and
- [ ] beta households report that the list is usable for a real shop.

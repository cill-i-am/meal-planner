# Stage 3 — Person And Household Routine Builder

Status: proposed
Owner: unassigned
Depends on: [preceding capability](private-discovery/README.md)

Accepted product direction from the roadmap; implementation is not claimed.
Sequence expresses dependencies and learning, not a requirement to finish every
possible preceding feature before an end-to-end tracer.

## Outcome

Recurring patterns are represented once and reused, so all-meal coverage does
not become repetitive weekly data entry.

## Scope

- configurable meal occasions with sensible defaults;
- person and household routine rules;
- exact-food and small-set routines with pin, prefer, or rotate behaviour;
- recurring cadence, favourites, pauses, and avoid state;
- intentional skips, external meals, and flexible patterns;
- location and availability context;
- equipment and preparation windows;
- multidimensional effort and weekly cooking-capacity targets;
- packed-lunch and leftover rules;
- person-specific approved fallbacks, including exact packaged products;
- substitution policies;
- AI-proposed routines and fallbacks with use-once, save, or reject choices;
- effective dates and one-off weekly exceptions;
- conflict detection and priority policy;
- plan rationale from confirmed facts; and
- visual routine editing.

This stage owns the routine/fallback expansion, exception, and confirmation
evaluation deferred from discovery by PDR-0006.

## Vertical tracer

The agent builds weekday breakfast routines, office and school lunch context,
planned leftover lunches, Friday eating out, a weekend cooked breakfast, one
intentional skip, equipment-aware hands-off cooking, and a dependant packaged
fallback. A one-off school holiday changes one week without rewriting the
baseline.

## Acceptance

- [ ] routine evaluation deterministically produces expected concrete entries;
- [ ] exceptions override without corrupting enduring routines;
- [ ] conflicts and applied rationale remain visible;
- [ ] repeated patterns substantially reduce weekly input; and
- [ ] adults understand and edit the rules the agent created.

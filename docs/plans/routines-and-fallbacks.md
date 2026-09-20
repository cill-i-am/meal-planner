# Stage 3 — Build personal and household routines

Status: proposed
Owner: unassigned
Depends on: [preceding capability](private-discovery/README.md)

This is approved product direction, not a claim that the feature is built. The order reflects dependencies and what we need to learn. It does not require every possible earlier feature to be finished before trying a small end-to-end flow.

## Outcome

Save regular eating patterns once and reuse them, so planning every meal does not mean entering the same information each week.

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

This stage tests how routines and fallback meals expand into a week, how exceptions work and how users confirm changes. PDR-0006 deferred those checks from discovery.

## Example flow

The agent builds weekday breakfast routines, office and school lunch context,
planned leftover lunches, Friday eating out, a weekend cooked breakfast, one
intentional skip, equipment-aware hands-off cooking, and a dependant packaged
fallback. A one-off school holiday changes one week without rewriting the
baseline.

## Acceptance

- [ ] the same routine inputs produce the expected dated meal entries;
- [ ] a one-off exception changes the right dates without changing the saved routine;
- [ ] users can see conflicting rules and why a rule was applied;
- [ ] repeated patterns substantially reduce weekly input; and
- [ ] adults understand and edit the rules the agent created.

# Plans and remaining work

Start here to find the next work. Each plan keeps its own status, acceptance
checklist, next step and results. This page sets the order without copying those
checklists. New work is tracked in the repository, not Linear.
Use the [plan template](_template.md) when a task needs a written plan.

A design can be approved before it is built. Merged code may still need evaluation
or deployment. Keep those stages separate when reporting progress.

## Immediate work

Continue [private discovery](private-discovery/README.md): finish the
[evaluation and conversation-tone work](private-discovery/03-adaptive-discovery-and-evaluation.md),
then [repeat reviews and dependant assistance](private-discovery/04-repeat-review-and-dependant-assistance.md).
The [onboarding plan](onboarding.md) tracks G01–G14 from the agreed Paper designs.
Coordinate changes to shared forms and auth files. Finished designs do not mean
those screens have been implemented.

## Capability sequence

| Work | Plan |
| --- | --- |
| Household data foundation | [People, profiles and permissions](household-people/README.md), [architecture explanation](../explanation/household-authority.md) |
| 2. Private interviews and repeat reviews | [Discovery](private-discovery/README.md) |
| 3. Routines and fallback meals | [Routines](routines-and-fallbacks.md) |
| 4. Recipes, other meals and prepared food | [Meal content](meal-content.md) |
| 5. A complete, workable week for the household | [Weekly planning](weekly-planning.md) |
| 6. Optional feedback and learning | [Weekly learning](weekly-learning.md) |
| 7. A shared shopping list independent of a retailer | [Shopping](shopping-list.md) |
| End-to-end checks before external beta | [Beta readiness](beta-readiness.md) |

This order reflects dependencies and what we need to learn, not promised dates.
It does not require every possible feature in one stage to be finished before
trying a small end-to-end flow in the next.

## Engineering and interface work

- [Reduce custom library plumbing](library-consolidation/README.md): four plans
  from the overlapping proposals #219–#225. These are plans, not implemented changes.
- [Fix import confidence and unknown usage](import-confidence-and-accounting.md).
- [Infrastructure review findings](infrastructure-upgrade-review.md): dated findings,
  not an instruction to perform another upgrade.
- [Use json-render across the site](json-render.md), after discovery and evaluation.
- [The documentation refactor](documentation-framework.md).

## Completed evidence

[Household foundation](household-people/README.md),
[dependency upgrade](dependency-upgrade-2026-09-05.md),
[ordered risk fixes](prioritized-risk-fixes.md),
[private-output safety](private-output-safety.md) and
[cleanup](anti-slop-cleanup.md) record past results and their limits.
Do not repeat completed work just because its plan is still available.

## Deliberate exclusions

[Product scope](../explanation/product/vision-and-scope.md) and
[PDR-0005](../decisions/pdr-0005-mvp-scope-and-deferrals.md) define what is outside
the release: medical or nutrition-goal tracking, a fully inferred pantry,
food-safety expiry, retailer fulfilment, public marketplaces, MCP or embedded
distribution, and generic organizations. Do not add these to a task implicitly.

Recipe-source choices belong in the content plan. Model, provider and judge choices
belong in discovery. Record settled choices in the decision register, not a second
list of open questions.

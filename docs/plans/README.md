# Plans and remaining work

This index owns sequence and navigation. Each linked plan owns its status,
acceptance, next action and evidence. Accepted direction is not implemented code;
a merged implementation is not completed evaluation, deployment or beta readiness.
Repository records, not Linear, own new work. [Plan template](_template.md).

## Immediate work

Continue [private discovery](private-discovery/README.md), starting with
[remaining evaluation and conversation tone](private-discovery/03-adaptive-discovery-and-evaluation.md)
and then [repeat review/dependant assistance](private-discovery/04-repeat-review-and-dependant-assistance.md).
The [onboarding plan](onboarding.md) owns G01–G14 from the agreed Paper work;
coordinate overlapping forms/auth files rather than treating designs as implemented.

## Capability sequence

| Outcome | Owning record |
| --- | --- |
| Household authority foundation | [People, profiles and permissions](household-people/README.md) and [authority explanation](../explanation/household-authority.md) |
| 2. Private discovery and repeat reviews | [Discovery](private-discovery/README.md) |
| 3. Routines and fallbacks | [Routines](routines-and-fallbacks.md) |
| 4. Meal content and cooking/prepared food | [Content](meal-content.md) |
| 5. A complete feasible household week | [Planning](weekly-planning.md) |
| 6. Optional feedback and learning | [Learning](weekly-learning.md) |
| 7. Collaborative retailer-neutral shopping | [Shopping](shopping-list.md) |
| Connected external-beta gate | [Beta readiness](beta-readiness.md) |

Sequence reflects dependencies and product learning, not calendar promises or a
mandate to complete every possible feature in a layer before a vertical tracer.

## Engineering and interface work

- [Library consolidation](library-consolidation/README.md) reconciles the overlapping
  proposals #219–#225. Those PRs remain open; proposals are not implemented dependencies.
- [Import confidence and unknown-usage findings](import-confidence-and-accounting.md).
- [Infrastructure review findings](infrastructure-upgrade-review.md): dated evidence,
  not automatic approval for another upgrade.
- [Eventual json-render rollout](json-render.md), after discovery/evaluation.
- [This documentation refactor](documentation-framework.md).

## Completed evidence

[Household foundation](household-people/README.md),
[dependency upgrade](dependency-upgrade-2026-09-05.md),
[the ordered risk fixes](prioritized-risk-fixes.md),
[private-output safety](private-output-safety.md) and
[cleanup](anti-slop-cleanup.md) preserve historical results and limitations.
Completed records are not instructions to replay old work.

## Deliberate exclusions

[Vision/scope](../explanation/product/vision-and-scope.md) and
[PDR-0005](../decisions/pdr-0005-mvp-scope-and-deferrals.md) own release exclusions:
medical/nutrition-goal tracking, full inferred pantry/food-safety expiry, retailer
fulfillment, public marketplaces, MCP/embedded distribution and generic organizations
are not silently pulled into this queue. Source acquisition choices stay with the
content plan; model/provider/judge choices stay with discovery. Settled answers live
in the decision register, not an additional open-question catalogue.

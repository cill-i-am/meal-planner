# Plans and remaining work

Use these plans for unfinished acceptance. The [feature map](../reference/features/README.md)
links implemented behaviour to source and tests; [PRODUCT.md](../../apps/web/PRODUCT.md)
owns the intended experience. Capability dependencies do not prescribe user steps.
Completed plans are removed after useful decisions and outstanding obligations move
to their existing owners. Git history and delivery PRs retain historical evidence.

## Immediate work

- [Private discovery](private-discovery/README.md) retains live evaluation, human
  calibration, conversation quality, repeat review, and dependant assistance.
- [Onboarding acceptance](onboarding.md) retains production mail activation and
  inbox/link verification, physical-device accessibility, and remaining policy checks.
- [Beta readiness](beta-readiness.md) owns complete-journey release evidence and
  cohort acceptance. Passing local or scripted checks does not establish either.

[PR #284](https://github.com/cill-i-am/meal-planner/pull/284) merged the connected
family, discovery, content, routines, and planning implementation into main.
The remaining plans below describe broader acceptance, not a request to rebuild
that foundation. Their evidence does not establish a production deployment.

## Capability sequence

Read only the plan affected by the task. The order expresses dependencies, not
screens, a mandatory onboarding sequence, or a requirement to finish every earlier
feature before testing a useful end-to-end result.

| Remaining capability or acceptance | Owner |
| --- | --- |
| Private discovery and repeat review | [Discovery](private-discovery/README.md) |
| Household patterns and simple alternatives | [Routines and fallbacks](routines-and-fallbacks.md) |
| Reviewed food, preparation, and stock | [Meal content](meal-content.md) |
| A workable personalised week | [Weekly planning](weekly-planning.md) |
| Optional feedback | [Weekly learning](weekly-learning.md) |
| Shared retailer-neutral shopping | [Shopping list](shopping-list.md) |
| Connected external-beta acceptance | [Beta readiness](beta-readiness.md) |

## Other open work

- [Workflow adoption and gardening](agent-workflow-adoption.md).
- [Remaining library consolidation](library-consolidation/README.md).
- [Import confidence and accounting](import-confidence-and-accounting.md).
- [Infrastructure findings](infrastructure-upgrade-review.md), which require
  checking against current code before selecting a change.
- [Generative interface work](json-render.md), whose remaining scope must be
  reconciled with the existing conversation implementation.

[Release scope](../../apps/web/PRODUCT.md#implementation-and-scope) bounds these
plans. Model/provider choices belong to discovery; acquisition choices belong to
meal content. A task does not implicitly authorize unrelated roadmap work.

# Repository Workflow

## Sources

Product intent lives in the [blueprint](../product-blueprint/) and [accepted product decisions](../decisions/product/). [Architecture and ADRs](../architecture/) own technical boundaries. [Current delivery](../delivery/current.md) and the owning work item track product scope, status, blockers, and evidence. PRs review an implementation head. Linear is not used for new work.

Read the relevant source when the task depends on it. Historical delivery notes and handoffs are context to verify, not current authority.

## Delivery

For ongoing product work, keep one owning [work item](../delivery/work-item-template.md) with an observable outcome, relevant decisions, scope, dependencies, and evidence needed to demonstrate completion. Reuse a ready work item as the plan. A clear, bounded user request can be executed directly without creating another record.

One owner carries the task through implementation, verification, in-scope corrections, and delivery within the user's authorization. Start with a useful end-to-end path when the change spans layers. Use the [execution policy](execution-policy.md) for ownership, review, and external effects; there is no mandatory sequence of planning or coordination skills.

Make product or architecture decisions explicit when they materially affect household behaviour, privacy, safety, persistence, or authority. Routine implementation choices do not need an ADR or another approval.

## Evidence and completion

Choose checks that can detect failures in the changed behaviour, plus any gates required by the work item or CI. Exercise the real runtime when making runtime or user-visible claims. Record commands, results, and material limitations concisely in the work item or PR.

Keep the implemented head and review/check evidence aligned. After an authorized merge, record the merge commit and completion in the owning work item, update current delivery if its next action changed, and update architecture/public docs affected by the change. A local implementation or green CI alone is not a merged outcome.

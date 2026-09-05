---
name: worker
description: Deliver a scoped Meal Planner work item through implementation, verification, and in-scope fixes.
---

# Delivery

Use the repository work item or clear user request as the plan. Consult [repository workflow](../../../docs/agents/repository-workflow.md) for product-work records and [execution policy](../../../docs/agents/execution-policy.md) for ownership, review, and external effects.

Identify the observable outcome, affected boundaries, and evidence needed to finish. Reuse existing decisions and nearby code. Establish an isolated checkout when needed with [worktree-isolation](../worktree-isolation/SKILL.md).

Carry one useful path through implementation and verification, then complete the remaining scope. Use technical skills only for guidance the changed surface needs. Resolve ordinary uncertainty with inspection or a focused probe; fix in-scope test, runtime, CI, and review failures without another approval cycle.

Keep evidence with the owning work item or PR. Obtain independent review when the execution policy calls for it. If CI remains pending, use [ci-watch](../ci-watch/SKILL.md) only when you own that follow-up.

Finish with what changed, how it was verified, and any actual remaining external gate. Do not stop at a working first pass or hand the user another implementation plan when completion is already authorized.

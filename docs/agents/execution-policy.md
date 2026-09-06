# Execution Policy

This document owns delivery authority, review, and coordination. Skills and templates supply techniques, not additional approval gates. User instructions and their existing authorization take precedence.

## Standing delivery authority

An implementation request authorizes the necessary local edits, disposable tests, builds, browser checks, commits, branch pushes, PR creation and updates, in-scope CI and review fixes, and merge of the intended head once the verification and review requirements below are satisfied. Continue through these steps without separate confirmation. A user restriction such as plan-only, review-only, do not push, or do not merge narrows this authority. Existing authorization persists across steps and handoffs; do not request it again.

Read-only inspection of the known repository, PR, CI, or relevant provider account is authorized within the task's scope. An external endpoint alone does not require approval. Establish the actual account and target from evidence; do not guess an ambiguous cloud target. Inspect unfamiliar commands for side effects: Alchemy plan can mutate provider state and is not covered as a read-only check.

This authority covers GitHub delivery messages in the task's PR and repository. It does not authorize the separate product, provider, publication, or production effects listed in [AGENTS.md](../../AGENTS.md). A merge that triggers deployment needs authorization for that deployment's actual effect and target before proceeding.

## Ownership and persistence

One delivery owner carries a scoped request from current source through implementation, relevant verification, and in-scope corrections. Use the existing work item or user request as the plan when its outcome is clear. Do not stop after a first implementation to request permission for ordinary fixes.

Use a coordinator only when concurrent work, dependencies, or ownership conflicts need one. A separate planner, reviewer task, status aggregator, or handoff is not a prerequisite for routine edits. Create user-visible tasks only when the user asks for them. Bounded subagents may assist with independent investigation or review when useful; give each a clear scope, permissions, and stopping point. Keep one writer per file set and verify returned evidence before acting on it.

Preserve unrelated work and use [worktree isolation](../../.agents/skills/worktree-isolation/SKILL.md) when a separate checkout is needed. New implementation worktrees normally start from the fetched remote default; respect an explicitly requested branch or current-work continuation. Do not reset, stash, or rebase someone else's work to establish a clean baseline.

## Verification and review

Select tests and runtime probes for the changed contract. Local disposable tests and their in-scope repairs may proceed under the task's authorization. Do not add tests that merely match wording or mirror implementation. Rerun affected checks after a fix; repeat broader validation only for changed dependencies, new failures, required gates, or a material evidence gap.

Meaningful behavioural or workflow changes need one independent review of an immutable head before merge. Typographical, formatting, and other low-impact edits do not need a separate reviewer. High-risk authority, privacy, persistence, replay, and irreversible-data designs may benefit from focused early review of the specific uncertainty; this does not gate unrelated safe work.

Reviewers are read-only. They check scope, correctness, simplicity, and the evidence needed for the claim. Findings need a concrete location and consequence. The delivery owner fixes proven in-scope defects and verifies the correction; a reviewer does not control edit permission or expand the assignment. Refresh review for changes that affect its conclusions, rather than restarting the whole review after every administrative edit.

For each material finding, fix it, explain why it does not apply, record a concrete out-of-scope follow-up, or surface the remaining decision. Do not turn hypothetical hardening into a blocker. A serious unresolved defect prevents claiming the outcome complete; a local compiler error or flaky tool is work to investigate, not a request for human approval.

## External authority

The effect boundaries in [AGENTS.md](../../AGENTS.md) apply throughout the task. Existing approval covers the effect and target actually authorized; skills cannot grant additional scope or demand repeat approval for that same action.

When approval is missing, complete safe implementation and verification first, then show the concrete effect for approval. Stop only the dependent action. Never claim a local fixture proves a provider action occurred. Do not repeat an effect whose outcome is unknown; inspect its retained outcome or recovery path.

Under standing delivery authority, merge only the intended head with required checks satisfied, material findings addressed, required independent review complete, and claimed acceptance supported by relevant evidence, including real runtime evidence for runtime or user-visible changes. Green CI alone does not establish correctness or expand authority.

## Asynchronous work

Only one owner watches a PR or event. Use a bounded wait or a requested follow-up; do not create recurring automation just because CI is pending. Watchers report meaningful changes and stop when resolved, closed, or no longer actionable.

If a read/control endpoint times out, try at most one targeted fallback. When it reveals no decision-relevant change, end that polling attempt and continue other useful work. Do not replay unchanged checks, approvals, or delivery attempts. Unknown state stays unknown.

## Completion

Finish when the requested outcome is implemented and appropriately verified, in-scope defects are resolved, required review is complete, and any remaining external gate has been reached with a concrete result ready for approval. Report the result, evidence, and actual remaining limitation. Do not turn a completed task into open-ended polishing or end with an unsolicited new workflow.

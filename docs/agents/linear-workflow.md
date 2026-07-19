# Linear Workflow

Linear is the durable source of truth for non-trivial software product work.

## Defaults

- Start non-trivial features as a Linear Project or PRD document.
- Break approved work into vertical-slice Issues.
- Use Linear blocker relations for dependency graphs.
- Use one user-visible Codex worker thread per implementation issue.
- Create one read-only reviewer/spec thread at dispatch time for every
  non-trivial implementation.
- Keep worker evidence in the Codex thread, Linear issue, and PR.

## Issue Lifecycle

Read the current team's statuses and labels live before changing issue state;
do not treat this document as a second mapping. Preserve this semantic flow:

1. Intake: work exists but is not ready for execution.
2. Executable: scope, acceptance criteria, and dependencies are clear.
3. Implementation: one worker thread owns the issue.
4. Review: the implementation and evidence are ready for reviewer/spec checks.
5. Accepted: the orchestrator has accepted the evidence and merge/deploy state.
6. Blocked: an external decision or dependency prevents progress; represent the
   dependency with current Linear relations and live workflow conventions.

## Pull Requests

- One issue should produce one PR by default.
- Link PRs to Linear Issues.
- Do not merge while required blockers, reviewer requests, or CI failures remain.
- Prefer small, continuously integrated slices over broad branches.

## Evidence

Every completed issue should record:

- implemented scope
- verification commands and results
- Browser/preview evidence when user-visible behavior changed
- known risks or follow-up issues

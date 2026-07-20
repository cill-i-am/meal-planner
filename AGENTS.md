# Meal Planner Agent Instructions

## Scope

This file governs the whole repository. Put narrower instructions in a nested `AGENTS.md` only when a subtree develops materially different constraints; do not duplicate these repo-wide rules into tool-specific instruction files.

## Sources Of Truth

- Linear owns non-trivial software product work, issue readiness, blockers, delivery state, and the current Project or PRD. Read those values live rather than persisting team, status, label, or Initiative mappings in this repo.
- [`docs/source-of-truth.md`](docs/source-of-truth.md) owns durable household meal-planning intent and links to the currently approved plan.
- [`docs/preferences-and-constraints.md`](docs/preferences-and-constraints.md) owns enduring household constraints.
- [`docs/current-week.md`](docs/current-week.md) is the routing point for the currently approved meal plan and shopping list. Drafts are not active until explicitly approved.
- [`docs/agents/README.md`](docs/agents/README.md) indexes the Linear-backed agent workflow used for implementation work.

## Repository Workflow

- This is a pnpm monorepo. Use the root `pnpm` scripts for build, check, test, lint, and formatting unless a narrower command is the correct verification.
- Inspect the current Git state before editing. Preserve unrelated user changes and use isolated worktrees for non-trivial worker threads.
- Keep changes scoped to the selected Linear issue or explicit user request.
- Record verification commands and results; use runtime evidence when behavior is user-visible.
- Never expose Tesco credentials, cookie material, authorization values, raw provider responses, or other secrets in source, logs, issues, PRs, or agent handoffs.
- Tesco mutations, basket changes, checkout, payment, publishing, and external messages require the explicit approval boundary documented by the relevant issue or household workflow.

## Agent Skills

- Read [`docs/agents/linear-workflow.md`](docs/agents/linear-workflow.md) for the durable Project, Issue, blocker, thread, PR, and evidence loop.
- Read [`docs/agents/triage-states.md`](docs/agents/triage-states.md) before classifying or grooming work.
- Read [`docs/agents/domain.md`](docs/agents/domain.md) before changing durable product or household intent.
- Read [`docs/agents/execution-policy.md`](docs/agents/execution-policy.md) before dispatching workers or reviewers, handing off a PR, or changing Linear state.
- Use the templates indexed by [`docs/agents/README.md`](docs/agents/README.md) for PRDs, issues, worker threads, and reviewer threads.
- Run `linear-setup` again when these workflow docs or their pointers need to be refreshed. Use `to-prd`, `to-issues`, `triage`, `orchestrator`, `worker`, `production-ready`, and `ci-watch` only within this documented workflow.

# Library consolidation — Implementation handoffs

- Status: Proposed planning track; no application implementation claimed.
- Planned: 2026-09-16.
- Planning baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Format: Existing [work-item template](../work-item-template.md) and
  [repository workflow](../../agents/repository-workflow.md).

The user requested a plan for each phase in a separate open PR so an
implementation agent can pick up each work item. These PRs change documentation
only and are independently based on main. They are not stacked implementation
PRs, do not promote the numbered product stages, and do not authorize deployment
or paid provider work. No planning PR has been merged by the planning task.

## Planning PRs

| Phase | Planning PR | Outcome when implemented |
| --- | --- | --- |
| 1 — Effect browser runtime | [#219](https://github.com/cill-i-am/meal-planner/pull/219) | One version-checked browser integration for the existing generated HTTP clients; preserve unknown-outcome recovery and identity isolation. |
| 2 — Private interview state and streaming | [#221](https://github.com/cill-i-am/meal-planner/pull/221) | Replace generic observable/chat machinery using the selected atoms and TanStack AI while preserving native private-send authority. |
| 3 — Schema and JSON utilities | [#223](https://github.com/cill-i-am/meal-planner/pull/223) | Reuse Standard Schema for form validation and replace JSON equality only if admitted semantics are preserved. |
| 4 — Architecture guard assessment, optional | [#225](https://github.com/cill-i-am/meal-planner/pull/225) | Adopt dependency-cruiser only if meaningful generic code disappears without weakening semantic D1 checks; retaining the guard is a valid result. |

Each PR links its work item on that PR's branch. This keeps every planning PR
readable on its own before the sibling documents have merged. Planned files in
this directory are `01-effect-browser-runtime.md`,
`02-private-interview-client-and-streaming.md`,
`03-schema-and-json-utilities.md`, and
`04-architecture-guard-assessment.md`.

## Implementation order and parallel work

Implement Phase 1's profile slice and compatibility/runtime decision first.
Phase 2 then consumes that actual result and can be split into a state refactor
and a TanStack AI adapter integration. Phase 3's isolated equality investigation
can proceed independently; its form changes must coordinate the profile and
private correction boundaries with Phases 1 and 2. Phase 4 is optional and
independent, and must not block higher-priority delivery.

Only one agent writes a shared file set or lockfile at a time. The independence
of these documentation branches does not imply their implementations are
conflict-free. Start from current fetched main unless an explicit dependency
branch is agreed; preserve unrelated work and use isolated worktrees under the
[execution policy](../../agents/execution-policy.md).

[Discovery PR #218](https://github.com/cill-i-am/meal-planner/pull/218) is active,
unmerged work beyond the audited main. The observed head was
`2fd5d7f315bf98de10d74792b2269f8f020e1f76`. Recheck its current status and
changed paths before implementation, especially Phase 2. Do not overwrite that
work or infer its outstanding model-evaluation acceptance from transport tests.

## State ownership target

LiveStore remains the selected direction for appropriate replicated household
data, not a replication implementation in this track. Non-replicated commands
and queries retain the existing Effect HTTP contracts. Phase 1 selects one
verified browser integration. Atoms own appropriate local/derived non-chat
state; TanStack AI owns transient chat presentation, not canonical history or
profile mutation authority. Existing domain code owns admission, private
publication, versioned confirmation, idempotency, and provider budgets.

Do not maintain competing authoritative caches for the same data, replicate
private transcripts household-wide, or publish unvalidated provider output to
obtain apparent token streaming. Completing these phases does not mean the
entire intended LiveStore architecture has been delivered.

## Assigning a phase to an agent

Use the following handoff with the selected planning PR and work-item path:

> Implement the work item in planning PR <number> for cill-i-am/meal-planner.
> Read its exact plan and the current repository execution policy. Establish
> current main, resolve the named prerequisites and overlapping PR ownership,
> and use the work item as the implementation plan. Preserve its domain and
> privacy guarantees, execute the required verification, and deliver a separate
> implementation PR with actual evidence. Do not mistake the planning PR for
> completed application work or infer authorization for cloud/provider effects.

Every work item includes source locations, scope, ordered implementation steps,
deletion or no-adoption criteria, acceptance evidence, coordination constraints,
and a delivery record. Keep compatibility/runtime claims tied to the exact
implementation head; this planning task did not execute those probes.

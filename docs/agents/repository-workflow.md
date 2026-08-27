# Repository-Owned Agent Workflow

## Authority

New Meal Planner product work is planned and tracked in the repository.

Read authority in this order:

1. `docs/product-blueprint/` for long-horizon product intent;
2. `docs/decisions/product/` for accepted product choices;
3. `docs/architecture/decisions/` and current architecture docs for technical
   boundaries;
4. `docs/delivery/current.md` for the active stage and immediate next work;
5. the owning stage/work-item record for exact scope and evidence; and
6. the exact pull request head for implementation under review.

Linear is not authoritative for new work. Do not create, update, or infer work
state from Linear unless the user explicitly changes this policy in a recorded
decision.

## Decide

Before implementation, identify unresolved product or architecture questions.

- Record product behaviour under `docs/decisions/product/`.
- Record durable technical boundaries as ADRs under
  `docs/architecture/decisions/`.
- Do not let a convenient code shape silently answer privacy, authority, safety,
  or plan-semantics questions.

## Plan

Create or update one repository delivery work item using
`docs/delivery/work-item-template.md`.

A ready work item includes:

- household outcome;
- accepted decision and ADR links;
- in-scope and excluded behaviour;
- authority and privacy boundary;
- failure, replay, and concurrency expectations;
- one production vertical tracer; and
- acceptance and repository evidence.

## Build

- Start from freshly fetched `main` in an isolated branch or worktree.
- Preserve unrelated user changes.
- Keep the diff scoped to the work item or named atomic cutover.
- Follow the greenfield policy: delete superseded experimental paths rather
  than adding unapproved compatibility machinery.
- Keep providers and external effects behind typed ports and approval
  boundaries.

## Verify

Use the narrowest meaningful tests during development and finish with the gates
required by the work item and repository instructions. User-visible claims need
runtime or behavioural evidence, not only source inspection.

Record exact commands, results, and any known limitations in the work item or
pull request.

## Review

For high-risk authority, privacy, persistence, or workflow work:

- freeze an exact head;
- obtain an independent read-only review;
- dispose every concrete finding;
- rerun relevant verification after fixes; and
- merge only the reviewed head.

A pull-request description may summarize evidence, but the repository work item
owns durable delivery state.

## Complete

After merge:

- mark the work item Done with the merge commit and evidence;
- update `docs/delivery/current.md`;
- update current-state architecture and public documentation if authority or
  behaviour changed; and
- remove or supersede obsolete delivery paths rather than leaving contradictory
  active records.

## External Effects

Cloud deployment, provider calls, destructive D1/R2 operations, retailer
mutations, external messages, checkout, payment, and similar effects require a
separate explicit approval boundary. Planning and tests must not silently
perform them.
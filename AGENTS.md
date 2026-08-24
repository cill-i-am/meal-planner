# Meal Planner Agent Instructions

## Scope

This file governs the whole repository. Put narrower instructions in a nested
`AGENTS.md` only when a subtree develops materially different constraints; do
not duplicate these repo-wide rules into tool-specific instruction files.

## Sources Of Truth

Read repository authority in this order:

1. [`docs/product-blueprint/`](docs/product-blueprint/) owns long-horizon
   household product intent, experience, domain language, beta proof, and the
   staged capability sequence.
2. [`docs/decisions/product/`](docs/decisions/product/) owns accepted product
   decisions.
3. [`docs/architecture/decisions/`](docs/architecture/decisions/) and the current
   architecture documents own durable technical boundaries and implemented
   authority.
4. [`docs/delivery/current.md`](docs/delivery/current.md) and the owning
   stage/work-item record own active scope, blockers, status, and evidence.
5. Pull requests own review of one exact implementation head; after merge,
   durable state returns to the repository records above.

Linear is not authoritative for new Meal Planner work. Do not create, update, or
infer delivery state from Linear unless the user explicitly changes this policy
through an accepted repository decision.

## Repository Workflow

- This is a pnpm monorepo. Use the root `pnpm` scripts for build, check, test,
  lint, and formatting unless a narrower command is the correct verification.
- Inspect the current Git state before editing. Preserve unrelated user changes
  and use isolated worktrees for non-trivial worker threads.
- Keep changes scoped to the owning repository work item or explicit user
  request.
- Record verification commands and results; use runtime evidence when behaviour
  is user-visible.
- Update current-state architecture and public documentation in the same change
  when authority or product behaviour moves.
- Never expose Tesco credentials, cookie material, authorization values, raw
  provider responses, interview transcripts, or other secrets in source, logs,
  work items, PRs, or agent handoffs.
- Tesco mutations, basket changes, checkout, payment, publishing, external
  messages, deployment, and destructive cloud operations require a separately
  recorded explicit approval boundary.

## Decision Discipline

- Product behaviour, privacy, safety, authority, and plan semantics belong in a
  product decision record when they need durable resolution.
- Long-lived technical and consistency choices belong in an ADR.
- Do not let a convenient implementation shape silently answer an unresolved
  product or architecture question.
- Keep decision records focused. Do not turn every local refactor into an ADR.
- When a decision changes, name the superseding record and update dependent
  blueprint, delivery, and architecture documents.

## Greenfield Architecture

- Treat this repository as a greenfield product unless an accepted record
  identifies production data, external consumers, or a compatibility contract
  that must be preserved.
- Prefer the best current architecture and clearest domain model over preserving
  experimental structures. Substantial refactors, schema resets, and
  replacement of prototypes are acceptable when they improve the design.
- Do not add compatibility shims, legacy adapters, dual-write paths, backfills,
  backwards-compatibility behaviour, or portability machinery without first
  explaining the concrete need and receiving explicit approval in a decision
  record.
- Exploration is encouraged, but converge by deleting superseded paths rather
  than carrying multiple architectures forward. Keep reusable domain knowledge
  and proven behaviour; do not preserve accidental implementation shape.
- Design clean boundaries and stable domain identifiers where intrinsically
  valuable, but do not confuse future extensibility with an obligation to build
  unused abstractions now.

## Agent Workflow

- Read [`docs/agents/repository-workflow.md`](docs/agents/repository-workflow.md)
  before planning or delivering non-trivial work.
- Read [`docs/agents/domain.md`](docs/agents/domain.md) before changing durable
  product or household intent.
- Read [`docs/agents/execution-policy.md`](docs/agents/execution-policy.md)
  before dispatching workers or reviewers or handing off a PR.
- Use [`docs/delivery/work-item-template.md`](docs/delivery/work-item-template.md)
  for implementation work.
- Use the templates indexed by [`docs/agents/README.md`](docs/agents/README.md)
  for worker and reviewer handoffs.
- Do not use Linear-oriented skills or workflow documents for new work unless
  the user explicitly requests a separately approved return to that system.
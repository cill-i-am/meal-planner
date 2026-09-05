# Meal Planner

This file governs the repository. Add nested instructions only for a real local constraint; keep each rule in one place.

## Working here

Use pnpm and the scripts in `package.json`; choose checks for the changed behaviour. Preserve unrelated work. Use an isolated worktree for substantial changes when the current checkout is dirty, stale, or shared.

Carry the requested outcome through implementation, relevant verification, and in-scope fixes. Local source edits, disposable local tests, builds, browser checks, and rerunning affected checks are authorized within the task. Inspect unfamiliar scripts before assuming they are local. Ask only when a missing decision or unauthorized effect prevents the next step; continue independent work in the meantime.

Keep greenfield designs direct. Delete superseded experimental paths. Compatibility shims, dual writes, backfills, and portability machinery require a concrete existing contract and explicit approval; do not build them for hypothetical future consumers.

## Context when needed

- Product meaning: [blueprint](docs/product-blueprint/), [accepted product decisions](docs/decisions/product/), and [domain conventions](docs/agents/domain.md).
- Technical boundaries: [architecture](docs/architecture/) and [ADRs](docs/architecture/decisions/).
- Ongoing product work: [current delivery](docs/delivery/current.md) and its owning work item. Repository records own delivery; Linear is not used for new work.
- Delivery and review: [repository workflow](docs/agents/repository-workflow.md) and [execution policy](docs/agents/execution-policy.md).
- Skills: load a skill only when its task-specific guidance helps; read supporting references as needed. These project copies are maintained locally, not bulk-synced from an upstream skill bundle.

Use these links to answer the task's questions, not as a reading checklist. A clear, bounded user request does not need a new work item, planner, or handoff. Record consequential product/architecture choices and update affected documentation when behaviour or authority changes.

## External effects and private data

Tesco/provider mutations, basket changes, checkout, payment, external messages, publication, deployment, destructive cloud operations, and irreversible data changes need explicit authorization covering the actual effect and target. Existing authorization remains valid within its scope; record it where needed rather than asking again. Finish safe preparation before seeking missing approval.

Keep credentials, cookies, authorization values, raw private provider data, and interview transcripts out of source, logs, work records, PRs, and handoffs. Draft meal plans and shopping previews are not household approval.

# Repository-Owned Delivery

## Authority

Meal Planner plans and tracks product delivery in this repository. Linear is not
a source of truth for new work.

The authority chain is:

1. [`../product-blueprint`](../product-blueprint/) — long-horizon product promise,
   experience, domain language, beta proof, and capability sequence.
2. [`../decisions`](../decisions/) — accepted product decisions.
3. [`../architecture/decisions`](../architecture/decisions/) and current
   architecture docs — durable technical boundaries and implemented authority.
4. [`current.md`](current.md) and stage/work-item records — active scope,
   dependencies, status, and evidence.
5. Pull requests — reviewed implementation and documentation changes.

A pull request may implement or refine an accepted work item. It may not silently
reverse an accepted product decision or ADR.

## Delivery Model

Work proceeds through repository records and pull requests:

```text
Decide
  -> define product decision or ADR when required
Plan
  -> write a stage or vertical work item with acceptance evidence
Build
  -> implement in an isolated branch or worktree
Verify
  -> record focused and repository-wide evidence
Review
  -> dispose concrete findings against the exact head
Merge
  -> update current delivery state and any changed authority docs
```

## Records

### Current state

[`current.md`](current.md) names the active stage, current dependencies, open
pull requests, and immediate next work. Keep it brief and update it when delivery
state changes.

### Stage records

A stage record defines an outcome, product assumptions, dependency map, vertical
tracers, explicit exclusions, and exit evidence. The capability sequence begins
in the product blueprint's
[`delivery-roadmap.md`](../product-blueprint/delivery-roadmap.md).

### Work items

A work item is the smallest independently reviewable vertical change that adds
product or architecture evidence. Use
[`work-item-template.md`](work-item-template.md). Work-item filenames should use
an ordered identifier and concise slug, for example:

```text
docs/delivery/stages/01-household-people/
  README.md
  01-person-identity-and-lifecycle.md
  02-profile-authority-and-audit.md
```

A work item owns its status. Do not duplicate mutable status across several
indexes.

## Work-Item Status

Use:

- `Proposed` — needs product or architecture resolution;
- `Ready` — dependencies and acceptance evidence are explicit;
- `In progress` — one active implementation lane owns it;
- `In review` — exact head is frozen for review;
- `Blocked` — blocker and removal condition are recorded;
- `Done` — merged evidence satisfies the accepted scope; or
- `Superseded` — replaced by a named record.

## Required Evidence

Every implementation work item should state:

- household/user outcome;
- accepted decision and ADR links;
- exact in-scope and out-of-scope behaviour;
- authority and privacy effects;
- failure and replay expectations;
- focused product/runtime tests;
- repository verification gates;
- documentation updates; and
- the pull request or merge commit that completed it.

User-visible work needs behavioural evidence. Schema or source-string checks
alone do not prove the product outcome.

## Greenfield Rule

This remains a greenfield product unless a record identifies production data,
external consumers, or another real compatibility contract. Do not add legacy
adapters, dual writes, backfills, compatibility reads, or portability machinery
without an accepted decision explaining the need.

## Pull Request Discipline

- Keep a pull request scoped to one coherent work item or explicitly named
  coupled cutover.
- Base it on freshly fetched `main`.
- Link the owning delivery and decision records.
- Update current-state architecture in the same change when authority moves.
- Record exact verification commands and results.
- Freeze and review the exact head before merge for high-risk boundaries.
- After merge, update the owning work item and `current.md` rather than relying on
  stale pull-request descriptions as delivery state.
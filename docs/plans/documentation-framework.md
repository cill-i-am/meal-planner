# Shared documentation and simpler agent instructions

Status: done
Owner: Codex — assigned repository refactor
Delivery: [PR #234](https://github.com/cill-i-am/meal-planner/pull/234), merged on 2026-09-20 as `f9a576ba526d3a1a578dbc75f18033a3aab7b70f`

## Outcome and scope

Replace overlapping docs and workflows with one documentation library, decision
register, and set of plans. Make agents use the engineering guidance that human
contributors use. Keep the full coding-standards library and explicitly require
reading the relevant parts before code changes.

The refactor changed documentation and agent guidance, not application behavior,
providers, dependencies, deployment, other PR states, or personal agent settings.

## What moved and what stayed

| Material | Result |
| --- | --- |
| Thirteen coding-standard topics | Moved unchanged to `docs/reference/engineering/` in #234; kept the skill and required root links |
| Product blueprint | Product explanations, domain reference, and plans, without a second roadmap or question list |
| ADRs and PDRs | One register with the original IDs, dates, and decisions |
| Architecture and operations | Feature contracts and task guides |
| Stages, work items, and current delivery | One plans index and a record for each outcome, with original evidence linked |
| Discovery evaluation, tone work, and import findings | Still unfinished in their own plans |
| Onboarding G01–G14 | One onboarding plan, with a pointer for the old tool-consumed path |
| Permission, workflow, and handoff documents | Deleted, not renamed into another policy |
| Twelve generic skills | Removed; useful testing and performance examples kept |
| Specialist entrypoints | Six: coding-standards, Effect, Alchemy, forms, routing, and Impeccable |
| Proposals #219–#225 | Four plans; later dependent PRs refine those same records |

The starting commit was `1912513fefd35c009c09168035b9c0e0b872c1fb`.
Before editing, the downloaded snapshot matched tree
`5552bfd2cc4ca280876089eedd65198bb1014abc`.
The source already used base Agent and TanStack. The old plain-session example
was not copied into the current reference. Its decision history remains available.

## Acceptance

- [x] Keep all thirteen standards topics and both entrypoints. Require relevant
  reading for code work, not a tour of every document.
- [x] Keep decision IDs and history, G01–G14, discovery evaluation including sixteen
  required human ratings, tone work, and later beta requirements. Do not mark them
  complete as a result of moving their records.
- [x] Remove duplicate documentation owners, process documents, and generic skills.
- [x] Keep PRODUCT.md/DESIGN.md paths, visual assets, and engine/hook configuration.
  Fix links rather than invent another loader.
- [x] Pass documentation fixtures, link/metadata checks, and required CI.
- [x] Open the PR with the checked changes and their known limits.

## Evidence and limits

The [preparation run](https://github.com/cill-i-am/meal-planner/actions/runs/35530449658)
matched the candidate tree and compared all thirteen standards files byte-for-byte
with the old files. All 24 checker tests passed. The checker found zero errors in
273 Markdown files. Frozen installation and formatting passed with the pinned
pnpm/Node versions. Application source and the lockfile did not change.

The [final framework CI run](https://github.com/cill-i-am/meal-planner/actions/runs/35532158635)
passed Quality and Synthetic media container for
`be67055945cc3a02f3fe58d0a3cfd348e8107e2e`. This replaces the earlier pending-CI
note. #234 then merged on 2026-09-20.

The checker verifies file links and record structure. It cannot prove that Astra
read or followed a document. The original byte comparison records the migration;
it does not prohibit later, reviewed edits to the standards' prose.

No live Paper or Impeccable session, independent agent review, or fresh Astra
root/subtree/subagent/resume comparison was run for this refactor. Those checks
remain unverified. They should test whether agents finish assigned work, preserve
requirements, and respect the requested endpoint without needless questions.

Temporary transfer workflows were used because the editing shell could not reach
GitHub. They are absent from the delivered files and are not permanent tooling.

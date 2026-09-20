# Unified documentation, intent and specialist skills

Status: active
Owner: Codex — assigned repository refactor
Delivery: one open PR; no merge, deployment or application behavior change

## Outcome and scope

Replace overlapping documentation/workflow systems with one shared knowledge
library, decision register and outcome-plan system. Root instructions route agents
to the same engineering contracts humans use. Implement the approved v4 direction,
with the later requirement to preserve the full coding-standards library and make
reading it explicit for code work. No application/provider/library migration,
other-PR closure or personal/global configuration change belongs to this refactor.

## Preservation and disposition

| Previous owner | New owner or disposition |
| --- | --- |
| Coding-standards skill's 13 topic documents | Full, byte-identical documents in `docs/reference/engineering/`; retained skill plus required root routing |
| Product blueprint | Explanation/product, product-domain reference and outcome plans; no second roadmap/open-question catalogue |
| ADR and PDR trees | One decision register, original identifiers and dated decisions preserved |
| Current architecture and operations | Capability references and task how-to guides |
| Stage/work-item/current-delivery overlap | One plans entrypoint; owning acceptance and compact completed records with immutable original evidence |
| Discovery evaluation/tone and import audit findings | Explicit unfinished owning plans; no invented quality pass |
| Onboarding G01–G14 | One onboarding plan, with a tool-compatible pointer at the old path |
| Generic workflow/permission/handoff docs | Deleted, not renamed into another policy |
| Twelve generic skill wrappers | Removed; useful testing and performance references retained |
| Specialist skills | Six: coding-standards, Effect, Alchemy, forms, routing and Impeccable |
| Overlapping proposals #219–#225 | Four consolidated proposed scopes with immutable source heads; existing PRs untouched |

The reviewed baseline is `1912513fefd35c009c09168035b9c0e0b872c1fb`.
The captured tree was independently hash-matched to
`5552bfd2cc4ca280876089eedd65198bb1014abc` before local edits. The current source
already uses base Agent/TanStack; the proposal's older plain-session example was
not copied into the new private-discovery reference. Historical ADR decisions
remain available, with an explicit route to the current contract.

## Acceptance

- [x] Preserve all thirteen complete coding-standard topics and both instruction
  entrypoints; require relevant reading for code without a whole-repo reading tour.
- [x] Preserve decision IDs/provenance, all G01–G14 items, unfinished discovery
  evaluation, sixteen actual human ratings, tone work and later-stage beta gates.
- [x] Consolidate ownership and remove the redundant process documents/skill wrappers.
- [x] Preserve PRODUCT.md/DESIGN.md consumer paths, visual assets and engine/hook
  configuration; repair affected links instead of inventing a replacement loader.
- [ ] Pass documentation fixtures, repository link/metadata checks and required CI.
- [ ] Publish the verified candidate as an open PR and report actual limitations.

## Evidence and limits

The documentation checker tests real temporary file trees and failures, not source
wording. It checks routes, not whether Astra actually read or obeyed them. Exact
coding-standard preservation and application-source equality are one-time migration
checks; standards are not frozen against future intentional changes.

No local application install, live Paper session, Impeccable binary execution,
independent agent review or fresh Astra root/subtree/subagent/resume comparison is
claimed. The current environment has no runnable Codex session or application
dependencies. Required hosted checks belong to the actual PR head. Follow-up runtime
validation should verify that assigned work continues across milestones, preserves
contracts and respects the requested endpoint without needless clarification.

Temporary branch-only GitHub workflows transfer the immutable baseline/proposal
snapshots and verified edits because this shell cannot access GitHub. They are
removed from the final candidate tree; no such workflow becomes permanent tooling.

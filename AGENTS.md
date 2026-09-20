# Agent instructions

Use pnpm and repository scripts; inspect unfamiliar commands for side effects. Complete the assigned plan through implementation, relevant verification, in-scope fixes and the requested delivery. Milestones are not approval checkpoints. Make routine choices from evidence and continue.

Implementation requests include ordinary repository delivery through merge once required checks and reviews pass, unless the request sets a narrower endpoint. They do not authorize deployment or non-repository effects. Reuse existing in-scope authorization. For a genuine blocker, continue independent work and report the exact unmet requirement; never weaken acceptance to declare success.

## Code changes

Read the [engineering standards index](docs/reference/engineering/README.md) and the topics relevant to the changed code before implementation or review. This is required, not dependent on automatic skill selection. Pass these links to coding subagents. Copy-only and documentation-only tasks need no standards tour.

Preserve typed domain invariants; decode at owning boundaries and use the decoded value. Keep one authoritative state owner, explicit failures and exact-command recovery. Keep pure logic direct and effectful workflows scoped. Prefer cohesive local code over speculative abstractions or compatibility layers. Verify behavior, not implementation-shaped assertions; do not weaken types, checks or privacy.

## Context and delivery

Read nested instructions applicable to changed paths. Use [the docs map](docs/README.md) for missing context and capability contracts when changing boundaries. Skills supply methods, not extra phases. Preserve unrelated work and isolate shared/dirty checkouts. Keep credentials and private data out of source, logs and work records. Keep the owning plan and affected docs current. Planning/review-only requests stay in scope. Report results, evidence and unfinished acceptance honestly.

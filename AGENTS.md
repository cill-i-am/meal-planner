# Agent instructions

## Build the right thing

This is a greenfield application. Replace obsolete code rather than adding backward-compatible shims, legacy guards, workarounds or parallel implementations. Rearchitect when the requirements call for it, and update affected callers together. Keep validation, access checks and protections against data loss; these are not compatibility workarounds.

Prefer reliable, secure open-source libraries to custom code. Use supported extensions when a library needs adapting. Build from scratch only when existing options cannot meet the requirements efficiently.

Choose the simplest solution that meets the requirements. Avoid speculative abstractions and overengineering. Do not add unnecessary wrappers or abstractions around supported tools. Use their native commands and APIs; do not invent deployment or database preflight layers.

For app-owned browser/server APIs, define a shared Effect HttpApi contract and use its generated client and Effect handler. Keep remote query/mutation state with the chosen React adapter; do not hand-write fetch and JSON decoding when the contract covers them. Use [runtime import intents](apps/api/src/features/households/recipe-import/household-recipe-import.contract.ts) for durable asynchronous work, not as the default shape for creating an ordinary domain entity. See [protocol contracts](docs/reference/engineering/FEATURE_SLICE_ARCHITECTURE.md#protocol-contracts) and [workflow selection](docs/reference/engineering/ASYNC_AND_WORKFLOWS.md#workflow-selection).

When using or changing an API or library, always check its current official documentation against the installed version. Do not upgrade just to match an example.

Write tests that provide meaningful confidence and prevent regressions. Avoid redundant tests and unjustified release gates. Run checks suited to the change and any required checks; repeat them when changes, failures or unresolved concerns justify it. Never weaken a valid check to claim success.

## Read the relevant guidance

Before implementing or reviewing code, read the [engineering standards index](docs/reference/engineering/README.md) and its relevant topics. This is required even when no skill is selected. Give coding subagents the same links. Documentation-only edits need no coding-standards tour.

Keep domain rules in types. Decode inputs at the responsible boundary and use the decoded values. Give state one authoritative owner, handle failures explicitly, and preserve the original request when its result is unknown. Keep pure logic direct and give effectful work a clear lifetime.

Read nested instructions for the files you change. Use [the docs map](docs/README.md) for missing context. Follow [the writing guidelines](docs/reference/documentation.md#writing-style) for docs, plans, PR descriptions and explanations: use plain English without losing technical meaning. Skills provide methods, not extra approval steps.

Use the [feature map](docs/reference/features/README.md) to find domain owners, contracts and verification. Read the linked local instructions for the feature you change and update its entry when ownership or observable behavior changes.

## Agent workflow

Use the installed pstack `poteto-mode` as the execution workflow for engineering work here. Read its `SKILL.md`, `CODEX.md` and the applicable playbook. Its source is `ScriptedAlchemy/pstack-codex`; report an unavailable installation and continue supported work rather than claiming it loaded. This repository's agreed scope and rules govern how imported skills apply.

Agree product direction, domain responsibilities and success criteria with Cillian. Then own implementation, TDD where behavior changes, independent review, runtime verification, CI monitoring, conflict resolution and merge. Delegate independent implementation and review to subagents in isolated worktrees. Fix in-scope findings and continue; return for a material change to the agreed direction or a genuine unresolved blocker. Run pstack Babysit and then Shipping automatically for implementation requests. A merge-ready report is not the delivery endpoint.

Matt's local skills own shaping, domain modeling, deepening and retrospectives; they do not start a second execution loop. Use `grill-with-docs` for unresolved product/domain decisions, `codebase-design` and `improve-codebase-architecture` for module design/gardening, and `retro` for recurring friction. Existing approved scope satisfies routine candidate selection and implementation priorities. Use `matt-teach` for learning; pstack `teach`/`how`/`why` and Psychopomp explain the system on request. Pstack owns TDD. Use the [domain configuration](docs/agents/domain.md) and [repository planning configuration](docs/agents/issue-tracker.md) rather than creating a second glossary, ADR tree or tracker.

Choose design exploration and independent verification to match the change. A small edit does not require a fixed agent panel, new interview, diagram, scratch probe or custom tool when existing evidence and native commands suffice. Preserve meaningful reviews, real user-path proof and checks for the changed risks. Native Alchemy and installed APIs take precedence over generic setup examples. Skills must reuse authorization already given for the same scope and target; they cannot authorize unrelated external actions or weaken product consent.

## Finish the assigned work

When creating subagents, choose the model best suited to the job from Sol, Luna and Astra, with reasoning effort appropriate to the task's complexity and risk. Use `fork_turns="none"` when a self-contained task brief is sufficient; provide full context only when the subagent needs it.

Complete the assigned plan, check the result, fix related failures and reach the requested delivery point. Do not ask whether to continue at each milestone. Make routine decisions from the available evidence.

Implementation requests include repository work through merge after required checks and reviews pass, unless the request sets a narrower endpoint. This does not authorize unrelated external actions. Use permission already given for the same work. If something is genuinely blocked, finish the independent work and report the exact problem. Planning-only and review-only requests stay in scope.

Preserve unrelated changes and use a separate checkout when work would conflict. Keep credentials and private data out of source, logs and work records. Update the plan and affected docs. Report what changed, what was checked and what remains.

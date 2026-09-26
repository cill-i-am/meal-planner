# Agent instructions

## Build the right thing

This is a greenfield application. Replace obsolete code rather than adding backward-compatible shims, legacy guards, workarounds or parallel implementations. Rearchitect when the requirements call for it, and update affected callers together. Keep validation, access checks and protections against data loss; these are not compatibility workarounds.

Prefer reliable, secure open-source libraries to custom code. Use supported extensions when a library needs adapting. Build from scratch only when existing options cannot meet the requirements efficiently.

Choose the simplest solution that meets the requirements. Avoid speculative abstractions and overengineering.

For app-owned browser/server APIs, define a shared Effect HttpApi contract and use its generated client and Effect handler. Keep remote query/mutation state with the chosen React adapter; do not hand-write fetch and JSON decoding when the contract covers them. Use the [intent layer](apps/api/src/features/imports/import-intent-transition.ts) for durable asynchronous work, not as the default shape for creating an ordinary domain entity. See [protocol contracts](docs/reference/engineering/FEATURE_SLICE_ARCHITECTURE.md#protocol-contracts) and [workflow selection](docs/reference/engineering/ASYNC_AND_WORKFLOWS.md#workflow-selection).

When using or changing an API or library, always check its current official documentation against the installed version. Do not upgrade just to match an example.

Write tests that provide meaningful confidence and prevent regressions. Avoid redundant tests and unjustified release gates. Run checks suited to the change and any required checks; repeat them when changes, failures or unresolved concerns justify it. Never weaken a valid check to claim success.

## Read the relevant guidance

Before implementing or reviewing code, read the [engineering standards index](docs/reference/engineering/README.md) and its relevant topics. This is required even when no skill is selected. Give coding subagents the same links. Documentation-only edits need no coding-standards tour.

Keep domain rules in types. Decode inputs at the responsible boundary and use the decoded values. Give state one authoritative owner, handle failures explicitly, and preserve the original request when its result is unknown. Keep pure logic direct and give effectful work a clear lifetime.

Read nested instructions for the files you change. Use [the docs map](docs/README.md) for missing context. Follow [the writing guidelines](docs/reference/documentation.md#writing-style) for docs, plans, PR descriptions and explanations: use plain English without losing technical meaning. Skills provide methods, not extra approval steps.

## Finish the assigned work

When creating subagents, choose the model best suited to the job from Sol, Luna and Astra, with reasoning effort appropriate to the task's complexity and risk. Use `fork_turns="none"` when a self-contained task brief is sufficient; provide full context only when the subagent needs it.

Complete the assigned plan, check the result, fix related failures and reach the requested delivery point. Do not ask whether to continue at each milestone. Make routine decisions from the available evidence.

Implementation requests include repository work through merge after required checks and reviews pass, unless the request sets a narrower endpoint. This does not authorize deployment or other external actions. Use permission already given for the same work. If something is genuinely blocked, finish the independent work and report the exact problem. Planning-only and review-only requests stay in scope.

Preserve unrelated changes and use a separate checkout when work would conflict. Keep credentials and private data out of source, logs and work records. Update the plan and affected docs. Report what changed, what was checked and what remains.

# Documentation standard

One question has one owning record. Link to it instead of maintaining another
specification, status report or handoff. A short summary is useful; competing
mutable truth is not.

| Need | Owner |
| --- | --- |
| Orientation | Root/local README: purpose and entry links |
| Guided learning | Tutorial: exercise and observable result |
| A task procedure | How-to: prerequisites, steps and verification |
| Current contracts and conventions | Reference: ownership, invariants, boundaries, source and tests |
| Product or architectural understanding | Explanation: context and rationale, labelled future direction |
| A consequential choice | Decision: context, choice, alternatives, consequences and real acceptance |
| An outcome to deliver | Plan: scope, approach, acceptance, status and next action |
| Agent behavior | AGENTS.md: short instructions; no product encyclopedia |

Use [Diátaxis](https://diataxis.fr/) for the knowledge library. Plans and decisions
have their own lifecycle; they are not additional Diátaxis categories. Create
pages for an actual reader need, not four documents per feature or empty folders.

## Plans and decisions

Use [one outcome plan](../plans/_template.md). A one-pager, design proposal and
implementation plan are the same evolving record unless a real separate outcome
needs an owner. Start compact; expand for consequential risk. Small bounded work
can use the request and PR. Use objective, context, goals/non-goals, approach,
trade-offs, risk/validation, delivery and actual open questions, following
[the effective-design-doc approach](https://refactoringenglish.com/excerpts/write-an-effective-design-doc/).

A plan owns its status and acceptance. The [plans index](../plans/README.md) owns
sequence, not copied checklists. Parent outcomes link children and own only
integration acceptance. Use `proposed`, `ready`, `active`, `blocked`, `done` or
`cancelled`; record a replacement for cancelled/superseded work. Readiness is not
proof of implementation. Assignment of a plan covers its assigned scope across
milestones, not unrelated roadmap items. Old planning-only task wrappers do not
veto a new explicit implementation assignment.

Accepted, implemented, merged, deployed and evaluated are different claims.
Keep unmet acceptance open; a scoped deferral needs its real decision and owning
follow-up. At completion, promote reusable knowledge to reference/explanation,
retain a compact result and immutable evidence, and remove the outcome from the
active queue. Historical evidence is not a current instruction source.

Use [one decision register](../decisions/README.md). Preserve ADR/PDR identities,
actual dates, approval provenance and scoped supersession. Record consequential
product, privacy, authority, persistence and costly-to-reverse choices, not every
local implementation decision. Never invent approval. A material reversal needs
an explicit superseding decision; ordinary factual/link corrections do not.

## Intent and maintenance

A capability's reference is its intent entrypoint: what it owns, important
exclusions, non-obvious guarantees, useful source/tests and relevant neighbors.
Keep one semantic owner even across app/package directories. Explanations teach
why; decisions preserve the historical choice. No separate INTENT.md hierarchy.

AGENTS.md routes code work explicitly to the full engineering standards. The
standards are not optional simply because they live in docs. Load relevant
contracts and techniques, not every page. Preserve tool-required PRODUCT.md,
DESIGN.md, skill assets and metadata until their actual consumer supports a move.

Update the smallest owner in the change that alters behavior or acceptance.
Check links and actual consumers; fix stale source/doc conflicts rather than
silently choosing whichever text is newer. Do not rewrite history as current
behavior. Keep credentials, transcripts and raw private evidence out of records.
No separate agent permission policy, orchestration phases or handoff ledger.

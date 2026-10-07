# PDR-0013 — Present the plan clearly and test the experience

- Status: Accepted
- Date: 2026-08-26
- Owners: Household product
- Amended: 2026-10-07. Cillian directed a chat-first product experience. This
  replaces prescribed default plan layouts and administrative fact-management
  flows, while preserving privacy, authority, coverage and approval guarantees.

## Decision and reason

The product must make a household plan understandable without exposing its
internal records as an administrative interface. Chat is the primary interaction.
Introduce editable plans, recipes, summaries or controls when they help the
household understand or change the result. Presentation follows the experience
in [PRODUCT.md](../../apps/web/PRODUCT.md).

Preserve these outcomes regardless of layout:

- A shared meal accounts for exactly the people it covers; personal alternatives
  and fallback needs remain understandable.
- People can distinguish what they will eat from what someone must prepare,
  including timing, equipment and later use of prepared output.
- Repetition does not create unnecessary work. Material uncertainty, missing
  coverage, hard conflicts and consequential assumptions cannot be hidden.
- Explain meaningful choices using their actual confirmed facts, routines,
  capacity, stock or ranking reasons. Never expose private dialogue or substitute
  an unexplained score for rationale.
- Explain consequential draft repairs. Post-approval changes remain proposed
  revisions with understandable before/after effects that an adult accepts before
  they become active.

Rebuildable presentation projections are allowed but cannot own plans, coverage,
recipes, portions, approval or shopping. Stable semantic identities and version
references preserve auditability and unambiguous commands while interfaces change.
All interactions use validated, authorized product operations.

## Experimentation boundary

Routes, cards, grids, calendars, lists, density, wording, icons, expansion,
navigation and eating/cooking arrangements are not frozen contracts. Prototype
and test them against comprehension, easy focused changes, time to approval and
correction burden. Use beta observation or controlled experiments when cohort
size makes them meaningful. Click and expansion counts alone do not prove success.
Ordinary presentation changes need no new PDR. Changes to privacy, authority,
approval, coverage truth or plan semantics do.

[Beautiful UI](https://www.beautifului.dev/) is an optional pattern reference,
not a selected dependency, visual system or licence strategy. Any borrowed
patterns must suit accessibility, responsiveness and household comprehension.
Progress may describe bounded status, sources, tool activity and pending user
decisions. It must not reveal private chain-of-thought or imply that animation
has product authority.

Final layouts/navigation, diagnostic/operator projections, statistical experiment
infrastructure and personalized information density remain deferred.

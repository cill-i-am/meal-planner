# Repeat profile review and dependant assistance

Status: active — adult repeat-review seam is provider-free verified; dependant assistance remains
Owner: unassigned
Depends on: [discovery and evaluation](03-adaptive-discovery-and-evaluation.md)

## Outcome and scope

A new private review focuses on changed circumstances using current confirmed
facts, not a previous transcript. An adult can complete a shorter dependant review;
explicit confirmation produces profile versions/audit and old sessions remain
closed. This outcome comes from the accepted Stage 2 sequence, not a new product
approval. Full affected-meal analysis and remaining-week repair belong to
[weekly planning](../weekly-planning.md).

## Approach and boundaries

Reuse the existing session-scope, card-review and Household command boundaries in
[private discovery](../../reference/private-discovery.md). Preserve participant
privacy, target attribution, provisional/confirmed meaning, current versions,
safety-reduction consent and exact-command recovery. Do not implement dependant
accounts, cross-session transcript memory or implicit household writes.

## Current evidence and limit

The `ProfileEdit` browser opening now shows current shared facts and asks what
changed. A local Worker Playwright journey checks signup, family setup, a saved
fact, completed session A, fresh session B and reload in desktop Chromium and
mobile WebKit. A browser component test checks the focused guide and read-only
history. A native A-to-B test sends synthetic model output through the real
adapter, corrects A's proposal, confirms it, completes A, then confirms B's
replacement with the current fact ID and a new profile version/audit. B's model
context contains the current saved profile and only B's new message.

This provider-free evidence does not establish live model quality, the complete
browser journey from generated proposal to confirmation, or dependant assistance.
Work Item 03 and PDR-0006 still own the required live and human evaluations.

## Acceptance

- [x] An adult starts a new focused review with current shared facts; a native
  A-to-B journey confirms an ordinary change at the correct target/version, and
  the browser keeps earlier history read-only.
- [ ] A shorter assisted dependant flow attributes proposals and confirmed updates
  to the intended dependant with the existing permission/audit boundary.
- [ ] Actual browser and native runtime evidence covers privacy, stale review,
  ambiguous confirmation and restart at the changed seams.
- [ ] The result contributes to the [parent's cumulative acceptance](README.md#cumulative-acceptance)
  and PDR-0006 without passing unexercised later-stage dimensions.

## Next action

Complete the discovery quality and tone evaluation in Work Item 03. Then verify
the complete adult browser confirmation with a live candidate and build the
shorter dependant flow, preserving the same authority boundary.

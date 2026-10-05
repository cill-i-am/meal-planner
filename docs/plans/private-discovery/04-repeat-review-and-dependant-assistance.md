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

The `ProfileEdit` browser opening shows current shared facts and asks what
changed. A local Worker Playwright journey now covers signup and family setup,
then a synthetic model proposal, browser correction, explicit confirmation,
completion of session A, and a fresh session B replacement and confirmation.
It checks the saved profile version, fact identity, audit and reload in desktop
Chromium and mobile WebKit. The synthetic model accepts B only when its context
contains the current saved fact and B's message alone. A browser component test
checks the focused guide and read-only history. A separate native A-to-B test
checks the same confirmation and isolation boundaries below the browser.

This provider-free evidence does not establish live model quality or dependant
assistance. Work Item 03 and PDR-0006 still own the required live and human
evaluations.

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

Build the shorter dependant flow and its deterministic browser/native checks,
preserving the same authority boundary. This work can proceed independently of
Work Item 03's live quality and tone evaluation. A live candidate must still
prove conversation quality, and cumulative external-beta acceptance remains
open; provider-free journeys establish mechanics.

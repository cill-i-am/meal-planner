# Progressive cards and explicit confirmation

Status: done
Owner: historical delivery in PR #216

## Outcome

The admitted native session owns tentative cards and their revisions. Reviewing,
correcting, or rejecting a proposal does not write the household profile. An
adult explicitly confirms a closed change to their own profile; the UI explains
that the confirmed fact becomes visible to the household. Dependant assistance
belongs to Work Item 04. Ordinary preferences, strong dislikes, hard constraints,
and explicit no-known-hard-constraints retain their existing product meanings.
Changing or removing a hard constraint requires the separate explicit safety
confirmation; an ordinary correction cannot bypass that command.

Production provides an honest empty/proposed state. Synthetic local fixtures
produce the initial cards through same-session storage for this slice's tests.
There is no production proposal-injection RPC, manual card-creation product,
fake assistant activity, or model/provider call. Real adaptive proposals and
their quality evidence belong to Work Item 03.

This is a completed slice, not current transport-selection guidance or proof of
model quality. Later implementation supersedes the historical runtime details.

## Acceptance preserved

These are the checks recorded when this work was completed, not new workflow
steps. For a new assignment, read the current contracts.

Native runtime and actual-browser proof cover correction/rejection without
shared writes, explicit ordinary and safety confirmation, immutable version and
interview audit provenance, stale concurrent edits, canonical participant/link
checks, exact lost-result recovery, completion races across devices, restart,
revocation, and private/shared payload boundaries. Independent review checks
the final immutable implementation head. Model quality, dependant flows,
deployment, and the later cumulative Stage 2 exit are not exercised here.

## Delivery evidence

Delivered by [PR #216](https://github.com/cill-i-am/meal-planner/pull/216).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/02-private-discovery/02-progressive-cards-and-confirmation.md) keeps the tested commits, checks, decisions, findings, and limits. The docs refactor
did not rerun those tests or change what they proved. This completed record does
not assign new work.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.

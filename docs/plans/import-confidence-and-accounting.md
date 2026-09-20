# Import confidence and unknown-usage correctness

Status: proposed
Owner: unassigned
Delivery: verified fixes in a separately assigned implementation PR

## Outcome and context

The discovery audit recorded the following import issues. This documentation
migration preserves the findings; it does not claim to have reproduced or fixed
them. Recheck actual callers before implementation.

Two import findings remain outside this discovery implementation:

- Visual confidence normalization strips `%` before dividing values only when
  greater than one. Thus `1%` becomes 1 and `0.9%` becomes 0.9, incorrectly crossing
  the 0.8 threshold. Use one numeric 0–1 contract, or normalize explicit units if
  a retained contract requires percentage input. Low percentages must remain
  low, and malformed or missing confidence must never become high confidence.
- The visual provider converts unknown token usage into known actual spend equal
  to the reservation maximum. Use conservative settlement: retain the charge
  while actual spend remains unknown, with bounded replay that never repeats a
  paid invocation after restart.

## Scope and acceptance

- [ ] Characterize the confidence input domain, preserve explicit low percentages,
  reject malformed/absent confidence safely and verify threshold behavior.
- [ ] Preserve conservative charges while usage remains unknown; verify exact
  recovery across restart without a second paid invocation.
- [ ] Use the [import contract](../reference/recipe-import.md) and
  [settlement decision](../decisions/adr-0011-canonicalize-completed-conservative-settlements.md).
  Prove the changed domain/runtime seam without unrelated provider rewrites.

## Evidence

[Original recorded findings](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/02-private-discovery/03-deterministic-discovery-contract.md#adjacent-audit-follow-ups).
No fix, live provider result, rollout or paid evaluation is claimed here.

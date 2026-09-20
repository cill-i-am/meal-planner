# Fix import confidence and unknown usage costs

Status: proposed
Owner: unassigned
Delivery: verified fixes in a separately assigned implementation PR

## Outcome and context

The discovery review reported these import issues. They have not been reproduced or fixed as part of this documentation edit. Check the current callers before implementing a fix.

Two import findings remain outside this discovery implementation:

- Visual confidence normalization strips `%` before dividing values only when
  greater than one. Thus `1%` becomes 1 and `0.9%` becomes 0.9, incorrectly crossing
  the 0.8 threshold. Use one numeric 0–1 contract, or normalize explicit units if
  a retained contract requires percentage input. Low percentages must remain
  low, and malformed or missing confidence must never become high confidence.
- The visual provider converts unknown token usage into known actual spend equal
  to the reservation maximum. Keep the reserved charge while actual spend is unknown. Recovery must be bounded and must not make another paid call after restart.

## Scope and acceptance

- [ ] Test the accepted confidence inputs. Keep low percentages low, reject missing or malformed confidence safely and check the threshold behavior.
- [ ] Keep the reserved charge while usage is unknown. Check recovery across restart without a second paid call.
- [ ] Use the [import contract](../reference/recipe-import.md) and
  [settlement decision](../decisions/adr-0011-canonicalize-completed-conservative-settlements.md).
  Test the changed data and runtime behavior without rewriting unrelated provider code.

## Evidence

[Original recorded findings](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/02-private-discovery/03-deterministic-discovery-contract.md#adjacent-audit-follow-ups).
No fix, live provider result, rollout or paid evaluation is claimed here.

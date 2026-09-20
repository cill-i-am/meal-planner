# ADR-0011 — Record completed conservative settlements consistently

Status: Accepted
Date: 2026-09-05

## Decision

During PR #203 review, the user approved this limited settlement correction and
merge after verification. The ordered provider-accounting migration changes
`settled_unknown` to `settled_conservative` only when existing records establish
that result: the conservative audit, recipe-extraction stage, reservation amount,
and unknown actual cost must all match. No deployed data was inspected for this
decision.

The conversion changes only the dispatch state. It preserves all amounts,
timestamps, audit records, reconciliation records, and replay data, including
expired replay rows. The migration temporarily removes the transition guard and
update-triggered replay cleanup, performs the conversion, and reinstalls both
within Alchemy's atomic migration batch. Genuine unknown outcomes stay unchanged.

This is a one-time conversion, not a compatibility reader. The immutable audit
remains the accounting evidence even after retry data expires. Existing expiry
rules still apply: the accounting record is readable, but an expired recipe
result cannot be replayed or start another provider call. Normal retry-data
cleanup resumes after migration.

## Evidence and boundary

The committed native upgrade tests execute the previous repository implementation
against its pinned baseline before applying the ordered migrations. They cover
active, expired, and absent replay, genuine unknown outcomes, unchanged accounting
evidence, and migration reapplication. Current verification is recorded in
[the cleanup delivery record](../plans/anti-slop-cleanup.md).

Approval covers the reviewed source migration and PR merge. It does not authorize
cloud deployment, database reset, or any live provider operation.

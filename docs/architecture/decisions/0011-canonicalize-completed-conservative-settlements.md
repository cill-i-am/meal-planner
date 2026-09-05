# ADR-0011 — Canonicalize completed conservative settlements

Status: Accepted
Date: 2026-09-05

## Decision

The user approved the narrowly scoped completed-settlement correction during
PR #203 review and authorized merge after verification. The ordered provider
accounting migration converts stored `settled_unknown` rows to
`settled_conservative` only when their existing authoritative conservative audit,
recipe-extraction stage, reservation amount, and unknown actual cost prove that
representation. No deployed data was inspected to make this decision.

The conversion changes only the dispatch state. It preserves all amounts,
timestamps, audit records, reconciliation records, and replay data, including
expired replay rows. The migration temporarily removes the transition guard and
update-triggered replay cleanup, performs the conversion, and reinstalls both
within Alchemy's atomic migration batch. Genuine unknown outcomes stay unchanged.

This is a one-time state conversion, not a compatibility reader. Retained replay
is not required as accounting evidence: the immutable audit remains authoritative
after replay expiry. Existing expiry semantics remain: the accounting record is
readable, but an expired recipe result cannot be replayed or trigger another
provider invocation. Normal replay cleanup resumes after migration.

## Evidence and boundary

The committed native upgrade tests execute the previous repository implementation
against its pinned baseline before applying the ordered migrations. They cover
active, expired, and absent replay, genuine unknown outcomes, unchanged accounting
evidence, and migration reapplication. Current verification is recorded in
[the cleanup delivery record](../../delivery/anti-slop-cleanup.md).

Approval covers the reviewed source migration and PR merge. It does not authorize
cloud deployment, database reset, or any live provider operation.

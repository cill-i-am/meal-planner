# Stable household people

Status: done
Owner: historical delivery in PR #198

## Outcome

An authenticated adult can establish a truthful household roster containing
themselves, other adults, and dependants. Every person keeps one stable identity
when archived and restored, and the roster survives object restart without
becoming readable or mutable from another household.

## Acceptance preserved

The following describes this completed slice's historical acceptance, not new
workflow requirements. Consult current contracts for an assigned change.

### Focused domain and contract tests

- [x] Closed schemas reject excess keys, malformed IDs, invalid versions,
  unsupported kinds/lifecycles, and unbounded display names.
- [x] Bootstrap, create, list, archive, and restore transitions satisfy every
  invariant above.
- [x] Audit entries record actor, command, person, before/after lifecycle,
  versions, and time without raw auth or request secrets.
- [x] Identical replay, mutation collision, stale version, wrong lifecycle,
  and concurrent bootstrap/archive/restore races are deterministic.
- [x] Public API and generated client contracts preserve closed error and result
  types.
- [x] The audit actor and person linkage subject are separately branded,
  purpose/domain-separated digests of immutable Better Auth user plus household;
  stability and cross-user/cross-household separation are executable.
- [x] UI tests cover empty-household bootstrap, roster operations, pending,
  durable non-retryable bootstrap conflict, deterministic single-attempt
  failures, byte-identical automatic and explicit ambiguous retries, intent
  abandonment, stale, unauthorized, unavailable, a linked creator, an unlinked
  account with an occupied creator slot, and an unlinked owner with non-creator
  people but an available creator slot.

### Real runtime and persistence proof

- [x] A real Workerd or Miniflare test runs Better Auth session/membership,
  public API, private Worker routing, `HouseholdObject`, and actual SQLite
  migrations.
- [x] The cumulative tracer for this work item survives object/runtime restart
  and reads the committed SQLite state rather than a fixture-only cache.
- [x] Real runtime projection derives creator-slot state independently from
  roster membership, survives restart, and remains isolated across households.
- [x] Wrong-purpose and unauthenticated commands do not locate or invoke a
  household object.
- [x] A real Better Auth owner-versus-member race proves non-owner bootstrap is
  denied before private invocation and the object independently rejects a
  people-member bootstrap admission. After role transfer, a real two-owner race
  proves one winner, one durable creator association and person, exact winner
  replay, and closed conflict for the still-owner loser.
- [x] A non-member is rejected before routing; a member of another household
  cannot read or mutate state and cannot infer whether a person or receipt
  exists.
- [x] Fresh migration composition and regeneration prove one household-local
  people authority, a physical creator-slot primary key that rejects a second
  distinct linkage/person association, and no shared household D1 fallback.

## Delivery evidence

Delivered by [PR #198](https://github.com/cill-i-am/meal-planner/pull/198).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/01-household-people/01-person-registry-and-lifecycle.md) preserves the exact heads, checks,
acceptance, decisions, findings and limitations. This refactor did not rerun or
promote that historical evidence. Completed records do not grant new scope.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.

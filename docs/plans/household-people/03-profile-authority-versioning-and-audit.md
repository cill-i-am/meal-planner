# Versioned household profiles

Status: done
Owner: historical delivery in PR #202

## Outcome

Adults can maintain a small, useful set of household-visible facts about each
person. Information entered for someone else is visibly provisional; confirmed
facts have stable identity and immutable versions; and every change has a
privacy-safe audit trail. Removing or weakening a hard dietary or safety
constraint requires a separate explicit confirmation.

## Acceptance preserved

The following describes this completed slice's historical acceptance, not new
workflow requirements. Consult current contracts for an assigned change.

### Focused tests

- [ ] Closed-schema property tests cover every fact variant, standing, source,
      confirmation basis, bounded label, and excess-property rejection.
- [ ] Provisional, self-confirmed, dependant-confirmed, replace, ordinary
      remove, and hard-constraint reduction transitions satisfy the invariants.
- [ ] Immutable version reconstruction and privacy-safe before/after audit are
      proven.
- [ ] Replay, collision, stale version, edit/confirm/remove races, archive race,
      and safety-path bypass attempts are deterministic.
- [ ] API/generated client and UI tests prove the minimum surface and visible
      error distinctions.

### Real runtime and persistence proof

- [ ] A real authenticated Workerd or Miniflare tracer crosses public API,
      private Worker, `HouseholdObject`, and migrated SQLite for both adults.
- [ ] Restart proves byte-stable current profile, immutable versions, audit,
      receipts, and source/actor provenance.
- [ ] Wrong-purpose, non-member, false self-confirmation, and cross-household
      requests fail before disclosure or mutation.
- [ ] Physical migration proof shows no shared-D1 profile authority or fallback.

## Delivery evidence

Delivered by [PR #202](https://github.com/cill-i-am/meal-planner/pull/202).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/01-household-people/03-profile-authority-versioning-and-audit.md) preserves the exact heads, checks,
acceptance, decisions, findings and limitations. This refactor did not rerun or
promote that historical evidence. Completed records do not grant new scope.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.

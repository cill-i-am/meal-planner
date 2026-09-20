# Link invitations and membership departure

Status: done
Owner: historical delivery in PR #201

## Outcome

An adult may exist in the roster before having an account. An organizer invites
that adult, and acceptance links the authenticated member to the same stable
person without duplication. If the member later leaves, access is revoked,
their person and history are retained, and a return restores that same identity.

## Acceptance preserved

The following describes this completed slice's historical acceptance, not new
workflow requirements. Consult current contracts for an assigned change.

### Focused tests

- [x] ADR-0010 fixes coordinator ownership, closed states, ordering, replay,
  timeout, restart, cancellation, authorization, privacy, race, and repair
  semantics before implementation starts.
- [x] Invitation association, accepted linking, explicit repair, departure,
  reconciliation, return, and cardinality invariants have domain tests.
- [x] Raw invitation/email/auth identity cannot enter household schemas or
  projections.
- [x] Replay, collision, stale version, association races, duplicate acceptance,
  departure/return races, and repair conflicts are deterministic.
- [x] Public contracts distinguish Better Auth failure, household failure,
  pending reconciliation, conflict, and completion.
- [x] UI tests cover selection, acceptance, repair, partial failure, revoked
  access, pending departure, archive, and return.

### Real boundary proof

- [x] Real Better Auth D1 invitation acceptance and membership removal run
  against a real routed `HouseholdObject` in Workerd or Miniflare.
- [x] In real Workerd with Better Auth D1 and a routed `HouseholdObject`, kill
  the API after deterministic Workflow creation but before membership removal
  commits; the waiting Workflow times out, reads `present`, records visible
  repair, and a fresh authorized retry does not duplicate the operation.
- [x] In that same real boundary, commit membership removal and kill the API
  before its outcome event is delivered; the waiting Workflow times out, reads
  `absent`, and confirms/finalizes exactly once without the departed session.
- [x] Against pinned Better Auth `1.7.0-rc.6` in the real API runtime, an
  owner-authenticated `POST /organization/delete` and a typed
  `auth.api.deleteOrganization` call are both rejected as disabled; Better Auth
  D1 organization/memberships and the routed `HouseholdObject` remain intact.
- [x] Other lost responses before and after each authority commit reconcile
  without duplicate people, links, membership mutation, audit, or archive.
- [x] An interruption after the Household invitation receipt but before Better
  Auth creation survives runtime restart; read-only association leaves the
  provider empty, while exact browser-command replay creates the original
  deterministic invitation without a new person or mutation.
- [x] With multiple pending invitations in one organization, a committed
  invitation whose response is lost is recovered by exact browser-command
  replay only at the deterministic ID bound to its original person, payload
  digest, and mutation.
- [x] A committed departure whose initial response is lost is rediscovered
  after refresh by its original preparation mutation; status, retry,
  cancellation, and finalization retain the same operation.
- [x] Restart during pending departure completes from durable state.
- [x] Membership removal revokes API/object routing before person archive is
  finalized.
- [x] Same-user/multiple-household and cross-household isolation are proven
  through production auth/API routes.

## Delivery evidence

Delivered by [PR #201](https://github.com/cill-i-am/meal-planner/pull/201).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/01-household-people/02-account-linking-invitations-and-departure.md) preserves the exact heads, checks,
acceptance, decisions, findings and limitations. This refactor did not rerun or
promote that historical evidence. Completed records do not grant new scope.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.

# Work Item 02 — Account Linking, Invitations, And Departure

- Status: Proposed
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: Unassigned
- Pull request: Not opened
- Completed by: Not completed
- Promotion condition: Work Item 01 evidence is merged and a small
  departure-coordination ADR is accepted

## Household Outcome

An adult may exist in the roster before having an account. An organizer invites
that adult, and acceptance links the authenticated member to the same stable
person without duplication. If the member later leaves, access is revoked,
their person and history are retained, and a return restores that same identity.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0016 — Beta support, incidents, and operator repair](../../../decisions/product/0016-beta-support-incidents-and-operator-repair.md)
- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [Stage 1 invitation and departure recommendations](README.md)
- Work Item 01's merged person, link, audit, receipt, and runtime evidence

## User-Visible Vertical

Adult A creates an unlinked adult person for Adult B, sends a Better Auth
invitation for that person, and sees a pending-invitation state without seeing a
stored household email. Adult B accepts, selects or confirms the intended
existing person, and becomes linked without a new person. Adult B can then
perform admitted person-specific operations. Departure revokes access first,
archives the same person through a visible durable operation, and restoration
after a later re-invitation reuses the same person.

## Scope

### In scope

- associating one Better Auth invitation with one existing unlinked adult person
  using a purpose-bound digest of invitation identity;
- linking an accepted member to that existing person;
- at most one active linked person per authenticated user in one household;
- the same authenticated user linking independently in several households;
- explicit, audited link repair with no heuristic matching;
- membership-removal coordination, durable retry/reconciliation, link detach,
  person archive, and same-person restoration on return;
- household-visible pending, linked, departure-pending, and detached
  projections that do not disclose email or auth secrets; and
- real Better Auth D1 plus HouseholdObject failure and restart proof.

### Out of scope

- person creation as a side effect of invitation acceptance;
- matching or merging by email, display name, user name, or other heuristics;
- silent deletion, hard deletion, or person merge;
- changing Better Auth's user, organization, membership, invitation, or role
  authority;
- dependant accounts, multiple account links per user in one household,
  granular permissions, or generic organization administration;
- profile facts, interviews, routines, planning, recipes, and shopping; and
- cross-database transactions, compatibility storage, shared household D1,
  dual writes, or silent eventual consistency.

## Product Commands And Queries

### Identity-control-plane operations

- Create and accept invitations through Better Auth's public organization API.
- Remove membership through Better Auth during the accepted departure protocol.
- Read invitation/membership outcome only to reconcile an explicit operation.

### Household commands

- `AssociateAdultInvitation(mutationId, personId, invitationDigest)` associates
  a currently valid invitation with an unlinked adult.
- `CompleteAcceptedAdultLink(mutationId, invitationDigest)` links the admitted
  actor to the associated adult after Better Auth membership is proven.
- `RepairAdultAccountLink(mutationId, personId, expectedPersonVersion, reason)`
  explicitly links or relinks the admitted member under organizer authority.
- `PrepareMemberDeparture(mutationId, personId, expectedPersonVersion)` records
  a durable departure operation before the external membership mutation.
- `FinalizeMemberDeparture(operationId, observedMembershipState)` detaches the
  account link, archives the same person, and closes the operation.
- `RestoreReturningAdultLink(mutationId, personId, invitationDigest,
  expectedPersonVersion)` restores and links the same archived person after a
  later accepted invitation.

Exact command decomposition may be adjusted by the departure ADR, but its
observable ordering and failure states may not be hidden.

### Queries

- `ListHouseholdPeople` extends its adult projection with privacy-safe
  association state: `unlinked`, `invitation_pending`, `linked`,
  `departure_pending`, or `detached`.
- `GetCurrentPersonLink` identifies the admitted member's linked person.
- `GetDepartureOperation(operationId)` exposes an organizer-safe reconciliation
  state without raw Better Auth identifiers.

## States, Transitions, And Invariants

```text
Adult association:
unlinked -> invitation_pending -> linked
linked -> departure_pending -> detached
detached + accepted return -> linked

Person lifecycle on completed departure:
active -> archived
archived + accepted return -> active
```

- Invitation association never changes person identity.
- An invitation digest associates with at most one person and cannot be reused
  to link another person.
- One admitted actor identity has at most one active person link in an object.
  Object-local enforcement naturally permits a link in another household.
- Link repair is explicit, organizer-authorized, reasoned, and audited. It never
  guesses, merges people, or deletes history.
- An accepted unlinked member receives an explicit finish-joining/repair result;
  person-specific operations do not guess a person.
- Access is controlled only by current Better Auth membership. An archived or
  detached person does not preserve access.

## Versioning And Household Projection

Person versions advance when invitation association, link, detach, archive, or
restore changes household-visible person state. Account-link and departure
records have stable IDs and their own monotonic versions or closed state
ordinals. Audit entries preserve actor, time, operation, reason/source, and
before/after association and lifecycle states.

Household projections may show that an invitation is pending, accepted, or
requires repair. They must not include email, invitation token/ID/digest, raw
user/member identity, session information, or private Better Auth errors.

## Authority, Transaction, And Privacy

- Better Auth D1 remains canonical for invitation and membership state.
- `HouseholdObject` remains canonical for invitation-to-person association,
  account-to-person link, person lifecycle, audit, operation, and receipt state.
- Raw invitation ID is admitted only at the API boundary and converted to a
  purpose-bound one-way digest before entering household storage.
- The household transaction atomically updates link/person/operation versions,
  appends audit, and records a receipt. Better Auth calls occur outside that
  transaction.
- Membership and role are verified before routing. Organizer authority is
  required to associate, repair, or initiate departure. An accepted member may
  complete only their own admitted link.

## Departure Coordination Recommendation

Accept a small ADR with this protocol before implementation:

1. The organizer prepares an exact durable departure operation in
   `HouseholdObject`. Identical replay returns the same operation.
2. A post-commit Workflow or equivalent coordinator removes the Better Auth
   membership. No household lock is held during the call.
3. On a response failure, the coordinator queries Better Auth. It retries remove
   only when membership is still present and treats confirmed absence as
   success.
4. After confirmed absence, a system-purpose household command atomically
   detaches the link, archives the same person, appends audit, and completes the
   operation.
5. If finalization fails, access is already revoked; the visible pending
   operation is retried and can be repaired by an authorized operator. It is
   never silently abandoned.

The ADR must settle coordinator ownership, retry/timeout policy, observable
pending states, cancellation before membership removal, and operator repair.

## Failure, Replay, And Concurrency

- Identical command replay returns the stored result; mutation-ID reuse with a
  different person, invitation digest, or operation returns
  `mutation_collision`.
- A stale person/link/operation version makes no change.
- Concurrent invitation associations for one person or one invitation have one
  winner; the other returns an explicit conflict.
- Concurrent accepted-link attempts converge on the same link only when person,
  invitation digest, and actor are identical. Otherwise they conflict.
- Ambiguous or missing invitation association never falls back to email or name.
- A member already linked to another person cannot complete a second link; an
  organizer must use explicit repair.
- Departure retry reconciles Better Auth before repeating an unknown external
  mutation and then replays household finalization safely.
- A concurrent profile/person mutation during departure follows the accepted
  ADR's version fence; it cannot silently escape archive or overwrite history.
- Return and departure racing on the same person/op version produce one winner
  and one stale/conflict result.
- Restart preserves every operation, receipt, link, invitation association, and
  person identity.

## Minimum API Surface

- An authenticated organizer endpoint that creates a Better Auth invitation and
  then associates it with a selected unlinked adult person, reporting partial
  failure explicitly.
- An admitted member endpoint to complete an accepted invitation link.
- Organizer endpoints for explicit link repair and departure initiation.
- A returning-member endpoint to restore/link a selected archived adult after
  acceptance.
- Roster/current-link/departure-operation queries with the privacy-safe
  projections above.

The API must preserve the separation between Better Auth outcome and household
outcome; it must not report one combined success when the second authority has
not committed. If invitation creation succeeds but association is lost, retry
the association using the exact returned invitation identity rather than
creating another invitation. If the create response itself is ambiguous, the
organizer reconciles against Better Auth's pending invitations and explicitly
selects the intended invitation and person. Zero or multiple candidates remain
visible conflicts; the API must not choose by email or name.

## Minimum UI Surface

- Select an existing unlinked adult before sending an invitation.
- Show pending invitation state without exposing stored email after submission.
- After acceptance, confirm the associated person or choose an explicit
  unlinked-adult repair path when association is missing.
- Show linked current adult, departure-pending, archived, and returning-person
  states.
- Require confirmation for departure and explain that access is revoked before
  roster archival completes.
- Offer retry/reconcile actions for visible partial failures; never create a
  replacement person as recovery.

## Vertical Tracer

1. Adult A creates adult person B before B has an account.
2. A sends an invitation associated with B. Retries do not duplicate the
   invitation association or reveal its email in household storage.
3. Adult B accepts and links to person B. No new person is created.
4. B is also admitted to a second household and links to one different local
   person without violating either household's cardinality.
5. A departure response is lost after Better Auth removed B. Reconciliation
   confirms revoked access and completes detach/archive once.
6. B cannot access the household during pending finalization. A later accepted
   return restores and links the same person B and preserves history.
7. A different household cannot read association, invitation, operation, or
   archived-person state.

## Acceptance Evidence

### Focused tests

- [ ] Invitation association, accepted linking, explicit repair, departure,
  reconciliation, return, and cardinality invariants have domain tests.
- [ ] Raw invitation/email/auth identity cannot enter household schemas or
  projections.
- [ ] Replay, collision, stale version, association races, duplicate acceptance,
  departure/return races, and repair conflicts are deterministic.
- [ ] Public contracts distinguish Better Auth failure, household failure,
  pending reconciliation, conflict, and completion.
- [ ] UI tests cover selection, acceptance, repair, partial failure, revoked
  access, pending departure, archive, and return.

### Real boundary proof

- [ ] Real Better Auth D1 invitation acceptance and membership removal run
  against a real routed `HouseholdObject` in Workerd or Miniflare.
- [ ] Lost responses before and after each authority commit reconcile without
  duplicate people, links, membership mutation, audit, or archive.
- [ ] Restart during pending departure completes from durable state.
- [ ] Membership removal revokes API/object routing before person archive is
  finalized.
- [ ] Same-user/multiple-household and cross-household isolation are proven
  through production auth/API routes.

### Repository and review gates

- [ ] Root format, lint, type checks, full tests, builds, applicable container,
  and hosted CI pass.
- [ ] Better Auth, household-domain, public contract, UI, stage, and current
  delivery docs reflect the shipped protocol.
- [ ] A completely fresh independent exact-head review disposes identity,
  privacy, authorization-ordering, saga/reconciliation, replay, and test-
  integrity risks.

## Review Risk

Very high. This crosses two canonical stores, invitation privacy, access
revocation, stable identity, and restartable external coordination. Independent
exact-head review is required, and green CI is not merge authority.

## Implementation Notes

- Do not make Work Item 01 wait for this protocol. Extend its minimal creator
  association rather than replacing person identity.
- A digest is not permission to expose or compare invitation email. Domain
  matching uses explicit person selection and exact admitted invitation
  identity only.
- If the departure ADR cannot define observable, repairable partial states,
  keep this work item `Proposed` rather than implementing an informal saga.

## Delivery Log

- 2026-08-27 — Created as `Proposed`; blocked on Work Item 01 evidence and a
  departure-coordination ADR.

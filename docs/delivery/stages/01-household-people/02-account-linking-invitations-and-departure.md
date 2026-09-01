# Work Item 02 — Account Linking, Invitations, And Departure

- Status: Ready
- Stage: [Stage 1 — Household people, profiles, and permissions](README.md)
- Owner: Unassigned
- Pull request: Not opened
- Completed by: Not completed
- Promotion condition: Satisfied on 2026-09-01 by merged Work Item 01 evidence
  and accepted ADR-0010

## Household Outcome

An adult may exist in the roster before having an account. An organizer invites
that adult, and acceptance links the authenticated member to the same stable
person without duplication. If the member later leaves, access is revoked,
their person and history are retained, and a return restores that same identity.

## Accepted Direction

- [PDR 0001 — Household people, profiles, and interviews](../../../decisions/product/0001-household-people-profiles-and-interviews.md)
- [PDR 0016 — Beta support, incidents, and operator repair](../../../decisions/product/0016-beta-support-incidents-and-operator-repair.md)
- [ADR 0001 — Separate household people from auth members](../../../architecture/decisions/0001-separate-household-people-from-auth-members.md)
- [ADR 0010 — Coordinate membership departure before person archival](../../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
- [Stage 1 invitation and departure recommendations](README.md)
- [Work Item 01's merged person, link, audit, receipt, and runtime evidence](01-person-registry-and-lifecycle.md)

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
- `PrepareMemberDeparture(mutationId, personId, linkId,
  expectedPersonVersion, expectedLinkVersion)` records the durable operation
  and the visible departure fence before the external membership mutation.
- `StartMemberDeparture(operationId, expectedOperationVersion)` atomically
  closes cancellation and moves the operation to access revocation.
- `CancelMemberDeparture(mutationId, operationId, expectedOperationVersion)`
  cancels only a still-`prepared` operation.
- `ConfirmMemberAccessRevoked(operationId, expectedOperationVersion)` is an
  exact-purpose system command admitted only after Better Auth confirms
  membership absence.
- `FinalizeMemberDeparture(operationId, expectedOperationVersion)` is an
  exact-purpose system command that detaches the link, archives the same
  person, and completes an `access_revoked` operation.
- `RetryMemberDeparture(mutationId, operationId, expectedOperationVersion,
  reason)` resumes one visible repair-required phase under owner authority.
- `RestoreReturningAdultLink(mutationId, personId, invitationDigest,
  expectedPersonVersion)` restores and links the same archived person after a
  later accepted invitation.

These departure commands and their ordering are fixed by ADR-0010. Equivalent
contract names may be chosen locally, but no implementation may combine or
skip the canonical transitions.

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

Departure operation:
prepared -> revoking_access -> access_revoked -> completed
prepared -> cancelled
revoking_access -> revocation_repair_required -> revoking_access
access_revoked -> finalization_repair_required -> access_revoked

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
- `completed` and `cancelled` are terminal. Membership absence is the only
  valid predecessor to `access_revoked`, and `access_revoked` is the only valid
  predecessor to household finalization.

## Versioning And Household Projection

Person versions advance when invitation association, link, departure prepare,
cancel, detach/archive, or restore changes household-visible person state.
Account-link and departure records have stable IDs and monotonic versions.
Every departure transition requires the exact operation version; prepare and
finalize also fence exact person/link versions. Audit entries preserve actor,
time, operation, reason/source, and before/after association and lifecycle
states.

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
- Membership and role are verified before routing. In this MVP, organizer means
  the active membership's exact Better Auth `owner` role. Owner authority is
  required to associate an invitation, repair a link, initiate another adult's
  departure, or repair departure. An admitted member may complete only their
  own link and may initiate or retry only their own departure while that
  membership still exists.

## Accepted Departure Coordination

[ADR-0010](../../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md)
closes the prerequisite. `MealPlannerApi` owns one dedicated native
`MemberDepartureWorkflow`; `HouseholdObject` owns the closed durable operation.
Prepare and start commit before the typed Better Auth removal. A timeout or lost
response is reconciled by reading canonical membership, never by a blind remove
retry. Only confirmed absence admits exact-purpose system confirmation and
finalization. Bounded exhaustion produces a visible, versioned repair state.

Cancellation exists only before the local start transition wins. Removal has
one 30-second attempt; reconciliation and idempotent household steps have a
30-second timeout and at most five exponential-backoff attempts beginning at
two seconds. Cloudflare Workflow restart state and the household operation
survive runtime restart, while deterministic instance identity and execution
generation prevent parallel coordinators. The complete state, authorization,
privacy, collision, concurrency, failure, and operator-repair contract is owned
by ADR-0010 and must be implemented without weakening it.

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
- A removal attempt is repeated only after a fresh Better Auth read proves the
  target user still has membership in the exact organization.
- A concurrent profile/person mutation during departure follows the accepted
  ADR's version fence; it cannot silently escape archive or overwrite history.
- Return and departure racing on the same person/op version produce one winner
  and one stale/conflict result.
- Restart preserves every operation, receipt, link, invitation association, and
  person identity.
- A replacement membership for the same user remains present even if its member
  row ID changed and blocks archival until explicit owner repair.

## Minimum API Surface

- An authenticated organizer endpoint that creates a Better Auth invitation and
  then associates it with a selected unlinked adult person, reporting partial
  failure explicitly.
- An admitted member endpoint to complete an accepted invitation link.
- Organizer endpoints for explicit link repair and departure initiation.
- Member/owner cancellation and owner repair endpoints for the exact durable
  departure operation.
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

- [x] ADR-0010 fixes coordinator ownership, closed states, ordering, replay,
  timeout, restart, cancellation, authorization, privacy, race, and repair
  semantics before implementation starts.
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
- Implement ADR-0010's named operation states and system purpose directly; do
  not introduce a generic saga abstraction or weaken a partial state into an
  unobservable background retry.

## First Implementation-Agent Assignment

> After this readiness PR merges, fetch and prune the dynamic remote default,
> create one clean isolated worktree from its exact commit, and use branch
> `codex/stage1-account-linking-invitations-departure`. Implement only this Work
> Item 02 in one draft PR: associate a selected existing unlinked adult with a
> Better Auth invitation through a purpose-bound digest; complete, explicitly
> repair, depart, detach/archive, return, and relink that same stable person;
> and implement ADR-0010's exact API-owned native Workflow plus
> HouseholdObject state machine, authorization-before-routing, privacy,
> replay/version, cancellation, timeout, restart, collision, race, and repair
> rules. Extend the merged Work Item 01 link and people seams without replacing
> them. Prove the full focused, UI, real Better Auth D1-to-routed-object,
> lost-response, restart, replacement-membership, and cross-household evidence
> listed here. Exclude profiles, interviews, Agents SDK, routines, planning,
> recipes, shopping, provider or cloud mutation, deployment, compatibility,
> backfills, dual writes, shared household D1, and any generic organization or
> saga framework. Run every repository, runtime, build, hosted-CI, and fresh
> exact-head review gate recorded in this work item; freeze the reviewed head
> and do not treat green CI as merge authority.

## Delivery Log

- 2026-08-27 — Created as `Proposed`; blocked on Work Item 01 evidence and a
  departure-coordination ADR.
- 2026-09-01 — Promoted to `Ready` after PR #198 merged Work Item 01 and
  ADR-0010 accepted the exact access-first departure coordinator, durable
  states, failure visibility, and repair protocol. No Work Item 02 application
  behavior is implemented by this readiness change.

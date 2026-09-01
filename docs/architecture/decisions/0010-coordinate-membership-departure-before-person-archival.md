# ADR-0010 — Coordinate Membership Departure Before Person Archival

- Status: Accepted
- Date: 2026-09-01
- Related product decisions:
  [PDR-0001](../../decisions/product/0001-household-people-profiles-and-interviews.md)
  and
  [PDR-0016](../../decisions/product/0016-beta-support-incidents-and-operator-repair.md)
- Extends:
  [ADR-0001](0001-separate-household-people-from-auth-members.md)

## Context

An adult's departure changes two canonical authorities. Better Auth D1 owns
organization membership and therefore access. The routed `HouseholdObject`
owns the stable household person, the account-link fact, lifecycle, audit,
mutation receipts, and any durable departure operation. PDR-0001 requires
membership removal to revoke access immediately while retaining and archiving
the same person and their history.

Those authorities cannot share a database transaction. Treating either commit
as proof that the other committed would create an unsafe partial success:

- archiving first could leave a departed member able to read household history;
- reporting completion after membership removal but before household archival
  would hide repair work; and
- blindly repeating a timed-out membership removal could act on a replacement
  membership created during recovery.

The live application already establishes the usable seams. `MealPlannerApi`
constructs the pinned Better Auth organization plugin over its dedicated D1,
proves membership before household routing, binds the private
`HouseholdDomainWorker`, and owns native `Cloudflare.Workflow` classes.
`HouseholdObject` performs local Drizzle/SQLite transactions and never queries
Better Auth. The existing household import batch-item Workflow supplies a
bounded durable-step precedent. The departure protocol should use those live
primitives rather than introduce a generic saga framework, another store, or
direct external I/O from the household object.

## Decision

### Canonical authorities and coordinator

- Better Auth remains canonical for users, sessions, organizations,
  memberships, invitations, roles, and access.
- `HouseholdObject` remains canonical for stable people, invitation
  associations, account links, person lifecycle, household audit, mutation
  receipts, and durable departure-operation state.
- Access revocation commits before account-link detachment or person archival.
  A household transaction never contains a Better Auth call, and a Better Auth
  mutation never claims that household finalization committed.
- `MealPlannerApi` owns one dedicated `MemberDepartureWorkflow` implemented as
  the repository's existing native `Cloudflare.Workflow` primitive. The API
  Worker is the correct owner because it already owns the Better Auth D1 and
  server instance, membership authorization, Workflow bindings, and the
  private household Worker binding. `HouseholdObject` is not the coordinator
  because it must remain a local household-state authority with no Better Auth
  dependency or external call.
- The implementing slice adds a narrow Better Auth membership port beside the
  existing auth construction. Membership writes use Better Auth's typed server
  organization operations, not raw D1 writes. A read-only reconciliation probe
  may read the canonical auth schema and returns only `present`, `absent`, or
  `unavailable` to the coordinator.
- Public raw Better Auth membership-removal and leave routes must not bypass
  this protocol. The public auth construction disables the exact
  `/organization/remove-member` and `/organization/leave` paths; product routes
  prepare and claim the durable operation before directly invoking the
  corresponding typed Better Auth server operation with the live caller
  authorization. No session header or token is persisted in a Workflow or
  household record.
- Organization deletion is a separate, destructive authority path that could
  otherwise remove every membership outside this departure protocol. Work Item
  02 must configure the pinned organization plugin exactly as
  `organization({ disableOrganizationDeletion: true })`. This plugin-level
  fence rejects both `POST /organization/delete` through `auth.fetch` and the
  typed `auth.api.deleteOrganization` operation; merely adding another public
  disabled path is insufficient. Organization deletion stays disabled until
  the accepted household deletion lifecycle exists and is not implemented by
  Work Item 02.

This route fence uses public seams rather than a Better Auth fork. At the
accepted base, [`makeMealPlannerAuth`](../../../apps/api/src/features/auth/auth.ts)
is the single auth constructor and the
[API Worker](../../../apps/api/src/worker.ts) forwards every `/api/auth/*`
request to `auth.fetch`. The pinned Better Auth version exposes top-level
`disabledPaths`, applies it to normalized endpoint paths, and defines those two
exact organization paths. Adding both paths at the constructor prevents the
public bypass; the coordinator can still call the typed server operations
directly without changing Better Auth internals.

The accepted base pins Better Auth `1.7.0-rc.6`, where
`disableOrganizationDeletion` defaults to `false` and the delete endpoint is
otherwise registered. The current constructor uses bare `organization()`, and
the API Worker forwards every `/api/auth/*` request to `auth.fetch`. The
explicit plugin option therefore closes a live HTTP and typed-server bypass and
aligns with the accepted
[household deletion lifecycle](../household-capability-migration-plan.md#household-deletion-lifecycle),
which requires organization deletion to remain disabled until coordinated
product-state cleanup can finish first.

The Workflow is a dedicated coordinator for this operation, not a new workflow
framework. It binds only the auth reconciliation reader and the private
household service required by this protocol.

### Durable household states

Each departure has one opaque household-local `operationId`, a monotonic
`operationVersion`, the target person and link IDs, captured person/link
versions, an execution generation, privacy-safe attempt metadata, and exactly
one state from this closed union:

```text
prepared
revoking_access
revocation_repair_required
access_revoked
finalization_repair_required
completed
cancelled
```

The only allowed transitions are:

```text
linked + active
  -> prepared + departure_pending

prepared
  -> cancelled + linked
  -> revoking_access

revoking_access
  -> access_revoked
  -> revocation_repair_required

revocation_repair_required
  -> revoking_access

access_revoked
  -> completed + detached + archived
  -> finalization_repair_required

finalization_repair_required
  -> access_revoked
```

`completed` and `cancelled` are terminal. No other backward transition is
valid. Repair-required states carry only a closed phase code, attempt count,
last-attempt time, and safe next action. They do not carry provider text or
Better Auth errors.

Prepare changes the account-link projection from `linked` to
`departure_pending`, advances the link and person versions, and stores the
operation, audit entry, and receipt in one household transaction. It does not
archive the person or change Better Auth. Cancellation restores `linked` and
advances versions in another local transaction. Finalization changes the link
to `detached`, changes the same person from `active` to `archived`, appends
audit, records the receipt, and completes the operation atomically.

### Exact protocol

1. The public API proves the caller and target relationship in Better Auth
   before household routing. It derives the accepted household-scoped linkage
   subject and sends `PrepareMemberDeparture` with a stable mutation ID, target
   person/link IDs, and exact expected person/link versions.
2. `HouseholdObject` verifies an active linked adult, the matching linkage
   subject, no competing operation, and the expected versions. It commits
   `prepared` plus `departure_pending`, audit, and receipt in one transaction.
3. The same authorized request calls `StartMemberDeparture` with the exact
   operation version. That local commit moves `prepared` to
   `revoking_access`. This is the cancellation boundary: either cancellation
   wins while the operation is `prepared`, or start wins and cancellation is
   rejected. No external call occurs before start wins.
4. Before any Better Auth mutation, that same request durably creates or
   reconciles the deterministic `MemberDepartureWorkflow` instance for the
   operation's current generation. Creation is confirmed only by a successful
   create or by reading the same deterministic instance after an ambiguous or
   duplicate create response. If neither can be confirmed, the API does not
   call Better Auth; an exact authorized replay reconciles the same instance.
5. The Workflow initially calls `waitForEvent` for one closed
   `membership-removal-outcome` event, with a one-minute timeout. Cloudflare's
   [Workflow event contract](https://developers.cloudflare.com/workflows/build/events-and-parameters/)
   buffers an event sent after instance creation but before the matching wait,
   so confirmed durable creation is the ordering fence; the API does not poll
   for an in-memory "waiting" observation.
6. Only the request that won a fresh start or authorized repair transition may
   now make one typed Better Auth removal call. Owner-initiated removal uses the
   admitted owner's current authorization; self-departure uses the target
   member's current authorization. Better Auth's permissions and last-owner
   rule remain authoritative. A stored receipt replay never repeats the call,
   and no caller credentials enter Workflow or household state.
7. If the request remains alive, it signals the deterministic Workflow with a
   deterministic attempt ID and one privacy-safe tag:
   `returned_success`, `returned_rejected`, or `unknown`. The event contains no
   raw user, member, session, invitation, email, credential, or Better Auth
   error detail. It is only a wake-up hint: duplicate or early delivery cannot
   prove the membership result or repeat either canonical mutation.
8. On that signal, or when the one-minute wait expires without one, the
   Workflow reads Better Auth for any current membership of the target user in
   the exact organization. A response timeout or transport failure is
   `unavailable`, not absence. If membership is present, removal has not been
   proven and household finalization is forbidden; the Workflow records
   `revocation_repair_required` after bounded handling. A new removal attempt
   is allowed only after that fresh `present` observation and a newly
   authorized repair. If membership is absent, the Workflow sends the
   exact-purpose system command `ConfirmMemberAccessRevoked`.
9. `ConfirmMemberAccessRevoked` may transition only `revoking_access` to
   `access_revoked`. It records the safe observation time and operation
   version; it receives no Better Auth user, member, session, or error data.
10. The Workflow then sends the exact-purpose system command
   `FinalizeMemberDeparture` after one final Better Auth absence read. The
   object accepts it only from `access_revoked`, detaches the link, archives the
   same person, appends audit, stores a receipt, and transitions to `completed`
   in one transaction.
11. If bounded reconciliation or finalization attempts exhaust, the Workflow
   records the corresponding repair-required state. The operation remains
   visible and may be retried through the authorized repair command. It is
   never silently dropped or described as complete.

Confirmed membership absence is therefore the only route to
`access_revoked`, and `access_revoked` is the only route to system-purpose
finalization. A Better Auth success response alone is not sufficient; the
read-after-mutation confirmation is required.

### Replay, collision, and version rules

- A prepare mutation ID is scoped to one household. Exact replay of the same
  admitted target, linkage subject, expected person/link versions, and intent
  returns its stored result. Reuse with any changed field returns
  `mutation_collision` without a write.
- One active departure operation may own a person/link pair. A different
  mutation or operation targeting an owned person/link returns
  `departure_in_progress`; it does not join or replace the first operation.
- Every transition requires the exact current operation version and allowed
  prior state. Person and link mutations also require their exact versions.
  Stale input makes no change and returns a closed conflict.
- System-step mutation IDs are deterministically derived from operation ID,
  execution generation, transition name, and expected operation version.
  Exact replay returns the same receipt; a changed target or payload collides.
- A Workflow instance ID is the domain-separated digest of organization ID,
  operation ID, and execution generation. Repeated start or status checks for
  one generation reconcile that same instance; they do not create parallel
  coordinators. A different input under the same instance identity is an
  explicit collision and repair condition.
- The start or repair transition also derives one attempt ID from the
  operation ID, generation, and claimed operation version. Only its fresh
  transition winner may call Better Auth once. An exact command replay, lost
  transition response, or concurrent loser can create/reconcile the Workflow
  but may not issue the external mutation; the waiting Workflow resolves the
  unknown outcome by canonical read.
- The outcome event uses that attempt ID. Duplicate delivery and delivery
  before the Workflow reaches `waitForEvent` converge on the same canonical
  membership read. A changed attempt ID or event tag for the same claimed
  attempt is a collision and repair condition, not another removal.
- Generation advances only through an authorized repair after platform status
  proves the earlier instance terminal. An unavailable or unknown status never
  advances generation. This prevents two generations from mutating the same
  operation concurrently.
- A removal response failure is an unknown outcome. The coordinator does not
  issue another removal until a Better Auth read confirms that the target still
  has a membership. Confirmed absence is replay-safe success, including when
  another authorized action already removed the membership.
- Membership reconciliation is by target user plus organization, not solely by
  the original membership-row ID. Replacement of the membership row therefore
  remains `present` and blocks archival rather than being mistaken for
  departure.

### Timeouts, restart, cancellation, and repair

- The Better Auth removal call has one 30-second attempt. Workflow task retries
  must not blindly repeat it; a timeout enters reconciliation.
- The Workflow's initial outcome wait is one minute, longer than the permitted
  30-second removal attempt. Expiry is a reconciliation trigger, never evidence
  that removal failed or that membership is absent.
- Better Auth reconciliation and idempotent household system steps use a
  30-second per-attempt timeout and at most five attempts with exponential
  backoff beginning at two seconds. This matches the exact `StepOptions`
  precedent in the existing
  [household import batch-item Workflow](../../../apps/api/src/features/imports/household-import-batch-item.workflow.ts),
  not a repository-wide default.
- Exhaustion records `revocation_repair_required` or
  `finalization_repair_required`; it does not create an unbounded background
  loop. Household projections expose the safe phase, last-attempt time, and
  whether retry is allowed.
- Cloudflare Workflow state survives Worker restart, while the household
  operation remains the canonical recovery record across Workflow restart or
  replacement. On every run or repair, the coordinator reads the current
  operation before acting and stops on `completed` or `cancelled`.
- Cancellation is allowed only in `prepared`, before `StartMemberDeparture`
  wins. A cancellation racing start is serialized by `HouseholdObject`. There
  is no cancellation after `revoking_access`, because the external outcome may
  already be unknown and restoring the link could misrepresent access.
- An active Better Auth `owner` in the same organization may retry either
  repair-required phase with an expected operation version and bounded reason.
  A self-departing member may retry revocation only while Better Auth still
  proves that membership. After access is absent, only a remaining owner or the
  exact system-purpose Workflow can progress the operation.
- Repair advances the execution generation, appends audit, and resumes from
  `revoking_access` or `access_revoked`; it never creates a second departure,
  restores membership, rewrites history, or edits either database directly.
  Beta support has no direct database escape hatch: any product-operator action
  must use the same typed, versioned, reasoned, audited repair command under a
  separately admitted support authority before such tooling is enabled.

### Authorization and routing

- A current member may prepare and start only their own departure. A current
  Better Auth `owner` may prepare and start another linked adult's departure.
  The caller, target membership, organization equality, role, last-owner
  constraint, target linkage subject, and current membership are checked before
  the household object is located.
- The initiating member or a current owner may cancel while the operation is
  still `prepared`. Repair after an uncertain or completed access removal
  requires a current owner, except for the self-retry case described above.
- Invitation association and link repair remain organizer operations; for this
  MVP, organizer means the active membership's exact Better Auth `owner` role.
- The Workflow uses a closed `System` actor purpose
  `member_departure_finalize`. That purpose may only read one prepared
  departure and invoke `ConfirmMemberAccessRevoked`,
  `FinalizeMemberDeparture`, or the closed repair-state transition. It cannot
  prepare, cancel, link, restore, archive an arbitrary person, or issue a
  Better Auth mutation.
- Member authorization always occurs before household route derivation. System
  routing is reachable only through the private Worker binding, carries the
  exact organization and operation provenance, and is revalidated by the
  private Worker and object before repository access.
- Once Better Auth no longer has the membership, normal API admission rejects
  the departed user before household routing even while household finalization
  remains pending.

### Privacy and household isolation

The accepted Work Item 01 linkage subject remains the household account-link
boundary: it is a purpose- and version-separated digest of immutable Better
Auth user plus organization identity. Departure extends that link; it does not
replace it with a membership row, session, email, or invitation identity.

Departure commands, operation rows, receipts, audit entries, roster/departure
projections, logs, traces, and public errors must not contain raw email,
invitation tokens or IDs, Better Auth user/member/session IDs, session headers
or tokens, or Better Auth error text. Work Item 02's purpose-bound invitation
digest may exist only in its private association command and row; it must not
enter a household-visible projection, departure operation, audit, receipt, or
observability. The API's Better Auth adapter may hold target user/member
identifiers only in private request or Workflow state needed to perform and
reconcile the canonical operation; those values are never emitted to household
state or observability. Workflow inputs must never contain session credentials.

Operation and Workflow IDs are opaque and domain-separated by organization.
Every member and system command proves the exact organization before object
location. Queries in another household return the same privacy-safe not-found
or unauthorized result and cannot reveal whether an operation, link, person,
membership, receipt, or repair state exists elsewhere.

### Concurrency boundaries

- Prepare atomically fences the captured active person and link by advancing
  both versions and marking the link `departure_pending`.
- Invitation association, accepted linking, link repair, link restoration,
  manual person archive/restore, and future profile changes for that person
  must reject `departure_pending` or stale captured versions. They cannot move
  the person out from under finalization.
- Two departures for the same person/link have one winner. Exact replay
  converges; different intent conflicts.
- Cancel versus start, membership-removal retry versus reconciliation,
  finalization versus repair, and return versus finalization all serialize on
  expected operation/person/link versions. A loser receives a closed stale or
  lifecycle conflict and performs no external action.
- A newly present Better Auth membership observed before household finalization
  blocks archival and requires owner repair. Because no cross-database lock is
  possible, a membership created after the final absence read races as a new
  return: finalization may complete, but accepted linking must find the
  detached archived person and require the explicit same-person return flow.
  It may not create or infer a replacement person.

## Failure visibility

| Failure point | Canonical truth | Visible result and recovery |
| --- | --- | --- |
| Authorization or prepare fails before commit | Membership and household link/person are unchanged | Closed unauthorized, stale, conflict, or unavailable result; no operation exists |
| Prepare commits; its response is lost | Membership remains authoritative; household is `prepared` and `departure_pending` | Show prepared/pending, not completed; exact retry reconciles the receipt; cancellation is still possible only if start has not won |
| Start commits; Workflow creation is absent or cannot be confirmed | Household is `revoking_access`; no Better Auth call is permitted | Show access-revocation pending; exact authorized replay creates or reconciles the deterministic instance, while a replayed start receipt cannot issue removal |
| Workflow is durable, but the request stops before removal is attempted or before it commits | Membership remains present; the Workflow has no trusted outcome signal | After the one-minute wait, the Workflow reads `present`, records visible `revocation_repair_required`, and permits a new removal only through fresh authorization and generation |
| Removal is definitely rejected before commit | Membership remains present; household remains nonterminal | Record safe revocation repair state after bounded handling; expose owner retry and no archival |
| Removal commits, but the request stops before its result signal; or the signal is lost | Membership is absent; the durable Workflow is still waiting | After the one-minute wait, the Workflow reads `absent`, confirms access revocation, and finalizes exactly once without the departed caller's session |
| Removal response is lost or times out but a signal is delivered | Membership outcome is unknown | The signal only wakes reconciliation; read Better Auth, never infer absence, and never blindly remove again |
| Reconciliation is unavailable | Membership outcome remains unknown | Keep revocation pending or record revocation repair required; no finalize command is admitted |
| Membership absence is confirmed; household confirmation fails | Better Auth has revoked access; household may still say revoking | Departed user is denied before routing; retry the idempotent confirmation and expose pending repair to remaining owners |
| `access_revoked` commits; finalization fails or its response is lost | Access is revoked; link/person may still be pending | Show finalization pending/repair required; retry exact system finalization; never restore access or report completion early |
| Finalization commits; response is lost | Membership is absent; link is detached; same person is archived; operation is completed | Receipt replay returns the one completed result without another version, audit, detach, or archive |

No row is a silent eventual-consistency promise. Every nonterminal state has a
queryable household projection, a bounded automatic action, and an explicit
authorized next action.

## Consequences

- Access safety wins over a temporarily untidy roster: membership is absent
  before the person is archived, and remaining owners can see and repair a
  pending household finalization.
- The implementation needs a departure aggregate, link lifecycle extension,
  exact-purpose system admission, the dedicated Workflow, a narrow Better Auth
  membership adapter, and public/UI repair states.
- Raw Better Auth leave/removal routes must not remain an uncoordinated bypass.
- Better Auth organization deletion must remain disabled at the organization
  plugin for both HTTP and typed server calls; this departure slice does not
  implement or approximate the future household deletion lifecycle.
- Real-runtime evidence must cover failure before and after each canonical
  commit, lost responses, restart, retry exhaustion, last-owner behavior,
  replacement membership, same-target races, and cross-household isolation.
  In particular, real Workerd execution with Better Auth D1 and a routed
  `HouseholdObject` must prove both coordinator crash windows: a durable waiting
  Workflow with no committed removal reaches visible repair after reading
  `present`, while a committed removal with its outcome signal lost reads
  `absent` and finalizes exactly once without the departed session.
- Exact-version runtime evidence must also prove that Better Auth
  `1.7.0-rc.6` rejects an owner-authenticated `POST /organization/delete`
  through `auth.fetch` and rejects the typed `auth.api.deleteOrganization`
  call, while the organization, memberships, and routed household remain
  intact.
- Invitation association, accepted linking, explicit link repair, and return
  remain implementation scope for Stage 1 Work Item 02. This ADR decides only
  the departure coordination and does not claim that any Work Item 02 behavior
  is already implemented.

## Alternatives Rejected

### Archive the person before removing membership

Rejected because an archived person does not revoke Better Auth access. The
departed member could still route to household history.

### Treat one authority's success as combined completion

Rejected because there is no cross-D1/SQLite transaction. Lost responses and
partial commits would become hidden or falsely reported success.

### Retry membership removal blindly

Rejected because a timeout is not proof of failure and a replacement
membership may now exist. A canonical Better Auth read must precede any new
removal attempt.

### Let `HouseholdObject` call Better Auth

Rejected because it would mix external effects into the household authority,
weaken its local transaction boundary, and contradict the current private
object composition.

### Use a Queue, alarm, Agent, or generic saga framework

Rejected because the live API already owns native durable Workflows suited to
bounded multi-step coordination. Another primitive or abstraction would not
improve authority, replay, or recovery semantics for this operation.

### Rely on support to edit either database

Rejected because invisible mutation would bypass authorization, receipts,
versions, audit, and stable-person history. Repair is a first-class command,
not an operational exception.

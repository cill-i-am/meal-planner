# Household people public API

The people API uses a same-origin session to identify the caller. It resolves
Better Auth's session, active organization, and membership before routing to
household storage. It does not trust request fields to establish the caller's
organization, actor, role, email, membership, or bearer credentials. Some commands
include target identities or an invitation email, as listed below.

Creating the first linked adult additionally requires the exact Better Auth
`owner` role. Other members receive `creator_required` before the private Worker
or household object is called.

## Operations

| Method and path | Request | Success |
| --- | --- | --- |
| `POST /v1/household/people/bootstrap-creator` | `displayName`, client-stable `mutationId` | Linked adult person |
| `GET /v1/household/people?includeArchived=true\|false` | Optional query flag | Roster, creator-slot state, and current linked person ID |
| `GET /v1/household/people/:personId` | Opaque household-local person ID | One person projection |
| `POST /v1/household/people` | `displayName`, `adult\|dependant`, client-stable `mutationId` | New unlinked person, status 201 |
| `POST /v1/household/people/:personId/archive` | `expectedVersion`, client-stable `mutationId` | Same archived person at next version |
| `POST /v1/household/people/:personId/restore` | `expectedVersion`, client-stable `mutationId` | Same active person at next version |
| `POST /v1/household/people/invitations` | Selected existing `personId`, invitation email, client-stable `mutationId` | Better Auth invitation plus privacy-safe association result |
| `POST /v1/household/people/invitations/associate` | Existing invitation identity, selected `personId`, client-stable `mutationId` | Associated adult projection |
| `POST /v1/household/people/links/complete` | Accepted invitation identity, client-stable `mutationId` | Existing adult linked to the admitted member |
| `POST /v1/household/people/links/repair` | Selected adult, exact version, member identity, reason, client-stable `mutationId` | Explicitly repaired adult link |
| `POST /v1/household/people/departures` | Exact person/link versions, member identity, reason, client-stable `mutationId` | Durable departure operation, status 202 |
| `GET /v1/household/people/departures/:operationId` | Opaque operation ID | Privacy-safe durable operation state |
| `POST /v1/household/people/departures/:operationId/cancel` | Exact operation version, client-stable `mutationId` | Cancelled prepared operation |
| `POST /v1/household/people/departures/:operationId/retry` | Exact operation version, member identity, reason, client-stable `mutationId` | Reconciled departure operation, status 202 |
| `POST /v1/household/people/return` | Accepted invitation identity, archived person and exact version, client-stable `mutationId` | Same restored and linked adult |

Person projections contain only opaque ID, bounded display name, kind,
lifecycle, version, timestamps, and whether the person is the current linked
adult. Archived people are omitted from the roster unless explicitly included;
direct lookup remains household-authorized.

The roster reports the creator slot as `available` or `occupied`. It reads the
stored creator association, rather than guessing from whether the roster is empty
or the caller is linked. It reveals no creator person or account identity.

## Closed failures and replay

Malformed or excess input returns `invalid_request`. Privacy-safe domain
failures are `person_not_found`, `mutation_collision`, `bootstrap_conflict`,
`creator_required`, `stale_version`, `lifecycle_conflict`, and
`people_unavailable`, with HTTP status 400, 403, 404, 409, or 503 as declared by
the generated contract. Session or membership failure returns the shared
`unauthorized` response before household routing.

The server derives two one-way identities from the immutable Better Auth user ID
and the authorized organization ID. Both use the versioned
`meal-planner/household-people` domain, with different purposes: `audit-actor` links
audit events safely; `linkage-subject` links an account to a person.

The linkage subject stays byte-identical across sessions, replacement membership
rows, and restarts. It differs for another user or for the same user in another
organization. Neither the private Worker nor `HouseholdObject` receives the raw
inputs, session, member, role, or email values.

A mutation ID names one accepted request in one household. Retrying the same
request returns the byte-identical saved response. Reusing it with a different
command or payload returns `mutation_collision` and changes nothing in the
person, audit history, association, or receipt.

Archive and restore also require the exact current person version. Errors do not
reveal another household's existence or version.

The first authorized owner to create the creator person takes the one creator
slot. Another owner racing that request or trying later receives
`bootstrap_conflict`: the slot is occupied and their account remains unlinked.
The response reveals neither identity. This is a lasting conflict, not an outage.
Being an owner does not allow creation of a second creator person.

The losing request writes no person, association, audit, or retry receipt. Once
the UI sees the occupied slot, it neither retries the conflict nor offers creator
setup again. The account stays on the shared roster. Account linking is separate
from this work item.

Household storage keeps only a purpose-specific invitation digest. After Better
Auth authenticates the accepting user and checks they are the recipient,
`beforeAcceptInvitation` saves their household-scoped linkage subject on the
association. Link and return require that exact subject. Another member cannot
use the invitation. Link, repair, departure, and return never infer identity from
email or display name.

Before the typed Better Auth membership mutation, the API durably creates the
native departure Workflow. It reads actual membership to recover a missing
removal or a lost result signal. Only confirmed membership absence allows the
specific detach/archive command. Public Better Auth remove-member and leave
routes stay disabled, as does plugin organization deletion. Credentials never
enter Workflow or Household storage.

The full access-first process is in
[Stage 1 Work Item 02](../plans/household-people/02-account-linking-invitations-and-departure.md)
and [ADR-0010](../decisions/adr-0010-coordinate-membership-departure-before-person-archival.md).

## Household-visible profiles

Work Item 03 adds reads for the current profile, a specific version, paged
versions, and audit history, plus one profile-command endpoint. The API checks
current membership before routing. The household object resolves the linkage
subject to an active linked adult; it must not infer it from the separate audit
actor. Only that subject can self-confirm. An authorized adult can confirm a
dependant's facts or make a household-adult edit attributed to themselves.

The initial fact union is `FoodPreference`, `HardConstraint`, and the explicit
reviewed `NoKnownHardConstraints` statement. Missing facts never imply safety
clearance. The public endpoint hardcodes `manual_ui` provenance. The closed public command
cannot supply an actor, email, session, invitation, transcript, or arbitrary
source. Ordinary edits cannot change a safety fact; the distinct safety-change
command requires an explicit confirmation and the UI displays old and proposed
meaning before submission.

Each change inserts one immutable `household_profile_versions` row containing
the typed snapshot, before/after fact, actor and actor-person identities, time,
command, old/new version, and mutation receipt. The latest snapshot is current
state. Version and audit reads use this same ledger, not another writer.

Before insertion, the transaction checks the active adult, subject lifecycle,
receipt collision, expected version, and fact rules. An exact retry can return a
receipt before the archived-subject write check, but still requires current adult
authorization. Archiving and restoring never delete history.

The profile UI keeps one unresolved command per household across feature
navigation, including its exact payload and mutation ID. Other profile mutations
and form changes stay disabled until its result is known. A network error or
malformed reply does not allow a new mutation. After a definite conflict, reload
current state before explicitly submitting again. This restriction is separate
from invitations and departure; it does not introduce a general saga framework.

A completion callback may release only the saved command with the same person
and mutation ID. An earlier request finishing after remount cannot release a
newer one. A decoded authentication rejection shows that sign-in is required but
keeps the original payload and ID, including across remount. The user signs in
in another tab and explicitly retries that command. A later authentication
rejection does not prove that an earlier attempt failed to save.


Stage 2 Work Item 02 adds a dedicated internal `mutateInterviewProfile` command.
It accepts only participant-confirmed closed changes with self confirmation,
rechecks the currently linked active adult equals the bound participant, and
hardcodes `interview` provenance. Shared profiles and audit contain no private
session/card identity or transcript. The authenticated API obtains this command
only from an exact pending confirmation retained in that participant's native
private session; its public continuation accepts metadata only.

The same canonical transaction additionally seals terminal interview outcomes
in `household_interview_profile_receipts`: digest and committed version or
closed rejection reason. Successful versions remain the authoritative profile
receipt. Existing version receipts already seal colliding IDs; a rejected
cross-source attempt must not shadow a prior manual receipt. Durable policy
rejections prevent an older overlapping invocation from committing after a
participant link is restored. Unavailable/unknown outcomes are not terminal.
Current admission is required for receipt recovery, and a private session may
complete only after authoritative settlement of its retained confirmation.

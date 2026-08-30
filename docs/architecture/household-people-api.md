# Household people public API

The household people API is same-origin and session-authenticated. Clients do
not send an organization, actor, role, email, membership, or bearer token. The
API resolves the Better Auth session, active organization, and membership before
private household routing. Creator bootstrap additionally requires the active
membership's exact Better Auth `owner` role; another member receives
`creator_required` before the private Worker or household object is invoked.

## Operations

| Method and path | Request | Success |
| --- | --- | --- |
| `POST /v1/household/people/bootstrap-creator` | `displayName`, client-stable `mutationId` | Linked adult person |
| `GET /v1/household/people?includeArchived=true\|false` | Optional query flag | Roster, creator-slot state, and current linked person ID |
| `GET /v1/household/people/:personId` | Opaque household-local person ID | One person projection |
| `POST /v1/household/people` | `displayName`, `adult\|dependant`, client-stable `mutationId` | New unlinked person, status 201 |
| `POST /v1/household/people/:personId/archive` | `expectedVersion`, client-stable `mutationId` | Same archived person at next version |
| `POST /v1/household/people/:personId/restore` | `expectedVersion`, client-stable `mutationId` | Same active person at next version |

Person projections contain only opaque ID, bounded display name, kind,
lifecycle, version, timestamps, and whether the person is the current linked
adult. Archived people are omitted from the roster unless explicitly included;
direct lookup remains household-authorized.

The list projection includes only whether the household creator slot is
`available` or `occupied`. That state comes from the canonical creator
association, not from roster non-emptiness or the requesting account's link,
and reveals no person or account identity.

## Closed failures and replay

Malformed or excess input returns `invalid_request`. Privacy-safe domain
failures are `person_not_found`, `mutation_collision`, `bootstrap_conflict`,
`creator_required`, `stale_version`, `lifecycle_conflict`, and
`people_unavailable`, with HTTP status 400, 403, 404, 409, or 503 as declared by
the generated contract. Session or membership failure returns the shared
`unauthorized` response before household routing.

The server derives two closed, one-way identities from the immutable Better
Auth user ID and admitted organization ID. Both use a versioned
`meal-planner/household-people` domain plus a distinct purpose:
`audit-actor` records authorization-safe audit correlation, while
`linkage-subject` is the account-to-person association key. The linkage subject
is byte-stable across sessions, membership-row replacement, and Worker/object
restart, but differs for the same user in another organization and for another
user. The private boundary and `HouseholdObject` receive neither the raw inputs
nor session, member, role, or email values.

A mutation ID identifies one admitted intent within one household. Retrying the
same intent returns the byte-identical recorded projection. Reusing it for a
different command or payload returns `mutation_collision` without changing
person state, audit history, association, or receipt state. Archive and restore
also require the exact current person version; failures do not reveal another
household's current version or existence.

The first admitted owner bootstrap occupies the household database's single
creator slot. A distinct owner racing or retrying afterward receives
`bootstrap_conflict`: the household already has a creator person and the
requesting account remains unlinked. The response reveals neither identity and
is a durable conflict, not a temporary outage; owner role alone cannot create a
second creator person. The losing attempt commits no person, association,
audit, or replay receipt. The roster UI does not retry that conflict or offer
creator setup again once the occupied slot is visible. It keeps the admitted
account on the shared roster while account linking remains outside this work
item.

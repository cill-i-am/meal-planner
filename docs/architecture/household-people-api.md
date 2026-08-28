# Household people public API

The household people API is same-origin and session-authenticated. Clients do
not send an organization, actor, role, email, membership, or bearer token. The
API resolves the Better Auth session, active organization, and membership before
private household routing.

## Operations

| Method and path | Request | Success |
| --- | --- | --- |
| `POST /v1/household/people/bootstrap-creator` | `displayName`, client-stable `mutationId` | Linked adult person |
| `GET /v1/household/people?includeArchived=true\|false` | Optional query flag | Roster and current linked person ID |
| `GET /v1/household/people/:personId` | Opaque household-local person ID | One person projection |
| `POST /v1/household/people` | `displayName`, `adult\|dependant`, client-stable `mutationId` | New unlinked person, status 201 |
| `POST /v1/household/people/:personId/archive` | `expectedVersion`, client-stable `mutationId` | Same archived person at next version |
| `POST /v1/household/people/:personId/restore` | `expectedVersion`, client-stable `mutationId` | Same active person at next version |

Person projections contain only opaque ID, bounded display name, kind,
lifecycle, version, timestamps, and whether the person is the current linked
adult. Archived people are omitted from the roster unless explicitly included;
direct lookup remains household-authorized.

## Closed failures and replay

Malformed or excess input returns `invalid_request`. Privacy-safe domain
failures are `person_not_found`, `mutation_collision`, `bootstrap_conflict`,
`stale_version`, `lifecycle_conflict`, and `people_unavailable`, with HTTP status
400, 404, 409, or 503 as declared by the generated contract. Session or
membership failure returns the shared `unauthorized` response before household
routing.

A mutation ID identifies one admitted intent within one household. Retrying the
same intent returns the byte-identical recorded projection. Reusing it for a
different command or payload returns `mutation_collision` without changing
person state, audit history, association, or receipt state. Archive and restore
also require the exact current person version; failures do not reveal another
household's current version or existence.

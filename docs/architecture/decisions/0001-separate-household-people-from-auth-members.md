# ADR-0001 — Separate Household People From Authenticated Members

- Status: Accepted
- Date: 2026-08-24
- Related product decision: [PDR-0001](../../decisions/product/0001-household-people-profiles-and-interviews.md)

## Context

Better Auth owns users, sessions, organizations, memberships, invitations, and
roles. The planning domain must also represent dependants without accounts,
invited adults before account acceptance, and stable eater history across
account-link changes.

Using an auth member as the person identity would either exclude dependants or
force fake accounts. Creating a new person when an invitation is accepted would
split profile, routine, plan, and feedback history.

## Decision

- `HouseholdPerson` is a household-local product identity distinct from Better
  Auth user and membership identity.
- An adult household person may link to one authenticated user in that
  household.
- A dependant has no authenticated account in the MVP.
- An invited adult may exist as a household person before account linkage.
- Linking an account is an identity-link transition and must not create a second
  person or rewrite the person's product history.
- Person profile, routine, portion, feedback, and plan references use the stable
  household-person identity.
- Authorization continues to derive from admitted Better Auth membership before
  routing to household product state.

The exact table and command shapes belong to the implementing capability. This
ADR fixes the identity boundary, not a particular persistence layout.

## Consequences

- The household authority needs a person aggregate and an account-link relation.
- Account deletion, membership removal, and person departure are related but
  distinct lifecycle events.
- Public requests must not accept arbitrary person authority merely because a
  person ID is known; the admitted member and household policy decide allowed
  actions.
- A future dependant account can link to existing history without migration to a
  new person identity.

## Alternatives Rejected

### Use Better Auth membership as the eater

Rejected because dependants and pre-invitation profiles do not naturally have
memberships, and identity lifecycle would be coupled to planning history.

### Create placeholder authentication accounts for dependants

Rejected because it invents credentials, increases privacy and lifecycle
complexity, and does not represent the real product relationship.

### Keep dependants as embedded JSON under an adult profile

Rejected because dependants have independent routines, preferences, portions,
coverage, feedback, and potentially future account linkage.
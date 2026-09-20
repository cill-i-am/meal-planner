# ADR-0001 — Keep household people separate from accounts

- Status: Accepted
- Date: 2026-08-24
- Related product decision: [PDR-0001](pdr-0001-household-people-profiles-and-interviews.md)

## Context

Better Auth manages accounts, sessions, organizations, memberships, invitations,
and roles. Meal planning also needs to represent dependants who have no account
and adults who have not yet accepted an invitation. Each person's food history
must survive changes to their account link.

Using membership as the person's identity would exclude dependants or require
fake accounts. Creating another person when an invitation is accepted would split
that person's profiles, routines, plans, and feedback across two records.

One user can belong to several households. Within one household, however, an
account must not silently link to two people. Incorrect links need a repair path
that keeps the person's history.

## Decision

- `HouseholdPerson` is a household-local product identity distinct from Better
  Auth user and membership identity.
- An adult household person may link to one authenticated user in that
  household.
- One authenticated user may link to at most one `HouseholdPerson` within the
  same household.
- The same authenticated user may link to one person in each of several
  households where they hold admitted membership.
- A dependant has no authenticated account in the MVP.
- An invited adult may exist as a household person before account linkage.
- Linking an account is an identity-link transition and must not create a second
  person or rewrite the person's product history.
- An incorrect or duplicate link is repaired through an explicit authorized and
  audited operation. The runtime must not heuristically merge or delete people.
- Person profile, routine, portion, feedback, and plan references use the stable
  household-person identity.
- Authorization continues to derive from admitted Better Auth membership before
  routing to household product state.

The exact table, uniqueness constraint, and command shapes belong to the
implementing capability. This ADR fixes the identity and cardinality boundary,
not a particular persistence layout.

## Consequences

- The household authority needs a person aggregate and an account-link relation.
- The account-link model requires uniqueness by household and authenticated
  user, while permitting the same user identifier in different household
  authorities.
- Account deletion, membership removal, and person departure are related but
  distinct lifecycle events.
- Membership departure follows the access-first durable coordination protocol
  accepted in
  [ADR-0010](adr-0010-coordinate-membership-departure-before-person-archival.md).
- Link repair must identify the retained stable person and preserve all
  authoritative references and audit history.
- Public requests must not accept arbitrary person authority merely because a
  person ID is known; the admitted member and household policy decide allowed
  actions.
- A future dependant account can link to existing history without migration to a
  new person identity.

## Alternatives rejected

### Use Better Auth membership as the eater

Rejected because dependants and pre-invitation profiles do not naturally have
memberships, and identity lifecycle would be coupled to planning history.

### Create placeholder authentication accounts for dependants

Rejected because it invents credentials, increases privacy and lifecycle
complexity, and does not represent the real product relationship.

### Keep dependants as embedded JSON under an adult profile

Rejected because dependants have independent routines, preferences, portions,
coverage, feedback, and potentially future account linkage.

### Allow one account to link to several people in one household

Rejected for the MVP because it creates ambiguous self-edit, interview,
feedback, and attribution semantics without a proven household use case.

### Automatically merge duplicate linked people

Rejected because profile, plan, routine, feedback, and audit histories may
conflict. Repair needs an explicit human-authorized decision rather than a
lossy heuristic.

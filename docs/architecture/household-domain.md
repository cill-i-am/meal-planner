# Household domain boundary

## Authority

Better Auth remains the global identity and organization control plane. Its
dedicated D1 database owns users, sessions, organizations, memberships,
invitations, and roles. An immutable Better Auth organization identifier is the
household identifier at the application boundary.

The API Worker is the authorization boundary. For `GET /v1/household`, it
resolves the same-origin Better Auth session, reads the active organization,
and validates the caller's membership through Better Auth's public API before
any household routing occurs. The browser does not send an organization
identifier. The active organization value alone never grants access.

## Private household storage tracer

The private `HouseholdDomainWorker` owns the `HouseholdObject` Durable Object
namespace. The API Worker calls it through a Cloudflare service binding after
authorization. Neither the domain Worker nor the object imports Better Auth.

One object is addressed deterministically as
`household:v1:<immutableOrganizationId>`. The name is an internal routing
detail, not a public identifier or authorization mechanism. The object stores
one `household_meta` row through Drizzle SQLite, including the organization ID
and its creation time. Every ensure/read asserts that the stored organization
ID matches the admitted routing input. Initialization is lazy, idempotent, and
safe to retry.

Drizzle Kit owns the checked-in Durable SQLite migration under
`apps/api/household-migrations`. Alchemy's Durable Object Drizzle runtime
applies it inside the object. Application data access uses Drizzle; it does not
issue raw SQL.

## Current scope

This is a narrow vertical tracer. The frontend displays the household storage
state for the selected organization using an organization-keyed TanStack Query.
The generated same-origin client calls `GET /v1/household` without placing an
organization ID, bearer token, or household scope in the request.

Recipe imports, meal plans, recipes, shopping lists, and preferences have not
been moved into the household object. Their current persistence remains
unchanged. There is no registry, organization-to-object lookup table, shared
domain read model, dual write, or compatibility path.

## Proof boundary

Provider-free Miniflare coverage traverses the public Website Worker, raw
Cookie/Set-Cookie proxy, private API Worker service binding, Better Auth D1
membership check, private household service binding, domain Worker, Durable
Object RPC, and real SQLite storage. It proves idempotent initialization,
provenance mismatch rejection, and rejection of a forged active organization
before private household routing. It does not prove a cloud deployment or
provider lifecycle.

# Household domain boundary

## Authority

Better Auth remains the global identity and organization control plane. Its
dedicated D1 database owns users, sessions, organizations, memberships,
invitations, and roles. An immutable Better Auth organization identifier is the
household identifier at the application boundary.

The API Worker is the authorization boundary for household and meal-plan
requests. It resolves the same-origin Better Auth session, reads the active
organization, and validates the caller's membership through Better Auth's
public API before any household routing occurs. The browser does not send an
organization identifier. The active organization value alone never grants
access.

## Private household storage

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

## Meal-plan authority

`HouseholdObject` SQLite is the canonical store for a household's meal-plan
aggregate. It owns the plan state and revision, the create-request fingerprint,
and the mutation receipts used to make swaps, approvals, and rejections safe to
retry. The repository updates plan state and its mutation receipt in one
Drizzle transaction. A repeated mutation returns its recorded result; reusing
the mutation identifier for a different request is a conflict.

The authenticated API derives the organization and actor from the Better Auth
session. Public meal-plan requests do not accept either value. After checking
organization membership, the API calls the private `HouseholdDomainWorker`
through its service binding. The domain Worker validates the command and routes
the immutable organization identifier to the corresponding object. The object
does not authenticate callers and does not import Better Auth.

Better Auth D1 remains the global identity and organization control plane. It
does not store meal-plan aggregate state.

## Approved-recipe boundary

The existing shared D1 database remains the authority for recipe-import records,
recipe reviews, and whether a recipe is approved. Before meal-plan creation or a
manual swap, the API reads only the admitted organization's approved recipes and
converts them to the neutral, typed recipe snapshots accepted by the household
domain. The `HouseholdObject` stores those snapshots as part of the meal plan;
it does not become the authority for the underlying recipe or review.

This is a one-way read at the application boundary. Meal-plan commands do not
write recipe state back to shared D1, and shared D1 does not receive a copy of
household meal-plan state.

## Current scope

The existing frontend tracer displays household storage state for the selected
organization using an organization-keyed TanStack Query. Its generated
same-origin client calls `GET /v1/household` without placing an organization ID,
bearer token, or household scope in the request.

This slice adds the authenticated meal-plan API and moves only the meal-plan
aggregate into `HouseholdObject`. It does not add a meal-plan frontend because
the product policy for meal-plan creation and review is unresolved. Adding that
interface here would invent product behavior.

Recipe-import storage, recipe reviews, workflows, queues, R2 evidence, provider
integrations, shopping lists, and preferences remain where they are. There is no
registry, organization-to-object lookup table, shared meal-plan read model,
dual write, legacy adapter, or compatibility path.

## Proof boundary

Provider-free Miniflare coverage traverses the exact Website API-proxy
functions, a private API service binding, the production household request
composition, Better Auth D1 membership checks, the private household service
binding, the production domain Worker entrypoint, Durable Object RPC, and real
SQLite storage. The Website host is a narrow shell because the complete
TanStack entrypoint depends on Vite-generated virtual modules; the API host
supplies disposable D1 and secret bindings rather than initializing unrelated
recipe-import resources. The proof therefore covers the production security
and domain compositions, not either full deployable entrypoint. Separate
structural guards tie those compositions and private bindings to the real
Workers.

The runtime tests prove idempotent initialization, provenance mismatch
rejection, and rejection of a forged active organization before private
household routing. Meal-plan tests additionally exercise create and read across
a runtime restart, organization isolation, create-request replay and collision,
optimistic revision conflicts, mutation replay and collision, and terminal-state
protection against real Durable Object SQLite. They do not prove a cloud
deployment or provider lifecycle.

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
namespace. The API Worker calls it through a Cloudflare service binding only
after authorization. It sends a closed admitted envelope: a member actor is a
one-way digest, while a system actor has one enumerated internal purpose. The
private Worker Schema-decodes that envelope, derives the route, and admits only
the command purposes allowed for that actor category. The object Schema-decodes
the clone again before domain code. Neither boundary imports or queries Better
Auth.

The central locator addresses one object as
`household:v1:<sha256(canonical-v1-organization-payload)>`. The opaque versioned
name contains no raw organization identifier. Only the locator may derive the
name, and it runs after Better Auth session and membership proof. The object
stores one `household_meta` row through Drizzle SQLite, including the immutable
organization ID and its creation time. Every operation asserts that persisted
provenance matches the admitted organization before reading or mutating
capability state. A mismatch exposes only a closed privacy-safe failure.

Drizzle Kit owns the checked-in Durable SQLite migration under
`apps/api/household-migrations`. Alchemy's Durable Object Drizzle runtime
applies it inside the object. Application data access uses Drizzle; it does not
issue raw SQL.

The Alchemy class host is deliberately thin and stable: it owns Cloudflare
class/namespace lifecycle and installs the runtime layers. Feature-first
runtime modules own command composition. Per-object Drizzle migrations alone
own SQLite schema evolution; a class deployment is not a database migration.

## Foundation authority services and dispatch preparation

Effect services provide authoritative Clock access, identity generation,
canonical encoding, and SHA-256 digests. Domain operations and repositories do
not call ambient `Date.now()`, `crypto.randomUUID()`, or hashing APIs. Tests
replace those services with deterministic implementations, and structural
guards keep ambient APIs confined to the live adapter.

The household schema includes preparatory import-Workflow admission and local
outbox tables. One short SQLite transaction records the command digest,
immutable committed result, deterministic privacy-safe Workflow identity, and
compact dispatch intent. External I/O is forbidden in that transaction. Alarm
scheduling happens only after commit through a local port. Dispatch state can
move from `pending` to `exhausted`, but replay still returns the original
committed domain result.

This preparation is intentionally unmounted from the production private Worker
until the complete import authority cutover. It does not write current import
state, start a Workflow, or change public import behavior.

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
through its service binding. The domain Worker validates the admitted command
and asks the central locator for the corresponding opaque object name. The
object verifies the admitted actor category and its persisted organization
provenance; it does not query Better Auth.

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

The ordered replacement of the remaining household-owned capabilities is
defined in
[household-capability-migration-plan.md](household-capability-migration-plan.md).
That plan supersedes this section whenever a listed capability is delivered.

The existing frontend tracer displays household storage state for the selected
organization using an organization-keyed TanStack Query. Its generated
same-origin client calls `GET /v1/household` without placing an organization ID,
bearer token, or household scope in the request.

The current delivered product authority in `HouseholdObject` is still only the
meal-plan aggregate. It does not add a meal-plan frontend because
the product policy for meal-plan creation and review is unresolved. Adding that
interface here would invent product behavior.

Recipe-import storage, recipe reviews, workflows, queues, R2 evidence, provider
integrations, shopping lists, and preferences remain where they are. The new
admission/outbox contract is foundation preparation, not a dual write. There is
no registry, organization-to-object lookup table, shared meal-plan read model,
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

The runtime tests prove first activation, idempotent/repeated migrations,
fail-closed migration failure, provenance mismatch rejection, double-decode
rejection at private Worker and object boundaries, and rejection of a forged
active organization before private household routing. They also prove physical
object isolation, restart durability, atomic admission/outbox rollback,
deterministic Workflow identity by execution generation, stable replay while
dispatch is pending or exhausted, and post-commit alarm failure against real
Durable Object SQLite. Meal-plan tests retain create/read restart, replay,
collision, optimistic concurrency, and terminal-state proof. Structural guards
cover routing privacy, Better Auth placement, authority-service use, transaction
I/O, the thin host, and the acquisition generation fence. These tests do not
prove a cloud deployment or provider lifecycle.

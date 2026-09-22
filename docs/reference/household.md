# Household domain boundary

## Authority

Better Auth manages identity and organizations in a separate D1 database. It stores
users, sessions, organizations, memberships, invitations and roles. The application
uses the immutable Better Auth organization ID as the household ID.

The API Worker checks access before routing household or meal-plan requests. It
reads the same-origin Better Auth session, finds the active organization and checks
membership through Better Auth's public API. The browser does not supply an
organization ID. Selecting an active organization does not by itself grant access.

### Auth runtime

The API uses `@alchemy.run/better-auth`, pinned to the Alchemy version. Its auth
instance belongs to the request's execution scope, which also owns pending
background work. Application callers use Effect operations for sessions,
membership and invitations. Provider failures fail closed at the admission and
control-plane boundaries.

The integration supplies Alchemy's `Database` service with the existing guarded
Drizzle relations-v2 adapter. The built-in Drizzle layer does not expose this
adapter variant or its output fence. Native HTTP handling and server-retained
invitation IDs use Alchemy's documented native-instance access so their
AsyncLocalStorage guards enclose the actual Promise execution.

`BETTER_AUTH_SECRET` remains the signing secret. Automatic Better Auth migrations
are disabled: Drizzle Kit and `apps/api/auth-migrations` still own the schema,
applied through `MealPlannerAuthDatabase`. The CLI and native adapter tests share
the same plugin and policy configuration as the Alchemy runtime. See Alchemy's
[Better Auth guide](https://alchemy.run/better-auth/),
[Drizzle layer](https://alchemy.run/providers/betterauth/drizzle/) and
[migration ownership](https://alchemy.run/better-auth/migrations/).

## Private household storage

The private `HouseholdDomainWorker` owns the `HouseholdObject` Durable Object
namespace. After checking access, the API Worker calls it through a Cloudflare
service binding. The command envelope allows only defined fields. A member actor
is represented by a one-way digest; a system actor has one listed internal purpose.
The private Worker decodes the envelope with Schema, finds the route and allows
only commands permitted for that actor category. The object decodes the cloned
value again before domain code uses it. Neither component imports or queries
Better Auth.

Only the central locator derives the object name:
`household:v1:<sha256(canonical-v1-organization-payload)>`. It runs after the session
and membership checks. The versioned name contains no raw organization ID.
The object stores the immutable organization ID and creation time in one
`household_meta` row through Drizzle SQLite. Before every read or write, it checks
that the stored organization matches the authorized command. A mismatch returns
a defined error that reveals no private data.

Drizzle Kit owns the checked-in Durable SQLite migration under
`apps/api/household-migrations`. Alchemy's Durable Object Drizzle runtime
applies it inside the object. Application data access uses Drizzle; it does not
issue raw SQL.

The Alchemy class host manages the Cloudflare class and namespace lifecycle and
installs runtime layers. Feature modules compose commands. Only per-object Drizzle
migrations change the SQLite schema; deploying a class is not a database migration.

## Authority services and post-commit dispatch

Effect services supply the Clock, IDs, canonical encoding and SHA-256 digests.
Domain operations and repositories must not call `Date.now()`, `crypto.randomUUID()`
or hashing APIs directly. Tests substitute deterministic services. Structural
checks keep those runtime APIs inside the live adapter.

When accepting a recipe import, one short SQLite transaction saves the request,
idempotency record, command digest, immutable result, deterministic private
Workflow ID and outbox entry. The transaction performs no external I/O.
After commit, the host starts the Workflow or checks whether it already started.
It records each delivery result and retries with the same saved Workflow ID.
Dispatch moves from `pending` to `dispatched` or `exhausted`, but only a confirmed
refusal before startup can mark it exhausted. A lost response or an unavailable
status check leaves it pending under the same ID until a later retry resolves it.
Repeating the command returns the original committed result.

## Meal-plan authority

`HouseholdObject` SQLite stores the household's meal plans. It owns plan state and
revision, the create-request fingerprint and mutation receipts for safely retrying
swaps, approvals and rejections. One Drizzle transaction updates both plan state
and the receipt. Repeating a mutation returns the saved result. Reusing its ID
with a different request returns a conflict.

The authenticated API gets the organization and actor from the Better Auth
session; public meal-plan requests cannot supply them. After checking membership,
the API calls `HouseholdDomainWorker` through its private service binding. The
Worker validates the authorized command and asks the locator for the object name.
The object checks the actor category and stored organization without querying
Better Auth. Only then does it attach the authorized member digest and the
Effect Clock time. A mutation cannot provide another actor or audit timestamp.

Better Auth D1 manages identity and organizations. It does not store meal-plan state.

## Household person registry authority

Only `HouseholdObject` SQLite writes household people, active or archived status,
the creator's account association, per-person versions, immutable lifecycle audits
and mutation receipts. It generates opaque UUID-based person IDs. Archive and
restore keep the ID and increase its version. There is no shared household D1
copy, compatibility path, hard delete, merge or link inferred from a name or email.

After checking the session, active organization and membership, the API creates
two separately branded SHA-256 identities from the immutable Better Auth user and
organization IDs. Their encoding is versioned and uses separate domains.
`audit-actor` links household audit records. `linkage-subject` identifies the account
side of the saved creator association. Each household database has one fixed
creator slot, and both the linkage subject and person are unique. The link stays
stable across sessions, membership-row changes and Worker or object restarts,
while remaining specific to that account and household. Raw user, membership,
session, invitation, role and email values never enter household commands or storage.

Ordinary people commands carry a defined member authorization. Creating the
household's first linked person requires more: the active Better Auth membership
must have `role === "owner"` to receive `better_auth_owner` authority. The public
API rejects a non-owner before calling the gateway, routing to the Worker or
locating the object. The private Worker and object each check that creator
permission. Before opening the repository, the object also checks the exact
purpose and the stored organization.

Creating the linked creator, creating an unlinked person, archiving and restoring
each save the person, version, audit, any creator association and private retry
receipt in one Drizzle SQLite transaction. Creator setup first checks for an exact
receipt, then atomically reserves the fixed creator slot before inserting the person.
Another authorized owner receives a defined conflict without any new person, audit,
association or receipt. That conflict means the slot is occupied and the requesting
account is unlinked. It neither names the winner nor indicates a retryable storage
failure. Mutation IDs are unique across people commands within one household.
An exact retry returns the saved result without another write. Changed input
conflicts; stale versions and invalid transitions are rejected. Each household has
its own IDs and receipt namespace. People transactions perform no external I/O.

The roster reports the creator slot as only `available` or `occupied`, based on
the saved association row. It does not infer that status from roster size or the
requesting account's link, and it does not reveal the associated person or account.

The public contract and generated same-origin client are documented in
[household-people-api.md](household-people-api.md).

Work Item 02 adds explicit invitation associations, account linking after
membership acceptance, reasoned link repair and return to the same person record.
Household SQLite stores only a purpose-specific invitation digest and a stable
household-specific linkage subject derived from immutable Better Auth user and
organization IDs. Raw email, invitation IDs, member IDs and session data stay out
of household storage and responses. Better Auth alone manages membership, roles
and invitations.

[ADR-0010](../decisions/adr-0010-coordinate-membership-departure-before-person-archival.md)
defines departure. `MealPlannerApi` uses a dedicated native Workflow to revoke
Better Auth access. `HouseholdObject` stores the visible, versioned departure
operation and allows system-purpose detach or archive only after membership is
confirmed absent. Save the Household prepare/start transition and create the
deterministic Workflow before the authenticated Better Auth removal. If removal
or its response is missing, read membership from Better Auth to resolve the result.
A last owner stays linked and enters a repair state. Credentials never enter
Workflow or Household storage. Household transactions perform no external I/O.

## Recipe-import and Recipe Bank authority

`HouseholdObject` SQLite stores accepted import requests, source ownership and
deduplication, lifecycle and timeline, execution-generation checks, active review,
answers, corrections, cancellation, approval, publication, recipes and retry
receipts. Public handlers and internal Workflow commands access this data only
through the private household API.

One local transaction confirms a review: it completes the active action, publishes
the Recipe Bank record, moves the import through finalizing to succeeded, appends
timeline facts and saves the retry receipt. Source deduplication and a race between
cancel and confirm are therefore ordered by the same household storage.

Meal-plan creation and swaps read the local Recipe Bank directly. Reads use cursors
and limit both item count and bytes. Publication rejects an encoded recipe larger
than the planning page's safe per-item budget. The planner can read more than 128
approved recipes without loading an unlimited snapshot or getting stuck on an
oversized row. It selects assignments once within a bounded search, then loads
their actual review versions and fingerprints before saving the proposal. Create
and swap commands accept recipe IDs, not caller-supplied snapshots claiming to be
approved recipes. Shared planning schemas live in `@meal-planner/recipe-domain`.

## Recipe-import batch authority

Only `HouseholdObject` SQLite stores import batches, item membership, retry results,
status, generation, completion, failure and queue outbox state. One local Drizzle
transaction saves the batch, all items and an outbox row per item. An exact retry
returns the original public batch result. Conflicting retries and stale item
generations fail without changing state.

The object alarm reads committed outbox rows and sends a defined Queue message
with immutable organization, batch, item and generation IDs. Queue and DLQ results
describe transport delivery, not product state. The consumer starts one deterministic
Workflow for each item generation. Queue and DLQ retries look up that same ID.
The system records delivery, but keeps the household outbox eligible for the alarm
until the item finishes, so the alarm can keep reconciling unfinished work.
Queued, running, paused and waiting Workflows remain active. Errored or terminated
ones restart under the same ID. If status is unavailable or unknown, keep the item
unfinished and retain its outbox entry. Only proof that no Workflow started allows
`dispatch_exhausted`. The Workflow claims the local item, accepts the ordinary
recipe import, starts external dispatch after commit and saves success or failure
back to household SQLite. Queue, Workflow, provider, network and other external I/O
must not run inside a household transaction.

Global D1 has no batch tables, idempotency ledger, route, repository, service,
or writer. There is no compatibility read, dual write, backfill, or fallback to
the retired prototype authority.

## Evidence metadata and R2 references

`HouseholdObject` SQLite stores the compact acquisition, transcription, visual,
carousel and extraction results needed by the product. One transaction checks the
execution generation and saves the defined stage result, integrity metadata, compact
R2 references and retry receipt. An exact retry returns the same private result.
Changed input under the same mutation ID or a stale generation fails without a write.

The household saves one stable start time for each provider dispatch and recovery
dispatch. Claim, Fail, artifact and retry commands reuse it, so a lost Workflow
response cannot change the command digest. Execution generation protects household
state; acquisition-attempt generation separately identifies retry-specific R2 objects.
Before acquisition, the Workflow claims a deterministic
`(intent, execution generation, attempt ordinal)` in household SQLite. After restart,
it reads the claims and checks the create-only R2 media and manifest pair before
allocating another generation. It reuses and commits valid evidence. Only missing,
incomplete or invalid evidence starts another attempt. Retrying a lost claim
response with the same identity returns the same generation.

Large media, transcripts, manifests and other evidence stay in private R2 objects.
References record generation, byte length, SHA-256 and retention time. Reading a
reference preserves its saved source shape: video acquisition has media and manifest
references; a carousel has one manifest plus the carousel stage's stable commit ID
and time. Workflows inspect R2 before or after a household command, never inside
its transaction. Missing or deleted objects change only the household's availability
observation, not the saved reference or current result. Asynchronous R2 lifecycle
deletion is an additional safeguard.

Acquisition and recovery Workflows carry the authorized organization to the
household API, read its saved references and check generation, object key, native
checksum and custom metadata before recording availability. There is no
import-to-organization route, R2 event Queue, event consumer or event DLQ. The app
does not treat an asynchronous R2 lifecycle notification as authoritative product data.

## Current scope

The move to household storage is complete. The
[household migration record](../explanation/household-authority.md) summarizes its
requirements and delivery history.

The existing frontend example shows storage state for the selected organization
using an organization-keyed TanStack Query. Its generated same-origin client calls
`GET /v1/household` without putting an organization ID, bearer token or household
scope in the request.

`HouseholdObject` owns household people, meal planning, recipe import, review,
Recipe Bank, compact evidence and extraction metadata, terminal checkpoints and
recovery attempts. R2 holds only large private files. `ProviderAccountingDatabase`
stores the five global provider-cost tables. It has no organization column,
household table, import route, execution view or household product writer.
`MealPlannerAuthDatabase` is the separate Better Auth database. Provider dispatches
explicitly store `settled_conservative`; immutable audit and recipe-retry evidence
protect that transition, and its transaction updates the budget exactly once.
Recovery does not depend on the global accounting store. Shopping lists and
preferences are not yet implemented. There is no shared registry,
organization-to-object lookup table, shared product read model, dual write, legacy
adapter, fallback or compatibility path.

## Proof boundary

Provider-free Miniflare tests call the exact Website API-proxy functions, private
API service binding, production household request code, Better Auth D1 membership
checks, private household service binding, production domain Worker, Durable Object
RPC and real SQLite storage. The Website test host is small because the complete
TanStack entrypoint needs Vite-generated virtual modules. The API test host supplies
disposable D1 and secret bindings without starting unrelated import resources.
These tests therefore cover the production security and domain code, not the full
deployable entrypoints. Separate structural checks tie that code and its private
bindings to the real Workers.

The runtime tests prove first activation, idempotent/repeated migrations,
fail-closed migration failure, provenance mismatch rejection, double-decode
rejection at private Worker and object boundaries, and rejection of a forged
active organization before private household routing. They also prove physical
object isolation, restart durability, atomic admission/outbox rollback,
deterministic Workflow identity by execution generation, stable replay across
dispatch outcomes, source ownership, generation/version fences, review and
terminal races, atomic confirmation/publication, and bounded Recipe Bank use
beyond 128 recipes. Meal-plan tests retain create/read restart, replay,
collision, optimistic concurrency, and terminal-state proof. Evidence tests
also cover household-only terminal failure through settlement/recovery,
identical replay, conflicting replay, stale generation, restart persistence,
and physical absence of legacy D1 authority. Structural guards cover routing
privacy, Better Auth placement, authority-service use, transaction I/O, the
thin host, the acquisition generation fence, and permanent removal of
superseded D1 authorities. These tests do not prove a cloud
deployment or provider lifecycle.

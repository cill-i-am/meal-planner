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

## Authority services and post-commit dispatch

Effect services provide authoritative Clock access, identity generation,
canonical encoding, and SHA-256 digests. Domain operations and repositories do
not call ambient `Date.now()`, `crypto.randomUUID()`, or hashing APIs. Tests
replace those services with deterministic implementations, and structural
guards keep ambient APIs confined to the live adapter.

Recipe-import admission uses these services in one short SQLite transaction to
record the intent, idempotency ledger, command digest, immutable committed
result, deterministic privacy-safe Workflow identity, and compact outbox
intent. External I/O is forbidden in that transaction. The host starts or
reconciles the Workflow only after commit, records every delivery outcome, and
retries the same persisted Workflow identity. Dispatch status can move from
`pending` to `dispatched` or `exhausted`, but replay always returns the original
committed domain result.

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
provenance; it does not query Better Auth. Mutation commands cannot supply an
independent actor or audit timestamp: the object binds the admitted member
digest and an Effect-provided Clock instant only after those checks pass.

Better Auth D1 remains the global identity and organization control plane. It
does not store meal-plan aggregate state.

## Recipe-import and Recipe Bank authority

`HouseholdObject` SQLite is the canonical store for import admission, source
ownership and deduplication, public lifecycle and timeline, execution fences,
active review, answers and corrections, cancellation, approval, publication,
recipes, and replay receipts. Public handlers and internal Workflow commands
reach that state only through the private household boundary.

Review confirmation is a cross-capability local transaction: it completes the
active action, publishes the Recipe Bank record, advances the import through
finalizing to succeeded, appends timeline facts, and stores the replay receipt
atomically. Source-dedup and cancel-versus-confirm races therefore serialize in
the same household authority.

Meal-plan creation and swaps query the local Recipe Bank capability directly.
Iteration is cursor-, item-, and byte-bounded, and publication rejects an
encoded recipe above the planning page's safe per-item budget. Planning can
therefore consume more than 128 approved recipes without an unbounded snapshot
or one oversized row blocking iteration. The removed shared-D1 recipe-source
gateway and transfer-size workaround have no compatibility path.

## Evidence metadata and R2 references

`HouseholdObject` SQLite also owns the compact acquisition, transcription,
visual, carousel, and extraction outcomes needed by the household product. A
single generation-fenced transaction commits each closed stage result, its
integrity metadata, compact R2 references, and replay receipt. Exact retries
return the same privacy-safe result; a changed command under the same mutation
identity or a stale generation fails without mutation.

The household also checkpoints one stable start time for every provider
dispatch and recovery dispatch. Claim, Fail, artifact, and retry commands reuse
that value, so a lost native Workflow response cannot change the command digest.
Execution generation fences household state; acquisition-attempt generation is
tracked separately for retry-scoped R2 objects.

Large media, transcripts, manifests, and other evidence bytes remain private
R2 objects. Their references carry generation, byte length, SHA-256, and
retention time. Reference reads preserve the committed source shape: video
acquisition starts with media and manifest references, while a carousel starts
with its single manifest and the carousel stage's stable commit identity and
time. Workflows and Queue consumers inspect R2 before or after a household
command, never during the local transaction. Missing or deleted objects change
only the household-local availability observation; they do not rewrite the
committed reference or corrupt the current result. R2 lifecycle deletion
remains asynchronous defense in depth, and late or replayed event notifications
are fenced by household, import, generation, object key, and integrity metadata.

After authenticated import admission, the API synchronously registers a
private, noncanonical import-to-organization route before starting the
Workflow. A private D1 table stores that route with import ID as its unique key
and the immutable execution generation only so an R2 event consumer can
reconstruct an admitted system command. The generation encoded in the R2 key
and custom metadata is the acquisition-attempt generation: it scopes artifact
identity and integrity checks, while the route's execution generation remains
the household RPC and ownership fence. The unordered Queue carries R2
notifications only, so a valid lifecycle event
cannot overtake registration. Registration atomically inserts and reads the
immutable winner, so concurrent conflicting organizations fail closed instead
of overwriting one another. The route is never a public lookup, household
authority, product read model, or source of object names, and raw organization
identifiers are never logged or returned. The consumer receives a read-only R2
binding, and exhausted retryable notifications are retained by a dedicated
evidence-event DLQ.

## Current scope

The ordered replacement of the remaining household-owned capabilities is
defined in
[household-capability-migration-plan.md](household-capability-migration-plan.md).
That plan supersedes this section whenever a listed capability is delivered.

The existing frontend tracer displays household storage state for the selected
organization using an organization-keyed TanStack Query. Its generated
same-origin client calls `GET /v1/household` without placing an organization ID,
bearer token, or household scope in the request.

The delivered product authorities in `HouseholdObject` are meal planning, the
complete recipe-import/review/Recipe Bank capability, compact evidence and
extraction metadata, terminal checkpoints, and recovery attempts. R2 retains
only large private bytes. Shared D1 retains the private immutable import-event
route, global provider-budget settlement/reconciliation, and approved global
operational facts; it cannot author household evidence, terminal or recovery
state, public lifecycle, review, or Recipe Bank state.
Its acquisition execution row contains no evidence-reference projection or
provider-stage completion status.
Shopping lists and preferences have not moved. Apart from the private,
noncanonical import-event route above, there is no registry,
organization-to-object lookup table, shared product read model, dual write,
legacy adapter, or compatibility path.

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

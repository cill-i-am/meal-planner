# Recipe import intent architecture

## Canonical authority

One per-organization SQLite-backed `HouseholdObject` is the only authority for
the moved recipe-import product state. It owns:

- admission, import identity, idempotency, and deterministic Workflow identity;
- submitted-source ownership, canonical-source deduplication, redirects, and
  execution-generation fences;
- public lifecycle, version, timeline, active review action, answers,
  corrections, tags, and transitions;
- cancellation, approval, publication, recipe identity and history; and
- batch/item membership, batch replay and lifecycle, and batch dispatch outbox;
  and
- mutation and dispatch receipts.

The same household database also owns meal plans and the local Recipe Bank.
Meal planning reads bounded pages of approved recipes directly from that local
capability. There is no shared-D1 recipe projection, recipe-source gateway,
dual write, legacy read, or compatibility adapter.

The production acquisition Workflow commits acquisition, transcription,
visual, carousel, and extraction metadata only through the private household
boundary. Terminal checkpoints and recovery attempts are committed and read
only through that boundary. The dedicated `ProviderAccountingDatabase` D1
retains only production-owned provider budgets, reservations, settlement,
reconciliation, and receipt facts. Those global operational records have no
organization or household ownership column and cannot author household
evidence or recovery, publish a recipe, answer a review, change public lifecycle
state, or serve a public Recipe Bank read. Better Auth uses its own separate D1.

`ImportMediaAcquisitionObject` remains a noncanonical, generation-fenced
execution coordinator. It transports temporary media and artifacts but is not
a tenancy, lifecycle, review, Recipe Bank, or recovery authority.

## Media artifact ownership

The acquisition coordinator owns the original artifact and its derived audio and
bounded frame variants. Artifact reads decode the full identifier, compare its
acquisition owner with the coordinator, and preserve its variant when forwarding
to the container registry. Other owners, generations, and malformed suffixes are
rejected before streaming. Completed transcription, visual, and carousel outcomes
carry their required integrity and replay metadata.

## Authorization and private routing

Better Auth D1 remains the global identity and organization control plane. The
public API resolves the same-origin session, reads the active organization, and
proves a matching membership through Better Auth's public API before creating
an admitted member command. Possession of an active organization identifier is
not sufficient authorization.

The API then calls the private `HouseholdDomainWorker` through a service
binding. The Worker and `HouseholdObject` both Schema-decode a closed command.
The private Worker derives the object name through the sole privacy-safe
locator; callers cannot choose an object name or household route. Member
commands carry a one-way actor digest. System commands carry one enumerated
purpose, either Workflow dispatch bookkeeping or recipe-import lifecycle
commit. Each purpose admits only its named operations.

The object verifies the persisted organization provenance before every read or
mutation. Cross-household access fails closed without exposing whether the
other household owns a matching import, source, action, or recipe.

## Admission and Workflow dispatch

Admission is one local Drizzle transaction. Before any Workflow call it commits:

- a new unresolved `processing` intent and version-one timeline event;
- the household-local idempotency request fingerprint;
- a deterministic generation-one Workflow instance ID;
- an immutable admission result and dispatch ID; and
- a compact local outbox intent.

An exact idempotency replay returns the committed result. Reusing the key for a
different request is a conflict. The object owns authoritative time, generated
identities, canonical encoding, digests, versions, ordinals, and receipts;
callers cannot supply them.

The host attempts Workflow dispatch only after commit. Each retry reconciles
the same persisted Workflow identity. A confirmed start records `started`; only
a proven pre-start refusal advances the bounded `unavailable` attempts toward
exhaustion. A lost response or unavailable status probe preserves the pending
outbox and fails the durable task so a later replay can reconcile. A dispatch
failure never rolls back or rewrites the committed domain result. Retrying the
outbox cannot duplicate admission.

No D1, R2, `fetch`, Workflow, Queue, service binding, provider, container, or
other network I/O occurs inside a household transaction.

## Batch admission and item coordination

`POST /v1/recipe-import-batches` admits between one and fifty items after the
same Better Auth membership proof as an ordinary import. One household-local
transaction records the canonical batch, ordered item membership, request and
item idempotency, initial generations, and one outbox row per item. `GET
/v1/recipe-import-batches/:batchId` reads that local aggregate. Public batch
projections expose only IDs, counts, status, stable links, versions, safe
failure codes, and admitted intent IDs; submitted URLs and idempotency keys stay
private.

The Durable Object alarm delivers each committed outbox row to
`HouseholdImportBatchQueue`. Its immutable message contains only organization,
batch, item, and generation IDs. A deterministic native Workflow claims the
generation-fenced item, reuses ordinary household import admission, coordinates
the acquisition Workflow outside SQLite, then commits completion or a closed
failure to the batch aggregate. Queue retry
and the dedicated DLQ provide transport evidence only. Both reconcile the same
generation-specific Workflow identity before settlement. A successful Queue
send remains recorded while its household outbox stays alarm-eligible until
the item settles, retaining a durable wake-up. Active statuses remain active,
while errored or terminated instances restart through the same identity. Only
an unambiguous
pre-start refusal may be settled as `dispatch_exhausted` by an admitted system
command; lost responses, unknown status, or unavailable probes remain
recoverable and cannot contradict a live Workflow or orphan committed work.

## Source ownership and execution

The Workflow reads its admitted execution view through the private household
boundary. It receives only the stored source input, import ID, organization,
and expected generation. Source resolution commits the sanitized canonical URL,
media kind, next stage, and mutation receipt in one transaction.

A partial unique index grants one live owner of a canonical source within a
household. Concurrent contenders therefore have one deterministic winner; a
loser becomes `redirected` to that same-household winner. Failed or cancelled
imports release live-source ownership. Identical sources in different objects
are physically isolated and reveal nothing across households.

Every internal lifecycle or draft command carries a closed system purpose, an
expected execution generation, and authority-derived mutation identity where
the command is replayable. Stale generations and stale public/action versions
fail without partial writes or provider calls. Terminal state cannot be
revived.

Provider and R2 work is completed before the Workflow sends a closed evidence
result to the household. The object decodes the command again and atomically
commits generation-fenced stage metadata, integrity-checked R2 references, the
current result, and a replay receipt. The private result exposes no storage key
or provider payload. Exact retries are stable; conflicting replays and stale
generations leave no mutation.

Each provider dispatch, including a recovery dispatch, checkpoints one
household-owned start time and reuses it in every Claim, Fail, artifact, and
replay command. The execution generation remains the household lifecycle
fence, while a separate acquisition-attempt generation scopes retry-created R2
keys. Each attempt generation is claimed through a deterministic intent,
execution-generation, and attempt-ordinal identity in household SQLite. After
a Worker restart, the Workflow verifies the previously claimed generation's
create-only R2 media and manifest before allocating another attempt. A valid
pair is recovered and committed, while absent, incomplete, or invalid evidence
permits the next claim. Claim-response loss replays the same identity and
generation. Native Workflow response loss therefore reconstructs the same
encoded command instead of changing the mutation digest.

R2 references include byte length, SHA-256, deletion time, object kind, and
generation. Reads return the video acquisition's media-and-manifest set or the
carousel stage's single committed manifest with the same stable import,
generation, and commit time across restart. The authoritative admitted source
kind selects that exact closed shape; mixed kinds and out-of-order stage
references fail closed. The acquisition Workflow verifies the native R2
checksum and custom metadata against the admitted household identity,
execution generation, acquisition-attempt generation, and closed object shape
before committing the reference. Recovery repeats that verification through
the same household and Workflow authority. No global import route, R2 event
Queue, event consumer, or event DLQ exists.

Terminal ambiguity commits an immutable household checkpoint before recovery.
Speech and visual recovery each prepare a generation-, predecessor-, and
dispatch-fenced household attempt, then activate the matching Workflow step.
Preparation reuses the originally admitted correlation trace and exact
generation-specific Workflow identity stored by the household; an operator
retry cannot replace either value.
If activation reports an error after the Workflow has already progressed,
settlement accepts only matching terminal household authority; Workflow status
alone cannot turn a still-dispatching recovery into success.

## Public lifecycle and review

Public statuses remain `processing`, `requires_action`, `succeeded`, `failed`,
`cancelled`, and `redirected`. Processing progresses through
`resolving_source`, `acquiring_media`, `analyzing_evidence`,
`extracting_recipe`, `grounding_recipe`, `preparing_review`, and
`finalizing_recipe`.

The household stores the admitted draft snapshot needed for active review and
publication. It exposes only the privacy-safe recipe projection, questions,
answers, tags, blockers, available actions, public lifecycle, and timeline.
Provider payloads, evidence contents, storage keys, actor material, submitted
URLs, and mutation provenance remain private.

Answer, cancellation, and confirmation mutations bind their command digest to
a stable local receipt. An exact replay returns the original result; the same
mutation identity with changed input is rejected. Cancel-versus-confirm and
other concurrent terminal races serialize in the same SQLite authority, so
only one legal terminal result commits.

`confirm-import-review` is one Drizzle transaction. It verifies the active
action and optimistic versions, approves the review, completes the action,
publishes the canonical Recipe Bank row, advances through `finalizing_recipe`
to `succeeded`, appends both timeline facts, and stores the replay receipt.
Failure before commit leaves none of those facts behind.

## Recipe Bank pagination

Recipe Bank iteration is ordered by stable recipe ID and uses an exclusive
cursor. Every page is bounded independently by item count and encoded byte
size. Confirmation rejects any encoded public or planning recipe at 500,000
bytes, below planning's 524,288-byte page budget, so an approved row cannot
poison iteration. Meal planning consumes pages through the local capability
rather than loading an unbounded snapshot. There is no product-level
128-recipe ceiling.

## Public API

`@meal-planner/recipe-import-api` remains the shared Effect Schema, HttpApi,
generated client, OpenAPI, and privacy-safe Problem Details contract. The
authenticated surface supports:

- create and read a recipe-import intent;
- read its timeline;
- read, answer, and confirm its active action;
- cancel an active intent;
- read the recipe produced by a succeeded intent;
- create a recipe-import batch; and
- read a recipe-import batch aggregate.

Public requests never accept an organization ID, actor ID, authoritative time,
result ID, version, ordinal, receipt, Workflow ID, or object name. Expected
domain failures are closed and tagged at the private boundary, then exhaustively
mapped to stable public errors.

## Migrations and proof

Drizzle Kit owns the checked-in per-object SQLite migration under
`apps/api/household-migrations`. It contains the household import, timeline,
review, Recipe Bank, batch, receipt, admission, and outbox tables. Alchemy owns
the Durable Object class/namespace lifecycle but does not replace database
migrations.

The fresh D1 migration under `apps/api/provider-accounting-migrations` contains
only the five production-owned provider accounting tables. It contains no
organization, household, import route, import execution, evidence, lifecycle,
review, Recipe Bank, batch, checkpoint, recovery, or receipt authority. The
former shared household migration history and production repositories are
deleted rather than migrated, preserved, or backfilled. Structural tests reject
reintroducing household product state or tenant-filtered global persistence.

Provider-free Workerd tests exercise the actual Website/API/private-Worker/
`HouseholdObject` composition with Better Auth membership, first activation,
restart, repeated migrations, cross-household isolation, admission through
confirmation and planning, replay/collision behavior, source and terminal
races, post-commit dispatch failure, and pagination beyond 128 recipes. These
tests also prove direct R2 integrity checks, evidence replay,
stale-generation rejection, restart persistence, retention, and missing or
deleted R2 objects. They do not claim provider, deployment, cloud migration, or
production proof.

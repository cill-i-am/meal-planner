# Recipe import architecture

## Canonical authority

Each organization has one SQLite-backed `HouseholdObject`. It is the only writer
for the recipe-import product data moved into household storage. It owns:

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

The production acquisition Workflow saves acquisition, transcription, visual,
carousel, and extraction metadata only through the private household interface.
It reads and writes terminal checkpoints and recovery attempts there too.

`ProviderAccountingDatabase` D1 stores only provider budgets, reservations,
settlement, reconciliation, and receipts used by production. Those global
operational records have no organization or household ownership column. They
cannot create household evidence, recover an import, publish a recipe, answer a
review, change public status, or serve a Recipe Bank read. Better Auth has its
own separate D1.

`ImportMediaAcquisitionObject` coordinates execution for a specific generation.
It transports temporary media and artifacts. It does not own tenancy, public
status, review, the Recipe Bank, or recovery.

## Media artifact ownership

The acquisition coordinator owns the original artifact, derived audio, and
bounded frame variants. Before streaming an artifact, decode its full ID and
check that its acquisition owner matches the coordinator. When forwarding to the
container registry, keep the variant. Reject other owners, other generations, and
malformed suffixes. Completed speech, visual, and carousel results include the
metadata needed for integrity checks and safe retries.

## Authorization and private routing

Better Auth D1 owns global accounts and organizations. The public API resolves
the same-origin session and active organization, then checks membership through
Better Auth's public API before building the authorized member command. An active
organization ID alone does not grant access.

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

The host starts the Workflow only after the transaction commits. Each retry
checks the same saved Workflow identity. A confirmed start records `started`.
Only proof that the Workflow refused to start counts toward the bounded
`unavailable` attempt limit.

After a lost response or unavailable status check, keep the outbox row pending
and fail the durable task so a later retry can reconcile it. A dispatch failure
does not undo or rewrite the saved domain result. Retrying the outbox cannot
admit the same import again.

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

Each provider call, including recovery, records one household-owned start time.
Reuse it in every Claim, Fail, artifact, and retry command. The execution
generation controls which lifecycle writes are allowed. A separate acquisition
attempt generation scopes R2 keys created by retries.

Claim each attempt in household SQLite using a deterministic identity derived
from the intent, execution generation, and attempt ordinal. After a Worker
restart, check the previous generation's create-only R2 media and manifest before
claiming another attempt. Recover and save a valid pair. Missing, incomplete, or
invalid evidence allows the next claim. A lost claim reply retries the same
identity and generation. A lost Workflow response therefore reconstructs the same
encoded command without changing its mutation digest.

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

Before recovery from an unknown terminal result, save an immutable household
checkpoint. Speech and visual recovery prepare a household attempt tied to its
generation, predecessor, and dispatch, then activate the matching Workflow step.
Reuse the original correlation trace and generation-specific Workflow identity
stored by the household. Operator retries cannot replace either.

If activation reports an error after the Workflow has progressed, settle only
from a matching terminal result in household storage. Workflow status alone cannot
turn a still-dispatching recovery into success.

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

Read Recipe Bank pages in stable recipe-ID order with an exclusive cursor.
Each page has an item limit and an encoded-byte limit. Confirmation rejects an
encoded public or planning recipe at 500,000 bytes, below the 524,288-byte planning
page budget. This prevents one approved recipe from making pagination fail.
Planning reads these local pages, not an unbounded snapshot. There is no
product-level limit of 128 recipes.

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

Workerd tests with no real provider calls use the production Website, API,
private Worker, and `HouseholdObject`. They exercise Better Auth membership,
first activation, restart, repeated migrations, household isolation, import
admission through confirmation and planning, retries and ID conflicts, source
and terminal races, post-commit dispatch failures, and more than 128 recipes.

They also check R2 integrity, evidence retries, rejection of stale generations,
restart persistence, retention, and missing or deleted objects. These are not
proof of real providers, deployment, cloud migration, or production operation.
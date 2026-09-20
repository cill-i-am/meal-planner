# Household capability migration decision

## Completed status

The implemented household features no longer use shared household D1 storage.
Each Better Auth organization has one SQLite-backed `HouseholdObject` for its
product data. Better Auth D1 owns accounts and membership. The separate provider
accounting database owns global budgets and settlement. R2 stores large private
files.

The [household domain boundary](../reference/household.md) describes the current
implementation. [Recipe import intent](../reference/recipe-import.md) describes the
import lifecycle. The [architecture decision index](../decisions/README.md) records
accepted domain decisions, including [household recipe authority](../decisions/adr-0005-separate-shared-catalogue-from-household-recipe-authority.md)
and [membership departure coordination](../decisions/adr-0010-coordinate-membership-departure-before-person-archival.md).
[Plans](../plans/README.md) own delivery evidence; the
[documentation standard](../reference/documentation.md) defines record ownership.

This document explains the migration's architecture and future requirements. It
is not an implementation checklist. Later preferences, shopping, and retailer
approval features should start directly in household-local modules. The old
shared-D1 code is deleted. There are no compatibility reads, dual writes,
backfills, or retained experimental schemas.

## Household consistency and authority

`HouseholdObject` gives each household a private database and a place to run
consistent transactions. Feature modules own their models, commands,
repositories, tables, and errors; they need not form one domain aggregate.
Operations spanning features coordinate local transactions explicitly.
Repositories must not hide that coordination or reach into another feature's
internals.

Do not split an atomic command across owning services unless an explicit product
and API decision accepts eventual consistency. Import confirmation therefore
saves review approval, action completion, publication, success status, history,
and the retry result together.

Public requests cannot choose organization, object name, actor, authoritative
time, generation, result version, ordinal, or receipt. The API proves the Better
Auth session and membership before routing; active organization is UI state,
not authorization. One locator derives a versioned, privacy-safe object name
from the admitted immutable organization ID. The private Worker and object each
Schema-decode their runtime boundary. The object checks persisted organization
provenance before any capability access. Closed system purposes admit only their
allowed commands. Neither private boundary repeats the Better Auth query.

The object owns command time, identities, canonical encoding and digests,
versions, ordinals, and receipts through explicit runtime services. Callers may
supply mutation IDs and expected versions for replay and concurrency checks.
Domain code and repositories do not generate authority facts with ambient APIs.
Expected failures are closed, tagged contracts. HTTP exposes its stable Problem
Details; telemetry uses opaque correlations and reason categories rather than
identifiers, URLs, evidence keys, provider payloads, or command bodies.

## Transactions, replay, and orchestration

External I/O and result decoding happen before a closed command enters a short
local transaction. That transaction records the domain outcome, receipt, and any
required outbox intent together. Network calls, D1, R2, providers, containers,
Workflows, Queues, and service bindings stay outside the transaction.

After commit, the host or alarm dispatches the saved work in a way that is safe
to retry. A dispatch failure does not undo a committed command. Retrying the
command returns its original result; pending or exhausted dispatch is separate
processing state. A start with an unknown result remains pending until checked.
Only proof that no Workflow started can exhaust dispatch.

Each admitted import execution generation owns a deterministic, privacy-safe
Workflow ID derived from its intent, generation, and versioned purpose. Admission
persists that ID with the outbox intent. Dispatch retries reconcile the same
instance; a new execution generation gets a different ID. Batch Queue delivery
also retains an alarm-eligible reconciliation signal until household item
settlement, even after transport delivery.

Execution generation fences product results. A separate acquisition-attempt
generation scopes temporary media and create-only R2 objects. Household SQLite
claims the deterministic intent/execution/attempt-ordinal identity; a lost claim
response returns the same generation. Restart first verifies that generation's
media and manifest before advancing an absent, incomplete, or invalid attempt.
Each provider dispatch reuses its persisted household-owned start time across
claim, failure, artifact, and replay commands.

Workflows handle external waits and execution; Queues handle delivery. Neither
owns household product data. R2 keeps large files, with ownership, generation,
checksum, and retention checks. A missing or expired file changes availability,
not the saved result. Workflows check R2 directly; no evidence-event index or Queue
routes these checks. The seven-day `imports/` cleanup runs asynchronously as a
second protection, not as an access rule or correctness deadline.

## Object lifecycle and decomposition

Alchemy owns the stable class, namespace, bindings, and deployment lifecycle.
Checked-in Drizzle migrations own each object's SQLite schema lifecycle. Apply
them under instance initialization gating before admitting commands; restart is
repeatable and migration failure fails closed. A namespace deployment does not
replace schema migration. Normal commands use local transactions rather than
holding a global concurrency block around external work.

A child object needs evidence of a separate coordination boundary. Most of these
criteria should hold:

- An independent durable identity and materially different lifetime or retention.
- Measured hot traffic, a long-lived connection, runtime session, or isolated executor.
- State that never requires an atomic transaction with household state, with
  eventual consistency explicitly accepted by the product.
- Failure, replay, and recovery semantics that justify an RPC or saga boundary.
- Independent placement, scaling, or security controls that solve a measured need.

The existing `ImportMediaAcquisitionObject` owns noncanonical container, process,
session, cleanup, and temporary artifact access. Its coordinator identity fences
import ownership and acquisition generation; source, audio, and frame access
must preserve that fence. It cannot own public lifecycle, household evidence
metadata, Recipe Bank state, receipts, or recovery authority. Remove it if those
independent runtime responsibilities disappear.

Recipes, reviews, plans, and shopping lists are modules by default. Splitting them
into objects would replace local transactions with distributed coordination.
Keep large values in R2, bound rows and transport payloads, and measure household
load before splitting storage. Each additional binding also introduces another
principal-propagation boundary.

## Global facts and queries

Normal product queries route from an authenticated organization to one household.
Support reads require authorization for a known household. Privacy-safe analytics
are noncanonical. Reconciliation and deletion may use a minimal operational index
of opaque object/Workflow IDs and safe statuses. Strict provider budget
reservation is a separately named global authority.

An operational index must not become a household directory or copy recipes,
imports, reviews, plans, or shopping lists. Queries across households need an
explicit architecture and privacy decision. A global product read model would
introduce delayed updates, retries, and deletion in more than one place.
Do not add duplicate stores or compatibility mechanisms merely to preserve the
old design. Follow the greenfield rules in the root instructions.

## Future household deletion requirement

Organization deletion remains disabled until this idempotent lifecycle exists:

1. An authorized command records `Closing`, an authority-owned deadline, and a
   receipt, then fences new commands.
2. Existing Workflow and Queue work is cancelled or settled under an explicit
   policy. Lifecycle and generation checks reject late callbacks.
3. A deletion Workflow removes household R2 prefixes and other external resources
   outside the local transaction.
4. Before clearing local storage, commit a global routing tombstone for the opaque
   object key. The locator must enforce it before every human, system, support,
   Workflow, Queue, alarm, or recovery route resolves the object. Tombstoned
   objects cannot be lazily initialized.
5. The object verifies preconditions, records completion, and calls SQLite
   `deleteAll` only as the final destructive step.
6. A privacy-safe global receipt records completion and retention. PITR restore
   while the tombstone is active is forbidden unless authorized recovery
   explicitly reverses deletion.
7. Better Auth organization deletion completes only after household cleanup
   reaches its terminal outcome.

Every retry returns the existing receipt. Failed cleanup stays recoverable and
visible without reopening writes. Delivery must prove late-callback rejection
after `deleteAll`, tombstone enforcement before resolution, and fenced restore.

## Deferred platform decisions

These are future requirements or evaluation boundaries, not delivered features
or instructions to expand the current scope:

- **PITR:** build an authorized per-object bookmark/restore runbook with audit,
  destructive-command and migration procedures, and a production recovery drill.
  Per-object recovery does not provide fleet backup or inventory; local tests
  cannot establish production restore behavior.
- **Scheduled maintenance:** verify the installed Alchemy API before selecting
  native Workflow scheduling or a managed cron Worker that starts a Workflow.
- **Rate limiting:** use for abuse and load protection, never authorization,
  strict budget, billing, or idempotency.
- **Secrets Store:** evaluate exact-version runtime and local-development support
  for provider/system credentials; household product data and retail grants do
  not belong there.
- **Analytics Engine:** privacy-safe operational telemetry cannot replace durable
  audit, receipts, billing, or product reporting.
- **Turnstile, WebSockets, and Vectorize:** adopt only for demonstrated abuse,
  collaboration, or search needs. A semantic index must remain rebuildable and
  refer to canonical recipe IDs.
- **Actor frameworks:** reconsider only when exact-version evidence shows material
  simplification without obscuring Effect scope, Drizzle ownership, or failures.

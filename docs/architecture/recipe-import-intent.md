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
- mutation and dispatch receipts.

The same household database also owns meal plans and the local Recipe Bank.
Meal planning reads bounded pages of approved recipes directly from that local
capability. There is no shared-D1 recipe projection, recipe-source gateway,
dual write, legacy read, or compatibility adapter.

The shared `MealPlannerDatabase` D1 is noncanonical for this moved state. It
currently retains only execution/evidence records that are scheduled for later
migration slices: acquisition runs and terminal checkpoints, transcription,
visual/carousel evidence, and extraction records. Those records cannot publish
a recipe, answer a review, change public lifecycle state, or serve a public
Recipe Bank read.

`ImportMediaAcquisitionObject` remains a noncanonical, generation-fenced
execution coordinator. It transports temporary media and artifacts but is not
a tenancy, lifecycle, review, Recipe Bank, or recovery authority.

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
the same persisted Workflow identity and records `started` or `unavailable` in
the household outbox. A dispatch failure never rolls back or rewrites the
committed domain result. Retrying the outbox cannot duplicate admission.

No D1, R2, `fetch`, Workflow, Queue, service binding, provider, container, or
other network I/O occurs inside a household transaction.

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
- cancel an active intent; and
- read the recipe produced by a succeeded intent.

Public requests never accept an organization ID, actor ID, authoritative time,
result ID, version, ordinal, receipt, Workflow ID, or object name. Expected
domain failures are closed and tagged at the private boundary, then exhaustively
mapped to stable public errors.

## Migrations and proof

Drizzle Kit owns the checked-in per-object SQLite migration under
`apps/api/household-migrations`. It contains the household import, timeline,
review, Recipe Bank, receipt, admission, and outbox tables. Alchemy owns the
Durable Object class/namespace lifecycle but does not replace database
migrations.

The fresh D1 migration under `apps/api/migrations` contains only the remaining
operational execution/evidence schema. The former D1 import requests, public
intent/history, review, Recipe Bank, batch, and moved receipt tables are deleted
rather than migrated or backfilled. Structural tests reject reintroducing their
production repositories or SQL tables.

Provider-free Workerd tests exercise the actual Website/API/private-Worker/
`HouseholdObject` composition with Better Auth membership, first activation,
restart, repeated migrations, cross-household isolation, admission through
confirmation and planning, replay/collision behavior, source and terminal
races, post-commit dispatch failure, and pagination beyond 128 recipes. These
tests do not claim provider, deployment, cloud migration, or production proof.

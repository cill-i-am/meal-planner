# Recipe import intent architecture

## Authority

`recipe_imports` is the durable `RecipeImportIntent` aggregate and the only
authority for the user-visible import lifecycle. D1 owns intent state, history,
review state, recipes, execution fencing, and recovery ledgers. Cloudflare
Workflow executes work but may advance an import only through guarded intent
commands.

`import_recipe_executor_terminal_checkpoints` is a separate immutable
operational fact. It records the import, acquisition generation, ownership,
evidence references, and checkpoint time needed for replay and recovery. It
does not store or project a second public status. Provider terminal settlement
records that checkpoint and advances the intent through the canonical reducer
and public history in one atomic operation.

## Household tenancy and organization identity

All recipe-import households share the single `MealPlannerDatabase` D1
database. `household_scope_id` scopes the canonical aggregate and its import
requests, idempotency records, history, actions, recipes, deduplication, and
safe not-found behavior. A household does not own or map one-to-one to a
Durable Object. `ImportMediaAcquisitionObject` is addressed by the globally
random `importId` for per-import media/container coordination and transports
private acquired media and artifacts. It does not use its own Durable Object
storage: durable lifecycle and domain state stay in D1, while private artifacts
stay in R2. It is not a tenancy or household-storage boundary.

Better Auth is the global identity and organization control plane. Its dedicated
D1 database contains identity, session, organization, invitation, and membership
tables only; recipe-import domain state remains in `MealPlannerDatabase`.
Email/password sessions use same-origin HttpOnly cookies. An application request
resolves the Better Auth session, reads its active organization, and then
requires an explicit matching membership row before creating the typed Effect
principal. Possession or manipulation of `activeOrganizationId` alone grants no
authority.

The public Website Worker forwards auth and `/v1` application requests to the
private API Worker through a Cloudflare service binding without reconstructing
the request or response. The browser calls the generated
`RecipeImportApiClient` at its own origin; native cookie handling supplies the
session, and no bearer credential, actor ID, or household-scope value is exposed
to browser code.

## Admission, ownership, and duplicate handling

Admission creates the intent immediately, before source resolution. One D1
transaction inserts:

- the unresolved `processing` / `resolving_source` intent;
- its household-scoped idempotency record; and
- version 1 `intent_admitted` history.

The caller therefore receives an addressable intent as soon as the request is
accepted. An exact `(household, Idempotency-Key)` replay returns that result.
Reusing a key for a different canonical request is a conflict.

The configured private-auth principal provides a stable opaque household scope
and actor identity. Bearer values are redacted and never persisted. A resource
owned by another household is indistinguishable from a missing resource for
reads and mutations, and cannot participate in deduplication.

Source resolution is asynchronous. A successful resolver stores a sanitized
canonical HTTPS source and media kind, advances the intent to
`acquiring_media`, claims the next execution generation, appends
`source_resolved`, and then idempotently ensures the deterministic Workflow
instance. A start failure leaves the durable state available to the bounded
stalled-start reconciler.

Within one household, at most one `processing`, `requires_action`, or
`succeeded` intent owns a resolved canonical source. Concurrent resolution has
one database winner. Each loser becomes a terminal `redirected` intent pointing
to the same-household owner and never starts an executor. Cross-household
matches do not redirect or reveal an identifier. Failed and cancelled intents
release canonical-source ownership; their original idempotency keys still
replay their original results.

The submitted URL is private execution input. Before resolution, public state
says only that source resolution is pending. Raw and redirect URLs never enter
public errors, history, logs, or traces.

## Public lifecycle

Public statuses are exactly:

- `processing`
- `requires_action`
- `succeeded`
- `failed`
- `cancelled`
- `redirected`

Processing stages progress monotonically through `resolving_source`,
`acquiring_media`, `analyzing_evidence`, `extracting_recipe`,
`grounding_recipe`, `preparing_review`, and `finalizing_recipe`.
`analyzing_evidence` exposes independent speech and visual progress. Video
completes both; carousel skips speech and completes visuals.

Meaningful stage, component, action, recovery, or terminal changes increment
the intent version exactly once and append exactly one public history event.
Heartbeats, attempts, and private checkpoints do not change the public version.
Safe activity is `working` or `retrying`; `nextAttemptAt` is present only when
the executor has a truthful retry instant.

Every executor command carries an explicit branded execution generation,
deterministic correlation identity, stable mutation identity, and command
digest. Missing or invalid workflow input is rejected before work begins.
Exact replays preserve timestamps and versions. Stale generations and
superseded milestones cannot call providers or regress state. Terminal intents
cannot be revived.

Three generation values protect different boundaries:

- `intentVersion` provides public optimistic concurrency;
- `executionGeneration` fences Workflow execution; and
- `acquisitionGeneration` fences provider ownership and evidence.

Expected executor failures map exhaustively to stable provider-neutral codes,
messages, retryability, and recovery choices. Raw exceptions, provider codes,
storage keys, transcripts, evidence, and source URLs remain private.

Cancellation is legal only from `processing` or `requires_action` and requires
the expected intent version plus an idempotency key. D1 commits cancellation and
history before best-effort Workflow termination. The terminal fence prevents
later executor work even when termination fails.

## Review actions and recipes

At most one review action is active. The action contains its safe editable
recipe projection, questions, answers, planning tags, blockers, and independent
action version. Evidence, extraction fingerprints, provider metadata, actors,
and mutation provenance are never exposed.

Answer and confirmation commands are separately idempotent. Each compares the
active action version and commits the intent, review data, history, provenance,
and a complete non-null mutation receipt atomically. Exact replays return the
original result; changed commands under the same key conflict; stale commands
leave no partial state.

Confirmation commits `processing` / `finalizing_recipe`, approval, and
`succeeded` in one transaction. The succeeded intent references its recipe by
the branded import identifier. `GET /v1/recipes/:recipeId` household-scopes
through that intent and projects the approved review.

## HTTP boundary

`@meal-planner/recipe-import-api` owns the shared Effect Schema, Effect HttpApi,
generated client, OpenAPI metadata, and safe Problem Details contract. Its
authenticated surface is:

- create and read a recipe-import intent;
- read its timeline;
- read, answer, and confirm its active action;
- cancel an active intent; and
- read the recipe produced by a succeeded intent.

Authentication establishes the typed household principal before request-body
decoding. Schema failures and typed domain failures map exhaustively to safe
Problem Details. The production Worker composes this API with explicitly named
health, batch, operator-carousel, and provider-settlement routes, followed by
one final 404 handler. Batch routes and provider terminal settlement authorize
one explicitly configured system principal. Operator-carousel remains
household-principal scoped; associating it with operational routes does not
grant it system authority. Better Auth organization membership cannot control
either system-only surface.

The TanStack Start application calls the generated client from the browser
through an injected Effect Layer at the current origin. TanStack Query owns
browser reactivity and polling; TanStack Form owns mutations. The browser never
receives a private bearer token or constructs a parallel handwritten API
contract.

## Persistence and recovery

The fresh D1 baseline creates only the canonical aggregate and its operational
children: request idempotency, append-only public history, execution and
provider checkpoints, recovery-attempt ledgers, evidence references, review
records, receipts, and guards. Foreign keys, unique indexes, and immutable
triggers are installed directly on an empty database.

`recipe_import_intent_history` records meaningful public facts with immutable
identity `(intent_id, intent_version)`. Timeline reads are pure household-scoped
projections and exclude mutation provenance, actor hashes, providers, storage
keys, transcripts, and evidence.

The stalled-start reconciler scans only `processing` / `acquiring_media` owners,
rechecks the exact execution fence, and idempotently ensures that Workflow
generation. Post-acquisition journals and provider recovery ledgers retain the
checkpoints required to continue safely after retries. Immutable terminal
checkpoints make exact provider settlement replay a no-op while preserving
owner, generation, evidence, and recovery ancestry.

Private evidence is stored in short-retention R2. D1 stores durable control
state and safe references, not provider payloads, media, credentials, or raw
source material.

## Proof boundary

Contract tests cover the Effect schemas and generated client. Node tests cover
pure reducers and services. Workerd tests exercise the real local D1 and R2
bindings, migrations, constraints, races, receipts, household isolation, and
mounted HTTP flow without calling external providers. Workflow tests prove
generation fencing, checkpoints, retries, and recovery. Browser acceptance
covers the responsive submit, processing, action, confirmation, success,
failure, redirect, and cancellation states through canonical `/v1` requests.

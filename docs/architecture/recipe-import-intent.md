# Recipe import intent authority and lifecycle

## Decision

`recipe_imports` is the sole durable `RecipeImportIntent` aggregate. Its
existing repository and `ImportService` remain the only admission and current
lifecycle owner; there is no parallel intent table, mirror, synchronizer, or
read-time projector. The physical table name remains unchanged for a safe
in-place migration.

D1 is authoritative. Cloudflare Workflow is an executor that must act through
one guarded aggregate-transition capability and a fenced execution generation.
The existing review ledger and approved recipe bank remain authoritative
children. Workflow state, review data, and recipe data are not copied into a
second public model.

The retained `import_recipe_terminal_projections` table is compatibility-private
in this slice. Migration precedence moves any later current approved review or
current `needs_review` state into `recipe_imports`; an obsolete terminal
projection cannot override it. Removing the private table is a bounded follow-up
after every legacy settlement path writes the aggregate directly.

## Ownership and admission

A stable opaque household scope is the durable owner. Bearer credentials remain
redacted and are never persisted. A resource in another household is
indistinguishable from a missing resource for reads and mutations, and cannot
participate in deduplication.

Admission is immediate. It atomically inserts an unresolved intent as
`processing` / `resolving_source`, its household-scoped idempotency record, and
version 1 `intent_admitted` history. An exact `(household, Idempotency-Key)`
replay returns that original creation result and location. Reusing the key for
a different canonical public request is a conflict. Compatibility or executor
version changes are private metadata and do not alter that request fingerprint.

The submitted URL is private execution input. Before resolution the public
source says only that TikTok resolution is pending. It must not appear in
public errors, logs, traces, or history.

## Source resolution and canonical duplicates

Resolution is asynchronous. A successful resolver atomically stores a
sanitized canonical HTTPS URL and media kind, replaces the private provisional
canonical placeholder, advances the intent to `acquiring_media`, increments its
public version, claims the next execution generation, and appends
`source_resolved` history. Only after that durable owner transition does the
application idempotently ensure the deterministic Workflow instance is
started. An exact source-resolution replay ensures that same generation again;
it does not create a second executor. A start failure is typed and leaves the
truthful `acquiring_media` snapshot available for recovery.

Within one household, at most one intent may own a resolved canonical source
while its status is `processing`, `requires_action`, or `succeeded`. The D1
partial unique index is the race boundary. Concurrent resolvers therefore
produce one live owner; each loser becomes terminal `redirected` to that
same-household owner and appends `intent_redirected` history. A redirected intent
has no executor, active action, or recipe. Its reads remain stable and every
mutation returns the safe canonical intent link with `intent_redirected`.

`failed` and `cancelled` rows do not reserve the canonical source. A new
idempotency key can create and resolve a fresh intent after either state. The
original key always replays its original intent. Cross-household matches never
redirect or reveal an identifier.

## Public lifecycle and versions

The public statuses are exactly:

- `processing`
- `requires_action`
- `succeeded`
- `failed`
- `cancelled`
- `redirected`

Processing stages are monotonic and exactly `resolving_source`,
`acquiring_media`, `analyzing_evidence`, `extracting_recipe`,
`grounding_recipe`, `preparing_review`, and `finalizing_recipe`.
`resolving_source` requires a pending source; every later stage requires a
resolved safe source and preserves the stage's original `startedAt`.
`analyzing_evidence` exposes independent `speech` and `visuals` progress. Video
completes both components in either order; carousel skips speech and completes
visuals. Extraction cannot start until both components are terminal.

Safe activity is `working` or `retrying`, with an optional `nextAttemptAt` only
when the executor has a truthful instant. Heartbeats, attempt counters, and
private checkpoints do not change the public version. Meaningful stage,
component, activity, action, recovery, or terminal changes increment it exactly
once and append exactly one history event.

Every executor command carries the exact execution generation and a stable
mutation identity plus canonical command digest. An exact replay preserves the
original version, timestamps, and history; reusing an identity with a changed
digest conflicts. Older generations and superseded milestones cannot regress
public state, and a terminal or redirected intent cannot be revived. Legacy
persisted Workflow histories may decode a missing generation as generation
zero, but every current starter call supplies its generation explicitly.

Intent and action versions are separate optimistic-concurrency domains. Each
future mutation accepts only its relevant explicit expected version plus an
idempotency key. At most one action is active. The action owns its complete safe
review, editable fields, answers, and action version; the intent exposes only
the active action identity, type, and link. Completed actions remain readable
and immutable.

Expected executor failures map exhaustively to stable, provider-neutral public
codes, messages, and the recovery choice `create_new_intent`,
`contact_support`, or `none`. Raw exceptions, provider names or codes, URLs,
R2 keys, transcripts, and evidence never enter public state, history, errors,
or traces. `failed` never resumes.

Cancellation is legal only from `processing` or `requires_action` and requires
the expected intent version plus a replay-stable mutation identity. D1 commits
the terminal snapshot and history before the application best-effort terminates
the Workflow instance. Termination failure cannot undo cancellation. Later
executor commands are terminal-fenced, and generation-positive Workflow runs
recheck the intent before constructing or executing acquisition/provider work.
Cancellation does not reject or otherwise mutate the private review ledger. A
later confirmation slice will insert one immutable household-owned recipe,
associate it with the intent, and succeed without shadowing review authority.

## History and execution boundaries

`recipe_import_intent_history` is the one append-only public history table. It
records meaningful user-visible facts, not current state. Its stable event
identity and cursor is `(intent_id, intent_version)`. Each event includes the
immutable before/after public status and stage, actor category, an optional
hashed actor identity, and optional stable mutation identity plus command digest.
Mutation identity is unique per intent when present. Heartbeats, raw failures,
provider details, evidence keys, attempts, generations, and transcripts are not
public history.

D1 triggers make every post-migration aggregate creation and meaningful public
version advance atomic with exactly one matching history event. Existing rows
receive one truthful `migration_snapshot`, not fabricated stages. Timeline
reads are a pure household-scoped projection of this table, ordered by intent
version. Wrong-household and unknown intents are indistinguishable. The
projection selects only the public event fields and never reads operational
events or checkpoint ledgers; it omits mutation provenance, actor hashes, raw
URLs, provider data, storage keys, transcripts, and evidence.

Generation-positive Workflow executions recheck the exact intent and generation
before their first acquisition/provider effect. A bounded internal recovery
capability can list old `processing` / `acquiring_media` owners in deterministic
order, recheck each fence, and idempotently ensure its exact Workflow instance.
This closes the claim-before-start crash window without adding a lease,
heartbeat, lifecycle version, or second orchestrator. The capability is
deliberately unscheduled and unmounted in this slice: there is no cron, queue,
route, or deployment wiring.

## API and deferred scope

`@meal-planner/recipe-import-api` owns only the shared Effect Schema, HttpApi,
OpenAPI metadata, and safe Problem Details contract. It declares the complete
approved `/v1` intent, action, timeline, cancellation, confirmation, and recipe
surface, but this foundation slice deliberately does not mount those handlers
in the production Worker. Legacy entry points continue through the same
aggregate owner until a coherent later vertical switch is complete.

Uploads, generic source extension hooks, similarity matching, recipe forks,
batch fields, frontend/TanStack Query work, action answers, confirmation,
public cancellation and timeline handlers, recipe-result handlers, recovery
scheduling, provider operations, and cloud deployment are deferred. Durable
intent/action/recipe metadata lives in D1; private evidence remains in
short-retention R2. A future batch resource may group independently addressable
intent IDs without changing the intent aggregate.

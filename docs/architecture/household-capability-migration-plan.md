# Household capability migration plan

## Status and decision

This plan is the source of truth for moving household-owned product state from
the shared D1 prototype into one canonical SQLite-backed `HouseholdObject` per
Better Auth organization.

The foundation tracer from PR #182, the household meal-plan slice from PR #183,
and Slice 0 hardening from PR #186 are merged. They prove private routing,
per-object Drizzle migrations, provenance, restart durability, replay receipts,
optimistic concurrency, physical cross-household isolation, and object-owned
authority services.

PR #184 and the former Recipe Bank-only first slice are **superseded**. They
split state changed by the existing confirmation command across separate
canonical stores. Do not merge, revive, or adapt that delivery lane. Reuse
only independently useful findings or tests after revalidating them against
this plan.

Slice 1 moves the complete import intake, lifecycle, review, and Recipe Bank
authority together. Production routes and writers switch only once, as one
cutover; the delivered state has no shared-D1 compatibility read or dual write.

## Architectural goal

Cloudflare primitives keep distinct responsibilities:

- Better Auth D1 owns global identity, accounts, sessions, organizations,
  memberships, invitations, and roles.
- One `HouseholdObject` per organization hosts that tenant's private SQLite
  database, canonical household product state, and serialized commands.
- Domain-driven, feature-first capability modules own their models, commands,
  queries, tables, repositories, and failures inside that database.
- Explicit household operations coordinate commands that legitimately span
  capabilities and commit them in one local transaction.
- Workflows own durable, multi-step orchestration and external waits, not
  household product truth.
- Queues transport work; a queue, retry count, or DLQ entry is not product
  state.
- R2 owns large media, transcript, manifest, and evidence bytes. Household
  SQLite stores compact, integrity-checked references and admitted outcomes.
- Child Durable Objects may own independent runtime coordination. They do not
  become competing authorities for household product state.

`HouseholdObject` is a tenant actor, private database, and consistency host. It
is **not** one giant DDD aggregate. Recipe import, review/publication, meal
planning, preferences, and shopping may remain separate aggregates and
modules while sharing one database and transaction boundary where required.

This repository is greenfield. Each cutover deletes the superseded path for
the moved state. Do not add compatibility reads, dual writes, backfills,
legacy adapters, shadow product projections, or preservation of experimental
D1 data or schemas.

## Non-negotiable invariants

### Cross-capability atomicity rule

> A delivery slice may not divide state changed by one existing atomic command
> across separate canonical authorities. When a command changes import
> lifecycle, review, Recipe Bank publication, history, or receipts atomically,
> all affected state moves in the same cutover unless an explicit product and
> API redesign first establishes an eventual-consistency boundary.

The current confirmation command atomically approves the review, clears the
active action, moves the import through finalization to success, publishes the
recipe identity, appends history, and records replay receipts. Therefore the
old review-first, admission-second, lifecycle-third split is invalid.

### Authority and routing

- Public requests never choose an organization, household object name, actor,
  authoritative time, generation, result version, timeline ordinal, or
  receipt.
- The API proves the Better Auth session and organization membership before
  routing. Active organization is UI state, not authorization proof.
- A single locator derives a versioned, privacy-safe object name from the
  admitted immutable organization ID before `getByName`; never route by slug,
  display name, URL parameter, or a raw organization ID embedded in the object
  name.
- The private household Worker decodes the internal command, derives the
  object route, and forwards it. The Durable Object decodes the structured
  clone again before domain code. TypeScript RPC types are not runtime proof.
- The object persists the immutable organization ID as provenance and rejects
  any mismatch before reading or mutating capability state.
- Application principal context must be propagated explicitly over service
  bindings. The API Worker proves the current Better Auth session and
  organization membership. The private Worker Schema-decodes that admitted
  principal, derives the route, and admits only a closed command purpose. The
  object verifies stored organization provenance and the actor category
  allowed for that command. The private Worker and object do not query Better
  Auth again. System commands enter only through trusted internal bindings and
  use a closed `SystemPurpose` mapped to allowed commands. Platform access
  context is not assumed to propagate.

### Transaction and command ownership

The `HouseholdObject` owns authoritative command time, aggregate versions,
timeline ordinals, mutation receipts, command digests, and result identities.
Callers may provide a mutation ID and an explicit expected version for replay
and optimistic concurrency; they do not provide the resulting authority facts.

The object runtime provides Effect Clock, identity generation, canonical
encoding, and digest capabilities. Household domain decisions, commands,
cross-capability operations, and repositories do not use ambient APIs to
generate authoritative facts: no direct `Date.now()`, `crypto.randomUUID()`,
or ad hoc hashing. Ordinary date parsing is not authority generation and may
use the platform date representation. Structural checks enforce these
boundaries, and tests provide deterministic service implementations.

Every mutation follows this shape:

```text
authenticate and authorize
-> perform required external I/O outside the object transaction
-> Schema-decode a closed external result
-> encode and send a closed internal command
-> decode again at the private Worker and Durable Object boundaries
-> read local SQLite state
-> make a pure domain decision
-> assign authority-owned time, versions, ordinals, and receipt content
-> commit all local changes in one short Drizzle transaction
-> return the committed result
-> dispatch any recorded follow-up work after commit
```

No D1, R2, `fetch`, Workflow, Queue, service-binding, provider, container, or
other network I/O may occur inside a `HouseholdObject` transaction. If a local
commit must trigger external work, record a compact outbox/dispatch intent in
the same transaction. An alarm or host adapter drains it idempotently after
commit. Queue and Workflow acknowledgements can be committed later as separate
commands.

Once the local transaction commits, later dispatch failure cannot represent
the command as uncommitted. Command replay returns the same committed domain
result. Outbox delivery state remains separate, privacy-safe operational or
processing state. A pending or exhausted dispatch does not roll back, replace,
or obscure the committed household result.

### Workflow instance identity

Each admitted import execution generation owns one deterministic,
privacy-safe Workflow instance ID. Its canonical input includes the intent ID,
execution generation, and a versioned workflow-purpose prefix; include the
opaque household key only when the selected ID scope requires it. The exact
encoding and digest belong to the Slice 0 contract and must not reveal a raw
organization ID.

The object records the Workflow instance ID with the admission and outbox
transaction. Dispatch retries use the same ID and reconcile an existing
instance rather than inventing a replacement. A new execution generation uses
a new deterministic ID.

### Canonical and noncanonical state

| Store or service | Authority | Permitted facts |
| --- | --- | --- |
| Household SQLite | Canonical household product authority | Imports, actions, reviews, recipes, plans, preferences, shopping, household receipts and lifecycle |
| Better Auth D1 | Canonical identity control plane | Users, sessions, organizations, membership, invitations, roles |
| R2 | Canonical large-byte store behind household references | Evidence and media bytes with checksums, generation, ownership, and retention metadata admitted by the household authority |
| Workflow and Queue | Operational execution and delivery | Attempts, waits, transport, retry and orchestration state; never public household truth |
| Global operational store | Noncanonical for household product state; authoritative only for named global controls | Opaque object key, workflow ID, safe failure class, provider cost, cleanup deadline, migration or recovery status, and a deletion-routing tombstone |
| Analytics Engine | Noncanonical telemetry | Privacy-safe usage, latency, outcomes, retry bands, and approximate cost |

A global operational store must not become another Recipe Bank, import
lifecycle, meal plan, shopping list, review log, or household directory with
product data. A genuinely global authority, such as strict provider budget
reservation, must be named and modelled separately rather than disguised as a
household projection.

## Domain and module topology

Use DDD-informed, feature-first vertical capability modules with ports and
adapters. Keep the host thin and place layers inside each capability rather
than creating repository-wide `domain/`, `application/`, and `persistence/`
folders.

```text
apps/api/src/features/households/
  household-object.ts                 thin DO handler and instance lifecycle
  household-domain-worker.ts          private admitted routing only
  household-object-locator.ts         versioned privacy-safe object routing
  household-object-runtime.ts         composes one instance-scoped runtime

  rpc/
    command-envelope.ts               actor/system provenance and mutation ID
    commands.ts                       closed internal command union
    results.ts                        closed result and failure union

  shared-kernel/
    actor.ts
    command-digest.ts
    household-identity.ts
    instant.ts
    mutation-id.ts

  capabilities/
    meal-planning/                    relocate the merged vertical internally
      model.ts
      commands.ts
      repository.ts
      schema.ts
      tests/

    recipe-import/
      model.ts                         intake, lifecycle, actions, terminality
      decide.ts                        pure transitions and invariants
      commands.ts
      queries.ts
      repository.ts
      schema.ts
      projection.ts                    public intent/action/timeline views
      tests/

    recipe-bank/
      model.ts                         review, corrections, tags, publication
      decide.ts
      commands.ts
      queries.ts
      repository.ts
      schema.ts
      projection.ts                    planning-safe recipe snapshots
      tests/

    evidence/                         later compact metadata and R2 references
    settlement/                       later checkpoints and recovery receipts
    batches/                          later household batch state and outbox

  operations/
    confirm-import-review.ts          one cross-capability SQLite transaction
    admit-import.ts
    cancel-import.ts
    create-plan-from-recipe-bank.ts
    delete-household.ts

apps/api/src/features/imports/orchestration/
  acquisition-workflow.ts             R2/provider/external orchestration
  recovery-workflow.ts
  batch-consumer.ts

apps/api/household-migrations/         generated checked-in SQLite migrations
packages/household-api/                public HTTP schemas and generated client
packages/recipe-import-api/            existing public import HTTP contract
```

The names are a target topology, not authority to preserve obsolete files.
Refine placement against actual imports during each slice. An internal RPC
package is justified only when a second real runtime consumer needs it;
otherwise keep internal commands app-local. Public HTTP contracts do not own
Drizzle tables, Better Auth, Cloudflare bindings, or internal command envelopes.

Cross-capability operations are the only place allowed to coordinate multiple
capability repositories in one transaction. Capabilities do not reach into one
another's internal files, and repositories do not hide business orchestration.
The shared kernel stays deliberately small.

## Internal contracts

The exact schemas are implemented test-first, but the boundary has this shape:

```ts
type HouseholdCommandContext = {
  readonly actor:
    | { readonly _tag: "Member"; readonly actorId: HouseholdActorId }
    | { readonly _tag: "System"; readonly purpose: SystemPurpose }
  readonly mutationId: MutationId
  readonly organizationId: BetterAuthOrganizationId
  readonly traceId: TraceId
}

type ConfirmImportReview = {
  readonly _tag: "ConfirmImportReview"
  readonly actionId: RecipeImportActionId
  readonly expectedActionVersion: ActionVersion
  readonly intentId: RecipeImportIntentId
}

type CommitExtraction = {
  readonly _tag: "CommitExtraction"
  readonly expectedGeneration: ImportGeneration
  readonly extraction: ClosedExtractionSnapshot
  readonly intentId: RecipeImportIntentId
  readonly evidence: readonly EvidenceReference[]
}
```

The API derives organization and member identity from Better Auth. Async
consumers carry the immutable organization ID plus durable IDs and admitted
system provenance, not mutable domain snapshots. External adapters decode
provider/R2/Workflow data before constructing a command; the private runtime
decodes the command again.

Expected failures remain closed, tagged, and Schema-backed:

- invalid input or internal protocol mismatch;
- unauthenticated or unauthorized principal before object access;
- provenance mismatch;
- aggregate not found or transition rejected;
- expected-version or generation conflict;
- replay collision for one mutation ID with different content;
- local persistence or migration unavailable;
- pre-commit inability to record required dispatch intent.

Post-commit dispatch pending or exhausted is a separate processing status, not
a failure of the committed command.

Public HTTP maps only its own stable Problem Details. Logs and operational
facts use opaque household correlations and closed reason categories; they do
not include organization IDs, actor IDs, URLs, evidence keys, provider payloads,
or command bodies.

## Durable Object and Drizzle lifecycle

Two independent lifecycle layers must remain explicit:

1. **Alchemy/Cloudflare class and namespace lifecycle.** This owns the stable
   `HouseholdObject` class, namespace, bindings, privacy-safe object ID
   derivation, and deployment changes. The locator is the only place that may
   derive a named object identity, so routing cannot drift across capabilities.
2. **Per-object Drizzle database lifecycle.** Checked-in generated migrations
   are applied to each private SQLite database under instance initialization
   gating before commands are admitted. Migrations are repeatable on restart,
   fail closed, and are tested across schema versions. They are not D1
   migrations and are not replaced by an Alchemy namespace update.

Use initialization gating only for runtime setup and migrations. Normal
commands rely on local SQLite transactions and do not wrap external work in a
global concurrency block.

## Child Durable Object decision rule

Do not create a child object because a domain noun exists. Decompose code
aggressively; decompose the Durable Object only when a separate coordination,
lifetime, throughput, placement, or consistency boundary is proven.

A child object is justified only when most of these are true:

1. It has an independent, durable coordination identity.
2. It has a materially different lifetime or retention policy.
3. Its traffic is sufficiently hot or high-frequency to threaten the household
   object's serialized workload.
4. It owns a long-lived connection, runtime session, or isolated executor.
5. Its state never needs an atomic transaction with canonical household state.
6. Eventual consistency with the household authority is an accepted product
   invariant.
7. Its failure, replay, and recovery semantics justify an RPC or saga boundary.
8. Independent placement, scaling, or security controls solve a measured need.

The existing `ImportMediaAcquisitionObject` remains a noncanonical per-import
execution and transport coordinator through the evidence cutover. It may own
container, session, process, cleanup, and temporary artifact-access concerns.
It does not own public import lifecycle, household evidence metadata, Recipe
Bank state, household receipts, or recovery authority. Its identity and every
command are fenced by import ID and execution generation. Reassess and delete
it if those independent runtime responsibilities disappear.

A retail session object, realtime session object, or large batch executor may
eventually qualify. A `RecipeObject`, `ReviewObject`, `MealPlanObject`, or
`ShoppingListObject` does not qualify now. The parent object remains canonical
even when a child coordinates execution. Avoid deep service chains: every
extra binding is another invocation and another principal-propagation boundary.

## Cloudflare adoption roadmap

| Timing | Capability | Decision and boundary |
| --- | --- | --- |
| Now | Existing R2 lifecycle | Keep the seven-day `imports/` deletion rule. Treat asynchronous lifecycle deletion as defense-in-depth, not a correctness or authorization clock. |
| Now | Workflow, Queue, R2, private service binding | Keep orchestration, delivery, bytes, and private routing outside household transactions. Pass and re-prove the application principal across the binding. |
| Next | SQLite DO PITR and recovery runbook | Add operator tooling for per-object bookmarks and 30-day restore, destructive-command/migration procedures, authorization, audit, and a production drill. PITR is per-object recovery, not fleet backup or inventory, and is unavailable locally. |
| Next | Durable Object alarms | Multiplex a local schedule/outbox table onto the single alarm. Handlers are idempotent and limited to local wake-up, pruning, deletion, or dispatch retry; provider work remains in Workflows. |
| Now | R2 Queue event notifications | Relevant create/delete/lifecycle-deletion events pass through a reconciliation Queue with strict key, integrity, household, and generation validation. Notifications are delivery evidence, not household truth. |
| Next | Scheduled maintenance | On Alchemy beta.72, use an Alchemy-managed cron Worker that starts a bound Workflow. Direct Workflow schedules exist in Cloudflare but are not exposed by the pinned Alchemy resource API; revisit after support lands. |
| Next | Rate Limiting binding | Protect expensive admission/provider routes with privacy-safe household/actor/capability keys. Location-local permissive counters are abuse and load protection, never authorization, quota, budget, billing, or idempotency. |
| Next | Secrets Store evaluation | Prefer reusable account-level provider/system credentials if the open-beta, async binding and local-development constraints pass an exact-version spike. Do not store household product data or retail grants there. |
| Next | Analytics Engine | Emit privacy-safe high-cardinality operational telemetry. Its fixed three-month retention makes it unsuitable for durable audit, receipts, billing, or long-term product reporting. |
| Later | Turnstile | Add server-verified, single-use protection only when exposed signup or expensive import abuse warrants it. |
| Later | Hibernatable WebSockets | Adopt only for genuine collaborative planning, shopping, or high-frequency progress; current polling does not justify it. |
| Later | Vectorize | Use only as a rebuildable derived semantic index pointing to canonical household recipe IDs. Never make it recipe authority. |
| Later | `@cloudflare/actors` | Defer the beta framework. Revisit only if its scheduling or migration helpers remove material code without obscuring Effect scope, Drizzle ownership, or failure semantics. |

Household SQLite capacity remains bounded by Cloudflare's per-object limits.
Keep large values in R2, enforce conservative row and command payload limits,
and treat the soft per-object throughput ceiling as a reason to measure hot
households—not as a reason to pre-shard ordinary domain nouns.

## Household deletion lifecycle

Organization deletion stays disabled until this idempotent lifecycle exists:

1. An authorized deletion command marks the household `Closing`, records the
   authority-owned deadline and receipt, and fences new commands.
2. Existing Workflow and Queue work is cancelled or allowed to settle under an
   explicit policy; late callbacks are rejected by lifecycle and generation.
3. A deletion Workflow removes household-owned R2 prefixes and other external
   resources outside the object transaction.
4. Before local storage is cleared, a privacy-safe global routing tombstone is
   committed for the opaque object key. The household locator checks this
   deletion-control authority before every human, system, support, Workflow,
   Queue, alarm, or recovery route resolves the object. A tombstoned object
   cannot be lazily initialized.
5. The object verifies local preconditions, records completion, and calls
   SQLite `deleteAll` only at the final destructive step.
6. The global operational deletion receipt records completion status and
   retention deadline without copying product state. PITR restore while the
   tombstone is active is forbidden unless an authorized recovery process
   explicitly reverses the deletion.
7. Better Auth organization deletion completes only after the household
   deletion policy reaches its terminal outcome.

Retries at every step return the existing receipt. A failed cleanup remains
recoverable and visible to operators without reopening household writes.

## Future global-query policy

Normal product queries always start from an authenticated organization and
route to one household. There is no fleet-wide SQL query across private object
databases, and the architecture will not create a global product read model in
advance.

When a real global use case appears, classify it first:

- Support reads route to a known household after verified authorization.
- Analytics use privacy-safe events and are noncanonical.
- Reconciliation and deletion may use a minimal operational index of opaque
  object/workflow IDs and safe statuses.
- Strict cross-household budget reservation may own a separate global
  operational aggregate.
- Fleet-wide recipe, import, plan, or shopping queries require an explicit
  architecture and privacy decision. They do not justify silently duplicating
  canonical household rows.

Any product projection, dual store, or compatibility mechanism still requires
the user's explicit approval under the greenfield policy.

## Revised delivery sequence

### Completed: foundation tracer and meal planning

PRs #182 and #183 established one per-organization SQLite DO and moved meal
plan state, decisions, receipts, and restart/concurrency proof into it. Slice 1
deletes the temporary shared-D1 recipe source and makes planning consume the
local Recipe Bank directly.

### Completed: Slice 0 foundation hardening

The foundation is hardened without moving another product authority:

- central privacy-safe, versioned object locator;
- auth and membership proof before route derivation;
- closed internal RPC envelope and double decode;
- explicit member/system provenance and privacy-safe failures;
- object-owned Clock, identity, canonical encoding, versions, ordinals,
  digests, and receipts with deterministic test implementations;
- thin object host plus feature-first runtime composition;
- clear Alchemy class lifecycle versus per-object Drizzle migrations;
- local outbox with host-driven post-commit Workflow dispatch and no external
  I/O in transactions;
- deterministic Workflow instance identity per import execution generation,
  persisted atomically with its admission and outbox intent;
- explicit committed-result semantics independent of later dispatch status;
- documented noncanonical role and generation fence for the existing
  `ImportMediaAcquisitionObject`;
- first-activation, restart, repeated-migration, migration-failure, provenance,
  authorization, replay, and cross-object isolation proof;
- structural checks for raw organization IDs in object names and forbidden
  external calls inside transaction modules;
- structural checks that reject ambient generation of authoritative time,
  identity, or digests in household domain and persistence modules.

This slice deletes obsolete foundation shapes rather than preserving adapters.
It does not change import authority, deploy to Cloudflare, or call providers.

### Completed: Slice 1 import, review, and Recipe Bank authority cutover

Move these together and switch all public writers/readers in one delivery:

- admission, import identity, and idempotency ledger;
- source ownership, canonical-source deduplication, winner races, and redirects;
- public lifecycle, stage, version, generation fences, timeline, and projections;
- active review actions and available-action rules;
- current admitted extraction/draft snapshot required to review and publish;
- review state, answers, corrections, tags, transitions, and mutation receipts;
- approval and canonical Recipe Bank publication;
- cancellation, terminal state, recipe identity, history, and receipts.

The `confirm-import-review` operation commits review approval, publication,
action completion, finalizing/succeeded lifecycle, version increments, timeline
entries, and replay receipts in one local SQLite transaction. Admission commits
the import, its idempotency record, deterministic generation-specific Workflow
ID, and outbox intent before Workflow start. A start retry reconciles that same
Workflow ID. Source-dedup, cancel-versus-confirm, and replay races resolve
inside the same household authority.

Delete the superseded D1 repositories, composition, triggers, tables, and
planning projection for this moved state in the same PR. Meal planning queries
the local Recipe Bank capability directly; remove the D1 recipe-source gateway
and its transfer-size workaround. Do not preserve prototype rows or reinstate
an arbitrary product-level recipe-count ceiling such as the old 128-item limit;
use pagination, bounded pages, and byte limits at real transport/storage seams.

### Completed: Slice 2 evidence and extraction metadata

Move compact transcription, visual, carousel, extraction, manifest, current
result, and generation metadata plus integrity-checked R2 references. Large
bytes remain in R2. Workflows perform provider/R2 I/O, decode a closed result,
then ask the object to commit it. Add R2 lifecycle, event-notification,
retention, missing-object, deletion, restart, and stale-generation proof.

The exact table boundary is refined from live dependencies after Slice 1; no
state needed by the confirmation transaction may be left behind.

The production acquisition Workflow now commits closed acquisition and stage
results only through the private household authority. Household SQLite owns
compact current-result metadata, integrity-checked generation-scoped R2
references, availability observations, and replay receipts. Large bytes remain
in R2. Missing objects, lifecycle deletion, late events, restart, exact retry,
conflicting replay, stale generations, and physical cross-household isolation
have provider-free runtime proof. Shared D1 retains the bounded operational
event route plus the existing Slice 3 settlement and terminal-recovery
boundary; neither can author household evidence. This slice does not redesign
or move the Slice 3 capability.

R2 notification reconciliation uses one bounded noncanonical operational
index: after authenticated admission, the API enqueues an immutable
import-to-organization route before Workflow start, and the private consumer
atomically inserts it into a private D1 table keyed by import ID. Concurrent
registration is serialized by that uniqueness boundary: the first route is
immutable and every conflicting organization fails closed. The route can only
reconstruct the enumerated lifecycle system admission, and the consumer
re-proves import, authoritative source kind, generation, object key, kind,
hash, and stored metadata before an idempotent household availability
observation. Household state fences observations by event time and a fixed
same-time action precedence, so delayed deletion cannot replace newer
availability. The route is not a household registry, product read model,
object-name source, or Slice 3 recovery ledger.

### Slice 3: settlement and recovery

Move household-owned terminal checkpoints, recovery attempts, generation
fences, replay guards, and receipts. Workflow owns waits, retries, provider
calls, and saga execution; the object decides and records household outcomes.
Retain only proven cross-household budget or safe operational facts globally.
If the global provider budget remains required, move its model, repository,
settlement policy, and operational schema from `features/pilots` into a
production-owned `provider-accounting` capability during this slice. Otherwise
delete the pilot ledger and its composition. Production import code must not
depend on an experiments or pilots namespace.

### Slice 4: batches

Move canonical batch/item membership, status, replay, completion, failure, and
outbox state. Queue messages carry immutable organization, batch, and item IDs;
Queue/DLQ remains transport evidence. Workflow coordinates multi-step items.

### Slice 5: shared household D1 retirement

After all canonical household capabilities have moved, delete the shared domain
D1 binding, remaining household tables, repositories, tests, and configuration.
Retain Better Auth D1. Retain a separate global operational store only for
explicitly approved global facts. Add structural enforcement preventing
household product state from returning to tenant-filtered global persistence.

Preferences, shopping lists, Tesco draft/approval state, and later household
verticals are built directly as local capability modules. They do not pass
through shared D1 first.

## Test-first proof plan

Every slice uses red-green-refactor:

1. **Red:** add a provider-free failing test for the production boundary or
   invariant before changing implementation.
2. **Green:** prove the smallest production path with real Effect layers,
   Drizzle SQLite, Workerd/Miniflare bindings, and closed schemas.
3. **Refactor:** simplify boundaries, delete superseded code, and rerun focused
   plus repository-wide gates.

Foundation proof retains and extends current tests for provenance, physical
object isolation, restart durability, migration initialization, replay,
collision, stale-version serialization, terminal transitions, and payload
limits.

The complete import cutover adds at minimum:

- one real SQLite rollback test covering the entire confirmation transaction;
- admission plus idempotency atomicity and Workflow-start failure recovery;
- deterministic Workflow identity reuse across dispatch retries and a distinct
  identity for each execution generation;
- concurrent local source winner/dedup/redirect races;
- cancel-versus-confirm and duplicate-confirm races;
- answer/correction optimistic concurrency and mutation collision;
- restart/replay after every public transition and before/after dispatch;
- forged cross-organization access rejected before another object is resolved;
- private Worker and object double-decode rejection for malformed clones;
- no D1, R2, service-binding, Workflow, Queue, or provider call while a local
  transaction is active;
- outbox alarm/delivery replay without duplicate product mutation;
- post-commit dispatch failure preserves and replays the committed domain
  result while processing status changes independently;
- planning reads only the local approved Recipe Bank;
- Recipe Bank and planning pagination work beyond 128 approved recipes without
  an arbitrary household capacity failure;
- public projections remain privacy-safe and stable;
- structural guards reject production imports of removed D1 import/review/
  Recipe Bank repositories after cutover.

Evidence, settlement, and batch slices add real Workerd/Miniflare Workflow,
Queue, R2, alarm, restart, stale-generation, retry, DLQ, and deletion proof
appropriate to their boundaries. Provider tests remain fakes or installed
provider-free seams unless a live call is separately approved.

Deletion proof includes a late callback after `deleteAll`, centralized
tombstone enforcement before object resolution, and rejection of PITR restore
while the tombstone remains active.

## Acceptance gates

Every delivery slice must finish with all of these:

1. The implementation is based on freshly fetched exact `origin/main` in an
   isolated worktree.
2. One canonical writer exists for every moved fact; no atomic command spans
   canonical authorities.
3. Superseded code, routes, repositories, tables, triggers, and tests for moved
   state are deleted in the same PR.
4. Public and internal Schema contracts, tagged failures, privacy rules,
   transaction boundaries, and object-owned authority facts are proven.
5. Focused RGR tests, real Workerd/Miniflare SQLite restart/replay/
   authorization tests, and structural guards pass.
6. Root `pnpm check`, `pnpm test`, `pnpm lint`, `pnpm format:check`, required
   builds, and `git diff --check` pass.
7. Generated Drizzle migrations are checked in, byte-stable on regeneration,
   and report no unexpected schema diff.
8. The PR head is immutable, CI is green, and an independent exact-head review
   reports no actionable findings.
9. The orchestrator verifies spec compliance, merges only the reviewed head,
   then cleans the task, branch, and worktree.
10. No live provider call, Cloudflare deployment, D1 mutation, destructive R2
    action, or other external change occurs without separate approval.
11. Every authority cutover updates `household-domain.md`,
    `recipe-import-intent.md`, the infrastructure map, and affected public API
    documentation in the same PR so current-state docs match production code.

## Alternatives considered

### Keep shared tenant-scoped D1

This is simpler for fleet SQL, support queries, reporting, and one-shot
migrations. It retains pervasive tenant filters and does not provide the chosen
per-household coordination and physical storage boundary. Rejected for
canonical household product state; Better Auth and approved global operational
facts remain valid D1 uses.

### Split review/Recipe Bank from import lifecycle using eventual consistency

This would let smaller slices commit independently, but approval could no
longer synchronously return a succeeded import. It would introduce intermediate
states, saga recovery, and two authorities before lifecycle moved. Rejected
because it changes product/API semantics and violates the current atomic
confirmation contract.

### Create one Durable Object per domain noun

Recipe, review, plan, and shopping objects would turn local transactions into
distributed sagas and add binding hops, failure modes, and principal boundaries
without a measured scale or lifetime need. Rejected. Apply the child-object
criteria only when evidence establishes an independent coordination boundary.

### Hybrid household DO plus global product read model

This adds projections, lag, replay, privacy deletion duplication, and a second
product representation. Rejected under the greenfield policy. Add only a
minimal noncanonical operational index for an approved concrete use case.

## Decision log

| Decision | Status | Consequence |
| --- | --- | --- |
| One canonical `HouseholdObject` per Better Auth organization | Accepted | Physical tenant isolation and one household-local consistency host |
| DDD-informed, feature-first vertical capability modules | Accepted | Decompose code without pre-sharding storage |
| Cross-capability operations own required multi-module transactions | Accepted | Atomic commands stay local and explicit |
| Complete import/review/Recipe Bank cutover replaces old Slices 1-3 | Accepted | PR #184 and Recipe Bank-only delivery are superseded |
| Object authority owns time, versions, ordinals, identities, and receipts | Accepted | Callers cannot manufacture ordering or results |
| Privacy-safe, authority-derived routing | Accepted | One locator derives object names only after authorization |
| External I/O forbidden inside local transactions | Accepted | Outbox/alarm/Workflow handles post-commit effects |
| Committed result independent of dispatch status | Accepted | Delivery failure cannot rewrite an already-committed domain outcome |
| One deterministic Workflow ID per import execution generation | Accepted | Dispatch retries reconcile the same instance and new generations cannot reuse stale execution |
| Existing acquisition object retained as a noncanonical execution coordinator | Accepted | Container and temporary transport concerns remain outside household product authority and are generation-fenced |
| Alchemy class lifecycle separate from per-object Drizzle migrations | Accepted | Deployment changes cannot substitute for SQLite schema evolution |
| Global routing tombstone fences deleted households | Accepted | The locator prevents late callbacks or recovery from recreating cleared object storage |
| No compatibility, dual write, backfill, or old D1 preservation | Accepted | Superseded greenfield paths are deleted at each cutover |
| Global operational facts remain noncanonical for household product state | Accepted | Future global product queries require a new explicit decision |
| More child Durable Objects only after measured boundary criteria | Accepted | Domain nouns remain modules in one household database by default |
| Direct scheduled Workflows | Deferred | Pinned Alchemy beta.72 lacks schedule configuration; use cron Worker to start Workflow |

## Immediate handoff

The next authority delivery is **Slice 3: settlement and recovery**. It must
start from the merged Slice 2 cutover and must not move batch or final shared-D1
retirement work from later slices into its scope.

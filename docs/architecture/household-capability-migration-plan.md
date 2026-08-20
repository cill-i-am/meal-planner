# Household capability migration plan

## Goal

Move household-owned product state from the shared D1 prototype to the
canonical per-organization `HouseholdObject`, one coherent capability at a
time. Cloudflare primitives keep distinct responsibilities:

- Better Auth D1 owns global identity, organizations, memberships, and
  sessions.
- `HouseholdObject` Drizzle SQLite owns canonical household product state and
  serialized household commands.
- Workflows own durable multi-step orchestration, not product truth.
- Queues deliver work; queue state is not household product state.
- R2 owns large media, transcripts, manifests, and evidence payloads.
- Child Durable Objects may coordinate one import or runtime, but the parent
  household object remains the canonical household authority.

This repository is greenfield. Each slice replaces its superseded shared-D1
path outright. Do not add dual writes, read-through compatibility, backfills,
legacy adapters, staged migrations, or portability machinery without explicit
user approval.

## Delivery order

| Order | Capability | Destination | Status |
| --- | --- | --- | --- |
| 1 | Recipe review and approved Recipe Bank | Household Object + R2 references | Ready for delivery |
| 2 | Import admission, identity, and source deduplication | Household Object + Workflow start | Planned |
| 3 | Public import lifecycle and timeline | Household Object + Workflow commands | Planned |
| 4 | Evidence and extraction metadata | Household Object + R2 | Planned |
| 5 | Import settlement and recovery | Household Object + Workflow saga | Planned |
| 6 | Batch import state | Household Object + Queue/Workflow | Planned |
| 7 | Shared household D1 retirement | Remove household-domain D1 persistence | Planned |

Preferences, shopping lists, and Tesco draft or approval state are future
capabilities. Build them directly on the household foundation rather than
introducing them into shared D1 first.

## Slice 1: household Recipe Bank

### Outcome

An authenticated household reviews, corrects, tags, approves, rejects, and
queries its recipes through one canonical `HouseholdObject` SQLite aggregate.
Meal-plan generation reads approved recipes from the same household object.

Review state and approved-recipe publication move together because approval is
one atomic domain transition. They must not be split across separate stores or
delivery slices.

### Authority

The household object owns:

- the review version and state;
- reviewer corrections and planning tags;
- approve, reject, and return-to-review transitions;
- mutation receipts, optimistic concurrency, replay, and collision detection;
- the canonical approved household recipe;
- attribution and privacy-safe public projections.

The current extraction remains a read-only import input for this slice. Opening
a review admits a schema-decoded extraction snapshot into the household object.
After admission, review commands do not write back to shared D1. Large source
evidence remains in R2 and is referenced rather than copied into SQLite.

### Required replacement

Delete the superseded shared-D1 review and Recipe Bank implementation in the
same PR, including its repositories, composition paths, and tables:

- `recipe_reviews`;
- `recipe_review_mutations`;
- `recipe_review_corrections`;
- `recipe_review_transitions`;
- the approved-recipe projection used by meal planning.

Reset the greenfield D1 schema as needed. Do not retain a compatibility read,
shadow projection, or dual write.

### First vertical tracer

Exercise one provider-free path through the production boundaries:

1. Website request reaches the private API Worker.
2. Better Auth validates the session and active organization membership.
3. The API reads and decodes one current extraction snapshot.
4. The private household service binding routes to the named
   `HouseholdObject`.
5. The household object opens a review, applies one correction and tag, then
   approves it atomically into the Recipe Bank.
6. Meal-plan creation reads that approved recipe directly from the same object.
7. A runtime restart preserves the review, recipe, receipts, and resulting meal
   plan input.

### Acceptance criteria

- Public commands accept no organization, household, actor, timestamp, or
  authority-owned snapshot fields.
- Better Auth membership is proven before household routing.
- Cross-organization reads and mutations fail before reaching another
  household object.
- Opening the same review request replays; reusing its identifier for a changed
  extraction collides safely.
- Corrections and transitions enforce optimistic review versions.
- Approval and Recipe Bank publication occur in one SQLite transaction.
- Only approved recipes are visible to planning; rejected or in-review recipes
  are not.
- Identical transition retries return the recorded result; changed commands
  with the same mutation identifier conflict.
- Public responses do not expose Better Auth user identifiers or private
  evidence locations.
- Restart tests prove durable state and receipts.
- Meal-plan generation no longer queries the shared D1 approved-recipe
  projection.
- Structural proof rejects production references to the deleted shared-D1
  review and Recipe Bank paths.
- Drizzle owns all database access and checked-in migration generation.

### Boundaries and non-goals

- Do not move import admission, lifecycle, provider settlement, batch state, or
  evidence payloads in this slice.
- Do not add a rich review frontend unless a minimal tracer is necessary to
  prove an existing public contract.
- Do not deploy to Cloudflare or call a live provider.
- Do not preserve experimental D1 data or schemas.

### Risk and proof

This is a Tier B internal slice because it changes canonical durable authority,
review integrity, replay semantics, and a planning input boundary. The worker
must use test-first delivery, provider-free Workerd/Miniflare and real SQLite
proof, full repository gates, simplification, and one independent exact-head
review before merge.

## Slice 2: import admission and identity

Move import request replay, import identity, canonical-source ownership,
deduplication, and redirects into the household object. Commit admission before
starting a deterministic Workflow so a start failure remains recoverable.
Delete the old D1 admission and source-deduplication path in the same slice.

## Slice 3: import lifecycle and timeline

Move the household-visible import stage, status, version, generation fences,
cancellation, available actions, history, and command receipts into the
household object. Workflows report typed transitions to the object; they do not
own public lifecycle truth.

## Slice 4: evidence and extraction metadata

Move compact transcription, visual, carousel, and extraction outcomes and
their R2 references into the household object. Keep large bytes in R2. Keep the
per-import acquisition object as a noncanonical coordinator. Delete the
corresponding shared-D1 evidence and extraction records.

## Slice 5: settlement and recovery

Move import-specific terminal checkpoints, recovery attempts, replay guards,
and receipts into the household object. Use a Workflow saga for idempotent
provider settlement followed by household outcome commitment. Retain a global
operational D1 only for a genuinely cross-household provider budget; otherwise
delete the experimental pilot ledgers.

## Slice 6: batch imports

Move batch membership, item status, replay, completion, and household-visible
failure into the household object. Queues remain delivery transport and
Workflows coordinate items. A queue DLQ is operational evidence, not canonical
household state.

## Slice 7: retire shared household D1 persistence

Remove the remaining household-domain tables, repositories, and binding from
the shared D1. Keep Better Auth D1 and only any proven global operational SQL
store. Add structural guards preventing household product state from drifting
back into globally tenant-filtered persistence.

## Gate for every slice

Every slice must finish with:

1. one canonical writer for the moved capability;
2. the superseded path deleted in the same PR;
3. provider-free real-boundary and restart/replay proof;
4. cross-household authorization and privacy proof;
5. full repository checks and builds;
6. a clean immutable PR head with green CI;
7. one independent exact-head review;
8. orchestrator merge and task/worktree cleanup;
9. no live provider call or Cloudflare deployment unless separately approved.

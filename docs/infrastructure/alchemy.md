# Meal Planner Alchemy operations

The repository owns one Alchemy v2 stack named `MealPlanner`. Its first stable
resource identity is the `MealPlannerApi` Cloudflare Worker. Recipe imports add
the `MealPlannerDatabase` D1 resource. Changing any of these logical IDs is a
resource-identity decision and must not be treated as a cosmetic rename.

The pinned infrastructure toolchain is Alchemy `2.0.0-beta.72`, Effect and
`@effect/platform-node` `4.0.0-rc.109`, Node `>=22.18.0`, and pnpm `11.7.0`.
CI runs Node `22.19.0`.

Version-sensitive APIs were checked against the installed package and the
official [`v2.0.0-beta.72` source tag](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.72).

## Stages, profiles, and accounts

Stages own isolated stack resources. Profiles select credentials; a profile is
not an environment and its name does not prove which account is active.

- Local defaults are Alchemy's `dev_$USER` stage and the `$ALCHEMY_PROFILE`
  environment variable, which falls back to the profile named `default`. The
  local plan wrapper preserves those defaults when its flags are omitted.
- Future preview automation uses `pr-<number>` and must pass both `--stage` and
  `--profile` explicitly.
- Production uses explicit `prod`, an explicit production profile, and a fresh
  operator approval.
- CI and every future approved cloud operation must pass an explicit stage and
  profile, then independently verify the Cloudflare account resolved by that
  profile before proceeding.

Never infer authority for one stage, profile, account, or command from approval
for another.

## One-time Cloudflare state bootstrap

`Cloudflare.state()` uses Alchemy's account-wide Cloudflare state Worker and
supporting secrets. On first use, plan or deploy can prompt to create or upgrade
that infrastructure and can refresh local state-store credentials. That is a
Cloudflare/account/authentication mutation, even when the intended command is
only a plan.

The pinned Alchemy `dev` command internally enables automatic approval for
state-store updates. Meal Planner therefore exposes no `alchemy:dev` wrapper;
do not invoke it directly. It remains a separately prohibited mutating command.

Before the first real command, an operator must:

1. name the Cloudflare account and profile;
2. independently verify the account selected by the profile;
3. obtain explicit approval for the state bootstrap or upgrade;
4. follow the command printed by the pinned Alchemy CLI (v2.0.0-beta.72 uses
   `pnpm alchemy cloudflare bootstrap --profile <profile>`); and
5. record the created shared state infrastructure and its owner.

Do not use `--yes`. Do not run plan, deploy, or destroy merely to discover
whether bootstrap is required.

Profiles and state credentials live outside the repository under Alchemy's user
configuration. `.alchemy/`, `.wrangler/`, `.dev.vars`, `.dev.vars.*`, and
`.env*` are ignored, except that `.env.example` is intentionally trackable and
must contain placeholders only. Never commit tokens, credentials, account
details, raw provider payloads, or generated state material.

## Operator commands

These examples describe the repository interface; they are not standing
authorization to execute a cloud command.

```sh
# Local defaults are available only after bootstrap/account safety is proven.
pnpm run alchemy:plan

# Future approved operations name their complete target.
pnpm run alchemy:plan -- --stage dev_cillian --profile sandbox
pnpm run alchemy:deploy -- --stage dev_cillian --profile sandbox
pnpm run alchemy:destroy -- --stage dev_cillian --profile sandbox
```

Deploy and destroy reject missing stage/profile flags. Every wrapper rejects
`--yes`. Destroy also refuses the exact `prod` stage.

Immediately before an approved operation, print and confirm the stack
(`MealPlanner`), stage, profile, independently verified account, intended
mutation, and cleanup boundary.

## Outputs and health verification

The stack returns the safe resource inventory `apiWorkerName`, `databaseName`,
`authDatabaseName`, `evidenceBucketName`, `evidenceRetentionSeconds`,
`evidenceEventQueueName`, `evidenceEventWorkerName`,
`importProviderGatewayId`, `websiteWorkerName`, and `websiteUrl`, plus the
optional `apiUrl`. The household domain and evidence-event Workers are private
and deliberately have no public URL. Alchemy types Worker and Website URLs as
`string | undefined`: a resource can exist without a generated workers.dev
URL. Operator tooling must not invent a URL or cast it to a required string.
When `apiUrl` is present, `GET <apiUrl>/health` returns:

```json
{ "ok": true }
```

When it is absent, use `apiWorkerName` to locate the Worker and inspect its
configured routes/domains before testing an endpoint.

## Recipe import storage and caller authentication

`HouseholdObject` Durable SQLite is the canonical authority for import intake,
public lifecycle and timeline, source ownership, review, publication, Recipe
Bank, receipts, and meal planning. Its generated Drizzle migrations live under
`apps/api/household-migrations` and are applied inside each object by the
Alchemy Durable Object Drizzle runtime.

`MealPlannerDatabase` remains a shared operational D1 for the settlement and
terminal-recovery facts scheduled for Slice 3. Its generated migration is
under `apps/api/migrations`; the stable tracking table is `d1_migrations`.
Run `pnpm --filter @meal-planner/api db:generate` or
`pnpm --dir apps/api db:generate`, then review the generated timestamped
`migration.sql` and `snapshot.json` together. Regeneration without a schema
change must create no new migration.

The D1 baseline contains the remaining execution, settlement, and recovery
records. Production evidence stages do not write their household metadata to
D1. The schema deliberately omits
the former public intent, idempotency, timeline, review, Recipe Bank, batch, and
moved receipt tables. Those prototype tables are discarded rather than copied
or backfilled. Structural tests reject both their SQL names and their removed
production repository imports.

`MealPlannerAuthDatabase` is a separate D1 database for Better Auth identity,
cookie sessions, organizations, invitations, and membership. The runtime uses
Better Auth `1.7.0-rc.6` through the public Drizzle relations-v2 adapter. The
actual auth configuration generates `auth.database-schema.ts`; Drizzle Kit owns
the checked-in SQLite migration under `apps/api/auth-migrations`. Alchemy only
provisions and binds the database and applies that migration. It does not run
Better Auth or Alchemy automatic auth migrations.

Household routes authenticate with the same-origin Better Auth cookie. Effect
middleware resolves the session, requires an active organization, and verifies
membership through Better Auth's public API before constructing the typed
household principal. The active organization value alone is not authorization.
`MEAL_PLANNER_IMPORT_API_TOKEN`, `MEAL_PLANNER_IMPORT_ACTOR_ID`, and
`MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID` remain the distinct designated system
principal for the provider terminal-settlement route only. Secrets are
read through `Config.redacted`; they must never be logged, returned, or
committed.

The public TanStack Website Worker forwards `/api/auth/*` and `/v1/*` to the
private API Worker through a Cloudflare service binding. It forwards the
original request and response so `Cookie` and `Set-Cookie` remain same-origin.
The browser uses the generated Effect HttpApi client directly and never
receives a bearer token, actor ID, or household scope.

The API Worker privately binds `HouseholdDomainWorker`, which owns the
`HouseholdObject` Durable Object namespace. After membership authorization, the
domain Worker uses the central locator to derive
`household:v1:<sha256(canonical-v1-organization-payload)>` and lazily ensures
the object's `household_meta` row. The raw organization ID never appears in the
object name. Durable SQLite persistence uses Drizzle and the checked-in
`apps/api/household-migrations`; stored organization provenance is asserted
before every operation. Neither the private Worker nor the object imports
Better Auth. The Alchemy class host owns the stable namespace lifecycle, while
the per-object Drizzle migration owns schema evolution. No lookup mapper,
shared read model, dual write, or public household Worker route is added.

The household object persists submitted-source ownership, public import state,
idempotency, review, recipes, compact evidence metadata and R2 references, and
dispatch receipts. D1 persists only the remaining operational settlement and
recovery facts. Neither database
persists credentials, raw provider payloads, or media. TikTok requests are
limited to the bounded source-resolution and acquisition Workflow.

`ImportMediaAcquisitionObject` is addressed by the globally random `importId`
for per-import media/container coordination and private artifact transport.
Artifact commands validate an ID containing that import ID and acquisition
execution generation. It does not use Durable Object storage: canonical
lifecycle and domain state stay in the household object, remaining operational
execution facts stay in D1, and short-lived private artifacts stay in R2.
The object is noncanonical and is neither a household partition, import
lifecycle authority, recovery authority, nor household authorization boundary.

## Import execution topology

`ImportEvidenceBucket` deletes private objects under `imports/` after seven
days. The lifecycle policy is the deployable deletion boundary; household
imports, idempotency records, reviews, timelines, recipes, and meal plans are
outside the bucket and are not retention targets.

R2 object-create and object-delete notifications for the bounded evidence
prefix feed `ImportEvidenceEventQueue` and its private consumer Worker. The
authenticated API first places an immutable import-to-organization route on
that Queue before it starts the Workflow. The consumer stores the route in a
private D1 table through an atomic insert-and-read batch keyed by import ID,
Schema-decodes R2 events, resolves only that admitted route, validates the
authoritative source shape, generation-scoped key, and integrity metadata, then
records a household-local availability observation through the private service
binding. Concurrent conflicting routes fail closed. Notifications are
transport evidence: missing, duplicate, stale, or late events cannot rewrite
the committed R2 reference or current result. The household compares event
time plus fixed same-time action precedence before applying availability.
Queue, D1, service-binding, and R2 I/O remain outside every `HouseholdObject`
transaction, and raw organization identifiers are neither logged nor returned.

Public admission commits a compact household outbox intent before the API host
starts the deterministic generation-specific Workflow. Host retries reconcile
the same Workflow identity and record their delivery result through a closed
system command. No Queue or batch writer participates in Slice 1. The existing
provider terminal-settlement route remains a private, explicitly authorized
execution seam for later-slice evidence and recovery behavior; it cannot write
canonical public import, review, or Recipe Bank state directly.

## Cleanup and test boundaries

An approved destroy targets only the named `MealPlanner` stage. The shared state
store is not stage-owned cleanup and must not be deleted with a preview or
developer stack. Report failed cleanup and retained resources exactly; do not
fall back to state clearing, adoption, broad deletion, or unsafe nuke.

The repository's non-mutating Vitest coverage deliberately has two layers:
structural checks retain static configuration, privacy, policy, and deployment
identity guards that cannot be supplied by a local runtime; semantic tests
exercise import contracts such as immutable generation-scoped evidence keys and
the bounded retry behavior through their public helpers and local runtime.
Neither layer proves Cloudflare provider lifecycle, Worker bundling, remote
state access, account selection, or a deployed URL. Real Alchemy stack and
provider tests create cloud resources and require separate, action-time
approval plus an isolated stage and cleanup plan.

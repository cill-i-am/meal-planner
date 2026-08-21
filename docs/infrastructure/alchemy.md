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
`importBatchQueueName`, `importBatchDeadLetterQueueName`,
`importProviderGatewayId`, `websiteWorkerName`, and `websiteUrl`, plus the
optional `apiUrl`. The household domain Worker is private and is deliberately
not surfaced as a public URL. Alchemy types Worker and Website URLs as
`string | undefined`: a resource can exist without a generated workers.dev
URL. Operator tooling must not invent a URL or cast it to a required string.
When `apiUrl` is present, `GET <apiUrl>/health` returns:

```json
{ "ok": true }
```

When it is absent, use `apiWorkerName` to locate the Worker and inspect its
configured routes/domains before testing an endpoint.

## Recipe import storage and caller authentication

`MealPlannerDatabase` is one shared household-scoped D1, bound to the Worker
through Alchemy's Effect-native D1 query binding. Household ownership is the
`household_scope_id` on canonical recipe-import aggregates and every public
recipe-import read or mutation. That existing domain data has not moved into
the household Durable Object tracer. Its fresh canonical SQL baseline is under
`apps/api/migrations`;
the stable tracking table is `d1_migrations`. Generate Drizzle metadata with
`pnpm db:generate`, review the SQL, and move the approved SQL to a numerically
prefixed top-level file. Keep only Drizzle snapshot JSON under `migrations/meta`:
Alchemy recursively discovers every `.sql` file beneath its migrations
directory, so leaving a generated metadata copy there would apply it twice.

The baseline creates the recipe-import intent aggregate, request and history
records, execution and provider checkpoints, recovery ledgers, evidence
references, review data, complete mutation receipts, foreign keys, indexes, and
immutability guards directly on an empty D1 database. Local Workerd proof applies
that baseline through the real D1 binding, checks `foreign_key_check`, and
exercises the transactional race and receipt constraints without cloud access.

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
principal for batch and provider terminal-settlement routes only. Secrets are
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

D1 persists source identity, intent state, idempotency metadata, durable
execution facts, review data, recipes, and safe evidence references. It does
not persist credentials, raw provider payloads, or media. TikTok requests are
limited to the bounded source-resolution and acquisition workflow.

`ImportMediaAcquisitionObject` is addressed by the globally random `importId`
for per-import media/container coordination and private artifact transport.
Artifact commands validate an ID containing that import ID and acquisition
execution generation. It does not use Durable Object storage: durable lifecycle
and domain state stay in D1, while short-lived private artifacts stay in R2.
The object is noncanonical and is neither a household partition, import
lifecycle authority, recovery authority, nor household authorization boundary.

## Import operations staging topology

`ImportEvidenceBucket` deletes private objects under `imports/` after seven
days. The lifecycle policy is the deployable deletion boundary; D1 imports,
idempotency records, recipe reviews, audit transitions, and approved meal plans
are outside the bucket and are not retention targets.

`ImportBatchQueue` and `ImportBatchDeadLetterQueue` are isolated, stage-owned
Queue resources. The Cloudflare producer adapter sends the existing ID-only
`{ batchId, itemId }` message contract and maps provider failures to the safe
application error. It must never enqueue source URLs, provider payloads, media,
or credentials.

The Worker registers one serial consumer for each Queue. Primary deliveries are
fenced and settled through the D1-backed batch store, and exhausted deliveries
move to the configured dead-letter queue. Dead-letter replay claims and their
leases are also durable in D1. Both consumers bind canonical intent admission
to the designated system principal; messages continue to carry IDs only. The
operational service remains the authority for role checks, the pre-side-effect
replay quota boundary, idempotent intent admission, and the closed privacy-safe
event union.

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

# Meal Planner Alchemy operations

The repository owns one Alchemy v2 stack named `MealPlanner`. Its first stable
resource identity is the `MealPlannerApi` Cloudflare Worker. Recipe imports add
the `MealPlannerDatabase` D1 resource. Changing any of these logical IDs is a
resource-identity decision and must not be treated as a cosmetic rename.

The pinned infrastructure toolchain is Alchemy `2.0.0-beta.63`, Effect and
`@effect/platform-node` `4.0.0-beta.99`, Node `>=22.18.0`, and pnpm `11.7.0`.
CI runs Node `22.19.0`.

Version-sensitive APIs were checked against the installed package and the
official [`v2.0.0-beta.63` source tag](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.63).

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
4. follow the command printed by the pinned Alchemy CLI (v2.0.0-beta.63 uses
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
`evidenceBucketName`, `evidenceRetentionSeconds`, `importBatchQueueName`, and
`importBatchDeadLetterQueueName`, plus the optional `apiUrl`. Alchemy types the
Worker URL as `string | undefined`: a Worker can exist without a generated
workers.dev URL. Operator tooling must not invent a URL or cast it to a
required string. When `apiUrl` is present, `GET <apiUrl>/health` returns:

```json
{ "ok": true }
```

When it is absent, use `apiWorkerName` to locate the Worker and inspect its
configured routes/domains before testing an endpoint.

## Recipe import storage and caller authentication

`MealPlannerDatabase` is bound to the Worker through Alchemy's Effect-native D1
query binding. Its versioned SQL is under `apps/api/migrations`; the stable
tracking table is `d1_migrations`. Generate Drizzle metadata with
`pnpm db:generate`, review the SQL, and move the approved SQL to a numerically
prefixed top-level file. Keep only Drizzle snapshot JSON under `migrations/meta`:
Alchemy recursively discovers every `.sql` file beneath its migrations
directory, so leaving a generated metadata copy there would apply it twice.

`MEAL_PLANNER_IMPORT_API_TOKEN` is a required secret-text Worker binding. The
Worker reads it through `Config.redacted`; it must never be logged, returned,
or committed. `POST /imports` and `GET /imports/:id` authenticate before parsing
caller input and fail closed when the binding is missing or empty.

GAIA-108 persists only source identity, import state, idempotency metadata, and
safe evidence references. It does not persist submitted or redirect URLs,
provider payloads, media, recipe data, or credentials. TikTok requests are
used only for bounded identity/availability checks. GAIA-109 will replace the
inert `ImportWorkflowStarter` seam with the queued acquisition workflow;
workflow-start recovery and terminal-to-queued recovery remain later work.

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

The stack deliberately does not register a Queue consumer or attach the dead
letter queue yet. The current batch coordinator and replay claim store are
provider-free in-memory tracers; connecting them to an at-least-once remote
consumer would lose batch state across isolates and could duplicate effectful
work. A later authorized slice must provide durable coordinator and atomic
replay-claim adapters before it can bind the consumer, configure retry and
dead-letter delivery, or claim live recovery proof. The existing operational
service remains the authority for role checks, the pre-side-effect replay quota
boundary, ordinary-import idempotency, and the closed privacy-safe event union.

## Cleanup and test boundaries

An approved destroy targets only the named `MealPlanner` stage. The shared state
store is not stage-owned cleanup and must not be deleted with a preview or
developer stack. Report failed cleanup and retained resources exactly; do not
fall back to state clearing, adoption, broad deletion, or unsafe nuke.

The repository's Vitest coverage for the stack is structural and non-mutating.
It proves source contracts, guard behavior, and the health router, but it does
not prove Cloudflare provider lifecycle, Worker bundling, workerd behavior,
remote state access, account selection, or a deployed URL. Real Alchemy stack
and provider tests create cloud resources and require separate, action-time
approval plus an isolated stage and cleanup plan.

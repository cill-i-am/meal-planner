# Meal Planner Alchemy operations

The repo defines one Alchemy v2 stack, `MealPlanner`. It includes the
`MealPlannerApi` Cloudflare Worker, `MealPlannerAuthDatabase` for Better Auth,
and `ProviderAccountingDatabase` for provider operations. These logical IDs
identify resources. Renaming one is not a cosmetic change.

The pinned infrastructure toolchain is Alchemy `2.0.0-beta.80`, Effect and
`@effect/platform-node` `4.0.0`, Node `>=24.20.0`, and pnpm `12.3.4`.
CI runs Node `24.20.0`.

The API review used the installed package and official
[`v2.0.0-beta.80` source tag](https://github.com/alchemy-run/alchemy/tree/v2.0.0-beta.80).
Check official guidance against the installed version when changing this code;
a newer example is not a reason to upgrade.

The checked-in patch retains atomic D1 migration imports, queue consumer
readback and reconciliation, and canonical Worker metadata hashing. The local
provider regression tests still require these fixes on beta.80.

Effect core, platform-node, SQL adapters, and the Effect test adapter use
stable `4.0.0`. Ordinary tests run on Vitest `5.0.3`. Native Worker tests
run in `tools/worker-tests` on Vitest `4.1.11`, the version supported by the
Cloudflare plugin. This keeps both runtimes within their supported peer ranges.

The Alchemy auth adapter requires Better Auth and its Drizzle adapter `1.7.5`.
The checked-in auth migration replaces issuer-based account identity with a
unique provider/account pair and keeps credentials and sessions. Review it
through the existing D1 preflight before any separately authorized deployment.

## Stages, profiles, and accounts

A stage identifies an isolated set of stack resources. A profile selects
credentials. Its name does not establish the environment or active account.

- Upstream defaults are Alchemy's `live_$USER` stage for plan/deploy/destroy
  and `dev_$USER` for `alchemy dev`; the `$ALCHEMY_PROFILE` environment
  variable falls back to the profile named `default`. The local plan wrapper
  preserves the upstream default when its flags are omitted.
- Future preview automation uses `pr-<number>` and must pass both `--stage` and
  `--profile` explicitly.
- Production uses explicit `prod`, an explicit production profile, and a fresh
  operator approval.
- CI and every future approved cloud operation must pass an explicit stage and
  profile, then independently verify the Cloudflare account resolved by that
  profile before proceeding.

Never infer authority for one stage, profile, account, or command from approval
for another.

## Transactional email

The API Worker has an Alchemy `send_email` binding for invitation and password-reset
messages. Production owns the `mail.ceird.app` Email Sending subdomain through
`MealPlannerMail`; other stages do not manage that account-wide resource. The
binding sends as `noreply@mail.ceird.app` and permits arbitrary recipients only
when the account has Workers Paid and Email Sending is enabled. The production
stack reads `CEIRD_ZONE_ID` for the verified `ceird.app` zone. Confirm that the
zone belongs to the explicitly selected Cloudflare account before using it.

`MEAL_PLANNER_EMAIL_DELIVERY_ENABLED` defaults to `false`. Keep it false for the
first deployment that creates the sending subdomain. Cloudflare turns on Email
preview for a new sending domain by default; previews include full reset links.
After the domain and SPF/DKIM/DMARC records are verified, disable Email preview
for `mail.ceird.app` in Email Service settings. Only then set the flag to `true`
in the reviewed production configuration and deploy that change. The flag is a
delivery gate, not a local mock adapter. Use the local Alchemy email simulator
for development; do not enable remote sending from a local stage by default.

Use disposable recipients for the first live invitation and reset checks. Verify
the Cloudflare submission result, recipient inbox receipt, and completed link
journeys separately. Do not include action URLs or reset tokens in logs,
screenshots, PR text, or test evidence. A provider submission can still bounce or
be suppressed. See the [delivery plan](../plans/auth-email-delivery.md) for the
remaining acceptance checks and the [Cloudflare Email Service guide](https://developers.cloudflare.com/email-service/)
for current eligibility and DNS requirements.

## One-time Cloudflare state bootstrap

`Cloudflare.state()` uses Alchemy's account-wide Cloudflare state Worker and
supporting secrets. On first use, plan or deploy can prompt to create or upgrade
that infrastructure and can refresh local state-store credentials. That is a
Cloudflare/account/authentication mutation, even when the intended command is
only a plan.

Native `pnpm dev` uses local state and a guarded developer stage. It does not
bootstrap hosted state or provision the AI Gateway. Deployment and plan still use
the hosted state described above. See the [local development guide](local-development.md)
for the native runtime and test harness; remote AI bindings need a valid profile.

Before the first real command, an operator must:

1. name the Cloudflare account and profile;
2. independently verify the account selected by the profile;
3. obtain explicit approval for the state bootstrap or upgrade;
4. follow the command printed by the pinned Alchemy CLI (v2.0.0-beta.80 uses
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
pnpm run alchemy:deploy -- --stage dev_cillian --profile sandbox --d1-target /private/path/target.json --d1-evidence <reviewed-digest>
pnpm run alchemy:destroy -- --stage dev_cillian --profile sandbox
```

Deploy and destroy reject missing stage/profile flags. Every wrapper rejects
`--yes`. Destroy also refuses the exact `prod` stage.

Deploy additionally requires the existing-D1 inspection below. It fixes the
repository's `alchemy.run.ts` entrypoint and rejects alternate files, env-file
overrides, adoption, force and other deployment flags. Plan and destroy retain
their existing behavior. Calling Alchemy directly bypasses this repository
guard and is not the supported release path.

Immediately before an approved operation, print and confirm the stack
(`MealPlanner`), stage, profile, independently verified account, intended
mutation, and cleanup boundary.

## Existing D1 release inspection

These checks inspect the two existing Meal Planner databases. Creating resources
for a new stage is a separate operation that needs authorization. A missing
database, absent ledger, or failed query is not permission to create or adopt
resources. No preflight command runs Alchemy plan, bootstrap, deploy, or SQL
writes. Reading an existing auth profile can refresh OAuth credentials; new
sign-in or grants remain separate.

After account access is established, discover metadata using the intended
profile and account:

```sh
pnpm run d1:preflight discover --profile <profile> --account <account-id>
```

Discovery returns every API Worker with the exact `MealPlanner` stack and
`MealPlannerApi` logical resource tags. Its stage tag and the two named D1
bindings determine the physical UUIDs; database-name prefixes do not. It reads
no ledger rows. Select the intended stage and save that target object privately,
outside tracked source. Multiple candidates require actual target selection.
The target contains account, profile, stage, Worker name and both database
names/UUIDs; it is metadata, not credentials or approval.

From a clean, committed release checkout with the pinned toolchain, inspect the
selected target:

```sh
pnpm run d1:preflight inspect --target /private/path/target.json
```

Inspection first revalidates the resolved account, Worker ownership and both
binding UUIDs. It reads the existing same-profile, same-account state-store
cache, checks API version 7, and fetches only the two D1 resource records. The
top-level attributes Alchemy uses for created, updated and interrupted updating
resources must match the frozen UUIDs, names and account. Missing, replacing,
creating, deleting or local-mode state requires a separately assessed recovery
or provisioning effect. Unavailable or stale state-store credentials fail;
the command never bootstraps the store or starts Access/login flows.

It then reads migration ledger columns/rows, schema definitions and current
recovery bookmarks. The report includes the exact
release SHA, local SQL byte hashes, runtime versions, applied/pending migration
names, stored-hash consistency, the expected legacy ledger conversion and a
digest of the reviewed state. Keep this account-specific report private. Query
errors, missing recovery bookmarks, unsupported history, duplicate aliases or
IDs, history gaps, unknown migrations and stored hash mismatches fail closed.

Review the full observed schema definitions and pending SQL with the report.
The schema comparison binds deployment to the shape reviewed by the operator;
it does not prove semantic compatibility or recover the original SQL. Legacy
three-column rows contain no hashes. Alchemy reconstructs their hashes and
creation timestamps from the current release files, preserves recorded names
and application times, and regenerates numeric IDs. Converted rows can be
indistinguishable from native five-column rows. Accordingly, the report always
labels original applied-SQL provenance `unknown`; a matching stored hash proves
consistency with today's ledger, not independent historical provenance.

Before deployment, explicit authorization must cover the actual account,
profile, stage, both database UUIDs, the observed schema/history, the proposed
reconstruction and pending SQL, and the recovery route. Record that existing
authorization in the task or owning delivery record. Passing a digest does not
grant authority, and the report is not an offline release bypass.

The deploy wrapper always repeats live inspection and compares its new digest
with `--d1-evidence` before launching Alchemy. Target, executor state, release, SQL, history,
schema or proposed-effect changes stop launch. Recovery bookmarks and observation
times are refreshed and printed each run but excluded from the digest because
normal application writes can advance them. The preflight and deploy use the
same repository working directory, profile and inherited environment, including
Alchemy's default `.env` configuration. This is a final pre-launch check, not a
remote lock against concurrent changes during Alchemy's subsequent prompts.

Capture both current bookmarks and the intended D1 Time Travel restore targets
before an authorized reconciliation. A restore replaces database state and
requires authorization for that effect; collecting a bookmark does not perform
or test restoration. Consult the official
[D1 Time Travel reference](https://developers.cloudflare.com/d1/reference/time-travel/)
for the account's retention window and restore procedure.

Conversion and pending migrations are separate import batches. Conversion can
remain committed when a later batch fails. In that case inspect again, compare
the new report with the expected converted state, and use its fresh digest for
an authorized retry. Existing explicit authorization may already cover that
expected conversion/retry state; ask again only for an effect outside its scope.
The local SQLite-backed HTTP fixture demonstrates converted ledger persistence,
pending-batch rollback and single-application retry through the installed
Alchemy executor. It does not prove live Cloudflare atomicity, recovery or the
readiness of any particular remote target.

## Outputs and health verification

The stack returns the safe resource inventory `apiWorkerName`,
`authDatabaseName`, `evidenceBucketName`, `evidenceRetentionSeconds`,
`importProviderGatewayId`, `providerAccountingDatabaseName`,
`websiteWorkerName`, and `websiteUrl`, plus the optional `apiUrl`. The household
domain Worker is private and deliberately has no public URL. Alchemy types
Worker and Website URLs as
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

`ProviderAccountingDatabase` is a dedicated global operational D1 for
production-owned provider budgets, reservations, settlement, reconciliation,
and receipt facts. It contains no organization or household ownership, import
route, import execution, lifecycle, evidence, review, recipe, or batch state.
Terminal checkpoints, recovery attempts, and recovery replay authority are
household-local. Its generated migration is under
`apps/api/provider-accounting-migrations`; the stable tracking table is
`d1_migrations`. Alchemy `.76` uses `migrations: { dir, table }` and upgrades
the old three-column ledger to its five-column format in place. This is a
real database mutation on the next approved D1 reconciliation; unchanged
resources may remain a deployment no-op. Local regression coverage checks
conversion, trigger SQL, rollback, and replay.
Run `pnpm --filter @meal-planner/api db:generate` or
`pnpm --dir apps/api db:generate`, then review the generated timestamped
`migration.sql` and `snapshot.json` together. Regeneration without a schema
change must create no new migration.

The provider accounting baseline contains exactly five tables:
`provider_accounting_budgets`,
`provider_accounting_conservative_settlements`,
`provider_accounting_dispatches`, `provider_accounting_recipe_replay_values`,
and `provider_accounting_reconciliations`. The former shared household tables,
migration history, repositories, and bindings are discarded rather than copied
or backfilled.
Structural tests reject both household product tables and tenant-filtered global
persistence in production composition.

`MealPlannerAuthDatabase` is a separate D1 database for Better Auth identity,
cookie sessions, organizations, invitations, membership, and the small family
control-plane record (setup completion and request receipts). Household people,
profiles, and product data remain in household SQLite. The runtime uses
Better Auth `1.7.2` through the public Drizzle relations-v2 adapter. The
actual auth configuration generates `auth.database-schema.ts`; Drizzle Kit owns
the checked-in SQLite migrations under `apps/api/auth-migrations`. App-owned
family tables are declared separately in `features/families/schema.ts`; both schema
files feed the same Drizzle migration configuration. Alchemy only
provisions and binds the database and applies that migration. It does not run
Better Auth or Alchemy automatic auth migrations.

Before applying the family-resource migration, finish any submitted person or
invitation requests retained by old setup checkpoints. The migration checks this
and refuses to discard unresolved requests. See the [implementation decisions](../plans/family-resource-onboarding.md).

Household routes authenticate with the same-origin Better Auth cookie. Effect
middleware resolves the session, requires an active organization, and verifies
membership through Better Auth's public API before constructing the typed
household principal. People resource routes use the URL family ID and check its
live membership independently of the session's active organization. The active organization value alone is not authorization.
`MEAL_PLANNER_IMPORT_API_TOKEN`, `MEAL_PLANNER_IMPORT_ACTOR_ID`, and
`MEAL_PLANNER_IMPORT_HOUSEHOLD_SCOPE_ID` remain the distinct designated system
principal for the private provider accounting reconciliation route and
Household recovery route. Secrets are read through `Config.redacted`; they must
never be logged, returned, or committed.

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
idempotency, review, recipes, compact evidence metadata and R2 references,
terminal checkpoints, recovery attempts, canonical batch/item state, batch
outbox state, and dispatch/replay receipts.
The global operational D1 persists only provider accounting facts. Neither D1
persists credentials, raw provider payloads, or media. TikTok requests are
limited to the bounded source-resolution and acquisition Workflow.

`ImportMediaAcquisitionObject` is addressed by the globally random `importId`
for per-import media/container coordination and private artifact transport.
Artifact commands validate an ID containing that import ID and acquisition
execution generation. It does not use Durable Object storage: canonical
lifecycle, domain state, and execution checkpoints stay in the household
object and Workflow, while short-lived private artifacts stay in R2.
The object is noncanonical and is neither a household partition, import
lifecycle authority, recovery authority, nor household authorization boundary.

## Import execution topology

`ImportEvidenceBucket` deletes private objects under `imports/` after seven
days. The lifecycle policy is the deployable deletion boundary; household
imports, idempotency records, reviews, timelines, recipes, and meal plans are
outside the bucket and are not retention targets.

The acquisition Workflow validates each R2 object's native checksum, custom
metadata, authoritative source shape, execution generation, and
acquisition-attempt-scoped key before it commits the household-local reference.
Household SQLite claims each attempt through a deterministic intent,
execution-generation, and attempt-ordinal identity. On restart, the Workflow
reads that ledger and verifies an already-written create-only media and manifest
pair before allocating a later generation; claim-response loss replays the same
identity. Recovery repeats the same R2 integrity check through the admitted
household and Workflow authority. R2 and service-binding I/O remain outside
every `HouseholdObject` transaction, and raw organization identifiers are
neither logged nor returned.
There is no global import route, R2 event Queue, event consumer, or event DLQ.

Public admission commits a compact household outbox intent before the API host
starts the deterministic generation-specific Workflow. Host retries reconcile
the same Workflow identity and record their delivery result through a closed
system command.

Batch admission separately commits canonical batch, item, replay, and outbox
facts and a durable dispatch callback in one native storage transaction. Alchemy's
callback scheduler sends identifier-only messages to
`HouseholdImportBatchQueue`. `MealPlannerApi` consumes that Queue and starts one
deterministic `HouseholdImportBatchItemWorkflow` per item generation. The
Workflow coordinates ordinary import admission, acquisition dispatch, and
household-local item settlement. One
initial delivery plus three retries precede
`HouseholdImportBatchDeadLetterQueue`; its consumer first reconciles the same
deterministic Workflow identity. It records the closed `dispatch_exhausted`
failure through the private household boundary only when the start adapter can
prove that no Workflow started. An unavailable probe remains retryable and
cannot contradict a committed Workflow or orphan its household outbox. A Queue
send remains recorded while that outbox stays callback-eligible until household
item settlement, so callbacks keep reconciling the stable identity; errored or
terminated instances restart by that identity, while active or unknown
instances are never terminally settled.
Neither Queue is canonical, and neither carries submitted source, idempotency,
actor, provider, or raw response material.

The provider accounting reconciliation route remains a private, explicitly
authorized seam that changes global cost facts only. The separate Household
recovery route carries authenticated organization provenance directly to the
household boundary, where terminal identity and recovery authority are proved.
It cannot authorize household state from global D1.

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
`pnpm test:stack` additionally proves the real local Alchemy graph, Worker
bundling, D1 migrations and native service bindings using `Test.make({ dev: true })`.
Local tests do not prove remote state access, account selection or a deployed URL.
Live provider tests create cloud resources and require separate, action-time
approval plus an isolated stage and cleanup plan.

## Native observability and shared media builds

All four application Workers use `worker-observability.ts`: invocation logs and
traces are enabled, persisted, and sampled at 100%, with compatibility date
`2026-09-25`. The API and household Effect hosts provide `Cloudflare.Telemetry()`.
Alchemy registers a fresh tracer for fetch, RPC, Queue, Workflow and Durable Object
events; named `Effect.fn` and `Effect.withSpan` operations join native binding
spans. The Website and native Agents Worker have platform tracing and logs.
Node container internals need a separately configured exporter for Effect spans;
this configuration does not add one or promise a continuous distributed trace
across durable restarts. Existing job correlation IDs remain authoritative.

On 3 October 2026 the owner requested full platform telemetry for the prelaunch
application, accepting automatic URL metadata. Application-authored telemetry
still uses safe fields and redacted credentials. Revisit sampling and platform
metadata before onboarding real users. A code change does not activate telemetry
in a deployed Worker; the separately authorized deployment does that.

Until 1 December 2026, Workers logs and trace spans share the Paid allowance of
20 million events per month, then $0.60 per additional million, with seven-day
retention. From 1 December the shared Paid allowance becomes 50 GB ingested and
12 GB-month stored per billing cycle; additional usage costs $0.25/GB ingested
and $0.10/GB-month stored. These are account-level allowances, not one allowance
per Worker. For example, 30 million combined events currently cost $6 beyond the
included allowance. The new pricing measures pre-compression bytes, so span count
alone cannot predict that bill. See [Workers log pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
and [Cloudflare Observability pricing](https://developers.cloudflare.com/observability/pricing/).

The media container streams its logs to Cloudflare and publishes to `meal-planner-media` in the selected Cloudflare
account. Alchemy reuses identical content-hash images and shared `:buildcache`
layers across stages, while deployments remain pinned to manifest digests.
Applications and instances stay isolated by stage. Base images and downloaded
media tools remain pinned. This registry configuration takes effect on deployment;
local media tests now reuse Docker's normal build-layer cache. Test images,
containers and workspaces remain disposable, while compiled layers survive
repeated local checks.

## Query spans and request completion events

Ordinary Drizzle instances in auth D1, provider-accounting D1 and private-output
Agents use `cloudflare-drizzle-tracing`. Query, transaction, savepoint and batch
spans join the current native trace. Parameter capture stays off. Household
Drizzle uses the Effect SQL adapter, which already emits `sql.execute` spans;
it is not wrapped by the Promise-based tracing package.

The API emits one structured `http.request.completed` event per handler outcome,
including method, path, status, duration, request ID, trace/span IDs and safe error
categories. Query strings and auth reset-token path segments are omitted from
this application event. Ordinary responses expose `x-request-id`; import jobs
reuse that ID as their persisted correlation ID. Raw responses and WebSocket
upgrades pass through unchanged. Duration measures handler response handoff,
not an entire stream or WebSocket session. Native spans retain dependency detail;
these events provide a searchable outcome without reconstructing scattered lines.

The household host captures `Cloudflare.SqlMigrations` during construction and
uses Alchemy to apply pending SQL at activation. It retains the existing
`__drizzle_migrations` table and adopts its modern ledger in place without replay.
Drizzle remains the schema generator. Auth D1 migration ownership and deployment
preflight remain unchanged. Native adoption and rollback tests protect that seam.

Website memo inputs include public assets, shared compiler configuration and
workspace sources, so unchanged builds reuse Alchemy's cache while those changes
correctly invalidate it. No cloud plan or deployment is needed to verify local
startup and the test graph.

## Browser performance and diagnostics

Before a production deployment, set `WEB_ANALYTICS_HOST` to the hostname users
visit, without a scheme or path. Alchemy creates `MealPlannerWebAnalytics` and
binds its public beacon token to the Website. Do not create another site or
manually inject a second beacon in Cloudflare's dashboard. The stack returns
`webAnalyticsSiteId`. Local and preview stages omit RUM; production activation
requires a deployment. No provider credentials are exposed in HTML.

Use Cloudflare Web Analytics for browser page performance and Core Web Vitals.
Use Worker Logs with `event = browser.event` for app API timings, navigation and
uncaught error categories. Match `browser.requestId` with `requestId` on
`http.request.completed` to find the corresponding server trace. Reports do not
include submitted content, error messages or raw browser paths. They are client
claims and may be missing; they do not establish application success.

The browser sends at most 30 events per minute. The API additionally applies a
native 60/minute/IP rate limit before decoding at most 4 KiB. These approximate
limits prevent ordinary error loops from producing unlimited logs, but are not
global billing caps. RUM is free. Diagnostic requests and generated logs/spans
use the normal Worker and Observability allowances described above. See the
[browser implementation and limits](../reference/engineering/OBSERVABILITY.md#browser-diagnostics).

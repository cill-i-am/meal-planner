# Alchemy and Effect stable upgrade

Status: done
Owner: current repository upgrade
Delivery: merged and separately authorized production deployment verified on 3 October 2026

## Outcome and context

Update Alchemy from `2.0.0-beta.76` to npm latest `2.0.0-beta.80`, and Effect
core, platform-node, SQL adapters and the Effect test adapter from
`4.0.0-rc.112` to stable `4.0.0`. Versions were checked on 2 October 2026
against the registry, installed source and official release notes.
The upgrade incorporates recipe-content main commit `ac03b93` and preserves
its structured content contracts and browser editing flow.

## Scope and decisions

The stable Effect API moves HTTP, HttpApi and AI out of unstable exports and
capitalizes Config constructors. Excess-property policy now belongs to decoder
options and HTTP payload/query annotations. Provider JSON Schema generation uses
the same closed-contract policy. Native chat keeps its host envelope extensible
while decoding the owned private context strictly.

Effect's stable test adapter requires Vitest 5. Ordinary tests use `5.0.3`;
the native Cloudflare plugin still requires Vitest 4. Its supported `4.1.11`
runner lives in `tools/worker-tests`, included in the canonical recursive tests.
Property generation uses Effect's schema-derived Arbitrary API. Native fixture
bundles use Alchemy's supported Worker source pipeline, replacing the deprecated
Rolldown plugin and adopting the production module compatibility handling.

Alchemy's auth adapter requires Better Auth and its Drizzle adapter `1.7.5`.
The new auth migration replaces issuer-based account identity with a unique
provider/account pair. Migration tests preserve passwords and sessions and
reject conflicting historical identities without discarding either account.

Alchemy now treats callback defects as terminal. Retryable provider failures
and recoverable batch remote failures remain typed at native task boundaries;
malformed contracts and unchecked defects remain terminal. Native tests preserve
lost-response and post-settlement defects, assert their terminal status and
explicitly restart failed steps to prove replay without duplicate work or charge.
Durable output commands now contain only their contract fields, excluding local
retry and reconciliation control flags.

The beta.80 provider patch retains atomic D1 imports, queue reconciliation and
canonical Worker metadata hashing. Upstream source and the existing regressions
still require all three. Preflight reads existing Alchemy profile documents with
upstream schemas without constructing the profile store, whose reads can migrate
or back up files. No cloud plan, deployment or account mutation is part of this work.

## Release features requested on 3 October

Enable full native Worker logs and traces using Alchemy's built-in Effect bridge,
share content-addressed media images and build layers across stages, and replace
household batch-outbox raw alarms with transactional durable callbacks. Batch
admission and its callback commit together; a failed schedule rolls back canonical
facts. Queue sends remain outside storage transactions, and delivered identifiers
remain eligible for reconciliation until household item settlement.

Root `pnpm dev` now starts the native Alchemy stack with Vite hot reload, local
state and a stable developer stage. Application secrets are generated once into
ignored `.dev.vars`; deployment retains hosted state. Local mode skips AI Gateway
provisioning. `pnpm test:stack` evaluates the same graph through Alchemy's local
sidecar test harness with disposable stages. AI remains a remote binding and
requires Cloudflare credentials; the local platform does not emulate models.

The release review covers beta.16 through beta.80, from April to October 2026.
Earlier opportunities include beta.73 Workflow step limits, beta.68 local email
simulation and SQL-aware source building, and beta.66 OTLP logs/metrics/traces
across runtimes. Drizzle's Durable Object helper and the native source builder are
already adopted. Household SQL snapshot application is now adopted with its
existing ledger; auth D1 retains its guarded migration process. Hibernating Effect RPC is
useful for future typed browser commands; it does not persist or replay unfinished
requests/streams and is not a drop-in replacement for the existing Agents chat.

## Further integration improvements requested on 3 October

Use Drizzle query instrumentation for ordinary D1 and synchronous Agents databases,
retaining existing Effect SQL spans for household queries. Emit one structured
API completion event with response/request correlation, trace IDs, safe error
categories and duration. Import jobs reuse the originating request ID. Preserve
native raw-response and WebSocket semantics.

Capture household migrations with Alchemy's supported SQL snapshot binding and
adopt the existing modern Drizzle ledger in place. Keep Drizzle generation and
D1 deployment guards. Remove the custom SQL loader and its separate Vite alias.
Reuse Docker's ordinary layer cache in local synthetic media tests while keeping
their images, containers and workspaces disposable. An unchanged repeat build
and media validation completed in 7.6 seconds. Include shared compiler
configuration and public assets in Alchemy's Website memo inputs. The published
tracing package needs a declaration-only NodeNext import-extension patch; its
runtime is unchanged. Focused native fixtures now embed the same migration
snapshots through Alchemy's supported `withSqlMigrations` bridge.

## Acceptance

- [x] Infrastructure tests, application tests, type checks, lint and production builds pass locally.
- [x] All 24 local auth and family browser journeys pass.
- [x] Synthetic media container tests pass locally.
- [x] Documentation and formatting checks pass locally.
- [x] Required hosted CI passes on the final signed commit.
- [x] Review the extended diff and retain crash, replay and application-authored redaction regressions.
- [x] Create a signed commit, push a PR and merge after hosted checks pass.

## Delivery and limits

Local validation after integrating `ac03b93` passes the API, shared-package,
web-component and native Worker suites, type checks, lint and production builds.
The native Alchemy stack suite passes signup, household creation, replay and reads
in about 23 seconds, including cleanup. Native dev starts the full graph in about
eight seconds with cached Docker layers; an API rebuild takes about three seconds.
Alchemy now captures household SQL snapshots and adopts the existing ledger
in place. The custom Node SQL import hook is removed. Final follow-up checks pass
193 infrastructure tests, 1,104 API tests, 122 native Worker tests, two native stack
tests and 24 browser journeys. The production build, both media container tests,
frozen installation, type checks, lint, formatting and documentation checks pass.

The signed implementation commit was approved through 1Password on 3 October.
Earlier signing attempts failed with `failed to fill whole buffer`; that blocker
is resolved. PR #265 merged after all hosted checks passed on 3 October. The owner
separately authorized production deployment later that day.

Local browser and container results verify synthetic environments. They do not
verify a deployment, real provider calls or live migration histories. Apply the
auth migration only through the existing guarded D1 deployment process when
deployment is separately requested.

One optional upstream peer constraint remains: TanStack persistence requests
Vitest 4 for its own tests. Production persistence regressions pass; its test
harness is not used, and no peer range is overridden. Updating persistence would
also require a separate TanStack AI upgrade.

The Cloudflare plugin's Vitest 4 requirement remains isolated until upstream
supports Vitest 5. Remove provider patch sections only when an unpatched release
passes their behavioral regressions.

## Browser observability follow-up

Add Alchemy-owned hostname RUM with a public token passed through Start's server
context and loader, plus generated-client browser diagnostics for API outcomes,
navigation and uncaught errors. Browser request IDs correlate to API logs; no
continuous frontend trace is claimed. Preserve response and cancellation behavior.
Bound client volume, use the native receiver rate limit and strict 4 KiB schemas,
and keep private values out of emitted events. Production now uses the shared `ceird.app` Website/RUM hostname; local and
preview do not create the domain or RUM resource.

A real native local browser probe emitted navigation and a safe TypeError category.
A synthetic failed login emitted a 401 browser event with the identical API
request ID. The production build, cross-workspace types, 252 frontend tests and
three native stack tests pass, including the native 61st-request rate-limit
rejection. Focused API and architecture checks, lint, formatting and documentation
checks pass. The disposable local stage was destroyed. The implementation is now signed after the owner approved 1Password; PR #265 is merged with hosted CI passing.

The production-host follow-up declares `ceird.app` once for the Website custom
domain and RUM. Alchemy owns its DNS/TLS using the existing `CEIRD_ZONE_ID`.
This removes the separate analytics-host input. Production deployment is recorded below.


## Production deployment on 3 October 2026

The owner selected a first production launch at `https://ceird.app`, using new
production databases and leaving E2E data separate. PR #267 added an explicit
new-stage D1 target that verifies empty hosted state, Worker ownership and database
inventory before the normal guarded deployment. The production plan contained
19 creates, no deletes or replacements. All three hosted checks passed on
`55a58ea` before the plan was applied with Alchemy `2.0.0-beta.80`.

Alchemy completed the deployment successfully. Post-deployment inspection verified
all nine auth migrations and both provider-accounting migrations, with no pending
migrations. The HTTPS page rendered the login form without browser errors. The
Cloudflare beacon loaded successfully and submitted RUM events with status 204;
the session endpoint returned 200 and browser diagnostics returned 204.

Cloudflare MCP read live production traces across the Website and API. A session
lookup had eight spans; a browser diagnostic request had five. Both reported no
errors. Live Worker settings confirmed persisted logs and traces at 100% sampling.
This verifies the deployed observability path, not every application or provider
journey. Outbound email remains disabled until sending-domain verification and
preview configuration are complete. Private-discovery AI remains unconfigured.
Production secrets are stored only in the ignored local deployment configuration.

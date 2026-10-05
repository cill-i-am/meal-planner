# Shared browser Effect execution

Status: done
Owner: web feature slices
Delivery: generated-client Effects and one stateless Effect Query adapter

## Result

The October 4 cleanup removed repeated Promise clients and Query execution
adapters across people, profiles, family setup, recipe import, auth, recovery,
and invitations. The shared [API transport feature](../../../apps/web/src/features/api-client/index.tsx)
provides `apiEffectQuery`. TanStack Query owns remote state. Features keep domain
commands, request shaping, failure projection, retry policy, cache keys, versions,
and recovery. Better Auth keeps its native commands.

The private interview runs Effects at its SDK Promise callback boundary. Its
confirmation HTTP transport uses the generated private-interview contract.
The cleanup also removed dormant import-review helpers and operator-carousel
staging; carousel evidence types and integrity/household commit rules remain.
No photo acquisition was added.

This delivered the plan's reduction in duplicate execution code with the installed
Query integration. The earlier AtomHttpApi pilot was not run and is removed from
the active work queue. A future replacement needs a concrete problem and scoped
experiment; it is not a prerequisite for private-client cleanup.

## Preserved boundaries

The transport adapter has no domain state or recovery ownership. Reads carry
cancellation to fetch. Mutation retries follow the owning feature's contract;
recipe import has no automatic mutation retries. Browser cancellation does not
roll back a server write.

A sole decoded rejection can settle a retained command. Transport failures,
malformed responses, and mixed Causes preserve uncertainty where there is no
proof of rejection. Exact payload, request identity, target versions, and binding
stay with the feature's existing recovery mechanism. Account or family changes
must not expose old private data or let late callbacks settle a newer command.

Family forms and submitted commands remain in mounted memory, as defined by
[family resource decision D26](../family-resource-onboarding.md#d26--no-persisted-browser-mutations-27-september-2026).
Private sessions retain their own durable server command and history contracts.
This result adds no writable cache or persisted browser draft.

## Recorded verification and limits

The October 4 implementation record reported passing repository typechecks,
lint, formatting, production builds, documentation checks and checker tests.
The final confirmation/staging cleanup recorded 1,635 tests: 1,050 API,
268 frontend and 122 native Worker tests, plus the other package/structural suites.
All 14 family, food-profile and private-review Playwright journeys passed in
Chromium and mobile WebKit against local Website/API Workers.

Generated-client tests cover scoped profile reads, pagination, cancellation,
and full Cause projection. Native confirmation tests cover copied references,
lost replies, generation changes, explicit recovery, empty bodies and malformed
metadata. Existing workflow admission, receipts, lifecycle and review tests remain.

These are the existing delivery results, not a new runtime verification run for
this documentation cleanup. No AtomHttpApi package fit, live TikTok acquisition,
paid model quality, or recipe-import Playwright journey was established.
The [private-client plan](02-private-client.md),
[forms and JSON plan](03-forms-and-json.md), and
[discovery evaluation](../private-discovery/03-adaptive-discovery-and-evaluation.md)
retain their own uncompleted scope and acceptance.

# Phase 1 — Consolidate the Effect browser API runtime

- Status: Proposed; implementation not started.
- Owner: Next assigned implementation agent.
- Planned: 2026-09-16.
- Planning baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Track: Library consolidation, not a new numbered product stage.
- Delivery authority: This change requests planning documents and open PRs only.
  Execute implementation when assigned; follow the existing
  [execution policy](../../agents/execution-policy.md). Do not merge this planning
  PR or start application implementation as part of producing the plan.

## Outcome and scope

Adults can use the existing household people and profile screens with unchanged
behaviour while the browser uses one supported Effect integration rather than
recreating client layers, Promise runners, and error plumbing per feature.

Start with profile reads and a profile mutation as one end-to-end slice. Then
migrate the people operations to the same integration. Prefer Effect v4 native
`AtomHttpApi` and its compatible React bindings. Keep the existing shared HTTP
contracts; this is not a switch to RPC or a rewrite of the backend.

The bounded scope is the two feature adapters, their consumers, identity-scoped
runtime integration, and their regression tests. Inventory the household and
recipe-import adapters to avoid introducing another incompatible convention,
but migrate them only where sharing the runner requires an in-scope change.
List any remaining adapters explicitly at handoff rather than claiming the
whole browser has migrated.

Do not implement LiveStore replication, alter authentication, change persistence
schemas, redesign UI, rewrite provider code, or remove domain-specific error and
replay rules. Do not adopt a second HTTP/RPC framework.

## Accepted direction

The user-selected direction is Cloudflare, Alchemy, Effect v4, TanStack Start,
LiveStore for selected replicated data, and Effect atoms or a compatible
TanStack Query bridge for other browser operations. The integration proposed
here must satisfy the existing contracts rather than change their meaning:

- [Household people API](../../architecture/household-people-api.md).
- [Household authority](../../architecture/household-domain.md).
- [Departure coordination](../../architecture/decisions/0010-coordinate-membership-departure-before-person-archival.md).
- [Stage 2 boundaries](../stages/02-private-discovery/README.md).
- [Repository workflow](../../agents/repository-workflow.md).

### Source map

Inspect these files at the actual implementation baseline:

- `apps/web/src/features/household-people/browser-operations.ts` and its tests:
  generated-client runner and nested Cause classification.
- `apps/web/src/features/household-profiles/browser-operations.ts` and its tests:
  generated-client runner and definitive-versus-ambiguous outcome mapping.
- `apps/web/src/features/household-people/retained-intents.ts`, both feature
  panels, and association controls: retained commands and UI concurrency.
- `apps/web/src/features/auth/auth-boundary.tsx`, `auth-state.ts`, and
  `apps/web/src/router.tsx`: authenticated context and current Query ownership.
- `packages/household-api/`: canonical schemas and generated HTTP clients.
- Root/web manifests and `pnpm-lock.yaml`: exact dependency baseline.

At the planning baseline Effect is `4.0.0-rc.112` and React Query is `5.102.8`.
These are observations, not instructions to downgrade a newer checkout.

## Dependencies and coordination

This phase is the shared browser-runtime foundation for Phase 2. Phase 3 can
prepare its isolated utility tests independently, but changes to the web
manifest, lockfile, profile forms, or their submit boundary need one writer.

[Draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218) is active
private-discovery implementation, not part of this planning baseline. Its head
observed during planning is `2fd5d7f315bf98de10d74792b2269f8f020e1f76`.
Recheck its status and changed paths before implementation. Do not copy,
rebase, overwrite, or mark that owner's work complete. Phase 1 may proceed on
non-overlapping HTTP slices; coordinate any shared private-profile consumer.

## Implementation sequence

### 1. Characterize the current boundary

Fetch current main and inspect relevant open work before editing. Record the
starting SHA, package versions, and tests to preserve. Inventory each state
owner: endpoint data, UI-only state, exact retained command, and future
LiveStore projection. An endpoint must have only one authoritative browser
cache after its migration. LiveStore selection is not permission to move
private data or server-authoritative commands into a shared replica.

Add or retain behavioural tests for successful reads/mutations, decoded server
rejections, transport failure, malformed success/error payloads, mixed causes,
defects, authentication expiry, and late callbacks. Distinguish a known server
rejection from an unknown commit outcome before changing the integration.

### 2. Prove the installed-version integration

In a disposable local probe, compile a real household HttpApi query and mutation
through `effect/unstable/reactivity/AtomHttpApi` and a compatible
`@effect/atom-react`. Record package exports, declared peers, resolved versions,
and whether HTTP/decode failures arrive in the error or defect channel. Current
upstream AtomHttpApi promotes some HTTP/schema failures to defects; test the
installed implementation rather than inferring the outcome from generic types.

Verify the TanStack Start browser build, request/client lifetime, cancellation,
and isolation. Do not suppress peer conflicts, import Effect v3 examples, or
upgrade the entire stack merely to make a sample compile.

The decision is bounded: use native atoms if this probe passes. Otherwise retain
TanStack Query and build one small Effect runtime/Query bridge for these HTTP
operations, forwarding cancellation and normalizing outcomes once. Record the
specific incompatibility and disposition. Do not adopt a third-party wrapper
solely because it advertises Effect v4, and do not build a general framework.

### 3. Implement scoped runtime ownership

Use a request-scoped registry for any server execution and an authenticated
browser-context registry/runtime. Never put user-specific results, cookies,
private commands, or service instances in a shared SSR singleton. Do not access
`location`, browser storage, or WebSocket during server module evaluation.

Identity includes the account, household, and current authenticated generation
where available. Dispose subscriptions and interrupt obsolete work on sign-out
or context change. Ignore late completions from the old identity. Query keys
and invalidation must not cross household boundaries. Browser abort is not
proof that a server mutation did not commit.

Keep an unresolved command in its existing identity-bound retention mechanism
until its canonical outcome is known; do not rely on atom lifetime to persist
it. A fresh authenticated generation may recover only the original command for
the correctly re-admitted identity, using the existing explicit retry rules.

### 4. Migrate a complete profile slice, then people

Wire profile reads and one actual mutation through the selected integration,
including loading, errors, canonical refresh, and retained unknown outcomes.
Then finish the profile consumers and people operations. Existing controllers
that must remain Promise-based may call the same runtime through one thin
boundary; do not keep a separate client lifecycle for them.

Use public Effect Cause APIs where they preserve existing semantics. Remove
structural Cause schemas and recursive traversal only after characterization
shows they are redundant. Preserve a narrow documented boundary for genuine
serialized/wrapped failures if tests demonstrate it is required.

Apply invalidation only to the relevant canonical data. Do not automatically
retry mutations, allocate replacement mutation IDs, or turn malformed responses
into definitive rejection. Pending/ambiguous commands continue to freeze sibling
actions. Late callbacks may not clear a newer retained command.

### 5. Remove the superseded path and record ownership

Delete unused runners, duplicate client construction, obsolete subscriptions,
and redundant structural error plumbing. Keep feature-specific failure meaning
and command validation. Remove Query only from fully migrated slices; unrelated
Query consumers and SSR integration remain until they no longer have callers.

Record the files/helpers removed, the remaining adapter inventory, selected
runtime scope, and any compatibility limitation. Do not leave a compatibility
framework or dual cache for hypothetical future consumers.

## Acceptance evidence

| Scenario | Required evidence |
| --- | --- |
| Profile/roster operations retain behaviour | Existing feature and generated-client tests plus a working read/mutate/refetch browser path. |
| Definitive rejection versus unknown outcome | Tests for decoded 4xx/domain failure, 5xx, transport/decode failure, defects, and mixed causes; unknown outcomes retain the original command. |
| Lost response after server commitment | Same payload and mutation ID recover one canonical result without duplicate profile/person changes. |
| Identity switch or expiry during a request | Delayed old responses cannot render, invalidate new data, or clear a new command; private state is removed from the old UI. |
| SSR and concurrent users | Separate requests/registries cannot observe each other's state; no browser-global access during SSR. |
| Cleanup/cancellation | Unmount and sign-out dispose subscriptions and obsolete requests without interpreting abort as rollback. |
| UI concurrency | Sibling actions remain frozen while outcome is unresolved; explicit retry and refreshed review still work. |
| Dependency compatibility | Exact installed versions, successful typecheck and production web build, no peer-dependency suppression. |
| Simplification | Each migrated endpoint has one cache/runtime owner and the replaced implementation is removed. |

Use `pnpm --filter @meal-planner/web test` and the affected shared-contract/API
suites, then `pnpm check`, `pnpm lint`, `pnpm format:check`, and `pnpm build` as
required by changed dependencies and CI. Inspect unfamiliar scripts before
running them. Exercise the real local browser and API seam for runtime claims;
synthetic errors are appropriate for deterministic failure injection. Follow
the existing immutable-head review requirements before an authorized merge.

No deployment, Alchemy plan/deploy/destroy, live provider calls, cloud data
mutation, or retailer activity is necessary for this phase.

## Implementation constraints

A successful library migration must preserve domain guarantees, not just reduce
lines. Failed compatibility or an unresolved replay/isolation regression is a
concrete blocker for that slice, not permission to weaken the contract. Keep
other safe work moving and report the exact failing test or API limitation.

Upstream references checked on 2026-09-16, not verified against the pinned
lockfile by this planning PR:

- [Effect AtomHttpApi source](https://raw.githubusercontent.com/Effect-TS/effect/main/packages/effect/src/unstable/reactivity/AtomHttpApi.ts).
- [Alchemy's native Effect atom/React example](https://alchemy.run/cloudflare/frontend/full-stack-tanstack-rpc-drizzle/).

## Agent handoff

When assigned implementation, use this work item as the plan. Establish current
main and the PR #218 overlap, characterize the outcome boundary, run the version
probe, then deliver the profile slice before broadening to people. Preserve
unrelated work and use a separate worktree as required. Update this record with
actual evidence; do not treat the planning PR as an implementation or a mandate
to merge unrelated work.

## Delivery record

- 2026-09-16: Planning-only work item created from the source audit and existing
  repository template. Runtime checks, compatibility probes, implementation,
  independent implementation review, and deployment have not been performed.

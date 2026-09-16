# Work Item — Library Consolidation 01: Effect Browser Integration

- Status: Proposed
- Owner: Unassigned; one implementation agent when delegated
- Stage / pull request: Library consolidation, phase 1; planning PR containing this file
- Planning date: 2026-09-16
- Reviewed baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`
- Implementation: Not started; no runtime or compatibility proof is claimed

## Outcome and scope

Household members can continue viewing and changing people and profiles with the same authorization, confirmation, and lost-result recovery behavior, while the web application stops rebuilding an Effect runtime and Promise/error bridge for each feature.

Prefer the existing Effect HTTP contracts plus native Effect v4 `AtomHttpApi` and `@effect/atom-react`. Prove one profile read/write path before migrating the remaining profile and people consumers. The observable engineering outcome is removal of duplicated browser execution machinery, not simply wrapping the old wrappers in atoms.

This phase does not introduce LiveStore, replace HTTP with RPC, replace Better Auth, change household persistence, rewrite private interviews, or remove TanStack Query from unrelated features. Cloudflare and Alchemy remain the infrastructure. Model/provider work and deployment are excluded.

## Accepted direction

Follow [repository workflow](../../agents/repository-workflow.md), [execution policy](../../agents/execution-policy.md), and the current [delivery record](../current.md). This is a proposed technical work item, not a new product stage or authorization to start implementation during the planning task.

The intended stack assigns different responsibilities:

| Concern | Proposed owner |
| --- | --- |
| Canonical household writes, versions, and receipts | Existing Household authority |
| Non-replicated HTTP reads and commands | Existing Effect HTTP contracts and one browser integration |
| Local/derived UI and async state | Effect atoms, subject to exact-version proof |
| Future selected replicated household data | LiveStore, through a separate migration |
| Unmigrated server-state features | Existing TanStack Query integration |

A resource must not have independently authoritative copies in Query, atoms, and LiveStore. Where a future LiveStore migration absorbs a query, derive UI state from that store rather than maintaining another fetched copy. This plan does not claim that any dataset has already been selected for replication.

### Source map

Paths below are relative to the repository root. Inspect their current callers and colocated tests before editing.

- `apps/web/src/features/household-profiles/browser-operations.ts`: repeated client-layer construction, `runPromiseExit`, and the public-Cause-based `classifyProfileCause`.
- `apps/web/src/features/household-profiles/operations.ts`: browser-facing operation contract and domain failure meanings.
- `apps/web/src/features/household-people/browser-operations.ts`: repeated execution bridge and structural Effect Cause interpretation.
- `apps/web/src/features/household-people/`: roster, invitation, departure, pending-command, and UI consumers; do not treat them as interchangeable mutations.
- `packages/household-api/`: existing API definitions, generated clients, schemas, and domain problems. Retain these contracts.
- `apps/web/package.json`, `package.json`, and `pnpm-lock.yaml`: version and verification authority.

The reviewed web manifest pins Effect `4.0.0-rc.112`, React `19.2.8`, TanStack Query `5.102.8`, and TanStack Form `1.33.5`; it does not yet declare the atom React bindings. These are baseline observations, not instructions to downgrade a newer implementation checkout.

### Non-negotiable behavior

- A sole, decoded canonical rejection can be definitive. Transport failure, invalid response decoding, defects, interrupted requests, unavailable outcomes, and mixed causes cannot prove a mutation did not commit.
- Preserve the existing distinct authentication-required outcome and its exact-command recovery behavior.
- Persist or retain the original mutation ID, payload, target, expected versions, and authenticated binding before dispatch wherever the existing workflow requires it. Do not mint a replacement identity on retry.
- Keep the existing unresolved-command exclusion rules within each workflow. Do not turn this into a new household-global lock or broaden concurrency restrictions.
- Disposing UI/runtime state must hide stale data and ignore old callbacks without silently discarding an unresolved command that the existing recovery contract retains.
- A query key or cache partition is not authorization. Server admission remains authoritative.

## Dependencies and coordination

There is no prerequisite implementation phase. This phase supplies the version choice and scoped state/runtime pattern for phase 2, private-interview state and streaming. Phase 3, bounded utility/form cleanup, may proceed independently with one writer for shared manifests and the lockfile.

[PR #218](https://github.com/cill-i-am/meal-planner/pull/218) was open during planning and changes private discovery and shared profile contracts. Re-read its status and changed files before implementation. Do not overwrite its branch or restore files from the audit snapshot over newer work. Record the actual implementation base SHA and any overlapping integration decision.

The three planning PRs are independent branches from the reviewed `main`, not a stacked implementation chain. Merging a plan does not mean its implementation prerequisite has landed.

## Implementation plan

### 1. Characterize the existing boundary

- [ ] Read root/nested instructions and current delivery state; start from fetched `main` or an explicitly assigned integration branch.
- [ ] Inventory the profile and people operations, their callers, current cache owners, and retained-command storage. Record what can actually be deleted.
- [ ] Add or extend behavioral characterization tests for the acceptance matrix below before changing the integration. Exercise existing public operation seams rather than asserting source text.
- [ ] Record baseline targeted test results and distinguish pre-existing failures from migration failures.

### 2. Prove the exact-version atom integration

- [ ] Inspect the installed Effect exports/types and the published peer requirements for a matching `@effect/atom-react` release. Verify React and scheduler peers as well as Effect. Upstream main is reference material, not proof for the pinned RC.
- [ ] Build a vertical pilot using the existing household HTTP API: profile read, one profile mutation, result/error rendering, and invalidation after confirmed success.
- [ ] Verify how that exact `AtomHttpApi` release represents schema/HTTP errors and exposes full causes. The currently reviewed upstream implementation converts schema and HTTP-client errors into defects; do not erase that distinction by extracting only the first failure.
- [ ] Prove the pilot compiles, renders in the actual web build, and passes the rejection/ambiguity/cancellation tests before expanding it.

Preferred decision: use native atoms when this proof succeeds without replacing the API contract. Do not install a moving `latest`, bypass peer checks, copy Effect internals, or introduce a broad dependency upgrade to make the demonstration pass.

If there is a concrete compatibility or complexity blocker, record the exact failing example and use the bounded fallback: retain Query and centralize the existing generated-client execution in one scoped Effect runtime with one tested error bridge. Reconsider `effect-query` only after checking its actual peer metadata and compiling it against this checkout. Do not ship both alternative implementations. A fallback must still remove the repeated runners; an inconclusive spike is not completion of the migration.

### 3. Establish lifecycle and cancellation ownership

- [ ] Create the smallest shared composition needed by the two features, with explicit browser account/household scope and disposal on identity changes.
- [ ] Keep authenticated runtime/registry values out of process-global SSR state. Prefer retaining the current client-side loading behavior during the pilot; any added SSR/hydration requires request-isolation tests.
- [ ] Do not serialize pending commands, private values, or mutation results into unintended hydration payloads or shared caches merely because the atom library supports serialization.
- [ ] Dispose subscriptions and cancel in-flight reads on teardown. For a dispatched mutation, cancellation is not evidence of rollback: preserve the existing unknown-outcome recovery path.
- [ ] Ignore callbacks/results from an older identity or command generation. Retained commands may be recovered only through their existing matching-context rules.

### 4. Cut over profiles, then people

- [ ] Move profile consumers to the proven integration; preserve profile-version queries, mutation preconditions, safety confirmation, and confirmed-success invalidation.
- [ ] Replace generic structural Cause walking with public Effect Cause APIs where characterization establishes equivalence. Keep domain classification feature-specific where its meanings differ.
- [ ] Explicitly investigate any serialized/wrapped-Cause test case before deleting its fallback. Do not confuse an arbitrary object with a valid in-process Cause.
- [ ] Migrate the people slice using the same composition, retaining roster-specific, invitation, departure, authentication, and exact-replay rules.
- [ ] Remove the migrated resources from the old Query ownership where atoms now own them. Keep unrelated Query providers and queries intact.
- [ ] Delete obsolete runners, subscriptions, unused exports/imports, and tests that solely exercise deleted plumbing. Preserve behavioral coverage at the replacement seam.

### 5. Record the actual simplification

- [ ] Document the selected integration, identity scope, cancellation semantics, and failure classification in the affected architecture/web documentation.
- [ ] Record the runtime/package version proof and a before/after inventory of removed generic code, remaining domain code, and dependency changes. Moving code to another directory is not a reduction.
- [ ] Update this work item's delivery record with commands, results, implementation/review heads, remaining gates, and eventual merge commit. Update `current.md` when the accepted active delivery state actually changes, not pre-emptively in this planning PR.

## Acceptance evidence

| Scenario | Required result and evidence |
| --- | --- |
| Profile read and successful change | Existing typed API and browser UI work end to end; affected authorized reads refresh after confirmed success without a second authoritative cache. |
| Sole canonical rejection | Existing business failure is displayed and does not become success or trigger an automatic retry. |
| Authentication expiry | Private/household view follows existing hiding rules; the original unresolved command survives as required and retries only after matching-context re-admission. |
| Lost reply, malformed success, transport error, defect, mixed cause | Outcome remains ambiguous where it is not proven; payload/ID/version are unchanged and sibling actions remain blocked under existing rules. |
| Disposed read or in-flight mutation | Reads stop updating disposed views; cancelling a dispatched mutation does not clear its recovery state or imply rollback. |
| Household/account switch and delayed callback | No previous-context data, invalidation, or result clears/updates the new context; test a later command already pending. |
| Concurrent SSR requests, if SSR is introduced | Distinct registries/caches and no identity leakage; private/pending state is absent from unintended hydration output. |
| Roster, invitation, departure, and profile recovery | Existing behavior suites still pass; synthetic/native fixtures prove exact replay and server admission where the integration changes that seam. |
| Code ownership | One browser integration for migrated operations; obsolete per-feature execution plumbing is removed, not left running in parallel. |

Use the real generated HTTP client in at least one local request/response failure test and an actual browser against a local application for the profile flow. Mock-only atom tests are insufficient for the typed-decoding and visible-runtime claims. No real invitations, external messages, or production data are needed.

### Verification commands

These commands come from the reviewed manifests. Inspect the actual test configuration and adapt only where the implementation checkout has legitimately changed. Use local synthetic fixtures; record exact commands rather than inventing test counts.

```sh
pnpm install --frozen-lockfile
pnpm --filter @meal-planner/web exec vitest --config vitest.config.ts run src/features/household-profiles src/features/household-people
pnpm --filter @meal-planner/web check
pnpm --filter @meal-planner/web build
pnpm format:check
pnpm lint
pnpm check
pnpm test
```

After intentional dependency edits, update the lockfile using repository conventions before the final frozen install. Run any additional required CI gates and affected API/native tests. Do not run `alchemy:plan`, deploy/destroy, cloud reconciliation, or real provider actions as a shortcut to local verification.

## Implementation constraints

Keep one writer for `pnpm-lock.yaml` and shared composition files. Avoid a new universal frontend-services framework, API schema duplication, hidden mutation retries, or a transport rewrite. Phase 2 must reuse the chosen lifecycle pattern rather than creating a second atom/Effect environment.

For rollback, revert the bounded implementation cutover on its branch. This phase requires no persistence migration or dual-write rollout. If implementation discovers a real compatibility contract requiring either, document the concrete requirement before adding it.

## Agent handoff

> Implement only Library Consolidation phase 1 from this work item. Re-read the current repository and PR #218 before editing. Prove the existing profile HTTP read/write slice with the pinned Effect atom integration, preserve the acceptance matrix, then consolidate the remaining profile/people execution plumbing. Use the documented bounded Query fallback only with concrete evidence. Keep domain authority, confirmation, and exact-command recovery intact. Record tests and the exact delivered head here; do not start phases 2/3, LiveStore, provider work, or deployment. Follow the user's assigned delivery scope and the repository execution policy.

## Delivery record

- 2026-09-16: Proposed following the custom-implementation audit. The planning task authorizes documentation branches and separate PRs only; implementation has not started and these plans are to remain open for review.
- Source basis: repository work-item template, current delivery/workflow, the referenced source files, and [Effect's AtomHttpApi source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/reactivity/AtomHttpApi.ts) plus [React package manifest](https://github.com/Effect-TS/effect/blob/main/packages/atom/react/package.json), inspected on the planning date. Upstream references are mutable; verify installed/published versions during implementation.
- Verification so far: planning/source inspection only. No dependencies changed, no application tests executed, no compatibility claim, no implementation merge, and no deployment.

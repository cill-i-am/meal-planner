# One browser Effect runtime

Status: proposed
Owner: unassigned

Delivery: a separately assigned, verified implementation or bounded no-adoption result

## Outcome and scope

Keep existing people/profile behavior while removing repeated client Layers,
Promise runners and error plumbing. Pilot a complete profile read/write/refetch
path, then people operations. Keep the existing generated Effect HTTP contracts,
Cloudflare/Alchemy backend and canonical Household writes. Do not introduce RPC,
LiveStore replication, new auth/persistence, private-interview behavior or a
universal frontend-services framework.

## Approach and trade-offs

Prefer installed-version `AtomHttpApi` and compatible React bindings if actual
peer/export/type/build evidence supports them. Inspect how the selected release
represents decoding/HTTP errors and full Effect Causes; do not erase ambiguity
by selecting the first failure. If compatibility or complexity fails, retain
Query and consolidate one scoped Effect execution/error bridge. Reconsider a
wrapper only after checking its real peers. Do not force dependencies, vendor
internals, install moving latest or ship both alternatives.

Own registry/runtime lifetime by account and household. Preserve existing
client-side loading unless new SSR/hydration has request-isolation proof. Keep
unresolved commands out of unintended serialization, preserve matching-context
recovery, dispose reads/subscriptions, and ignore callbacks from old contexts.
Cancelling a dispatched mutation is not rollback. A cache key is not authorization.

Migrate profiles, then roster/invitations/departure, retaining their distinct
failure/recovery rules. Inventory other adapters, but do not expand their scope
without a shared-composition need. Delete migrated Query ownership and obsolete
runners only after the replacement has equivalent behavior. Record remaining
adapters; do not claim the whole browser has migrated. A future LiveStore
projection and an atom/Query cache must not both own one resource.

## Source and coordination

Start at `apps/web/src/features/household-{profiles,people}/browser-operations.ts`,
people retained intents/panels, auth boundary/state, `apps/web/src/router.tsx`,
`packages/household-api/` and their tests. Manifests/lockfile own exact versions.
Coordinate profile forms and the lockfile with [utilities](03-forms-and-json.md);
[private-client consolidation](02-private-client.md) reuses the delivered lifecycle,
not merely a merged planning document. No dual-write/persistence migration is
expected; revert a bounded cutover without rewriting another branch's work.

## Acceptance

- [ ] Exact-version integration compiles in the real production web build with no
  peer suppression; fallback, if selected, still removes repeated runners.
- [ ] One profile read/mutate/refetch works through the real generated HTTP client
  and browser, followed by roster, invitation, departure and profile recovery.
- [ ] A sole decoded canonical rejection remains definitive and single-attempt.
  Transport/5xx/decode failures, defects and mixed causes retain an unknown outcome
  where commitment is unproven; auth-required remains distinct.
- [ ] Lost results retain original payload, mutation ID, versions and binding;
  exact replay yields one result, and existing unresolved-command exclusions hold.
- [ ] Expiry, identity switch, unmount and delayed old callbacks cannot expose old
  data, invalidate a new context or clear a newer pending command. Abort preserves
  unresolved mutation recovery while disposed reads no longer update the view.
- [ ] Concurrent SSR/hydration, if introduced, has isolated caches/registries and
  no unintended private/pending-state output.
- [ ] One cache/runtime owner per migrated operation; obsolete subscriptions,
  duplicated Cause walkers and plumbing are removed only with behavioral proof.

Use affected web/API/shared-contract tests, at least one real client failure
request, an actual local browser, production builds and required repository checks.
No provider call, real invitation, cloud plan, deployment or retailer mutation is
needed. An unresolved isolation/replay failure leaves that acceptance unmet.


## Proposal provenance

Consolidated from the overlapping planning PRs below. Those PRs remain open and
unchanged; this is the owning proposed scope on the refactor branch, not evidence
of implementation or dependency compatibility. The original planning baseline was
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`; recheck actual source/versions when
assigned. #218 has since merged. Old first-pass/handoff instructions and the
then-current plain-session runtime assumption are not new implementation rules.

- [#219 source](https://github.com/cill-i-am/meal-planner/blob/53d249715b6d530d38951ed257d23e59970ba05b/docs/delivery/library-consolidation/01-effect-browser-runtime.md), head `53d249715b6d530d38951ed257d23e59970ba05b`.
- [#220 source](https://github.com/cill-i-am/meal-planner/blob/a6adfe00f6c887367e2dea79629f9f1a03cb13db/docs/delivery/library-consolidation/01-effect-browser-integration.md), head `a6adfe00f6c887367e2dea79629f9f1a03cb13db`.

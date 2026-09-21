# Share the browser's Effect setup

Status: proposed
Owner: unassigned
Delivery: a checked implementation, or a tested decision not to adopt the proposed integration

## Outcome and scope

Remove repeated API-client setup, Promise runners and error handling from the
people and profile screens without changing their behavior. Start with one complete
profile read, save and refresh, then move the people operations to the same setup.

Keep the generated Effect HTTP APIs, the Cloudflare/Alchemy backend and Household
writes. This work does not introduce RPC, LiveStore replication, new authentication
or storage, interview features, or a general frontend service framework.

## Approach and trade-offs

Prefer `AtomHttpApi` and compatible React bindings after checking their installed
versions, peer dependencies, exports, types and production build. Check how that
release handles decoding errors, HTTP errors and full Effect Causes. Looking only
at the first failure can hide an uncertain save result.

If the integration is incompatible or adds too much complexity, keep Query and
share one scoped Effect runner and error adapter instead. Check any wrapper's
actual peer requirements. Do not force dependency versions, copy library internals,
install a moving latest release or ship both approaches.

Tie runtime and registry lifetime to the account and household. Keep client-side
loading unless new server-side rendering (SSR) or hydration is tested for isolation
between requests. Do not serialize unfinished requests into unintended outputs.
Recover them only in the matching account and household. Dispose of reads and
subscriptions, and ignore callbacks from old contexts. Cancelling a dispatched
write does not undo it. A cache key is not an access check.

Move profiles first, then roster, invitations and departure. Keep the different
failure and recovery rules for each. List other adapters, but change them only
when the shared setup needs it. Remove old Query ownership and runners after the
replacement behaves correctly. Record any adapters left behind. A future LiveStore
copy and an atom or Query cache must not both manage the same data independently.

## Source and coordination

Start with `apps/web/src/features/household-{profiles,people}/browser-operations.ts`,
the people panels and saved requests, auth state, `apps/web/src/router.tsx`,
`packages/household-api/` and their tests. Check manifests and the lockfile for versions.
Coordinate forms and lockfile edits with [forms and JSON](03-forms-and-json.md).
The [private-client cleanup](02-private-client.md) needs this work implemented,
not just this plan merged. No dual writes or storage migration are expected.
A small switch-over should be reversible without rewriting another branch's work.

## Acceptance

- [ ] The chosen versions compile in the production web build without ignoring peer
  requirements. Keeping Query must still remove the repeated runners.
- [ ] Profile read, save and refresh work through the generated HTTP client in a real
  browser. Then check roster, invitation, departure and profile recovery.
- [ ] A single decoded server rejection is definitive and attempted once. Transport,
  5xx and decoding failures, defects and mixed causes leave the write result unknown
  unless there is proof it committed. Keep authentication-required separate.
- [ ] A lost result keeps the original payload, mutation ID, versions and account
  binding. Retrying that request produces one result. Existing rules that block
  conflicting actions while a request is unresolved still hold.
- [ ] Expiry, account switches, unmounts and late callbacks cannot reveal old data,
  invalidate a new context or clear a newer pending request. Aborting a write keeps
  its recovery information; disposed reads no longer update the view.
- [ ] If SSR or hydration is added, concurrent requests have separate caches and
  registries. Private data and pending requests do not appear in unintended output.
- [ ] Each migrated operation has one cache and runtime owner. Remove obsolete
  subscriptions, duplicate Cause handling and runners only after checking behavior.

Use affected web, API and shared-type tests, at least one failing request through
the real client, a local browser, production builds and required repository checks.
No live provider call, real invitation, cloud plan, deployment or retailer change
is needed. An unresolved isolation or retry failure leaves acceptance incomplete.

## Original proposals

These proposals were written against
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. The linked commits preserve that
history; they do not prove that the work or package compatibility checks are done.
Check current code and versions when starting implementation. #218 has since
merged, so do not repeat its migration or restore its old private-session design.
Historical handoff instructions do not override a new implementation assignment.

- [#219 source](https://github.com/cill-i-am/meal-planner/blob/53d249715b6d530d38951ed257d23e59970ba05b/docs/delivery/library-consolidation/01-effect-browser-runtime.md), head `53d249715b6d530d38951ed257d23e59970ba05b`.
- [#220 source](https://github.com/cill-i-am/meal-planner/blob/a6adfe00f6c887367e2dea79629f9f1a03cb13db/docs/delivery/library-consolidation/01-effect-browser-integration.md), head `a6adfe00f6c887367e2dea79629f9f1a03cb13db`.

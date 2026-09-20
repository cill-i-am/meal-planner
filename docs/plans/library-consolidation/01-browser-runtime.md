# One browser Effect runtime

Status: proposed
Owner: unassigned
Delivery: verified profile/people runtime consolidation, including the selected fallback if needed

## Outcome and context

Household members retain the existing profile and people behavior while the web
application stops rebuilding Effect client Layers, Promise runners and error
bridges per feature. Success means one owner for each migrated operation and
removal of replaced generic machinery, not another wrapper around both old paths.

This is the evolving plan for that outcome. The [review sequence](README.md)
separates its proposal and verification changes without creating another plan.
The original September 16 package observations are historical; the implementation
checkout's manifests, lockfile, source and tests establish the actual baseline.

## Scope

Pilot a complete profile read, mutation and canonical refresh, then finish profile
and people consumers, including roster, invitations and departure. Keep generated
Effect HTTP contracts, Household authority and existing exact-command recovery.
Inventory household/import adapters, but migrate them only when shared composition
requires an in-scope change; report what remains rather than claiming a whole-app
migration.

Exclude RPC replacement, LiveStore rollout, authentication or persistence changes,
private-interview behavior, a universal frontend-services framework and unrelated
Query removal. [Household contracts](../../reference/household.md) and the
[people API](../../reference/household-people-api.md) own domain guarantees.

## Approach and trade-offs

### Prove the integration before widening the cutover

Characterize existing operation results, cache ownership and retained intents.
Compile a real generated HttpApi profile read/write slice through the installed
`AtomHttpApi` and compatible React bindings. Record actual exports, peers, resolved
versions and the production build result. Test where that version exposes HTTP,
decoding, defect and interrupted outcomes; a type signature or upstream example
does not prove the full Cause is preserved.

Prefer native atoms when the complete slice works without forced peers, copied
internals or a broad stack upgrade. Otherwise retain Query and centralize one
scoped Effect execution/error bridge. Record the concrete incompatibility and
selected fallback here. The fallback must still remove repeated runners; an
inconclusive spike or retaining both alternatives does not complete this outcome.
An ordinary integration choice stays in this plan; use the decision register only
if a consequential architectural choice actually needs a separate decision.

### Own lifetime and recovery separately

Scope the browser registry/runtime by account, household and the current binding
or generation. Prefer preserving current client-side loading. Any new server
execution uses request-local state and proves concurrent SSR/hydration isolation;
never serialize private or pending-command state by default.

Dispose subscriptions and obsolete reads on teardown. Hide old-context values
and ignore late callbacks and invalidations. Retained unresolved commands keep
their original payload, ID, expected versions and binding outside disposable view
state, under existing matching-context recovery rules. Cancelling a dispatched
mutation is not rollback; a cache partition is not authorization. Preserve each
workflow's existing exclusions rather than inventing a household-global lock.

### Cut over and remove the superseded owner

Complete the profile slice, then the remaining profile and people operations.
Promise-based consumers may use one thin boundary to the same runtime. Keep
feature-specific rejection/recovery meanings; replace structural Cause traversal
only where public Effect APIs preserve characterized behavior, including any
legitimate serialized/wrapped failure seam.

Refresh only relevant canonical data after confirmed success. Preserve unresolved
intent on ambiguous outcomes. Remove migrated Query ownership, duplicate client
construction, obsolete subscriptions and unused exports only when replacement
coverage exists. Unrelated Query consumers remain. A future replicated resource
must not gain another independently mutable atom/Query copy.

## Source and coordination

Inspect both `household-profiles/browser-operations.ts` and
`household-people/browser-operations.ts` under `apps/web/src/features/`, their public
operation contracts/tests, people retained intents and feature panels. Check the
auth boundary/state, `apps/web/src/router.tsx`, `packages/household-api/` and current
manifests. Coordinate shared profile submit/schema and lockfile changes with
[forms and JSON](03-forms-and-json.md).

[Private-client consolidation](02-private-client.md) consumes the delivered runtime
and lifecycle result, not a merged planning PR. #218 is merged; use the resulting
current interfaces rather than the old discovery branch snapshot.

## Acceptance

- [ ] Exact-version generated-client integration passes the real production web
  build without peer suppression; a fallback demonstrably removes repeated runners.
- [ ] Profile read/mutate/refetch and the distinct people operations retain their
  visible success, rejection, authentication and recovery behavior.
- [ ] Canonical rejection remains distinct from unknown commitment; lost results
  retain exact command identity and recovery produces one canonical result.
- [ ] Context change, expiry, teardown and late callbacks cannot expose old values,
  invalidate a new context or clear a newer retained command.
- [ ] Introduced SSR/hydration has concurrent-request isolation and no unintended
  private/pending-state output; disposed reads no longer update the view.
- [ ] Each migrated operation has one cache/runtime owner; obsolete generic code
  is removed and the remaining adapter inventory is explicit.

## Delivery and open questions

Next action: establish the actual source/package baseline and run the complete
profile compatibility slice. Resolve native atoms versus the bounded Query bridge
from that evidence, then continue through people migration and verification.
Compatibility and replay/isolation are unresolved acceptance, not assumed results.

Use affected web/API/shared-contract tests, a real generated-client failure request,
an actual local browser and production builds, plus the current repository checks.
At completion, retain exact tested heads, commands/results, selected composition,
removed/remaining responsibilities and limitations here. Promote reusable current
behavior to the owning reference instead of adding a handoff or status ledger.
Rollback reverts the bounded cutover; no dual writes or persistence migration are
expected. This record currently claims planning review, not runtime proof.

## Proposal provenance

This record replaces the two overlapping work-item layouts, preserving their
technical scope and immutable history. The original baseline was
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`; its workflow/permission pointers and
package observations are not current instructions.

- [Original #219 proposal](https://github.com/cill-i-am/meal-planner/blob/53d249715b6d530d38951ed257d23e59970ba05b/docs/delivery/library-consolidation/01-effect-browser-runtime.md).
- [Original #220 proposal](https://github.com/cill-i-am/meal-planner/blob/a6adfe00f6c887367e2dea79629f9f1a03cb13db/docs/delivery/library-consolidation/01-effect-browser-integration.md).

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

- [ ] The real generated-client profile read/mutate/refetch path renders loading,
  errors and canonical success in a local browser. Roster, invitation, departure
  and profile recovery retain their distinct results and existing exclusions.
- [ ] A sole decoded canonical rejection is definitive, displayed and single-attempt;
  authentication-required remains distinct. Transport/5xx/decode failures, defects,
  interruption and mixed Causes retain unknown commitment where it is unproven.
  The bridge never classifies solely from the first failure in a mixed Cause.
- [ ] Inject loss after a server commitment and malformed success/error bodies through
  the real generated HTTP client. Original payload, mutation ID, expected versions
  and binding survive; matching-context replay returns one canonical result without
  a replacement ID or an application-added automatic mutation retry.
- [ ] While a command is unresolved, existing sibling exclusions hold. Edit the draft
  and start a later eligible command in a new context: an older completion cannot
  clear the newer retained intent, change its payload or invalidate unrelated data.
- [ ] Expiry, sign-out and account/household switches hide old data. Re-admission
  recovers only matching original intent; delayed reads, mutations and invalidations
  cannot cross the binding/generation boundary, including after remount.
- [ ] Teardown disposes subscriptions and interrupts obsolete reads without view
  updates or unhandled work. Cancelling a dispatched mutation preserves its unknown
  outcome and recovery instead of treating browser abort as server rollback.
- [ ] Any introduced SSR/hydration proves isolation using simultaneous identities and
  distinct registries/caches; no private or pending-command value enters unintended
  serialized output and browser globals are not used during server evaluation.
- [ ] Resolved package versions, exports and peers compile in the production web
  build with no suppression. Native atoms or the documented Query fallback supplies
  one tested execution boundary; unrelated Query consumers continue to work.
- [ ] The final inventory names removed runners, client construction, subscriptions,
  Cause plumbing and obsolete cache ownership, plus remaining adapters and genuine
  domain seams. Equivalent behavioral coverage survives deletion; both alternatives
  and duplicate authoritative caches are not left running.

### Verification at the changed seams

Characterization tests establish the old behavior before the pilot; then exercise
the same failure corpus at the replacement's public operation boundary. Mock-only
atom tests do not prove generated-client decoding, browser lifetime or server replay.
Use a real local request/response failure case and actual browser journey, adding
native/API/shared-contract tests where the changed boundary needs them.

Discover targeted suites and required commands from the current manifests/CI and
[local development guide](../../how-to/local-development.md). Finish with the real
production build and repository-required checks; after intentional dependency
changes, verify the resulting lockfile with a frozen install. Use synthetic
households/invitations rather than dispatching real notifications or calling a paid
provider. Record unexecuted scenarios explicitly, not as inferred passes.

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

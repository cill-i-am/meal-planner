# Share the browser's Effect setup

Status: proposed
Owner: unassigned
Delivery: working profile and people screens using one tested setup, with the fallback if needed

## Outcome and context

Keep the existing people and profile behavior while removing repeated Effect
client Layers, Promise runners, and error handling. Each migrated operation should
have one owner. Adding a wrapper around both old implementations is not enough.

The [review sequence](README.md) splits the approach and its detailed checks
between two PRs. They edit this same plan. Package observations from September 16
are historical; use the implementation checkout's manifests, lockfile, source,
and tests to establish the starting point.

## Scope

First make one complete profile flow work: read, save, and refresh from the server.
Then migrate the other profile and people operations, including the roster,
invitations, and departure. Keep the generated Effect HTTP contracts, household
writes, and recovery that retries the exact original command.

Inspect household and import adapters too, but change them only where the shared
setup requires it within this scope. List the adapters left unchanged; do not
claim that the whole app has migrated.

Do not replace HTTP with RPC, roll out LiveStore, change authentication or storage,
change interview behavior, build a universal frontend service framework, or remove
unrelated Query uses. The [household contract](../../reference/household.md) and
[people API](../../reference/household-people-api.md) define behavior to preserve.

## Approach and trade-offs

### Prove one working flow first

Record how existing operations return results, which caches own their data, and
how unresolved requests are saved. Run a real generated HttpApi profile read and
write through the installed `AtomHttpApi` and compatible React bindings. Check the
actual exports, peer dependencies, resolved versions, and production web build.
Test how that version exposes HTTP failures, decoding errors, defects, and
interruption. A type signature or upstream example cannot prove that it preserves
the full Effect Cause.

Prefer native atoms when the full flow works without suppressing peer checks,
copying library internals, or upgrading the whole stack. Otherwise keep Query and
share one account/household-scoped Effect runner and error adapter. Record the
failing case and the chosen fallback here. The fallback must remove the repeated
runners too. An unfinished experiment, or leaving both options running, is not a
completed change.

Record routine integration choices in this plan. Create a separate decision
record only for a consequential architecture choice.

### Separate screen lifetime from saved commands

Scope the browser registry and runtime to the account, household, and current
binding or generation. Prefer keeping client-side loading. If adding server
execution, use per-request state and test simultaneous server rendering and
hydration for different users. Do not serialize private data or pending commands
by default.

When a screen is disposed, remove subscriptions and cancel obsolete reads. Hide
old-context data and ignore late results or cache invalidations. An unresolved
command must keep its original payload, ID, expected versions, and binding outside
the disposable screen state. Recover it only under the existing matching-context
rules.

Cancelling a sent request does not undo a server write. A cache key does not grant
access. Keep each workflow's existing rules for which actions can run while
another is unresolved; do not add a lock across the whole household.

### Replace the old code, then remove it

Finish the profile flow, then the other profile and people operations. Promise
consumers may use one thin adapter to the same runtime. Keep each feature's
rejection and recovery behavior. Replace manual Cause traversal only when public
Effect APIs preserve the tested behavior, including any legitimate serialized or
wrapped failure interface.

After confirmed success, refresh only the affected server data. When the result is
unknown, keep the original saved request. Once replacement tests cover the
behavior, remove its old Query ownership, repeated client creation, obsolete
subscriptions, and unused exports. Leave unrelated Query consumers alone. A
future replicated resource must not also have separate writable copies in atoms
or Query.

## Source and coordination

Start with `household-profiles/browser-operations.ts` and
`household-people/browser-operations.ts` under `apps/web/src/features/`. Read their
public operation contracts and tests, people saved-request handling, and panels.
Check auth state, `apps/web/src/router.tsx`, `packages/household-api/`, and the
manifests. Coordinate shared profile submission, schemas, and lockfile edits with
[forms and JSON](03-forms-and-json.md).

The [private-client work](02-private-client.md) needs the working runtime and its
lifetime rules, not just a merged plan. #218 is merged: use its resulting
interfaces, not an old discovery-branch snapshot.

## Acceptance

- [ ] The generated-client integration works with the resolved package versions in
  the production web build, without suppressing peer checks. A fallback removes
  repeated runners rather than just wrapping them.
- [ ] Profile read/save/refresh and each people operation keep their success,
  rejection, sign-in, and recovery behavior.
- [ ] A confirmed server rejection stays distinct from an unknown write result.
  Lost replies retain the exact command; recovery returns one server result.
- [ ] Context changes, expiry, disposal, and late callbacks cannot show old data,
  invalidate a new context, or clear a newer saved command.
- [ ] Any added server rendering and hydration isolate concurrent requests and
  expose no unintended private or pending-command data. Cancelled reads no longer
  update the screen.
- [ ] Each migrated operation has one cache/runtime owner. Remove replaced generic
  code and list the adapters that remain.

## Delivery and open questions

Start by checking the source and packages and running the complete profile pilot.
Use those results to choose native atoms or the shared Query adapter. Then finish
the people migration and its checks. Package fit and replay/isolation behavior
remain to be proved.

Use affected web, API, and shared-contract tests, a failure sent through the real
generated HTTP client, a local browser, production builds, and required repository
checks. Record tested commits, commands and results, the chosen setup, what was
removed, what remains, and any limits here. Put reusable behavior in the relevant
reference rather than another handoff or status document.

A rollback reverts this code change. No dual writes or storage migration are
expected. This plan does not claim that runtime checks have passed.

## Original proposals

This plan replaces two overlapping September 16 proposals. Their original base
was `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. The links retain their technical
scope and history, not instructions to use old packages or retired workflow rules.

- [Original #219 proposal](https://github.com/cill-i-am/meal-planner/blob/53d249715b6d530d38951ed257d23e59970ba05b/docs/delivery/library-consolidation/01-effect-browser-runtime.md).
- [Original #220 proposal](https://github.com/cill-i-am/meal-planner/blob/a6adfe00f6c887367e2dea79629f9f1a03cb13db/docs/delivery/library-consolidation/01-effect-browser-integration.md).

# Consolidate remaining private-client state

Status: proposed
Owner: unassigned
Depends on: [delivered browser runtime](01-browser-runtime.md)
Delivery: verified removal of remaining generic client-state duplication without changing private authority

## Outcome and context

Adults can start, resume and complete private discovery, review cards and recover
interrupted commands while the browser maintains less bespoke subscription state.
Private history, explicit profile confirmation and exact-command recovery retain
their existing meaning.

The original proposals also planned TanStack chat adoption. That work is already
merged in [#218](https://github.com/cill-i-am/meal-planner/pull/218), on September 19,
2026, using base Agent sessions and published TanStack packages. This outcome is
remaining client-state consolidation, not another chat migration. The merge did
not establish deployment or complete the broader discovery evaluation gates.

[Private-discovery reference](../../reference/private-discovery.md) owns current
contracts; [ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md)
owns the consequential authority decision. Use their current meaning rather than
restoring the old proposals' plain-session runtime or custom package patches.

## Scope

Inventory and simplify connection/session selection, pagination, cards, derived
control state, profile refresh and generic subscriptions in the actual client.
Keep one supported connection adapter and domain command/recovery seam where they
are needed. Remove only machinery still present and actually superseded.

Exclude model/provider changes, prompt or retry-policy changes, new discovery
features, accounting rewrites, transcript replication, a second chat database,
persistence cutovers and LiveStore rollout. Existing SDK retry behavior remains
owned by discovery; this refactor adds no application retry or automatic new turn.

## Approach and trade-offs

### Keep one owner for each kind of state

| Concern | Owner after consolidation |
| --- | --- |
| Local and derived control state | The compatible shared browser runtime/state composition |
| Chat presentation and in-flight messages | The existing published TanStack integration |
| Durable private history and canonical message identity | The admitted private session and its transactions |
| Confirmed profile facts, versions and receipts | Household authority |
| Unresolved exact commands | Existing identity-bound retention, independent of disposable view state |

Inspect the current client and consumers before extraction. Replace listener,
snapshot or fan-out plumbing only where the chosen library genuinely takes over.
Do not replace it with a new generic event bus or independently mutable transcript
copies in atoms, Query and the SDK. Provisional/private cards remain distinct from
confirmed Household data.

Reuse the [browser outcome's](01-browser-runtime.md) delivered registry/lifetime and
package result. A Query fallback does not prove atom bindings work: resolve any
actual compatibility gap in the shared composition rather than installing another
Effect version or creating a parallel runtime. Provider-free characterization can
proceed independently of that production-state cutover.

### Preserve admission, recovery and publication

Use current supported SDK interfaces and the existing validated event mapping.
Preserve one intended connection/lifetime and canonical reconciliation by durable
identities. Client message arrays, optimistic IDs and run completion do not establish
server history, admission or Household commitment. Reconnect joins/replays existing
work; it is not permission for another inference or a new command identity.

Keep every private payload, including buffered and replayed output, behind the
native physical-send fence. No parent bridge, transcript HTTP/RPC response or SDK
synchronization shortcut may bypass it. Accepted model output remains behind the
current schema/policy and persistence boundary; rejected tokens, tool arguments or
internal content must never appear transiently or durably. Preserve actual current
size/order/cursor rules instead of reviving deleted parser limits.

Retained intent survives permitted matching-context recovery, not arbitrary remounts
under another identity. Storage failure must be visible before unsafe dispatch.
Disconnect, Stop, unmount and authority loss are distinct: local cancellation proves
neither upstream cancellation nor rollback. Old frames and callbacks cannot update a
new context or clear its newer command. Completion still waits for canonical profile
confirmation, including current-version and explicit safety requirements.

## Source and coordination

Inspect `apps/web/src/features/private-interviews/`, its current client/panel/card
consumers and tests; `packages/private-interview-api/`; and
`apps/api/src/features/private-output/`, including production session/output classes
and persistence, admission, reconnect and confirmation tests. Trace the published
adapter actually used after #218 rather than constructing one from old examples.
Coordinate profile schemas, forms, registry composition and lockfile changes with
[runtime](01-browser-runtime.md) and [forms](03-forms-and-json.md).

## Acceptance

- [ ] The actual React/client integration supports start, rediscover, history
  pagination, resume and completed read-only history with canonical order, cursor
  bounds and participant identity. Optimistic IDs cannot replace durable identities.
- [ ] Mount/unmount, remount and two consumers create only the intended connections
  and submissions, with no leaked listeners, fibers or alternate writable transcript.
- [ ] Loss after participant append, assistant acceptance or profile confirmation,
  followed by restart/reconnect, preserves the original payload/ID/versions and
  produces one canonical result. Reconciliation does not resubmit history as trusted
  input, regenerate a turn, duplicate a record or add an application retry; installed
  SDK retry/accounting behavior is unchanged rather than falsely claimed single-attempt.
- [ ] Delayed/ambiguous confirmation cannot be mistaken for failure or success.
  Completion remains blocked until canonical settlement; an SDK terminal event cannot
  settle Household state or clear a newer retained command.
- [ ] Correction, rejection, refreshed review, provisional facts and safety reductions
  preserve explicit current-version consent. A kind/target or card-revision change
  cannot reuse stale confirmation or promote a private proposal to a shared fact.
- [ ] Another participant, adult or household is denied directory/session/history,
  output and recovery access through the real admission boundary. Private values stay
  out of shared caches, unintended SSR/hydration and telemetry.
- [ ] Pause output after buffering but before physical send; invalidate admission via
  sign-out, passive expiry, departure or unlink, then release it. Native production
  classes send no private bytes after the fence closes. Repeat relevant restart and
  re-admission cases rather than treating a mocked WebSocket as proof of adjacency.
- [ ] Account/household/session change hides old private UI; delayed callbacks and
  queued events cannot repopulate the new context, including after remount or while
  a newer exact command is pending.
- [ ] Malformed, oversized, unexpected or interrupted events fail under the current
  contract. Rejected model output never becomes transient or durable history; no
  repair, hidden success, alternative transcript route or fabricated token streaming
  is introduced to accommodate a library helper.
- [ ] Unavailable browser recovery storage is visible before any command requiring
  retention is dispatched. Stop, disconnect and unmount release owned resources
  without discarding permitted recovery or asserting upstream cancellation/rollback;
  late producer results cannot commit after the application's terminal boundary.
- [ ] Installed SDK/React types, production web/Worker bundles and affected contract
  tests pass. The removal inventory shows genuine generic simplification while
  retaining native admission, domain commands and canonical history/receipts.

### Evidence and limits

Use synthetic fixtures through an actual browser and the pinned local
workerd/Miniflare production classes. Cover both visible flows and native persisted
state, especially the buffered-send race, lost acknowledgements, retained commands
and canonical profile confirmation. Component mocks supplement those checks; they
do not establish native output fencing or durable replay.

Discover exact suites and commands from current manifests/CI and the
[local development guide](../../how-to/local-development.md). Record tested heads,
fixtures and results without real customer transcripts, tokens or private evidence.
Existing #218 evidence is baseline provenance, not a pass for a changed client.
Synthetic provider tests establish integration behavior, not model quality, final
provider usage or success of the outstanding family/candidate evaluation.

## Delivery and open questions

Next action: inventory the post-#218 client, characterize the current behavior and
match remaining generic state to the delivered runtime pattern. Continue through
consumer cutover, deletion and native/browser verification for the assigned scope.
An unresolved runtime compatibility issue blocks its dependent cutover, not safe
independent characterization; record the exact failing interface or fixture here.

Use synthetic providers with the real browser and workerd/Miniflare production
classes, including invalidation between buffering and final send. Run affected
contracts/confirmation tests, builds and repository checks. Record actual tested
heads, removed/retained responsibilities and unresolved acceptance in this plan;
promote reusable knowledge to the private-discovery reference, not another handoff.
A state refactor or synthetic transport test does not complete the separate
[discovery evaluation and tone work](../private-discovery/03-adaptive-discovery-and-evaluation.md).
Revert a bounded state cutover without rewriting durable history or undoing #218.

## Proposal provenance

This is the single successor to the overlapping September 16 proposals. Their
baseline `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`, then-unmerged #218 assumptions,
permission pointers and migration instructions are historical, not current policy.
The [review sequence](README.md) keeps proposal and acceptance edits in this record.
No remaining client consolidation or runtime proof is claimed by this planning edit.

- [Original #221 proposal](https://github.com/cill-i-am/meal-planner/blob/5f2c027701de565d7763041e72c69396d3f2d082/docs/delivery/library-consolidation/02-private-interview-client-and-streaming.md).
- [Original #222 proposal](https://github.com/cill-i-am/meal-planner/blob/027c4b66c19e67a4512fd30334d8471fe063456f/docs/delivery/library-consolidation/02-private-interview-state-and-streaming.md).

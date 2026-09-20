# Consolidate remaining private-client state

Status: proposed
Owner: unassigned
Depends on: [delivered browser runtime](01-browser-runtime.md)
Delivery: a separately assigned, verified implementation or bounded no-adoption result

## Outcome and current baseline

Reduce generic browser subscription machinery without changing participant
privacy, durable history, explicit profile confirmation or exact-command recovery.
The original proposals also planned TanStack chat adoption. **That adoption has
already landed in #218** with base Agent sessions and unmodified TanStack packages.
Recheck the current implementation and remove only remaining duplicate plumbing;
do not rebuild the old migration or restore plain-session DOs, custom patches or
an obsolete producer. [Current private-discovery contract](../../reference/private-discovery.md)
and [ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md)
own those boundaries.

## Approach and scope

Inventory control state, cards, connection state, retained commands, history and
in-flight messages. Reuse the proven [browser runtime](01-browser-runtime.md) for
appropriate local/derived state. TanStack owns its existing chat presentation;
the session owns durable history; Household owns confirmed facts. Do not maintain
independently mutable transcript copies in atoms, Query and SDK state, or replicate
private transcripts into household LiveStore.

Use supported installed SDK interfaces. Preserve one intended connection/lifetime,
validated event translation and canonical reconciliation. Keep the physical-send
fence adjacent to output; no parent bridge, public private body, transcript RPC or
SDK synchronization shortcut. Reconnect joins/replays existing work without another
inference or duplicate command. Disconnect, explicit Stop and authority loss remain
distinct; local cancellation does not prove upstream cancellation.

Unvalidated tokens, tool arguments and schema/policy-rejected output cannot appear
as transient or durable conversation. Preserve size/order/cursor bounds and current
acceptance semantics, not obsolete custom-parser limits. No model/provider changes,
new prompt policy, accounting rewrite, second chat database or persistence cutover.
Retain the necessary narrow custom admission/recovery seam even when an SDK offers
a superficially similar shortcut.

## Source and coordination

Inspect `apps/web/src/features/private-interviews/`, `packages/private-interview-api/`,
`apps/api/src/features/private-output/`, actual chat persistence/reconnect tests,
profile confirmation and the current published adapter. Coordinate shared schemas,
forms, registry composition and lockfile. A delivered runtime is the dependency;
provider-free characterization can proceed without a live quality evaluation.

## Acceptance

- [ ] Start, rediscover, paginate, resume and complete preserve ordering, participant
  identity and completed read-only history in the actual browser/native runtime.
- [ ] Mount/unmount and multiple consumers leak no subscriptions/fibers and create
  no unintended duplicate connection or submission.
- [ ] Lost append/confirmation replies, restart and reconnect preserve exact
  payload/ID/version and yield no duplicate message, inference or confirmed fact.
- [ ] Pending confirmation blocks completion until the canonical result is settled;
  SDK run completion is not proof of Household commitment.
- [ ] Correction/rejection, safety reduction and refreshed review preserve explicit
  consent, provisional/private meaning and canonical authority.
- [ ] Another adult/household cannot access directory, session, history or recovery;
  no private content enters shared caches, SSR/hydration or telemetry.
- [ ] Buffered output, passive sign-out, expiry, departure, unlink and restart obey
  the current native fence. Old frames/callbacks cannot repopulate a new context
  or clear a newer pending command, including after remount.
- [ ] Malformed/oversized/unexpected events fail visibly without repair, hidden
  retries or optimistic persistence success; rejected model content stays absent.
- [ ] Unavailable browser recovery storage is visible and does not dispatch unsafe
  commands or silently discard retained intent. Stop/unmount cleans owned resources.
- [ ] The actual installed React/SDK integration and production bundles work;
  removed generic code is no longer a parallel owner. Quality/evaluation remains
  a separate unmet obligation where the discovery plan says so.

Use actual browser plus workerd/Miniflare production classes with synthetic
providers, especially invalidation between buffered production and final send.
Run affected contracts/confirmation tests and required CI. No paid eval, deployment
or real private transcript is needed. Missing integration evidence is not completion.


## Proposal provenance

Consolidated from the overlapping planning PRs below. Those PRs remain open and
unchanged; this is the owning proposed scope on the refactor branch, not evidence
of implementation or dependency compatibility. The original planning baseline was
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`; recheck actual source/versions when
assigned. #218 has since merged. Old first-pass/handoff instructions and the
then-current plain-session runtime assumption are not new implementation rules.

- [#221 source](https://github.com/cill-i-am/meal-planner/blob/5f2c027701de565d7763041e72c69396d3f2d082/docs/delivery/library-consolidation/02-private-interview-client-and-streaming.md), head `5f2c027701de565d7763041e72c69396d3f2d082`.
- [#222 source](https://github.com/cill-i-am/meal-planner/blob/027c4b66c19e67a4512fd30334d8471fe063456f/docs/delivery/library-consolidation/02-private-interview-state-and-streaming.md), head `027c4b66c19e67a4512fd30334d8471fe063456f`.

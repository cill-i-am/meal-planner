# Simplify private interview state

Status: proposed
Owner: unassigned
Depends on: [completed browser setup](01-browser-runtime.md)
Delivery: a checked implementation, or a tested decision not to adopt the proposed integration

## Outcome and current baseline

Remove duplicated browser subscription code without changing privacy, saved
history, explicit profile confirmation or recovery of an interrupted request.
The original proposals included TanStack chat adoption. **That work already landed
in #218**, using base Agent sessions and unmodified TanStack packages.

Inspect what remains before editing. Do not repeat that migration or restore plain
session Durable Objects, custom patches or an obsolete message producer. Follow the
[private-discovery rules](../../reference/private-discovery.md) and
[ADR-0004](../../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md).

## Approach and scope

List who manages control state, cards, connections, saved requests, history and
messages still arriving. Reuse the checked [browser setup](01-browser-runtime.md)
for suitable local and derived state. TanStack manages chat presentation, the
session stores durable history, and Household stores confirmed facts. Do not keep
independently editable transcript copies in atoms, Query and SDK state, or copy
private transcripts into household LiveStore.

Use supported APIs from the installed SDK. Keep the intended connection and its
lifetime, validate event conversions, and reconcile the UI with saved server state.
Keep access checks immediately next to the physical send. Do not add a parent
forwarding bridge, private HTTP body, transcript-returning RPC or SDK state-sync
shortcut. Reconnect to existing work instead of starting another inference or
sending a duplicate command. Disconnect, explicit Stop and loss of access are
different events. Local cancellation does not prove the provider stopped.

Unvalidated tokens, tool arguments and rejected model output must not appear in
live or saved conversation history. Preserve size, order and cursor limits and the
current acceptance rules, not obsolete custom-parser limits. Keep the small custom
access and recovery adapter where the SDK cannot provide the same behavior.

This work does not change models, providers, prompts, accounting or storage. It
does not add a second chat database or move persisted data.

## Source and coordination

Inspect `apps/web/src/features/private-interviews/`, `packages/private-interview-api/`,
`apps/api/src/features/private-output/`, chat persistence and reconnect tests,
profile confirmation and the published adapter. Coordinate changes to schemas,
forms, registry setup and the lockfile. The completed browser setup is required,
but provider-free tests of existing behavior can start before live quality evaluation.

## Acceptance

- [ ] Start, rediscover, paginate, resume and complete work in a real browser and
  native runtime, preserving order, participant identity and read-only completed history.
- [ ] Mounting, unmounting and multiple consumers leak no subscriptions or fibers
  and do not create unintended duplicate connections or submissions.
- [ ] Lost append or confirmation replies, restart and reconnect keep the same
  payload, ID and version. They create no duplicate message, inference or confirmed fact.
- [ ] Resolve a pending confirmation against the saved Household result before
  completing. SDK run completion is not proof that Household saved a change.
- [ ] Correction, rejection, reducing a safety restriction and renewed review keep
  explicit consent and the difference between a private proposal and a confirmed fact.
- [ ] Another adult or household cannot access the directory, session, history or
  recovery data. Private content stays out of shared caches, SSR, hydration and telemetry.
- [ ] Buffered output, passive sign-out, expiry, departure, unlink and restart obey
  native access checks. Old frames or callbacks cannot refill a new context or clear
  a newer request, including after remount.
- [ ] Malformed, oversized or unexpected events fail visibly, without repair, hidden
  retries or an unproven save-success message. Rejected model content stays absent.
- [ ] If browser recovery storage is unavailable, show the failure. Do not dispatch
  unsafe commands or discard the saved request silently. Stop and unmount clean up
  resources they own.
- [ ] The installed React/SDK integration and production bundles work. Removed code
  no longer manages a parallel copy of state. Unfinished quality evaluation remains
  open in the discovery plan.

Use a real browser and workerd/Miniflare production classes with synthetic providers.
In particular, invalidate access after output is buffered but before it is sent.
Run affected API and confirmation tests and required repository checks. Synthetic
integration tests do not replace live model evaluation, and no paid evaluation or
deployment is part of this cleanup.

## Original proposals

These proposals were written against
`c07e48c6f6709f02c054e5110cb7178a9e5d1b93`. The linked commits preserve that
history; they do not prove that the work or package compatibility checks are done.
Check current code and versions when starting implementation. #218 has since
merged, so do not repeat its migration or restore its old private-session design.
Historical handoff instructions do not override a new implementation assignment.

- [#221 source](https://github.com/cill-i-am/meal-planner/blob/5f2c027701de565d7763041e72c69396d3f2d082/docs/delivery/library-consolidation/02-private-interview-client-and-streaming.md), head `5f2c027701de565d7763041e72c69396d3f2d082`.
- [#222 source](https://github.com/cill-i-am/meal-planner/blob/027c4b66c19e67a4512fd30334d8471fe063456f/docs/delivery/library-consolidation/02-private-interview-state-and-streaming.md), head `027c4b66c19e67a4512fd30334d8471fe063456f`.

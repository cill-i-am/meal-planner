# Phase 2 — Library-backed private interview state and streaming

- Status: Proposed; implementation not started.
- Owner: Next assigned implementation agent, coordinated with the discovery owner.
- Planned: 2026-09-16.
- Planning baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Track: Library consolidation, separate from product Stage 2.
- Prerequisite: [Phase 1 runtime decision, PR #219](https://github.com/cill-i-am/meal-planner/pull/219).
- Delivery authority: Planning documents and open PRs only in this change.
  Application implementation begins when assigned under the existing
  [execution policy](../../agents/execution-policy.md).

## Outcome and scope

An adult can start, resume, converse, review cards, confirm permitted changes,
and read completed private history with the same privacy and replay guarantees.
Generic browser subscription and chat-message machinery is supplied by the
chosen Effect atom integration and TanStack AI rather than one large custom
observable client.

Deliver two bounded slices under this work item: first separate non-chat state
and command rules from the external-store machinery; then integrate TanStack
AI's client over the admitted private channel. The user already plans TanStack
AI. This work item supplies the migration boundaries, not a competing agent or
model framework.

Keep the native private children, final-send authorization, server history,
closed domain commands, exact mutation receipts, version checks, and explicit
safety confirmation. Do not move transcripts to a household-wide LiveStore
replica, enable transcript-returning HTTP/RPC, replace native children with SDK
state synchronization, or rewrite provider accounting and discovery policy.

## Accepted direction

These records remain authoritative:

- [Stage 2 private discovery](../stages/02-private-discovery/README.md).
- [Private-output safety](../private-output-safety.md).
- [ADR-0004: coordinators and isolated private children](../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md).
- [Cards and explicit confirmation](../stages/02-private-discovery/02-progressive-cards-and-confirmation.md).
- [AI evaluation evidence](../../decisions/product/0006-ai-evaluation-and-release-evidence.md).
- [Repository workflow](../../agents/repository-workflow.md).

### Source map and actual implementation status

At the planning baseline, inspect:

- `apps/web/src/features/private-interviews/private-interview-client.ts`:
  listener set, view snapshot, sockets, pagination, retained commands, and
  confirmation bookkeeping.
- `private-interviews-panel.tsx`, `private-profile-cards.tsx`,
  `private-card-correction.tsx`, `private-profile-browser.ts`, and associated
  tests in the same feature directory.
- `apps/api/src/features/private-output/private-interview-session.ts`,
  `private-interview-directory.ts`, `private-output-socket.ts`,
  `private-output-worker.ts`, and `private-output.http.ts`.
- `packages/private-interview-api/`: public private-channel commands and frames.
- `apps/api/src/features/private-output/private-output.integration.test.ts` and
  household-boundary native tests: privacy, persistence, and confirmation proof.

Main's private-session implementation has no production assistant producer.
[Draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218) contains later
adaptive-discovery work; the head observed here is
`2fd5d7f315bf98de10d74792b2269f8f020e1f76`. Its work item remains in progress
and does not claim successful current model acceptance. Read its current work
item and deterministic discovery contract before touching the producer or wire.
Do not mistake old main for the complete current discovery implementation.

## Dependencies and coordination

Consume Phase 1's verified registry lifetime and Effect package decision. If
native atoms were not compatible, resolve the recorded atom blocker before
starting the atom-specific slice; do not quietly introduce a second version of
Effect or another state framework. Safe contract/test preparation may proceed.

The active #218 owner controls overlapping private-session, contract, and UI
files until its disposition is agreed. Inspect its latest head/diff and the
already-planned TanStack AI work before implementation. Consume merged work or
an explicitly agreed dependency head; never rebase or overwrite that branch on
another owner's behalf. Do not recreate its discovery implementation from main.
Keep one writer for shared files and the workspace lockfile.

The final integration must be tested against the actual accepted discovery
implementation. Provider-free state/adapter work can be completed independently;
that does not close #218's model-evaluation gates. Phase 3's private correction
form changes must use the resulting submit boundary rather than edit it in
parallel.

## Implementation sequence

### 1. Inventory responsibilities and freeze behavioural contracts

Record the actual starting head, producer availability, selected package
versions, current frames, browser-retention format, and existing tests. Assign
one owner to each concern:

- Effect atoms: connection/session selection, pagination, profile reads,
  pending-confirmation presentation, and other non-chat/derived UI state.
- TanStack AI: the transient chat client and presentation of accepted message
  events. Do not maintain a second independently writable message list in atoms.
- Existing server and domain code: authority, transcript persistence, command
  acceptance, receipt identity, canonical profile mutation, and reconciliation.

Keep simple feature functions for domain decisions; do not replace the large
class with a generic custom state-machine or event-bus framework. Characterize
current error, history ordering, cursor, storage-failure, and retry behaviour.

### 2. Replace the hand-rolled external store

Remove the listener set, snapshot/subscribe API, and manual fan-out updates as
consumers move to the compatible native atom bindings. Keep one context-scoped
registry, with stable identities and derived selectors. Register socket,
subscription, and pending request cleanup against that context.

Extract only the necessary command functions and a thin private connection
adapter. Domain functions still check admitted binding, session status, profile
version, card revision, and pending-command exclusion. A small protocol adapter
is intentional; library adoption must not dissolve a security boundary.

Preserve identity-bound retained commands independently of mounted atom state.
Storage unavailability must remain visible. Do not dispatch an operation that
requires durable browser retention when retention failed. Sign-out removes
rendered private data and closes the old context while preserving only the
existing permitted recovery material for correct re-admission.

### 3. Prove TanStack AI compatibility at the private channel

Check installed exports and peer requirements for `@tanstack/ai`, its client,
and React bindings. Compile the adapter against those exact versions. Use the
built-in WebSocket adapter only if it can preserve the current admission and
physical-send fence without routing sensitive frames around it. Otherwise use
the documented persistent connection-adapter interface with one narrow bridge.
Do not add SSE/transcript HTTP as a convenience fallback.

Map accepted domain events into supported library events, including stable
message/run identity, start, content, terminal success, and terminal failure.
Document that mapping against the installed API. Directory/card/receipt frames
remain domain protocol, not fabricated model tool calls. Reconnect correlation
is not a mutation receipt and must never mint a new domain command.

The server reconstructs history and authority from retained state; client-sent
SDK message arrays, tool results, run IDs, or session IDs are not trusted
history, authorization, or permission to mutate a profile.

### 4. Preserve validated-output publication

Do not stream raw tokens, partial forced-tool arguments, internal notes, or
unvalidated model output merely because TanStack AI supports streaming. In the
current discovery direction, model proposals must pass the owning closed
schema/policy and accepted persistence/publication boundary before presentation.
Rejected output must never appear briefly in the UI or be saved as chat history.

Where the producer yields only an accepted complete reply, render it through
the library as an accepted completed turn. Do not invent token-level streaming
or delay characters to claim the backend streams. Token-level publication that
changes the validation boundary is outside this refactor.

Every private payload, including replay and buffered terminal frames, must pass
through the current generation/expiry/revocation check at the native physical
send. No asynchronous SDK buffer, broadcast, parent read, or alternate channel
may release already-queued private bytes after invalidation. Preserve the
native restart/reauthentication behaviour unless an independently proved,
explicitly accepted change replaces it.

### 5. Integrate lifecycle and canonical reconciliation

Connect chat presentation to the existing admitted participant-message command
and durable history. Reconcile optimistic display, acknowledgements, and replay
using server identities so reconnect or refresh cannot duplicate a message.
Old-session callbacks must not mutate the newly selected session.

Distinguish cancelling the visible run from cancelling the subscription and
from undoing a committed message/confirmation. Abort is not proof of rollback or
zero provider cost. Do not automatically retry an unknown provider operation
or unresolved mutation. Reuse exact retained commands and existing explicit
retry paths. Keep safety reductions explicitly confirmed and stale profile
reviews invalid. Session completion still waits for submitted confirmations
to settle under the existing rules.

### 6. Remove superseded machinery and verify the integrated path

Delete obsolete observable-store methods, duplicate chat state, replaced message
assembly, unused socket glue, and imports after all consumers use the new path.
Do not remove frame size/shape checks, private retention/replay, generation
checks, authoritative history, or domain policy to improve a deletion count.

Record the new ownership map, remaining thin adapter, protocol mapping,
package versions, removed helpers, and changes to architecture documentation
where necessary. No permanent dual client or dual-write migration is intended.

## Acceptance evidence

| Scenario | Required evidence |
| --- | --- |
| Start, rediscover, paginate, resume, complete | Real browser plus native session tests retain ordering, identities, completed read-only history, and current cursor behaviour. |
| Loss after participant append or confirmation | Exact payload/ID recovery produces one canonical result; SDK retries do not generate duplicate domain commands. |
| Private correction and safety change | Proposed cards remain private; canonical writes require current authority, version/review and explicit safety confirmation. |
| Pending confirmation then completion | Existing reconciliation completes or visibly blocks; library run completion cannot masquerade as Household commitment. |
| Cross-adult/household access | Native tests deny unauthorized reads/writes and no private data enters shared caches, SSR output, or telemetry. |
| Passive sign-out, expiry, departure, or unlink | Existing revocation tests plus buffered/in-flight frame tests show no subsequent native private send. |
| Context change during load or stream | Old frames and late callbacks cannot appear in the new account/household/session or clear its pending command. |
| Malformed/oversized/rejected output | Bounds remain enforced; schema/policy-rejected model content never becomes transient or durable UI history. |
| Stop, disconnect, unmount, restart | Correct run/subscription cleanup, retained committed history, no unhandled resources, no inferred rollback or free retry. |
| Failed or unavailable browser storage | Explicit visible failure; no unsafe command dispatch or silent loss of the original recovery intent. |
| TanStack integration | Actual installed library client consumes adapter events; compile and production web/Worker bundle checks pass. |
| Discovery regression | Existing accepted discovery contracts and evaluation evidence remain distinct; transport fixtures do not claim semantic model acceptance. |

Run affected web and shared-contract suites, native private-output and household
integration tests, then required `pnpm check`, `pnpm lint`, `pnpm format:check`,
`pnpm build`, and broader CI gates for dependency/wire changes. Inspect scripts
first. Exercise the real local browser and workerd/Miniflare persistence seam;
synthetic providers are appropriate for deterministic transport and failure
proof, but not evidence of real provider quality. Obtain independent
immutable-head review of privacy and replay before an authorized merge.

Live provider calls, paid evaluations, deployment, and cloud changes require
separate effect/target authorization under repository policy. This plan neither
spends a provider budget nor authorizes merging #218.

## Implementation constraints

Keep Cloudflare Agents and Effect as the selected execution stack, while
respecting the existing plain-native private child design. Adopting TanStack AI
for the browser does not require replacing the existing Effect/Alchemy model
integration, discovery prompts, provider accounting, or evaluation harness.

If a library helper cannot preserve the last-send fence, retain the narrow
custom connection boundary and explain why. If the accepted producer is not
available yet, finish the provider-free state/adapter evidence and record the
specific integration dependency without claiming the whole phase complete.

Upstream references checked on 2026-09-16; the implementation must verify the
installed versions rather than assume rolling documentation matches them:

- [TanStack AI connection adapters](https://tanstack.com/ai/latest/docs/chat/connection-adapters).
- [TanStack AI WebSockets](https://tanstack.com/ai/latest/docs/resumable-streams/websockets).
- [TanStack AI React API](https://tanstack.com/ai/latest/docs/api/ai-react).

## Agent handoff

When assigned, read Phase 1's actual result and inspect #218 before changing any
private code. Deliver the state split and the TanStack adapter as separately
reviewable implementation slices. Use this work item for scope and evidence;
do not reopen native transport selection or widen model publication rules.
Preserve current discovery work and report the exact integrated head tested.

## Delivery record

- 2026-09-16: Planning-only work item created using the repository template and
  main plus the active discovery work-item status. No application changes,
  compatibility probes, runtime tests, model acceptance, or deployment claimed.

# Work Item — Library Consolidation 02: Private Interview State and Streaming

- Status: Proposed
- Owner: Unassigned; one implementation agent when delegated
- Stage / pull request: Library consolidation, phase 2; planning PR containing this file
- Planning date: 2026-09-16
- Reviewed baseline: `main` at `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`
- Implementation: Not started; no runtime or compatibility proof is claimed

## Outcome and scope

An adult can discover, resume, and complete their private interview, review tentative profile cards, and recover interrupted commands without losing privacy or changing confirmed household facts implicitly. Generic browser subscriptions and conversational stream assembly move to the chosen libraries instead of remaining responsibilities of one large handwritten client.

Use Effect atoms for local/derived control state and TanStack AI for conversational stream/message processing. Retain the existing native private-output boundary and explicit domain command/recovery rules. This completes the already intended TanStack AI direction; it is not a second AI-framework initiative.

This phase does not move transcripts into LiveStore or household-wide synchronization, replace private Durable Objects with SDK sub-agents, change canonical household ownership, introduce a new model/provider loop, rewrite import accounting, or implement new discovery product behavior. No production deployment or paid model evaluation is authorized by this planning task.

## Accepted direction

The controlling sources are [ADR-0004](../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md), [private-output safety](../private-output-safety.md), the [private-discovery stage](../stages/02-private-discovery/README.md), its [session foundation](../stages/02-private-discovery/01-private-session-foundation.md) and [cards/confirmation work item](../stages/02-private-discovery/02-progressive-cards-and-confirmation.md), plus [execution policy](../../agents/execution-policy.md).

ADR-0004 explicitly selects plain native private child Durable Objects after the pinned SDK investigation. `HouseholdAgent` remains an SDK Agent; this does not mean `PrivateInterviewSession` should inherit `Agent`. The private native socket is an intentional security boundary, not legacy streaming plumbing to remove opportunistically.

### Target responsibilities

```text
Existing private directory/session and authoritative durable history
              |
Admitted native connection + final physical-send authorization fence
              |
Small validated transport adapter, not another general AI SDK
              |
       +------+--------------------------+
       |                                 |
Private control events             TanStack AI stream events
       |                                 |
Effect atoms for selection,        ChatClient / React binding for
cards, connection status,          in-flight message assembly and
and derived UI                     conversational presentation
       +---------------+-----------------+
                       |
                    React UI
```

The diagram describes ownership, not a requirement to create two additional network connections. Preserve the directory/session topology unless a measured need requires a separate control/stream channel and the same privacy proof can be established for every output path.

The durable session remains the history authority. TanStack AI's client state is a presentation of that history plus in-flight output; atoms must not maintain a second independently mutable transcript copy. Household profile facts remain authoritative only after the existing confirmed command boundary.

### Source map

- `apps/web/src/features/private-interviews/private-interview-client.ts`: listener/snapshot store, socket dependencies, command recovery, selection, pagination, profile/card orchestration.
- `apps/web/src/features/private-interviews/private-interviews-panel.tsx` and `private-profile-cards.tsx`: consumers and confirmation UI; inspect colocated tests.
- `apps/api/src/features/private-output/private-interview-session.ts` and `private-interview-directory.ts`: native private identity, history, receipts, and lifecycle.
- `apps/api/src/features/private-output/private-output-socket.ts`: generation/expiry checks adjacent to physical WebSocket output.
- `apps/api/src/features/private-output/private-output.integration.test.ts`: existing native boundary evidence to retain and extend.
- `packages/private-interview-api/src/index.ts`: closed shared frame/command contracts; keep runtime validation at the boundary.
- On the open discovery branch, also inspect `private-turn-browser.ts`, `private-response-status.tsx`, and the `private-discovery-*` implementation/tests before changing their responsibilities.

## Dependencies and coordination

[Phase 1 planning PR #220](https://github.com/cill-i-am/meal-planner/pull/220) owns the browser runtime/version/lifecycle decision. Reuse its delivered composition rather than creating another registry or Effect runtime. A merged planning document is not an implemented dependency. Characterization and transport-spike work can proceed before phase 1, but the production state cutover must reconcile with its actual result.

[PR #218](https://github.com/cill-i-am/meal-planner/pull/218) was open at planning time. Its changed files include the interview client/panel, native session/socket, private contracts, and discovery streaming/model behavior. Its head was `2fd5d7f315bf98de10d74792b2269f8f020e1f76`; this is overlap evidence, not a base to assume indefinitely.

At the reviewed `main`, the accepted private-session foundation does not have a production assistant producer. PR #218 contains newer unmerged work. Before implementation, inspect its live state and choose one explicit integration baseline: merged latest main, or an explicitly assigned branch coordinated with that work's owner. Never copy the audit snapshot over that branch, duplicate its discovery implementation, or mark this streaming migration complete using synthetic output alone while its actual producer is still unresolved.

The three planning PRs are independently reviewable from the same main snapshot. This phase depends on implementation decisions, not a stacked planning branch. Keep one writer for the interview client, shared contracts, manifests, and lockfile. Phase 3 is otherwise independent.

## Implementation plan

### 1. Characterize control, history, and in-flight behavior

- [ ] Record the actual implementation base SHA, phase 1 result, and PR #218 overlap disposition.
- [ ] Inventory the existing client responsibilities and classify each as generic subscriptions, transport framing, durable recovery, domain policy, or presentation. Name the specific machinery expected to disappear.
- [ ] Extend current behavior tests before extraction: admitted binding before display, account/household changes, two consumers, pagination, completed history, retained command identity, delayed replies, stale card/profile revisions, and explicit safety confirmation.
- [ ] Define canonical mappings for session identity, request/mutation ID, record ordinal, message/turn ID, and final acknowledgement. A library-generated optimistic ID must not replace an authoritative durable identity.

### 2. Replace the observable store with scoped atoms

- [ ] Move connection status, selection, cards, and derived UI into the phase 1 atom/registry pattern. Keep effects and socket lifecycle explicitly scoped.
- [ ] Replace manual listener-set notification and `getSnapshot`/`subscribe` plumbing with library subscriptions. If a small command/session service remains, give it domain responsibilities rather than rebuilding another generic observable store.
- [ ] Preserve the existing retained exact-command mechanism outside disposable view state where required. Hiding private data or disposing a registry must not discard an unresolved mutation or recover it under another identity.
- [ ] Prevent stale connection callbacks from updating a new binding. Mount/unmount and multiple component consumers must not accidentally duplicate sockets or commands.
- [ ] Keep control status and tentative-card state distinct from confirmed Household profile data. Refresh confirmed reads through phase 1's selected integration after canonical settlement.

### 3. Prove a narrow TanStack AI transport adapter

- [ ] Select exact compatible `@tanstack/ai-client` / `@tanstack/ai-react` releases and only the additional TanStack packages actually required. Inspect published declarations, the lockfile, and the installed transport contract; do not copy a latest-doc example blindly.
- [ ] Use the supported WebSocket/persistent-transport contract where it fits. A small application adapter is acceptable for the private handshake and closed frames; a second general stream parser, chat store, or AI provider framework is not.
- [ ] Produce a protocol mapping table covering admission (`SessionReady` or its current equivalent), control commands, history pages, model chunks, final persisted result, errors, reconnect, and interruption. Private control frames are not automatically TanStack AI frames.
- [ ] Prove a synthetic sequence through the actual client binding: ordered chunks, completion, malformed frame, disconnect, reconnect, history reload, and disposal. Validate raw frames before interpreting them as library events.
- [ ] Keep the server's durable history authoritative. The default client behavior must not resend a transcript as trusted history, append the participant message twice, regenerate automatically, or create an uncontrolled model turn.
- [ ] Resolve stop/abort semantics against the existing server contract. Stopping display or aborting a local subscription is not proof a durable turn or Household mutation was cancelled. Do not invent a new remote cancellation/retry protocol as a side effect of using a hook.

### 4. Integrate without moving the authorization fence

- [ ] Connect the current, authorized conversation producer on the selected baseline to the proven client/transport seam. Preserve the existing provider selection, prompt, forced-tool acceptance, usage/provenance, timeout, and canonical command semantics.
- [ ] Keep every raw private output path behind the native final-send check. Generation and current admission/expiry must be checked synchronously adjacent to physical `WebSocket.send`, with no asynchronous bridge or later queue between that check and the send.
- [ ] Any adapter buffering must happen before that final check and be invalidated/discarded on access loss. A check when a stream starts is insufficient for later chunks.
- [ ] Preserve account/household invalidation, restart-disabled generations, retained completed history, and participant-only admission. Add no raw transcript HTTP response, parent RPC, SDK synchronization, tool/MCP escape path, or shared replicated transcript.
- [ ] Reconcile in-flight client messages with authoritative history by stable IDs/ordinals. Reconnect and explicit retry must not duplicate participant records, assistant records, model charges, or card confirmation.
- [ ] If this integration changes model output, prompt, provider dispatch, or discovery acceptance semantics, treat that as out-of-scope product/evaluation work rather than quietly expanding this refactor. Coordinate with the existing discovery work item and its evidence gates.

### 5. Delete superseded plumbing and verify the full path

- [ ] Remove replaced listener/snapshot machinery and the migrated generic stream/message-processing path. Do not leave two authoritative chat stores or two active producers.
- [ ] Keep the custom exact-command, stale-review, confirmation, permission, and provider-accounting rules. They are explicitly not deletion targets.
- [ ] Run the native local authorization/output tests and actual-browser flow below against the final implementation head. A mocked WebSocket cannot prove adjacency to physical send.
- [ ] Record dependency changes and before/after responsibilities/code removal. Update affected current architecture/web docs without reversing ADR-0004's private child decision.
- [ ] Record precise remaining limitations. An atom-only extraction or synthetic transport spike can be a bounded implementation milestone, but cannot be recorded as completion of the entire phase while the producer integration is outstanding.

## Acceptance evidence

| Scenario | Required result and evidence |
| --- | --- |
| Mount, unmount, two UI consumers | No leaked listeners/fibers or accidental duplicated connections; one intended command submission per action. |
| Private discovery/resume/history | Data appears only after current binding admission; existing page bounds/order and completed read-only history remain correct. |
| In-flight stream and persisted acknowledgement | Library assembles the intended UI message; success/history comes from the canonical result, not optimistic chunk receipt. |
| Disconnect, lost reply, restart, reconnect | Exact command identity survives under existing rules; history reconciliation yields no duplicate record, model turn, or confirmed fact. |
| Access loss during buffered output | Native runtime invalidates the generation between chunk production and delivery; no private bytes are sent after the fence closes. |
| Session expiry, sign-out, household/account switch | Old private UI disappears; stale callbacks and queued chunks cannot repopulate it, including after re-mount. |
| Wrong participant or another adult | Directory, session, history, stream, and recovery remain denied through the real admission boundary. |
| Correction/rejection/confirmation | Tentative cards remain private; only an explicit current-version command changes confirmed profiles; safety reductions retain their separate confirmation. |
| Delayed or ambiguous confirmation result | Original payload/ID/versions are retained; stale responses cannot clear a newer pending command or imply failure/success. |
| Malformed/unexpected stream event and interruption | Fail visibly and safely under existing policy; no output repair, new automatic retry, hidden commit, or authorization bypass. |
| Actual browser and native runtime | Synthetic local data exercises the actual React binding, native socket fence, reconnect, and confirmation UI; mocked component tests supplement rather than replace this proof. |
| Architectural cleanup | Generic subscriptions and migrated stream assembly are removed; private authority, recovery policy, and durable history ownership are unchanged. |

Test the final-send fence on the pinned local workerd/Miniflare production classes, including a paused/buffered continuation followed by invalidation, passive expiry, and restart. Use synthetic messages and providers; do not persist real transcripts in tests, evidence, logs, or PRs.

### Verification commands

Inspect current configs/fixtures before execution; the reviewed manifests expose the following entry points. Adapt filters only to actual renamed files and record the final commands.

```sh
pnpm install --frozen-lockfile
pnpm --filter @meal-planner/web exec vitest --config vitest.config.ts run src/features/private-interviews src/features/household-profiles
pnpm --filter @meal-planner/api exec vitest run src/features/private-output
pnpm --filter @meal-planner/web check
pnpm --filter @meal-planner/web build
pnpm format:check
pnpm lint
pnpm check
pnpm test
pnpm build
```

Also run the affected shared-contract tests and native household-confirmation fixture when protocol/confirmation wiring changes. Follow any current CI gates. Frozen install follows intentional manifest/lockfile updates. These commands are not claimed to have been executed during planning.

No `alchemy:plan`, deployment/destruction, real model requests, paid evaluation, or provider mutation is part of this planning task. A successful synthetic transport test is not evidence that a live model was evaluated successfully.

## Implementation constraints

Use the installed TanStack transport abstraction, not a raw `useChat` swap that bypasses admission. Avoid replacing backend Effect AI/Alchemy integration simply for naming consistency. Do not wrap the native output through an SDK parent bridge or make a private transcript available through a new response channel.

This refactor should not need a persistence migration, dual writes, a compatibility framework, or a second chat database. Preserve existing records and wire/size limits. If a real compatibility contract or native lifecycle limitation requires a broader change, record the concrete conflict and keep the dependent cutover incomplete rather than weakening the privacy boundary.

For rollback, revert the bounded state/transport cutover while preserving all durable identities and recorded outcomes. Do not roll back or rewrite PR #218's product work as part of reverting this refactor.

## Agent handoff

> Implement only Library Consolidation phase 2 from this work item. First reconcile phase 1's delivered runtime pattern and the live state of PR #218; do not overwrite unmerged discovery work. Replace generic private-client subscriptions with scoped atoms and prove a minimal TanStack AI transport/message integration. Keep native final-send authorization, participant isolation, durable history, current-version safety confirmation, and exact-command recovery unchanged. Verify the actual browser and native output boundary with synthetic data, delete superseded plumbing, and record evidence here. Do not add another producer, redesign private storage, move transcripts into LiveStore, run paid provider evaluations, or deploy. Follow the assigned delivery scope and repository execution policy.

## Delivery record

- 2026-09-16: Proposed following the custom-implementation audit, using the existing repository work-item structure. Planning authorization covers documentation branches and separate open PRs only.
- Sources: accepted ADR/private-session/card records above, the supplied baseline audit, current manifests, and the live changed-file list/status of PR #218. The latter has overlapping unmerged implementation and must be rechecked before editing.
- Upstream implementation references, inspected on the planning date: [TanStack AI connection adapters](https://tanstack.com/ai/latest/docs/chat/connection-adapters) and [WebSocket transport](https://tanstack.com/ai/latest/docs/resumable-streams/websockets). These describe current APIs, not verified compatibility with this repo's selected versions.
- Verification so far: planning/source inspection only. No dependency changes, implementation tests, native runtime proof, live provider evaluation, merge, or deployment performed.

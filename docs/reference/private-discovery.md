# Private discovery

## Authority

Private sessions store the conversation, tentative profile cards, continuity notes
and chat history. Only `HouseholdObject` saves confirmed profiles, versions, audit
records and mutation receipts through authorized commands. Better Auth manages
identity and membership. Shared lifecycle coordinators track when access must be
invalidated; they do not store transcripts.

The AI proposes facts. The participant must confirm a reviewed command before it
can change household data. An unfinished proposal or raw conversation history is
not a confirmed command.

## Current runtime

`PrivateInterviewSession` extends Cloudflare's **base Agent**.
`PrivateInterviewDirectory` remains a native Durable Object. Published TanStack
packages manage chat execution, events and client history. Older records describe
plain session Durable Objects. That choice was replaced; do not restore it, the
removed SDK patches or the custom binding wrapper.
[ADR-0004](../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md#published-tanstack-packages--accepted-2026-09-19)
records the accepted choice and its history.

Application code checks access, tracks required interview topics, links proposals
to evidence and saves accepted changes atomically. Immediately before sending
private output on the native socket, it synchronously checks the connection's
access generation and expiry. An `await` or forwarding queue between that check
and the send would change the security behavior.

Normal hibernation may keep an already OPEN socket only when it has the matching
server-written attachment and an unexpired connected grant. It must not restore
revoked, unauthorized or pending access. A disconnect does not cancel a run.
Rejoining a run does not start another model call. Closing a local turn does not
prove that `Ai.run` stopped.

If a confirmation result is unknown, keep the exact reviewed command and mutation
ID. Resolve pending confirmation before completing the session. Stale versions
need a fresh review, not an automatic rebase. Revoking access prevents new commands
from being released and new output from being sent; it does not roll back a command
already dispatched to household storage.

Using base Agent does not add private HTTP responses, RPC methods that return
transcripts, SDK state synchronization or parent access to transcripts.

## Source and verification

- [Session](../../apps/api/src/features/private-output/private-interview-session.ts),
  [directory](../../apps/api/src/features/private-output/private-interview-directory.ts),
  [socket access checks](../../apps/api/src/features/private-output/private-output-socket.ts).
- [Native privacy and retry tests](../../apps/api/src/features/private-output/private-output.integration.test.ts),
  [reconnect tests](../../apps/api/src/features/private-output/private-chat-reconnect.integration.test.ts),
  [socket lifecycle tests](../../apps/api/src/features/private-output/private-output-socket.test.ts).
- [Interview coverage rules](discovery-coverage.md), [household data](household.md),
  [discovery integration tests](../../apps/api/src/features/private-output/private-discovery.integration.test.ts).

[The discovery plan](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md)
tracks unfinished evaluation and conversation-tone work. Historical runtime tests
and one live opening do not prove sustained quality, production rollout or beta readiness.

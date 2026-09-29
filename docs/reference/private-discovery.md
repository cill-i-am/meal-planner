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

## Shared family conversation

The [shared family conversation](agent-conversations.md) is a separate scope
from an adult's private interview. Its context includes current confirmed
household facts and admitted planning records. It never receives private
interview transcripts or unfinished private proposals. A shared suggestion
changes a profile, routine, meal setup or plan only after an authorized adult
reviews and accepts the typed action. The browser displays private interview
history separately from confirmed facts in Our tastes.

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

The deployed [private Worker binding](../../apps/api/src/features/private-output/private-output-binding.ts)
uses the same stage-owned AI Gateway and scoped token as the family conversation.
Its model is GPT-6 Luna through Cloudflare Responses. The model receives only the
bound participant's private session context. It must return one closed
`submitDiscoveryTurn` tool call; application code validates the result before
recording a private proposal. Gateway logging, caching and provider response
storage are disabled. A missing binding fails the turn as `not_configured`.

## Fresh profile review

`ProfileEdit` opens a new private session with the adult's current household
profile. Its model context contains that profile and only the new session's
messages and proposals. The browser shows the current shared facts at the start
of the review and asks what changed. An earlier completed session remains
history only; its transcript is not carried into the new one. A proposal stays
private until the adult reviews and confirms it through the existing household
command. A stale profile version requires a fresh review.

## Source and verification

- [Session](../../apps/api/src/features/private-output/private-interview-session.ts),
  [directory](../../apps/api/src/features/private-output/private-interview-directory.ts),
  [socket access checks](../../apps/api/src/features/private-output/private-output-socket.ts).
- [Native privacy and retry tests](../../apps/api/src/features/private-output/private-output.integration.test.ts),
  [reconnect tests](../../apps/api/src/features/private-output/private-chat-reconnect.integration.test.ts),
  [socket lifecycle tests](../../apps/api/src/features/private-output/private-output-socket.test.ts).
- [Interview coverage rules](discovery-coverage.md), [household data](household.md),
  [discovery integration tests](../../apps/api/src/features/private-output/private-discovery.integration.test.ts).
- [Fresh review browser journey](../../apps/web/e2e/private-review-journey.spec.ts),
  [browser component tests](../../apps/web/src/features/private-interviews/private-interviews-panel.test.tsx),
  [native A-to-B confirmation test](../../apps/api/src/features/households/household-boundary.integration.test.ts).

[The discovery plan](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md)
tracks unfinished evaluation and conversation-tone review. Historical runtime
tests, provider-free repeat-review tests and one live opening do not prove
sustained quality, production rollout or beta readiness.

# Private discovery

## Authority

Private sessions own dialogue, tentative profile cards, continuity and chat
history. `HouseholdObject` alone commits confirmed profiles, versions, audit and
mutation receipts through admitted commands. Better Auth owns identity/membership;
shared lifecycle coordinators contain invalidation metadata, not transcripts.
AI proposes facts; explicit participant confirmation releases the reviewed closed
command, never an unfinished proposal or raw history.

## Current runtime

`PrivateInterviewSession` extends Cloudflare's **base Agent**. The participant
`PrivateInterviewDirectory` remains a native Durable Object. Published TanStack
packages own chat orchestration/events and client history. The plain-session DO
selection in older evidence was superseded; do not restore it or the removed SDK
patches/custom binding wrapper. [ADR-0004](../decisions/adr-0004-household-agent-coordinator-and-isolated-chat-agents.md#published-tanstack-packages--accepted-2026-09-19)
records the current accepted choice and preceding history.

Application code owns admission, required coverage, evidence binding, atomic
acceptance and final-send authorization. Every physical private output checks its
current generation and expiry synchronously immediately before native send.
An intervening await/forwarding queue changes the security contract. Normal
hibernation can preserve an already OPEN socket only with a matching server-written
attachment and unexpired connected grant; it never revives revoked, unauthorized
or pending access. Disconnect is not cancellation; rejoining an existing run does
not start another inference. Closing a local turn does not prove `Ai.run` stopped.

Unknown confirmation outcomes retain the exact reviewed command and mutation ID;
completion must resolve pending confirmation first. Stale versions require review,
not automatic rebase. Revocation prevents new release/output; it does not invent a
rollback for an already dispatched canonical command. No private HTTP response,
transcript-returning RPC, SDK state synchronization or parent transcript access is
introduced by the base Agent choice.

## Source and verification

- [Session](../../apps/api/src/features/private-output/private-interview-session.ts),
  [directory](../../apps/api/src/features/private-output/private-interview-directory.ts),
  [socket fence](../../apps/api/src/features/private-output/private-output-socket.ts).
- [Native privacy/replay proof](../../apps/api/src/features/private-output/private-output.integration.test.ts),
  [reconnect](../../apps/api/src/features/private-output/private-chat-reconnect.integration.test.ts),
  [socket lifecycle](../../apps/api/src/features/private-output/private-output-socket.test.ts).
- [Coverage/acceptance contract](discovery-coverage.md),
  [household authority](household.md),
  [discovery integration tests](../../apps/api/src/features/private-output/private-discovery.integration.test.ts).

[The owning plan](../plans/private-discovery/03-adaptive-discovery-and-evaluation.md)
retains unfinished evaluation and tone acceptance. Historical native tests and one
live opening do not establish sustained quality, production rollout or beta readiness.

# Private session foundation

Status: done
Owner: historical delivery in PR #215

## Outcome

An admitted active linked adult can start a private session, rediscover it after
refresh or on another device, save participant messages, resume while it is
open, complete it, and read its retained history. Another adult cannot discover
its existence or access it using a copied reference. Reauthentication and
restart retain the session without reviving an old output generation.

This is the session/message/lifecycle foundation. A thin browser surface makes
those operations reviewable without pretending an assistant is present.
Synthetic assistant messages/output are provided only through a test fixture to
prove ordering and retention. No canned/echo assistant ships; model output,
profile cards/confirmation, and adaptive conversation follow in the owning later
slices.

This is a completed slice, not current transport-selection guidance or proof of
model quality. Later implementation supersedes the historical runtime details.

## Acceptance preserved

The following describes this completed slice's historical acceptance, not new
workflow requirements. Consult current contracts for an assigned change.

Use the production Alchemy bundle and named entrypoints on real
workerd/Miniflare, real Better Auth D1 and routed HouseholdObject, persisted
native child storage, physical WebSockets, and the browser surface. Extend the
existing private-output and household boundary fixtures, rather than substitute
a synthetic identity service for canonical admission.

- Two linked adults in one household and an adult in another household: only the
  participant can list, connect, read, append, or complete. Copy a session
  reference and a creation mutation ID; neither discloses existence nor changes
  its binding. Repaired links cannot silently retarget old directory/session
  identities.
- Lose creation, append, and completion replies, then restart the runtime and
  refresh the browser. Exact retries recover one reservation/message/completion;
  changed-payload collisions fail. Concurrent same/different commands prove
  replay, version conflict, and stable ordering without duplicate records.
- Open history survives disconnect and restart. Completed history remains
  readable after fresh admission but rejects all new conversation writes. Race
  completion with an append, queued fixture output, and reconnect; only the
  serialized valid result persists, and no late questioning escapes after
  completion.
- Repeat passive sign-out/membership removal, expiry, archive/unlink/rebind,
  failed authority read, and lost invalidation-ACK barriers for both native
  child kinds. Old generations release no directory, history, receipt, or queued
  content after the fence; new connections fail closed. Preserve pending-fence
  recovery semantics across migration/restart and prove coordinators can
  invalidate both target kinds.
- Probe disabled HTTP/SDK/RPC/storage paths and malformed/oversized wire
  commands. Confirm production cannot invoke the fixture assistant producer.
  Logs, shared household state, audit, and coordinator records contain no
  transcript sentinel.
- Browser proof covers start, cross-device-style rediscovery, resume,
  completion, history-only view, retained ambiguous commands, and auth-required
  recovery. The UI accurately represents a session foundation without a working
  assistant.

Run relevant focused suites and root typecheck/lint/build/test gates under the
repository scripts, explicit formatting for changed docs, and twice/no-diff
native migration generation when schema changes. Independent immutable-head
review must cover privacy/fence composition and lifecycle/replay evidence.
Provider quality evals are not this slice's claim; they begin with the real
adaptive model slice.

## Delivery evidence

Delivered by [PR #215](https://github.com/cill-i-am/meal-planner/pull/215).
The [original complete record](https://github.com/cill-i-am/meal-planner/blob/1912513fefd35c009c09168035b9c0e0b872c1fb/docs/delivery/stages/02-private-discovery/01-private-session-foundation.md) preserves the exact heads, checks,
acceptance, decisions, findings and limitations. This refactor did not rerun or
promote that historical evidence. Completed records do not grant new scope.

Use [current household contracts](../../reference/household.md) and
[private-discovery contracts](../../reference/private-discovery.md)
for new changes rather than following the old implementation diary.

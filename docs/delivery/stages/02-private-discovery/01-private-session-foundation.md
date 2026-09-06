# Work Item 01 — Private session foundation

- Status: In progress — implementation authorized on 2026-09-06.
- Accepted planning direction: 2026-09-06.
- Owner: the private-session implementation owner; bounded browser and runtime
  test delegates have disjoint file ownership.
- Stage: [private discovery and repeat profile review](README.md).
- Base: merged native-output safety and completed priority queue at
  `28a5f3ca4aae3c8f01c56e5261439111acd9949d`.

## Result

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

## Existing seam and ownership

Use the existing
[native child](../../../../apps/api/src/features/private-output/private-interview-session.ts),
[authenticated route](../../../../apps/api/src/features/private-output/private-output.http.ts),
and
[named Worker bindings](../../../../apps/api/src/features/private-output/private-output-binding.ts).
[Private-output safety](../../private-output-safety.md) and
[ADR-0004](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
own the accepted native transport and canonical authority fence. Before this work item, the child stored binding/completion metadata and a
connection generation, rejected all inbound socket messages, and had no
transcript or discovery store. Its connect path initialized arbitrary previously
unknown UUIDs; explicit creation below replaces that path.

Add one participant-scoped plain native `PrivateInterviewDirectory` child to the
same private-output Worker. It has a concrete purpose: cross-device discovery
before an interview UUID is known. Its private binding is derived by the server
from household/account/linkage/person identity after current canonical
admission. It owns session reservations and creation receipts, not session
history or canonical open/completed status. A separate namespace prevents a fake
interview or an unfenced HTTP list from becoming the discovery mechanism.

The directory and each existing session child own their physical WebSocket and
ECMAScript-private storage. Both register output generations with the existing
account and household coordinators before final canonical reauthentication.
Extend registration with a closed directory/session target distinction and
invalidation-only capabilities for each; do not give coordinators either private
store or a general method dispatcher. Preserve already stored registrations and
pending fences with an ordered migration and upgrade proof. No new authority,
Household grant, or shared adult-activity projection is introduced.

## Creation, discovery, and connection

1. The browser connects to a participant directory route without supplying an
   account/person identity. Use the same same-origin upgrade admission, durable
   registration, fresh authority reads, and one-use generation activation as the
   existing session route. Directory results are private output on that socket.
2. `StartSession` carries one client mutation ID. A directory transaction checks
   current bound generation/expiry, reserves a server-generated opaque session
   UUID, and stores its immutable binding, creation time/ordinal, command
   digest, and exact receipt. The same ID and intent replay the same
   reservation; changed payload/binding cannot reuse it. Distinct intentional
   commands create distinct sessions. A lost response never requires a new
   command or a second UUID.
3. `ListSessions` pages that participant's reservations by stable ordinal.
   Return only the reference and creation metadata through the directory
   emitter; no other adult's activity, transcript snippets, generated title, or
   cached completion status. Load canonical status/history when a session is
   selected.
4. Connecting to a session first proves its matching directory reservation, then
   initializes the selected child idempotently with that exact immutable
   binding. An arbitrary/copied UUID cannot create or retarget it. Lazy child
   initialization avoids a cross-object creation transaction; failure or restart
   retries the same reservation. Every connection still performs the
   two-coordinator fence and final fresh canonical reads before activation.

Directory reservation queries are a narrow internal metadata capability for the
authenticated admission path; they never return message content. The session
status/history is emitted by the session itself. Neither the API nor directory
gets a transcript-returning RPC. HTTP denial remains content-free.

## Messages, completion, and replay

Keep session lifecycle (`open` or `completed`) separate from the output
generation (`pending`, `authorized`, `connected`, `invalidated`). The session
child owns monotonic session versions, durable message IDs/ordinals, and
mutation receipts. It assigns identity and time; caller-supplied actor, role,
lifecycle, or assistant messages are rejected by closed wire schemas.

- `AppendParticipantMessage` carries the exact text, mutation ID, and expected
  session version. Validate the bound socket generation and expiry before a
  local transaction. After authorization, inspect the receipt before checking
  the expected version: identical replay returns the original result; changed
  intent is a collision. A new command requires an open session and matching
  version. Append the message and immutable receipt/version together, then emit
  the result. No provider or cross-object call runs inside this transaction.
- `ReadHistory` uses bounded ordinal pages and emits stable message IDs and
  canonical session state. Reconnection can replay durable records; the browser
  deduplicates by ID. A successful socket send is not delivery acknowledgment.
- `CompleteSession` carries a mutation ID and expected version. Atomically close
  new conversation writes and record the exact completion receipt/version.
  Replays cannot reopen it. Work already underway must recheck lifecycle before
  persisting or emitting a conversational result; completion suppresses delayed
  questioning. Completion receipts and retained-history output remain readable
  through a currently authorized socket. No blanket ban on completed-session
  output applies.
- A completed session can reconnect only for history and receipt recovery. A
  later interview uses a new reservation. Completion does not create household
  facts, erase history, or relax current participant authorization.

The browser retains the exact unresolved command and mutation ID through a lost
reply/refresh and only replays it for the original authenticated binding. It
distinguishes sign-in-required, definitive conflict/closed-session rejection,
and an ambiguous outcome. A stale version prompts refreshed review, not
automatic resubmission as a new command. Auth/account/household changes hide
private content and prevent replay against a different binding. Choose finite
message/page/frame limits in the closed protocol and prove rejection before
persistence; limit values are implementation parameters, not product questions.

## Private output ordering

Every private frame, including directory metadata, message receipts, history,
completion receipts, and synthetic fixture output, uses the selected child's
physical socket. Capture the admitted generation at operation start. Immediately
before each physical `send`, synchronously check that same durable generation,
socket attachment, connected state, session expiry, and the output's permitted
lifecycle. No await or forwarding emitter can intervene. Delayed results may not
adopt a replacement connection's generation.

The existing canonical writer fence invalidates both directory and session
generations before covered Better Auth or Household authority changes commit.
Expiry fails closed at the final send without needing another inbound message.
Restart kills cached connection admission, not retained lifecycle/messages.
Revocation is loss of access; it does not silently complete or delete an
interview. Do not introduce timer-based recovery for the existing unresolved
auth-write fence; its documented availability limit remains visible as
unavailable access.

Keep SDK synchronization/callable/MCP paths, private HTTP bodies, internal
storage RPC, parent transcript reads, and broad child namespace exposure
disabled. All new inbound commands require current generation/expiry validation
as well as their local lifecycle checks. Test fixtures alone can produce
synthetic assistant records, and must pass the same lifecycle/generation guards;
production has no fixture dispatch route or assistant producer.

## Acceptance evidence

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

## Delivery record

2026-09-06: implementation-ready plan accepted after the three priority fixes.
The user authorized implementation of this work item after accepting the plan.
Application implementation is in progress; model calls and cloud changes remain
outside this slice. Publication, merge, and external effects remain governed by
the existing execution policy and actual user authorization.

### Implemented foundation

The production native directory now reserves server-generated references and
returns bounded participant-only discovery pages. The session persists exact
participant messages, versioned successful mutation receipts, retained
history, and completion. The browser mounts this foundation in the household
view and retains unresolved commands across refresh for explicit exact replay
after the original binding is admitted. It labels the absence of a working
assistant.

The shared closed protocol limits input/output frames to 32,768 bytes,
participant text to 4,000 UTF-16 code units, and pages to 25 records. Encoded
history pages stop at the byte limit and retain the next ordinal. Both native
child kinds compose the same private physical-socket fence; coordinators gain
only closed registration targets and invalidation capabilities. The ordered
native migration preserves previous session registrations and unresolved
canonical fences.

Native hibernation or process restart invalidates the retained connection
generation. An idle connection can therefore require reconnecting even while
the canonical sign-in remains valid. The browser retains an ambiguous
mutation, asks the participant to reconnect, and retries the original command
only after fresh admission. Restart never revives an old generation or erases
a committed reservation, message, receipt, or completion.

### Local verification

Implementation checkout: `codex/private-session-foundation`, fetched planning
base `a28f0f71dcc57a2cabb807f3973ecec30f6ddcdf`. Checks use Node 24.20.0 and
pnpm 12.3.4. Root typecheck, build, lint, formatting, and diff checks passed.
Native schema generation ran twice after the ordered migration with no further
schema changes. The web build reports its existing large-chunk advisory.

All 1,239 repository tests passed across the full runs and affected reruns:
180 root/architecture, 890 API, 108 web, and 61 shared protocol tests. The final
API addition was one focused native sentinel test after the 889-test API run. The first root run passed 179 tests and correctly
rejected the new untracked production package; staging the intended source made
the affected tracked-source architecture check pass. The remaining workspace
suites ran through the repository's recursive test scripts.

The native private-output suite includes 36 tests against physical sockets and
persistent native storage: reservation/append/completion receipt recovery after
restart, competing commands and stable ordering, generation/expiry/completion
suppression, finite encoded history, ordered migration preservation, and exact
production-bundle denial of fixture RPCs, storage access, private HTTP, SDK
synchronization, and spoofed or malformed wire commands. Canonical integration
uses real Better Auth D1 and routed Household authority to cover participant
isolation, copied references, replacement bindings, sign-out, membership removal,
archive/unlink/repair, failed reads, and lost invalidation acknowledgments for
both native child kinds. The migration explicitly preserves `fencing`, `ready`,
and unknown `dispatched` phases. An independent completed mutation cannot clear
the earlier unknown dispatched fence after upgrade and restart.

The final sentinel test confirms a participant message is present in private
history, while five populated shared Household/profile/history/audit views remain
unchanged. It inspects actual HouseholdObject and both coordinator stores,
directory responses, and captured native logs for absence of that content. A
static fixture log probe positively verifies the log capture path; no production
logging or storage inspection endpoint is added. This focused native test and
the affected API typecheck, lint, formatting, and diff checks pass.

Browser acceptance proof and independent immutable-head review are in progress.
This record does not yet claim their completion or a deployed result.

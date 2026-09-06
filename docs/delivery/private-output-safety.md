# Private-output safety implementation

- Date: 2026-09-06
- Status: implemented locally; final checks and independent immutable-head review pending.
- Priority: fix 1 in [the authorized queue](prioritized-risk-fixes.md).
- Base: dependency-upgrade PR #209, merge `4b4e7fd651d66c2a03805eb00209c40fe3eb3240`.
- Scope: provider-free private-output admission, revocation ordering, and native runtime proof.

## Result and boundaries

The production API now admits a participant-only native WebSocket at
`GET /v1/private-interviews/:sessionReference/connect`. Its immutable binding
contains the privacy-safe household and account keys, household-scoped linkage
subject, person ID, and opaque session reference. It contains no credential,
cookie, email, transcript, or raw provider result.

Admission uses the real Better Auth session and organization membership and the
real HouseholdObject active linked-adult projection. A copied reference cannot
change the binding or close its owner's connection. Completed metadata stays
retained with that same binding. New private output requires current canonical
reauthentication; completion does not grant later access.

The production child contains no transcript store or model producer. Runtime
verification supplies synthetic output through a separate test-only capability.
There is no chat UI, provider call, Household grant, private HTTP response body,
transcript-returning RPC, SDK callable/tool/MCP protocol, or parent transcript
operation. Every future output path must repeat this ordering proof before it is
enabled.

## Runtime selection

Pinned runtime: `agents@0.22.0`, Alchemy `2.0.0-beta.76`, Miniflare
`5.20260903.0-alpha`, compatibility date `2026-07-14`, and `nodejs_compat`.
The native class definitions use the pinned public Cloudflare host types rather
than a test-only declaration. The Alchemy native Worker exports three Durable
Object classes and separate named admission and mutation entrypoints.

The SDK sub-agent sends through a virtual socket whose payload is asynchronously
forwarded to the parent. The final physical send therefore occurs after a child
check has returned. In the installed `agents@0.22.0` distribution, the relevant
path is `dist/src-5W6JNKVb.js`: virtual `send` at lines 3469–3470, queued bridge
work at 3147–3167, and the root physical send at 3232–3235. This excludes that
transport from the accepted immediate output fence.

A disposable native workerd selection probe also wrote a synthetic sentinel to
a top-level Agent's SQL and state, then read both using the inherited native
`sql` and `state` RPC. Both returned HTTP 200 with the sentinel. A second native
probe established that returning an upgraded WebSocket through ordinary Worker
RPC fails with `DataCloneError`; forwarding the native response through a named
service-binding `fetch` and Effect's public raw-response interop preserves the
physical socket and its frames.

Consequently, [ADR-0004](../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md)
selects its already accepted plain child Durable Object fallback. The child owns
its physical WebSocket and ECMAScript-private database field. The native negative
tests reject inherited SQL, state, and context-storage RPC on the selected child.
The public private-output Worker returns an empty 404 for parent, sub-agent, MCP,
and RPC routes. No SDK internal override or patched bridge is involved.

## Authority change and final enqueue

1. The API performs initial canonical admission to identify the immutable binding.
2. The child disables its previous generation, creates a new disabled generation,
   and durably registers it with both `AccountOutputLifecycle` and `HouseholdAgent`.
3. The API repeats canonical Better Auth and Household reads. Only the original,
   still-pending generation can become authorized. Upgrade consumes that
   authorization once and establishes the physical native socket.
4. Every covered canonical writer first records its durable operation in the
   corresponding coordinator. Pending operations block all new registrations.
   The coordinator invalidates every registered child generation and waits for
   the durable acknowledgments before it permits a single dispatch claim.
5. The child checks its durable generation, connected status, socket attachment,
   and captured canonical session expiry synchronously immediately before
   `socket.send`. No await or second emitter sits between that check and enqueue.

Thus invalidation has committed in the physical emitter before the canonical
session, membership, or Household authority change can commit. A producer already
running at that point cannot release later output for the old generation. This
contract does not retract bytes already enqueued before invalidation.

The two coordinators store lifecycle metadata only. The account index covers
session and membership changes without enumerating a potentially incomplete
cross-household membership snapshot. The Household index covers person/link
changes without becoming an authority cache. Canonical identity remains in
Better Auth D1; canonical product authority and receipts remain in HouseholdObject.
No network call runs inside a Household SQLite transaction.

## Canonical mutation coverage

`makeMealPlannerAuth` requires its output fence. The fence wraps Better Auth's
public DBAdapter, including transaction callbacks, rather than relying on hooks
that omit programmatic membership paths or hide the selected old session row.
The configured D1 adapter explicitly keeps transactions disabled, so each
individual statement commits before its fence settles.

Enabled session token updates/deletes, user-scoped bulk session deletion,
active-organization changes, session refreshes, and member ID updates/deletes
are fenced. Unique selectors are reread after fencing to reject a target that
moved to another account. Bulk user deletion uses the immutable account selector
directly; it does not enumerate a capped session list. Unsupported selectors,
identity transfers, protected consume/increment operations, user deletion, and
organization deletion fail before mutation. Better Auth catches sign-out delete
errors internally, so the HTTP and typed sign-out guards preserve a failed fence
as failure instead of reporting a successful revocation.

Refresh retries use an explicit logical identity only for the exact session
`update` with one token equality selector and exactly `expiresAt` plus `updatedAt`.
Dates may be recomputed on retry; other payloads and selectors retain their full
intent digest. The retained operation still has only one dispatch claim. This
makes no claim that the latest computed expiry wins a concurrent refresh race.

The Household runtime fences person/link lifecycle commands before invoking their
existing canonical repositories. Existing command admission, digest validation,
local transactions, and mutation receipts remain authoritative. A per-object
semaphore serializes these writer operations across fence RPC so concurrent
commands still reach their canonical stale-version/replay results. Invalidation
ACKs never call back into HouseholdObject. The new native
DO migration root contains lifecycle/session metadata only; existing applied D1
and Household migrations are unchanged.

## Recovery and availability

- A lost child invalidation acknowledgment leaves the operation pre-dispatch.
  Retrying the same intent uses the retained operation and idempotently
  acknowledges the persisted invalidation before any canonical write.
- Concurrent identical intents receive one durable `ready → dispatched` claim;
  a second caller cannot dispatch another canonical closure.
- A lost completion acknowledgment rereads the exact retained operation. A
  durable settled result permits fresh registration and canonical reauthentication.
  It never revives an old output generation.
- Household commands with an existing canonical mutation receipt can replay the
  exact repository operation after a lost outcome. A missing receipt does not
  establish a safe retry.
- An auth write with an unknown outcome after dispatch stays fenced across
  restart. Losing the dispatch acknowledgment can also leave this state even
  when the caller never executed its canonical closure. No timeout, later
  authority snapshot, or new operation token unlocks it. This residual denial of
  private output requires a future authorized repair protocol; it is not complete
  automatic recovery. Other pending non-refresh auth intents also require an
  identical retry payload before dispatch.
- Child restart invalidates cached generations and closes retained sockets.
  Authority-read failure leaves the new generation disabled. Session expiry is
  checked at the final send even if no cleanup request or inbound message occurs.

## Verification

The focused native suites exercise real workerd Durable Objects and physical
WebSockets. The combined boundary suite uses real Better Auth D1 migrations, the
production private-output classes, the production authenticated route helper,
and the existing routed HouseholdObject composition. A test-only barrier stalls
return of the final successful Household authority read; real session revocation
then prevents activation. Another case fails the final authority read and proves
fresh canonical reauthentication is required.

Coverage includes copied references and cross-adult/household denial, real passive
sign-out, delayed output after sign-out, active-organization changes, departure
preparation before membership removal, immutable binding through link repair,
expiry without an inbound message, disabled protocols/private HTTP/internal
storage RPC, retained completion, lost invalidation/completion acknowledgments,
single dispatch under concurrency, and unknown operations across restart.
The separate real-D1 adapter suite covers programmatic removal and self-leave,
more than 100 session rows, refresh, selector/identity rejection, transaction
callback coverage, and both forms of sign-out failure reporting.

Run with the pinned Node/pnpm toolchain:

```sh
pnpm --filter @meal-planner/api exec vitest run src/features/private-output/private-output.integration.test.ts src/features/auth/auth-output-fence.worker.test.ts src/features/households/household-boundary.integration.test.ts src/features/households/household-object.integration.test.ts
pnpm check
pnpm lint
pnpm format:check
pnpm build
pnpm test
```

The implementation candidate passes 104 native runtime cases and 19 real-D1
auth-adapter cases, root/workspace typechecking, lint, and the production build.
Two consecutive private-output migration generation passes produce no changes.
The full root suite and independent immutable-head review remain completion
gates recorded on the pull request. This evidence is local and provider-free.
No deployment, remote D1 inspection/conversion, provider mutation, or interview
transcript was used.

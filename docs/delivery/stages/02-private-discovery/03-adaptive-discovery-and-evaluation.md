# Work Item 03 — Adaptive discovery and evaluation

- Status: In progress (2026-09-07); [draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218), not ready to merge.
- Authorized by the product owner to continue after Work Item 02.
- Implementation base: `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Owning stage: [Stage 2](README.md).

## Outcome and scope

An adult receives relevant model follow-ups and useful private profile proposals
while using the existing correction, rejection, explicit confirmation, completion,
and retained-history paths. The model cannot confirm facts or write household
state. A new session receives the adult's current canonical profile and its own
private conversation context, without reading an earlier session's transcript.

This work includes the mandatory custom-agent harness spike, all eight synthetic
families scoped to adult discovery, candidate comparison, and preparation of the
human-calibrated baseline required by [PDR-0006](../../../decisions/product/0006-ai-evaluation-and-release-evidence.md).
The spike exercises confirmation, completion, and a fresh-session ordinary
preference change through real admitted capabilities. Broader repeat-review UX,
dependant assistance, and cumulative Stage 2 exit remain with Work Items 04–05.
Later routine, planning, repair, feedback, and shopping assertions remain **not
exercised**.

## Concrete design under implementation

The native `PrivateInterviewSession` remains the only owner of private messages,
unfinished proposals, generated output, and model-turn receipts. An authenticated
metadata-only HTTP continuation provides the bound adult's freshly read canonical
profile to that child; neither API nor coordinator reads the transcript. The
continuation captures the original admitted socket generation. Private values do
not enter HTTP responses, shared agent state, general RPC reads, or logs.

A participant append durably records its message and a queued assistant turn.
One active turn prevents new conversation/card mutations; an explicit stop can
close that attempt. Before external dispatch, the adapter calls a synchronous
child-owned guard immediately adjacent to the actual provider invocation. That
guard verifies the original connected generation, open session, exact queued
turn, captured session version, and absence of a pending confirmation, then
atomically claims the attempt. Preparation awaits cannot bypass this last check.

There is no automatic provider retry. Each native Workers AI invocation explicitly
sets AI Gateway `cf-aig-max-attempts: 1`, disables response caching, and requests
no gateway payload logging. The experiment gateway must also disable retries. Duplicate continuations never dispatch a
claimed attempt again. Restart, connection replacement, revocation, cancellation,
or an ambiguous provider result interrupts that attempt. The original participant
message remains; an explicit retry creates a new attempt identity. Best-effort
abort does not claim to undo provider work. A late result can persist only for the
same active attempt, original generation, and session version. Every physical
socket send retains the existing final-send authorization fence.

One cancellation signal remains active through provider dispatch and complete
bounded response consumption. Stop, deadline and caller interruption cancel the
owned body reader without awaiting a potentially stalled cleanup promise. An
unread cancelled response has unknown usage; already decoded measurements remain
eligible for metadata-only retention without restoring private output.

The browser clears private rendered state when an established connection is lost.
It allows one fresh authenticated admission and exact retained WebSocket mutation
replay per deliberate user action, restoring a selected session only after the
new directory binding matches the original. Successful reads and admission never
replenish that recovery allowance. Recovered turns and confirmations require an
explicit continuation; reconnecting cannot automatically dispatch model work or
confirm a profile card. A stale receipt cannot regress the same attempt from a
running or terminal status, even when the session version is unchanged. A fresh
session admission clears only reconciled assistant-turn conflict/pending notices.
Failed admission remains visibly unavailable.

The thin application-owned model seam accepts bounded authorized context and
returns assistant text, bounded new-card/proposed-card-revision operations, a
private continuity summary, and usage/provenance. A revision names only a current
context card ID and expected revision. The child validates that the exact stored
card is still proposed at that revision within the final guarded settlement
transaction. It assigns card identity, version, status, and reviewed before-values
from its canonical snapshot; a revision retains identity and advances its card
revision. Pending, confirmed, rejected, and conflicted cards cannot be revised by
model output. These operations never confirm cards or mutate canonical state. Provider output cannot supply an actor, target person,
confirmation basis, source, or safety-consent phrase. Existing Household commands
remain the sole version/audit writer after participant confirmation.

The application adapter calls the native Workers AI binding directly with an
explicit configuration; absent or invalid configuration leaves model work safely
unavailable. Its initial candidate allowlist is Qwen3 30B A3B FP8 and GPT OSS 120B.
The adapter strictly decodes the selected nonstreaming Chat Completions response;
protocol compatibility remains a measured trial prerequisite. There is no provider
fallback or output repair. Known token usage and configured estimated cost are
retained on successful and rejected model output; unknown usage stays unknown.
Configured failures retain model/prompt/policy/tool provenance, recorded durably
at the dispatch claim so runtime restart cannot erase the actual configuration.
Known late usage can update only the same claimed attempt's measurements; it
never changes terminal status or restores text, cards, summary, or socket output.

The context keeps the whole current own-profile projection, at most 16 recent
messages, at most 25 private cards, and a 2,000-character rolling private summary.
It trims old private context, never canonical facts, and refuses an oversized
profile without a provider call. The adapter checks both the 24,576-byte UTF-8
context bound and the 32,768-byte fully serialized provider payload including
instructions and output schema. The raw provider response is capped at 65,536
bytes; generated replies/summary are limited to 2,000 characters and card
operations to three. The configuration explicitly bounds output tokens and
request duration. No fixed question count constrains the product conversation.

`PrivateOutputWorker` owns the concrete Alchemy wiring: `Cloudflare.Workers.AI()`
creates the native `PrivateDiscoveryAI` binding, and deployment-time
`MEAL_PLANNER_PRIVATE_DISCOVERY_CONFIG` becomes its `PRIVATE_DISCOVERY_CONFIG` JSON
text binding. `MealPlannerApi` instantiates that worker through the existing
`PrivateOutputApiBinding`. The JSON requires `gatewayId`, one allowed `model`,
`maxOutputTokens` (1–4,096), `timeoutMs` (1,000–120,000), and nonnegative
`inputUsdPerMillionTokens` / `outputUsdPerMillionTokens`. `.env.example` keeps it
empty. Exact model/gateway/token-price selection and verified dedicated gateway
privacy/retry/spend configuration remain prerequisites to functional deployment;
an empty configuration is explicitly unavailable, not a selected model.

The mandatory `agent-eval` 2.2.1 custom-agent spike completed the real native
A-to-B trajectory: four prescribed provider turns, same-card corrections in both
sessions, explicit confirmations advancing profile versions 0 → 1 → 2, and fresh
B receiving the current canonical fact without A's transcript, summary or cards.
There were zero external requests and zero live-model quality runs. The
[sanitized receipt](../../../../evals/private-discovery/harness-spike.json) records
the package head, Node version, frozen development bundle and assertion evidence.
That bundle predates the final recovery and late-usage changes; the driver used
explicit readmission after plan waits, so this is not final browser acceptance.

The measured disposition is **do not adopt**. Native trace parsing produced zero
events; a separate mechanics probe automatically retried a deterministic failure
into one persisted pass. Native assertions, telemetry and judging still required
application integration. Retain the native harness and manually facilitated
eight-family pack without a new generic framework or dependency. The fixed judge,
candidate comparison and human-calibrated baseline remain pending.

## Evaluation and verification

Repository-owned assets in `evals/private-discovery/` define known/disclosed and
withheld facts, expected discoveries/artifacts, prohibited assumptions, challenges,
applicability, and rubric. Candidate context excludes withheld truth. Deterministic
hard checks run before a separately pinned judge. Question burden, failures,
latency, tokens, and estimated cost remain separate measures; unavailable values
are not zero. The applicable critical soft dimensions are household specificity
and profile synthesis. PDR-0006 quality bands and product-owner scoring of all
eight canonical fixtures govern an accepted baseline; uncalibrated runs remain
candidate evidence.

Focused native tests cover admission immediately before dispatch, duplicate and
unknown attempts, restart and late results, cancellation/completion, private
proposal persistence, schema rejection, and unchanged canonical confirmation.
Actual browser/native acceptance exercises progressive cards, correction,
confirmation, restart recovery, cross-adult isolation, and the fresh-session
repeat spike. Final immutable-head reviews and relevant repository checks precede
delivery. Provider-free doubles establish runtime behaviour, not model quality.

## Delivery evidence — 2026-09-07

The implementation uses pinned Node 24.20.0 / pnpm 12.3.4. Independent native and
adapter review accepted `2bf8f80ca72792ff94701dc8e413b51d1b2c0c21`; UI review
accepted `550757f12f5aed6077d03405c6b573e6e20cb147`. The latter changes only
the session-opening recovery check and its three regressions. Provider-free
adapter tests pass (18), native private-session tests pass (57), public protocol
tests pass (10), and all 159 web tests pass. Across the full baseline and affected
reruns, 1,344 tests pass, with type checking, lint, formatting, and builds for the
affected implementation. Both hosted checks passed for `2bf8f80` in
[run 34064356961](https://github.com/cill-i-am/meal-planner/actions/runs/34064356961).
That run does not establish CI success for a later head.

The actual browser used canonical login/API admission, native production private
sessions and Household state, and a built UI at `2bf8f80`. A temporary scripted
provider sat below the production adapter. The inspected source and bundles
matched the immutable head. The browser proof established:

- Session A persisted a proposal, revised the same card from revision 0 to 1
  through `ReviseProposedProfileCard`, and explicitly confirmed it. Canonical
  profile version advanced from 0 to 1 only after that confirmation.
- Stop after provider dispatch propagated cancellation and retained no late
  assistant output. A separate held request remained pending while the entire
  old process stopped and joined. Restart reused the same SQLite/WAL storage and
  native/UI bundles, preserved messages and the confirmed card, and recovered
  the attempt as interrupted without automatic dispatch.
- After A completed, a fresh B had empty private history. Its model context
  contained canonical profile version 1 and the confirmed fact ID, one B
  message, and no A messages, cards, summary, or private marker. A
  `ReplaceOrdinaryProfileFact` proposal and explicit confirmation advanced
  canonical profile version from 1 to 2.

The [sanitized browser receipt](../../../../evals/private-discovery/browser-proof.json)
records source provenance, bounded assertions, and metadata receipt digests.
The local composition substitutes Nitro for Website Worker SSR, uses the
canonical API test fixture, and enables AbortSignal RPC only in the temporary
provider fixture. It proves local runtime behavior, not cloud deployment,
live-provider protocol compatibility, cancellation guarantees, or model quality.

Browser acceptance identified and fixed bounded recovery, stale equal-version
receipts, resolved conflict notices, and idle directory closure while opening a
session. The final three regressions preserve established-directory recovery
eligibility while retaining binding checks and the consumed recovery allowance.
Final browser acceptance passed against the `550757f` UI, with native bundle
bytes unchanged from the accepted `2bf8f80` build:

- An idle session opening received `SessionReady` followed by a 1008 closure
  before its initial reads. One fresh directory and session admission restored
  five messages and the confirmed revision-1 card. The completed session and
  interrupted attempt remained unchanged.
- A second adult signed in normally to the same household. They could read the
  confirmed shared preference at canonical profile version 2, and could see
  neither the first adult's private sessions nor their private markers.
- Opening a second tab for the same account cleared private content in the
  displaced tab and exposed Reconnect. The active tab recovered session B after
  idle expiry without showing A's content. Socket counts remained 3 to 3 over
  54.594 seconds in the first tab and 33.232 seconds in the second, with no
  repeated connection takeover.

## Remaining external and product gates

No external model calls, cloud mutations, or deployment have occurred. The
product owner must authorize the actual provider/account, synthetic payload
scope, candidate and fixed-judge models, and bounded experiment spend before
execution. The eight-family pack and local trial preparation contain no accepted
model baseline or human scores.

This work item and draft PR #218 remain in progress until candidate
protocol/quality comparison, selected configuration, and actual human calibration
are complete. These local runtime proofs do not satisfy
the evaluated adaptive-discovery outcome or authorize merge.

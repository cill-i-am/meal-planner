# Work Item 03 — Adaptive discovery and evaluation

- Status: In progress (2026-09-06).
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

## External gates and current evidence

The worktree is clean at the recorded base before implementation. Exact locked
dependencies installed successfully using the pinned Node 24.20.0 / pnpm 12.3.4
toolchain. At the implementation handoff, provider-free adapter tests pass (18), the private
native suite passes (57), public protocol tests pass (10), and all 156 web tests
pass. Full workspace type checking, lint, formatting, and builds pass. The full
repository baseline and affected final suites pass 1,341 tests, including an affected architecture rerun after
staging the new production module for the tracked-file inventory assertion.
Actual browser acceptance exposed an idle socket reauthentication path; its
bounded client recovery and receipt/conflict reconciliation now pass fourteen regression cases, affected type checking,
lint and build. Final browser acceptance against the committed source is pending.
Local transport doubles intercept outbound requests and forward
none. No provider/model call, secret read, cloud mutation, or deployment has
occurred in this implementation work. The product owner must authorize the actual provider/account, synthetic
payload scope, candidate and fixed-judge models, and bounded experiment spend
before dependent execution. Safe source preparation and local tests continue.

This work item remains in progress until final browser acceptance,
candidate protocol/quality trials, human calibration, and selected
configuration are complete. Local synthetic tests and an optional native binding
alone do not satisfy the evaluated adaptive-discovery outcome.

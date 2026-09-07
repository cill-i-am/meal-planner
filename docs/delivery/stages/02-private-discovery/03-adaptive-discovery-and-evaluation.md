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

## First authorized live trial — 2026-09-07

The [first live trial result](../../../../evals/private-discovery/first-live-trial.json)
records an early stop at source `a38d20ca9c6ee5b3b18616949d6b4a5353817d4c`. Both Cloudflare
Workers AI candidates passed minimal nonstreaming ChatCompletion and
output-schema probes. Each then failed its first native discovery turn for
`simple_household_baseline` with `invalid_output` under the fixed configuration:
temperature 0, 2,048 output tokens, and a 60-second timeout.

| Candidate | Input / output tokens | Append to completion | Estimated USD |
| --- | --- | --- | --- |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 915 / 508 | 7,387 ms | 0.000219385 |
| `@cf/openai/gpt-oss-120b` | 955 / 2,048 | 39,345 ms | 0.00187025 |

These timings measure retained attempt creation to completion, not provider
latency. GPT reached the output-token cap, consistent with truncation; the exact
cause of either original rejection is unknown because raw output and finish
reason were not retained. Two separate unscored diagnostic probes then used the
same configuration and production payload construction, without the participant
actor or proposal review:

- Qwen finished normally with parseable JSON but an unexpected field at
  `proposals.item.change.fact.additional_property`. The declared output schema
  forbids additional properties in all 27 object definitions. Offline AJV and
  strict Effect checks agreed on valid examples and rejected added properties
  in all three fact branches. This diagnostic violated the declared schema;
  that rejection did not expose a schema/decoder mismatch.
- GPT finished with `length` at 2,048 output tokens and its content was not
  parseable JSON. This establishes an output-cap failure for the diagnostic,
  without proving the exact cause of its earlier response.

The diagnostics used 917 input / 408 output tokens for Qwen and 955 / 2,048 for
GPT, with measured response latencies of 6,111 ms and 33,637 ms. They are
diagnostic evidence, not scored discovery runs.

The trial used six provider attempts: two protocol probes, two native discovery
inferences, and two separate diagnostic probes, with two unique participant
messages. The first four attempts had a token-based estimated cost of USD
0.002220143; the six-attempt estimate is USD 0.004275880. The conservative
attempt gate reserved USD 0.278016. That reservation is a budget bound, not
actual spend, and the token estimate is not an invoice.

The diagnostic process was joined after SIGTERM with exit code 143. Read-only
process and listener checks found no remaining trial native processes or owned
listeners. Storage and journals were preserved. Remote disposal acknowledgement
was not observed; no cloud deletion or revocation is claimed.

Both actual A sessions completed without accepted assistant messages, cards,
confirmations, or a change from canonical profile version 0. Neither native
session continued after its output rejection; no output repair or candidate
reconfiguration occurred. Session B could not run because its required
corrected-and-confirmed fact did not exist. The remaining seven families per
candidate are `not_run`. Semantic hard assertions remain incomplete; the soft
judge did not run and every human calibration row remains unscored. Prior
unchanged-source scripted proofs support shared runtime enforcement, not live
candidate quality or a completed-fixture pass.

## Approved GPT 4,096-token follow-up — 2026-09-07

The [separate follow-up result](../../../../evals/private-discovery/gpt4096-followup.json)
records the approved changed configuration at source
`58e4041d6689ebdf37620f5bd8c011fb64eca490`. Approval retained the cumulative USD
10 budget and allowed at most 73 additional attempts. The original six-call
result remains unchanged.

An initial worker packaging failure occurred before provider dispatch. After
its correction passed independent review and a native local proof, one actual
GPT-OSS 120B readiness request used the 4,096-token cap, temperature 0, and the
existing 60-second timeout. It ended after 60,007 ms with `outcome_unknown`.
No response status, finish reason, content, or token usage was observed. This
does not establish whether the provider eventually completed, consumed the cap,
or produced truncated output.

The failed readiness check stopped the follow-up under the approved plan.
No participant allowance, native candidate run, proposal review, or judge run
started. The participant ledger remained unchanged. Across both trials, seven
provider attempts are reserved against USD 0.325888. USD 0.004275880 remains the
known configured usage estimate for the first six calls; the new call's cost
and the cumulative usage estimate are unknown. The reservation is not an
invoice.

The runner was joined with exit code 1 and recorded awaited runtime and
transport disposal completion. Final read-only checks confirmed the runner was
absent, no gate lock remained, and the permanent dispatch marker and original
six-attempt journal prefix were retained. Cloud preview deletion was not
verified. Readiness supplies no discovery-quality or human-calibration result.

## Schema-instruction retry and first-family checkpoint — 2026-09-07

The [separate retry evidence](../../../../evals/private-discovery/gpt-schema-prompt-retry.json)
preserves the original trial and timed-out follow-up artifacts unchanged. A
controlled V7 diagnostic appended the generated output schema to the system
instructions while retaining GPT's wrapped response format. It returned valid
JSON accepted by the strict schema and adapter: 3,453 input / 410 output tokens,
10,092 ms response latency, and USD 0.00151605 configured estimated cost.
This transformed diagnostic did not execute native participant proposal review.

Production commit `8626bebe705a766e699f6fd3744b0aec68092f59` applies that
instruction change and advances prompt provenance to v2. V8 exercised the
production adapter without a payload transformation and emitted the exact V7
payload digest. It also passed strict readiness: 3,453 input / 420 output tokens,
8,790 ms response latency, and USD 0.00152355 configured estimated cost. Both
requests used a 4,096-output-token cap, temperature 0, and nonstreaming responses;
the fully serialized payload was 22,888 bytes within the unchanged 32,768-byte
guard. Their combined USD 0.00303960 estimate covers these two calls only,
not the retry sequence or cumulative spend. Neither readiness result proves
family quality or human calibration. Both readiness runners recorded runtime
and transport disposal completion; that does not establish cleanup of the later
candidate runtime.

The new `simple_household_baseline` attempt then used the real participant
path, with three accepted assistant outputs and a fourth generation ending in
`invalid_output`. Independent hard review failed `supported_material_facts`:
the second accepted output represented an explicit absence of restrictions as
an actual safety exclusion. The participant rejected that proposal and the
superseded broad preference. A later correct `NoKnownHardConstraints` card was
explicitly confirmed through the admitted path, advancing canonical profile
version 0 to 1. This recovery does not erase the unsupported material claim.

The requested corrected preference was never produced, reviewed, or confirmed.
Ordinary-meal discovery remained unverified because its disclosure trigger did
not occur. The assistant repeated an equipment question after the participant
had no further information. At the reviewed checkpoint A remained open and B
had not started; the other seven families had not run. Prior runtime enforcement
supports scoped authority and privacy checks, without supplying the missing
live correction or fresh-session evidence. No soft judge or human rating was
assigned. The fourth failure retained no new assistant output or card; its exact
output failure cause is not established by this checkpoint.

A separate V9 request used the retained candidate context and the exact
production adapter and proposal review at the same v2 source. Its new response
passed both checks: 4,189 input / 490 output tokens, 15,356 ms response latency,
and USD 0.00183365 configured estimated cost. It did not mutate the native
session or reproduce the fourth failure, so that original failure's cause
remains unknown. The diagnostic recorded completed runtime and transport
disposal. At V9 completion, the cumulative gate had reserved 20 provider
attempts against USD 0.948224; this reservation is not actual spend. Cumulative
usage cost remains unavailable because the original seventh attempt is unknown.
The later local candidate launcher and actor were joined, with no pending actor
operation or retained ledger lock. This did not complete A, which remains open
at session version 13 and canonical profile version 1 in preserved storage.
Main-runtime remote disposal remains unverified.

Prompt v3 made fact selection explicit, prioritized proposed-card corrections,
and honored declined questions while preserving consequential household-context
discovery. Its local checks passed, but its subsequent first live family failed
the required same-card correction: the model added separate refined-preference
cards and left the original proposed card at revision 0. This outcome remains
recorded against source `655392049bdf6c135d30af2d28779e7c150d7702`.

V3 retained four accepted A outputs. It improved known-absence handling, proposing
`NoKnownHardConstraints` only after the explicit safety answer, but did not
discover the required routine; that withheld answer was never disclosed. Manual
rejection of the broad card and explicit confirmation of the refined card
advanced the canonical profile from version 0 to 1. Actual A completion and a
subsequent mutation rejection established its observed read-only behavior. Fresh
B began with empty history and cards and read the actual version-1 profile. Its
first generation failed with `invalid_output`, leaving B open and that profile
unchanged. No B removal was proposed or confirmed. The exact failure stage and
provider usage remain unavailable; the gateway list did not show these five
calls. Application HTTP 204 alone is not successful model-output validation.

The retained A outputs passed closed-change review; observed canonical effects
supported private-until-confirmed and explicit-confirmation checks. Authority
and version checks cover exercised operations only, with no stale-conflict
challenge. Safety remained intact in this empty-constraint fixture, without a
reduction challenge. Supported-material-fact and correction-review assertions
failed. Inspected deferred-capability claims passed scope-truthfulness review,
with ambiguous profile-saving wording remaining a clarity concern. Privacy and
authorization remain unverified from these logs alone; clean B state is not raw
context or cross-adult transport proof. The reviewer inspected actual logs; the
root separately verified artifact hashes and preserved journal prefixes. No
global hard-assertion pass, soft judge, human score, or accepted baseline follows.

The cumulative reservation now covers 25 provider attempts and USD 1.187584;
this is not invoice or actual spend. Higher-cap calls used 19 of 65 and judge
calls used 0 of 8. Participant intents reached 10 of 13, with the ledger in B
and A resumption prohibited. All five known local processes were verified
absent; actor join exit status was unavailable and the web child required
forced termination. No actor operation or ledger lock remains pending.
Main-runtime remote disposal remains unverified.

Prompt v4 explicitly treats a correction, refinement, or narrowing as a revision
of the existing proposed card, even without directly contradictory wording. It
maps the input card's `id` to `cardId` and `revision` to `expectedRevision`, and
requires the complete corrected nested change. The model, schema, caps, and
authority boundaries remain unchanged. Existing adapter tests (19), native
context and revision tests (5), lint, formatting, and API type checking pass.
These local checks did not establish live quality or supersede earlier failures.

The v4 trial at source `1a965e9134f61c39f0e2398b5a3861529cd926de` stopped after
two schema-valid native outputs. After the explicit correction, the original
card stayed at revision 0 while two new cards were added. Independent review of
the first 18 actor responses failed correction review and supported material
facts; only the early supported-proposal check passed. No safety or routine
answer, confirmation, A completion, or B transition was exercised. The root's
last four response lines separately establish A open at version 4, an empty
canonical profile at version 0, no pending confirmation, and actor closure.

The same source adds one fixed `private_discovery.invalid_output` event with a
closed internal stage after an eligible terminal failure. Public failure fields
remain unchanged. All 63 native and 27 adapter tests pass, including private-data
exclusion, terminal replay, and no partial persistence; type, lint, formatting,
and local capture checks pass. Zero live diagnostic events are expected because
both outputs passed validation. Earlier `invalid_output` causes remain unknown.

Source, emitted-bundle, native-context, and retained-state review found no
omission of the earlier card's identity, revision, or change, no size-limit
trimming, and no revision remapping. The emitted prompt includes the v4
instructions. This was not direct provider wire evidence. That context-path
review found no actionable defect; the subsequent native contract audit below
identified a separate request-shape defect.

V4 added two provider reservations and two participant admissions. The cumulative
reservation is 27 attempts and USD 1.283328, not actual spend. Higher-cap calls
used 21 of 65; judge calls remain 0 of 8. The 79-call maximum and USD 10 budget
are unchanged. The activated participant allowance retains ten earlier intents
and leaves six of 18 unused after two fresh A admissions. Both earlier journal
prefixes were verified unchanged.

The actor supervisor joined successfully and the launcher joined after SIGTERM.
All five known local processes and trial-port listeners were verified absent.
The stale spend lock was removed after owner absence and unchanged journal hashes
were verified; no actor operation or ledger lock remains pending. Cleanup did not
complete A, and remote-preview disposal remains unverified. The
[retry record](../../../../evals/private-discovery/gpt-schema-prompt-retry.json)
contains the metadata receipts, scoped review, and diagnostic proof.

## Native request contract and bounded probe

Commit `55a34ea49b0429b86aa8c64826acf8843b8c6f2c` removes the GPT-OSS
`name/schema/strict` wrapper: native Workers AI receives the actual generated
schema directly at `response_format.json_schema`. Cloudflare's
[pinned native implementation](https://github.com/cloudflare/ai/blob/917c02430090e7d511abf138091a2c17135515b2/packages/workers-ai-provider/src/utils.ts#L283-L328)
and [GPT-OSS regression test](https://github.com/cloudflare/langchain-cloudflare/blob/f77a64012e49935fabc10809706ae3020046b32b/libs/langchain-cloudflare/tests/unit_tests/test_chat_models.py#L651-L678)
establish the intended contract. The old GPT request failed the new boundary
assertion; all 27 adapter tests, type, lint, and formatting checks pass after the
fix. The prompt, generated schema, decoder, review, and model settings are unchanged.

The two-call `contract-probe-v2` used freshly captured native context and the
retained synthetic dialogue and summary. A used the corrected full schema; B
removed only the new-proposal branch. Both returned HTTP 200 with finish reason
`stop`. A passed production decoding and review but proposed two new cards,
leaving the original correction unresolved. B failed `invalid_output` at
`output_json`: a literal trailing NUL made its content invalid JSON. Formal B
schema and proposal review were not reached. Diagnostic inspection of its first
JSON object found an unchanged revision plus two excluded new proposals; this
was neither accepted nor repaired or replayed.

Neither response supplies an accepted same-card correction. This pair is not a
before/after wrapper test and does not establish the historical failure cause.
Local native capture and five harness cases passed, but do not confer model
quality. Exactly two reservations advanced totals to 29 calls and USD 1.379072,
with 23 of 65 higher-cap calls used and no judge calls; these are reservations,
not invoices. Earlier financial and participant journal prefixes were preserved.
The runner joined, runtime and remote transport disposal completed, and matching
local processes were absent. No participant admission or application mutation
occurred. V1 preparation remains preserved and was never dispatched. The
[retry record](../../../../evals/private-discovery/gpt-schema-prompt-retry.json)
contains the source, request, result, independent review, and closure digests.

## Remaining product gates

No configuration or human baseline is accepted. Work Item 03 and draft PR #218
remain in progress and are not ready to merge. The original stopped trials and
the failed prompt-v2, prompt-v3, and prompt-v4 families remain recorded. Candidate comparison,
model-produced same-card correction, successful B removal, and actual human
calibration across all eight fixtures remain incomplete. The canonical evidence
and calibration templates remain unfilled; readiness and checkpoint records do
not replace them. No application deployment occurred.

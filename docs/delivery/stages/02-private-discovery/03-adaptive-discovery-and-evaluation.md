# Work Item 03 — Adaptive discovery and evaluation

- Status: In progress (2026-09-10); [draft PR #218](https://github.com/cill-i-am/meal-planner/pull/218), not ready to merge.
- Authorized by the product owner to continue after Work Item 02.
- Implementation base: `c07e48c6f6709f02c054e5110cb7178a9e5d1b93`.
- Owning stage: [Stage 2](README.md).

## Current evaluation status

The latest [GPT-OSS v16 result](../../../../evals/private-discovery/prompt-v16-planning-purpose-results.md)
stopped at a proven semantic truthfulness/authority failure. Both native calls
succeeded, but the second assistant reply falsely represented the preference
replacement as completed. That claim persisted in actual history while only an
unconfirmed proposed card existed and the whole canonical profile remained at
setup version 1. There was no unauthorized canonical mutation. Early Review,
missing dependency/safety discovery and omitted circumstance continuity remained
separate limitations. No family or baseline acceptance was earned.

The [Qwen v16 comparison](../../../../evals/private-discovery/prompt-v16-qwen-sampling-results.md)
then stopped after one native success and one actual captured `output_json`
rejection. The second response contained an extra closing brace and a tool-response
suffix. No second reply, card or note update persisted; the first native state
and whole canonical profile remained unchanged. Raw-only confirmation concerns
were not admitted or validated downstream. Neither configured candidate is
accepted for discovery.

One [isolated Qwen native-tool diagnostic](../../../../evals/private-discovery/qwen-native-tool-serialization-diagnostic-results.md)
used retained pre-second-turn context and a named inert function. It produced a
genuine nested function call with complete JSON string arguments. The frozen
inspector rejected top-level aliases and empty/null legacy fields before reaching
argument validation; that original result remains unchanged. Separate offline
inspection of the untouched native arguments passed both source output schemas,
then the source continuity validator failed at `reply_decision` because Ask
targeted a circumstance note. The reply also sought conversational confirmation
of an already stated intent. The observation is not a discovery pass or
production integration.
No household or native-session settlement, function execution, provider retry,
family replay or malformed-output salvage occurred.

The [first Kimi K2.6 evaluation probe](../../../../evals/private-discovery/kimi-first-probe-results.md)
reached the 120-second deadline without a captured provider HTTP status, response
body or usage receipt. The native outcome is unknown. JSON parsing, source-schema,
continuity and semantic checks were not reached, so no model-quality conclusion
or discovery grade is supported. Its single 265,421 micro-USD reservation remains
retained; unknown usage is not zero. Local runtime and transport disposal do not
establish provider cancellation or credential revocation.

The [tiny structured-output baseline](../../../../evals/private-discovery/kimi-structured-output-baseline-results.md)
returned HTTP 200 and the exact expected boolean object in 2,006 ms. This proves
only that minimal structured-output request completed. The separate
[clean full opening](../../../../evals/private-discovery/kimi-clean-opening-probe-results.md)
again reached 120 seconds without a provider response or usage receipt; its
outcome and all output grades remain unknown. Both unknown full-request
reservations remain retained.

The [full-schema control](../../../../evals/private-discovery/kimi-full-schema-control-results.md)
returned HTTP 200 and the fixed expected object in 3,009 ms using the unchanged
full schema with constant minimal messages. It proves that control completed,
not interview quality, general schema reliability or the cause of either timeout.
The [JSON-object opening comparison](../../../../evals/private-discovery/kimi-json-object-opening-results.md)
returned HTTP 200 in 12,193 ms. Compared with the clean full opening, it retained
the production messages and changed only the response-format setting. Strict source output and continuity
validation and manual reference review passed, but semantic review failed: the
model proposed removal while its own note acknowledged that the intended change
was unclear. The reply duplicated its question and omitted the card-review
invitation. No native settlement or discovery acceptance followed. These four
results retain source `19bd597` provenance: the interview openings used prompt
v16, while the two controls used their own constant prompts.

The [v17 JSON-object opening](../../../../evals/private-discovery/kimi-v17-json-object-opening-results.md)
returned HTTP 200 in 9,335 ms. Source output/card-context schemas and continuity
checks passed; root and independent review accepted the narrow opening behavior.
The disclosed routine was retained, intended change remained unresolved, and
zero proposals were emitted. One clarification question appeared in Ask.question,
with no question in Ask.text. Reference review was inapplicable without proposals;
card-review invitation and confirmation were not exercised. No native household
settlement or family acceptance occurred. Only the production system prompt
changed from the preceding JSON-object opening, with context and schema retained.
The result does not establish sustained behavior, a general prompt effect or the
cause of earlier timeouts. Its source is `ebce8ed5`, and the earlier semantic
failure remains unchanged historical evidence.

A [two-turn native dependency checkpoint](../../../../evals/private-discovery/kimi-v17-native-dependency-checkpoint-results.md)
on source `a8305f5f` retained two successful assistant turns and one supported
unconfirmed replacement card, with the whole canonical profile unchanged at
version 1. A local inspection command error ended the participant process before
further work; it caused no provider call or participant intent. The family stayed
incomplete, with neither a pass nor a candidate-failure verdict. Both turns
duplicated their question across fields. No confirmation or fixed judge ran.

The [first full native Kimi family suite](../../../../evals/private-discovery/kimi-v17-native-baseline-failure-results.md)
on the same source then stopped at its first simple-household turn.
The response passed JSON and output-schema
validation, but Ask referenced a missing unresolved note. The native
`reply_decision` guard rejected the response before persisting an assistant reply,
card or continuity update; the whole canonical profile remained at version 0.
Question text also appeared in both Ask.text and Ask.question, a separate prompt
failure rather than the rejection's cause. No family or baseline was accepted.
The original failed response remains failed; it is not repaired or regraded.

V18 retained policy v3 and the JSON-output field set while changing the prompt
and shared output-schema declaration order to
proposals, reply, then continuity. Ask.topicKey must exactly match a note that
is unresolved after the response's updates: either an existing unresolved note's
key or a complete new unresolved note supplied in continuity. Known circumstances
remain separate. The acknowledgement/review invitation stays in Ask.text and the
sole question in Ask.question. This may make the question-to-note dependency
easier to generate; ordering is a hypothesis, not a proven cause or a demonstrated
fix. Schema serialization and its provenance hash change; field types, validation
rules, note/input/persistence schemas and native guards do not. Missing or
non-unresolved note references still reject atomically, with no inferred note,
key repair or output salvage. This source change alone did not establish model
acceptance.

The [v18 native suite](../../../../evals/private-discovery/kimi-v18-native-suite-stop-results.md)
on source `5bfdaa61` recorded six successful native turns: two in the baseline
and four in adult routines. The baseline remained harness-incomplete: its
original-card review returned `ok:false`, but root continued with a correction.
The model produced a supported revision without restoring the missing original
review receipt. That review failure's cause remains unproven; no family verdict
was earned. The fifth adult-routines turn returned complete
HTTP 200 output, then failed `output_schema` because it emitted seven continuity
updates against the six-update limit. Five notes repeated retained notes
unchanged; two were new. Both the exact captured request schema and the frozen
source permitted `no_information`; that state was not the failure. Inert decoding
of the untouched output reproduced only the array-length error in both source
output schemas. Earlier assistant messages, card and summaries were preserved;
the failed turn stored no new assistant reply, card or continuity, and the whole
canonical profile stayed unchanged.

The rejected raw output also proposed the existing unchanged draft again and
duplicated its question across Ask.text and Ask.question. Native proposal review
was not reached; its existing duplicate guard remains in place. No output repair,
retry, family pass or accepted baseline followed. Six other families were unrun;
no fixed-judge or human-calibration result was obtained.

The production source now specifies prompt v19. It explicitly requires only new
or changed continuity notes, leaves omitted notes retained automatically and
returns an empty array when none change. Emitted notes remain complete updates,
including the required unresolved note for a newly chosen Ask topic. Proposals
likewise contain only new or revised card operations; unchanged drafts require
no operation. Ask.text must not contain or rephrase the question. These are
prompt-only clarifications of existing behavior. The output schema and its order,
policy v3, validators, update limits, card operations, persistence, sampling and
authority remain unchanged.

The [v19 run](../../../../evals/private-discovery/kimi-v19-native-suite-stop-results.md)
on source `47779591` recorded nine candidate calls: eight
native successes and one `reply_decision` rejection. The second dependant turn
again named an unresolved Ask topic without supplying its note. Baseline coverage
remained incomplete without a demonstrated harness bug. Adult routines exposed
a material operation-selection and profile-synthesis defect: the model revised
an existing draft for an additional preference, losing the original draft's
supported distinction. That observation alone did not establish an enumerated
hard-invariant failure. Adult routines completed natively and passed 11 hard
assertions, with its full-history defect retained. One fixed judge scored
household specificity 4/5 and profile synthesis 3/5; `possibleHardFailure` was
null. These are model scores without an accepted-baseline comparison or human
calibration. Five other families were unrun; no family, human baseline or
discovery release was accepted.
Qwen3-30B-A3B FP8 retains `temperature: 0.6`, `top_p: 0.95` and `top_k: 20`, using
[Cloudflare-supported fields](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8/)
and values from [upstream guidance](https://huggingface.co/Qwen/Qwen3-30B-A3B-FP8#best-practices).
Cloudflare's thinking default is undocumented. GPT-OSS remains at temperature
1/top-p 1 without top-k, and the fixed judge is unchanged. Kimi K2.6 is now
selectable alongside those candidates through the existing configuration for
the approved synthetic evaluation within the remaining portion of the existing
$20 cap. Configuration remains disabled by default; this change selects no
model in a deployed environment and authorizes no real-household data use.

Kimi's explicit request branch retains the production system/context messages
and full embedded schema, with `response_format: { type: "json_object" }`,
`chat_template_kwargs: { thinking: true }`, temperature 1.0, top-p 0.95, `n: 1`
and non-streaming output. `max_completion_tokens` uses the existing configured
cap of at most 4,096. GPT/Qwen requests are unchanged. The strict canonical
completion and output decoders, native continuation checks, gateway privacy
controls, request/response bounds and authority remain unchanged. No SDK upgrade,
thinking alias, parser repair or alternate output path is introduced.

This next configuration uses Cloudflare's documented
[`chat_template_kwargs.thinking` field](https://developers.cloudflare.com/changelog/post/2026-04-20-kimi-k2-6-workers-ai/)
and matches [Moonshot's K2.6 thinking temperature of 1.0](https://platform.kimi.ai/docs/api/models-overview).
Cloudflare's [model contract](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/)
accepts the temperature and completion-cap fields. Prompt v19 and both output
schemas remain byte-identical; policy v3, sampling for GPT/Qwen, all token/time
bounds, the 65,536-byte whole-response limit and the fixed judge are unchanged.
Any future evaluation result applies jointly to thinking enabled and temperature
1.0. No model-quality improvement has been demonstrated for this configuration.

Separate Cloudflare `reasoning` metadata is ignored by the existing envelope
decoder. Only final `message.content` is decoded into the strict output schema;
reasoning cannot substitute for missing, incomplete or invalid final content.
The token estimate uses reported aggregate completion tokens without adding
reasoning-token details again. Thinking may leave less room for final JSON under
the unchanged output, response-size and time bounds; a successful completion is
not guaranteed. Existing native provenance records model, prompt, policy and tool
versions but not thinking mode or temperature. Exact source-head and request
settings in each frozen evaluation record distinguish the configurations.

Focused validation passed 73 adapter/continuity tests, API types, lint and
formatting. Existing zero/one/two-card request cases now exercise separate
reasoning metadata and token details while retaining only final output and
aggregate usage. Kimi cases reject reasoning-bearing length termination and
null final content, alongside malformed JSON and invalid output schemas. These
checks establish the local adapter contract, not native model quality.

The existing usage estimate applies the configured input and output prices to
all reported tokens. With Kimi rates of $0.95/$4.00 per million input/output
tokens, it conservatively ignores input-cache discounts. The separate diagnostic
reports retain their cache-aware estimates where measured; neither estimate is
an invoice. Unknown usage and cost remain null.

The Kimi adapter addition passed 71 adapter and continuity tests, including seven
new Kimi cases for exact request fields and embedded card-context schemas, provenance,
configured-rate and unavailable usage, malformed/schema-invalid output, and
request rejection before dispatch. API types, lint, formatting and asset checks
passed without changing the SDK or decoder. This proves the local adapter
boundary; full native family acceptance and release acceptance remain pending.

V18 passed the existing 71 adapter/continuity tests and nine native atomic
rejection cases, including Ask targeting a missing or circumstance note. API
types, focused lint and formatting passed. Existing provider-schema assertions
cover the intended order for zero, one and two eligible cards. Reversing only
the new top-level property and required-array order reproduces the previous
zero-card JSON schema exactly; no validation rule changed. These are local
contract checks, not model-quality or family acceptance.

V19 passed the existing 71 adapter/continuity tests and 14 native cases covering
omitted-note retention across restart, mixed updates, atomic rejection and
duplicate proposals. API types, focused lint and formatting passed; no
prompt-wording tests were added.
The zero-card provider schema remains byte-identical to v18.

V17 gives genuinely unclear intended profile effects or targets priority over
downstream routine questions and withholds proposals that depend on the answer.
Already-explicit intent is not asked again. Drafts are offered as their effect
and target become clear; Ask.text contains the acknowledgement/review invitation
without questions, and Ask.question contains the sole question. The redundant
later clarification sentence is removed. This is a general prompt correction,
not an output-schema, authority or persistence change. The single opening now
supports its narrow prerequisite; later explicit-intent, draft review and sustained
discovery behavior remain unverified.

The prompt preserves the accepted practical planning purpose of the adult
interview, grounded in the
[experience blueprint](../../../product-blueprint/experience-blueprint.md#2-run-private-repeatable-adult-reviews).
The two scenario challenge expectations still require reviewing the visible card
and using its Confirm action without repeating already-explicit intent in chat.
They and the rubric are unchanged by this correction; no scoring dimension,
threshold or framework is added.

The retained v15 model output contract is
`continuity: Note[]`: at most six complete note updates. A new key creates a note;
a retained key replaces its complete subject, detail and state in the existing
position. New notes append in update order, omitted notes remain, and duplicate
keys within one update list reject at `continuity_updates`. The old
additions/revisions object rejects at `output_schema`, without a compatibility
parser or output repair. Seven updates likewise fail the schema's array limit
before native settlement. `private-discovery-policy-v3` versions this private
model-output contract change, not household authority.

This intentionally removes the unknown-revision guard: a mistyped new key now
creates a note and may duplicate context. Semantic key identity remains the
model's responsibility; replacing the wrong existing key was already possible.
The narrower protocol does not establish truthful notes, relevant questions or
live discovery quality. Its first live phase completed native updates but did not
earn discovery acceptance.

The input and persisted snapshot schema, strict JSON codec and WI03 TEXT column
remain unchanged. The native child validates note fields, update/retained/byte
bounds and reply decisions before any generated message, card or snapshot writes.
The resulting snapshot still contains at most twelve notes and 4,096 UTF-8 bytes.
Ask renders the exact model-authored acknowledgement and question; Stop leaves
the native session open for explicit participant completion. Existing profile-card
operations, privacy, confirmation and provider caps remain unchanged. The
[architecture record](../../../architecture/decisions/0004-household-agent-coordinator-and-isolated-chat-agents.md#structured-private-discovery-continuity--2026-09-09)
owns the contract and its tradeoff.

GPT-OSS remains at `temperature: 1` and `top_p: 1`, following
[OpenAI's recommended parameters](https://github.com/openai/gpt-oss#recommended-sampling-parameters)
within [Cloudflare's supported request fields](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/).
The prior v14 revision combined GPT framing and sampling, so its result isolates
neither cause nor effect; no loop fix or general improvement is claimed.

V15 local validation passed 24 continuity tests, 40 adapter tests and twelve
focused native continuity cases. These cover mixed creation/replacement with a
card, full subject/detail/state correction, stable order, omission retention,
restart and fresh-session isolation, distinct no-information/refusal states, exact
question rendering and atomic rejection. Eleven native cases passed initially;
the mixed case passed after correcting its incomplete expected fact shape in the
test, with no production change between runs. API types, lint and asset validation
also passed. The Qwen-only sampling change passed 40 adapter tests, API types,
lint and asset validation. Exact request assertions cover Qwen 0.6/0.95/20 and
unchanged GPT 1/1 without top-k, along with strict fields and gateway controls.
These historical source checks retain their original scope. V17 passed all 64
focused adapter and continuity tests, API types, lint and evaluation asset
validation. The only test edit advances the expected prompt provenance. No
native-runtime code changed or native suite was repeated; these checks do not
establish live semantic improvement.

The generated model output schema matches all three retained v15 requests
exactly: 5,285 bytes with no eligible card, or 9,307 bytes for its one-card context.
Historical v16 packing used a 6,900-byte prompt. With that prompt and contexts, Qwen's
new sampling fields add 26 serialized body bytes over its previous temperature-0
configuration. Packing checks rebuilt twelve retained H10/H11 contexts with the
same illustrative five-note snapshot (783 bytes). The largest Qwen provider body
was 30,908 of 32,768 bytes (1,860 remaining); its capture envelope was 31,110 of
40,000. A size-only successor projection reached 31,380 bytes, leaving 1,388.
These are packing checks, not a live Qwen trial, admitted fixture turns,
reconstructed semantic state or quality evidence. Larger valid combinations can
still reach the unchanged pre-dispatch limit.

V17's prompt is 7,192 bytes, 292 more than v16. Both generated output schemas
remain exactly unchanged at 5,285 bytes without an eligible card and 9,307 bytes
for the retained one-card context. Reusing the same twelve illustrative packing
contexts, the largest Qwen body is 31,200 bytes, leaving 1,568 of the unchanged
32,768-byte limit; its envelope is 31,402 bytes. The size-only successor projection
is 31,672 bytes with 1,096 remaining. These are packing measurements, not admitted
turns or semantic evidence; other valid contexts can still reach the existing
pre-dispatch limit.

Earlier [v15](../../../../evals/private-discovery/prompt-v15-keyed-continuity-results.md),
[v14](../../../../evals/private-discovery/prompt-v14-reply-sampling-results.md),
[v13](../../../../evals/private-discovery/prompt-v13-circumstance-framing-results.md),
[GPT-OSS v12](../../../../evals/private-discovery/prompt-v12-continuity-state-results.md),
[Qwen v12](../../../../evals/private-discovery/prompt-v12-qwen-comparison-results.md),
[v11](../../../../evals/private-discovery/prompt-v11-continuity-results.md),
[v10](../../../../evals/private-discovery/prompt-v10-effects-results.md),
[v9](../../../../evals/private-discovery/prompt-v9-duties-results.md),
[v8](../../../../evals/private-discovery/prompt-v8-schema-results.md),
[v7](../../../../evals/private-discovery/prompt-v7-two-phase-results.md), and
[v6](../../../../evals/private-discovery/prompt-v6-eight-family-results.md)
remain unchanged historical evidence with their original shapes and provenance.
Earlier implementation proofs below do not establish v19 live acceptance.

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
returns a bounded array of complete continuity note updates, bounded new-card/proposed-card-revision
operations, an Ask/Review/Stop reply, and usage/provenance. A card revision names only a current
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
never changes terminal status or restores text, cards, continuity, or socket output.

The context keeps the whole current own-profile projection, at most 16 recent
messages, at most 25 private cards, and structured private continuity. Each note
has a key (1–32 characters), subject (1–120), detail (0–200), and a state:
`circumstance`, `unresolved`, `answered`, `no_information`, `declined`, or
`withdrawn`. There are at most 12 retained notes and six complete keyed updates
per turn; the serialized snapshot must fit 4,096 UTF-8 bytes. A new key adds a
note; a retained key replaces its subject, detail and state in place. New notes
append in update order and omission retains prior notes. Duplicate keys within
one update list are rejected. The old additions/revisions output object is
rejected without normalization; there is no eviction or free-text fallback.

Ask names an unresolved retained or updated note. Review rejects any remaining
unresolved note; Stop represents an explicit request to stop discussion and never
completes the session. These are private model decisions, not new browser commands.
The child joins Ask's model-authored text and question with two newlines and
checks their combined 2,000-character limit. Review/Stop emit their text unchanged.
The resulting snapshot is validated and encoded through one JSON codec in the
existing `private_assistant_turns.summary` TEXT column, atomically with the reply,
reviewed cards, and successful turn. A fresh session starts with empty continuity.

Context preparation trims older messages and cards, never canonical facts or
continuity notes. Oversized context is rejected before provider dispatch. The
24,576-byte context bound, 32,768-byte fully serialized provider body, and
65,536-byte raw response cap are unchanged. Card operations remain limited to
three. The separate evaluation transport keeps its 40,000-byte request-envelope
cap. Declared individual bounds do not guarantee that every maximum-sized
combination fits the provider body; the existing bound is enforced without a
new trimming architecture. Model output-token and duration limits remain
explicit. No fixed question count constrains the product conversation.

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

## Correction diagnosis and prompt v5

A six-call diagnostic ladder separated copying, correction meaning, and
operation selection. Exact copying and corrected meaning passed. The ordinary
narrow-schema operation request failed twice; an instruction-only
explicit-revision control passed twice, including the existing identity,
revision, and corrected value. This established instructed ability and an
ordinary selection failure. It did not identify a provider cause or prove a
production fix. The later full-schema ladder levels were not dispatched.

Commit `3670c26e3d7ab9154a264850a308bc5813d1c5dd` advances the production prompt
to v5. It compares and revises existing cards first, proposes separate new
facts, then writes the reply from the emitted edits, with a generic mixed
correction example. The full generated schema, strict decoder, proposal review,
model, settings, and authority boundaries remain unchanged. All 27 adapter
tests, four focused native revision tests, API type checking, lint, and
formatting pass. Preparation also passed 33 scoring cases and 13 native fake
invocations.

On 2026-09-08, four live requests using the full production v5 instructions and
schema passed strict decoding, production proposal review, and their scoped
card-operation checks. The ordinary correction passed twice with the exact
existing card identity and expected revision 0. A separate mixed control
selected the second existing card at revision 2, left the first card untouched,
and proposed the additional supported preference. A new-information-only control
proposed exactly one supported card and no revisions. The ordinary requests
reuse the earlier native context; the mixed and new-only contexts are
constructed synthetic controls. The prepared narrow candidate and fresh v4
baseline were not dispatched.

These four results are request-level only: no participant admission or
application state mutation occurred. Independent review accepted the card
operations but found reply limitations: none of the four replies explicitly
marked the cards as drafts or needing review, and ordinary replies strengthened
or inferred preference wording beyond the supplied facts. None claimed a
canonical save. These limitations remain separate from the successful
card-operation checks. These four observations do not establish reliability
across a full family or replace human calibration.

A separate native proof then used one scripted seed turn and one real-model
correction in a new disposable session. The actual production session persisted
revision 0 to 1 under the same card identity and ordinal, with one separate
supported preference and no corrected duplicate. The assistant turn succeeded,
and no confirmation was pending. Actual Household API reads and canonical SQL
rows were unchanged at profile version 0. After shutdown, read-only queries of
byte-verified copies of the private and canonical SQLite files, including their
committed journals, matched the live projections; the originals stayed
unchanged. This proves the bounded model correction persisted as a private
draft. It does not prove a fully live interview, explicit confirmation, restart
recovery, or B. The live reply retained the missing review cue and
inferred-temperature wording limitations; its emitted facts were correct.

The persistence harness passed eight local cases. Invalid JSON, trailing NUL,
wrong-target and unknown-outcome cases failed the turn and preserved the
original draft. Stronger or semantically duplicate extras were rejected by the
scenario scorer after production accepted and persisted them; those checks are
not production guards.

The six-call ladder and four candidate calls advanced cumulative reservations
from 29 to 39 attempts and from USD 1.379072 to USD 1.857792. Higher-cap calls
used 33 of 65; judge calls remain 0 of 8. Reservations are not actual spend. The
79-call maximum and USD 10 budget are unchanged. Each candidate runner and
runtime closed, remote transport disposal completed, matching local workers and
locks were absent, and earlier financial prefixes, the participant journal, 42
harness pins, and 851 protected nonfinancial files were verified unchanged. The
separate persistence call advanced totals to 40 attempts, 34 higher-cap calls,
no judge calls, and USD 1.905664 reserved. It used one separately scoped
synthetic admission and preserved the old participant journal; 40 harness pins
and 915 protected nonfinancial files were unchanged at closure. The socket,
runtime, and remote transport closed, with no matching worker or lock remaining.
No output repair or automatic retry occurred. The [retry
record](../../../../evals/private-discovery/gpt-schema-prompt-retry.json)
contains the metadata results and receipt digests.

## Remaining product gates

No configuration or human baseline is accepted. Work Item 03 and draft PR #218
remain in progress and are not ready to merge. GPT v16 persisted a false
completed-update claim despite unchanged canonical state; Qwen v16 stopped at
JSON decoding. The isolated tool diagnostic observed a genuine function call but
failed source continuity validation offline and provided no native settlement or
discovery acceptance. Kimi's two full-schema interview requests remain unknown
after their deadlines. The tiny and constant full-schema controls passed only
their bounded checks; the JSON-object interview opening passed structural and
reference checks but failed semantic review. A single v17 opening subsequently
passed the narrow clarification prerequisite with zero proposals; card review,
confirmation and sustained behavior remain unexercised. Kimi's explicit
JSON-object request branch is locally supported for the approved synthetic
evaluation, with configuration disabled by default. Full native family evaluation
stopped on its first v17 turn at `reply_decision` for a missing unresolved note,
before any assistant reply, card or continuity update persisted. V18 changes
generation order and makes the existing exact-note requirement explicit. Its
native suite recorded six successes before the seventh call failed the
six-update limit; no family was accepted. V19 clarifies that continuity and
proposal output contain only changes. Its native run recorded eight successes
and another missing-note `reply_decision` rejection, with incomplete baseline
coverage and a separate adult-routines synthesis defect. One fixed judge ran;
five other families and human calibration remain incomplete. The next Kimi
configuration enables thinking at temperature 1.0 with the same v19 prompt;
its model behavior is unverified. Output fields, order and validation, policy
and household authority remain unchanged. Full native family acceptance is pending.
Passing native discovery across all eight families, the completed candidate
comparison, the required live A-to-B removal, fixed-judge scoring and actual human
calibration remain incomplete.
Earlier scripted and bounded proofs do not replace those gates. The canonical
evidence and calibration templates remain unfilled. No merge or application
deployment is authorized by these results.

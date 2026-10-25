# Authenticated MCP client verification

## Environment and scope

24 October 2026. Official MCP Inspector **2.12.0**, web UI and its `mcpdo`
CLI, using protocol **2026-07-28** against `https://ceird.app/mcp` at
`d8f00e04d027c1f2337a4c830130e7b6a8a2f959`. A newly registered account and
family isolated every mutation from existing families. Credentials, raw client
state and opaque task identifiers are private local artifacts, excluded here.

## Observed with the hosted server

- Browser OAuth dynamic registration, PKCE, consent denial and consent acceptance.
- Read/write access and refresh credentials issued; refresh exchange **not tested**.
- Discovery of 53 tools, the Tasks extension and form elicitation capability.
- Family creation, two asynchronous import Tasks, polling and reconnect using the
  same OAuth client.
- Cancellation and terminal replay: repeated cancellation preserved status and
  timestamp. Terminal `tasks/update` acknowledged an unused response.
- Server-side consent revocation, verified absent afterward. A subsequent client
  read required fresh consent, which was denied.

These observations establish this Inspector's behavior, not compatibility with
ChatGPT, Claude, Cursor or Durable Pi. Capability negotiation alone does not
establish successful elicitation.

## Failure found

Both imports remained at public intent version 1 (`resolving_source`). They were
cancelled after 194 and 210 seconds. Read-only Cloudflare diagnostics showed both
workflows errored within seconds, with **no durable steps recorded**. The only
household startup call was `readRecipeImportExecution`.

That query requires a resolved canonical source. Workflow startup called it to
obtain the submitted URL *before* resolving the source: a circular precondition.
The new native Worker/SQLite regression reproduced `HouseholdRecipeImportFailure`
with `reason: illegal_transition` before changing that read.

The repair introduces an internal, lifecycle-authorized submission query. It
requires the current execution generation and a processing intent, and exposes
only the submitted URL. Source preparation uses it before resolution. The
resolved execution query retains its stricter recovery invariants. Existing
workflow step names, mutation identities, evidence, provider accounting and
publication authority are preserved.

The same production preparation operation is exercised through native household
RPC in the regression, including replay, stale generation, cancellation, original
trace persistence and rejection of an unauthorized system purpose.

## Reproduce locally

Use the repository's pinned Node and pnpm versions, then:

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/households/household-boundary.integration.test.ts \
  -t 'starts source resolution from an unresolved admitted import'
pnpm --filter @meal-planner/api check
```

This is a native runtime/database regression, **not a live provider evaluation**.
The canonical test source needs no network fetch and no provider call.

## Repeat the hosted-client checks

Install `@modelcontextprotocol/inspector@2.12.0`. Use a private catalog and
credential directory, the encrypted file secret store, localhost binding and
Inspector authentication. Configure the HTTP connection with `protocolEra:
modern`, `elicitCapability: form` and OAuth scopes `meal-planner:read
meal-planner:write offline_access`. Complete normal browser login and consent
with an isolated test account.

Create a family through `families_create`, then use its returned `familyId` in
`recipe_import_intents_create`, with a stable idempotency key and public TikTok
source. Record the returned Task ID privately. With the same client store:

```sh
mcpdo --stored-auth-only connect meal-planner-live
mcpdo @meal-planner-live tools/list
mcpdo @meal-planner-live tasks/get "$TASK_ID"
mcpdo disconnect meal-planner-live
mcpdo --stored-auth-only connect meal-planner-live
mcpdo @meal-planner-live tasks/get "$TASK_ID"
mcpdo @meal-planner-live tasks/cancel "$TASK_ID"
mcpdo @meal-planner-live tasks/get "$TASK_ID"
```

Inspect the import and its current review action before attempting confirmation.
Test decline, dismissal and acceptance separately, and check domain state after
each response. Check stale-version rejection and receipt replay explicitly.

Inspector 2.12.0 `disconnect --clear-auth` clears local credentials only. Revoke
the specific test client's consent through Meal Planner's native OAuth API and
verify absence before clearing local credentials. Do not publish secrets or
opaque continuation tokens with test evidence.

## Production continuation after PR #309

PR #309 deployed `9e23584e520cd6682971e12beca8933553f4ea47` through
[production CI](https://github.com/cill-i-am/meal-planner/actions/runs/40121969878).
All required checks passed; an existing recipe-evaluation test timeout passed on
a single job retry. The same isolated account and OAuth client were used.

Two fresh imports passed source resolution and media acquisition. One completed
speech transcription. This verifies the startup repair against production.
Neither reached a reviewable draft:

- The first visual response lacked the required tool call. The safe diagnostic
  was `forced_tool_missing`; settlement remained unknown. The accounting gate
  marked that invocation's budget uncertain. No replacement call was dispatched.
- The second import reported a speech `outcome_unknown`. Its diagnostic sequence
  did not include a provider-dispatch event. This is not evidence of a completed
  speech call or permission to retry an ambiguously settled invocation.

Both imports exposed a second defect: terminal persistence returned a decoded
checkpoint containing an Effect `DateTime`. Cloudflare rejected it with
`DataCloneError`, leaving public progress active. The repair returns only the
validated ownership ID needed by the next domain transition. A native Workflow
regression reproduces the exact serialization error before the repair and proves
successful checkpoint replay afterward, without repeating the persistence body.
The household responses in this regression are scripted wire data, not live AI.

Both initial create responses also returned `Import state is unavailable`; a
same-key replay recovered the existing Task. The HTTP regression reproduces this
when the workflow advances between the authorized intent and timeline reads.
The adapter now rereads those snapshots at most twice when history is newer.
It never repeats admission, provider calls or mutations. Exhausted inconsistency,
malformed data and authorization failures still fail closed. Domain history
validation remains unchanged.

Reproduce the additional regressions:

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/product-api/product-mcp-interactions.test.ts \
  src/features/imports/import-provider-terminal-authority.integration.test.ts
pnpm --filter @meal-planner/api check
```

## Production continuation after PR #310

PR #310 deployed `fafa3f5833be187f24552e1e6938ede11851fa04` through
[production CI](https://github.com/cill-i-am/meal-planner/actions/runs/40128194110).
All 22 non-skipped jobs passed. Cloudflare reported API version
`33c9ae1b-d2ca-4155-8668-953b92dbb5fb` active at 100%.

A fresh isolated import returned a working Task on its first request. The same
Task remained readable after the official client disconnected and reconnected.
Source acquisition and speech completed, but the visual response again produced
`forced_tool_missing`. Unlike the previous failures, the native terminal step
persisted its ownership ID successfully and completed without serialization
errors. The public intent became `failed`; Inspector completed the Task and
received an `analysis_failed` tool result. A completed Task is not a successful
recipe extraction.

Both uncertain visual receipts were reconciled with explicit user approval,
using the application's guarded two-statement transaction through authenticated
Cloudflare administration. Each consumed its 100,000-microUSD reservation as a
conservative internal charge. Actual provider costs remain unknown; no provider
call was retried. After the second reconciliation the shared budget was open,
reserved cost was zero, and settled accounting was 200,943 microUSD. This is
ledger evidence, not an invoice. The first uncertainty had blocked the earlier
second import before its speech provider could dispatch.

### Further provider-boundary defect

The live diagnostic did not record the response HTTP status. It therefore cannot
distinguish an HTTP error from a successful response without a tool call. An
offline regression through the **installed Alchemy adapter**, with only its raw
Workers AI binding scripted, demonstrated:

| Scripted response | Before | After local repair |
| --- | --- | --- |
| 429 JSON | `insufficient_evidence` | `throttled` |
| 503/504 JSON | `insufficient_evidence` | `provider_unavailable` |
| 503 plain text | Successful empty evidence | `provider_unavailable` |

The repair rejects non-OK responses before reading their bodies or normalizing
model content, and records only the numeric HTTP status alongside the existing
safe event fields. It does not infer zero cost, change retry authority, or add a
fallback. A saved successful Scout response still preserves all three frame
observations through that same installed adapter. These are scripted boundary
regressions, not new live model calls, and they do not prove which HTTP status
caused the production failures.

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/imports/import-provider-http.test.ts \
  src/features/imports/import-provider-visual.test.ts \
  src/features/imports/import-observability.test.ts
```

## Production continuation after PR #311

On 25 October 2026, production was at
`386ec7cd35e0113989220e3d2fe6b223f53e5a6d` after
[production CI](https://github.com/cill-i-am/meal-planner/actions/runs/40133565639)
passed all 22 non-skipped jobs. The previous visual failure was now observable
as HTTP 499. That response alone does not establish which component cancelled
the request or justify changing a timeout.

The three retained frames from the isolated import were downloaded through the
authenticated R2 dashboard and matched their original byte counts and SHA-256
hashes. A separately accounted native visual probe returned HTTP 200 in 2,874 ms,
with 7,890 input tokens, 59 output tokens and three empty observation arrays.
Inspection found no recipe text in those frames. This is not exhaustive OCR
accuracy evidence. The probe used an explicit 120-second gateway timeout; its
quick success does not prove that override fixed the earlier failure.

A fresh import through Inspector then completed source acquisition, speech and
visual processing **with the unchanged production settings**. It returned a
working Task on the first request. Recipe extraction failed with the safe
`json_mode_envelope_invalid` diagnostic. Its terminal checkpoint persisted, the
Task completed with `recipe_extraction_failed`, and the same terminal result
survived disconnect/reconnect. The recipe receipt settled conservatively without
poisoning the shared budget; no manual reconciliation or provider retry was
needed for this import.

### Native recipe response compatibility

Two separate, capped native requests investigated the response envelope:

| Request | Result | Measured usage and accounting |
| --- | --- | --- |
| Production request factory with authored placeholder evidence | HTTP 408 after 120,563 ms | Usage unknown; 100,000 microUSD retained as an uncertain reservation in its isolated diagnostic ledger |
| Two-field synthetic tomato-toast schema, 256-token cap | HTTP 200 after 1,132 ms | 66 input / 16 output tokens; 56 microUSD token-priced estimate |

The timeout was not retried. These requests are compatibility probes, not a
recipe extraction quality benchmark. Neither creates a draft. Gateway request
logging remained disabled and the normal gateway options were preserved.

The successful response contained the native `response` object alongside an
OpenAI-style `choices` array, completion metadata and `usage.neurons`. The JSON
content in the single choice matched `response`; its finish reason was `stop`
and its refusal was null. The adapter previously rejected these extra envelope
and usage fields before recipe validation. The regression substitutes a valid
scripted recipe in both copies of the captured synthetic envelope; it does not
claim the provider generated that complete recipe.

The adapter now projects provider metadata while validating completion controls,
redundant content agreement and token counts. `response` remains the only recipe
source. Truncation, refusal, unexpected tool calls, contradictory content,
malformed usage and unknown recipe fields fail closed. Grounding, review,
publication and accounting authority remain unchanged. The adapter version also
changes so new extraction fingerprints and evaluation results identify the new
parsing behavior; existing settled dispatches retain their replay authority.

The native probe's exact model was
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Its user message was:

```text
Return the title and integer servings exactly as stated in this synthetic recipe. Synthetic recipe: Tomato toast. Serves 1. Toast bread and add tomato.
```

The request used temperature 0, `max_tokens: 256` and
`response_format: { type: "json_schema", json_schema: ... }` with this schema:

```json
{
  "type": "object",
  "properties": { "title": { "type": "string" }, "servings": { "type": "integer" } },
  "required": ["title", "servings"],
  "additionalProperties": false
}
```

Binding options were `returnRawResponse: true` and gateway
`{ id: "meal-planner-recipe-import", collectLog: false, skipCache: true }`.
The compact request-body SHA-256 was
`37b2168c27e6af7010d03ab006255ce486a7231408e9d722aeae04d494fbee51`.
The saved synthetic response fixture supplies the observed envelope; regression
cases deliberately vary controls and replace content. Repeat paid probes only
through the existing [accounted transport](../evals/recipe-extraction/accounted-transport.ts)
with distinct dispatch identities and bounded reservations. Do not erase an
uncertain receipt or present local fixture replay as a fresh provider result.

The official [JSON mode documentation](https://developers.cloudflare.com/workers-ai/features/json-mode/)
describes native structured `response` output. The
[model documentation](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
also documents transport usage and tool-call fields. Both were checked on
25 October 2026; the saved native capture establishes the additional observed
metadata, not a guarantee about every future provider response.

Reproduce the adapter regression without provider calls:

```sh
pnpm --filter @meal-planner/api exec vitest run --project node \
  src/features/imports/import-provider-recipe.test.ts
pnpm evals:recipe:test
```

### Native recipe request compatibility

A separately approved, one-call diagnostic reconstructed the isolated import's
retained evidence through the production encoders. Its evidence fingerprint
matched the original dispatch. With the original request factory, it returned
HTTP 200 in 20,242 ms, using 990 input and 639 output tokens (1,730 microUSD
tariff estimate). The response envelope was valid, but the recipe used a different
structure: top-level `recipeYield` and `cookTime`, string instructions and
incorrect ingredient shapes. Strict domain decoding rejected it. This is a new
diagnostic response, not a recovered body from the failed production call.
Private source text and provider output are not included in the repository.

The native request already supplied the bare domain schema in `response_format`.
The [official Cloudflare client](https://github.com/cloudflare/ai/blob/main/packages/workers-ai-provider/src/utils.ts)
confirms that shape; substituting an OpenAI schema-name wrapper would be wrong.
Cloudflare's [LangChain implementation](https://github.com/cloudflare/langchain-cloudflare/blob/main/libs/langchain-cloudflare/langchain_cloudflare/chat_models.py)
also places the full schema in its Llama structured-output prompt. Neither source
establishes guaranteed adherence to our nested recipe schema.

Three controlled native calls then used one existing **synthetic development
case**, holding the evidence, model, native schema and grounding fixed. The
[complete captures and reproduction commands](../evals/recipe-extraction/schema-conditioning-20261025/README.md)
preserve requests, responses, receipts, frozen hashes and field-level results:

| Request | Strict candidate | Grounded result | Client time / tariff estimate |
| --- | --- | --- | --- |
| Original prompt | Invalid | No candidate | 5,677 ms / 467 microUSD |
| Exact schema appended | Valid | Minimum draft passes; ingredient names duplicate amounts/preparation | 20,357 ms / 2,044 microUSD |
| Schema plus ingredient-name instruction | Valid | Minimum draft passes; clean names; structured Roast temperature missing | 21,761 ms / 2,020 microUSD |

The schema-conditioned diagnostic used the third request exactly. A regression confirms
that the full schema reaches the prompt as well as `response_format`. The
candidate schema, grounding, model, native options, accounting and explicit
publication review are unchanged. The final request still preserves 200°C in the
Roast instruction text, but its structured temperature is null. Grounding removes
a temperature incorrectly attached to the Toss step. The unchanged oracle marks
both valid candidates `usable: false`; minimum-draft eligibility is not complete
field preservation. These are three adaptive calls on one development example,
not a holdout or a population accuracy result. The additional prompt costs about
3,400 input tokens in this example and did not improve latency.

No product draft or publication was created by these diagnostics.

### Controlled native response-format comparison

Two separately approved requests applied the schema-conditioned prompt to the
same retained real evidence. Both returned HTTP 408 (`AiError`, internal code
3046, `Request timeout`) without a recipe or usage: 121,523 ms and 120,793 ms.
Each retained its own uncertain 100,000-microUSD reservation in an isolated
ledger. Neither receipt was reset and neither invocation was automatically
retried. The two observations reproduce failure for this request; they do not
identify a particular backend timer or establish a configurable inference limit.

A third separately approved control changed **only** `response_format` to
`{ type: "json_object" }`. The exact full-schema prompt, evidence, model,
generation settings, native options, strict candidate decoder and grounding
remained fixed. Cloudflare's [official Llama client](https://github.com/cloudflare/langchain-cloudflare/blob/main/libs/langchain-cloudflare/langchain_cloudflare/chat_models.py)
uses JSON-object mode with a schema prompt; our control retained the existing
user-message placement to isolate the format change. It returned HTTP 200 in
36,886 ms, with 4,431 input and 1,382 output tokens: a 4,412-microUSD tariff
estimate. Its receipt settled normally after one invocation. This is one
successful compatibility observation, not proof that the format caused the
previous timeouts or that the provider is generally reliable.

Before inspecting the output, an independent review recorded the expected
source facts. Both source inspection and a fresh decode/ground replay then found:

- All six quantity–unit associations were correct; all seven caption method
  entries and five cooking conditions survived.
- Twelve of sixteen ingredient identities have ingredient rows. The remaining
  four still appear in method text, requiring recipe editing for completeness.
- Neither duration range became a structured duration. One remains verbatim in
  instruction text; the speech-only range, ingredient subtype and some spoken
  procedural detail are omitted.
- No unsupported grounded facts were detected. Grounding removed one unsupported
  author URL. Unspecified quantities, servings and aggregate times remain unset.

The response passes strict decoding and the minimum-draft gate and is suitable
for review/edit and protocol testing. It is not complete or ready for publication
without review. Eleven unresolved fields are reported by the application; that
count is not an oracle for omitted source facts. No production draft was created
by the diagnostic.

The installed factory now emits this measured JSON-object request, identified as
`installed-workers-ai-json-object-v3`. A request-boundary regression failed
before the change and passes afterward; the full strict recipe schema remains
in the prompt and the same strict schema validates every returned candidate.
Normal import, recovery and evaluation composition continue to share this
factory. Model, timeout, grounding, accounting and publication authority are
unchanged.

The exact fixed schema-mode request body had SHA-256
`7a2ebedba8e36cd685b1a67fcb02db0cc13c33e914e4eff4a959edbedc611102`;
the JSON-object control had
`fd66a979a6485c0112205bce11a7654e83718c3e3d65035f3b96e1c73910e8bf`.
Private requests, native responses and receipts remain private and subject to the
original evidence expiry, 1 November 2026 at 08:17:01 UTC. They are not published
as a reusable public corpus. The public synthetic captures above remain historical
schema-mode diagnostics and do not measure the final JSON-object strategy.

## Remaining live verification

The recipe request and response repair still requires production deployment and
hosted verification. Successful draft preparation, elicitation preview/accept/decline/
dismiss, stale-version rejection and publication replay remain unverified with
this real client. The compatibility probe demonstrates a parser defect but does
not establish the exact payload of the failed production import, whose body was
not retained. Provider settlement must remain authoritative; do not invent a
draft or bypass accounting to make the protocol test pass.

No recipes have been published. The first four test imports were cancelled;
the following three ended in recorded failures. The restored test grant was
revoked and verified absent, local client credentials were cleared, and Inspector
was disconnected. No production provider request is outstanding. This report distinguishes
production protocol/workflow behavior, the reproduced response compatibility
defect and unfinished live elicitation checks.

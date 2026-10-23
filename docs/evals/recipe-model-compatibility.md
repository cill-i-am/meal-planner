# Recipe model compatibility and adoption decision

Verified **23 October 2026** against the installed importer at base commit
`b16bc63589f7413fc4fdbea79c18fdda60b52dde`, authenticated model schemas and nine
accounted live compatibility calls on authored synthetic inputs.

**Keep the installed Llama recipe extractor and Scout visual provider. Do not add
a Clef classifier to the production import path.** Clairic accepted the API
requests but omitted or corrupted important recipe content. Clef's small text
probe demonstrated compatible responses, not a safe production rejection rule.
The attempted paired recipe comparison stopped after an unknown transport
outcome, so it supplies **zero paired quality measurements**. These conclusions
do not establish that Llama has better population accuracy; they establish that
the proposed replacement has not earned adoption.

## Durable evidence and provenance

The [compatibility manifest](../../evals/recipe-extraction/compatibility.v1/manifest.json)
indexes all nine exact invocation bodies and saved response structures, including
embedded synthetic image bytes. It records file SHA-256, canonical invocation
SHA-256, dispatch identity, recorded ledger time, model, usage, reservation, latency source
and token-priced settlement. The bundle is bounded to less than 300 KB. It
contains no household media, credentials, account identifier or authorization
header. JSON formatting is not a capture of HTTP wire bytes; the payload values,
including the incomplete long-response string, are preserved.

The [schema snapshot](../../evals/recipe-extraction/compatibility.v1/cloudflare-model-schemas-2026-10-23.json)
contains the authenticated, read-only `GET /accounts/{account_id}/ai/models/schema`
responses for Clairic, Clef, Clef-flash and Clef-omni, all HTTP 200. The endpoint is
the first-party source for model-specific input and output schemas. [Schema API](https://developers.cloudflare.com/api/resources/ai/subresources/models/subresources/schema/methods/get/).

These fixtures are live provider responses to locally authored synthetic text
and images, outside the frozen development/holdout corpus. They are not captured
real recipes or a representative benchmark. Checked-in synthetic fixtures are
durable project evidence; private temporary capture and ledger copies have a
documented deletion deadline of 30 October 2026. Production private source
evidence retains its existing seven-day retention policy.

## Models, contracts and dated pricing

Rates below are USD per million tokens, checked on 23 October against the
Cloudflare price table last updated 20 October 2026. Catalog-derived settlement
is an estimate, not a billing invoice or a measurement of the free allocation.
[Pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

| Workers AI model | Required selector for new family | Input | Output | Published context |
| --- | --- | ---: | ---: | ---: |
| `@cf/cloudflare/clairic` | `clairic` | $0.100 | No output charge | 65,536 |
| `@cf/cloudflare/clef` | `clef` | $0.240 | No output charge | 65,536 |
| `@cf/cloudflare/clef-flash` | `clef-flash` | $0.038 | No output charge | 24,576 |
| `@cf/cloudflare/clef-omni` | `clef-omni` | $0.150 | No output charge | 64,000 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Not applicable | $0.293 | $2.253 | Not tested here |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Not applicable | $0.270 | $0.850 | Not tested here |

The four model cards supply their current IDs, context and unit prices:
[Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/),
[Clef](https://developers.cloudflare.com/workers-ai/models/clef/),
[Flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/),
[Omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/).
The production and future evaluation Llama configuration now share the exact
published rates. Previously it used rounded $0.29/$2.25 rates. The already
attempted comparison request retains its historical rates and identity; it was
not rewritten after dispatch.

The saved authenticated schemas establish these relevant boundaries:

- Clairic requires a model selector and a map of typed fields. Its text state is
  a string, nonempty unless images are supplied. Text and list-of-text fields
  support phrase extraction; arbitrary nested ingredient objects are not a list
  item type. `options.return_state_text: true` requests the text indexed by spans.
- Clairic responses require `model`, `answers`, `truncated` and `usage`. Null
  answers can still carry a guess, span and confidence. Those guesses are never
  accepted as facts. Images can be embedded PNG/JPEG/WebP, at most four, 4 MiB
  each and 8 MiB total decoded; remote image URLs are unsupported.
- Clef accepts text or structured state and one to 64 typed questions. A choice
  declares its options and returns a choice plus probabilities; `noul` returns a
  yes probability, not a Clairic-style value/confidence pair. Score questions
  return a probability-weighted rubric score. No production parser treats these
  shapes as interchangeable.
- The hosted Clef/Flash input snapshots expose images, while Omni additionally
  exposes audio/video. This evaluation used text for all three. No media-quality
  or hosted video-support claim is inferred from those text responses.

Clairic's schema describes an 8,192-token per-pass constraint while its card lists
65,536 context tokens. Probe 07 accepted 24,054 reported state tokens in one pass
and returned the tail marker. This demonstrates that specific request, not a
verified context ceiling or a general truncation guarantee. Its captured return
text is incomplete, as detailed below.

## Accounted observations

Each invocation was reserved through the existing production D1 accounting
implementation before the authenticated connector sent the request. The
[bounded transport](../../evals/recipe-extraction/accounted-transport.ts) retains
native settlement, replay and unknown-outcome behavior, plus a persistent
ten-invocation/$1 cumulative reservation guard. The initial eight calls reserved
10,000 microUSD each; Scout reserved 100,000. No automatic tuning or fallback
calls were made. Reported internal passes are not additional HTTP invocations.

| Probe | Input/output tokens | Internal passes | Tool wall latency | Token-priced microUSD |
| --- | ---: | ---: | ---: | ---: |
| 01 Clairic Unicode/duplicates | 670 / 0 | 3 | 6,225 ms | 67 |
| 02 Clairic occurrences/nulls | 758 / 0 | 4 | 3,221 ms | 76 |
| 03 Clairic multilingual/CRLF | 820 / 0 | 4 | 3,211 ms | 82 |
| 04 Clef | 1,056 / 0 | Unreported | 6,976 ms | 254 |
| 05 Clef-flash | 1,056 / 0 | Unreported | 3,680 ms | 41 |
| 06 Clef-omni | 1,048 / 0 | Unreported | 2,883 ms | 158 |
| 07 Clairic long context | 24,270 / 0 | 1 | 4,832 ms | 2,427 |
| 08 Clairic image only | 2,146 / 0 | 3 | 4,120 ms | 215 |
| 09 Scout three frames | 2,235 / 54 | Unreported | 5,281 ms | 650 |

All nine returned HTTP 200 and settled known usage, totaling **3,970 microUSD
($0.003970)** at the recorded rates. A known usage-priced settlement does not mean
correct recipe content. Latencies are individual connector/tool observations,
not provider-only timing, p50/p95, or end-to-end import latency.

### Clairic text fidelity and source offsets

[Probe 01 request](../../evals/recipe-extraction/compatibility.v1/01-clairic-unicode.request.json)
and [response](../../evals/recipe-extraction/compatibility.v1/01-clairic-unicode.response.json)
use an emoji before accented text, a decomposed accent, nonbreaking space, a
fraction, duplicate milk lines and a conditional instruction. The short response
preserves the supplied `state_text`. Spans reconstruct with start-inclusive,
end-exclusive **Unicode codepoint offsets**, rather than JavaScript UTF-16
offsets. This observed convention is corroborated by probe 03; the documentation
alone did not identify the unit.

The ingredient response has four values but five spans. It includes the title
and an accent-truncated word as ingredients, while duplicate milk occurrences
have more spans than values. The instruction list includes `Ch` instead of the
complete action and its condition. Servings is null despite a non-null guess.
These are correctness failures, not fixes that confidence can authorize.

[Probe 02](../../evals/recipe-extraction/compatibility.v1/02-clairic-occurrences.response.json)
correctly distinguishes the positive `Add milk` occurrence from the preceding
negated occurrence. However, its ingredient list includes an action's `milk` and
the serving value `2.`. Exact source occurrence therefore does not establish
ingredient role. A missing oven field remains null while carrying a confident
guess; that guess is ignored.

[Probe 03](../../evals/recipe-extraction/compatibility.v1/03-clairic-multilingual.response.json)
preserves CRLF, French accented text, Unicode fractions and Japanese text. Its
ingredient spans are useful, but the second instruction is `Aj` from `Ajoutez`,
losing the rest of the action. The experimental decoder rejects token fragments,
including combining-mark and surrogate-pair boundaries; it does not expand
partial model output into a guessed complete instruction.

### Long capture integrity

[Probe 07](../../evals/recipe-extraction/compatibility.v1/07-clairic-long-context.response.json)
reports `truncated: false` and finds both markers in a 91,350-character source.
The tail marker span is `[91339, 91350]`. But saved `state_text` is only 22,850
characters and ends with the literal capture marker
` --- TRUNCATED --- 91,350 chars`. This strongly indicates capture-layer
shortening; the artifact cannot prove which upstream layer shortened it.

The returned-state bytes cannot be reconstructed from the request and presented
as an observed provider response. The adapter rejects the mismatch. This probe
supports head/tail extraction on that input, but **does not validate full returned
text, long-input provenance, or model truncation behavior**. A future authorized
probe should record a full response hash/equality result before connector output
limits apply. The failed integrity check does not authorize an automatic retry.

### Image-only extraction and the existing visual provider

[Probe 08](../../evals/recipe-extraction/compatibility.v1/08-clairic-image-only.response.json)
reads a generated recipe image. The title is correct; ingredients are
`200 g carrots` and `500 ml`, omitting water. Its instruction is
`Chop carrots carrots. Sim for 15 minutes`, merging and corrupting the two source
sentences. Image-derived spans are null, `state_text` is empty, and extra image
source/spelling metadata appears. Confidence reaches one despite errors. The
text-span adapter cannot accept image output as text provenance and no direct
Clairic visual route is implemented.

[Probe 09](../../evals/recipe-extraction/compatibility.v1/09-scout-three-frames.response.json)
uses the existing Scout model with three ordered generated frames. Both native
and OpenAI tool envelopes contain the three expected observations in order:
`2 onions`, `Simmer 10 minutes`, `Serve with rice`. This proves one synthetic
three-frame request and supports the acquisition change; it is not a paired
OCR benchmark against probe 08. See [acquisition evidence](recipe-evidence-acquisition.md).

### Clef decision compatibility

Probes [04](../../evals/recipe-extraction/compatibility.v1/04-clef.response.json),
[05](../../evals/recipe-extraction/compatibility.v1/05-clef-flash.response.json) and
[06](../../evals/recipe-extraction/compatibility.v1/06-clef-omni.response.json)
each classify the same four named synthetic states: explicit recipe, sparse
cooking caption, explicitly unrelated content, and unknown content with
uninspected media. All choose the expected recipe/unrelated/uncertain labels.
The additional `noul` question gives low probability to rejecting the sparse
cooking case; the score response correctly uses the supplied completeness rubric.
Saved probability maps sum to one within reported precision.

These are three calls with questions sharing a combined state, not twelve
independent workflow trials. They establish neither calibrated confidence nor
false-rejection rates, real media behavior, selection savings, or advantage over
continuing without a classifier. Production therefore keeps no Clef gate.

## Implementation and remaining gates

The production change prices validated positive input/zero-output usage instead
of treating it as unknown. Missing or zero/zero usage remains unknown. The
[recipe provider](../../apps/api/src/features/imports/import-provider-recipe.ts)
exports its exact request builder and response decoder for comparison and shares
its existing accounting/replay/grounding boundary with the explicit
[experimental Clairic adapter](../../apps/api/src/features/imports/import-provider-clairic.ts).
Normal and recovery composition still instantiate Llama. No production feature
flag or fallback automatically selects Clairic or Clef.

Clairic text assembly preserves source bytes and maps spans locally. Null guesses,
changed/truncated return text, list cardinality/order/overlap failures and partial
words are rejected. Structured normalization uses only locally supported phrases;
fractional duration or ambiguous temperature ranges remain unresolved. Review
found partial-number and split-surrogate errors in the first implementation;
regressions now cover both fixes. Final independent PR review remains a separate
gate. Source grounding still cannot certify the semantic role of every exact
phrase, as probe 02 demonstrates.

The [paired extraction evaluation](recipe-extraction.md) planned three
development cases for Llama and Clairic. Its first Llama call had an unknown
tool/transport outcome without a captured model response. Five planned requests
were unattempted, no recovery/fallback was authorized, and no paired precision,
recall, latency advantage or spend advantage is reported. Existing immutable
request identity and historical prices remain intact. Holdout evidence was not
used for prompt tuning.

## Reproduction

Inspect the manifest, exact requests and saved responses offline first. Its
canonical request hash is SHA-256 of `JSON.stringify(invocation)` in the recorded
property order; file hashes cover the checked-in bytes. The documentation does
not execute or replay a paid call.

This offline check verifies file integrity and request/response identity:

```sh
node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const root = "evals/recipe-extraction/compatibility.v1/";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8"));
for (const item of manifest.probes) {
  const request = readFileSync(root + item.requestFile);
  const response = readFileSync(root + item.responseFile);
  assert.equal(hash(request), item.requestFileSha256);
  assert.equal(hash(response), item.responseFileSha256);
  assert.equal(hash(JSON.stringify(JSON.parse(request))), item.requestSha256);
  assert.equal(JSON.parse(response).requestSha256, item.requestSha256);
  assert.equal(JSON.parse(response).dispatchId, item.dispatchId);
}
assert.equal(hash(readFileSync(root + manifest.schemaSnapshot.file)), manifest.schemaSnapshot.sha256);
assert.equal(manifest.probes.length, 9);
console.log("Nine compatibility captures verified; no provider calls made.");
JS
```

A separately authorized live rerun can use the existing accounted bridge with a
fresh ledger and run identity, selecting one checked-in request file:

```sh
pnpm exec tsx evals/recipe-extraction/accounted-transport.ts bridge /private/tmp/recipe-compatibility-rerun recipe-compatibility-rerun-v1 evals/recipe-extraction/compatibility.v1/01-clairic-unicode.request.json
```

Send only the bridge's reserved request body to its recorded model through the
authenticated transport, then write the matched response receipt. Never bypass
reservation, reuse a dispatch ID with changed input/prices, or rerun an existing
unknown dispatch as though it were a new experiment. Synthetic success does not
replace a paired corpus gate or production journey verification.

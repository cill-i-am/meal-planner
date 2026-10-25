# Native recipe schema-conditioning diagnostics — 2026-10-25

Three actual Workers AI calls used the same **authored synthetic** `caption-complete` development case from `recipe-extraction-v1`. These are compatibility diagnostics, not live recipe accuracy evidence. No private import07 text, household media, account identifier, credentials or disposable probe harness is included.

The source revision was `535913df0339a9c5f597096f701545ed06381deb`. A used its original request factory. B and C applied the suffixes below in a private native-binding diagnostic. Their descriptor versions explicitly identify that source revision and experiment; they are not captures of a later production version. The exact requests and receipts preserve replay after the production factory changes.

## Observed results

| Run | HTTP | Input/output tokens | Client time | Tariff estimate | Schema | Grounded minimum | Grounded oracle missing / unmatched / numeric flags |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A: original-prompt | 200 | 354 / 161 | 5,677ms | 467microUSD ($0.000467) | Invalid | Unavailable | 21 / 0 / 0 — failed extraction |
| B: schema-prompt | 200 | 3,769 / 417 | 20,357ms | 2,044microUSD ($0.002044) | Valid | Pass | 9 / 9 / 2 |
| C: schema-and-name-prompt | 200 | 3,795 / 403 | 21,761ms | 2,020microUSD ($0.002020) | Valid | Pass | 2 / 0 / 0 |

All three dispatches settled normally, one invocation each, without application retries. Each reserved 100000microUSD; A/B shared a separate two-call 200000microUSD cumulative reservation limit, and C used a fresh one-call 100000microUSD limit. Reservations are not spend. Settlements use the recorded rates of 0.293microUSD/input token and 2.253microUSD/output token, rounded upward after summing. These are usage-based tariff estimates, not invoices. Client timing spans native `AI.run` through reading its response body. Provider-reported latency and internal passes are unavailable.

Only one of ten development cases is measured per run; the other nine remain absent, not zero-cost successes. A failed strict candidate validation, so it has no valid raw candidate from which to claim fact accuracy. Its 21 missing facts describe failed extraction, not measured per-field extraction quality. The existing A→B comparison therefore has one attempted pair but **zero schema-valid comparable pairs**. B→C has one comparable case. Any p95 emitted from one measured sample equals that sample and has no population interpretation. The order was A, then B, then adaptive C; none was repeated or randomized.

## Source/candidate inspection

The root agent and an independent evaluation agent checked the saved candidates against the unchanged caption and its field witnesses. This is direct source/candidate inspection, not a claimed human reviewer attestation or another model used as the sole scoring judge. All 21 oracle facts were considered; no aliases or expectations were changed to match an answer.

- **B:** Its only grounded differences from the expected recipe are the two ingredient names. Names contain the complete phrases `500 g carrots, sliced` and `1 tbsp olive oil`, although the matching quantities 500g/1tbsp, originals and sliced preparation are correct in their respective rows. Strict name-based row matching explains the 9 missing/9 unmatched facts and 2 numeric-association flags; these are not nine lost source facts or two wrong quantities. Replacing the two names with `carrots` and `olive oil` makes the grounded recipe equal the oracle. The real display defect remains: the current formatter would produce `500 g 500 g carrots, sliced, sliced` and `1 tbsp 1 tbsp olive oil`. This is confirmed from formatting code, not a live UI observation.
- **B grounding:** Raw B adds 200°C to the Toss step without local source support. Grounding removes it, preserves the correctly structured Roast 200°C, and restores the serving unit from `Serves 4`. The grounded recipe retains the source values; the ingredient-name representation still requires two edits.
- **C:** The ingredient names, originals, quantities, units, preparation, title, yield, times and verbatim instructions are correct. Raw C again attaches 200°C to Toss and **already omits** the structured temperature on Roast. Grounding removes the wrong Toss value and restores the serving unit, but does not invent the missing Roast field. The Roast instruction text still retains `200°C`. The two remaining missing scalar facts are `instructions.1.temperature.unit` and `.value`. There are no unmatched grounded facts or numeric-association flags, and complete ingredient quantities are 2/2.

The unchanged scorer records `usable: false` for B and C. Its correction proxy counts fact additions/removals: 18 for B and 2 for C. This is not an observed count of human editing actions; B needs two ingredient-name replacements, and C lacks the structured Roast-temperature object. The minimum-draft gate is less demanding than exact oracle completeness. C demonstrates improved ingredient-name mapping in this one diagnostic while retaining a structured-temperature completeness gap. It does not establish general accuracy, production health, or a completed authenticated Tasks/elicitation journey. No further tuning or calls follow from this dataset.

## Exact controlled requests

Shared model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; temperature 0; max_tokens 16384; full nested domain schema in native `response_format: { type: "json_schema", json_schema: <bare schema> }`. No schema-name wrapper, timeout change or retry override was added. Native options were:

```json
{
  "gateway": {
    "id": "meal-planner-recipe-import",
    "collectLog": false,
    "skipCache": true
  },
  "returnRawResponse": true
}
```

A is the original request. B changes only the existing user message by appending this exact prefix, followed immediately by compact `JSON.stringify(A.response_format.json_schema)`:

```text
\n\nYour output must satisfy this exact JSON Schema, including every required field and nested type. Return only a JSON object conforming to it:\n
```

C copies frozen B and appends exactly:

```text
\n\nFor each ingredient, name contains only the food name; original retains the complete evidence phrase, including its amount, unit and preparation.
```

The displayed `\n` sequences denote actual newline characters. Nothing else in the body, model, evidence, schema or options changed. C was selected after inspecting B, so it is an adaptive development variant rather than an independent holdout.

| Run | SHA256 of exact compact request body                               |
| --- | ------------------------------------------------------------------ |
| A   | `5547e30389db105d1844571c8a0b548177cfd9357f16b98bac0aab6dd1a4ffa8` |
| B   | `3cb99bfa55dba08e079484e4ee138c99521c2016d1b55e46cc1ddb003193cfc1` |
| C   | `6df74cf128e85cc61e00bbaab16e04d4ec0b03835c052752df045655ebcdb34c` |

The shared evidence hash is `ceaec8e1d055252df28233e448f28227e378c5118e787ca674cedf9e2f4e4e41`. `manifest.json` records the existing corpus, acceptance, grounder and scorer hashes, accounting invocation hashes, controlled suffixes and every artifact hash. `*.request.raw.txt` contains the exact compact JSON body with no trailing newline. `*.response.raw.txt` preserves the complete native response bytes; `*.receipt.raw.txt` preserves the matching bridge receipt. The `.run.json` files implement the existing `PersistedExtractionRun` schema and include decoded candidates only when strict production decoding succeeded. Byte-preserved captures use `.txt` so formatters do not rewrite them.

## Reproduce with the existing scorer

From the repository root, with the repository-supported Node version:

```sh
recipe_evidence=evals/recipe-extraction/schema-conditioning-20261025
recipe_reports="$(mktemp -d)"
node --import tsx evals/recipe-extraction/run.ts validate
node --import tsx evals/recipe-extraction/run.ts score --split dev --outputs "$recipe_evidence/original-prompt.run.json" --out "$recipe_reports/original-prompt.json"
node --import tsx evals/recipe-extraction/run.ts score --split dev --outputs "$recipe_evidence/schema-prompt.run.json" --out "$recipe_reports/schema-prompt.json"
node --import tsx evals/recipe-extraction/run.ts score --split dev --outputs "$recipe_evidence/schema-and-name-prompt.run.json" --out "$recipe_reports/schema-and-name-prompt.json"
node --import tsx evals/recipe-extraction/run.ts compare --split dev --baseline "$recipe_evidence/original-prompt.run.json" --candidate "$recipe_evidence/schema-prompt.run.json" --out "$recipe_reports/original-vs-schema.json"
node --import tsx evals/recipe-extraction/run.ts compare --split dev --baseline "$recipe_evidence/schema-prompt.run.json" --candidate "$recipe_evidence/schema-and-name-prompt.run.json" --out "$recipe_reports/schema-vs-schema-and-name.json"
```

These commands perform no network calls or provider invocations and do not rebuild requests with the current factory. Reports retain all ten development cases, making the nine unmeasured cases explicit. Inspect the `caption-complete` case for measured field-level results; do not present the coverage-weighted aggregate as population accuracy. If grounding has changed, use the existing `--historical-grounder 535913df0339a9c5f597096f701545ed06381deb` option and preserve that attribution. Scorer revision is recorded in the manifest; replay at the source revision if scorer behavior changes. Exact artifacts and typed run parsing, both score paths and both compare paths were checked offline.

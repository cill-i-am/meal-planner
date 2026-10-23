# Recipe extraction evaluation

This harness supports comparison of recipe candidates from the installed Llama
extractor, Clairic, and a bounded conditional hybrid on identical frozen evidence. The
checked-in corpus is a **20-case synthetic smoke and regression suite**, split
into ten development cases and ten disjoint holdout cases. It does not establish
real-source acquisition quality or population extraction accuracy.

The scorer makes no provider calls. It reads persisted candidates and raw provider
responses, checks the evidence fingerprint, then applies the application's
`groundRecipeCandidate` to each candidate. Raw and grounded metrics use the same
source-specific expected facts. Scripted control outputs test the scorer; they
are never presented as model results.

## Frozen inputs and expectations

- [Corpus v1](../../evals/recipe-extraction/corpus.v1.json) contains authored source
  text, independent expected recipe content, exact witness quotes, source IDs,
  qualifier requirements, and the development/holdout assignment.
- [Acceptance v1](../../evals/recipe-extraction/acceptance.v1.json) fixes safety and
  comparison criteria before provider runs. It specifies no arbitrary improvement
  percentage and never declares a winner from an aggregate score alone.
- [Persisted run schema](../../evals/recipe-extraction/model.ts) labels execution
  as `scripted_fixture`, `local_library`, or `live_provider`. Corpus provenance is
  separately labelled `synthetic`, `raw_capture`, `scripted_capture`, or
  `live_capture`. All current corpus items are synthetic.

The sources and expectations were authored without running an extractor. A
separate reviewing agent checked all twenty cases against the exact source text,
including quantity associations, fractions, ranges, component groups, correction
polarity and nutrition basis. Its review identified missing pan/fork annotations
and inconsistent aggregate timing interpretation; these were corrected before
provider evaluation. Deterministic validation verifies every expected fact has a
witness and every witness occurs verbatim. This is agent-authored synthetic
material with independent source review, not a human-labelled real-video set.

Coverage includes complete captions, sparse speech, missing values, written
visual-only observations, silent clips with and without acquired observations,
early/late facts, Unicode and mixed fractions, ranges, multiple components,
repeated evidence, explicit corrections, negation, optionality, conditions, long
distraction, compound/word durations, explicit nutrition and non-recipe content.
The visual fixtures are written observations; they do not test vision or OCR.

### Retained source discovery

On 23 October 2026 at 11:09:05 UTC, a user-authorized, read-only Cloudflare R2
inventory located the Meal Planner import-evidence buckets for production, E2E
and an older PR preview. Listing `imports/` in each returned HTTP 200,
`success: true`, an empty object list and no continuation cursor. No source
objects were read or copied. Physical bucket names and account identifiers are
omitted from this public report.

This establishes that those buckets supplied no retained captures at that time;
it does not establish why they were empty. The existing seven-day evidence
retention remains unchanged. Consequently, this investigation cannot expand to
100–200 real-source examples or report real-video accuracy from historical data.
The twenty synthetic cases and separate live synthetic compatibility probes
remain labelled as such. A real-source comparison requires fresh, authorized
captures with independently checked source facts and a separate holdout.

To repeat the object lookup for an authorized Meal Planner evidence bucket:

```sh
curl --get "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$MEAL_PLANNER_EVIDENCE_BUCKET/objects" \
  --data-urlencode 'prefix=imports/' --data-urlencode 'per_page=1000' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

Follow any returned pagination cursor before claiming the listing is complete.
Preserve existing access controls, redaction and retention when collecting fresh
sources; an empty inventory does not justify extending private-data retention.

Every strategy receives only `evidenceForCase(case)`. `allEvidence` is the
acquisition oracle; `availableEvidenceIds` specifies what extraction receives.
Neither `expected`, `witnesses`, nor unavailable source items may enter a provider
prompt. SHA-256 covers the order and every byte of available evidence metadata
and text. The validation command also records corpus and acceptance-file hashes.
Persisted runs bind the complete parsed corpus (including expected facts,
aliases and qualifiers), acceptance bytes and actual grounder source by SHA-256;
scoring rejects a mismatch. Reports also fingerprint the executed scorer source.
The descriptive Git revision does not replace these checks.

## Metrics and interpretation

The scorer reports precision/recall over populated, source-supplied facts, by
field and by case. Fields include ingredient identity, original phrase, amount,
range, unit, preparation, optionality, component group, instruction text/order,
yield, aggregate times, step durations, temperature, equipment, nutrition and
dietary claims. `completeIngredientQuantities` additionally requires the whole
amount/range/unit tuple to match: a correct numeric amount with the wrong unit is
not a correct quantity.

Ingredient rows are matched one-to-one before nested fields are compared. An
ingredient name or source-reviewed name alias must match; a declared group must
also agree. Original phrases and groups disambiguate matching names, and an
ambiguous tie receives no row credit. Duplicate rows remain extra assertions.
Instructions require matching text or a source-reviewed alias; array position
cannot establish identity. A number that exists elsewhere in the source receives
no credit when assigned to an unrelated ingredient or step.
Generated step numbers are excluded from source-fact counts. Relative instruction
order is evaluated only between identity-matched clauses; unrelated instructions
receive no ordinal credit. Protected negation/condition/optionality phrases are
checked separately. Missing clauses reduce recall; retaining an asserted
clause while dropping its qualifier is a qualifier error.
Qualifier diagnostics can recognize a shortened source clause independently of
row alignment; this recognition never grants its quantity, duration or temperature
credit. Numeric association mismatches also require source adjudication when an
unlisted paraphrase may explain the identity mismatch.

Matching normalizes case, whitespace, terminal sentence punctuation and explicit
unit aliases. Numeric fractions are evaluated through the candidate's numeric
values. It does not silently convert mass to volume or equate tablespoons with
teaspoons. Each case can carry source-reviewed text aliases. Semantic paraphrases
are not judged by another language model: unmatched canonical assertions are
reported as `unmatchedOracleFacts` for source adjudication. Until reviewed,
precision is a strict oracle-match lower bound, **not a hallucination rate**.

`correctionOperations` counts one removal for each unmatched assertion and one
addition for each missing expected fact; a changed value costs two operations.
Each inverted pair of retained instruction clauses adds one ordering correction.
This is a reproducible correction proxy, not measured human editing time.
`usable` means the recipe has the required name, ingredients and instructions,
passes domain blockers, and needs no oracle corrections. The reported usable rate
uses all cases in the selected split, including non-recipes and unavailable
evidence. Read it alongside coverage and acquisition availability, not as the
proportion of all real videos that can become recipes.

`minimumEvidenceRouting` reports projected false rejection separately for raw and
grounded candidates. It follows the production minimum-evidence gate: at least
one ingredient and one instruction, with no title requirement. An oracle case is
eligible only when the acquired evidence witnesses an expected ingredient's
name and original phrase plus an expected instruction. A completed, schema-valid
output that fails that gate is a projected false rejection. Counts include
eligible, evaluated and unavailable cases; the rate divides rejections by
evaluated eligible cases and is null when none were evaluated. Failed, missing,
skipped and malformed outputs remain unavailable. Acquisition gaps remain outside
this denominator. This is a gate projection, not an observed end-to-end routing
event or a measured `not_recipe` classifier decision. Paired reports calculate
this projection on comparable pairs only.

Acquisition reports intended versus available source facts and evidence items.
Extraction recall excludes facts whose witness was not acquired. An output that
asserts a hidden fact does not receive extraction credit. The two synthetic
acquisition-loss fixtures verify this accounting separation; their availability
percentages are not measured downloader, ASR, or vision performance.

Null fields and empty arrays do not count as correct facts. A zero expected-fact
denominator produces `null`, not 100%. Failed/missing outputs have zero recall
where source facts exist and remain visible in run coverage. Non-recipe cases
must abstain without invented recipe facts.

Usage records keep provider invocations, internal extraction passes, fallback
invocations, token counts, elapsed time, known/estimated provider spend and
conservative accounting reservations separate. Unmeasured values are `null`.
Latency identifies client wall time, tool wall time, or provider reporting;
provider-reported duration has a separate nullable field. Connector/tool wall time
is not provider inference time. The collector labels token-priced cost as
estimated even when the accounting ledger settles an exact tariff calculation.
An interrupted transport receipt can record one attempted invocation while
provider acceptance remains unknown. It stays separate from `rawProviderResponse`;
unmeasured failure latency and spend remain null.
Normal CLI `stopped_unknown` receipts retain the matching dispatch's reservation
and full native ledger receipt. An accounting claim alone does not establish an
external provider call, so the invocation count stays null unless a separate
attempt receipt proves it. The collector verifies a published bridge request's
body hash when that file exists. Without it, `requestIdentity: dispatch_id_only`
explicitly limits the receipt to the dispatch and reservation; it does not prove
the frozen request body was published. A checked request hash is recorded as
`request_sha256`. Older captures lacking this optional field remain unchanged.
Measured subtotals include measured/unavailable counts. A reservation does not
become provider spend, and absent provider usage does not become zero tokens.
Distributions include nearest-rank p95 over measured values only, using
`ceil(0.95 × n)` in the sorted observations. No observations produce null.
`p95SmallSample` is true below twenty observations, where this p95 equals the
maximum; a false flag does not establish statistical reliability. Latency-source
counts and `mixedLatencySources` expose measurements from different clocks.

Ingredient IDs and step ID references are excluded from fact scoring because
they are adapter bookkeeping. Instruction technique classification is outside
this strict oracle's coverage. Language, media and arbitrary additional populated
fields remain unmatched unless a source-reviewed expected fact is added.
Top-level cook time requires an explicit aggregate label; a cooking-action
duration belongs to its step. No total time is calculated from incomplete parts.

## Reproduce

Use the repository's pinned Node/pnpm runtime and run from the repository root:

```sh
node --import tsx evals/recipe-extraction/run.ts validate
pnpm evals:recipe:check
pnpm evals:recipe:test

node --import tsx evals/recipe-extraction/run.ts template \
  --strategy llama-baseline --split dev --out /tmp/llama-dev-template.json

node --import tsx evals/recipe-extraction/run.ts score \
  --outputs /tmp/llama-dev.json --split dev --out /tmp/llama-dev-score.json

node --import tsx evals/recipe-extraction/run.ts compare \
  --baseline /tmp/llama-dev.json --candidate /tmp/clairic-dev.json \
  --split dev --out /tmp/paired-dev.json
```

`template` writes skipped, unmeasured records, not simulated successful outputs.
Replace these only with actual adapter results. Output files use exclusive
creation and are never overwritten by the CLI. Do not check private raw captures
into Git without a deliberate sanitization and provenance review.

For adapter integration, import `readCorpus`, `evidenceForCase`, `evidenceSha256`,
`PersistedExtractionRun` and `unavailableMeasurements` from `model.ts`. Save the
canonical raw `RecipeDraftContent` candidate before grounding, the actual raw
provider response, the exact extractor version and current grounder revision.
Keep errors/skips explicit. An empty evidence case should abstain without a paid
invocation. Paid capture must use the existing provider-accounting dispatch
boundary; the scorer does not provide a bypass.

Prepare a bounded subset with the real request factories, without paid calls.
This example selects three development cases:

```sh
node --import tsx evals/recipe-extraction/capture.ts prepare \
  --strategy llama --cases caption-complete,fractions,components \
  --run-id comparison-001 --grounder-revision YOUR_GIT_REVISION \
  --directory /tmp/recipe-capture-001
```

Repeat with `--strategy clairic` in the same new directory. Plans and request files
contain only selected evidence and request metadata. Dispatch these requests
through [accounted transport](../../evals/recipe-extraction/accounted-transport.ts),
using the same capped accounting directory across strategies. An unknown outcome
requires inspecting its original dispatch before any further network request.
The CLI supervises a detached ledger process. Signals or loss of the supervisor
request Effect interruption, wait for unknown settlement and the result artifact,
then dispose the runtime and release the lock. Killing the ledger process itself
can still leave an invoking dispatch and stale lock: inspect and reconcile the
original dispatch instead of deleting its ledger or retrying. Tests cover both
supported CLI launch forms with SIGINT and loss of the supervisor with SIGKILL.
Collection reads persisted accounted results and uses the production decoders:

```sh
node --import tsx evals/recipe-extraction/capture.ts collect \
  --plan /tmp/recipe-capture-001/llama.plan.json \
  --results /tmp/recipe-accounting-001 --latency-source tool_wall \
  --out /tmp/llama-dev.json
```

`prepare`, `rebind-grounder` and `collect` never invoke a provider. Malformed responses retain raw
data and measured usage while recording extraction failure. Missing result files
stay missing. Empty-evidence cases are skipped with zero provider invocations.
Clairic collection uses the verified Unicode-code-point span contract and the
application decoder's state-text/span checks. A new span contract needs a
separately verified adapter.

If grounding changes after requests are frozen, retain the original plans and
raw responses. Collect and score the original grounder with a full Git revision:

```sh
node --import tsx evals/recipe-extraction/capture.ts collect \
  --plan /tmp/recipe-capture-001/llama.plan.json \
  --results /tmp/recipe-accounting-001 --historical-grounder ORIGINAL_FULL_GIT_SHA \
  --out /tmp/llama-original-grounding.json

node --import tsx evals/recipe-extraction/run.ts score \
  --outputs /tmp/llama-original-grounding.json \
  --historical-grounder ORIGINAL_FULL_GIT_SHA --out /tmp/llama-original-score.json

node --import tsx evals/recipe-extraction/capture.ts rebind-grounder \
  --plan /tmp/recipe-capture-001/llama.plan.json \
  --grounder-revision REVISED_GIT_REVISION_OR_WORKING_TREE_LABEL \
  --reason 'Replay the identical saved provider response through revised common grounding' \
  --out /tmp/recipe-capture-001/llama.revised-grounding.plan.json
```

Collect the revised plan normally into a separate file, repeat for Clairic, and
compare only runs using the same grounder. `--historical-grounder` also works with
`compare`. Historical replay reads the selected source from local Git into a
temporary module, resolves its known imports to the installed dependencies,
verifies that the runtime recipe-domain source and dependency lock have not changed, and removes the
temporary file. It fails closed for unknown imports or source drift. It never
replaces the working tree or invokes a provider. The original source bytes,
rather than temporary import rewrites, determine its fingerprint.

Rebinding preserves every request byte and records the original plan fingerprint,
grounder fingerprint, revision and reason in the new plan, captured run and score.
Label these results as the installed extractor with revised common grounding;
they are not measurements of the original production baseline. Raw extraction
scores remain identical between grounding versions. No tuning or re-request is
needed for this local attribution.

Run development first. Freeze each strategy's prompt, parser, fallback trigger
and maximum passes before the first holdout call. Then repeat `score` and
`compare` with `--split holdout`. Holdout is procedurally protected, not hidden
from repository readers. If holdout results influence tuning, retire that split
as holdout and add newly checked cases for the next version.

The comparison produces paired per-field improvements/regressions/ties, per-case
precision/recall deltas, correction burden and usable-case changes. Missing or
failed counterparts are not treated as successful paired observations. Headline
deltas use only comparable pairs, report excluded cases, and are null when no
pair completed. Raw
versus grounded summaries show errors removed and source facts lost by grounding.
Comparisons require matching corpus, split and grounder revision. Record call
order and repeated measurements before interpreting latency differences.

## Decision limits

The [23 October comparison record](../../evals/recipe-extraction/comparison.v1/manifest.json)
contains the six planned requests for three development cases. The first Llama
transport attempt ended without a trustworthy provider response. Its original
dispatch was settled as unknown through the existing accounting repository; the
remaining five requests were not attempted. The saved run contains one unknown
outcome, no inferred latency or charge, and no provider response. The paired
report has **zero comparable pairs**. These records establish no extraction,
latency, spend, hybrid or adoption benefit. No holdout request was made. The
separate compatibility probes are not substitutes for this paired experiment.

Any source-reviewed unsupported grounded assertion, qualifier loss, or wrongly
associated numeric fact fails the safety requirement. Every unreviewed mismatch
blocks a selection. A candidate needs paired source-field improvements without
concealed field regressions and a practical correction/usable-recipe benefit;
cost and latency tradeoffs must use measured values. A hybrid is considered only
when a frozen local strategy shows a gap that a bounded fallback addresses.

Ten cases per split support descriptive smoke/regression comparisons. They do
not support significance claims, an impressive accuracy percentage, or changing
the installed default by themselves. This version does not cover unresolved
cross-source disagreement, human-labelled paraphrase alternatives, negative
dietary claims, false/zero-value expectations, creator/source identity authority,
real media acquisition or a representative creator distribution. Add independently
reviewed raw captures before making a broad product-quality claim.

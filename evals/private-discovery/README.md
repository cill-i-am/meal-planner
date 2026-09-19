# Private discovery evaluation assets

These synthetic product-quality assets implement the adult-discovery portion of [PDR-0006](../../docs/decisions/product/0006-ai-evaluation-and-release-evidence.md). They contain no real household data, accepted baseline or release verdict. [PR #218](https://github.com/cill-i-am/meal-planner/pull/218) merged the implementation; the product owner explicitly deferred broader evaluation and human ratings. Those outcomes remain unproven, rather than being counted as passed.

| Asset | Purpose |
| --- | --- |
| `scenarios.json` | Eight families, initial context, withheld answers, expected cards, challenges and prohibited outcomes. |
| `rubric.json` | Hard assertions, critical 1–5 anchors, quality bands, calibration rules and deferred owners. |
| `judge.md` | Instructions for a separately fixed soft-quality judge after hard checks pass. |
| `evidence.template.json` | Empty result format with provenance, disclosure/transition receipts and unavailable telemetry. |
| `calibration.template.json` | Eight unscored product-owner rows and the separate second-human pre-beta obligation. |
| `provider-accounting-policy.json` | Supported SDK/gateway retry multiplier and conservative per-turn reservation. |
| `validate.ts` | Offline asset and accounting-policy validation. |
| [Published SDK live opening](kimi-published-sdk-opening-results.md) | Current implementation's successful native opening, explicit confirmation, reload proof and cost checkpoint. |

The [Stage 2 plan](../../docs/delivery/stages/02-private-discovery/README.md) retains shorter dependant assistance and the full repeat-review flow in Work Item 04. This pack exercises adult discovery across all eight families. Discussing a dependant or fallback does not prove a dependant-targeted confirmation flow. Routine, capacity, equipment and fallback needs remain private context, not food-preference facts. Later-stage obligations stay `not_exercised` and are excluded from pass counts and quality aggregates.

## Historical findings

The removed experiment reports and receipts remain available in the [pre-cleanup Git tree](https://github.com/cill-i-am/meal-planner/tree/04e97e8389e531bd2bc4af46945f2ed349674d12/evals/private-discovery). Their versions and outcomes are unchanged. Read the relevant frozen report if its detailed evidence is needed; the current tree keeps the reusable procedure and latest live proof.

- Prompt-only questioning omitted required coverage; strict application-owned topics, transitions and wording now own that contract. The v23 focused dependants/fallbacks case passed its eleven hard assertions and received fixed judge scores of 5/5 in both dimensions, but never established an eight-family or human-calibrated baseline. The later v23 baseline missed ordinary meals.
- A schema-valid response can still be semantically wrong: the JSON-object opening proposed an unsupported removal, and GPT v16 claimed a completed update without a canonical change. Semantic assertions and actual confirmation receipts remain necessary.
- Complete transport is not application acceptance: Qwen's malformed JSON and the v24 missing `subject` response failed validation. The v25 HTTP 408 and early timeouts had unknown upstream causes/outcomes; no retrospective success or usage credit is assigned.
- The `agent-eval` 2.2.1 spike exercised a synthetic native A-to-B path, but its trace parser returned no normalized events and a mechanics probe retried a deterministic failure into a pass. Do not adopt that package; retain the native harness and assisted procedure below. That provider-free spike was not live-model or final-runtime acceptance.

## Published SDK retries and accounting

The unmodified OpenAI client retries transient errors twice, so one admitted application turn can make three provider attempts. Supported gateway options allow one gateway attempt per SDK request. The application adds no automatic turn retry. The retired single-forward evaluation proxy is not used by this path; new runs use the native binding and record logical turns separately from actual provider attempts when observable.

The [accounting policy](provider-accounting-policy.json) reserves **1,533,546 microUSD ($1.533546) per application turn**, covering three full 511,182-microUSD attempts. Reserve before admission. Unknown or untrusted final usage retains the entire reservation; cancellation can still incur upstream cost. Historical single-attempt receipts are not the current admission bound.

At the latest retained live checkpoint on 2026-09-19, historical post-anchor exposure was **7,319,299 microUSD**. The new turn retained **1,533,546 microUSD**, for **8,852,845 microUSD** total conservative exposure against the authorized additional **20,000,000-microUSD** allowance. The remaining **11,147,155 microUSD** is an evidence checkpoint, not reconciled billing or a guarantee that no later spend exists. Refresh the ledger and applicable authorization before another paid run. Deleting old reports does not release or reset any reservation.

## Assisted disclosure policy: private-discovery-driver-v1

Version 1 is a manually facilitated scenario pack, not an automated semantic driver. A facilitator follows the fixed policy below while the real candidate model, private runtime and admitted commands produce the actual interaction. Record the facilitator role and policy version. Do not script assistant replies, profile cards, successful commands or model outcomes.

1. Provision the synthetic adult and current profile through the real test setup. The fixture's `ownProfile` is a compact value/standing/ID seed; runtime metadata and any remapped IDs come from setup receipts. Supply the candidate only its actual canonical own-profile context and the opening participant message. Never send `evaluatorOnly`, expected artifacts, the rubric, other adults' profiles or old transcripts to the candidate.
2. For each actual candidate question, inspect the fixed `revealWhen` criteria. Disclose a withheld answer only if that question substantively requests its topic. A generic request to reveal every hidden detail is insufficient. One relevant question may reveal multiple matching facts; do not drip-feed them to manufacture extra questions. If relevance is ambiguous, withhold the fact and record the uncertainty rather than inventing a semantic pass.
3. Record the fact ID, candidate-question reference, facilitator's criterion judgment/rationale, and actual participant-message reference for every disclosure. Use the fixture answer's meaning without adding new material facts. For an out-of-scope question, say the fixture has no further information; record unnecessary questioning. Initial known facts are supported by the opening/profile receipt and do not require a fabricated question receipt.
4. Deliver the listed challenge when its observable trigger occurs. A correction may clarify an already-correct proposal; do not induce a false prior mistake. Match intent and semantics, not exact wording. If the trigger never occurs, record the missing transition instead of injecting a canned card to continue.
5. Review actual progressive cards, then exercise correction/rejection and the participant's explicit admitted confirmation. Inspect its real settlement, canonical profile/version and retained card outcome before recording success. A synthetic actor may choose the action; the domain result must be real.

This policy makes manual disclosure decisions inspectable, not automatically semantic. A deterministic checker can verify fact IDs, message ordering and actual receipts. It cannot infer that a question was relevant, a summary showed understanding, or prose contained no invented confirmed fact merely from a keyword match. Record those assertion reviews separately with reviewer/method, evidence and limits. Missing or disputed hard evidence remains unverified and blocks soft release judging. Keep assisted versus automated measurement methods visible when comparing runs; changing the driver requires reviewed versioning.

## Cards and transitions

The v25 model submits semantic AddFact, ConfirmFact, RemoveFact or ReplaceFact proposals through `SubmitDiscoveryTurn`. The application resolves current targets and maps them to the canonical [`ProfileCardChange`](../../packages/private-interview-api/src/index.ts), including the separate safety path. Sample `expectedCards.change` objects use that canonical contract; historical reports retain their original model vocabulary. Compare tags, fact identity, preference strength, safety category and supported meaning; labels need not match one exact phrase. If IDs are remapped during fixture provisioning, use the actual canonical ID and retain the mapping receipt. No model-authored actor, target person, confirmation basis, provenance, card status, reviewed fact, expected version or safety consent is accepted.

`AddConfirmedProfileFact` names the requested eventual change; its initial card is still **proposed**, private and uncommitted. The common observed trajectory is `proposed → corrected proposed/rejected → proposed → pending → confirmed`, with an actual committed Household outcome and profile version for the accepted card. Do not require every corrected interaction to emit a separate rejected card: revision and rejection are the existing alternative participant operations. A rejected card stays rejected; any replacement is separately visible. If a real stale-version conflict occurs, record `conflict` and refreshed review; never call it confirmation. Current safety constraints stay active, and an actual reduction needs the separate admitted safety confirmation. A transcript claim, tool request, pending card or agent bookkeeping is not commitment proof.

The simple-household `repeatSpike` is the required narrow harness seam: real discovery, visible proposal, correction, admitted confirmation, completion of A, then fresh B using the current committed profile and new dialogue only. B must not receive A's transcript or rejected/private material. Its removal proposal uses the real current fact ID and requires a new admitted confirmation. Record the actual two-session receipts; do not count a fabricated profile or session as an end-to-end pass. This does not claim the full WI04 focused-review product flow.

## Review and evidence

Copy the empty evidence format for a real run; its `scenarioResultTemplate` is a shape example, not a ninth scenario result. Create one result for each exercised canonical family and enumerate all common plus scenario-specific hard assertions. Missing families, unverified assertions and deferred capabilities cannot be counted as passing. Retain required discovery IDs, actual cards and transitions, prohibited-outcome inspections and their receipts per scenario.

Record immutable source head/tree, exact candidate provider/model/configuration, prompt/tool/policy versions and content digests, scenario/rubric/applicability, harness/driver configuration, separately fixed judge, and calibration-set versions. Run IDs and provenance stay null until known. Synthetic interaction evidence may be retained for review; never copy real private dialogue, secrets, provider credentials or identifying household data into this pack or results.

Measure question and repeat counts, participant turns, latency, tool/schema failures, tokens and cost only from actual evidence with a stated method. The manual classification of repeated questions needs its own review receipt. Unavailable measurements stay null with `unavailable` status, never zero. Cost needs a currency and price basis. Do not invent a meaningful-regression threshold for operational measures: record the comparison for explicit product review.

Only after required hard checks and prohibited-claim inspection pass may the fixed judge score household specificity and profile synthesis. Human review then calibrates those scores against this scope. Copy `calibration.template.json` for that run; all eight product-owner rows remain unscored until an actual human supplies scores and rationale. Do not prefill them from a model or this asset review. Preserve every scenario/dimension score: averages cannot conceal a hard blocker, a score below 3, a 0.5-point regression or material burden/reliability/cost regressions.

Use the PDR's exact green/review/red policy in `rubric.json`. No accepted baseline means baseline comparison is unavailable, not that a candidate is calibrated green. An ordinary candidate also needs human review of all hard failures, critical scores at 3 or lower, meaningful regressions, requested overrides and two rotating green cases. Judge/rubric/policy changes trigger all-eight human review. A product owner may explicitly accept a non-hard regression under the PDR's evidence requirements; no one may waive a hard blocker.

## Asset validation

Run `pnpm exec node --import tsx evals/private-discovery/validate.ts` from the repository root. It checks the eight-family roster, oracle references, deferred owners, 1–5 anchors, blank evidence/calibration templates and compatibility of the fixture facts/cards with the actual production schemas. It makes no model, provider or network call and is not an eval harness or quality scorer. Formatting and focused lint also apply to these assets; passing them is asset validation, not runtime, discovery-quality or human-calibration evidence.

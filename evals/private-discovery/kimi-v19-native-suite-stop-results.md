# Kimi v19 native continuation: eight successes, then reply-decision rejection

**Reviewed sanitized record.** Nine Kimi calls produced **eight successful native turns and one `invalid_output` failure at `reply_decision`**. One fixed GPT-OSS judge call also succeeded: **10 paid calls**, all known, complete HTTP 200 responses with finish reason `stop`. One family completed natively; **no family or candidate was accepted**.

The final call was turn two of **Dependants and fallbacks**. Its `Ask.topicKey` was `dependant_hard_constraints`, with no corresponding unresolved note in merged continuity. The native diagnostic recorded `reply_decision` at **2026-09-10T21:22:16.341Z**; automatic stop followed at **21:22:16.379Z**. The original response was **1,682 bytes**, SHA-256 `ea18de52e6758151e9474d869be7760f7b71eb8b95ed97640312b8f68500b040`, using **3,369 input / 256 output tokens**. There was no token-cap or deadline exhaustion, transport failure, retry, or output repair.

Before/after native reads preserved session version **5**, messages, the card, pending state and the prior successful turn exactly. The failed turn retained **null summary and continuity**, with no failed reply in history. The three-message history contains two participant messages and one assistant message. The whole canonical profile remained at version **1**, containing only the previously explicitly confirmed vegetable-curry like.

| Family | Candidate calls | Actual outcome |
| --- | --: | --- |
| Simple household baseline | 3 successes | `candidate_coverage_incomplete_parked`, not a harness failure. Actual original and corrected-card reviews, three explicit confirmations and two participant review refreshes established roasted-tomato-soup like, cold-tomato-soup dislike and `NoKnownHardConstraints` at profile v3. The candidate prematurely chose Review before required `simple.routine` discovery. A stayed open at v14; B and judging were not run. |
| Conflicting adult routines | 4 successes | All required disclosures and the fixed challenge were exercised. Actual chickpea confirmation produced profile v1; A completed at state v11. Full eight-message history preserves the unrequested replacement of the oats draft by a chickpea draft and unsupported uncertainty about oats. Root classified this as a non-hard operation-selection and synthesis defect under PDR0006. Status: **review_required**. |
| Dependants and fallbacks | 1 success, 1 failure | Curry was explicitly confirmed before the rejected second call. The fixed dependant challenge and adult safety were not exercised; the fixture remains incomplete. |
| Other five families | 0 | Not run. |

The adults review passed **11/11 hard assertions only**. Its single fixed judge scored **household specificity 4/5** and **profile synthesis 3/5**, with `possibleHardFailure:null` and usable soft evidence. Baseline comparison was unavailable and human calibration was false. Those model scores are **not a human rating or family acceptance**.

Source `477795917da53c574b2375cf0a21134331f52354`, tree `31305b31231a7bf2d6d47f9ed3cdddbdc54efdb3`, prompt `private-discovery-prompt-v19`, policy `private-discovery-policy-v3`. Kimi K2.6 used `json_object`, thinking disabled, temperature **0.6**, top_p **0.95**, a **4,096-token** cap, one choice, nonstreaming, **120 seconds** and one provider attempt. top_k, tools and tool_choice were absent; gateway payload collection was disabled and cache bypass requested. The fixed GPT-OSS 120B judge used a **2,048-token** cap, temperature **0**, `json_schema` and **60 seconds**.

| Dispatch order | Fixture turn | Result | Input / output tokens | Dispatch → completion ms | Estimated USD |
| --- | --- | --- | --: | --: | --: |
| 1 | Baseline 1 | succeeded | 2,936 / 206 | 9,785 | 0.00361320 |
| 2 | Baseline 2 | succeeded | 4,420 / 412 | 14,626 | 0.00584700 |
| 3 | Baseline 3 | succeeded | 3,816 / 132 | 6,272 | 0.00415320 |
| 4 | Adults 1 | succeeded | 2,939 / 296 | 12,673 | 0.00397605 |
| 5 | Adults 2 | succeeded | 4,503 / 229 | 8,635 | 0.00519385 |
| 6 | Adults 3 | succeeded | 4,811 / 342 | 12,211 | 0.00593845 |
| 7 | Adults 4 | succeeded | 5,077 / 318 | 13,246 | 0.00609515 |
| 8 | Dependants 1 | succeeded | 2,948 / 235 | 8,665 | 0.00374060 |
| 9 | Adults judge | succeeded | 7,034 / 1,518 | 17,715 | 0.00360040 |
| 10 | Dependants 2 | failed | 3,369 / 256 | 6,938 | 0.00422455 |
| **Total** | **10 paid calls** | **8 candidate successes / 1 candidate failure / 1 judge success** | **41,853 / 3,944** | **110,766** | **0.04638245** |

Order follows `dispatch.at`, including the judge between dependant turns 1 and 2. Candidate usage totals **37,245 tokens / $0.04278205**; judge usage totals **8,552 tokens / $0.00360040**. Estimates price all reported input tokens at the full configured rate, without cache discounts: [Kimi $0.95 input / $4.00 output per million](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/) and [GPT-OSS $0.35 / $0.75](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/), corroborated by root against the official pages on 10 September. These estimates are **not reservations or invoices**; actual cached-token accounting and billed cost remain unknown. Intervals include native handling or judge decoding, exclude gaps between calls when summed, and are not provider-only latency or elapsed suite duration.

The frozen plan allowed **38 new Kimi calls and 8 judge calls**, with **127 total participant intents** including 89 prior intents, within a **19,768,638-microUSD** cumulative reservation ceiling. Actual use was nine candidate intents, bringing the intent count to **98**. Phase reservations were **2,435,125 microUSD**; the cumulative ledger closed at **132 calls / 125 higher-cap calls / 1 judge / 11,747,077 microUSD**. Planned caps do not establish coverage or usage.

Graceful shutdown was recorded at **2026-09-10T21:27:38.399Z**. Runtime and actor joined with exit **0**; all three checked processes and the listener were absent, both locks were absent, and runtime/transport/gate/remote-session disposal was recorded. There were **10 captures / 10 reports / 0 blocked requests**. Provider-side revocation was not verified. This incomplete, non-thinking run establishes no accepted baseline, model superiority, complete suite result, or thinking-enabled result.

Companion JSON: `kimi-v19-native-suite-stop-results.json`; SHA-256 `cf9aad7b614b6da872ed9a683b00092a3ce8a6dabeec5132688995ae916a91b6`. Exact source, response-byte and receipt hashes are retained there. Absolute private origins remain in a separate evidence index excluded from source import.

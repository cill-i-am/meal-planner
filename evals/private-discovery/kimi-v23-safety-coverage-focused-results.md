# Kimi v23 safety coverage: focused observed quality pass

**The focused Dependants and fallbacks test passed its observed quality gate.** Four successful native turns covered all four required discoveries and the fixed challenge, with two explicit adult-profile confirmations and actual session completion. All **11 scoped hard assertions passed**. The separately fixed GPT-OSS-120B judge scored **5/5 for household specificity and 5/5 for profile synthesis**, exceeding the focused threshold of 4/5 in each dimension.

This is one synthetic adult-own-profile result. **It is not a human-calibrated release, accepted cross-candidate baseline or full-suite acceptance.** Baseline comparison remains unavailable; no human ratings were supplied.

The opening supplied the adult's curry preference. Turn 1 proposed its early card, declared a private fallback need and retained an unresolved own-adult safety question. The application first asked why the fallback was needed. Actual confirmation committed the reviewed curry card, advancing the canonical profile **0 → 1**.

Turn 2 recorded the dependant's dislike privately and asked jointly about the acceptable alternative and preparation. Turn 3 retained the exact fictional product, one-pot quantity, no-substitution restriction and no-second-full-meal limit, then displayed the retained adult-safety question. Turn 4 handled the fixed adult answer and challenge, preserving the adult-only preference and exact fallback meaning while proposing only the adult's `NoKnownHardConstraints` card. Its separate confirmation advanced profile **1 → 2**.

Actual native completion reached **version 13**, with all **eight messages**, two confirmed own-adult cards and no pending confirmation. All four persisted snapshots and rendered messages matched canonical source evaluation. No dependant or fallback fact entered the canonical profile. **Typed fallback details were durably retained in private continuity**; the judge's no-fallback-persistence wording refers only to canonical profile facts.

| Candidate turn | Application question/decision | Input / completion tokens | Append acknowledgment → completion |
| --- | --- | --: | --: |
| 1 | Fallback reason | 4,185 / 2,791 | 67.671 s |
| 2 | Fallback option and preparation | 4,679 / 2,908 | 65.258 s |
| 3 | Own-adult safety | 4,866 / 4,652 | 115.024 s |
| 4 | Review | 5,174 / 5,616 | 142.468 s |
| **Candidate total** | **4 native successes** | **18,904 / 15,967** | **390.421 s** |

All four candidate responses and the judge response were known, complete HTTP **200** responses ending with **stop**. There were no transport/schema failures, automatic provider retries or output repairs. The judge used **7,165 input / 1,288 completion tokens** and took **19.373 seconds** from dispatch through decoded completion. Candidate and judge timing boundaries differ; neither is provider-only latency or total interview duration.

The formal root hard review combined full-dialogue/card/state semantic inspection, actual committed Household outcomes and native completion with exact-source privacy/access tests. Those tests supply negative access evidence; this actual interview supplies positive ownership/effect evidence. No new foreign-session attack probe or safety reduction was exercised. The judge received all eight original messages and six distinct actual outcomes in a **32,022-byte** request (**32,161-byte** native envelope). It returned `possibleHardFailure:null`, with no accepted baseline comparison or human calibration.

Source `52d1b2305a0bf31196266e78b382bfe46d4863e8`, tree `2a17164d56f1b2adab9b93e4830745f7ba73cd20`, used prompt `private-discovery-prompt-v23` and policy `private-discovery-policy-v5`. Kimi retained thinking enabled, temperature **1**, top_p **0.95**, `json_object`, one nonstreaming choice, **65,536 completion tokens**, a **900-second** deadline and **2 MiB** response limit. The fixed judge used GPT-OSS-120B, temperature **0**, `json_schema`, **2,048 tokens** and **60 seconds**. [Both exact-head CI checks passed](https://github.com/cill-i-am/meal-planner/actions/runs/34666793892): **1,491 tests across 114 files**, including 88 native private-output, 85 household-boundary and 27 household-object cases. Closure verification found all **946 source files and modes**, all **360 harness pins**, the manifest and the main checkout index unchanged.

Configured full-input estimates are **$0.0818268 for the candidate**, **$0.00347375 for the judge**, and **$0.08530055 total**. Aggregate completion tokens are counted once. Cache-aware cost and actual billing remain unknown; these are not invoices.

The phase reserved **2,091,060 microUSD**: 2,044,724 for four candidate calls and 46,336 for the judge. The cumulative ledger closed at **152 calls / 144 higher-cap reservations / 2 cumulative judge reservations / 21,260,092 microUSD**. The recorded original allowance was **20,000,000 microUSD additional** from a **3,246,080-microUSD** anchor, giving a **23,246,080-microUSD** cumulative ceiling. Reservations since that anchor were **18,014,012 microUSD**, leaving **1,985,988 microUSD** at closure. All historical reservations, including unknown outcomes, were retained. Two authorized candidate slots were unused because the focused test completed. Reservations are not billed spend.

An initial local launch was rejected by automatic approval review before process creation, with zero provider calls or reservations. Verification of the existing synthetic-data and destination authority allowed the same reviewed command to run without changing its payload, destination or permissions. This was not a provider retry or new spending authority.

Shutdown was graceful at **2026-09-12T02:51:14.731Z**. Actor and runtime joined with exit **0**; all three recorded processes, the listener and both locks were absent. Five request captures and five response reports were recorded, with zero blocked requests and ordinary network forwarding disabled. Provider-side revocation was not verified.

All-eight-family completion, the complete candidate comparison, required live A-to-B removal and actual product-owner calibration remain outstanding. PR #218's full-scope merge/release gates and deferred-stage obligations remain unmet.

Companion JSON: `kimi-v23-safety-coverage-focused-results.json`; SHA-256 `f87f548d1e1bb5bb662745170ef7ff443c7d9a3bcfb5457148c2fa632da1a8c3`. Exact source, request/response, review, judge, confirmation and closure provenance is retained. Private origins, identifiers, raw transcript text and reasoning content are excluded.

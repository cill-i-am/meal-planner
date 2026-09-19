# Kimi v18 native continuation: six successes, then schema rejection

**Reviewed sanitized record.** Seven native calls produced six successful turns and one `invalid_output` failure at the actual **`output_schema`** stage. All seven provider responses were known, complete **HTTP 200**, finish reason **stop**, with no transport failures. No family was completed or accepted.

The final call was turn five of **Conflicting adult routines**. It emitted **seven continuity updates against a maximum of six**: five unchanged retained notes plus two changed/new updates. A source-owner read-only decode of the unchanged captured output against the pinned source schemas established this mismatch; no modified-output execution or replay occurred. The original response was **2,804 bytes**, SHA-256 `3ff9b24b8eeed0a3398fe7eea143fe961cdbe58a089b075ac35c1cfef49c048e`. The automatic stop was recorded at **2026-09-10T20:40:15.012Z**.

Actual before/after native reads preserved session, messages, the existing card, pending state and four prior successful turns/continuity exactly. The failed turn had **null summary and continuity**. Adult history retained nine messages—five participant and four assistant—with one unchanged card. The whole canonical profile stayed at version **0**, with no confirmed cards.

| Family | Actual calls | Status |
| --- | --: | --- |
| Simple household baseline | 2 successes | Harness-incomplete and parked. Root continued after the original-card review returned `ok:false`; its cause remains unproven. The model produced a supported revision of the proposed card, but that did not restore the missing original-review receipt. No confirmation or baseline B. |
| Conflicting adult routines | 4 successes, then 1 failure | Stopped at `output_schema` on turn five. Earlier accepted state remained exact. |
| Other six families | 0 | Not run. |

Source `5bfdaa61f78222b0db8423745c99ce100c6b4d45`, tree `5d9be7bf640f81d25b3d20ba47099dad66a4068f`, prompt `private-discovery-prompt-v18`, policy `private-discovery-policy-v3`. Kimi K2.6 used `json_object`, thinking disabled, temperature **0.6**, top_p **0.95**, a **4,096-token** cap, one choice, nonstreaming, **120 seconds** and one provider attempt. top_k, tools and tool_choice were absent; gateway payload collection was disabled and cache bypassed.

| Chronological call | Fixture turn | Native result | Input / output tokens | Dispatch → completion ms | Conservative USD |
| --- | --- | --- | --: | --: | --: |
| 1 | Baseline 1 | succeeded | 2,887 / 225 | 7,899 | 0.00364265 |
| 2 | Baseline 2 | succeeded | 4,384 / 343 | 11,190 | 0.00553680 |
| 3 | Adults 1 | succeeded | 2,887 / 246 | 7,252 | 0.00372665 |
| 4 | Adults 2 | succeeded | 4,393 / 239 | 7,862 | 0.00512935 |
| 5 | Adults 3 | succeeded | 4,574 / 295 | 10,964 | 0.00552530 |
| 6 | Adults 4 | succeeded | 4,776 / 336 | 11,043 | 0.00588120 |
| 7 | Adults 5 | failed | 5,001 / 474 | 13,999 | 0.00664695 |
| **Total** | **7 calls** | **6 succeeded / 1 failed** | **28,902 / 2,158** | **70,209** | **0.03608890** |

Usage totals **31,060 tokens**, including the rejected output. Estimates price every input token at $0.95/million and output at $4.00/million without cache discounts; they are **not reservations or invoices**. Timings include native handling and are not provider-only latency. Each actual call retained **265,421 microUSD**; the phase reserved **1,857,947 microUSD**.

Manual inspection of the **six accepted rendered replies** counted **nine question instances**, six question topics summed per reply, and **three within-reply repetitions**. Two neutral participant responses were admitted for questions outside the fixture facts; those responses disclosed no fixture facts. The rejected raw final reply also repeated its question, but is excluded from accepted-history counts. Its unchanged repeated proposal is a **latent downstream concern** identified through source-validator inspection, not an executed or persisted `proposal_duplicate` failure: the actual call stopped earlier at `output_schema`.

The frozen plan permitted **45 new candidate calls and 8 judge calls**; actual use was **7 and 0**. Its global participant cap was **127 including 82 prior intents**; seven new intents brought the total to **89**. These caps are not completed coverage. Closure reservations were **122 calls / 116 higher-cap / 0 judges / 9,311,952 microUSD**.

Runtime closure was recorded at **2026-09-10T20:42:59.439Z**. Runtime and actor joined with exit **0**; the three checked processes and listener were absent, both actual lock paths were absent, and runtime/transport/gate/remote-session disposal was recorded. Provider-side revocation was not verified. There was no retry or repair, fixed-judge score, human rating, accepted baseline or model-superiority finding. This v18 record does not establish that a later prompt change is fixed.

Companion JSON: `kimi-v18-native-suite-stop-results.json`; SHA-256 `98a81b7fbce4af9c2c133a1e9cb94407e1c1618b90afe32b622f3a148b85e64e`. Exact source/response/receipt hashes are retained there; private origin paths remain in the separate private index.

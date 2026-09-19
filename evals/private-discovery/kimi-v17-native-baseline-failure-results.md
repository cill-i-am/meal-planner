# Kimi v17 first baseline opening: native continuation rejected

**Reviewed sanitized record.** The first **Simple household baseline** call returned a known, complete **HTTP 200** response ending in **stop**, then failed native validation as `invalid_output` at the captured **`reply_decision`** stage. Its `Ask.topicKey` named `hard_constraints` without a matching unresolved note in empty prior continuity or the three submitted circumstance notes. Source JSON and output-schema checks passed before that diagnostic; this was not a transport failure or a complete hard-check pass.

Native rejection was atomic for generated output: **zero accepted assistant replies, cards, summaries or continuity**, no pending confirmation, and the whole canonical profile unchanged at version **0**. One failed turn remained in the open version-1 session. A relevant safety question and supported proposal existed only in rejected raw output; they did not become an accepted response or household change. The raw question was duplicated across fields.

Source `a8305f5f4c82be82e9dd991db3064d29dec06548` (tree `5fa3076afbc68c4416a36cf18eb07e6278ef104a`), prompt `private-discovery-prompt-v17`, policy `private-discovery-policy-v3`. Kimi K2.6 used `json_object`, thinking disabled, temperature **0.6**, top_p **0.95**, **4,096** maximum completion tokens, one choice, nonstreaming, a **120-second** deadline and one provider attempt. top_k, tools and tool_choice were absent; gateway payload collection was disabled and cache bypassed.

| Measure                                                 | Recorded value |
| ------------------------------------------------------- | -------------: |
| Native calls / successes                                |          1 / 0 |
| Input / output tokens                                   |    2,841 / 226 |
| Total tokens                                            |          3,067 |
| Conservative usage estimate, USD                        |     0.00360295 |
| Phase reservation, microUSD                             |        265,421 |
| Native capture dispatch → native completion receipt, ms |          7,840 |
| Original native response bytes                          |          1,499 |

The estimate prices all input at $0.95 and output at $4.00 per million tokens, without a cache discount. It is **not a reservation or invoice**. The latency includes native handling and is not provider-only latency or the append-acknowledgement interval used in the earlier dependency checkpoint.

Original response SHA-256: `d3fdf20bc00ac44d95ad34b31e85989c01d8448dc940b1a519fe52a39cdd57c5`.

The phase stopped after this one failed opening, without retry or repair. The family was neither completed nor accepted; seven other families and baseline B remained **not_run**. There were **zero** confirmations or fixed-judge calls; human scores remain **null**. This does not establish an eight-family result, model superiority, human calibration or an accepted baseline.

Runtime closure was recorded at **2026-09-10T20:03:52.608Z**. Runtime and actor-supervisor exits were **0**; runtime, transport, gate and remote-session disposal were recorded, with no remaining processes, listener or actual locks. Provider-side revocation was not verified. Closure accounting was **115 calls / 109 higher-cap / 0 judges / 7,454,005 microUSD**; the strict cumulative **20,000,000-microUSD** ceiling left **12,545,995** at that closure. These are reservation limits, not charges or a refreshed current balance.

Companion JSON: `kimi-v17-native-baseline-failure-results.json`; SHA-256 `781fe1d110e2ae7bee25f45048311b4451692edfdd89ff2484154af5b7ba5770`. Exact response and receipt hashes are retained there. Private origin paths remain outside these sanitized records.

# Kimi v17 native dependency checkpoint: harness-incomplete

**Reviewed sanitized record.** Two native calls succeeded with complete HTTP 200 responses. Root and independent checkpoint review supported the continuation and one proposed replacement card; the whole canonical profile remained unchanged at version 1. No hard failure was demonstrated in these two turns. This phase establishes **neither a family pass nor a candidate failure**.

A malformed root inspection command supplied `action` instead of required `op`. The supervisor rejected it before admission or actor forwarding and terminated the in-memory participant. The command caused no new participant intent or provider call. The existing actor was not resumed or replayed; the runtime closed. This local interruption must remain separate from model reliability.

Source `a8305f5f4c82be82e9dd991db3064d29dec06548` (tree `5fa3076afbc68c4416a36cf18eb07e6278ef104a`), prompt `private-discovery-prompt-v17`, policy `private-discovery-policy-v3`. Kimi K2.6 used `json_object`, thinking disabled, temperature **0.6**, top_p **0.95**, **4,096** maximum completion tokens, one choice, nonstreaming, a **120-second** deadline and one provider attempt. top_k, tools and tool_choice were absent; gateway payload collection was disabled and cache bypassed.

The actual native read retained two assistant replies, two successful turns/summaries and one unconfirmed proposed replacement card. Source continuity matched the inspected output. A read-only copy of actual SQLite established whole-profile equality after the interruption; the database bytes stayed unchanged during the copy. A canonical HTTP read after turn two was not completed.

| Measure                                                    | Recorded value |
| ---------------------------------------------------------- | -------------: |
| Native calls / successes                                   |          2 / 2 |
| Input / output tokens                                      |    6,103 / 583 |
| Total tokens                                               |          6,686 |
| Conservative usage estimate, USD                           |     0.00812985 |
| Phase reservation, microUSD                                |        530,842 |
| Participant append acknowledgement → native completion, ms |  7,067 / 9,901 |

The estimate prices all input at $0.95 and output at $4.00 per million tokens; it applies no cache discount and is **not a reservation or invoice**. Timing includes native handling and is not provider-only latency. Manual review counted four rendered question instances, two distinct questions and two repetitions: both turns repeated their question across fields. These are observations, not judge or human grades.

Only two turns of **Dependency and repair** ran. There was no challenge, confirmation, completed session, fresh B, accepted family or baseline. Seven other families were not run. Fixed-judge calls were **zero**; human scores remain **null**.

Runtime closure was recorded at **2026-09-10T19:24:17.581Z**. Runtime exit **0** and actor-supervisor exit **1** were observed; runtime, transport, gate and remote-session disposal were recorded, with no remaining processes, listener or actual locks. Provider-side revocation was not verified. Cumulative closure accounting was **114 calls / 108 higher-cap / 0 judges / 7,188,584 microUSD**; these are reservations, not charges.

Companion JSON: `kimi-v17-native-dependency-checkpoint-results.json`; SHA-256 `6f84b6d53d0ba170617fcf9b55c5d0084e98673d50108cb3ca0ed009a10eeb47`. Exact response and receipt hashes are retained there. Private origin paths remain outside these sanitized records.

# Prompt v10: profile changes confirmed, discovery incomplete

All **eight native generations succeeded**, and both intended profile effects were confirmed. The existing bean-chilli preference was replaced in place with lentil soup (profile version 1 → 2), then the explicitly disclosed `NoKnownHardConstraints` fact was added (2 → 3), preserving the replacement. The final profile contained exactly two confirmed facts, with no duplicate or invented committed/plan-repair claim observed.

The phase stopped for **incomplete coverage and conversation quality** at the eight-intent fixture cap. Required `repair.dependency` discovery was missing. No proven hard or driver violation was found, but no family or baseline was accepted. The other seven families, A/B repeat, judges and human calibration were not run.

Source `974609a999fa5f8e04fe4563771172b45951c97b`, prompt `private-discovery-prompt-v10`, freeze `1fe031e8fd64d07be4ce8a694aba3fdd75402ea65e41d9a0200ad8ab6f2f47c6`. Candidate settings remained GPT-OSS 120B, 4,096 maximum output tokens, temperature 0, non-streaming, a 120-second deadline and one maximum provider attempt; gateway payload collection and caching were disabled.

| Call | Input tokens | Output tokens | Estimated USD | Ticket to completion ms | Dispatch to completion ms |
| --- | --: | --: | --: | --: | --: |
| 1 | 2909 | 320 | 0.00125815 | 10146 | 10059 |
| 2 | 3075 | 577 | 0.00150900 | 15434 | 15372 |
| 3 | 4587 | 584 | 0.00204345 | 5004 | 4939 |
| 4 | 3491 | 579 | 0.00165610 | 12601 | 12487 |
| 5 | 3614 | 638 | 0.00174340 | 12985 | 12898 |
| 6 | 3870 | 781 | 0.00194025 | 17859 | 17561 |
| 7 | 3999 | 440 | 0.00172965 | 14771 | 14632 |
| 8 | 4140 | 488 | 0.00181500 | 14702 | 14603 |
| **Total** | **29,685** | **4,407** | **0.01369500** | **103,502** | **102,551** |

Total usage was **34,092 tokens**. Every response was complete HTTP 200, one choice, finish reason `stop`, with a known successful native outcome. All eight calls remain included. Timing ends at recorded native completion and includes orchestration/native handling; it is not isolated provider latency. Cost uses the frozen $0.35/$0.75 per million input/output tokens and is an estimate, not an invoice. Provider-only latency, first-token time, cached/reasoning subtotals and quality scores remain unmeasured.

Manual question classification found **7 substantive question units in 7 turns**, **1 strict repeated question** (call 7, ingredients after the fixed neutral response), and **1 separate category-narrowing follow-up** (call 6, dishes → ingredients). Alternatives requesting the same answer count once. Call 3 was confirmation-only and excluded: there was one direct confirmation invitation, plus conditional reminders in calls 2 and 5. Counting that direct invitation as substantive would produce eight units; counting category narrowing as repetition would produce two. These are descriptive assistant classifications, not human or judge scores.

The questions covered desired change (1), future batch intent (2), confirmation only (3), safety (4), extra dishes (5), ingredients (6), repeated ingredients (7), and general cooking constraints (8). The opening batch-cook context remained in native requests, but current dependencies were never established. Later summaries omitted that context and narrated known profile/card status. The final summary's description of no further fixture information as declined to provide was a fidelity quality concern; no invented food fact or authority effect was observed.

Driver receipts show one opening, two earned fact disclosures (`repair.replacement`, `repair.safety`), one profile-only challenge, and four fixed neutral replies at participant calls 4/6/7/8 referencing actual assistant calls 2/5/6/7. The neutral wording supplied no extra facts and did not establish participant refusal. Independent review accepted the driver and all 17 selected neutral-binding checks. No provider request was retried.

The phase reserved 382,976 micro-USD ($0.382976). Final historical counters were 84 calls, 78 higher-cap calls, zero judges and 4,012,032 micro-USD ($4.012032) cumulatively reserved. Since the existing $20 additional-authority anchor of 68 calls / 3,246,080 micro-USD, 16 calls reserved an additional 765,952 micro-USD ($0.765952). Reservations and token-cost estimates are separate measures.

Graceful closure was verified at **2026-09-09T02:22:34.997Z**: actor/runtime acknowledgements and successful joins, absent locks and closed local listener. Provider-side revocation was not verified. The native session remained open at its final inspection; resource closure is not scenario completion.

The companion JSON retains every call's usage, timing and schema/body/response/summary/receipt hashes, confirmed effects, manual counting definitions, neutral provenance and missing coverage. JSON SHA-256: `e74ceb3bc1a3ee45543f71a2e90d6c21df65d47b2f28d8d43fb5bf8dc365670c`. It contains no later-prompt or statistical improvement claim.

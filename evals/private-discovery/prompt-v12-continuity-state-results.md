# Prompt v12: reply rejected, earlier state preserved

The phase stopped after **two native successes and one known `invalid_output` failure**. All three provider responses were complete HTTP 200 envelopes with one choice and finish reason `stop`. The third response decoded under the closed schema, but its Ask reply referenced no retained or added topic. Pure validation against the pinned source reconstructs **`reply_decision`**. **That substage was not captured:** the runtime suppressed structured logs. The captured native reason is `invalid_output`.

The rejected response also added a note falsely claiming the preference had been replaced and asked for conversational confirmation. **None of that response became visible or persisted.** Earlier messages, both successful continuity snapshots and the correct proposed replacement stayed unchanged. The card remained proposed at revision 0; the whole canonical profile still exactly matched setup: version 1, one confirmed bean-chilli fact. No confirmation, participant review refresh, candidate draft revision or session completion occurred.

Source `91ef6395aaae92d0d05fe2ee6f5f94b5456adc70`, prompt `private-discovery-prompt-v12`, policy `private-discovery-policy-v2`, freeze `f967d28fd8d2eec56c728ed3f27fcd18ea90d1c9354a3fd407c3b8a09976949b`. Candidate settings remained GPT-OSS 120B, 4,096 output tokens, temperature 0, non-streaming, a 120-second deadline and one maximum provider attempt; gateway payload collection and caching stayed disabled.

| Call | Native result | Input tokens | Output tokens | Estimated USD | Ticket to completion ms | Dispatch to completion ms |
| --- | --- | --: | --: | --: | --: | --: |
| 1 | succeeded | 3016 | 791 | 0.00164885 | 9153 | 8882 |
| 2 | succeeded | 3206 | 1045 | 0.00190585 | 6873 | 6814 |
| 3 | failed | 4644 | 1294 | 0.00259590 | 20236 | 20097 |
| **Total** | **2 success / 1 failure** | **10,866** | **3,130** | **0.00615060** | **36,262** | **35,793** |

Total usage was **13,996 tokens**, including the rejected output. Cost uses frozen $0.35/$0.75 per million input/output tokens and is an estimate, not an invoice. Timings end at recorded native completion and include orchestration/native handling; they are not isolated provider latency. First-token time, provider-only latency and cached/reasoning subtotals remain unmeasured.

The two successful snapshots retained one circumstance note and one preference-change note, which moved from unresolved to answered. The omitted first note survived the second update. Both notes were accurate, but neither represented the disclosed batch-cook circumstance, which remained in every native request's history. Call 2 chose Review without asking about dependency or safety. Both required discoveries remained missing.

Manual visible-dialogue classification: **two admitted assistant replies, one substantive question, zero repeated questions**. The rejected third response's conversational-confirmation question is counted separately and excluded from visible-question metrics. The driver admitted one opening, one earned replacement answer and the actual-card scope challenge. All **14 independent driver-binding checks** passed; no unearned dependency/safety answer or neutral filler was added.

Two local incidents remain recorded. A cards read failed; status showed no pending mutation and a fresh readmission/cards sequence succeeded. A separate input-preparation error was recorded by root observation; no separate pipeline-failure artifact exists. That inert attempt reported zero helper invocations and no attempted commands, and the actual ledgers show no extra append, participant intent or provider call. These recoveries were **not model retries**.

The phase reserved **143,616 micro-USD ($0.143616)**. Historical totals at closure were **91 calls / 85 higher-cap / 0 judges / 4,347,136 micro-USD**. Since the existing $20 authority anchor, 23 calls conservatively reserved an additional **1,101,056 micro-USD ($1.101056)**. Retained participant history is 64 GPT intents plus one Qwen intent; the separate persistence proof retains its original scope. Reservations and token-cost estimates are distinct measures.

Graceful closure was verified at **2026-09-09T10:18:29.052Z**: actor and runtime acknowledgements/joins, absent locks and closed listener. Provider-side revocation was not verified. The native session remained open; resource closure is not scenario completion. No family, baseline, A/B, judge or human result was accepted; the other seven families were not run.

The companion JSON separates raw output, source reconstruction, visible messages and persisted snapshots, with per-call metrics and receipt hashes. JSON SHA-256: `e116cdbb0709916599194e1caf37cf452743ea2262cfcd1e72dd3bdfbff7a2a2`. No future-prompt or general model-capability result is inferred.

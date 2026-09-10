# Prompt v12 Qwen: invalid JSON rejected, earlier state preserved

The Qwen comparison stopped after **one native success and one known `invalid_output` failure**. Both provider responses were complete HTTP 200 envelopes with one choice and finish reason `stop`. Call 2's original assistant string contained an extra closing brace: JSON parsing reported `Extra data` at zero-based offset 699. **`output_json` was captured from one actual native diagnostic event.** Its call/turn/session association is explicitly harness-correlated; the event supplied no native attempt or worker identity. No output was repaired or replayed.

No card ever persisted. The first visible reply, continuity snapshot and whole first turn stayed unchanged; the failed turn stored no generated reply or snapshot. The whole canonical profile still matched setup at version 1 with one confirmed fact. No confirmation, participant review refresh or session completion occurred. The rejected raw text also sought conversational confirmation using an answered topic; this is a separate raw-text concern, not another captured validation stage.

Source `91ef6395aaae92d0d05fe2ee6f5f94b5456adc70`, prompt `private-discovery-prompt-v12`, policy `private-discovery-policy-v2`, freeze `0d8720fdad8c15ab9f43c721caec75487ae570033be976c31d99b8fc503f0e20`. Candidate: Qwen3-30B-A3B FP8, 4,096 output tokens, temperature 0, non-streaming, 120-second deadline, one provider attempt; gateway payload collection and caching disabled. The fixed GPT judge was not called.

| Call | Native result | Input tokens | Output tokens | Estimated USD | Ticket to completion ms | Dispatch to completion ms |
| --- | --- | --: | --: | --: | --: | --: |
| 1 | succeeded | 2994 | 1372 | 0.000619174 | 13880 | 13811 |
| 2 | failed | 3157 | 830 | 0.000443207 | 6145 | 6093 |
| **Total** | **1 success / 1 failure** | **6,151** | **2,202** | **0.001062381** | **20,025** | **19,904** |

Usage totals **8,353 tokens**, including rejected output. Cost uses frozen $0.051/$0.34 per million input/output tokens and is not an invoice. Timings include orchestration and native handling; provider-only latency, first-token time and cached/reasoning subtotals were not retained.

Request bodies measured **19,861 / 20,429 bytes** by serialization of the captured objects, matching their native dispatch hashes. Reconstructed binding envelopes were **20,000 / 20,568 bytes**; original live wire-envelope bytes were not retained. The unchanged limits were 32,768 / 40,000 bytes. Original response byte counts/hashes were captured separately.

The single retained unresolved note accurately represented the opening preference-change request, but omitted the disclosed batch-cook circumstance, which remained in both request histories. The driver supplied one opening and one earned replacement answer; all **nine independent grounding checks** passed. Dependency and safety facts remained undisclosed, and the scope challenge was untriggered because no card became visible. The fixture remained **incomplete at 2 of 8 intents**. One visible reply contained two formulations of one question, including one same-turn restatement and zero cross-turn repeats. The two rejected raw confirmation formulations are excluded from visible counts.

The phase reserved **95,744 micro-USD ($0.095744)**. Closure totals were **93 calls / 87 higher-cap / 0 judges / 4,442,880 micro-USD**; since the existing $20 authority anchor, 25 calls reserved an additional **1,196,800 micro-USD**. Participant history retained 64 GPT intents plus three Qwen intents. These reservations are separate from token-cost estimates.

Graceful closure was verified at **2026-09-10T06:38:10.203Z**: actor/runtime acknowledgements and exit-zero joins, absent locks and closed listener. Provider-side revocation was not verified. Resource closure did not complete the native session or scenario. No family, A/B, baseline, judge or human result was accepted, and no general model ranking or later-prompt result is inferred.

Companion JSON SHA-256: `607644592a802a087def8e986e4591dca99e3fdcd2fd87c1f228ef9fb7de10e5`.

# Prompt v14 / GPT 1/1: duplicate continuity addition rejected

H15 stopped after **one native success and one known `invalid_output` failure**. Both responses were complete HTTP 200 envelopes with finish reason `stop`. One actual native diagnostic captured **`continuity_updates`**: call 2 attempted to add an already retained batch-cooking note key. Its call/turn/session identity is explicitly harness-correlated; no native attempt or worker identity was emitted.

The first turn persisted two truthful notes: the disclosed batch-cooking circumstance and an unresolved preference-change topic. **No second reply, note update or card persisted.** The first messages, whole turn and snapshot stayed exact; the whole canonical profile still matched setup at version 1 with one confirmed fact. No cards, confirmations, review refresh or session completion occurred.

Source `33b72e4bc54ba628db7add97f70815afff53afcd`, prompt `private-discovery-prompt-v14`, freeze `e8eb240b9438cc12421b6096766b1e55741e27cda320a9fb9ab93e137ac4440a`. GPT-OSS 120B used **temperature 1/top_p 1**, 4,096 output tokens, non-streaming, a 120-second deadline and one provider attempt; payload collection and caching were disabled. The fixed judge retained temperature 0/no top_p and was not called. This combines prompt and sampling changes: **no isolated causal or general improvement claim** is made.

| Call | Native result | Input tokens | Output tokens | Estimated USD | Ticket to completion ms | Dispatch to completion ms |
| --- | --- | --: | --: | --: | --: | --: |
| 1 | succeeded | 3100 | 781 | 0.00167075 | 20714 | 20651 |
| 2 | failed | 3315 | 1030 | 0.00193275 | 15999 | 15949 |
| **Total** | **1 success / 1 failure** | **6,415** | **1,811** | **0.00360350** | **36,713** | **36,600** |

Total usage: **8,226 tokens**, including rejected output. Cost uses $0.35/$0.75 per million input/output tokens and is not an invoice. Timings include orchestration/native handling; provider-only latency, first-token time and cached/reasoning subtotals were not retained. Hash-matched serialized bodies were **20,409 / 21,272 bytes**; reconstructed binding envelopes **20,548 / 21,411 bytes**, not original wire captures.

The rejected JSON also contained an answered preference revision, a replacement proposal and a prospective-use question. None was applied or admitted; the question earned no dependency disclosure. No downstream validation result is inferred, and nothing was repaired or replayed. Only the fixed opening and earned replacement answer were submitted. Dependency and safety remained missing; no card triggered the challenge. The family stayed **incomplete at 2 of 8 intents**, with no A/B, baseline, judge or human result. The sole visible reply contained two literal questions plus one elicitation sentence about one topic, with internal sentiment labels; rejected questions are excluded from those counts.

The phase reserved **95,744 micro-USD**. Closure totals: **98 calls / 92 higher-cap / 0 judges / 4,682,240 micro-USD**. Since the existing $20 anchor, 30 calls reserved another **1,436,160 micro-USD**. Historical intents total 72: 69 GPT and three Qwen. Reservations and token-cost estimates are distinct.

Closure at **2026-09-10T07:42:41.739Z** was acknowledged; actor then runtime joined with exit 0. Both actual lock paths were absent and no listener remained on port 4197. Provider-side revocation was not verified; resource closure did not complete the native session.

Companion JSON SHA-256: `220d60c75e4006f608ebc4ade2cc4e99261cfbc5d6919c2e3256b4faff07db1c`.

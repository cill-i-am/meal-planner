# Prompt v13: output limit reached, earlier state preserved

The phase stopped after **two native successes and one known `invalid_output` failure**. All three provider responses were complete HTTP 200 envelopes. Calls 1–2 finished with `stop`; call 3 finished with **`length` at 4,096 output tokens**. One actual native diagnostic captured **`incomplete_completion`**. Its call/turn/session identity is explicitly harness-correlated; no native attempt or worker identity was emitted. No output was repaired or replayed, and no later `output_json` or `reply_decision` stage is claimed.

The rejected completion repeated malformed blocks separated by ten NUL bytes and ended with an unfinished block. Raw text repeatedly combined `ProposeProfileCard` with revision fields and used an answered topic for conversational confirmation. These are **unvalidated raw-text observations**. None became an admitted reply, note, card revision or actual confirmation, and repetition within one response was not a model retry.

Both earlier replies, whole turns, continuity snapshots and the actual replacement card stayed unchanged. The card remained proposed at revision 0; the whole canonical profile still matched setup at version 1 with one confirmed fact. No confirmation, participant review refresh or session completion occurred.

Source `01b37feb3b48949cd90604de9c55e5d1b20138f8`, prompt `private-discovery-prompt-v13`, policy `private-discovery-policy-v2`, freeze `f2ab3698df78ccbe14128436aca64dcafeff2a7be010937dfe7ae6817ed6849e`. GPT-OSS 120B used 4,096 output tokens, temperature 0, non-streaming, a 120-second deadline and one provider attempt; gateway payload collection and caching were disabled. The fixed judge was not called.

| Call | Native result | Input tokens | Output tokens | Estimated USD | Ticket to completion ms | Dispatch to completion ms |
| --- | --- | --: | --: | --: | --: | --: |
| 1 | succeeded | 3099 | 505 | 0.00146340 | 14290 | 14230 |
| 2 | succeeded | 3271 | 780 | 0.00172985 | 45331 | 45282 |
| 3 | failed | 4711 | 4096 | 0.00472085 | 95879 | 95827 |
| **Total** | **2 success / 1 failure** | **11,081** | **5,381** | **0.00791410** | **155,500** | **155,339** |

Usage totals **16,462 tokens**, including rejected output. Cost uses frozen $0.35/$0.75 per million input/output tokens and is not an invoice. Timings include orchestration and native handling; provider-only latency, first-token time and cached/reasoning subtotals were not retained.

Hash-matched serialized request bodies were **20,369 / 21,072 / 30,681 bytes**. Reconstructed binding envelopes were **20,508 / 21,211 / 30,820 bytes**; original wire envelopes were not captured. Original response byte counts/hashes were retained separately. Limits stayed 32,768 / 40,000 bytes.

The private note accurately tracked the preference request from unresolved to answered. Neither successful snapshot represented the disclosed batch-cook circumstance, although all three request histories retained it. Call 2 produced a correct replacement draft and chose Review without a contextual question. The driver supplied the fixed opening, earned replacement answer and actual-card-triggered scope challenge; independent review accepted their grounding. The challenge response failed. Dependency and safety remained undisclosed: **one incomplete family at 3 of 8 intents**, with no family, A/B, baseline, judge or human result.

Visible question burden: call 1 had **two literal questions plus one additional elicitation sentence about one topic**, including internal sentiment labels. Call 2 had no question; call 3 added no visible reply. Cross-turn repeated questions were zero. Rejected repeated confirmation text is excluded from visible-dialogue counts.

A root setup typo used an unapproved fixture ID and was rejected before context creation or native effects. Correct setup then succeeded under a unique command ID. The typo added **zero participant admissions and zero provider calls**.

The phase reserved **143,616 micro-USD ($0.143616)**. Closure totals were **96 calls / 90 higher-cap / 0 judges / 4,586,496 micro-USD**. Since the existing $20 authority anchor, 28 calls reserved an additional **1,340,416 micro-USD**. Participant history retained 67 GPT intents plus three Qwen intents. Reservations are separate from token-cost estimates.

Graceful closure was verified at **2026-09-10T07:12:02.228Z**: actor/runtime acknowledgements and exit-zero joins, both actual participant/financial lock paths absent, and no listener on port 4197. Provider-side revocation was not verified; cleanup did not complete the native session. Original mechanism proofs retain their historical scope. No general model ranking, statistical improvement or later-prompt result is inferred.

Companion JSON SHA-256: `eeb560f5f29e0bbc0094b7d6be9de8ef5563ad806d10e67d436f5cbbd07de471`.

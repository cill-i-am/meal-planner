# Qwen native-tool diagnostic: valid arguments, rejected continuation

One actual Qwen request returned the expected nested function call with complete JSON string arguments. The original frozen inspector rejected the response before reaching those arguments. The root's separate offline inspection accepted the source schemas, then rejected the continuation. These are **three distinct findings**:

1. **Original frozen inspector — `tool_calls`.** Presence checks rejected a top-level parsed `tool_calls` alias, an empty top-level `response` string and a null legacy `message.function_call` field. The genuine nested tool-call channel was present and well formed. The recorded false schema/continuation flags mean those checks were not reached. The original inspector and its result remain unchanged.
2. **Genuine native channel — complete string arguments.** The expected single call appeared at `choices[0].message.tool_calls[0].function.arguments`, with empty parallel assistant content. The root's accepted inspection found that the untouched arguments were complete JSON and passed both canonical and card-context output schemas. The top-level alias agreed with the genuine nested arguments; it was not substituted for them.
3. **Explicit root offline continuation — `reply_decision`.** The exported `applyPrivateDiscoveryContinuation` rejected an Ask targeting a circumstance note. Root inspection also found conversational confirmation of already explicit intent, no interface review invitation, and no dependency or safety discovery. This was an offline source-function result, **not an application settlement stage**. Proposal-reference checks were manual checks against captured profile/cards; the private native proposal-review function was not invoked.

There was **no household session or native settlement**, so there was no new persisted semantic hard failure. No tool executed, participant was admitted, household/source replay ran, output was repaired, or text was salvaged. The offline inspection made no provider call. The diagnostic did not complete a family or establish an accepted baseline.

Source `0d76eba4f334c557606ddd246411fa38e5a56304`, prompt `private-discovery-prompt-v16`, policy `private-discovery-policy-v3`; final freeze `c9f1dc16e54aa2ec90ee11ee5d61e54d924a99a69b6fd14529938b046f070fef`. Qwen3 30B A3B FP8 used **temperature 0.6 / top_p 0.95 / top_k 20**, 4,096 output tokens, non-streaming, a 120-second deadline and one provider attempt. Payload collection and caching were disabled. No judge was called.

The request retained the exact captured H18 messages, pre-second-call context, generated card-context schema and sampling controls. Its complete delta was: remove `response_format`; add one inert named function with that unchanged schema; add named `tool_choice`. Request body SHA-256: `e86933e9bb646a0c8afb1932a2e31ad4c88f12fbc456cf4ddd3220d7e4656bd1`. This response selected the expected function; one diagnostic does not prove general named-choice enforcement or reliability.

| Actual call | Input tokens | Output tokens | Total tokens | Estimated USD | Ticket to diagnostic completion ms | Dispatch to diagnostic completion ms |
| --- | --: | --: | --: | --: | --: | --: |
| Complete HTTP 200, `stop` | 5,155 | 752 | 5,907 | 0.000518585 | 15,267 | 5,793 |

The estimate uses $0.051/$0.34 per million input/output tokens and is **not an invoice**. Recorded cached input tokens were zero. The ticket preceded dispatch by **9,474 ms**. Timings end at the original diagnostic completion and include startup, native handling and frozen inspection as applicable; they are not provider-only latency or household-settlement measurements.

The compact body was **20,103 bytes**; the **actual captured wire envelope was 20,242 bytes**; the returned response was **7,282 bytes**. The envelope was retained as original captured bytes, not only reconstructed from the request. Its content matches the frozen request, and returned response bytes match the native observation. Exact hashes are in the companion JSON.

The single call reserved **47,872 micro-USD**. Final accounting was **106 calls / 100 higher-cap / 0 judges / 5,065,216 micro-USD**. Since the existing authority anchor, 38 calls reserved another **1,819,136 micro-USD**. The 16,236-byte financial journal preserved the previous 16,082-byte prefix exactly. No new participant admission occurred; historical intent counts remain **79: 74 GPT and 5 Qwen**. Reservation accounting and usage-cost estimates are distinct.

The diagnostic completed at **2026-09-10T09:35:31.133Z** and runtime closure was recorded at **2026-09-10T09:35:31.151Z**. The root runtime session joined with exit 0. Runtime, gate and remote-session disposal were recorded; the actual financial lock, active-call marker and listener were absent when checked. Provider-side revocation was not verified.

Companion JSON SHA-256: `5b3aa0c9bf7f75fecabdb21a805c82b3f795e12eca4b52eef0ba2ddec5c4dfa9`.

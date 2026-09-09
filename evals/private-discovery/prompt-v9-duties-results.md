# Prompt v9: addition proposed when replacement was requested

The run stopped during `dependency_and_repair` after **two successful native generations**. The participant requested replacement of the existing bean-chilli preference with lentil soup, but the second response produced an addition-only card. Independent review confirmed semantic hard failure `family_1`. Nothing was confirmed: the whole canonical profile remained unchanged at version 1 and no duplicate fact was committed.

Source `c187a4af47c5af5d8e86d762af39c28317b9f406` (tree `e00d37c3d5f8a5d647373e99fed1056f27d7bcd3`), prompt `private-discovery-prompt-v9`, freeze `034f562bd8e3cc21d555db5c4a43aa7ae53639ceb1ae8f008ce2481c76971003`. Candidate: `@cf/openai/gpt-oss-120b`, 4,096 maximum output tokens, temperature 0, non-streaming, 120-second deadline and one maximum provider attempt. Gateway payload collection and caching were disabled.

| Call | Interaction | Input tokens | Output tokens | Total tokens | Estimated USD | Ticket to native completion | Dispatch to native completion |
| --- | --- | --: | --: | --: | --: | --: | --: |
| 1 | Opening | 2,813 | 421 | 3,234 | 0.00130030 | 10,256 ms | 10,102 ms |
| 2 | Explicit replacement request; semantic failure | 3,011 | 986 | 3,997 | 0.00179335 | 11,671 ms | 11,545 ms |
| **Total** |  | **5,824** | **1,407** | **7,231** | **0.00309365** | **21,927 ms** | **21,647 ms** |

Both calls returned complete HTTP 200 output with one choice and finish reason `stop`; both native outcomes were known and succeeded. The semantically failed second call is included in all usage and cost totals. No judge ran and no model or human scores were produced.

The actual `ProposeProfileCard` held `AddConfirmedProfileFact`, with no target fact ID and `reviewedFact: null`. The visible reply described adding lentil soup to replace the prior preference, while the draft could only add a preference. The requested effect required `ReplaceOrdinaryProfileFact` referencing the actual existing fact. The card remained proposed at revision 0; no confirmation command or pending confirmation existed. This is a wrong proposed effect, not an executed duplicate or a canonical-authority failure.

The final summary described the participant's replacement request and an open question; it did not claim replacement had completed. The opening's ambiguity about profile versus batch-cooking information was recorded as a quality concern, not a proven hard failure. These observations do not establish a full v9 pass or a calibrated improvement.

Both request contexts contained no cards, and the independently checked dynamic schemas exposed only `ProposeProfileCard`. The output shapes were accepted, but schema validity did not establish the correctness of the chosen effect. No live revision was exercised. Dependency and safety discoveries, the challenge requiring an actual replacement card, and the other seven families were not reached. There was no completed family or accepted baseline.

Ticket/dispatch intervals end at recorded native completion and include orchestration and native handling; they are not isolated provider latency. Provider-only latency, first-token time, cached/reasoning-token subtotals, question counts, repeated-question counts and quality scores remain unmeasured. Estimated cost uses $0.35/$0.75 per million input/output tokens and is not an invoice.

The two calls conservatively reserved 95,744 micro-USD ($0.095744). At closure, counters were 76 calls, 70 higher-cap calls, zero judges and 3,629,056 micro-USD ($3.629056) cumulatively reserved. Since the existing $20 additional-authority anchor of 68 calls / 3,246,080 micro-USD, eight calls reserved an additional 382,976 micro-USD ($0.382976). Reservations and token-cost estimates are separate measures.

The phase closed gracefully at **2026-09-09 01:39:43.500 UTC**. Actor and runtime shutdown acknowledgements were retained, both processes joined successfully, both locks were absent and the local listener was closed. Provider-side revocation was not verified. Resource closure does not mean the scenario completed.

The [companion JSON](prompt-v9-duties-results.json) includes exact per-call schema/body/response and receipt hashes, summary hashes, native-state and semantic-observation pins, and null unmeasured values. Its SHA-256 is `9048931afddf64f7bf65365c256c3400686f2ff227a30dd815927ba71890e855`. This record contains no evidence about a later prompt version or a statistically supported performance improvement.

# Prompt v8: schema handling passed, persisted summary failed

The run stopped during `dependency_and_repair` after **three successful native generations**. The context-specific provider schema worked for those calls, but the third call persisted a false committed-state claim in its private rolling summary. The replacement card remained proposed and the canonical profile stayed unchanged. This is a semantic hard failure, with no completed family or accepted baseline.

Source `934e5e0e27b54981c9b71f82786623daf967ca96` (tree `718e431f15484ab07fc0ae63a368260563a4cfdd`), prompt `private-discovery-prompt-v8`, freeze `02865636a822beb041493c6b2547f8533f8096f050328a9e5a56edc5ee58dee5`. Candidate configuration: `@cf/openai/gpt-oss-120b`, 4,096 maximum output tokens, temperature 0, non-streaming, 120-second deadline and one maximum provider attempt. Gateway payload collection and caching were disabled.

| Call | Interaction | Input tokens | Output tokens | Total tokens | Estimated USD | Ticket to native completion | Dispatch to native completion |
| --- | --- | --: | --: | --: | --: | --: | --: |
| 1 | Opening | 2,791 | 428 | 3,219 | 0.00129785 | 8,372 ms | 8,271 ms |
| 2 | Requested replacement | 2,962 | 557 | 3,519 | 0.00145445 | 7,120 ms | 7,006 ms |
| 3 | Profile-only scope challenge; semantic failure | 4,406 | 516 | 4,922 | 0.00192910 | 8,242 ms | 8,139 ms |
| **Total** |  | **10,159** | **1,501** | **11,660** | **0.00468140** | **23,734 ms** | **23,416 ms** |

Every call returned complete HTTP 200 output with one choice and finish reason `stop`; all three native outcomes are known and succeeded. The third call's usage is included despite its semantic failure. No judge ran and no model or human quality scores were produced.

The runtime matched each request to independently reconstructed native context and checked the provider schema in both request fields. Calls 1 and 2 had no cards and exposed only `ProposeProfileCard`. Call 2 correctly proposed `ReplaceOrdinaryProfileFact` against the actual canonical fact, producing a real draft. Call 3 had one observed proposed card and a revision option restricted to its ID, but returned no proposal. These live calls demonstrate request-schema handling and a valid replacement proposal; they do not demonstrate a live revision or a complete family pass.

The third persisted summary described the bean-chilli preference as replaced with lentil soup before any confirmation. Matching native evidence showed the draft still proposed at revision 0 and the whole canonical profile unchanged at version 1, with one confirmed fact. The independent review confirmed failure of `supported_material_facts`. The visible reply remained future-tense, and no completed plan or shopping repair was claimed. No confirmation command was issued and none was pending. Required dependency and safety discoveries were not reached; the other seven families were not run.

Before the first provider call, an actor launched without loopback access failed at local synthetic signup. A separate read-only probe reported `EPERM`. Its zero-intent, zero-provider receipts were preserved, the actor was closed and joined, and an unchanged actor with loopback access created a fresh disposable fixture. The pending signup was not retried. The runtime, phase, participant history and financial counters were preserved through that recovery.

Timing runs from retained ticket or local dispatch timestamps to the recorded native completion and includes orchestration and native handling. It is not isolated provider latency. Provider-only latency, time to first token, cached/reasoning-token subtotals, question counts, repetition counts and quality scores remain unmeasured. Estimated cost uses the frozen $0.35/$0.75 per million input/output-token rates and is not an invoice.

The three calls reserved 143,616 micro-USD ($0.143616) conservatively. At closure, counters were 74 calls, 68 higher-cap calls, zero judges and 3,533,312 micro-USD ($3.533312) cumulatively reserved. Since the existing $20 additional-authority anchor of 68 calls / 3,246,080 micro-USD, cumulative additional reservations were 287,232 micro-USD ($0.287232). Reservations and token-cost estimates are separate measures.

The phase closed gracefully at **2026-09-09 01:03:39.788 UTC** with matching shutdown acknowledgement, actor and runtime joined successfully, both locks absent and the local listener closed. Provider-side revocation was not verified. Resource closure does not mean the scenario completed.

The [companion JSON](prompt-v8-schema-results.json) retains exact per-call schema/body/response and receipt hashes, the persisted-summary hash, source and closure pins, and null unmeasured fields. Its SHA-256 is `27972b72eb789cb7efa5a218a147c16fe827b54dff26d647b1471d1fafcbae8d`. This record contains no evidence about a later prompt version or a statistically supported performance improvement.

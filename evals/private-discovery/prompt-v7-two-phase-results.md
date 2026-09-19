# Prompt v7: two closed incomplete family phases

Neither phase produced a completed family or accepted baseline. Across three actual candidate calls, the model used **12,435 input and 1,581 output tokens** (14,016 total), for an estimated **$0.00553800** at the frozen rates. Two opening responses were admitted; one complete response failed native proposal-reference review. No judge ran and no human scores were recorded.

Source: `02a0a47d376dd0cdb3430260ba8a05ada237cdae` (tree `ec3557b562d1cbf6e1c0b3ffe5d9912e9a404729`), prompt `private-discovery-prompt-v7`, policy `private-discovery-policy-v1`, tool `profile-card-change-v1`. Both attempts used `@cf/openai/gpt-oss-120b`, 4,096 maximum output tokens, temperature 0, non-streaming requests, a 120-second adapter deadline and one maximum provider attempt. Gateway payload collection and caching were disabled. The scenario pack, rubric, system instructions and schema hashes are pinned in the companion JSON.

## Per-call results

| Phase / call | Interaction | Native result | Input tokens | Output tokens | Total tokens | Estimated USD | Ticket to completion | Dispatch to completion |
| --- | --- | --- | --: | --: | --: | --: | --: | --: |
| 1 / 1 | Opening | Succeeded | 4,085 | 403 | 4,488 | 0.00173200 | 10,495 ms | 10,368 ms |
| 2 / 1 | Opening | Succeeded | 4,087 | 343 | 4,430 | 0.00168770 | 23,296 ms | 23,051 ms |
| 2 / 2 | Replacement clarification | Failed: `invalid_output` | 4,263 | 835 | 5,098 | 0.00211830 | 15,748 ms | 15,662 ms |
| **Total** |  | **2 succeeded, 1 failed** | **12,435** | **1,581** | **14,016** | **0.00553800** | **49,539 ms** | **49,081 ms** |

All three responses were complete HTTP 200 responses, with one choice and finish reason `stop`. Recorded usage for the rejected response remains included.

## Phase outcomes

**Phase 1 — `family-v7-continuation-v1`:** One actual call used 4,085 input and 403 output tokens (4,488 total; estimated $0.00173200). The first opening response was admitted. A second participant turn was appended, then interrupted with `runtime_restarted` before any provider request or reservation. The accepted diagnosis attributes that interruption to the manual driver's idle gap under the existing restart fence. The original evidence and subsequent diagnosis addendum are separately pinned. This unattempted turn has no provider usage or latency assigned to it.

**Phase 2 — `family-v7-immediate-v1`:** The reviewed pipeline immediately generated the turn returned by the append acknowledgement. Two actual calls used 8,350 input and 1,178 output tokens (9,528 total; estimated $0.00380600). The opening succeeded. The replacement response was complete JSON and passed the canonical output shape decoder, then failed `proposal_revision_target`: an outer `ReviseProposedProfileCard` referenced a nonexistent placeholder draft card while observed context and native state contained no cards. Its inner `ReplaceOrdinaryProfileFact` referenced the correct existing canonical fact. The missing-card check failed first, so nested fact review did not execute. The failed assistant text and proposal were not admitted.

In each phase, only `dependency_and_repair` started; the other seven families were not run. Each had two participant intents and one admitted assistant message. Both retained zero cards and the whole seeded canonical fact unchanged at profile version 1. No confirmation command was issued. The sessions were still open at their final native inspections; phase-resource closure does not mean scenario completion.

## Measurement and budget

Ticket-to-completion time runs from the ticket receipt to the recorded native completion; it includes local admission and dispatch, provider work, and native handling. Dispatch-to-completion starts at local request capture and also includes native handling. Neither is isolated provider latency. Provider-only latency, time to first token, cached/reasoning token subtotals, question counts, repeated-question counts, model quality scores and human scores remain unmeasured.

The estimates use $0.35 per million input tokens and $0.75 per million output tokens and are not invoices. Each actual call reserved 47,872 micro-USD in the local budget, totaling 143,616 micro-USD ($0.143616) across these phases. Phase 1 reserved $0.047872; phase 2 reserved $0.095744. At final closure, historical counters were 71 total reserved calls, 65 higher-cap calls, no judge calls and 3,389,696 micro-USD ($3.389696) cumulatively reserved. The $20 additional authority remained anchored at 68 calls / 3,246,080 micro-USD. Reservation and token-cost estimates are different measures.

## Closure and limits

Both phases have matching graceful shutdown acknowledgements, successful actor and runtime exits, closed local listeners and absent participant/financial locks. Phase 1 closed at 2026-09-08 23:32:41.367 UTC; phase 2 closed at 2026-09-09 00:15:20.877 UTC. Provider-side revocation was not verified.

These are incomplete, unmatched attempts, with no passing full-family result, judge score or human calibration. They establish the concrete interruption and rejection stages above, not a quality or performance improvement. They contain no evidence about a later prompt or schema revision.

The [companion JSON](prompt-v7-two-phase-results.json) includes per-call receipt hashes, phase-result and closure hashes, immutable source hashes, precise timing definitions, null unmeasured values and a hash of the private receipt index. It contains no transcript, reasoning text, private object identifier or private receipt location. Its SHA-256 is `db9dc72534d1747fe06d884f2b4d6dae7c1bd1ac48241f2059c0003036c11b73`.

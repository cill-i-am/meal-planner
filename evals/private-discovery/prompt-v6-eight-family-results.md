# Eight-family discovery continuation — measured v6 result

**No family passed:** five incomplete, two grounding failures and one output-contract failure. The phase made 28 candidate calls: 27 native turns succeeded and one failed. No judge or human scoring ran.

| Family | Result | Calls | Native succeeded / failed | Input / output tokens | Estimated USD | Reserved USD |
|---|---|---:|---:|---:|---:|---:|
| simple household baseline | incomplete | 5 | 5 / 0 | 20,700 / 2,436 | 0.00907200 | 0.23936000 |
| conflicting adult routines | incomplete | 4 | 4 / 0 | 16,405 / 1,883 | 0.00715400 | 0.19148800 |
| dependants and fallbacks | grounding_failure | 1 | 1 / 0 | 3,764 / 429 | 0.00163915 | 0.04787200 |
| mixed dietary household | incomplete | 3 | 3 / 0 | 12,073 / 1,552 | 0.00538955 | 0.14361600 |
| hard constraint household | incomplete | 4 | 4 / 0 | 16,926 / 2,582 | 0.00786060 | 0.19148800 |
| routine heavy household | grounding_failure | 2 | 2 / 0 | 7,854 / 1,305 | 0.00372765 | 0.09574400 |
| capacity constrained week | incomplete | 7 | 7 / 0 | 30,273 / 3,603 | 0.01329780 | 0.33510400 |
| dependency and repair | output_contract_failure | 2 | 1 / 1 | 7,823 / 4,404 | 0.00604105 | 0.09574400 |

**Totals:** 115,818 prompt and 18,194 completion tokens; **$0.05418180 estimated** at recorded $0.35/$0.75 per million input/output tokens. This phase reserved **$1.340416**; cumulative reservations reached **$3.246080** across 68 calls. Reservations are not invoices.

Ticket-to-native-completion across all 28 calls: mean **12.166964 s**, median **9.9555 s**, range **4.763–49.010 s**. These intervals include orchestration and native readback; provider-only latency and first-token latency remain unavailable.

The failed repair call reported a length-limited completion with 4,096 output tokens. Production rejected `incomplete_completion` as native `invalid_output`, before content JSON decoding or card review. Its usage, estimated cost and elapsed time are included. No assistant message or card from that call was admitted, and canonical state stayed unchanged. Private forensic content findings do not prove a parser or nonexistent-card rejection or establish the cause of repetition/truncation.

Grounding failures involved an unsupported fallback category and an invented preference against repeated meals. Other families missed required discovery despite some real profile confirmations. The required live fresh-session repeat remained unrun. Five local actor-control failures are recorded separately from model outcomes.

**Shutdown limitation:** the actor closed and its supervisor joined with code 0. Runtime SIGTERM/join returned 143 and the expected closed receipt was absent. Root initially observed local processes, worker processes, listener and run-state locks absent. A stale shared financial lock was then found; root proved its owner absent and removed only that lock, leaving the financial journal unchanged. Completion of asynchronous runtime/remote-transport disposal and cloud cleanup remains unverified.

Measured source: `cd24fbf7283a311f0387d84b2560db761bc26e38` (tree `61121011edfc4896ef263bbdf3d85f95bea2e1e9`), prompt `private-discovery-prompt-v6`, fixed GPT-OSS 120B candidate. This contains no v7 quality result. Exact sanitized receipt digests are in [the structured result](prompt-v6-eight-family-results.json); private identifiers and per-call evidence remain outside the repository.

No accepted baseline, soft scores or human calibration. Numeric question/repetition counts and unavailable telemetry remain null; later-stage obligations remain not exercised.

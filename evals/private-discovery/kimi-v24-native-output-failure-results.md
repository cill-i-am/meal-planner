# Kimi v24 native suite: output-schema failure on baseline turn 2

**The first native turn succeeded; the second response failed production decoding and stopped the suite.** Both provider responses were complete HTTP **200** with finish reason **stop**. Turn 2 omitted the required `subject` at `continuity.notes[2].subject` on the unresolved `usual_meals` note, producing known **`invalid_output`**.

Independent decoding of the original, unmodified output identified that missing field. The advertised schema required it in both note branches, and the supplied retained note included it. No additional output-schema defect was reported. Proposal and continuity application was never reached; no repaired output was tested or substituted. The native diagnostic records `output_schema`; the exact missing-field path comes from independent production decoding. Diagnostic correlation used the harness's exclusive active-call snapshot because native attempt and worker identities were unavailable.

The limited positive result is that **turn 1 retained an unresolved usual-meals question** while visibly asking about hard constraints. The usual-meals question was **never visibly asked or answered**. The participant's correction and safety answer remain in the third history message. Turn 2's generated correction, safety handling and further question were wholly rejected; no failed assistant message, proposals or continuity were applied. They provide no accepted generated-state or correction evidence.

The original card remained **revision 0, proposed and unchanged**. The profile stayed at **version 0 with zero facts**. The session remained **open at version 3**, with three messages, one assistant message and no pending confirmation. Turn 1's assistant message and continuity survived unchanged; the failed turn's summary and continuity are null.

| Candidate turn | Native result | Input / completion tokens | Dispatch → completion |
| --- | --- | --: | --: |
| 1 | Success | 4,197 / 5,606 | 102.288 s |
| 2 | Failed: `invalid_output` | 4,625 / 5,851 | 90.552 s |
| **Total** | **1 success / 1 failure** | **8,822 / 11,457** | **192.840 s** |

Timing sums each dispatch receipt to its completion receipt. It is not whole-conversation duration or pure provider latency. The separate turn-1 participant-append pipeline metric was **102.532 s**; the failed turn has no corresponding pipeline metric.

Only **1 of 8 families started**; none completed. The seven other families, native completion, baseline B, confirmations and judging remain unrun. The output failure correctly triggered a **global stop**; it is not a fixture-local coverage result that permits sealing and continuing. There was no provider retry or output repair, and no full-suite pass or new model acceptance.

Source `6efde2463445b4557cbda8c9b9644426dace00b2`, tree `b360fc54b779434fa0db929b67d66016a2d276c8`, used prompt v24 and policy v5. Kimi K2.6 ran with thinking enabled, temperature **1**, top_p **0.95**, `json_object`, one nonstreaming choice, **65,536 completion tokens**, **900 seconds** and a **2 MiB** response limit. The [exact-source CI run](https://github.com/cill-i-am/meal-planner/actions/runs/34687351249) passed; the native failure remains separate evidence. All **951 source files and modes** and **86 harness pins** remained unchanged through closure.

The configured full-input usage estimate for both responses is **$0.054208935288**, using **$0.950004 input / $4.00 output per million tokens** and counting aggregate completion tokens once. Billing was not verified. Reviewed exposure is **3,229,843 + 1,022,364 = 4,252,207 microUSD**, below the original **20,000,000-microUSD** post-anchor limit. Both new calls retain their full **511,182-microUSD** reservations. The separate gross historical ledger is **156 calls / 148 higher-cap reservations / 2 historical judge reservations / 23,304,820 microUSD**. Neither reservations nor reviewed exposure is billed spend.

Shutdown was graceful at **2026-09-12T10:26:34.313Z**. Runtime and actor joined with exit **0**; recorded processes and the listener were absent. Two captures and two reports were retained, with no blocked request or ordinary network forwarding. Provider-side revocation was not verified. Prior results and the future conversation-tone follow-up remain unchanged; no human ratings were supplied or invented.

Companion JSON: `kimi-v24-native-output-failure-results.json`; SHA-256 `33932d6ac15ed07008e7707f00045cee7cd8aa92d14b06eece2131165591dabb`. Selected receipt hashes retain provenance without private identifiers, origins, paths, transcripts or reasoning content.

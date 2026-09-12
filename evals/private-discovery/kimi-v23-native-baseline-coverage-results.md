# Kimi v23 native baseline: correction succeeded, meal discovery incomplete

**Two native turns succeeded, but the baseline covered only two of three required discoveries.** The application reached Review without asking about the adult's usual meal (`simple.routine`). No no-information response for that topic was observed. Six authorized fixture call slots remained unused, so the call ceiling did not force the endpoint.

The actual early tomato-soup card was reviewed, then the fixed correction changed that **same card from revision 0 to 1**, accurately proposing a roasted-tomato-soup like. The candidate also produced supported cold-tomato-soup dislike and `NoKnownHardConstraints` proposals. All **three cards remained proposed**. The canonical profile stayed at **version 0 with zero facts**; no confirmation or canonical mutation occurred.

Both original provider responses were complete HTTP **200**, finish reason **stop**, and known native successes. Canonical snapshots and rendered messages matched in both turns. This is an **agenda/coverage failure**, with no transport or schema failure, provider retry or output repair.

| Native turn | Application decision | Input / completion tokens | Append acknowledgment → completion |
| --- | --- | --: | --: |
| 1 | Ask: adult hard constraints | 4,177 / 3,728 | 65.826 s |
| 2 | Review | 4,539 / 6,528 | 126.805 s |
| **Total** | **2 native successes** | **8,716 / 10,256** | **192.631 s** |

The session remained **open at version 4**, with four messages and no pending confirmation. Native completion, fresh B, the judge and all six other fresh families were not run. No new model acceptance or full-suite pass follows.

Source `e2d5e4eb6fbbf3e69805d9c83d14c8a75b275caf`, tree `1c72325d963adea989a21cb924c8adb483f238d2`, retained the implementation from `52d1b230`, prompt v23 and policy v5. Kimi K2.6 used thinking enabled, temperature **1**, top_p **0.95**, `json_object`, one nonstreaming choice, **65,536 completion tokens**, **900 seconds** and a **2 MiB** response limit. All **948 source files and modes** and **86 harness pins** remained unchanged through closure.

The sealed configured full-input usage estimate is **$0.049304234864**, counting aggregate completion tokens once; billing was not verified. The gross historical ledger closed at **154 calls / 146 higher-cap reservations / 2 historical judge reservations / 22,282,456 microUSD**. Separately reviewed spending exposure was **3,180,537 microUSD** of adopted historical exposure plus **1,022,364 microUSD** of full new phase reservations, totaling **4,202,901 microUSD** against the original **20,000,000-microUSD** post-anchor limit. Gross reservations, reviewed exposure and billed spend must not be conflated; these new known calls were not automatically settled against billing.

The earlier focused dependant pass remains unchanged and separate. Subsequent user qualitative criteria acceptance and a tone follow-up did not supply numerical human ratings or establish the missing baseline/full-suite results.

Shutdown was graceful at **2026-09-12T09:40:57.801Z**. Actor and runtime joined with exit **0**; all three recorded processes and the listener were absent. Two captures and two reports were retained, with no blocked request or ordinary network forwarding. Provider-side revocation was not verified.

Companion JSON: `kimi-v23-native-baseline-coverage-results.json`; SHA-256 `a27bb53dac3b510aa38eaf56df46bebee6ec4eb68b0816b15c559434609f0e9f`. Selected source, response, card-review, terminal and closure hashes are retained; private origins, identifiers, raw transcript text and reasoning content are excluded.

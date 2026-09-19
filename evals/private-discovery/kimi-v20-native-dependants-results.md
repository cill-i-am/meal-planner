# Kimi v20: dependant avoidance discovered, fallback coverage still incomplete

**Three native turns succeeded and two supported adult facts were explicitly confirmed.** The native session completed at version **11**, but the **Dependants and fallbacks** fixture remained incomplete. There were **zero judge calls, human ratings or accepted families**, and no candidate acceptance.

The opening supplied the adult's curry preference. The first follow-up elicited the dependant's dislike, which stayed in private context and produced no adult profile fact. The model then elicited the adult's personal safety statement. Explicit confirmations produced canonical profile version **2**, containing a vegetable-curry dish preference and `NoKnownHardConstraints` for the adult; the safety statement was not applied to the dependant.

The model returned `Review/no_relevant_open_topic` while the declared fallback need and dependant dislike remained. It did not elicit the exact fallback or acceptable extra preparation, and the fixed challenge was never exercised. **Five of eight authorized candidate slots remained unused**, so the call ceiling did not force wrap-up. Disclosure followed the fixture's reveal conditions; unasked fallback, workload and challenge information was not supplied.

The acknowledgement also restated the absence of an allergy claim as an affirmative non-allergy description. This was not established as a dependant-wide safety clearance or a proven hard assertion failure, but the wording should retain the narrower evidence. Missing fallback disclosure and the challenge leave the **full family hard gate incomplete**; this is not an all-hard-gates pass.

| Native turn | Reply decision | Input / completion tokens | Append acknowledgment → completion |
| --- | --- | --: | --: |
| 1 | Ask | 3,128 / 3,972 | 100.970 s |
| 2 | Ask | 3,551 / 4,006 | 107.041 s |
| 3 | Review | 3,708 / 4,655 | 135.710 s |
| **Total** | **3 successes** | **10,387 / 12,633** | **343.721 s** |

All three calls had known successful native outcomes, complete HTTP **200** responses, finish reason **stop**, and zero generation or schema failures. No provider call was retried. Intervals include native handling and exclude gaps between calls when summed; they are not provider-only latency or total interview duration.

Source `3302090cd61d83313199b3ed60b1408f6d5c05fc`, tree `cc50b1423e1accab5f737431998129a8381912db`, used prompt `private-discovery-prompt-v20` and policy `private-discovery-policy-v3`. Kimi K2.6 retained thinking enabled, temperature **1**, top_p **0.95**, `json_object`, one choice, nonstreaming output, a **65,536-token** completion allowance, **900-second** worker deadline and **2 MiB** response limit.

**Source-integrity qualification:** closure inspection found **930 surviving tracked files unchanged, including all runtime source**. However, **three historical repository JSON assets and five historical private pins were missing**. All eight were subsequently restored byte-exact, and **all 186 harness pins matched after restoration**. The cause of the missing files was not established. Uninterrupted availability of every source and harness artifact is **not proven**; this record does not claim the complete source was untouched throughout the run.

The configured full-input token estimate is **$0.06039965**, counting aggregate completion tokens once. Cache-aware cost and actual billing are unknown. This run reserved **1,533,543 microUSD** within a **5,000,000-microUSD** phase ceiling. The cumulative ledger closed at **141 calls / 16,101,946 microUSD**, retaining historical unknown reservations below the **20,000,000-microUSD** ceiling. Conservative reservations are not billed spend; five candidate slots and one judge slot remained unused.

Shutdown was graceful: actor and runtime joined with exit 0, all three checked processes and the listener were absent, and both locks were absent. Three request captures and three response reports were recorded, with no blocked provider requests. Provider-side revocation was not verified.

The run demonstrates successful native turns and observed dependant-avoidance discovery, while required fallback coverage remains unresolved and merge acceptance is unsatisfied. The next experiment is an app-owned required-field policy for declared fallback needs, leaving declaration and semantic extraction to the model.

Companion JSON: `kimi-v20-native-dependants-results.json`; SHA-256 `9bb34308c14e40a65ec671b443b39c3e2d5de3559414e6e0afb4e971df837e40`. It retains exact source, request and response provenance and selected terminal, integrity and closure receipt hashes. Private origins, identifiers, transcripts and reasoning text are excluded.

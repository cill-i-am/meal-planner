# Kimi v21 first attempt: provider failure before assistant output

**The first native opening failed with `provider_unavailable` before any assistant output was available.** A complete **HTTP 408** response of **221 bytes** was received **236,247 ms** after dispatch. The local transport recorded no transport failure, but the **upstream model outcome remains unknown**. No choice, finish reason or token usage was available, and the upstream cause was not established. There was no automatic retry or output repair.

Native state retained only the participant opening: **zero assistant messages, cards, confirmed facts, pending confirmations or successful continuity snapshots**. The session remained open at version **1**. This attempt made one candidate call, with zero successes and one native failure; it made no judge call or confirmation and did not complete the native session. Required discovery coverage, the fixed challenge and the hard-assertion review were not completed. No candidate was accepted, and human calibration was false.

**There is no live semantic assessment from this attempt.** The response provides no evidence for or against the correctness of typed-need progression, discovery quality or the new policy's completion behavior.

Source `8d0fbbc1f59e071f94c1b5747938d35f7e0351d0`, tree `ed3fe949b31fdc1efcdf5b7f5358d61e5c85b2e2`, used prompt `private-discovery-prompt-v21` and policy `private-discovery-policy-v4`. Kimi K2.6 used thinking enabled, temperature **1**, top_p **0.95**, `json_object`, one choice, nonstreaming output, a **65,536-token** completion allowance, **900-second** worker deadline and **2 MiB** response limit. Closure verification found all **938 tracked source files and modes**, all **199 harness pins** and the manifest unchanged.

Token usage and actual billing are unknown, so no usage-cost estimate is available. The complete **511,181-microUSD** reservation was retained. The cumulative ledger closed at **142 calls / 135 higher-cap calls / 1 judge reservation / 16,613,127 microUSD**, within the **20,000,000-microUSD** ceiling. These are conservative retained reservations, not billed spend; the cumulative judge reservation comes from earlier work, not this attempt.

Shutdown was graceful. Actor and runtime joined with exit **0**; all three recorded processes and the listener were absent, and both locks were absent. One request capture and one response report were recorded, with no blocked provider request. Provider-side revocation was not verified.

Companion JSON: `kimi-v21-first-attempt-provider-failure-results.json`; SHA-256 `f08a5f3154e676201b555a2f02aba6323ac1c962c0296650575d3628d495f3dd`. It retains source, request and response hashes and selected completion and closure receipts. Private origins, identifiers, transcripts and response-body content are excluded.

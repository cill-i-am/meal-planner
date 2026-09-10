# First Kimi probe: native outcome unavailable

The single first Kimi request produced **no observable native provider response**. The native observation retained null status, body, byte count and hash, with responseComplete false and transportFailure true. **Actual usage and estimated usage cost are unavailable, not zero.** Provider success or failure remains unknown.

The retained **43-byte HTTP 502 response was generated locally by the worker's fallback**. It is not a captured provider HTTP 502 response and does not establish a provider-side cause.

The stop occurred **120,009 ms after dispatch**, and closure **120,018 ms after dispatch**. That timing is consistent with the configured **120-second worker deadline**, before the **125-second forwarding deadline**. The exact caught exception was not retained; the underlying provider or network cause is unknown. These are stop and closure timings, not native-completion or provider-only latency measurements.

No native output was available. JSON, output-schema, continuity, reference and semantic validation were **not reached**; neither a diagnostic-inspection artifact nor a native-completion artifact was created. No model-quality grade or conclusion is available. There was no retry, replay, repair, tool execution, native settlement, participant admission, judge call or family acceptance.

Source **49b682f7dba6b0616313d308c2ac5c376a1d732e**, freeze **f75a059efa1e1fb774f9fdbd0f88dfc5e48e6bcced7e0e1f432acb62d1d46345**. The retained request used Kimi K2.6, **4,096 maximum completion tokens**, temperature **0.6**, top_p **0.95**, no top_k, thinking disabled, one choice, non-streaming and structured JSON output. The worker allowed one provider attempt; payload collection and caching were disabled.

The canonical body remained byte-identical to root preparation: **19,941 bytes**, SHA-256 **b32cca7eea391215a167484f015657e7ae4873f705c44ed33837930531f13f1a**. The **actual captured wire envelope was 20,080 bytes**, SHA-256 **c67b79a73476ad05258ea673f1450492addd585179bee24884c70dac3030b47c**. It matches the captured request exactly. There was one request capture and one response observation; the latter records native response unavailability. Retained message strings and the generated card-context schema were unchanged.

| Recorded interval   | Milliseconds |
| ------------------- | -----------: |
| Ticket to dispatch  |        9,141 |
| Dispatch to stop    |      120,009 |
| Dispatch to closure |      120,018 |

The **265,421 micro-USD reservation remains retained** because actual usage is unknown. Final accounting was **107 calls / 101 higher-cap / 0 judges / 5,330,637 micro-USD**. The 16,389-byte journal preserved the previous 16,236-byte prefix exactly. Since the original spending anchor, 39 calls reserved another **2,084,557 micro-USD**. These reservations are not measured usage charges. Historical participant intents remain **79**, with no new admission.

The stop was recorded at **2026-09-10T14:07:14.876Z** and closure at **2026-09-10T14:07:14.885Z**. The runtime joined with exit 0; runtime, gate and remote-session disposal were recorded. The actual listener, financial lock and active-call marker were absent when checked. Provider-side revocation was not verified.

Companion JSON SHA-256: **f8ed5859bcb1865b0f2b88547bb9e2f525631df5ef4930386fecf97d5ef642e3**.

# Kimi tiny structured-output baseline accepted

One actual native request returned a complete **HTTP 200** response ending in **stop**. Its canonical assistant content decoded to the exact expected object, **{"ok":true}**. Both JSON serialization and the tiny baseline schema were accepted. No reasoning fields were present, and no reasoning metadata was substituted for output.

This establishes **only this tiny native structured-output baseline**. It does not establish full interview, profile, continuity, reference, private-discovery semantic, native-household or family acceptance. There was no native household settlement, participant admission, tool execution or judge call.

Source **19bd59753052cac3675761ffa60b9c07f5151ace**, freeze **7b4a594465cf14f139a2e3b6b1c6c89e36137a929a5456fec801691e47e0ceac**. Kimi K2.6 used a 4,096-token completion cap, temperature **0.6**, top_p **0.95**, no top_k, thinking disabled, one choice, non-streaming and structured JSON output. The worker deadline was 120 seconds and forwarding deadline 125 seconds. One provider attempt was permitted; payload collection and caching were disabled.

| Recorded usage                  |             Value |
| ------------------------------- | ----------------: |
| Input tokens                    |                28 |
| Output tokens                   |                 6 |
| Total tokens                    |                34 |
| Cached input tokens             |                 0 |
| Provider-reported neurons       | 4.600000381469727 |
| Estimated token-usage cost, USD |         0.0000506 |

The estimate is **(28 × $0.95 + 6 × $4.00) / 1,000,000**, using the current [Cloudflare Kimi K2.6 input/output rates](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/), verified on 10 September 2026. It is an estimated token-usage cost, **not a reservation or invoice**. Neurons are retained as observed provider usage metadata.

The canonical request body was **490 bytes**; the actual captured wire envelope **629 bytes**; the original native response **386 bytes**. There was one request capture and one response observation. The wire envelope matches the captured request, and returned bytes match the native observation. Exact hashes are in the companion JSON.

Dispatch was recorded at **2026-09-10T14:31:57.849Z**, diagnostic completion at **2026-09-10T14:31:59.855Z**, and closure at **2026-09-10T14:31:59.874Z**: **2,006 ms** from dispatch to diagnostic completion and **2,025 ms** to closure. Ticket-to-dispatch startup took **9,707 ms**. These intervals are not provider-only latency or household-settlement timings.

This call retained its **265,421 micro-USD reservation**. The earlier full request's separate **265,421 micro-USD unknown-outcome reservation also remains retained**; its actual usage and cost remain unavailable. This different tiny request was not a retry of the earlier full request and does not identify the earlier timeout cause.

Final accounting was **108 calls / 102 higher-cap / 0 judges / 5,596,058 micro-USD**. The 16,542-byte journal preserved the previous 16,389-byte prefix exactly. Since the original authority anchor, 40 calls reserved another **2,349,978 micro-USD**.

The runtime joined with exit 0. Runtime, gate and remote-session disposal were recorded, and the actual listener, financial lock and active-call marker were absent when checked. Provider-side revocation was not verified.

Companion JSON SHA-256: **8943161b9de589e20554729830d713137ccbe6dc70544026824dbf1f80485677**.

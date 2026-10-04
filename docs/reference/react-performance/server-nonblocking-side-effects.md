---
title: Own Post-Response Work
impact: MEDIUM
impactDescription: reduces response latency without losing required work
tags: server, async, logging, analytics, side-effects, cloudflare
---

## Own Post-Response Work

Move work after the response only when completing it is not part of the command's
success contract. Required audit/provenance writes, receipts and persisted state
belong in the owning transaction or durable delivery mechanism. Do not classify
them as optional simply to improve response latency.

For bounded best-effort Worker work, use the actual execution context's
`ctx.waitUntil` at the composition seam. The owner must classify failures and emit
safe telemetry. Require the expected execution context; `waitUntil?.(...)`
silently skips scheduling when it is absent. Keep backend work within its Effect lifetime
and the runtime ownership described in [async workflows](../engineering/ASYNC_AND_WORKFLOWS.md#promise-ownership).

`waitUntil` extends an HTTP invocation for up to 30 seconds after the response or
client disconnect; it does not provide durable acceptance or retries. Use the
established queue, outbox or workflow when work must survive that lifetime.
Do not return a successful acceptance result until the required durable record
has been saved.

Reference: [Cloudflare execution context](https://developers.cloudflare.com/workers/runtime-apis/context/#waituntil).

---
title: Reuse Immutable Static Data
impact: HIGH
impactDescription: avoids repeated static-data work where the runtime permits it
tags: server, io, performance, cloudflare
---

## Reuse Immutable Static Data

Reuse build-time static assets and immutable public data when repeated loading
is a measured cost. Keep request-specific values, user data and secrets out of
module state. Refreshable caches need a bounded lifetime and keys that preserve
account isolation; see [explicit caches](server-cache-explicit.md).

Cloudflare Workers forbid `fetch()` at module scope: network I/O must run inside
a handler. Do not retain request-owned I/O promises across Worker invocations.
Use the established asset pipeline for bundled assets and perform runtime I/O
inside its owning request or durable task. Isolate reuse is not guaranteed.

A Node process with a real filesystem has different startup rules. Its loader
must still own startup failure and refresh policy; a Node example is not a Worker
implementation.

Reference: [Cloudflare Fetch API](https://developers.cloudflare.com/workers/runtime-apis/fetch/).

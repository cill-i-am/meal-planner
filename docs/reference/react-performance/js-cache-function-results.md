---
title: Cache Repeated Pure Computation
impact: MEDIUM
impactDescription: avoids repeated computation without changing data ownership
tags: javascript, cache, memoization, performance
---

## Cache Repeated Pure Computation

Cache a pure calculation only when repeated work is a measured cost and its
result depends entirely on the cache key. Prefer local derivation or memoization
when the component owns the inputs. A shared cache needs a size bound, a clear
lifetime and an invalidation policy; see [explicit caches](server-cache-explicit.md).

Do not cache authentication decisions derived from `document.cookie`. Cookie
presence is not proof of an authenticated session, and a cached boolean can
outlive logout or an account change. Use the auth feature's current session
state for presentation and authorize protected operations on the server.

Keep request/user values out of shared server module state. A performance cache
must not become another owner of domain or remote query state. See
[data ownership](../engineering/DATA_FLOW_AND_STATE.md) and
[server auth boundaries](server-auth-boundaries.md).

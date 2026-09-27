# Web API transport

This host wiring supplies an origin and fetch implementation to generated Effect clients. [index.tsx](index.tsx) is the feature-facing boundary; [start-runtime.ts](start-runtime.ts) is the router composition entry. It contains no family rules or mutation persistence.

In the browser, Effect FetchHttpClient delegates to native fetch. During SSR, use the current request's private API Worker binding and cookies. Forward refreshed cookies to the HTML response. Keep requests isolated, reject destinations outside the owned API routes before forwarding credentials, and propagate cancellation. Never dehydrate bindings, clients, session tokens, or cookies into browser data.

Alchemy provides the Worker binding. The web Worker passes it through TanStack Start request context. Neither app-owned contracts nor backend authority move into web routes. See [the family reference](../../../../../docs/reference/family-api.md#screens-cache-and-auth).

# React Performance

Use these examples for a measured problem or a credible hot path, not as a checklist for every component edit. A rule's “incorrect” example may be acceptable outside its stated performance context. Prefer simpler code when an optimization has no meaningful benefit.

Keep request/user data out of module state, use bounded appropriately keyed caches, and authorize protected server operations. Use TanStack Query/Router for their owned data lifecycles. Local component state and effects remain appropriate for state or external synchronization they actually own.

For framework mechanics, use [tanstack-routing](../../../.agents/skills/tanstack-routing/SKILL.md). For a performance question, search the relevant prefix in this directory and read only the matching examples:

| Concern                                         | Rule prefix  |
| ----------------------------------------------- | ------------ |
| Request waterfalls and independent I/O          | `async-`     |
| Heavy bundles and import splitting              | `bundle-`    |
| Server caches, serialization, request isolation | `server-`    |
| Shared client requests and subscriptions        | `client-`    |
| Expensive rerenders and derived state           | `rerender-`  |
| Rendering, hydration, and resource hints        | `rendering-` |
| Measured JavaScript hot paths                   | `js-`        |
| Effect Events and callback lifetimes            | `advanced-`  |

Use installed React/TanStack APIs and verify version-sensitive advice. Keep cancellation and concurrency bounded where needed; examples using native Promises do not override Effect ownership in backend workflows. Confirm the optimization addresses the original problem without broadening scope.

## Preserved examples

These examples retain the original repository material; no automatic performance
skill fires on every component edit. Their applicability is conditional on the
stated problem and installed version, not a mandate to optimize all code.

- [_sections](_sections.md)
- [_template](_template.md)
- [advanced-effect-event-deps](advanced-effect-event-deps.md)
- [advanced-event-handler-refs](advanced-event-handler-refs.md)
- [advanced-init-once](advanced-init-once.md)
- [advanced-use-latest](advanced-use-latest.md)
- [async-api-routes](async-api-routes.md)
- [async-cheap-condition-before-await](async-cheap-condition-before-await.md)
- [async-defer-await](async-defer-await.md)
- [async-dependencies](async-dependencies.md)
- [async-parallel](async-parallel.md)
- [async-suspense-boundaries](async-suspense-boundaries.md)
- [bundle-analyzable-paths](bundle-analyzable-paths.md)
- [bundle-barrel-imports](bundle-barrel-imports.md)
- [bundle-conditional](bundle-conditional.md)
- [bundle-defer-third-party](bundle-defer-third-party.md)
- [bundle-dynamic-imports](bundle-dynamic-imports.md)
- [bundle-preload](bundle-preload.md)
- [client-event-listeners](client-event-listeners.md)
- [client-localstorage-schema](client-localstorage-schema.md)
- [client-passive-event-listeners](client-passive-event-listeners.md)
- [client-tanstack-query-dedup](client-tanstack-query-dedup.md)
- [js-batch-dom-css](js-batch-dom-css.md)
- [js-cache-function-results](js-cache-function-results.md)
- [js-cache-property-access](js-cache-property-access.md)
- [js-cache-storage](js-cache-storage.md)
- [js-combine-iterations](js-combine-iterations.md)
- [js-early-exit](js-early-exit.md)
- [js-flatmap-filter](js-flatmap-filter.md)
- [js-hoist-regexp](js-hoist-regexp.md)
- [js-index-maps](js-index-maps.md)
- [js-length-check-first](js-length-check-first.md)
- [js-min-max-loop](js-min-max-loop.md)
- [js-request-idle-callback](js-request-idle-callback.md)
- [js-set-map-lookups](js-set-map-lookups.md)
- [js-tosorted-immutable](js-tosorted-immutable.md)
- [rendering-activity](rendering-activity.md)
- [rendering-animate-svg-wrapper](rendering-animate-svg-wrapper.md)
- [rendering-conditional-render](rendering-conditional-render.md)
- [rendering-content-visibility](rendering-content-visibility.md)
- [rendering-hoist-jsx](rendering-hoist-jsx.md)
- [rendering-hydration-no-flicker](rendering-hydration-no-flicker.md)
- [rendering-hydration-suppress-warning](rendering-hydration-suppress-warning.md)
- [rendering-resource-hints](rendering-resource-hints.md)
- [rendering-script-defer-async](rendering-script-defer-async.md)
- [rendering-svg-precision](rendering-svg-precision.md)
- [rendering-usetransition-loading](rendering-usetransition-loading.md)
- [rerender-defer-reads](rerender-defer-reads.md)
- [rerender-dependencies](rerender-dependencies.md)
- [rerender-derived-state-no-effect](rerender-derived-state-no-effect.md)
- [rerender-derived-state](rerender-derived-state.md)
- [rerender-functional-setstate](rerender-functional-setstate.md)
- [rerender-lazy-state-init](rerender-lazy-state-init.md)
- [rerender-memo-with-default-value](rerender-memo-with-default-value.md)
- [rerender-memo](rerender-memo.md)
- [rerender-move-effect-to-event](rerender-move-effect-to-event.md)
- [rerender-no-inline-components](rerender-no-inline-components.md)
- [rerender-simple-expression-in-memo](rerender-simple-expression-in-memo.md)
- [rerender-split-combined-hooks](rerender-split-combined-hooks.md)
- [rerender-transitions](rerender-transitions.md)
- [rerender-use-deferred-value](rerender-use-deferred-value.md)
- [rerender-use-ref-transient-values](rerender-use-ref-transient-values.md)
- [server-auth-boundaries](server-auth-boundaries.md)
- [server-cache-explicit](server-cache-explicit.md)
- [server-cache-lru](server-cache-lru.md)
- [server-dedup-serialized-data](server-dedup-serialized-data.md)
- [server-hoist-static-io](server-hoist-static-io.md)
- [server-no-shared-module-state](server-no-shared-module-state.md)
- [server-nonblocking-side-effects](server-nonblocking-side-effects.md)
- [server-parallel-fetching](server-parallel-fetching.md)
- [server-parallel-nested-fetching](server-parallel-nested-fetching.md)
- [server-serialization-boundaries](server-serialization-boundaries.md)

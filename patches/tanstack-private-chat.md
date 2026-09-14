# TanStack private chat patches

The private interview uses the published TanStack implementations with three narrowly scoped patches. `pnpm-workspace.yaml` and the lockfile bind each patch to its exact package version. These patches do not change parsing, model loops, tool repair, or completion policy.

- **`@tanstack/ai-cloudflare@0.1.1`** exposes binding client `maxRetries`, `timeout`, `logLevel`, and explicit `cf-aig-max-attempts` options, forwards the caller's cancellation signal, and accepts a run-only binding. Private discovery sets zero SDK retries, one gateway attempt, the configured deadline, gateway and SDK logging off, and caching off. Only the explicitly permitted extra header crosses the native binding boundary; SDK authorization and diagnostic headers do not. The adapter's type-only Workers dependency is aligned to the repository's pinned `5.20260904.1`.
- **`@tanstack/ai@0.54.0`** adds `devtools: false` to opt out of automatic chat diagnostics and middleware instrumentation. Middleware configuration events can otherwise include the messages loaded by persistence. The private provider disables both diagnostic events and debug logging; ordinary SDK callers retain the published default behavior.
- **`@tanstack/ai-react@0.24.1`** accepts `devtools: false` and omits the real diagnostic bridge factory in that mode. The existing ChatClient then uses its supported noop bridge. Private interviews disable diagnostics during hydration, sending, and receiving.

The Cloudflare and core patches include corresponding source, ESM, declaration, and source-map changes. Generated source maps account for most of the core patch's size. The React patch changes its source, ESM implementation, and public declaration.

The provider's Effect schema remains the runtime authority. The application subclass preserves its exact forced strict tool definition and suppresses reasoning through the adapter's request/reasoning hooks. A complete, valid proposal is eligible for application acceptance without `[DONE]` or `finish_reason`. Known errors and cancellation reject; ambiguous streamed usage remains unknown. Saving household facts still requires the existing explicit confirmation command.

Behavioral coverage lives in `private-discovery-workers-ai.test.ts` and `private-interviews-panel.test.tsx`. Their diagnostic tests exercise the actual global event client with ordinary-call positive controls and private-transcript negative controls. Remove a patch only when a replacement published release passes these tests and the native private-session checks.

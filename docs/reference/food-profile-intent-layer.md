# Food profile intent map

Use this map for household-visible food profile changes after family setup. The
[auth and family intent layer](intent-layer.md) covers the preceding account and
family journey. Private interview transcripts and proposals have a separate
[authority boundary](private-discovery.md).

| Responsibility | Source | Guidance |
| --- | --- | --- |
| Profile values and shared HTTP contract | [`household-api`](../../packages/household-api/src/profiles.ts) and [`index.ts`](../../packages/household-api/src/index.ts) | [Household-visible profiles](household-people-api.md#household-visible-profiles) |
| Profile rules | [`household-profile.transitions.ts`](../../apps/api/src/features/households/profiles/household-profile.transitions.ts) | [Domain modeling](engineering/DOMAIN_MODELING.md) |
| Storage, version guards, receipts, and audit | [`household-profile.repository.ts`](../../apps/api/src/features/households/profiles/household-profile.repository.ts) | [Household-visible profiles](household-people-api.md#household-visible-profiles) |
| Authenticated HTTP and Worker composition | [`household.http.ts`](../../apps/api/src/features/households/household.http.ts) and [`household-domain-worker.ts`](../../apps/api/src/features/households/household-domain-worker.ts) | [Feature slices](engineering/FEATURE_SLICE_ARCHITECTURE.md) |
| Browser transport, remote state, and recovery | [Web profile node](../../apps/web/src/features/household-profiles/AGENTS.md) and [`index.ts`](../../apps/web/src/features/household-profiles/index.ts) | [Food profile journey](features/food-profiles/README.md) |
| Screen composition | [`index.tsx`](../../apps/web/src/routes/index.tsx) | [Family setup exit](features/auth-family/README.md) |
| Private confirmation continuation | [`confirmation-http.ts`](../../packages/private-interview-api/src/confirmation-http.ts), [handler](../../apps/api/src/features/private-output/private-confirmation.http.ts), and [browser operation](../../apps/web/src/features/private-interviews/private-confirmation.ts) | [Private discovery authority](private-discovery.md#current-runtime) |
| Private repeat review | [`private-interview-client.ts`](../../apps/web/src/features/private-interviews/private-interview-client.ts) and [`private-interview-chat.tsx`](../../apps/web/src/features/private-interviews/private-interview-chat.tsx) | [Private discovery authority](private-discovery.md#fresh-profile-review) |

The shared Effect HttpApi contract and generated client are already in
`@meal-planner/household-api`. The API host checks membership and supplies the
household storage and identity adapters. The browser feature owns TanStack Query
state; the screen owns the form and person selection. This slice keeps profile
rules in the API feature module because one household writer currently uses them.
Move them to a package if another host needs those operations; do not add a
pass-through package now.

The saved-facts disclosure stays in place while the family conversation loads.
The conversation keeps a bounded frame, so an asynchronous response cannot move
the disclosure during a mobile tap.

A fresh private `ProfileEdit` session reads the current saved profile for its
model context and opening guide. The private feature owns session state and
proposal review; the existing household command remains the only writer of
confirmed facts. Earlier sessions are read-only and their transcripts are not
sent to the new session. This path uses native authenticated WebSockets and the
existing household profile API. Confirmation continuation uses the shared private
confirmation HttpApi contract; only opaque metadata crosses that body-free
endpoint. The private session retains ownership of command recovery and socket
settlement.

When changing a boundary or behavior, update the owning reference and the
[feature map](features/food-profiles/README.md). Run `pnpm docs:check`, focused
browser component tests, and the relevant native journey. Record unexercised
paths separately from passing checks.

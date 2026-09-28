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

The shared Effect HttpApi contract and generated client are already in
`@meal-planner/household-api`. The API host checks membership and supplies the
household storage and identity adapters. The browser feature owns TanStack Query
state; the screen owns the form and person selection. This slice keeps profile
rules in the API feature module because one household writer currently uses them.
Move them to a package if another host needs those operations; do not add a
pass-through package now.

When changing a boundary or behavior, update the owning reference and the
[feature map](features/food-profiles/README.md). Run `pnpm docs:check`, focused
browser component tests, and the relevant native journey. Record unexercised
paths separately from passing checks.

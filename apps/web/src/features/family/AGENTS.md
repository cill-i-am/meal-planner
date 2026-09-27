# Browser family feature

Own family selection, generated-client operations, query keys, people commands, and roster management. Other slices use [index.ts](index.ts), not private files. The [family reference](../../../../../docs/reference/family-api.md) owns state, version, and recovery guarantees.

Family context exposes the selected resource. Query definitions and mutation hooks own transport, retry identity, and cache updates; screens own local fields and navigation. Setup route loaders preload those same queries.

Use Effect Query options with TanStack Query for remote state; React owns form and dialog state. Scope cache keys to account and family, and invalidate the owning queries after writes. Family selection also refreshes the native auth session for consumers that use its active organization.

A saved person and an invitation are separate outcomes. Keep a successfully saved person when its invitation fails. Keep unknown submitted commands in memory while mounted through [request recovery](../request-recovery/AGENTS.md), using the original payload, version, and key. Never invent success after an unknown response.

[Onboarding](../onboarding/AGENTS.md) owns screen composition; it does not own these operations. See [people behaviors](../../../../../docs/reference/features/auth-family/people.md) and colocated save tests plus native people integration tests.

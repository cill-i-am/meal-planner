# Family server adapters

This feature implements the family package's HTTP and storage boundaries. [http.ts](http.ts) admits authenticated requests and maps application failures. [family-store.d1.ts](family-store.d1.ts) implements `FamilyStore` with Drizzle/D1. Use [index.ts](index.ts) and [schema.ts](schema.ts) as the public boundaries.

The D1 adapter writes organization, owner membership, and family creation receipt atomically. Keep authorization, expected-version checks, and receipt checks in the guarded database write. Earlier in-memory checks cannot replace them. This adapter deliberately depends on the [auth schema](../auth/schema.ts).

[Family application guidance](../../../../../packages/families/AGENTS.md) owns coordination. [HouseholdCreatorLive](../households/family-membership.ts) implements creator linking; use the household [membership boundary](../households/membership.ts) in composition, keeping identity and RPC mechanics private to households. [worker.ts](../../worker.ts) supplies Alchemy clients and Effect Layers. Packages and adapters execute in the API Worker; extracting a package adds no deployment.

Follow the [canonical guarantees](../../../../../docs/reference/family-api.md). Use the native D1/Worker family tests for atomicity, replay, and runtime restart; package-only tests cannot prove these adapter guarantees.

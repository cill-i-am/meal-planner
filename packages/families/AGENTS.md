# Family capability

This package owns family values, the shared HTTP contract/client, and family application operations. Start with [the public root](src/index.ts) or [application.ts](src/application.ts). The root is browser-safe; `./application` is the server entry point. Keep host dependencies out of both.

The application depends on `FamilyStore` and `HouseholdCreator`. It coordinates creation and creator linking; the adapters own SQL, authenticated admission, and Worker RPC. Get/list operations must not create a household person.

Keep business values separate from HTTP error projection. Database race checks belong in the adapter's atomic write, even when pure policy is extracted here. Use [the family reference](../../docs/reference/family-api.md) for state, idempotency, and ownership rules. Change contracts and callers together.

[Server adapters](../../apps/api/src/features/families/AGENTS.md) implement these ports. [Browser family](../../apps/web/src/features/family/AGENTS.md) owns UI data operations. Check package tests, native adapter tests, and [boundary tests](../../scripts/family-feature-boundaries.test.ts) as appropriate.

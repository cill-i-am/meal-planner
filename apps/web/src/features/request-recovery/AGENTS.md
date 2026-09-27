# Submitted-request recovery

This cross-cutting feature retains commands whose results are unknown. Its public boundary is [index.ts](index.ts). It does not persist unfinished forms or navigation.

Retain the exact submitted payload and key before dispatch. Scope storage to the account and operation/family; concurrent commands need independent entries. Storage failure must stop dispatch. Release only when the owning feature knows the result, using its typed rejection rules; a transport failure is not rejection.

Logout must not turn a retry into a fresh mutation or expose another account's saved request. Follow [the canonical recovery rules](../../../../../docs/reference/family-api.md#ownership-and-recovery) and [cross-feature verification](../../../../../docs/reference/features/auth-family/journeys.md).

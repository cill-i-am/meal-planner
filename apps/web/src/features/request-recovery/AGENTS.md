# Submitted-request retries

This small shared hook keeps one submitted command in memory while its screen is mounted. Its public boundary is [index.ts](index.ts). It does not use browser storage or restore mutations after a reload.

Retry an unknown result with the original payload, version, and key. Scope the pending command to its account and operation/family. Release confirmed results and typed definite rejections. A transport failure is not rejection. Unmounting ends this local retry state; a new page load reads saved server resources and never automatically replays a mutation.

Server idempotency receipts and explicit family/invitation recovery remain authoritative. Follow [the recovery rules](../../../../../docs/reference/family-api.md#ownership-and-recovery) and [cross-feature verification](../../../../../docs/reference/features/auth-family/journeys.md).

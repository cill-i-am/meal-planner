# Submitted-request retries

The mounted-screen hook keeps one submitted command in memory. The session hook keeps an exact submitted command in browser session storage across reloads and route unmounts. Both are exported from [index.ts](index.ts). The session hook decodes saved commands at the storage boundary and scopes each key to the account, family and operation. It never automatically replays a mutation.

Retry an unknown result with the original payload, version, and key. Release confirmed results and typed definite rejections. A transport failure is not rejection. Unmounting ends the mounted-screen hook's retry state. A new page load reads saved server resources and leaves any session-retained command for explicit retry. If storage is unreadable or unavailable, block a new write rather than risk losing its identity.

Server idempotency receipts and explicit family/invitation recovery remain authoritative. Follow [the recovery rules](../../../../../docs/reference/family-api.md#ownership-and-recovery) and [cross-feature verification](../../../../../docs/reference/features/auth-family/journeys.md).

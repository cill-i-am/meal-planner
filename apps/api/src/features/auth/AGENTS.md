# Authentication and access

This feature owns native Better Auth identity, sessions, organizations, and membership integration. [auth.ts](auth.ts) is the shared configuration; [auth.alchemy.ts](auth.alchemy.ts) adapts it to the Alchemy runtime. Better Auth runs inside the API Worker and uses the bound auth D1 database.

Use [http.ts](http.ts) for app request admission, [index.ts](index.ts) for the public service interface, and [schema.ts](schema.ts) for explicit schema imports. Keep origin, rate-limit, refreshed-cookie, expected-account, and live membership checks. An active organization value alone is not authorization.

Public native organization writes are restricted so they cannot bypass family receipts, versions, and household protections. Coordinate family changes with [family adapters](../families/AGENTS.md); recipient responses use [invitation adapters](../invitations/AGENTS.md). Preserve the existing atomic password-reset and organization hooks when changing native integration.

Mail callbacks default to mocks. Creating a token or invitation is not evidence of email delivery. Keep tokens and credentials out of diagnostics and fixtures committed to source. Drizzle migrations own schema evolution; do not introduce a second migration owner. See [the runtime boundary](../../../README.md) and [auth feature map](../../../../../docs/reference/features/auth-family/authentication.md).

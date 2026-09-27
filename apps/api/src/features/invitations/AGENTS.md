# Invitation server adapters

[http.ts](http.ts) serves recipient reads and responses. [authority.better-auth.ts](authority.better-auth.ts) implements the invitation package's authority through Better Auth. Export through [index.ts](index.ts).

Construct authority and household membership adapters for the incoming request. Their headers and authenticated identity must never be shared between callers. Preserve recipient checks, expected-account handling, cookies, and native errors when translating to the shared response contract.

The [application package](../../../../../packages/invitations/AGENTS.md) owns the accept/decline sequence. The household [membership boundary](../households/membership.ts) owns invited-person linking. Do not rebuild that sequence in HTTP handlers or the browser.

Use [the family reference](../../../../../docs/reference/family-api.md) and [recipient feature map](../../../../../docs/reference/features/auth-family/invitations.md). Verify wrong-recipient access and interrupted acceptance with native tests as well as the package coordination tests.

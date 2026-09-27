# Invitation response capability

This package owns invitation response values, the HTTP contract/client, and accept/decline coordination. Its [public root](src/index.ts) is browser-safe; [application.ts](src/application.ts) is the server entry point.

`InvitationAuthority` handles recipient-authorized reads and native acceptance or rejection. `InvitationMembership` links the accepted account to its household person. Keep request headers, Better Auth, databases, and Worker bindings in [server adapters](../../apps/api/src/features/invitations/AGENTS.md).

Acceptance can succeed before person linking fails. A repeat acceptance must finish that link; it must not reject an already accepted invitation or create another person. A retained decline must not silently become acceptance.

The [family reference](../../docs/reference/family-api.md) owns cross-store rules. Use application tests here for coordination and native host tests for recipient checks and persistence. [Recipient UI](../../apps/web/src/features/invitations/AGENTS.md) loads the account without requiring a selected family.

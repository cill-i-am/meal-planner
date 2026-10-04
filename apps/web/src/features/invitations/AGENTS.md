# Invitation recipient screens

Own recipient presentation and response mutations, exported by [index.ts](index.ts). Load through the public account provider, without onboarding or family loading: a recipient may not have joined any family yet.

Use the generated invitation API via Effect Query. The server owns acceptance and household linking. Preserve the explicit Join/Decline choice, wrong-account handling, and [retained request](../request-recovery/AGENTS.md) after unknown results. An already accepted invitation can still need its household link finished.

Query and mutation options use the API transport feature's stateless `apiEffectQuery` adapter. Recipient-scoped keys, transport retries, and retained-response recovery remain owned here.

Use [the recipient map](../../../../../docs/reference/features/auth-family/invitations.md) for entry points and proof. Coordinate response changes with the [invitation package](../../../../../packages/invitations/AGENTS.md).
